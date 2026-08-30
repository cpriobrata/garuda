package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"garuda/backend/internal/alerts"
)

// The alerts package is tested on its own, and the transports are tested against
// a real server. What neither covers is the wiring: does a fault in THIS service
// actually reach the channel, and does an ordinary rejected request stay quiet?
//
// That is the pair of questions the owner is really asking when they say they
// want to be told when something breaks. A notifier that works perfectly and is
// never called is the same as no notifier at all.

type capturingTransport struct {
	mutex sync.Mutex
	sent  []string
}

func (t *capturingTransport) Name() string  { return "capturing" }
func (t *capturingTransport) Enabled() bool { return true }
func (t *capturingTransport) Send(_ context.Context, text string) error {
	t.mutex.Lock()
	defer t.mutex.Unlock()
	t.sent = append(t.sent, text)
	return nil
}

// serverWithAlerting swaps in a transport that records instead of sending, and
// drives consider() directly rather than Notify(), because Notify delivers on a
// goroutine and a test that raced it would sometimes lie.
func alertingFor(t *testing.T) (*Server, *alerts.Notifier) {
	t.Helper()
	server, _ := newTestServer(t)
	transport := &capturingTransport{}
	notifier := alerts.New(alerts.Options{Transport: transport, Service: "garuda-api (test)"})
	server.alerts = notifier
	return server, notifier
}

// A handler that panics must both answer the caller and page a human. The
// process surviving is not enough: nobody knows it happened.
func TestAPanicPagesAHuman(t *testing.T) {
	server, notifier := alertingFor(t)

	exploding := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		panic("something in a handler went wrong")
	})
	request := httptest.NewRequest(http.MethodPost, "/v1/agents/agt_secret_id/publish", nil)
	response := httptest.NewRecorder()
	server.middleware(exploding).ServeHTTP(response, request)

	if response.Code != http.StatusInternalServerError {
		t.Fatalf("the caller got %d, want 500", response.Code)
	}
	if fingerprints := notifier.Fingerprints(); len(fingerprints) == 0 {
		t.Fatal("a panic did not reach the alert channel")
	} else if !strings.Contains(fingerprints[0], "panic") {
		t.Errorf("the alert was not classed as a panic: %v", fingerprints)
	}
}

// A 404, a 401 or a 422 is the service working correctly and telling somebody
// so. Paging a human for those is how an alert channel becomes noise nobody
// reads, which is the same as having none.
func TestOrdinaryRejectionsDoNotPageAnybody(t *testing.T) {
	server, notifier := alertingFor(t)

	for _, status := range []int{http.StatusNotFound, http.StatusUnauthorized, http.StatusUnprocessableEntity, http.StatusTooManyRequests, http.StatusPaymentRequired} {
		handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(status)
		})
		request := httptest.NewRequest(http.MethodGet, "/v1/agents/agt_1", nil)
		server.middleware(handler).ServeHTTP(httptest.NewRecorder(), request)
	}

	if fingerprints := notifier.Fingerprints(); len(fingerprints) != 0 {
		t.Fatalf("ordinary rejections paged a human: %v", fingerprints)
	}
}

func TestAServerErrorPagesAHuman(t *testing.T) {
	server, notifier := alertingFor(t)

	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
	})
	request := httptest.NewRequest(http.MethodGet, "/v1/dashboard", nil)
	server.middleware(handler).ServeHTTP(httptest.NewRecorder(), request)

	fingerprints := notifier.Fingerprints()
	if len(fingerprints) == 0 {
		t.Fatal("a 502 did not reach the alert channel")
	}
	if !strings.Contains(fingerprints[0], "http_5xx") {
		t.Errorf("the alert was not classed as a server error: %v", fingerprints)
	}
}

// An alert lands on a phone and stays there. The route tells you where to look;
// the ids in it would be personal data sitting in somebody's message history.
func TestTheAlertRouteCarriesNoIdentifiers(t *testing.T) {
	cases := map[string]string{
		"/v1/agents/agt_9f3c1a2b4d5e/publish":   "POST /v1/agents/{id}/publish",
		"/v1/conversations/cvs_abc123/messages": "POST /v1/conversations/{id}/messages",
		"/widget/v1/sessions/cvs_x9/leads":      "POST /widget/v1/sessions/{id}/leads",
		"/v1/leads/lead_deadbeef":               "POST /v1/leads/{id}",
		"/v1/dashboard":                         "POST /v1/dashboard",
	}
	for path, want := range cases {
		request := httptest.NewRequest(http.MethodPost, path, nil)
		if got := safeRoute(request); got != want {
			t.Errorf("safeRoute(%q) = %q, want %q", path, got, want)
		}
	}
}

// The same failure repeating is one incident. Without this a broken dependency
// is thousands of messages and the eleventh is the one nobody reads.
func TestARepeatedFaultIsOneAlertNotHundreds(t *testing.T) {
	server, notifier := alertingFor(t)

	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	})
	for attempt := 0; attempt < 200; attempt++ {
		request := httptest.NewRequest(http.MethodGet, "/v1/dashboard", nil)
		server.middleware(handler).ServeHTTP(httptest.NewRecorder(), request)
	}

	if fingerprints := notifier.Fingerprints(); len(fingerprints) != 1 {
		t.Fatalf("200 identical failures produced %d distinct alerts: %v", len(fingerprints), fingerprints)
	}
}
