package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"garuda/backend/internal/model"
	"garuda/backend/internal/outbound"
)

// integrationsRequest builds a request the way the router would: the identity in
// the context, the path values already extracted. The routes for this lane are
// registered in server.go, which this lane does not own, so the handlers are
// exercised directly -- which is how the existing tests in this package already
// work.
func integrationsRequest(t *testing.T, method, target string, identity Identity, pathValues map[string]string, body any) *http.Request {
	t.Helper()
	var payload []byte
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal request: %v", err)
		}
		payload = encoded
	}
	request := httptest.NewRequest(method, target, bytes.NewReader(payload))
	request.Header.Set("Content-Type", "application/json")
	for key, value := range pathValues {
		request.SetPathValue(key, value)
	}
	return request.WithContext(context.WithValue(request.Context(), identityKey, identity))
}

func installTestWebhookRegistry(t *testing.T, server *Server, options outbound.Options) *outbound.Registry {
	t.Helper()
	options.AllowPrivateDestinations = true
	registry := outbound.New(options)
	t.Cleanup(setOutboundWebhooks(server, registry))
	return registry
}

func createTestEndpoint(t *testing.T, server *Server, identity Identity, url string) (string, string) {
	t.Helper()
	response := httptest.NewRecorder()
	server.createWebhookEndpoint(response, integrationsRequest(t, http.MethodPost, "/v1/integrations/webhooks", identity, nil, map[string]any{
		"url": url, "description": "Zapier", "events": []string{"lead.created"},
	}))
	if response.Code != http.StatusCreated {
		t.Fatalf("expected 201 creating an endpoint, got %d: %s", response.Code, response.Body.String())
	}
	var envelope struct {
		Data struct {
			Endpoint struct {
				ID string `json:"id"`
			} `json:"endpoint"`
			Secret string `json:"secret"`
		} `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode create response: %v", err)
	}
	if envelope.Data.Endpoint.ID == "" || envelope.Data.Secret == "" {
		t.Fatalf("expected an endpoint id and a secret, got %s", response.Body.String())
	}
	return envelope.Data.Endpoint.ID, envelope.Data.Secret
}

// TestCreateWebhookEndpointRejectsInternalTargets is the SSRF rule at the API
// boundary: a customer-supplied URL that points into our own network is a 422
// with a readable reason, not a request we make on their behalf.
func TestCreateWebhookEndpointRejectsInternalTargets(t *testing.T) {
	server, _ := newTestServer(t)
	// The DEFAULT registry, with no test escape hatch, is what this test needs.
	t.Cleanup(setOutboundWebhooks(server, outbound.New(outbound.Options{DisableBackground: true})))
	identity := Identity{UserID: "usr_1", AccountID: "org_1", Role: "owner"}

	for _, target := range []string{
		"http://hooks.example.com/inbound",
		"https://127.0.0.1/inbound",
		"https://169.254.169.254/latest/meta-data",
		"https://10.0.0.5/inbound",
		"https://[fd00::1]/inbound",
		"https://build.internal/inbound",
		"https://hooks.example.com:9000/inbound",
	} {
		response := httptest.NewRecorder()
		server.createWebhookEndpoint(response, integrationsRequest(t, http.MethodPost, "/v1/integrations/webhooks", identity, nil, map[string]any{
			"url": target, "events": []string{"lead.created"},
		}))
		if response.Code != http.StatusUnprocessableEntity {
			t.Fatalf("expected %q to be rejected with 422, got %d: %s", target, response.Code, response.Body.String())
		}
		if !strings.Contains(response.Body.String(), "validation_failed") {
			t.Fatalf("expected a validation_failed envelope for %q, got %s", target, response.Body.String())
		}
	}

	// An unknown event name is rejected too, so a typo cannot create an endpoint
	// that silently never fires.
	response := httptest.NewRecorder()
	server.createWebhookEndpoint(response, integrationsRequest(t, http.MethodPost, "/v1/integrations/webhooks", identity, nil, map[string]any{
		"url": "https://hooks.zapier.com/hooks/catch/1/a/", "events": []string{"lead.deleted"},
	}))
	if response.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected an unknown event to be rejected, got %d: %s", response.Code, response.Body.String())
	}
}

// TestWebhookSecretIsReturnedOnceAndNeverAgain covers the "shown once" promise.
func TestWebhookSecretIsReturnedOnceAndNeverAgain(t *testing.T) {
	server, _ := newTestServer(t)
	installTestWebhookRegistry(t, server, outbound.Options{DisableBackground: true})
	identity := Identity{UserID: "usr_1", AccountID: "org_1", Role: "owner"}
	endpointID, secret := createTestEndpoint(t, server, identity, "https://hooks.zapier.com/hooks/catch/1/abc/")

	listResponse := httptest.NewRecorder()
	server.listWebhookEndpoints(listResponse, integrationsRequest(t, http.MethodGet, "/v1/integrations/webhooks", identity, nil, nil))
	if listResponse.Code != http.StatusOK {
		t.Fatalf("expected 200 listing endpoints, got %d", listResponse.Code)
	}
	if strings.Contains(listResponse.Body.String(), secret) || strings.Contains(listResponse.Body.String(), "secret") {
		t.Fatalf("the signing secret must never appear in a list response: %s", listResponse.Body.String())
	}

	rotateResponse := httptest.NewRecorder()
	server.rotateWebhookSecret(rotateResponse, integrationsRequest(t, http.MethodPost, "/v1/integrations/webhooks/x/secret", identity, map[string]string{"endpointID": endpointID}, nil))
	if rotateResponse.Code != http.StatusOK {
		t.Fatalf("expected 200 rotating the secret, got %d: %s", rotateResponse.Code, rotateResponse.Body.String())
	}
	var rotated struct {
		Data struct {
			Secret string `json:"secret"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rotateResponse.Body.Bytes(), &rotated); err != nil {
		t.Fatalf("decode rotate response: %v", err)
	}
	if rotated.Data.Secret == "" || rotated.Data.Secret == secret {
		t.Fatalf("expected rotation to issue a new secret, got %q", rotated.Data.Secret)
	}
}

// TestWebhookEndpointsAreInvisibleAcrossTenants is the multi-tenant rule: another
// account's endpoint is 404, never 403, on every route that takes an id.
func TestWebhookEndpointsAreInvisibleAcrossTenants(t *testing.T) {
	server, _ := newTestServer(t)
	installTestWebhookRegistry(t, server, outbound.Options{DisableBackground: true})
	owner := Identity{UserID: "usr_1", AccountID: "org_1", Role: "owner"}
	intruder := Identity{UserID: "usr_2", AccountID: "org_2", Role: "owner"}
	endpointID, _ := createTestEndpoint(t, server, owner, "https://hooks.zapier.com/hooks/catch/1/abc/")

	pathValues := map[string]string{"endpointID": endpointID}
	cases := []struct {
		name   string
		method string
		body   any
		call   func(http.ResponseWriter, *http.Request)
	}{
		{name: "update", method: http.MethodPatch, body: map[string]any{"enabled": false}, call: server.updateWebhookEndpoint},
		{name: "delete", method: http.MethodDelete, call: server.deleteWebhookEndpoint},
		{name: "rotate", method: http.MethodPost, call: server.rotateWebhookSecret},
		{name: "test", method: http.MethodPost, call: server.sendWebhookTestEvent},
		{name: "deliveries", method: http.MethodGet, call: server.listWebhookDeliveries},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			response := httptest.NewRecorder()
			testCase.call(response, integrationsRequest(t, testCase.method, "/v1/integrations/webhooks/"+endpointID, intruder, pathValues, testCase.body))
			if response.Code != http.StatusNotFound {
				t.Fatalf("expected 404 for a cross-tenant %s, got %d: %s", testCase.name, response.Code, response.Body.String())
			}
			if strings.Contains(response.Body.String(), "forbidden") {
				t.Fatalf("a cross-tenant read must not admit the row exists: %s", response.Body.String())
			}
		})
	}

	// The intruder's own list is empty, and the owner still has the endpoint.
	listResponse := httptest.NewRecorder()
	server.listWebhookEndpoints(listResponse, integrationsRequest(t, http.MethodGet, "/v1/integrations/webhooks", intruder, nil, nil))
	if !strings.Contains(listResponse.Body.String(), `"data":[]`) {
		t.Fatalf("expected the other tenant to see no endpoints, got %s", listResponse.Body.String())
	}
}

// TestTestEventReturnsBeforeTheCustomerEndpointReplies is the "delivery must
// never block the request" rule. The customer's server is deliberately wedged;
// the API still answers immediately.
func TestTestEventReturnsBeforeTheCustomerEndpointReplies(t *testing.T) {
	release := make(chan struct{})
	reached := make(chan struct{}, 1)
	customerServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		select {
		case reached <- struct{}{}:
		default:
		}
		<-release
		w.WriteHeader(http.StatusOK)
	}))
	defer customerServer.Close()
	defer close(release)

	server, _ := newTestServer(t)
	installTestWebhookRegistry(t, server, outbound.Options{
		PollInterval: 10 * time.Millisecond,
		// Long enough that a synchronous send would be unmistakable in the
		// measurement below, short enough that the worker unwinds at teardown.
		HTTPTimeout: 3 * time.Second,
	})
	identity := Identity{UserID: "usr_1", AccountID: "org_1", Role: "owner"}
	endpointID, _ := createTestEndpoint(t, server, identity, customerServer.URL)

	started := time.Now()
	response := httptest.NewRecorder()
	server.sendWebhookTestEvent(response, integrationsRequest(t, http.MethodPost, "/v1/integrations/webhooks/x/test", identity, map[string]string{"endpointID": endpointID}, nil))
	elapsed := time.Since(started)
	if response.Code != http.StatusAccepted {
		t.Fatalf("expected 202 queuing a test event, got %d: %s", response.Code, response.Body.String())
	}
	if elapsed > time.Second {
		t.Fatalf("the request waited %v on the customer endpoint; delivery must be off the request path", elapsed)
	}
	select {
	case <-reached:
	case <-time.After(3 * time.Second):
		t.Fatal("expected the background worker to attempt the delivery")
	}
}

// TestDeliveryLogRecordsFailuresForTheOwner covers what the customer sees when
// their endpoint misbehaves: the event, the status, the attempt count and the
// error, and never the payload.
func TestDeliveryLogRecordsFailuresForTheOwner(t *testing.T) {
	customerServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusTeapot)
	}))
	defer customerServer.Close()

	server, _ := newTestServer(t)
	registry := installTestWebhookRegistry(t, server, outbound.Options{DisableBackground: true})
	identity := Identity{UserID: "usr_1", AccountID: "org_1", Role: "owner"}
	endpointID, _ := createTestEndpoint(t, server, identity, customerServer.URL)

	testResponse := httptest.NewRecorder()
	server.sendWebhookTestEvent(testResponse, integrationsRequest(t, http.MethodPost, "/v1/integrations/webhooks/x/test", identity, map[string]string{"endpointID": endpointID}, nil))
	if testResponse.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d: %s", testResponse.Code, testResponse.Body.String())
	}
	registry.Drain(context.Background())

	response := httptest.NewRecorder()
	server.listWebhookDeliveries(response, integrationsRequest(t, http.MethodGet, "/v1/integrations/webhooks/x/deliveries", identity, map[string]string{"endpointID": endpointID}, nil))
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200 listing deliveries, got %d: %s", response.Code, response.Body.String())
	}
	var envelope struct {
		Data []webhookDeliveryResponse `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode deliveries: %v", err)
	}
	if len(envelope.Data) != 1 {
		t.Fatalf("expected one delivery in the log, got %d: %s", len(envelope.Data), response.Body.String())
	}
	delivery := envelope.Data[0]
	if delivery.Event != outbound.EventTest {
		t.Fatalf("expected the test event to be logged, got %q", delivery.Event)
	}
	if delivery.Attempts != 1 || delivery.ResponseStatus != http.StatusTeapot {
		t.Fatalf("expected one attempt recording the 418, got %+v", delivery)
	}
	if delivery.LastError == "" {
		t.Fatal("expected the failure reason to be shown to the customer")
	}
	if strings.Contains(response.Body.String(), "payload") {
		t.Fatalf("the delivery log must not carry the payload bytes: %s", response.Body.String())
	}
}

// TestUpdateWebhookEndpointRevalidatesTheURL: an endpoint that was safe when it
// was created is not evidence that its replacement is.
func TestUpdateWebhookEndpointRevalidatesTheURL(t *testing.T) {
	server, _ := newTestServer(t)
	// Default guard, so the internal target is genuinely refused.
	t.Cleanup(setOutboundWebhooks(server, outbound.New(outbound.Options{DisableBackground: true})))
	identity := Identity{UserID: "usr_1", AccountID: "org_1", Role: "owner"}
	endpointID, _ := createTestEndpoint(t, server, identity, "https://hooks.zapier.com/hooks/catch/1/abc/")

	response := httptest.NewRecorder()
	server.updateWebhookEndpoint(response, integrationsRequest(t, http.MethodPatch, "/v1/integrations/webhooks/x", identity, map[string]string{"endpointID": endpointID}, map[string]any{
		"url": "https://169.254.169.254/latest/meta-data",
	}))
	if response.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422 repointing an endpoint at the metadata service, got %d: %s", response.Code, response.Body.String())
	}

	allowed := httptest.NewRecorder()
	server.updateWebhookEndpoint(allowed, integrationsRequest(t, http.MethodPatch, "/v1/integrations/webhooks/x", identity, map[string]string{"endpointID": endpointID}, map[string]any{
		"enabled": false,
	}))
	if allowed.Code != http.StatusOK {
		t.Fatalf("expected 200 disabling an endpoint, got %d: %s", allowed.Code, allowed.Body.String())
	}
	if !strings.Contains(allowed.Body.String(), `"status":"disabled"`) {
		t.Fatalf("expected the endpoint to read as disabled, got %s", allowed.Body.String())
	}
}

// integrationsRoutes is the exact wiring this lane needs in server.go Handler().
// It lives here so the lines are compiled and exercised before anyone pastes
// them into a file this lane does not own.
func integrationsRoutes(s *Server, mux *http.ServeMux) {
	s.StartOutboundWebhooks()
	mux.Handle("GET /v1/integrations/events", s.requireAuth(http.HandlerFunc(s.listIntegrationEvents)))
	mux.Handle("GET /v1/integrations/webhooks", s.requireAuth(http.HandlerFunc(s.listWebhookEndpoints)))
	mux.Handle("POST /v1/integrations/webhooks", s.requireAuth(s.rateLimit("integrations.webhook_create", 30, time.Hour, http.HandlerFunc(s.createWebhookEndpoint))))
	mux.Handle("PATCH /v1/integrations/webhooks/{endpointID}", s.requireAuth(s.rateLimit("integrations.webhook_update", 60, time.Hour, http.HandlerFunc(s.updateWebhookEndpoint))))
	mux.Handle("DELETE /v1/integrations/webhooks/{endpointID}", s.requireAuth(http.HandlerFunc(s.deleteWebhookEndpoint)))
	mux.Handle("POST /v1/integrations/webhooks/{endpointID}/secret", s.requireAuth(s.rateLimit("integrations.webhook_rotate", 20, time.Hour, http.HandlerFunc(s.rotateWebhookSecret))))
	mux.Handle("POST /v1/integrations/webhooks/{endpointID}/test", s.requireAuth(s.rateLimit("integrations.webhook_test", 30, time.Hour, http.HandlerFunc(s.sendWebhookTestEvent))))
	mux.Handle("GET /v1/integrations/webhooks/{endpointID}/deliveries", s.requireAuth(http.HandlerFunc(s.listWebhookDeliveries)))
}

// TestIntegrationsRoutesRequireAuthenticationAndResolveTheAccount runs the
// handed-over routes for real: unauthenticated requests are rejected before any
// handler sees them, and an authenticated one is scoped to the caller's account
// without the account id ever appearing in the request.
func TestIntegrationsRoutesRequireAuthenticationAndResolveTheAccount(t *testing.T) {
	server, dataStore := newTestServer(t)
	installTestWebhookRegistry(t, server, outbound.Options{DisableBackground: true})
	mux := http.NewServeMux()
	integrationsRoutes(server, mux)
	handler := server.middleware(mux)

	now := time.Now().UTC()
	account := model.Account{ID: "org_routes", Name: "Routes workspace", BillingStatus: "active", CreatedAt: now, UpdatedAt: now}
	user := model.User{ID: "usr_routes", AccountID: account.ID, Name: "Owner", Email: "routes@example.com", Role: "owner", CreatedAt: now, UpdatedAt: now}
	if err := dataStore.Update(func(state *model.State) error {
		state.Accounts = append(state.Accounts, account)
		state.Users = append(state.Users, user)
		return nil
	}); err != nil {
		t.Fatalf("seed workspace: %v", err)
	}
	token, err := server.issueToken(user)
	if err != nil {
		t.Fatalf("issue token: %v", err)
	}

	anonymous := performJSON(t, handler, http.MethodGet, "/v1/integrations/webhooks", "", "http://localhost:3000", nil)
	if anonymous.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 without a token, got %d: %s", anonymous.Code, anonymous.Body.String())
	}

	created := performJSON(t, handler, http.MethodPost, "/v1/integrations/webhooks", token, "http://localhost:3000", map[string]any{
		"url": "https://hooks.zapier.com/hooks/catch/77/routes/", "events": []string{"lead.created"},
	})
	if created.Code != http.StatusCreated {
		t.Fatalf("expected 201 creating an endpoint through the router, got %d: %s", created.Code, created.Body.String())
	}

	listed := performJSON(t, handler, http.MethodGet, "/v1/integrations/webhooks", token, "http://localhost:3000", nil)
	if listed.Code != http.StatusOK || !strings.Contains(listed.Body.String(), "hooks.zapier.com") {
		t.Fatalf("expected the caller's own endpoint back, got %d: %s", listed.Code, listed.Body.String())
	}

	catalogue := performJSON(t, handler, http.MethodGet, "/v1/integrations/events", token, "http://localhost:3000", nil)
	if catalogue.Code != http.StatusOK || !strings.Contains(catalogue.Body.String(), "Garuda-Signature") {
		t.Fatalf("expected the event catalogue with the signature contract, got %d: %s", catalogue.Code, catalogue.Body.String())
	}

	missing := performJSON(t, handler, http.MethodPost, "/v1/integrations/webhooks/whep_someone_else/test", token, "http://localhost:3000", nil)
	if missing.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for an id this account does not own, got %d: %s", missing.Code, missing.Body.String())
	}
}
