package outbound

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"garuda/backend/internal/billing"
	"garuda/backend/internal/model"
	"garuda/backend/internal/store"
)

type testClock struct {
	mutex   sync.Mutex
	current time.Time
}

func (c *testClock) Now() time.Time {
	c.mutex.Lock()
	defer c.mutex.Unlock()
	return c.current
}

func (c *testClock) Advance(by time.Duration) {
	c.mutex.Lock()
	c.current = c.current.Add(by)
	c.mutex.Unlock()
}

func newTestRegistry(t *testing.T, clock *testClock, options Options) *Registry {
	t.Helper()
	options.Now = clock.Now
	options.DisableBackground = true
	options.AllowPrivateDestinations = true
	options.Backoff = []time.Duration{time.Minute, time.Minute, time.Minute}
	options.HTTPTimeout = 3 * time.Second
	registry := New(options)
	t.Cleanup(registry.Close)
	return registry
}

// TestGuardRejectsPrivateDestinationsByDefault is the save-time half of the SSRF
// defence, and it is also the test that proves the tests-only escape hatch is off
// unless a test asks for it.
func TestGuardRejectsPrivateDestinationsByDefault(t *testing.T) {
	guard := newGuard(false)
	rejected := []string{
		"http://hooks.example.com/inbound",            // plaintext
		"https://127.0.0.1/inbound",                   // loopback literal
		"https://localhost/inbound",                   // loopback by name
		"https://10.0.0.7/inbound",                    // private
		"https://192.168.1.10/inbound",                // private
		"https://172.16.4.4/inbound",                  // private
		"https://169.254.169.254/latest/meta-data",    // cloud metadata
		"https://[::1]/inbound",                       // loopback, IPv6
		"https://[fd00::1]/inbound",                   // unique local
		"https://[::ffff:127.0.0.1]/inbound",          // loopback wearing an IPv6 hat
		"https://[2002:7f00:1::]/inbound",             // 6to4 wrapping 127.0.0.1
		"https://100.64.1.1/inbound",                  // carrier-grade NAT
		"https://build.internal/inbound",              // internal name
		"https://printer.local/inbound",               // mDNS name
		"https://intranet/inbound",                    // no dot at all
		"https://user:pass@hooks.example.com/inbound", // embedded credentials
		"https://hooks.example.com:8443/inbound",      // non-default port
		"ftp://hooks.example.com/inbound",             // not http at all
		"https://hooks.example.com/inbound#fragment",  // fragment
	}
	for _, candidate := range rejected {
		if _, err := guard.ValidateURL(candidate); err == nil {
			t.Fatalf("expected %q to be rejected", candidate)
		}
	}
	if _, err := guard.ValidateURL("https://hooks.zapier.com/hooks/catch/12345/abcdef/"); err != nil {
		t.Fatalf("expected a normal https endpoint to be accepted, got %v", err)
	}
	if _, err := guard.ValidateURL("https://hooks.example.com:443/inbound"); err != nil {
		t.Fatalf("expected an explicit :443 to be accepted, got %v", err)
	}
}

// TestGuardBlocksAtConnectTimeNotJustAtSaveTime is the DNS-rebinding case. The
// hostname passes every name-based check, and the answer only becomes
// unacceptable once it is resolved -- which is the whole point of resolving
// inside the dialer and checking again in Control.
func TestGuardBlocksAtConnectTimeNotJustAtSaveTime(t *testing.T) {
	guard := newGuard(false)
	// "localhost" is a name whose ADDRESS is the problem. dialContext must resolve
	// it and refuse, rather than handing the name to the transport. The assertion
	// is on the reason, not just on failure: a connection error would mean the
	// dial was attempted, which is exactly the bug this layer exists to prevent.
	if _, err := guard.dialContext(context.Background(), "tcp", "localhost:443"); !errors.Is(err, ErrDestinationBlocked) {
		t.Fatalf("expected the dialer to refuse a host that resolves to loopback, got %v", err)
	}
	if _, err := guard.dialContext(context.Background(), "tcp", "127.0.0.1:443"); !errors.Is(err, ErrDestinationBlocked) {
		t.Fatalf("expected the dialer to refuse a loopback literal, got %v", err)
	}
	// Control is the last line: it sees only the address the kernel is about to
	// use, so a private address arriving by any route is still refused.
	if err := guard.control("tcp", "169.254.169.254:443", nil); !errors.Is(err, ErrDestinationBlocked) {
		t.Fatalf("expected Control to refuse the cloud metadata address, got %v", err)
	}
	if err := guard.control("tcp", "10.1.2.3:443", nil); !errors.Is(err, ErrDestinationBlocked) {
		t.Fatalf("expected Control to refuse a private address, got %v", err)
	}
	if err := guard.control("tcp", "93.184.216.34:443", nil); err != nil {
		t.Fatalf("expected Control to allow a public address, got %v", err)
	}
}

// TestGuardRefusesRedirectsAwayFromPublicHTTPS covers the fourth layer: an
// endpoint that is itself fine must not be able to bounce the delivery inward.
func TestGuardRefusesRedirectsAwayFromPublicHTTPS(t *testing.T) {
	guard := newGuard(false)
	for _, target := range []string{"http://hooks.example.com/inbound", "https://169.254.169.254/", "https://10.0.0.5/"} {
		request := httptest.NewRequest(http.MethodPost, target, nil)
		if err := guard.checkRedirect(request, nil); err == nil {
			t.Fatalf("expected a redirect to %q to be refused", target)
		}
	}
	request := httptest.NewRequest(http.MethodPost, "https://hooks.example.com/moved", nil)
	if err := guard.checkRedirect(request, nil); err != nil {
		t.Fatalf("expected a public https redirect to be allowed, got %v", err)
	}
	if err := guard.checkRedirect(request, make([]*http.Request, maxRedirects)); err == nil {
		t.Fatal("expected the redirect chain to be capped")
	}
}

// TestSignatureVerifiesWithTheStripeVerifier proves the claim made in the docs:
// the header we send is the shape internal/billing/stripe.go already verifies, so
// any Stripe webhook verifier works on a Garuda webhook unchanged.
func TestSignatureVerifiesWithTheStripeVerifier(t *testing.T) {
	secret := "whsec_test_secret_value"
	now := time.Unix(1_760_000_000, 0).UTC()
	body := []byte(`{"id":"evt_abc","type":"lead.created","data":{"lead":{"id":"lead_1"}}}`)
	header := Sign(secret, now, body)

	verifier := billing.NewStripe("", secret, "", "", "", "")
	event, err := verifier.VerifyEvent(body, header, now)
	if err != nil {
		t.Fatalf("the Stripe verifier rejected our signature: %v", err)
	}
	if event.ID != "evt_abc" || event.Type != "lead.created" {
		t.Fatalf("unexpected event decoded: %+v", event)
	}
	if _, err := verifier.VerifyEvent(append(body, ' '), header, now); err == nil {
		t.Fatal("expected a tampered body to fail verification")
	}
	if _, err := verifier.VerifyEvent(body, Sign("another-secret", now, body), now); err == nil {
		t.Fatal("expected a signature from the wrong secret to fail verification")
	}
	if _, err := verifier.VerifyEvent(body, header, now.Add(10*time.Minute)); err == nil {
		t.Fatal("expected an old timestamp to fail verification")
	}
}

// TestDeliveryRetriesWithBackoffThenSucceeds covers the retry schedule and the
// delivery log the customer reads.
func TestDeliveryRetriesWithBackoffThenSucceeds(t *testing.T) {
	var attempts int32
	var signatures []string
	var bodies [][]byte
	var mutex sync.Mutex
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		count := atomic.AddInt32(&attempts, 1)
		body := make([]byte, r.ContentLength)
		_, _ = r.Body.Read(body)
		mutex.Lock()
		signatures = append(signatures, r.Header.Get("Garuda-Signature"))
		bodies = append(bodies, body)
		mutex.Unlock()
		if count < 3 {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()

	clock := &testClock{current: time.Unix(1_760_000_000, 0).UTC()}
	registry := newTestRegistry(t, clock, Options{})
	endpoint, secret, err := registry.Create("acct_1", server.URL, "Zapier", []string{EventLeadCreated})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	registry.Enqueue(Event{ID: "evt_1", Type: EventLeadCreated, AccountID: "acct_1", CreatedAt: clock.Now(), Data: map[string]any{"lead": map[string]any{"id": "lead_1"}}})

	registry.Drain(context.Background())
	deliveries, err := registry.Deliveries("acct_1", endpoint.ID, 0)
	if err != nil || len(deliveries) != 1 {
		t.Fatalf("expected one delivery, got %d (%v)", len(deliveries), err)
	}
	if deliveries[0].Status != StatusPending || deliveries[0].Attempts != 1 {
		t.Fatalf("expected a pending delivery on attempt 1, got %+v", deliveries[0])
	}
	if deliveries[0].ResponseStatus != http.StatusInternalServerError {
		t.Fatalf("expected the 500 to be recorded, got %d", deliveries[0].ResponseStatus)
	}
	if deliveries[0].NextAttemptAt == nil || !deliveries[0].NextAttemptAt.After(clock.Now()) {
		t.Fatal("expected the failed attempt to be scheduled for later, which is what backoff means")
	}
	// The queued payload still exists internally so the retry can send it, but the
	// log view must not hand back a visitor's contact details.
	if deliveries[0].Payload != nil {
		t.Fatal("a pending delivery must not expose its payload through the log")
	}

	// Before the backoff elapses nothing is retried.
	registry.Drain(context.Background())
	if atomic.LoadInt32(&attempts) != 1 {
		t.Fatalf("expected backoff to hold the retry, saw %d attempts", atomic.LoadInt32(&attempts))
	}

	clock.Advance(2 * time.Minute)
	registry.Drain(context.Background())
	clock.Advance(2 * time.Minute)
	registry.Drain(context.Background())

	deliveries, _ = registry.Deliveries("acct_1", endpoint.ID, 0)
	if len(deliveries) != 1 || deliveries[0].Status != StatusDelivered {
		t.Fatalf("expected the third attempt to succeed, got %+v", deliveries[0])
	}
	if deliveries[0].Attempts != 3 {
		t.Fatalf("expected three attempts to be recorded, got %d", deliveries[0].Attempts)
	}
	if deliveries[0].Payload != nil {
		t.Fatal("the delivery log must never hand back the payload bytes")
	}

	mutex.Lock()
	defer mutex.Unlock()
	if len(signatures) != 3 {
		t.Fatalf("expected three signed requests, got %d", len(signatures))
	}
	verifier := billing.NewStripe("", secret, "", "", "", "")
	if _, err := verifier.VerifyEvent(bodies[0], signatures[0], clock.Now()); err != nil {
		t.Fatalf("the delivered body did not verify against the endpoint secret: %v", err)
	}
}

// TestExhaustedEndpointFailsAndIsSuspended proves a dead customer endpoint costs
// a bounded amount of work and never grows the queue without limit.
func TestExhaustedEndpointFailsAndIsSuspended(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
	}))
	defer server.Close()

	clock := &testClock{current: time.Unix(1_760_000_000, 0).UTC()}
	registry := newTestRegistry(t, clock, Options{})
	endpoint, _, err := registry.Create("acct_1", server.URL, "", []string{EventLeadCreated})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	// Four attempt series, each exhausting one initial attempt plus three retries.
	for series := 0; series < suspendAfterFailures; series++ {
		registry.Enqueue(Event{ID: "evt", Type: EventLeadCreated, AccountID: "acct_1", CreatedAt: clock.Now()})
		for attempt := 0; attempt < 4; attempt++ {
			registry.Drain(context.Background())
			clock.Advance(2 * time.Minute)
		}
	}
	deliveries, _ := registry.Deliveries("acct_1", endpoint.ID, 0)
	if len(deliveries) != suspendAfterFailures {
		t.Fatalf("expected %d deliveries, got %d", suspendAfterFailures, len(deliveries))
	}
	for _, delivery := range deliveries {
		if delivery.Status != StatusFailed {
			t.Fatalf("expected every delivery to be failed, got %+v", delivery)
		}
		if delivery.Attempts != 4 {
			t.Fatalf("expected four attempts before giving up, got %d", delivery.Attempts)
		}
		if delivery.LastError == "" {
			t.Fatal("expected the last error to be recorded for the customer to read")
		}
	}
	stored, err := registry.Get("acct_1", endpoint.ID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if stored.SuspendedUntil == nil || !stored.SuspendedUntil.After(clock.Now()) {
		t.Fatalf("expected the endpoint to be suspended after %d failed series, got %+v", suspendAfterFailures, stored)
	}
	// A suspended endpoint stops consuming work entirely.
	registry.Enqueue(Event{ID: "evt_after", Type: EventLeadCreated, AccountID: "acct_1", CreatedAt: clock.Now()})
	after, _ := registry.Deliveries("acct_1", endpoint.ID, 0)
	if len(after) != len(deliveries) {
		t.Fatal("expected a suspended endpoint to stop being enqueued")
	}
}

// TestScanEmitsNewLeadsWithoutBackfilling covers the event source: what happened
// before the feature existed is not replayed, what happens after is delivered
// exactly once, and an account with no endpoint gets nothing.
func TestScanEmitsNewLeadsWithoutBackfilling(t *testing.T) {
	received := make(chan string, 8)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload struct {
			Type string `json:"type"`
			Data struct {
				Lead map[string]any `json:"lead"`
			} `json:"data"`
		}
		_ = json.NewDecoder(r.Body).Decode(&payload)
		received <- payload.Type + ":" + stringOf(payload.Data.Lead["id"])
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	dataStore, err := store.OpenFile(filepath.Join(t.TempDir(), "garuda.json"))
	if err != nil {
		t.Fatalf("OpenFile: %v", err)
	}
	clock := &testClock{current: time.Unix(1_760_000_000, 0).UTC()}
	// A lead that already existed when the feature was switched on.
	writeLead(t, dataStore, "lead_old", "acct_1", clock.Now().Add(-time.Hour))

	registry := newTestRegistry(t, clock, Options{Store: dataStore})
	if _, _, err := registry.Create("acct_1", server.URL, "", []string{EventLeadCreated}); err != nil {
		t.Fatalf("Create: %v", err)
	}
	registry.Scan()
	registry.Drain(context.Background())
	select {
	case unexpected := <-received:
		t.Fatalf("history must not be backfilled, but %q was delivered", unexpected)
	default:
	}

	clock.Advance(time.Minute)
	writeLead(t, dataStore, "lead_new", "acct_1", clock.Now())
	writeLead(t, dataStore, "lead_other_tenant", "acct_2", clock.Now())
	registry.Scan()
	registry.Drain(context.Background())

	select {
	case delivered := <-received:
		if delivered != EventLeadCreated+":lead_new" {
			t.Fatalf("unexpected delivery %q", delivered)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("expected the new lead to be delivered")
	}

	// A second scan must not repeat it, and another account's lead must never
	// reach this endpoint.
	registry.Scan()
	registry.Drain(context.Background())
	select {
	case repeated := <-received:
		t.Fatalf("expected no further deliveries, got %q", repeated)
	case <-time.After(200 * time.Millisecond):
	}
}

// TestScanEmitsConversationStartedAndEnded covers the two conversation events,
// including the idle rule that decides a conversation is over.
func TestScanEmitsConversationStartedAndEnded(t *testing.T) {
	events := make(chan string, 8)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		events <- r.Header.Get("Garuda-Event")
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	dataStore, err := store.OpenFile(filepath.Join(t.TempDir(), "garuda.json"))
	if err != nil {
		t.Fatalf("OpenFile: %v", err)
	}
	clock := &testClock{current: time.Unix(1_760_000_000, 0).UTC()}
	registry := newTestRegistry(t, clock, Options{Store: dataStore, IdleTimeout: 30 * time.Minute})
	if _, _, err := registry.Create("acct_1", server.URL, "", []string{EventConversationStarted, EventConversationEnded}); err != nil {
		t.Fatalf("Create: %v", err)
	}

	clock.Advance(time.Minute)
	startedAt := clock.Now()
	if err := dataStore.Update(func(state *model.State) error {
		state.Sessions = append(state.Sessions, model.Session{
			ID: "sess_1", AccountID: "acct_1", AgentID: "agent_1", VisitorID: "visitor_1",
			StartedAt: &startedAt, LastSeenAt: startedAt, CreatedAt: startedAt, UpdatedAt: startedAt,
		})
		state.Messages = append(state.Messages, model.Message{ID: "msg_1", AccountID: "acct_1", SessionID: "sess_1", Role: "user", Content: "hello", CreatedAt: startedAt})
		return nil
	}); err != nil {
		t.Fatalf("Update: %v", err)
	}

	registry.Scan()
	registry.Drain(context.Background())
	if got := waitForEvent(t, events); got != EventConversationStarted {
		t.Fatalf("expected conversation.started, got %q", got)
	}

	// Still inside the idle window: nothing has ended yet.
	clock.Advance(10 * time.Minute)
	registry.Scan()
	registry.Drain(context.Background())
	select {
	case premature := <-events:
		t.Fatalf("expected no event while the conversation is still fresh, got %q", premature)
	case <-time.After(200 * time.Millisecond):
	}

	clock.Advance(25 * time.Minute)
	registry.Scan()
	registry.Drain(context.Background())
	if got := waitForEvent(t, events); got != EventConversationEnded {
		t.Fatalf("expected conversation.ended, got %q", got)
	}

	// And it ends exactly once.
	clock.Advance(time.Hour)
	registry.Scan()
	registry.Drain(context.Background())
	select {
	case repeated := <-events:
		t.Fatalf("expected conversation.ended to fire once, got another %q", repeated)
	case <-time.After(200 * time.Millisecond):
	}
}

// TestStateSurvivesReopen proves a restart does not lose an endpoint or a queued
// retry, which is the reason the queue is persisted rather than held in memory.
func TestStateSurvivesReopen(t *testing.T) {
	directory := t.TempDir()
	path := filepath.Join(directory, "outbound.json")
	clock := &testClock{current: time.Unix(1_760_000_000, 0).UTC()}

	first := New(Options{Path: path, Now: clock.Now, DisableBackground: true, AllowPrivateDestinations: true})
	endpoint, _, err := first.Create("acct_1", "https://hooks.example.com/inbound", "Make", []string{EventLeadCreated})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	first.Enqueue(Event{ID: "evt_1", Type: EventLeadCreated, AccountID: "acct_1", CreatedAt: clock.Now()})
	first.Close()

	second := New(Options{Path: path, Now: clock.Now, DisableBackground: true, AllowPrivateDestinations: true})
	defer second.Close()
	endpoints, err := second.List("acct_1")
	if err != nil || len(endpoints) != 1 || endpoints[0].ID != endpoint.ID {
		t.Fatalf("expected the endpoint to survive a restart, got %+v (%v)", endpoints, err)
	}
	if endpoints[0].Secret != "" {
		t.Fatal("List must never return the signing secret")
	}
	deliveries, err := second.Deliveries("acct_1", endpoint.ID, 0)
	if err != nil || len(deliveries) != 1 || deliveries[0].Status != StatusPending {
		t.Fatalf("expected the queued delivery to survive a restart, got %+v (%v)", deliveries, err)
	}
}

// TestCrossTenantAccessIsNotFound is the multi-tenant rule at the registry level.
func TestCrossTenantAccessIsNotFound(t *testing.T) {
	clock := &testClock{current: time.Unix(1_760_000_000, 0).UTC()}
	registry := newTestRegistry(t, clock, Options{})
	endpoint, _, err := registry.Create("acct_1", "https://hooks.example.com/inbound", "", []string{EventLeadCreated})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if _, err := registry.Get("acct_2", endpoint.ID); err != ErrNotFound {
		t.Fatalf("expected ErrNotFound reading another tenant's endpoint, got %v", err)
	}
	if _, err := registry.Update("acct_2", endpoint.ID, EndpointPatch{Enabled: boolPointer(false)}); err != ErrNotFound {
		t.Fatalf("expected ErrNotFound updating another tenant's endpoint, got %v", err)
	}
	if err := registry.Delete("acct_2", endpoint.ID); err != ErrNotFound {
		t.Fatalf("expected ErrNotFound deleting another tenant's endpoint, got %v", err)
	}
	if _, err := registry.RotateSecret("acct_2", endpoint.ID); err != ErrNotFound {
		t.Fatalf("expected ErrNotFound rotating another tenant's secret, got %v", err)
	}
	if _, err := registry.Deliveries("acct_2", endpoint.ID, 0); err != ErrNotFound {
		t.Fatalf("expected ErrNotFound listing another tenant's deliveries, got %v", err)
	}
}

func boolPointer(value bool) *bool { return &value }

func stringOf(value any) string {
	text, _ := value.(string)
	return text
}

func waitForEvent(t *testing.T, events chan string) string {
	t.Helper()
	select {
	case event := <-events:
		return event
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for a webhook delivery")
		return ""
	}
}

func writeLead(t *testing.T, dataStore store.Store, leadID, accountID string, createdAt time.Time) {
	t.Helper()
	if err := dataStore.Update(func(state *model.State) error {
		state.Leads = append(state.Leads, model.Lead{
			ID: leadID, AccountID: accountID, AgentID: "agent_1", SessionID: "sess_1",
			Name: "Test Person", Email: "person@example.com", Status: "new", Source: "widget",
			CreatedAt: createdAt, UpdatedAt: createdAt,
		})
		return nil
	}); err != nil {
		t.Fatalf("Update: %v", err)
	}
}
