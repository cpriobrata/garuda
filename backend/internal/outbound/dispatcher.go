package outbound

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"garuda/backend/internal/security"
	"garuda/backend/internal/store"
)

// Options configures a Registry. Everything has a working default, so
// outbound.New(Options{Store: dataStore}) is a complete configuration.
type Options struct {
	// Store is read by the event scan. A nil store disables scanning, which is
	// what the guard and signature tests want.
	Store store.Store
	// Path is the JSON file the endpoints and delivery log live in. Empty keeps
	// everything in memory, which is what the api tests use.
	Path   string
	Logger *slog.Logger
	// Now exists so tests can move time without sleeping.
	Now func() time.Time
	// Backoff is the delay before each retry. len(Backoff)+1 attempts are made in
	// total before a delivery is marked failed.
	Backoff      []time.Duration
	PollInterval time.Duration
	// IdleTimeout is how long a conversation must be silent before
	// conversation.ended is emitted for it.
	IdleTimeout time.Duration
	HTTPTimeout time.Duration
	// AllowPrivateDestinations is TESTS ONLY. See the Guard doc comment. No
	// configuration key and no environment variable reaches this field: it is set
	// from Go, by tests that need to post to an httptest server on loopback.
	AllowPrivateDestinations bool
	// DisableBackground stops New from starting the poll-and-deliver goroutine, so
	// a test can call Scan and Drain itself and assert on the result instead of
	// racing a ticker.
	DisableBackground bool
}

var defaultBackoff = []time.Duration{30 * time.Second, 2 * time.Minute, 10 * time.Minute, 30 * time.Minute, 2 * time.Hour}

// Registry owns the endpoints, the delivery queue and the worker that drains it.
type Registry struct {
	options   Options
	guard     *Guard
	client    *http.Client
	initError error

	// scanMutex serialises Scan against itself. mutex protects state; scanMutex
	// protects the read-emit-advance sequence, which briefly releases mutex.
	scanMutex sync.Mutex

	mutex sync.Mutex
	state persistedState
	// inFlight holds the deliveries a Drain pass has taken responsibility for, so
	// two overlapping passes cannot post the same event twice.
	inFlight map[string]bool

	wake      chan struct{}
	stop      chan struct{}
	stopped   chan struct{}
	closeOnce sync.Once
}

// New opens a registry and, unless DisableBackground is set, starts the worker
// that scans for events and drains the delivery queue.
func New(options Options) *Registry {
	if options.Logger == nil {
		options.Logger = slog.New(slog.NewTextHandler(io.Discard, nil))
	}
	if options.Now == nil {
		options.Now = func() time.Time { return time.Now().UTC() }
	}
	if len(options.Backoff) == 0 {
		options.Backoff = defaultBackoff
	}
	if options.PollInterval <= 0 {
		options.PollInterval = 5 * time.Second
	}
	if options.IdleTimeout <= 0 {
		options.IdleTimeout = 30 * time.Minute
	}
	if options.HTTPTimeout <= 0 {
		options.HTTPTimeout = 15 * time.Second
	}
	guard := newGuard(options.AllowPrivateDestinations)
	registry := &Registry{
		options:  options,
		guard:    guard,
		client:   guard.httpClient(options.HTTPTimeout),
		inFlight: map[string]bool{},
		wake:     make(chan struct{}, 1),
		stop:     make(chan struct{}),
		stopped:  make(chan struct{}),
	}
	if err := registry.load(); err != nil {
		// A corrupt or unreadable file must not take the API down, and it must not
		// be silently replaced with an empty one either -- that would drop every
		// customer's endpoints. Record it and fail the integrations endpoints only.
		registry.initError = err
		options.Logger.Error("outbound webhook state could not be loaded", "error", err)
	}
	if !options.DisableBackground {
		go registry.run()
	} else {
		close(registry.stopped)
	}
	return registry
}

func (r *Registry) now() time.Time { return r.options.Now() }

// Guard exposes the SSRF guard so a handler can validate a URL before storing it.
func (r *Registry) Guard() *Guard { return r.guard }

// Close stops the worker. It is safe to call more than once.
func (r *Registry) Close() {
	r.closeOnce.Do(func() { close(r.stop) })
	<-r.stopped
}

// run is the whole background loop. It never touches an HTTP request goroutine,
// which is what keeps a slow or dead customer endpoint off the request path.
func (r *Registry) run() {
	defer close(r.stopped)
	ticker := time.NewTicker(r.options.PollInterval)
	defer ticker.Stop()
	for {
		select {
		case <-r.stop:
			return
		case <-ticker.C:
		case <-r.wake:
		}
		r.Scan()
		drainContext, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
		r.Drain(drainContext)
		cancel()
	}
}

// signal nudges the worker without blocking the caller. The channel has room for
// one pending nudge, and a nudge already queued is as good as another.
func (r *Registry) signal() {
	select {
	case r.wake <- struct{}{}:
	default:
	}
}

// ---------------------------------------------------------------- endpoint CRUD

// List returns an account's endpoints, newest first, with secrets stripped.
func (r *Registry) List(accountID string) ([]Endpoint, error) {
	if r.initError != nil {
		return nil, r.initError
	}
	r.mutex.Lock()
	defer r.mutex.Unlock()
	endpoints := make([]Endpoint, 0, len(r.state.Endpoints))
	for _, endpoint := range r.state.Endpoints {
		if endpoint.AccountID == accountID {
			endpoints = append(endpoints, endpoint.Public())
		}
	}
	sort.SliceStable(endpoints, func(first, second int) bool {
		return endpoints[first].CreatedAt.After(endpoints[second].CreatedAt)
	})
	return endpoints, nil
}

// Get returns one endpoint, or ErrNotFound when it belongs to another account.
func (r *Registry) Get(accountID, endpointID string) (Endpoint, error) {
	if r.initError != nil {
		return Endpoint{}, r.initError
	}
	r.mutex.Lock()
	defer r.mutex.Unlock()
	index, err := r.findEndpointLocked(accountID, endpointID)
	if err != nil {
		return Endpoint{}, err
	}
	return r.state.Endpoints[index].Public(), nil
}

// Create registers an endpoint and returns it together with the signing secret,
// which is the only time the secret is ever readable.
func (r *Registry) Create(accountID, rawURL, description string, events []string) (Endpoint, string, error) {
	if r.initError != nil {
		return Endpoint{}, "", r.initError
	}
	parsed, err := r.guard.ValidateURL(rawURL)
	if err != nil {
		return Endpoint{}, "", err
	}
	normalizedEvents, err := normalizeEvents(events)
	if err != nil {
		return Endpoint{}, "", err
	}
	description, err = validateDescription(description)
	if err != nil {
		return Endpoint{}, "", err
	}
	secret, err := newSecret()
	if err != nil {
		return Endpoint{}, "", err
	}
	identifier, err := security.RandomToken(12)
	if err != nil {
		return Endpoint{}, "", err
	}
	now := r.now()
	endpoint := Endpoint{
		ID:          "whep_" + identifier,
		AccountID:   accountID,
		URL:         parsed.String(),
		Description: description,
		Events:      normalizedEvents,
		Enabled:     true,
		Secret:      secret,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	r.mutex.Lock()
	defer r.mutex.Unlock()
	owned := 0
	for _, existing := range r.state.Endpoints {
		if existing.AccountID == accountID {
			owned++
		}
	}
	if owned >= maxEndpointsPerAccount {
		return Endpoint{}, "", ErrTooManyEndpoints
	}
	r.state.Endpoints = append(r.state.Endpoints, endpoint)
	if err := r.save(); err != nil {
		r.state.Endpoints = r.state.Endpoints[:len(r.state.Endpoints)-1]
		return Endpoint{}, "", err
	}
	return endpoint.Public(), secret, nil
}

// EndpointPatch carries the fields an update may change. A nil field is left
// alone, which is what lets the UI toggle "enabled" without resending the URL.
type EndpointPatch struct {
	URL         *string
	Description *string
	Events      *[]string
	Enabled     *bool
}

// Update applies a patch. Changing the URL re-runs the SSRF validation, because
// an endpoint that was safe at creation is not evidence that its replacement is.
func (r *Registry) Update(accountID, endpointID string, patch EndpointPatch) (Endpoint, error) {
	if r.initError != nil {
		return Endpoint{}, r.initError
	}
	var validatedURL string
	if patch.URL != nil {
		parsed, err := r.guard.ValidateURL(*patch.URL)
		if err != nil {
			return Endpoint{}, err
		}
		validatedURL = parsed.String()
	}
	var validatedEvents []string
	if patch.Events != nil {
		normalized, err := normalizeEvents(*patch.Events)
		if err != nil {
			return Endpoint{}, err
		}
		validatedEvents = normalized
	}
	var validatedDescription string
	if patch.Description != nil {
		description, err := validateDescription(*patch.Description)
		if err != nil {
			return Endpoint{}, err
		}
		validatedDescription = description
	}
	r.mutex.Lock()
	defer r.mutex.Unlock()
	index, err := r.findEndpointLocked(accountID, endpointID)
	if err != nil {
		return Endpoint{}, err
	}
	previous := r.state.Endpoints[index].Clone()
	endpoint := &r.state.Endpoints[index]
	if patch.URL != nil {
		endpoint.URL = validatedURL
	}
	if patch.Events != nil {
		endpoint.Events = validatedEvents
	}
	if patch.Description != nil {
		endpoint.Description = validatedDescription
	}
	if patch.Enabled != nil {
		endpoint.Enabled = *patch.Enabled
	}
	// Any deliberate edit clears the circuit breaker: the customer has just told
	// us something changed, so give the endpoint a fresh chance immediately.
	endpoint.ConsecutiveFailures = 0
	endpoint.SuspendedUntil = nil
	endpoint.UpdatedAt = r.now()
	if err := r.save(); err != nil {
		r.state.Endpoints[index] = previous
		return Endpoint{}, err
	}
	return endpoint.Public(), nil
}

// Delete removes an endpoint and everything queued or logged against it.
func (r *Registry) Delete(accountID, endpointID string) error {
	if r.initError != nil {
		return r.initError
	}
	r.mutex.Lock()
	defer r.mutex.Unlock()
	index, err := r.findEndpointLocked(accountID, endpointID)
	if err != nil {
		return err
	}
	removedEndpoints := append([]Endpoint(nil), r.state.Endpoints...)
	removedDeliveries := append([]Delivery(nil), r.state.Deliveries...)
	r.state.Endpoints = append(r.state.Endpoints[:index], r.state.Endpoints[index+1:]...)
	kept := r.state.Deliveries[:0]
	for _, delivery := range r.state.Deliveries {
		if delivery.EndpointID != endpointID {
			kept = append(kept, delivery)
		}
	}
	r.state.Deliveries = kept
	if err := r.save(); err != nil {
		r.state.Endpoints = removedEndpoints
		r.state.Deliveries = removedDeliveries
		return err
	}
	return nil
}

// RotateSecret issues a new signing secret and returns it once.
func (r *Registry) RotateSecret(accountID, endpointID string) (string, error) {
	if r.initError != nil {
		return "", r.initError
	}
	secret, err := newSecret()
	if err != nil {
		return "", err
	}
	r.mutex.Lock()
	defer r.mutex.Unlock()
	index, err := r.findEndpointLocked(accountID, endpointID)
	if err != nil {
		return "", err
	}
	previous := r.state.Endpoints[index].Secret
	r.state.Endpoints[index].Secret = secret
	r.state.Endpoints[index].UpdatedAt = r.now()
	if err := r.save(); err != nil {
		r.state.Endpoints[index].Secret = previous
		return "", err
	}
	return secret, nil
}

// Deliveries returns the delivery log for one endpoint, newest first, without
// payload bytes.
func (r *Registry) Deliveries(accountID, endpointID string, limit int) ([]Delivery, error) {
	if r.initError != nil {
		return nil, r.initError
	}
	if limit <= 0 || limit > maxDeliveriesPerEndpoint {
		limit = maxDeliveriesPerEndpoint
	}
	r.mutex.Lock()
	defer r.mutex.Unlock()
	if _, err := r.findEndpointLocked(accountID, endpointID); err != nil {
		return nil, err
	}
	deliveries := make([]Delivery, 0, limit)
	for _, delivery := range r.state.Deliveries {
		if delivery.EndpointID == endpointID && delivery.AccountID == accountID {
			deliveries = append(deliveries, delivery.Public())
		}
	}
	sortDeliveriesNewestFirst(deliveries)
	if len(deliveries) > limit {
		deliveries = deliveries[:limit]
	}
	return deliveries, nil
}

// ------------------------------------------------------------------- enqueueing

// Event is one thing that happened in an account, ready to be serialised.
type Event struct {
	ID        string
	Type      string
	AccountID string
	CreatedAt time.Time
	Data      map[string]any
}

// Enqueue queues an event for every endpoint of the account that is enabled and
// subscribed to it. It returns without any network I/O, so a caller on the
// request path is never made to wait for a customer's server.
func (r *Registry) Enqueue(event Event) {
	if r.initError != nil {
		return
	}
	body, err := json.Marshal(map[string]any{
		"id":         event.ID,
		"type":       event.Type,
		"account_id": event.AccountID,
		"created_at": event.CreatedAt.UTC(),
		"data":       event.Data,
	})
	if err != nil {
		r.options.Logger.Error("outbound event could not be encoded", "event", event.Type)
		return
	}
	now := r.now()
	queued := false
	r.mutex.Lock()
	for _, endpoint := range r.state.Endpoints {
		if endpoint.AccountID != event.AccountID || !endpoint.Enabled || !endpoint.subscribed(event.Type) {
			continue
		}
		if endpoint.SuspendedUntil != nil && endpoint.SuspendedUntil.After(now) {
			continue
		}
		if r.pendingCountLocked(endpoint.ID) >= maxPendingPerEndpoint {
			r.options.Logger.Warn("outbound queue is full for an endpoint; dropping event", "endpoint_id", endpoint.ID, "event", event.Type)
			continue
		}
		identifier, err := security.RandomToken(12)
		if err != nil {
			continue
		}
		attemptAt := now
		r.state.Deliveries = append(r.state.Deliveries, Delivery{
			ID:            "whdl_" + identifier,
			AccountID:     event.AccountID,
			EndpointID:    endpoint.ID,
			Event:         event.Type,
			EventID:       event.ID,
			Status:        StatusPending,
			NextAttemptAt: &attemptAt,
			CreatedAt:     now,
			UpdatedAt:     now,
			Payload:       body,
		})
		queued = true
	}
	if queued {
		if err := r.save(); err != nil {
			r.options.Logger.Error("outbound queue could not be persisted", "error", err)
		}
	}
	r.mutex.Unlock()
	if queued {
		r.signal()
	}
}

// SendTest queues the one-off event behind the "send test event" button.
func (r *Registry) SendTest(accountID, endpointID string) (Delivery, error) {
	if r.initError != nil {
		return Delivery{}, r.initError
	}
	r.mutex.Lock()
	index, err := r.findEndpointLocked(accountID, endpointID)
	if err != nil {
		r.mutex.Unlock()
		return Delivery{}, err
	}
	endpoint := r.state.Endpoints[index].Clone()
	// A test send is an explicit instruction from the customer, so it also clears
	// a suspension: it is exactly how someone confirms they have fixed their
	// endpoint.
	r.state.Endpoints[index].SuspendedUntil = nil
	r.state.Endpoints[index].ConsecutiveFailures = 0
	r.mutex.Unlock()
	if !endpoint.Enabled {
		return Delivery{}, invalid("this endpoint is disabled")
	}
	identifier, err := security.RandomToken(12)
	if err != nil {
		return Delivery{}, err
	}
	event := Event{
		ID:        "evt_" + identifier,
		Type:      EventTest,
		AccountID: accountID,
		CreatedAt: r.now(),
		Data:      map[string]any{"message": "This is a test event from Garuda.", "endpoint_id": endpointID},
	}
	r.Enqueue(event)
	r.mutex.Lock()
	defer r.mutex.Unlock()
	for index := len(r.state.Deliveries) - 1; index >= 0; index-- {
		if r.state.Deliveries[index].EventID == event.ID && r.state.Deliveries[index].EndpointID == endpointID {
			return r.state.Deliveries[index].Public(), nil
		}
	}
	return Delivery{}, errors.New("the test event could not be queued")
}

// --------------------------------------------------------------------- delivery

// Drain attempts every delivery that is due, up to a bounded batch, with bounded
// concurrency. It is called by the worker and directly by tests.
func (r *Registry) Drain(ctx context.Context) {
	if r.initError != nil {
		return
	}
	now := r.now()
	type work struct {
		delivery Delivery
		endpoint Endpoint
	}
	var batch []work
	r.mutex.Lock()
	for _, delivery := range r.state.Deliveries {
		if delivery.Status != StatusPending || r.inFlight[delivery.ID] {
			continue
		}
		if delivery.NextAttemptAt != nil && delivery.NextAttemptAt.After(now) {
			continue
		}
		index, err := r.findEndpointLocked(delivery.AccountID, delivery.EndpointID)
		if err != nil {
			continue
		}
		endpoint := r.state.Endpoints[index]
		if !endpoint.Enabled {
			continue
		}
		r.inFlight[delivery.ID] = true
		batch = append(batch, work{delivery: delivery.Clone(), endpoint: endpoint.Clone()})
		if len(batch) >= 32 {
			break
		}
	}
	r.mutex.Unlock()
	if len(batch) == 0 {
		return
	}

	type outcome struct {
		deliveryID     string
		endpointID     string
		responseStatus int
		err            error
		permanent      bool
	}
	outcomes := make([]outcome, len(batch))
	semaphore := make(chan struct{}, maxConcurrentDeliveries)
	var waitGroup sync.WaitGroup
	for position := range batch {
		waitGroup.Add(1)
		go func(position int) {
			defer waitGroup.Done()
			semaphore <- struct{}{}
			defer func() { <-semaphore }()
			status, permanent, err := r.send(ctx, batch[position].endpoint, batch[position].delivery)
			outcomes[position] = outcome{
				deliveryID:     batch[position].delivery.ID,
				endpointID:     batch[position].endpoint.ID,
				responseStatus: status,
				err:            err,
				permanent:      permanent,
			}
		}(position)
	}
	waitGroup.Wait()

	completedAt := r.now()
	r.mutex.Lock()
	for _, result := range outcomes {
		delete(r.inFlight, result.deliveryID)
		r.recordOutcomeLocked(result.deliveryID, result.endpointID, result.responseStatus, result.err, result.permanent, completedAt)
	}
	if err := r.save(); err != nil {
		r.options.Logger.Error("outbound delivery log could not be persisted", "error", err)
	}
	r.mutex.Unlock()
}

// recordOutcomeLocked folds one attempt into the delivery row and the endpoint's
// health counters. The caller must hold r.mutex.
func (r *Registry) recordOutcomeLocked(deliveryID, endpointID string, responseStatus int, sendError error, permanent bool, now time.Time) {
	deliveryIndex := -1
	for index := range r.state.Deliveries {
		if r.state.Deliveries[index].ID == deliveryID {
			deliveryIndex = index
			break
		}
	}
	if deliveryIndex < 0 {
		return
	}
	delivery := &r.state.Deliveries[deliveryIndex]
	delivery.Attempts++
	delivery.ResponseStatus = responseStatus
	delivery.UpdatedAt = now
	endpointIndex := -1
	for index := range r.state.Endpoints {
		if r.state.Endpoints[index].ID == endpointID {
			endpointIndex = index
			break
		}
	}
	if sendError == nil {
		delivery.Status = StatusDelivered
		delivery.LastError = ""
		delivery.NextAttemptAt = nil
		delivered := now
		delivery.DeliveredAt = &delivered
		// The payload is only kept so a retry survives a restart. Once delivered it
		// is dead weight holding a visitor's contact details on disk.
		delivery.Payload = nil
		if endpointIndex >= 0 {
			r.state.Endpoints[endpointIndex].ConsecutiveFailures = 0
			r.state.Endpoints[endpointIndex].SuspendedUntil = nil
			succeeded := now
			r.state.Endpoints[endpointIndex].LastSuccessAt = &succeeded
		}
		r.pruneDeliveriesLocked(endpointID)
		return
	}
	delivery.LastError = truncateError(sendError.Error())
	if endpointIndex >= 0 {
		failed := now
		r.state.Endpoints[endpointIndex].LastFailureAt = &failed
	}
	retriesLeft := delivery.Attempts <= len(r.options.Backoff)
	if !permanent && retriesLeft {
		next := now.Add(r.options.Backoff[delivery.Attempts-1])
		delivery.NextAttemptAt = &next
		return
	}
	delivery.Status = StatusFailed
	delivery.NextAttemptAt = nil
	delivery.Payload = nil
	if endpointIndex >= 0 {
		endpoint := &r.state.Endpoints[endpointIndex]
		endpoint.ConsecutiveFailures++
		if endpoint.ConsecutiveFailures >= suspendAfterFailures {
			suspendedUntil := now.Add(suspensionWindow)
			endpoint.SuspendedUntil = &suspendedUntil
		}
	}
	r.pruneDeliveriesLocked(endpointID)
}

// send posts one delivery. It returns the response status, the failure if there
// was one, and whether that failure is permanent.
func (r *Registry) send(ctx context.Context, endpoint Endpoint, delivery Delivery) (responseStatus int, permanent bool, sendError error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint.URL, bytes.NewReader(delivery.Payload))
	if err != nil {
		return 0, true, err
	}
	timestamp := r.now()
	request.Header.Set("Content-Type", "application/json; charset=utf-8")
	request.Header.Set("User-Agent", "Garuda-Webhooks/1")
	request.Header.Set("Garuda-Event", delivery.Event)
	request.Header.Set("Garuda-Event-Id", delivery.EventID)
	request.Header.Set("Garuda-Delivery-Id", delivery.ID)
	request.Header.Set("Garuda-Delivery-Attempt", strconv.Itoa(delivery.Attempts+1))
	request.Header.Set("Garuda-Signature", Sign(endpoint.Secret, timestamp, delivery.Payload))
	response, err := r.client.Do(request)
	if err != nil {
		// A blocked destination is not worth five retries: the URL is wrong, not
		// the network. Everything else -- timeouts, resets, TLS trouble -- is
		// exactly what retries are for.
		return 0, errors.Is(err, ErrDestinationBlocked), withoutURL(err)
	}
	defer response.Body.Close()
	// Read a little of the body so the connection can be reused within this
	// request and so a chatty endpoint cannot stream at us indefinitely.
	_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4<<10))
	if response.StatusCode >= 200 && response.StatusCode < 300 {
		return response.StatusCode, false, nil
	}
	// 410 Gone is the documented way for an endpoint to say "stop sending".
	gone := response.StatusCode == http.StatusGone
	return response.StatusCode, gone, fmt.Errorf("endpoint responded with status %d", response.StatusCode)
}

// Sign produces the Garuda-Signature header value for a body.
//
// The shape is Stripe's, deliberately: "t=<unix>,v1=<hex HMAC-SHA256 of
// "<t>.<body>">". internal/billing/stripe.go already verifies exactly this
// format for inbound Stripe events, so customers can reuse any Stripe webhook
// verifier, and TestSignatureVerifiesWithTheStripeVerifier feeds our output to
// that verifier to prove the two agree.
func Sign(secret string, timestamp time.Time, body []byte) string {
	seconds := strconv.FormatInt(timestamp.Unix(), 10)
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(seconds))
	_, _ = mac.Write([]byte("."))
	_, _ = mac.Write(body)
	return "t=" + seconds + ",v1=" + hex.EncodeToString(mac.Sum(nil))
}

// withoutURL strips the request URL out of an http.Client failure before it is
// stored in the delivery log.
//
// A webhook URL is frequently a bearer credential in its own right -- a Zapier
// catch hook or a Make custom webhook is "anyone who knows this URL can post to
// it" -- and *url.Error prints the whole URL, path included. Keeping only the
// inner cause keeps that string out of the persisted log while leaving the part
// that actually helps ("connection refused", "certificate has expired").
func withoutURL(err error) error {
	var requestError *url.Error
	if errors.As(err, &requestError) && requestError.Err != nil {
		return requestError.Err
	}
	return err
}

func newSecret() (string, error) {
	token, err := security.RandomToken(32)
	if err != nil {
		return "", err
	}
	return "whsec_" + token, nil
}

func validateDescription(description string) (string, error) {
	trimmed := strings.TrimSpace(description)
	if len(trimmed) > maxDescriptionLength {
		return "", invalidf("the description must be %d characters or fewer", maxDescriptionLength)
	}
	return trimmed, nil
}
