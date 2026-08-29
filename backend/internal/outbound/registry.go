// Package outbound delivers account-scoped webhooks to customer-supplied URLs.
//
// WHY THIS AND NOT NATIVE CRM ADAPTERS. The product needs "every CRM". Building
// one adapter per CRM does not converge -- each is an OAuth app, a field mapping,
// a rate limit and a support burden that never stops growing. One well-guarded
// outbound webhook reaches Zapier, Make, n8n, Pipedream and any CRM that accepts
// an HTTP POST, which is every CRM worth naming, and it costs one endpoint with
// no vendor in the path.
//
// SIGNATURES. The payload is signed exactly the way Stripe signs its webhooks:
// header "Garuda-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256>", computed over
// "<t>.<raw request body>" with the endpoint's own secret. That shape was chosen
// because this repository already verifies it -- see VerifyEvent in
// internal/billing/stripe.go -- so the format is one every integration platform
// and most CRM developers have written a verifier for at least once, and our own
// code proves the scheme round-trips. Verifiers must compare the raw body bytes,
// not a re-encoding of the parsed JSON, and must reject a timestamp outside a few
// minutes of now to stop replay.
//
// PERSISTENCE. Endpoints and the delivery log live in their own JSON file beside
// the main data file rather than in model.State. That keeps model.SchemaVersion
// untouched, and it keeps a queue that is rewritten on every delivery attempt out
// of the file that holds accounts and conversations.
package outbound

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// Event types a customer may subscribe an endpoint to.
const (
	EventLeadCreated         = "lead.created"
	EventConversationStarted = "conversation.started"
	EventConversationEnded   = "conversation.ended"
	// EventTest is sent only by the "send test event" button. It is never
	// subscribable, and it is delivered to its endpoint whatever that endpoint is
	// subscribed to, because its whole purpose is to prove the wiring works.
	EventTest = "webhook.test"
)

// SubscribableEvents is the catalogue the settings screen offers.
var SubscribableEvents = []string{EventLeadCreated, EventConversationStarted, EventConversationEnded}

// Delivery statuses.
const (
	StatusPending   = "pending"
	StatusDelivered = "delivered"
	StatusFailed    = "failed"
)

const (
	maxEndpointsPerAccount   = 10
	maxDeliveriesPerEndpoint = 50
	// maxPendingPerEndpoint stops a customer endpoint that has been down for a
	// week from growing the queue without bound. Past this, new events for that
	// endpoint are dropped rather than queued: the delivery log already shows the
	// failures, and a broken customer endpoint must never cost us disk.
	maxPendingPerEndpoint = 200
	// suspendAfterFailures / suspensionWindow are the circuit breaker. An endpoint
	// that has exhausted its retries this many times in a row stops being enqueued
	// at all for a while, so a dead endpoint costs one connection an hour instead
	// of one per event.
	suspendAfterFailures    = 5
	suspensionWindow        = time.Hour
	maxDescriptionLength    = 200
	maxErrorLength          = 300
	maxConcurrentDeliveries = 4
)

var (
	// ErrNotFound is returned for an endpoint that does not exist OR belongs to
	// another account. The caller turns both into 404: a tenant must not be able
	// to tell the difference.
	ErrNotFound = errors.New("webhook endpoint not found")
	// ErrTooManyEndpoints caps what one account can register.
	ErrTooManyEndpoints = invalidf("an account may register at most %d webhook endpoints", maxEndpointsPerAccount)
)

// ValidationError is a failure the customer caused and can fix, carrying a
// message written for them. The api package turns it into a 422 and shows the
// message; anything else becomes a 500 with no detail, because anything else is
// our fault and its text is not for the customer.
type ValidationError struct {
	Message string
}

func (e ValidationError) Error() string { return e.Message }

func invalid(message string) error { return ValidationError{Message: message} }

func invalidf(format string, args ...any) error {
	return ValidationError{Message: fmt.Sprintf(format, args...)}
}

// Endpoint is one customer-registered webhook destination.
type Endpoint struct {
	ID          string   `json:"id"`
	AccountID   string   `json:"account_id"`
	URL         string   `json:"url"`
	Description string   `json:"description,omitempty"`
	Events      []string `json:"events"`
	Enabled     bool     `json:"enabled"`
	// Secret is the HMAC key. It has to be stored in a form we can sign with, so
	// it is stored as issued. It is shown to the customer exactly once, at
	// creation and at rotation, and Public() strips it from everything the API
	// ever returns afterwards.
	Secret              string     `json:"secret"`
	ConsecutiveFailures int        `json:"consecutive_failures,omitempty"`
	SuspendedUntil      *time.Time `json:"suspended_until,omitempty"`
	LastSuccessAt       *time.Time `json:"last_success_at,omitempty"`
	LastFailureAt       *time.Time `json:"last_failure_at,omitempty"`
	CreatedAt           time.Time  `json:"created_at"`
	UpdatedAt           time.Time  `json:"updated_at"`
}

// Clone deep-copies an endpoint so a value handed to a caller never aliases the
// slice held under the registry mutex.
func (e Endpoint) Clone() Endpoint {
	copied := e
	if e.Events != nil {
		copied.Events = append([]string(nil), e.Events...)
	}
	if e.SuspendedUntil != nil {
		suspended := *e.SuspendedUntil
		copied.SuspendedUntil = &suspended
	}
	if e.LastSuccessAt != nil {
		succeeded := *e.LastSuccessAt
		copied.LastSuccessAt = &succeeded
	}
	if e.LastFailureAt != nil {
		failed := *e.LastFailureAt
		copied.LastFailureAt = &failed
	}
	return copied
}

// Public is Clone with the signing secret removed. Every read path returns this.
func (e Endpoint) Public() Endpoint {
	copied := e.Clone()
	copied.Secret = ""
	return copied
}

// Delivery is one attempt series for one event against one endpoint, and it is
// what the customer sees in the delivery log.
type Delivery struct {
	ID             string     `json:"id"`
	AccountID      string     `json:"account_id"`
	EndpointID     string     `json:"endpoint_id"`
	Event          string     `json:"event"`
	EventID        string     `json:"event_id"`
	Status         string     `json:"status"`
	Attempts       int        `json:"attempts"`
	ResponseStatus int        `json:"response_status,omitempty"`
	LastError      string     `json:"last_error,omitempty"`
	NextAttemptAt  *time.Time `json:"next_attempt_at,omitempty"`
	DeliveredAt    *time.Time `json:"delivered_at,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
	// Payload is the exact bytes that are signed and posted. It is persisted so a
	// restart does not lose a queued retry, and it is stripped by Public() because
	// a lead payload carries the visitor's contact details and the delivery log is
	// a diagnostics view, not a second copy of the CRM record.
	Payload []byte `json:"payload,omitempty"`
}

func (d Delivery) Clone() Delivery {
	copied := d
	if d.Payload != nil {
		copied.Payload = append([]byte(nil), d.Payload...)
	}
	if d.NextAttemptAt != nil {
		next := *d.NextAttemptAt
		copied.NextAttemptAt = &next
	}
	if d.DeliveredAt != nil {
		delivered := *d.DeliveredAt
		copied.DeliveredAt = &delivered
	}
	return copied
}

// Public is Clone without the payload bytes.
func (d Delivery) Public() Delivery {
	copied := d.Clone()
	copied.Payload = nil
	return copied
}

// watermark records how far the event scan has read. IDs holds the identifiers
// whose timestamp is exactly At, which is what makes the scan exact rather than
// approximate: two leads created in the same instant cannot make the second one
// vanish, and neither can be emitted twice. It stays small because only ties on
// the newest instant are ever kept.
type watermark struct {
	At  time.Time `json:"at"`
	IDs []string  `json:"ids,omitempty"`
}

func (w watermark) seen(identifier string, createdAt time.Time) bool {
	if createdAt.After(w.At) {
		return false
	}
	if createdAt.Before(w.At) {
		return true
	}
	for _, seen := range w.IDs {
		if seen == identifier {
			return true
		}
	}
	return false
}

// advance folds one emitted item into the watermark.
func (w watermark) advance(identifier string, createdAt time.Time) watermark {
	switch {
	case createdAt.After(w.At):
		return watermark{At: createdAt, IDs: []string{identifier}}
	case createdAt.Equal(w.At):
		return watermark{At: w.At, IDs: append(append([]string(nil), w.IDs...), identifier)}
	default:
		return w
	}
}

// persistedState is the whole on-disk file.
type persistedState struct {
	Version                    int                  `json:"version"`
	Endpoints                  []Endpoint           `json:"endpoints"`
	Deliveries                 []Delivery           `json:"deliveries"`
	LeadWatermark              watermark            `json:"lead_watermark"`
	ConversationStartWatermark watermark            `json:"conversation_start_watermark"`
	EndedConversations         map[string]time.Time `json:"ended_conversations,omitempty"`
}

const persistedVersion = 1

func (r *Registry) load() error {
	r.state = persistedState{Version: persistedVersion, EndedConversations: map[string]time.Time{}}
	if r.options.Path == "" {
		// Memory-only. Used by tests and by any deployment without a data file.
		r.state.LeadWatermark = watermark{At: r.now()}
		r.state.ConversationStartWatermark = watermark{At: r.now()}
		return nil
	}
	file, err := os.Open(r.options.Path)
	if errors.Is(err, os.ErrNotExist) {
		// First run. Start both watermarks at now: an account that installs this
		// feature today wants the events from today, not its entire history
		// replayed into a CRM in one burst.
		r.state.LeadWatermark = watermark{At: r.now()}
		r.state.ConversationStartWatermark = watermark{At: r.now()}
		return r.save()
	}
	if err != nil {
		return fmt.Errorf("open webhook file: %w", err)
	}
	decodeErr := json.NewDecoder(io.LimitReader(file, 64<<20)).Decode(&r.state)
	// Close before save() renames over this path. Windows refuses os.Rename while
	// a handle is open, which is the same reason store.OpenFile closes early.
	closeErr := file.Close()
	if decodeErr != nil {
		return fmt.Errorf("decode webhook file: %w", decodeErr)
	}
	if closeErr != nil {
		return fmt.Errorf("close webhook file: %w", closeErr)
	}
	if r.state.EndedConversations == nil {
		r.state.EndedConversations = map[string]time.Time{}
	}
	if r.state.LeadWatermark.At.IsZero() {
		r.state.LeadWatermark.At = r.now()
	}
	if r.state.ConversationStartWatermark.At.IsZero() {
		r.state.ConversationStartWatermark.At = r.now()
	}
	r.state.Version = persistedVersion
	return nil
}

// save writes the file atomically. The caller must hold r.mutex.
func (r *Registry) save() error {
	if r.options.Path == "" {
		return nil
	}
	directory := filepath.Dir(r.options.Path)
	if err := os.MkdirAll(directory, 0o750); err != nil {
		return fmt.Errorf("create webhook directory: %w", err)
	}
	temporary, err := os.CreateTemp(directory, ".garuda-outbound-*.tmp")
	if err != nil {
		return fmt.Errorf("create temporary webhook file: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	encoder := json.NewEncoder(temporary)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(&r.state); err != nil {
		temporary.Close()
		return fmt.Errorf("encode webhook file: %w", err)
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return fmt.Errorf("sync webhook file: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close temporary webhook file: %w", err)
	}
	if err := os.Rename(temporaryPath, r.options.Path); err != nil {
		return fmt.Errorf("replace webhook file: %w", err)
	}
	return nil
}

// findEndpointLocked resolves an endpoint from the AUTHENTICATED account plus the
// path id. A row belonging to another account is reported as missing, never as
// forbidden, so an id cannot be probed for existence across tenants.
func (r *Registry) findEndpointLocked(accountID, endpointID string) (int, error) {
	for index := range r.state.Endpoints {
		if r.state.Endpoints[index].ID == endpointID && r.state.Endpoints[index].AccountID == accountID {
			return index, nil
		}
	}
	return 0, ErrNotFound
}

// normalizeEvents validates and de-duplicates a subscription list.
func normalizeEvents(events []string) ([]string, error) {
	if len(events) == 0 {
		return nil, invalid("select at least one event to send")
	}
	if len(events) > len(SubscribableEvents) {
		return nil, invalid("the event list contains unknown events")
	}
	seen := map[string]bool{}
	normalized := make([]string, 0, len(events))
	for _, event := range events {
		event = strings.TrimSpace(event)
		valid := false
		for _, known := range SubscribableEvents {
			if event == known {
				valid = true
				break
			}
		}
		if !valid {
			return nil, invalidf("%q is not an event this API sends", event)
		}
		if seen[event] {
			continue
		}
		seen[event] = true
		normalized = append(normalized, event)
	}
	// Keep the catalogue order so two endpoints with the same subscription always
	// render identically.
	ordered := make([]string, 0, len(normalized))
	for _, known := range SubscribableEvents {
		if seen[known] {
			ordered = append(ordered, known)
		}
	}
	return ordered, nil
}

func (e Endpoint) subscribed(event string) bool {
	if event == EventTest {
		return true
	}
	for _, subscribed := range e.Events {
		if subscribed == event {
			return true
		}
	}
	return false
}

// pruneDeliveriesLocked keeps the log bounded per endpoint, newest first. Pending
// deliveries are never pruned -- dropping one would silently lose a retry -- so
// the cap is applied to settled rows only.
func (r *Registry) pruneDeliveriesLocked(endpointID string) {
	settled := 0
	for index := len(r.state.Deliveries) - 1; index >= 0; index-- {
		delivery := r.state.Deliveries[index]
		if delivery.EndpointID != endpointID || delivery.Status == StatusPending {
			continue
		}
		settled++
		if settled > maxDeliveriesPerEndpoint {
			r.state.Deliveries = append(r.state.Deliveries[:index], r.state.Deliveries[index+1:]...)
		}
	}
}

func (r *Registry) pendingCountLocked(endpointID string) int {
	pending := 0
	for _, delivery := range r.state.Deliveries {
		if delivery.EndpointID == endpointID && delivery.Status == StatusPending {
			pending++
		}
	}
	return pending
}

// sortDeliveriesNewestFirst orders a copied slice for display.
func sortDeliveriesNewestFirst(deliveries []Delivery) {
	sort.SliceStable(deliveries, func(first, second int) bool {
		return deliveries[first].CreatedAt.After(deliveries[second].CreatedAt)
	})
}

func truncateError(message string) string {
	message = strings.TrimSpace(message)
	if len(message) > maxErrorLength {
		return message[:maxErrorLength] + "..."
	}
	return message
}
