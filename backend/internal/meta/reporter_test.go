package meta

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

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

// recorder is a stand-in Conversions API that remembers what it was sent.
type recorder struct {
	mutex    sync.Mutex
	bodies   [][]byte
	status   int
	response string
}

func (rec *recorder) handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		rec.mutex.Lock()
		rec.bodies = append(rec.bodies, body)
		status, response := rec.status, rec.response
		rec.mutex.Unlock()
		if status == 0 {
			status = http.StatusOK
		}
		if response == "" {
			response = `{"events_received":1,"fbtrace_id":"trace"}`
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = w.Write([]byte(response))
	})
}

func (rec *recorder) count() int {
	rec.mutex.Lock()
	defer rec.mutex.Unlock()
	return len(rec.bodies)
}

func (rec *recorder) lastEventIDs(t *testing.T) []string {
	t.Helper()
	rec.mutex.Lock()
	defer rec.mutex.Unlock()
	if len(rec.bodies) == 0 {
		t.Fatal("nothing was sent")
	}
	var payload struct {
		Data []struct {
			EventName      string `json:"event_name"`
			EventID        string `json:"event_id"`
			EventSourceURL string `json:"event_source_url"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.bodies[len(rec.bodies)-1], &payload); err != nil {
		t.Fatalf("decode request: %v", err)
	}
	identifiers := make([]string, 0, len(payload.Data))
	for _, event := range payload.Data {
		if event.EventName != EventNameLead {
			t.Fatalf("event name: got %q, want %q", event.EventName, EventNameLead)
		}
		identifiers = append(identifiers, event.EventID)
	}
	return identifiers
}

func newTestStore(t *testing.T) store.Store {
	t.Helper()
	dataStore, err := store.OpenFile(filepath.Join(t.TempDir(), "garuda.json"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = dataStore.Close() })
	return dataStore
}

func writeLead(t *testing.T, dataStore store.Store, lead model.Lead) {
	t.Helper()
	if err := dataStore.Update(func(state *model.State) error {
		state.Leads = append(state.Leads, lead)
		return nil
	}); err != nil {
		t.Fatalf("write lead: %v", err)
	}
}

func writeSession(t *testing.T, dataStore store.Store, session model.Session) {
	t.Helper()
	if err := dataStore.Update(func(state *model.State) error {
		state.Sessions = append(state.Sessions, session)
		return nil
	}); err != nil {
		t.Fatalf("write session: %v", err)
	}
}

// TestReporterSendsEachLeadExactlyOnce is the hook working end to end: a lead
// committed to the store turns into one Lead conversion, carrying the event id
// the browser pixel will use, and a second pass sends nothing.
func TestReporterSendsEachLeadExactlyOnce(t *testing.T) {
	clock := &testClock{current: time.Date(2026, 8, 30, 9, 0, 0, 0, time.UTC)}
	provider := &recorder{}
	server := httptest.NewServer(provider.handler())
	defer server.Close()

	dataStore := newTestStore(t)
	statePath := filepath.Join(t.TempDir(), "meta-conversions.json")
	reporter := NewReporter(ReporterOptions{
		Client:            New(server.URL, "1234567890", "EAAtoken", ""),
		Store:             dataStore,
		Path:              statePath,
		Now:               clock.Now,
		DisableBackground: true,
	})
	defer reporter.Close()

	writeSession(t, dataStore, model.Session{ID: "sess_1", PageURL: "https://clinic.example.com/book?utm=meta"})
	writeLead(t, dataStore, model.Lead{
		ID: "lead_one", AccountID: "acct_1", SessionID: "sess_1",
		Name: "Mary Jane Watson", Email: "Mary@Example.COM", Phone: "+44 7700 900123",
		Status: "new", Source: "widget", CreatedAt: clock.Now().Add(time.Minute),
	})

	reporter.Scan(context.Background())
	if provider.count() != 1 {
		t.Fatalf("requests after first scan: got %d, want 1", provider.count())
	}
	identifiers := provider.lastEventIDs(t)
	if len(identifiers) != 1 || identifiers[0] != EventID("lead_one") {
		t.Fatalf("event ids: got %v, want [%s]", identifiers, EventID("lead_one"))
	}

	// The second pass is the one that matters. A lead already reported must not
	// be reported again, or the ad account counts it twice.
	reporter.Scan(context.Background())
	if provider.count() != 1 {
		t.Fatalf("a reported lead was sent again: %d requests", provider.count())
	}

	// A newer lead is picked up, and the older one is not carried along with it.
	writeLead(t, dataStore, model.Lead{
		ID: "lead_two", AccountID: "acct_1", SessionID: "sess_1",
		Email: "second@example.com", Status: "new", Source: "widget",
		CreatedAt: clock.Now().Add(2 * time.Minute),
	})
	reporter.Scan(context.Background())
	if provider.count() != 2 {
		t.Fatalf("requests after a new lead: got %d, want 2", provider.count())
	}
	identifiers = provider.lastEventIDs(t)
	if len(identifiers) != 1 || identifiers[0] != EventID("lead_two") {
		t.Fatalf("second batch event ids: got %v", identifiers)
	}
}

// TestReporterIsANoOpWhenDisabled is the degradation guarantee. With no
// credentials nothing is sent, nothing is read, and no file is created -- the
// product runs exactly as it does today.
func TestReporterIsANoOpWhenDisabled(t *testing.T) {
	clock := &testClock{current: time.Date(2026, 8, 30, 9, 0, 0, 0, time.UTC)}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("a disabled reporter reached the network")
	}))
	defer server.Close()

	dataStore := newTestStore(t)
	writeLead(t, dataStore, model.Lead{
		ID: "lead_one", AccountID: "acct_1", Email: "person@example.com",
		Status: "new", Source: "widget", CreatedAt: clock.Now().Add(time.Minute),
	})
	statePath := filepath.Join(t.TempDir(), "meta-conversions.json")

	// A pixel id with no access token is the half-filled .env case.
	reporter := NewReporter(ReporterOptions{
		Client:            New(server.URL, "1234567890", "", ""),
		Store:             dataStore,
		Path:              statePath,
		Now:               clock.Now,
		DisableBackground: true,
	})
	defer reporter.Close()

	if reporter.Enabled() {
		t.Fatal("a reporter with no access token reported itself as enabled")
	}
	reporter.Scan(context.Background())
	if _, err := os.Stat(statePath); !os.IsNotExist(err) {
		t.Fatalf("a disabled reporter wrote its state file: %v", err)
	}

	// A reporter with no store at all must also be inert rather than panic.
	inert := NewReporter(ReporterOptions{Client: New(server.URL, "1234567890", "EAAtoken", ""), Now: clock.Now, DisableBackground: true})
	defer inert.Close()
	if inert.Enabled() {
		t.Fatal("a reporter with no store reported itself as enabled")
	}
	inert.Scan(context.Background())
}

// TestReporterDoesNotReplayLeadsFromBeforeItStarted stops the morning the
// credentials land from reporting the whole back catalogue as today's
// conversions.
func TestReporterDoesNotReplayLeadsFromBeforeItStarted(t *testing.T) {
	clock := &testClock{current: time.Date(2026, 8, 30, 9, 0, 0, 0, time.UTC)}
	provider := &recorder{}
	server := httptest.NewServer(provider.handler())
	defer server.Close()

	dataStore := newTestStore(t)
	writeLead(t, dataStore, model.Lead{
		ID: "lead_ancient", AccountID: "acct_1", Email: "old@example.com",
		Status: "new", Source: "widget", CreatedAt: clock.Now().Add(-90 * 24 * time.Hour),
	})
	reporter := NewReporter(ReporterOptions{
		Client:            New(server.URL, "1234567890", "EAAtoken", ""),
		Store:             dataStore,
		Path:              filepath.Join(t.TempDir(), "meta-conversions.json"),
		Now:               clock.Now,
		DisableBackground: true,
	})
	defer reporter.Close()

	reporter.Scan(context.Background())
	if provider.count() != 0 {
		t.Fatalf("history was replayed: %d requests", provider.count())
	}
}

// TestReporterRetriesAFailedBatchThenGivesUp. A failure must not lose the
// conversion, which is why the watermark stays put and the batch is re-sent --
// safe, because Meta collapses repeats by event_id. But a batch that keeps
// failing must eventually be abandoned, or one poisoned lead stops every later
// conversion from ever being reported.
func TestReporterRetriesAFailedBatchThenGivesUp(t *testing.T) {
	clock := &testClock{current: time.Date(2026, 8, 30, 9, 0, 0, 0, time.UTC)}
	provider := &recorder{status: http.StatusBadRequest, response: `{"error":{"message":"Invalid parameter","code":100}}`}
	server := httptest.NewServer(provider.handler())
	defer server.Close()

	dataStore := newTestStore(t)
	reporter := NewReporter(ReporterOptions{
		Client:            New(server.URL, "1234567890", "EAAtoken", ""),
		Store:             dataStore,
		Path:              filepath.Join(t.TempDir(), "meta-conversions.json"),
		Now:               clock.Now,
		DisableBackground: true,
	})
	defer reporter.Close()

	writeLead(t, dataStore, model.Lead{
		ID: "lead_poison", AccountID: "acct_1", Email: "person@example.com",
		Status: "new", Source: "widget", CreatedAt: clock.Now().Add(time.Minute),
	})

	for pass := 1; pass <= maxSendAttempts; pass++ {
		reporter.Scan(context.Background())
		if provider.count() != pass {
			t.Fatalf("pass %d: requests got %d, want %d -- a failed batch must be retried", pass, provider.count(), pass)
		}
	}
	// The give-up has now fired. Further passes must send nothing.
	reporter.Scan(context.Background())
	reporter.Scan(context.Background())
	if provider.count() != maxSendAttempts {
		t.Fatalf("a poisoned batch was retried forever: %d requests", provider.count())
	}
}

// TestReporterSkipsALeadWithNothingToMatchOn. A lead captured with neither an
// email nor a phone cannot be matched by Meta, so it is not sent -- but it must
// still advance the watermark, or the scan re-reads it on every poll forever.
func TestReporterSkipsALeadWithNothingToMatchOn(t *testing.T) {
	clock := &testClock{current: time.Date(2026, 8, 30, 9, 0, 0, 0, time.UTC)}
	provider := &recorder{}
	server := httptest.NewServer(provider.handler())
	defer server.Close()

	dataStore := newTestStore(t)
	reporter := NewReporter(ReporterOptions{
		Client:            New(server.URL, "1234567890", "EAAtoken", ""),
		Store:             dataStore,
		Path:              filepath.Join(t.TempDir(), "meta-conversions.json"),
		Now:               clock.Now,
		DisableBackground: true,
	})
	defer reporter.Close()

	writeLead(t, dataStore, model.Lead{
		ID: "lead_nameless", AccountID: "acct_1", Name: "Anonymous",
		Status: "new", Source: "widget", CreatedAt: clock.Now().Add(time.Minute),
	})
	reporter.Scan(context.Background())
	if provider.count() != 0 {
		t.Fatalf("an unmatchable lead was sent: %d requests", provider.count())
	}
	// It must be behind the watermark now: a lead that can never be sent must
	// not be reconsidered on every poll.
	writeLead(t, dataStore, model.Lead{
		ID: "lead_real", AccountID: "acct_1", Email: "person@example.com",
		Status: "new", Source: "widget", CreatedAt: clock.Now().Add(2 * time.Minute),
	})
	reporter.Scan(context.Background())
	if provider.count() != 1 {
		t.Fatalf("requests: got %d, want 1", provider.count())
	}
	if identifiers := provider.lastEventIDs(t); len(identifiers) != 1 || identifiers[0] != "lead_real" {
		t.Fatalf("event ids: got %v, want [lead_real]", identifiers)
	}
}
