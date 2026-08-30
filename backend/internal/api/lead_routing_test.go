package api

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"garuda/backend/internal/composio"
	"garuda/backend/internal/model"
)

// fakeComposio stands in for the broker. It records what was executed and can be
// told to refuse, which is the only way to test a circuit breaker without
// waiting for a real provider to have a bad day.
type fakeComposio struct {
	mutex sync.Mutex
	calls []map[string]any
	tools []string
	fail  string
}

func (f *fakeComposio) record(tool string, body map[string]any) {
	f.mutex.Lock()
	defer f.mutex.Unlock()
	f.tools = append(f.tools, tool)
	f.calls = append(f.calls, body)
}

func (f *fakeComposio) count() int {
	f.mutex.Lock()
	defer f.mutex.Unlock()
	return len(f.calls)
}

func (f *fakeComposio) refuseWith(message string) {
	f.mutex.Lock()
	defer f.mutex.Unlock()
	f.fail = message
}

func installFakeComposio(t *testing.T, server *Server) *fakeComposio {
	t.Helper()
	fake := &fakeComposio{}
	stub := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body := map[string]any{}
		if raw, err := io.ReadAll(r.Body); err == nil && len(raw) > 0 {
			_ = json.Unmarshal(raw, &body)
		}
		tool := strings.TrimPrefix(r.URL.Path, "/tools/execute/")
		fake.record(tool, body)

		f := func() string { fake.mutex.Lock(); defer fake.mutex.Unlock(); return fake.fail }()
		w.Header().Set("Content-Type", "application/json")
		if f != "" {
			// The broker reports a refusal as a 200 with successful:false, which
			// is exactly the shape that would slip through a status-code check.
			_ = json.NewEncoder(w).Encode(map[string]any{"successful": false, "error": f})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"successful": true, "data": map[string]any{"id": "remote_1"}})
	}))
	t.Cleanup(stub.Close)
	server.composio = composio.New(stub.URL, "test-key")
	return fake
}

func seedRoutedLead(t *testing.T, server *Server, accountID string, createdAt time.Time, name string) {
	t.Helper()
	if err := server.store.Update(func(state *model.State) error {
		state.Leads = append(state.Leads, model.Lead{
			ID: "lead_" + name, AccountID: accountID, AgentID: "agt_" + accountID,
			Name: name, Email: name + "@example.com", Source: "chat",
			CreatedAt: createdAt, UpdatedAt: createdAt,
		})
		return nil
	}); err != nil {
		t.Fatalf("seed lead: %v", err)
	}
}

func seedRoute(t *testing.T, server *Server, accountID, toolkit, setting string, enabled bool) {
	t.Helper()
	now := time.Now().UTC()
	if err := server.store.Update(func(state *model.State) error {
		state.LeadRoutes = append(state.LeadRoutes, model.LeadRoute{
			AccountID: accountID, Toolkit: toolkit, Setting: setting, Enabled: enabled,
			CreatedAt: now, UpdatedAt: now,
		})
		return nil
	}); err != nil {
		t.Fatalf("seed route: %v", err)
	}
}

func routeState(t *testing.T, server *Server, accountID, toolkit string) model.LeadRoute {
	t.Helper()
	var found model.LeadRoute
	_ = server.store.View(func(state *model.State) error {
		for index := range state.LeadRoutes {
			if state.LeadRoutes[index].AccountID == accountID && state.LeadRoutes[index].Toolkit == toolkit {
				found = state.LeadRoutes[index].Clone()
			}
		}
		return nil
	})
	return found
}

// A lead reaches the customer's CRM once. Twice is a duplicate contact and a
// second notification for the same enquiry, which is how somebody stops
// trusting the integration.
func TestALeadIsDeliveredExactlyOnce(t *testing.T) {
	server, _ := newTestServer(t)
	fake := installFakeComposio(t, server)
	seedRoute(t, server, "org_a", "slack", "#sales", true)

	start := time.Now().UTC()
	seedRoutedLead(t, server, "org_a", start.Add(time.Second), "asha")

	watermark := server.routeNewLeads(start)
	if fake.count() != 1 {
		t.Fatalf("expected one delivery, got %d", fake.count())
	}
	// A second pass with the returned watermark must find nothing new.
	watermark = server.routeNewLeads(watermark)
	if fake.count() != 1 {
		t.Fatalf("the same lead was delivered again: %d deliveries", fake.count())
	}
	// And a third, because a watermark that fails to advance only shows up on
	// the pass after the one that looked fine.
	server.routeNewLeads(watermark)
	if fake.count() != 1 {
		t.Fatalf("the same lead was delivered a third time: %d deliveries", fake.count())
	}
}

// Leads captured before a destination was connected stay where they are. A
// customer who connects HubSpot on Tuesday does not want Monday's hundred
// enquiries arriving as notifications.
func TestOlderLeadsAreNotReplayed(t *testing.T) {
	server, _ := newTestServer(t)
	fake := installFakeComposio(t, server)
	seedRoute(t, server, "org_a", "slack", "#sales", true)

	start := time.Now().UTC()
	seedRoutedLead(t, server, "org_a", start.Add(-48*time.Hour), "old")

	server.routeNewLeads(start)
	if fake.count() != 0 {
		t.Fatalf("a lead from before the watermark was delivered: %d", fake.count())
	}
}

// One customer's lead must never reach another customer's Slack. This is the
// same tenancy rule as every read path, on a write that leaves the building.
func TestALeadNeverReachesAnotherAccountsDestination(t *testing.T) {
	server, _ := newTestServer(t)
	fake := installFakeComposio(t, server)
	seedRoute(t, server, "org_a", "slack", "#a-sales", true)
	seedRoute(t, server, "org_b", "slack", "#b-sales", true)

	start := time.Now().UTC()
	seedRoutedLead(t, server, "org_a", start.Add(time.Second), "asha")

	server.routeNewLeads(start)
	if fake.count() != 1 {
		t.Fatalf("expected exactly one delivery, got %d", fake.count())
	}
	fake.mutex.Lock()
	arguments, _ := fake.calls[0]["arguments"].(map[string]any)
	fake.mutex.Unlock()
	if channel, _ := arguments["channel"].(string); channel != "#a-sales" {
		t.Fatalf("the lead went to %q, which belongs to another account", channel)
	}
}

// A destination whose credentials were revoked would otherwise be tried once per
// lead forever. Every attempt is a request somebody pays for and a log line
// nobody reads.
func TestAFailingDestinationStopsBeingTried(t *testing.T) {
	server, _ := newTestServer(t)
	fake := installFakeComposio(t, server)
	fake.refuseWith("invalid_auth")
	seedRoute(t, server, "org_a", "slack", "#sales", true)

	watermark := time.Now().UTC()
	for index := 0; index < routeFailureLimit+3; index++ {
		seedRoutedLead(t, server, "org_a", watermark.Add(time.Duration(index+1)*time.Second), "lead"+string(rune('a'+index)))
		watermark = server.routeNewLeads(watermark)
	}

	if fake.count() != routeFailureLimit {
		t.Fatalf("expected the breaker to stop trying after %d failures, got %d attempts", routeFailureLimit, fake.count())
	}
	route := routeState(t, server, "org_a", "slack")
	if route.FailureCount < routeFailureLimit {
		t.Errorf("the failure count did not reach the limit: %d", route.FailureCount)
	}
	// The reason has to survive, or the settings screen can only say "failed".
	if !strings.Contains(route.LastError, "invalid_auth") {
		t.Errorf("the provider's own reason was lost: %q", route.LastError)
	}
}

// Switching a destination off must not lose the channel somebody typed, or
// turning it back on is a second trip to find it.
func TestDisablingADestinationKeepsItsSetting(t *testing.T) {
	server, _ := newTestServer(t)
	identity := Identity{AccountID: "org_a", UserID: "usr_a", Role: "owner"}

	response := httptest.NewRecorder()
	server.saveLeadRoute(response, integrationsRequest(t, http.MethodPut, "/v1/integrations/routes", identity, nil, map[string]any{
		"toolkit": "slack", "setting": "#sales", "enabled": true,
	}))
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200 saving, got %d: %s", response.Code, response.Body.String())
	}

	response = httptest.NewRecorder()
	server.saveLeadRoute(response, integrationsRequest(t, http.MethodPut, "/v1/integrations/routes", identity, nil, map[string]any{
		"toolkit": "slack", "setting": "#sales", "enabled": false,
	}))
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200 disabling, got %d: %s", response.Code, response.Body.String())
	}

	route := routeState(t, server, "org_a", "slack")
	if route.Enabled {
		t.Fatal("the destination is still enabled")
	}
	if route.Setting != "#sales" {
		t.Errorf("the setting was lost on disable: %q", route.Setting)
	}
}

// A disabled destination is not a slow one. Nothing is sent.
func TestADisabledDestinationReceivesNothing(t *testing.T) {
	server, _ := newTestServer(t)
	fake := installFakeComposio(t, server)
	seedRoute(t, server, "org_a", "slack", "#sales", false)

	start := time.Now().UTC()
	seedRoutedLead(t, server, "org_a", start.Add(time.Second), "asha")
	server.routeNewLeads(start)

	if fake.count() != 0 {
		t.Fatalf("a disabled destination received %d deliveries", fake.count())
	}
}

// Enabling a destination that needs a setting without giving one would fail on
// every lead, silently, forever. It is refused at save time where somebody is
// looking at the screen.
func TestADestinationNeedingASettingRefusesToBeEnabledWithout(t *testing.T) {
	server, _ := newTestServer(t)
	identity := Identity{AccountID: "org_a", UserID: "usr_a", Role: "owner"}

	response := httptest.NewRecorder()
	server.saveLeadRoute(response, integrationsRequest(t, http.MethodPut, "/v1/integrations/routes", identity, nil, map[string]any{
		"toolkit": "slack", "setting": "", "enabled": true,
	}))
	if response.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422, got %d: %s", response.Code, response.Body.String())
	}
	if !strings.Contains(strings.ToLower(response.Body.String()), "channel") {
		t.Errorf("the message did not name what is missing: %s", response.Body.String())
	}
}

// Fixing the setting is somebody repairing what broke, so the breaker releases.
// Leaving it latched would mean a destination that can never come back without
// support.
func TestFixingTheSettingReleasesTheBreaker(t *testing.T) {
	server, _ := newTestServer(t)
	identity := Identity{AccountID: "org_a", UserID: "usr_a", Role: "owner"}
	seedRoute(t, server, "org_a", "slack", "#wrong", true)
	for index := 0; index < routeFailureLimit; index++ {
		server.recordRouteResult("org_a", "slack", errFake)
	}
	if routeState(t, server, "org_a", "slack").FailureCount < routeFailureLimit {
		t.Fatal("the breaker did not trip")
	}

	response := httptest.NewRecorder()
	server.saveLeadRoute(response, integrationsRequest(t, http.MethodPut, "/v1/integrations/routes", identity, nil, map[string]any{
		"toolkit": "slack", "setting": "#right", "enabled": true,
	}))
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
	}
	route := routeState(t, server, "org_a", "slack")
	if route.FailureCount != 0 || route.LastError != "" {
		t.Errorf("the breaker stayed latched after the setting was fixed: %+v", route)
	}
}

// An app that is connected but receives nothing must be refused rather than
// stored as a destination that will never deliver.
func TestAnAppThatDoesNotReceiveLeadsIsRefused(t *testing.T) {
	server, _ := newTestServer(t)
	identity := Identity{AccountID: "org_a", UserID: "usr_a", Role: "owner"}

	response := httptest.NewRecorder()
	server.saveLeadRoute(response, integrationsRequest(t, http.MethodPut, "/v1/integrations/routes", identity, nil, map[string]any{
		"toolkit": "notion", "enabled": true,
	}))
	if response.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422 for an unsupported destination, got %d: %s", response.Code, response.Body.String())
	}
	// And the message must point somewhere that works.
	if !strings.Contains(strings.ToLower(response.Body.String()), "webhook") {
		t.Errorf("the refusal did not offer the webhook: %s", response.Body.String())
	}
}

// The list is what the settings screen is built from: what is configured, and
// what could be.
func TestTheRouteListShowsBothConfiguredAndAvailable(t *testing.T) {
	server, _ := newTestServer(t)
	identity := Identity{AccountID: "org_a", UserID: "usr_a", Role: "owner"}
	seedRoute(t, server, "org_a", "slack", "#sales", true)
	seedRoute(t, server, "org_other", "hubspot", "", true)

	response := httptest.NewRecorder()
	server.listLeadRoutes(response, integrationsRequest(t, http.MethodGet, "/v1/integrations/routes", identity, nil, nil))
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
	}
	var envelope struct {
		Data struct {
			Routes []struct {
				Toolkit string `json:"toolkit"`
				Setting string `json:"setting"`
				Paused  bool   `json:"paused"`
			} `json:"routes"`
			Available []struct {
				Toolkit string `json:"toolkit"`
				Label   string `json:"label"`
				Summary string `json:"summary"`
			} `json:"available"`
		} `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(envelope.Data.Routes) != 1 || envelope.Data.Routes[0].Toolkit != "slack" {
		t.Fatalf("another account's destination leaked in: %+v", envelope.Data.Routes)
	}
	if len(envelope.Data.Available) == 0 {
		t.Fatal("nothing was offered to send leads to")
	}
	for _, destination := range envelope.Data.Available {
		if strings.TrimSpace(destination.Summary) == "" {
			t.Errorf("%s is offered with no explanation of what it does", destination.Toolkit)
		}
	}
}

// A test lead has to be obviously a test. Somebody calling back a fake enquiry
// is a worse outcome than no test button.
func TestTheTestLeadSaysItIsATest(t *testing.T) {
	server, _ := newTestServer(t)
	fake := installFakeComposio(t, server)
	identity := Identity{AccountID: "org_a", UserID: "usr_a", Role: "owner"}
	seedRoute(t, server, "org_a", "slack", "#sales", true)

	response := httptest.NewRecorder()
	server.testLeadRoute(response, integrationsRequest(t, http.MethodPost, "/v1/integrations/routes/test", identity, nil, map[string]any{
		"toolkit": "slack",
	}))
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
	}
	fake.mutex.Lock()
	arguments, _ := fake.calls[0]["arguments"].(map[string]any)
	userID, _ := fake.calls[0]["user_id"].(string)
	fake.mutex.Unlock()
	text, _ := arguments["text"].(string)
	if !strings.Contains(strings.ToLower(text), "test") {
		t.Errorf("the sample lead does not say it is a test: %q", text)
	}
	// And it must be sent as this account, or it would use somebody else's
	// connection.
	if userID != "org_a" {
		t.Errorf("the test ran as %q", userID)
	}
}

// Testing a destination nobody configured is a 404, not a delivery attempt with
// an empty channel.
func TestTestingAnUnconfiguredDestinationIsNotFound(t *testing.T) {
	server, _ := newTestServer(t)
	fake := installFakeComposio(t, server)
	identity := Identity{AccountID: "org_a", UserID: "usr_a", Role: "owner"}

	response := httptest.NewRecorder()
	server.testLeadRoute(response, integrationsRequest(t, http.MethodPost, "/v1/integrations/routes/test", identity, nil, map[string]any{
		"toolkit": "slack",
	}))
	if response.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", response.Code, response.Body.String())
	}
	if fake.count() != 0 {
		t.Errorf("an unconfigured destination was still called %d times", fake.count())
	}
}

// One pass is bounded. A backlog is worked through over several passes rather
// than one burst that outlives its own interval and overlaps itself -- and the
// watermark must only advance as far as what was actually attempted, or the
// remainder is skipped forever.
func TestABacklogIsDeliveredInBoundedPassesAndNothingIsSkipped(t *testing.T) {
	server, _ := newTestServer(t)
	fake := installFakeComposio(t, server)
	seedRoute(t, server, "org_a", "slack", "#sales", true)

	start := time.Now().UTC()
	const total = leadRoutingBatch * 2
	for index := 0; index < total; index++ {
		seedRoutedLead(t, server, "org_a", start.Add(time.Duration(index+1)*time.Second), "lead"+string(rune('a'+index)))
	}

	watermark := start
	for pass := 0; pass < 5 && fake.count() < total; pass++ {
		next := server.routeNewLeads(watermark)
		if next.Before(watermark) {
			t.Fatalf("the watermark went backwards on pass %d", pass)
		}
		watermark = next
	}
	if fake.count() != total {
		t.Fatalf("expected all %d leads delivered across passes, got %d", total, fake.count())
	}
	// And no duplicates: a further pass changes nothing.
	server.routeNewLeads(watermark)
	if fake.count() != total {
		t.Fatalf("a further pass redelivered: %d", fake.count())
	}
}

// The lead payload must carry the fields the destination maps, and must NOT
// carry a transcript. A chat history copied into somebody's Slack is a copy of
// personal data outside the product.
func TestTheDeliveredPayloadCarriesNoTranscript(t *testing.T) {
	server, _ := newTestServer(t)
	fake := installFakeComposio(t, server)
	seedRoute(t, server, "org_a", "slack", "#sales", true)

	start := time.Now().UTC()
	if err := server.store.Update(func(state *model.State) error {
		state.Agents = append(state.Agents, model.Agent{ID: "agt_a", AccountID: "org_a", Name: "Priya"})
		state.Sessions = append(state.Sessions, model.Session{
			ID: "cvs_a", AccountID: "org_a", AgentID: "agt_a", PageURL: "https://example.com/pricing",
		})
		state.Messages = append(state.Messages, model.Message{
			ID: "msg_a", AccountID: "org_a", AgentID: "agt_a", SessionID: "cvs_a",
			Role: "user", Content: "my card number is not something to repeat",
		})
		state.Leads = append(state.Leads, model.Lead{
			ID: "lead_1", AccountID: "org_a", AgentID: "agt_a", SessionID: "cvs_a",
			Name: "Asha", Email: "asha@example.com", Source: "chat",
			CreatedAt: start.Add(time.Second),
		})
		return nil
	}); err != nil {
		t.Fatalf("seed: %v", err)
	}

	server.routeNewLeads(start)
	if fake.count() != 1 {
		t.Fatalf("expected one delivery, got %d", fake.count())
	}
	fake.mutex.Lock()
	arguments, _ := fake.calls[0]["arguments"].(map[string]any)
	fake.mutex.Unlock()
	text, _ := arguments["text"].(string)
	if !strings.Contains(text, "asha@example.com") || !strings.Contains(text, "Priya") {
		t.Errorf("the payload is missing what the destination needs: %q", text)
	}
	if strings.Contains(text, "card number") {
		t.Errorf("the conversation was copied into the destination: %q", text)
	}
}

// errFake is a stable error for tests that need a failure without a network.
var errFake = errFakeType{}

type errFakeType struct{}

func (errFakeType) Error() string { return "the destination refused" }
