package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"garuda/backend/internal/model"
	"garuda/backend/internal/security"
	"garuda/backend/internal/store"
)

func seedResetFixture(t *testing.T, dataStore *store.FileStore) (agentKey, sessionID, sessionToken string) {
	t.Helper()
	token, err := security.RandomToken(32)
	if err != nil {
		t.Fatalf("token: %v", err)
	}
	now := time.Now().UTC()
	agentKey = "pub_reset_key"
	sessionID = "cvs_reset_one"
	if err := dataStore.Update(func(state *model.State) error {
		state.Accounts = append(state.Accounts, model.Account{ID: "org_reset", BillingStatus: "active"})
		state.Agents = append(state.Agents, model.Agent{
			ID: "agt_reset", AccountID: "org_reset", Name: "Reset Bot", Status: "published",
			PublicKey: agentKey, WelcomeMessage: "Hi there!",
		})
		state.Sessions = append(state.Sessions, model.Session{
			ID: sessionID, AccountID: "org_reset", AgentID: "agt_reset", VisitorID: "vst_reset",
			SessionTokenHash: security.HashOpaqueToken(token), MemoryConsent: true,
			ExpiresAt: now.Add(time.Hour), CreatedAt: now, UpdatedAt: now, LastSeenAt: now,
		})
		state.Messages = append(state.Messages, model.Message{
			ID: "msg_old", AccountID: "org_reset", AgentID: "agt_reset", SessionID: sessionID,
			VisitorID: "vst_reset", Role: "user", Content: "the earlier conversation", CreatedAt: now,
		})
		return nil
	}); err != nil {
		t.Fatalf("seed: %v", err)
	}
	return agentKey, sessionID, token
}

// A visitor must be able to start over without clearing site data.
func TestResetWidgetSessionStartsAFreshConversation(t *testing.T) {
	server, dataStore := newTestServer(t)
	_, sessionID, sessionToken := seedResetFixture(t, dataStore)

	request := httptest.NewRequest(http.MethodPost, "/widget/v1/sessions/"+sessionID+"/reset", nil)
	request.SetPathValue("sessionID", sessionID)
	request.Header.Set("X-Garuda-Session-Token", sessionToken)
	response := httptest.NewRecorder()
	server.resetWidgetSession(response, request)

	if response.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", response.Code, response.Body.String())
	}
	var envelope struct {
		Data struct {
			SessionID    string `json:"session_id"`
			SessionToken string `json:"session_token"`
			Conversation struct {
				Resumed  bool `json:"resumed"`
				Messages []struct {
					Content string `json:"content"`
				} `json:"messages"`
			} `json:"conversation"`
		} `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if envelope.Data.SessionID == sessionID {
		t.Error("reset returned the same session id")
	}
	if envelope.Data.SessionToken == sessionToken {
		t.Error("reset reused the old session token")
	}
	if envelope.Data.Conversation.Resumed {
		t.Error("a reset conversation must not be marked resumed")
	}
	// The new thread starts with the welcome message and nothing else.
	if len(envelope.Data.Conversation.Messages) != 1 || envelope.Data.Conversation.Messages[0].Content != "Hi there!" {
		t.Errorf("expected only the welcome message, got %+v", envelope.Data.Conversation.Messages)
	}

	_ = dataStore.View(func(state *model.State) error {
		for _, session := range state.Sessions {
			if session.ID == sessionID && session.ExpiresAt.After(time.Now()) {
				t.Error("the old session is still live and could be resumed")
			}
		}
		// The earlier transcript must survive for the customer's inbox.
		kept := false
		for _, message := range state.Messages {
			if message.ID == "msg_old" {
				kept = true
			}
		}
		if !kept {
			t.Error("reset destroyed the previous transcript")
		}
		return nil
	})
}

// Reset is a privileged action on someone's conversation; it needs the token.
func TestResetWidgetSessionRequiresTheSessionToken(t *testing.T) {
	server, dataStore := newTestServer(t)
	_, sessionID, _ := seedResetFixture(t, dataStore)

	for _, token := range []string{"", "wrong-token"} {
		request := httptest.NewRequest(http.MethodPost, "/widget/v1/sessions/"+sessionID+"/reset", nil)
		request.SetPathValue("sessionID", sessionID)
		if token != "" {
			request.Header.Set("X-Garuda-Session-Token", token)
		}
		response := httptest.NewRecorder()
		server.resetWidgetSession(response, request)
		if response.Code != http.StatusUnauthorized {
			t.Errorf("token %q: expected 401, got %d", token, response.Code)
		}
	}
}
