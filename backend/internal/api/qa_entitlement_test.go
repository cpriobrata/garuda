package api

import (
	"bytes"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"garuda/backend/internal/model"
	"garuda/backend/internal/security"
)

func TestQAEntitlementMatrixOutsideDemo(t *testing.T) {
	server, dataStore := newTestServer(t)
	server.cfg.DemoMode = false
	now := time.Now().UTC()
	account := model.Account{ID: "org_lapsed", Name: "Lapsed", Plan: "starter_17", BillingStatus: "past_due", CreatedAt: now, UpdatedAt: now}
	user := model.User{ID: "usr_lapsed", AccountID: account.ID, Name: "Owner", Email: "lapsed@example.com", Role: "owner", EmailVerifiedAt: &now, CreatedAt: now, UpdatedAt: now}
	agent := model.Agent{
		ID: "agt_lapsed", AccountID: account.ID, Name: "Assistant", PublicKey: "pub_live_lapsed", Status: "published", Revision: 1,
		Branding:    model.BrandingConfig{PrimaryColor: "#111827", AccentColor: "#F97316", Position: "bottom_right", AllowedDomains: []string{"customer.example"}},
		LeadCapture: model.LeadCaptureConfig{Enabled: true, AfterTurns: 1},
		CreatedAt:   now, UpdatedAt: now,
	}
	visitorToken := "visitor-token-with-more-than-thirty-two-characters"
	visitorID := "vst_" + security.HashScopedToken([]byte(server.cfg.VisitorHMACKey), agent.ID, visitorToken)
	sessionToken := "session-token-abcdefghijklmnopqrstuvwxyz"
	startedAt := now.Add(-time.Minute)
	session := model.Session{
		ID: "cvs_lapsed", AccountID: account.ID, AgentID: agent.ID, VisitorID: visitorID,
		SessionTokenHash: security.HashOpaqueToken(sessionToken), Origin: "https://customer.example",
		MemoryConsent: true, StartedAt: &startedAt, ExpiresAt: now.Add(10 * time.Minute),
		CreatedAt: now, UpdatedAt: now, LastSeenAt: now,
	}
	if err := dataStore.Update(func(state *model.State) error {
		state.Accounts = append(state.Accounts, account)
		state.Users = append(state.Users, user)
		state.Agents = append(state.Agents, agent)
		state.Sessions = append(state.Sessions, session)
		state.Subscriptions = append(state.Subscriptions, model.Subscription{ID: "sub_lapsed", AccountID: account.ID, Status: "past_due", Plan: "starter_17", CreatedAt: now, UpdatedAt: now})
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	token, err := server.issueToken(user)
	if err != nil {
		t.Fatal(err)
	}
	handler := server.Handler()

	type probe struct {
		name, method, path string
		body               any
	}
	for _, p := range []probe{
		{"create agent", http.MethodPost, "/v1/agents", map[string]any{"name": "New"}},
		{"generate agent", http.MethodPost, "/v1/agents/generate", map[string]any{}},
		{"publish", http.MethodPost, "/v1/agents/" + agent.ID + "/publish", nil},
		{"preview message", http.MethodPost, "/v1/agents/" + agent.ID + "/preview/messages", map[string]any{"content": "hi"}},
		{"add source", http.MethodPost, "/v1/agents/" + agent.ID + "/sources", map[string]any{"type": "text", "name": "n", "text": "t"}},
		{"complete onboarding", http.MethodPost, "/v1/onboarding/complete", nil},
		{"patch agent", http.MethodPatch, "/v1/agents/" + agent.ID, map[string]any{"description": "still editable"}},
		
	} {
		r := performJSON(t, handler, p.method, p.path, token, "http://localhost:3000", p.body)
		t.Logf("lapsed account -> %-20s %s => %d", p.name, p.path, r.Code)
	}

	// widget surface for the same lapsed account
	widgetCall := func(name, path, body string) {
		r := httptest.NewRequest(http.MethodPost, path, bytes.NewBufferString(body))
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Origin", "https://customer.example")
		r.Header.Set("X-Garuda-Session-Token", sessionToken)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		t.Logf("lapsed account -> %-20s %s => %d %s", name, path, w.Code, firstBytes(w.Body.String(), 90))
	}
	widgetCall("widget session", "/widget/v1/sessions", fmt.Sprintf(`{"agent_key":%q,"consent":{"memory":true}}`, agent.PublicKey))
	widgetCall("widget message", "/widget/v1/sessions/"+session.ID+"/messages", `{"client_message_id":"c1","content":"hello"}`)
	widgetCall("widget lead", "/widget/v1/sessions/"+session.ID+"/leads", `{"client_capture_id":"l1","fields":{"email":"a@b.com"},"consent":{"granted":true}}`)
}

func firstBytes(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}
