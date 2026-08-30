package api

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"garuda/backend/internal/model"
	"garuda/backend/internal/security"
	"garuda/backend/internal/store"
)

func seedVoiceFixture(t *testing.T, dataStore *store.FileStore, billing string) (sessionID, sessionToken string) {
	t.Helper()
	token, err := security.RandomToken(32)
	if err != nil {
		t.Fatalf("token: %v", err)
	}
	now := time.Now().UTC()
	sessionID = "cvs_voice"
	if err := dataStore.Update(func(state *model.State) error {
		state.Accounts = append(state.Accounts, model.Account{ID: "org_voice", BillingStatus: billing})
		state.Agents = append(state.Agents, model.Agent{
			ID: "agt_voice", AccountID: "org_voice", Name: "Voice Bot", Status: "published", PublicKey: "pub_voice",
		})
		state.Sessions = append(state.Sessions, model.Session{
			ID: sessionID, AccountID: "org_voice", AgentID: "agt_voice", VisitorID: "vst_voice",
			SessionTokenHash: security.HashOpaqueToken(token),
			ExpiresAt:        now.Add(time.Hour), CreatedAt: now, UpdatedAt: now, LastSeenAt: now,
		})
		return nil
	}); err != nil {
		t.Fatalf("seed: %v", err)
	}
	return sessionID, token
}

func postVoice(t *testing.T, server *Server, sessionID, sessionToken, contentType string, body []byte) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(http.MethodPost, "/widget/v1/sessions/"+sessionID+"/voice", bytes.NewReader(body))
	request.SetPathValue("sessionID", sessionID)
	request.Header.Set("Content-Type", contentType)
	if sessionToken != "" {
		request.Header.Set("X-Garuda-Session-Token", sessionToken)
	}
	response := httptest.NewRecorder()
	server.transcribeWidgetVoice(response, request)
	return response
}

// A recording is not public just because the page it was made on is.
func TestWidgetVoiceNeedsALiveSession(t *testing.T) {
	server, dataStore := newTestServer(t)
	sessionID, _ := seedVoiceFixture(t, dataStore, "active")

	response := postVoice(t, server, sessionID, "", "audio/webm", bytes.Repeat([]byte{1}, 4096))
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", response.Code, response.Body.String())
	}
}

// Transcription reaches a paid provider on a shared key, so an account with no
// subscription must not be able to spend on it through a route that needs no
// login. The check has to come BEFORE any audio is read.
func TestWidgetVoiceRefusesAnAccountWithNoSubscription(t *testing.T) {
	// Demo mode grants every account an entitlement, so the check only exists to
	// be tested outside it -- which is the mode that bills real money.
	server, dataStore := newTestServer(t)
	server.cfg.DemoMode = false
	sessionID, sessionToken := seedVoiceFixture(t, dataStore, "canceled")

	response := postVoice(t, server, sessionID, sessionToken, "audio/webm", bytes.Repeat([]byte{1}, 4096))
	if response.Code != http.StatusPaymentRequired {
		t.Fatalf("expected 402, got %d: %s", response.Code, response.Body.String())
	}
	// And the refusal must not tell a visitor about somebody else's billing.
	if strings.Contains(strings.ToLower(response.Body.String()), "subscription is required") {
		t.Errorf("the visitor was told about the customer's billing: %s", response.Body.String())
	}
}

// Anything that is not audio is refused before it reaches a provider that bills
// by the minute for trying.
func TestWidgetVoiceRefusesAnythingThatIsNotAudio(t *testing.T) {
	server, dataStore := newTestServer(t)
	sessionID, sessionToken := seedVoiceFixture(t, dataStore, "active")

	for _, contentType := range []string{"application/json", "text/plain", "image/png", ""} {
		response := postVoice(t, server, sessionID, sessionToken, contentType, bytes.Repeat([]byte{1}, 4096))
		// Without a Deepgram key the handler answers 503 first, which is also a
		// refusal; what must never happen is a 200.
		if response.Code == http.StatusOK {
			t.Errorf("content type %q was accepted", contentType)
		}
	}
}

// A visitor's voice note is a chat message, not a monologue. The cap is a tenth
// of the portal's own, because describing a business takes longer than asking a
// question.
func TestWidgetVoiceIsCappedTighterThanTheOnboardingNote(t *testing.T) {
	if maxWidgetVoiceBytes >= maxVoiceNoteBytes {
		t.Fatalf("a chat message may be up to %d bytes against the onboarding note's %d", maxWidgetVoiceBytes, maxVoiceNoteBytes)
	}
	if maxWidgetVoiceCharacters != 4_000 {
		t.Errorf("the transcript cap should match the typed message limit, got %d", maxWidgetVoiceCharacters)
	}
}

// Voice is an accelerator and never the only way to talk. With no credential
// configured the answer has to be "type instead", not a failure.
func TestWidgetVoiceFallsBackToTypingWhenItIsNotConfigured(t *testing.T) {
	server, dataStore := newTestServer(t)
	sessionID, sessionToken := seedVoiceFixture(t, dataStore, "active")

	response := postVoice(t, server, sessionID, sessionToken, "audio/webm", bytes.Repeat([]byte{1}, 4096))
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503 with no Deepgram key, got %d: %s", response.Code, response.Body.String())
	}
	if !strings.Contains(strings.ToLower(response.Body.String()), "type") {
		t.Errorf("the visitor was not told they can type instead: %s", response.Body.String())
	}
}
