package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"garuda/backend/internal/model"
	"garuda/backend/internal/security"
	"garuda/backend/internal/store"
)

// The state file is rewritten in full on every write and read back at boot
// through a fixed 64MiB limit. So an unbounded string that a visitor controls
// and this service persists is not a validation nicety -- it is a way for
// anonymous traffic to make the API unable to start, forever, from which
// systemd's unlimited restarts cannot recover.
//
// capture_id and notice_version were copied straight into the stored lead with
// no length check at all. One accepted request added 800KB of permanent state.

func seedLeadBoundsFixture(t *testing.T, dataStore *store.FileStore) (sessionID, sessionToken string) {
	t.Helper()
	token, err := security.RandomToken(32)
	if err != nil {
		t.Fatalf("token: %v", err)
	}
	now := time.Now().UTC()
	sessionID = "cvs_bounds"
	if err := dataStore.Update(func(state *model.State) error {
		state.Accounts = append(state.Accounts, model.Account{ID: "org_bounds", BillingStatus: "active"})
		state.Agents = append(state.Agents, model.Agent{
			ID: "agt_bounds", AccountID: "org_bounds", Name: "Bounds Bot", Status: "published",
			PublicKey:   "pub_bounds",
			LeadCapture: model.LeadCaptureConfig{Enabled: true, Fields: []string{"name", "email"}},
		})
		state.Sessions = append(state.Sessions, model.Session{
			ID: sessionID, AccountID: "org_bounds", AgentID: "agt_bounds", VisitorID: "vst_bounds",
			SessionTokenHash: security.HashOpaqueToken(token),
			ExpiresAt:        now.Add(time.Hour), CreatedAt: now, UpdatedAt: now, LastSeenAt: now,
		})
		return nil
	}); err != nil {
		t.Fatalf("seed: %v", err)
	}
	return sessionID, token
}

func postLead(t *testing.T, server *Server, sessionID, sessionToken string, payload map[string]any) *httptest.ResponseRecorder {
	t.Helper()
	encoded, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	request := httptest.NewRequest(http.MethodPost, "/widget/v1/sessions/"+sessionID+"/leads", strings.NewReader(string(encoded)))
	request.SetPathValue("sessionID", sessionID)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Garuda-Session-Token", sessionToken)
	response := httptest.NewRecorder()
	server.widgetLead(response, request)
	return response
}

func TestAVisitorCannotStoreAnUnboundedCaptureID(t *testing.T) {
	server, dataStore := newTestServer(t)
	sessionID, sessionToken := seedLeadBoundsFixture(t, dataStore)

	response := postLead(t, server, sessionID, sessionToken, map[string]any{
		"client_capture_id": strings.Repeat("a", 400_000),
		"fields":            map[string]string{"email": "visitor@example.com"},
		"consent":           map[string]any{"granted": true},
	})
	if response.Code != http.StatusUnprocessableEntity {
		t.Fatalf("a 400KB capture id was accepted with %d", response.Code)
	}
	assertNothingHugeWasStored(t, dataStore)
}

func TestAVisitorCannotStoreAnUnboundedNoticeVersion(t *testing.T) {
	server, dataStore := newTestServer(t)
	sessionID, sessionToken := seedLeadBoundsFixture(t, dataStore)

	response := postLead(t, server, sessionID, sessionToken, map[string]any{
		"fields":  map[string]string{"email": "visitor@example.com"},
		"consent": map[string]any{"granted": true, "notice_version": strings.Repeat("v", 400_000)},
	})
	if response.Code != http.StatusUnprocessableEntity {
		t.Fatalf("a 400KB notice version was accepted with %d", response.Code)
	}
	assertNothingHugeWasStored(t, dataStore)
}

// A capture id is an opaque client identifier used for idempotency. Anything
// that is not one of those is refused, so it can be stored and compared without
// anybody having to reason about what a visitor put in it.
func TestCaptureIDMustLookLikeAnIdentifier(t *testing.T) {
	server, dataStore := newTestServer(t)
	sessionID, sessionToken := seedLeadBoundsFixture(t, dataStore)

	response := postLead(t, server, sessionID, sessionToken, map[string]any{
		"client_capture_id": "<script>alert(1)</script>",
		"fields":            map[string]string{"email": "visitor@example.com"},
		"consent":           map[string]any{"granted": true},
	})
	if response.Code != http.StatusUnprocessableEntity {
		t.Fatalf("a capture id that is not an identifier was accepted with %d", response.Code)
	}
}

// The bound must not have broken the ordinary case: a UUID is 36 characters and
// has to keep working, because it is what the widget actually sends.
func TestAnOrdinaryCaptureIDIsStillAccepted(t *testing.T) {
	server, dataStore := newTestServer(t)
	sessionID, sessionToken := seedLeadBoundsFixture(t, dataStore)

	response := postLead(t, server, sessionID, sessionToken, map[string]any{
		"client_capture_id": "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
		"fields":            map[string]string{"email": "visitor@example.com"},
		"consent":           map[string]any{"granted": true, "notice_version": "2026-08-01"},
	})
	if response.Code != http.StatusCreated {
		t.Fatalf("an ordinary lead was rejected with %d: %s", response.Code, response.Body.String())
	}
}

// The size of the persisted state is the thing that actually matters, so it is
// what the test measures rather than any single field's length.
func assertNothingHugeWasStored(t *testing.T, dataStore *store.FileStore) {
	t.Helper()
	var size int
	if err := dataStore.View(func(state *model.State) error {
		encoded, err := json.Marshal(state)
		if err != nil {
			return err
		}
		size = len(encoded)
		return nil
	}); err != nil {
		t.Fatalf("view: %v", err)
	}
	if size > 64_000 {
		t.Fatalf("one rejected request grew the persisted state to %d bytes", size)
	}
}

// Authorization comes before validation on every widget route. An anonymous
// caller being told about the consent rule, or the shape of the request, is
// telling somebody about an API they were never entitled to call -- and it costs
// a JSON decode for every probe.
func TestWidgetRoutesAuthorizeBeforeTheyValidate(t *testing.T) {
	server, dataStore := newTestServer(t)
	sessionID, _ := seedLeadBoundsFixture(t, dataStore)

	cases := map[string]http.HandlerFunc{
		"lead":    server.widgetLead,
		"message": server.widgetMessage,
	}
	for name, handler := range cases {
		// A body that would certainly fail validation, sent with no session token.
		// The answer must be about the session, not about the body.
		request := httptest.NewRequest(http.MethodPost, "/widget/v1/sessions/"+sessionID+"/x", strings.NewReader(`{"content":"","fields":{}}`))
		request.SetPathValue("sessionID", sessionID)
		request.Header.Set("Content-Type", "application/json")
		response := httptest.NewRecorder()
		handler(response, request)

		if response.Code != http.StatusUnauthorized {
			t.Errorf("%s: an anonymous caller got %d, want 401", name, response.Code)
		}
		if strings.Contains(response.Body.String(), "consent") || strings.Contains(response.Body.String(), "characters") {
			t.Errorf("%s: the refusal described the request body: %s", name, response.Body.String())
		}
	}
}
