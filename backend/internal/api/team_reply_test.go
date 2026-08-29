package api

import (
	"context"
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

func seedReplyFixture(t *testing.T, dataStore *store.FileStore) (sessionID, sessionToken string) {
	t.Helper()
	token, err := security.RandomToken(32)
	if err != nil {
		t.Fatalf("token: %v", err)
	}
	now := time.Now().UTC()
	sessionID = "cvs_reply_one"
	if err := dataStore.Update(func(state *model.State) error {
		state.Accounts = append(state.Accounts,
			model.Account{ID: "org_reply", BillingStatus: "active"},
			model.Account{ID: "org_other", BillingStatus: "active"},
		)
		state.Agents = append(state.Agents, model.Agent{
			ID: "agt_reply", AccountID: "org_reply", Name: "Reply Bot", Status: "published", PublicKey: "pub_reply",
		})
		state.Sessions = append(state.Sessions, model.Session{
			ID: sessionID, AccountID: "org_reply", AgentID: "agt_reply", VisitorID: "vst_reply",
			SessionTokenHash: security.HashOpaqueToken(token),
			ExpiresAt:        now.Add(time.Hour), CreatedAt: now, UpdatedAt: now, LastSeenAt: now,
		})
		state.Messages = append(state.Messages, model.Message{
			ID: "msg_first", AccountID: "org_reply", AgentID: "agt_reply", SessionID: sessionID,
			VisitorID: "vst_reply", Role: "user", Content: "is anyone there?", CreatedAt: now,
		})
		return nil
	}); err != nil {
		t.Fatalf("seed: %v", err)
	}
	return sessionID, token
}

func postReply(t *testing.T, server *Server, sessionID, accountID, body string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(http.MethodPost, "/v1/conversations/"+sessionID+"/messages", strings.NewReader(body))
	request.SetPathValue("sessionID", sessionID)
	request.Header.Set("Content-Type", "application/json")
	request = request.WithContext(context.WithValue(request.Context(), identityKey, Identity{UserID: "usr_owner", AccountID: accountID, Role: "owner"}))
	response := httptest.NewRecorder()
	server.postTeamReply(response, request)
	return response
}

func pollMessages(t *testing.T, server *Server, sessionID, sessionToken, after string) *httptest.ResponseRecorder {
	t.Helper()
	target := "/widget/v1/sessions/" + sessionID + "/messages"
	if after != "" {
		target += "?after=" + after
	}
	request := httptest.NewRequest(http.MethodGet, target, nil)
	request.SetPathValue("sessionID", sessionID)
	request.Header.Set("X-Garuda-Session-Token", sessionToken)
	response := httptest.NewRecorder()
	server.pollWidgetMessages(response, request)
	return response
}

// The whole point: what the owner types has to reach the visitor's widget.
func TestTeamReplyReachesTheVisitorsNextPoll(t *testing.T) {
	server, dataStore := newTestServer(t)
	sessionID, sessionToken := seedReplyFixture(t, dataStore)

	created := postReply(t, server, sessionID, "org_reply", `{"content":"Yes -- Priya here, how can I help?"}`)
	if created.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", created.Code, created.Body.String())
	}

	polled := pollMessages(t, server, sessionID, sessionToken, "msg_first")
	if polled.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", polled.Code, polled.Body.String())
	}
	var envelope struct {
		Data struct {
			Messages []struct {
				ID      string `json:"id"`
				Role    string `json:"role"`
				Content string `json:"content"`
			} `json:"messages"`
		} `json:"data"`
	}
	if err := json.Unmarshal(polled.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(envelope.Data.Messages) != 1 {
		t.Fatalf("expected exactly the one new message, got %d: %s", len(envelope.Data.Messages), polled.Body.String())
	}
	if envelope.Data.Messages[0].Content != "Yes -- Priya here, how can I help?" {
		t.Errorf("wrong content: %q", envelope.Data.Messages[0].Content)
	}
	// The widget renders assistant turns and the model reads them as its own
	// prior context. A third role would need every consumer taught about it.
	if envelope.Data.Messages[0].Role != "assistant" {
		t.Errorf("role = %q, want assistant", envelope.Data.Messages[0].Role)
	}
}

// A cursor the visitor already holds must not hand them the same message twice.
func TestPollReturnsNothingWhenTheVisitorIsUpToDate(t *testing.T) {
	server, dataStore := newTestServer(t)
	sessionID, sessionToken := seedReplyFixture(t, dataStore)

	postReply(t, server, sessionID, "org_reply", `{"content":"first reply"}`)

	first := pollMessages(t, server, sessionID, sessionToken, "msg_first")
	var envelope struct {
		Data struct {
			Messages []struct {
				ID string `json:"id"`
			} `json:"messages"`
		} `json:"data"`
	}
	if err := json.Unmarshal(first.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(envelope.Data.Messages) != 1 {
		t.Fatalf("setup: expected one message, got %d", len(envelope.Data.Messages))
	}

	second := pollMessages(t, server, sessionID, sessionToken, envelope.Data.Messages[0].ID)
	var repeat struct {
		Data struct {
			Messages []json.RawMessage `json:"messages"`
		} `json:"data"`
	}
	if err := json.Unmarshal(second.Body.Bytes(), &repeat); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(repeat.Data.Messages) != 0 {
		t.Fatalf("the same reply was delivered twice: %s", second.Body.String())
	}
}

// Cross-tenant access is a 404, never a 403: a session id from another
// workspace must be indistinguishable from one that does not exist.
func TestTeamReplyRefusesAConversationFromAnotherWorkspace(t *testing.T) {
	server, dataStore := newTestServer(t)
	sessionID, _ := seedReplyFixture(t, dataStore)

	response := postReply(t, server, sessionID, "org_other", `{"content":"not mine to answer"}`)
	if response.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", response.Code, response.Body.String())
	}
	if strings.Contains(response.Body.String(), "forbidden") {
		t.Error("the response distinguishes a foreign conversation from a missing one")
	}

	written := 0
	if err := dataStore.View(func(state *model.State) error {
		for _, message := range state.Messages {
			if message.Content == "not mine to answer" {
				written++
			}
		}
		return nil
	}); err != nil {
		t.Fatalf("view: %v", err)
	}
	if written != 0 {
		t.Fatal("a rejected cross-tenant reply was still written to the conversation")
	}
}

func TestTeamReplyRejectsEmptyAndOversizedContent(t *testing.T) {
	server, dataStore := newTestServer(t)
	sessionID, _ := seedReplyFixture(t, dataStore)

	for name, body := range map[string]string{
		"empty":      `{"content":""}`,
		"whitespace": `{"content":"   \n  "}`,
		"oversized":  `{"content":"` + strings.Repeat("x", maxTeamReplyLength+1) + `"}`,
	} {
		response := postReply(t, server, sessionID, "org_reply", body)
		if response.Code != http.StatusUnprocessableEntity {
			t.Errorf("%s: expected 422, got %d", name, response.Code)
		}
	}
}

// The poll is behind the session token for the same reason every other widget
// route is: a conversation is not public just because the page it lives on is.
func TestPollRequiresTheSessionToken(t *testing.T) {
	server, dataStore := newTestServer(t)
	sessionID, _ := seedReplyFixture(t, dataStore)

	response := pollMessages(t, server, sessionID, "not-the-real-token", "")
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", response.Code, response.Body.String())
	}
}

// A cursor from a conversation that was reset must not replay the whole
// transcript into a panel the visitor thought they had cleared.
func TestPollWithAnUnknownCursorReturnsTheTailNotEverything(t *testing.T) {
	server, dataStore := newTestServer(t)
	sessionID, sessionToken := seedReplyFixture(t, dataStore)

	now := time.Now().UTC()
	if err := dataStore.Update(func(state *model.State) error {
		for index := 0; index < widgetPollLimit+10; index++ {
			state.Messages = append(state.Messages, model.Message{
				ID: newID("msg_"), AccountID: "org_reply", AgentID: "agt_reply", SessionID: sessionID,
				VisitorID: "vst_reply", Role: "assistant", Content: "filler",
				CreatedAt: now.Add(time.Duration(index) * time.Second),
			})
		}
		return nil
	}); err != nil {
		t.Fatalf("seed: %v", err)
	}

	response := pollMessages(t, server, sessionID, sessionToken, "msg_from_a_previous_life")
	var envelope struct {
		Data struct {
			Messages []json.RawMessage `json:"messages"`
		} `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(envelope.Data.Messages) > widgetPollLimit {
		t.Fatalf("one poll returned %d messages, past the %d cap", len(envelope.Data.Messages), widgetPollLimit)
	}
}

// A cursor is echoed into no output, but it is visitor-controlled input and is
// bounded like every other such value in this service.
func TestPollRejectsAMalformedCursor(t *testing.T) {
	server, dataStore := newTestServer(t)
	sessionID, sessionToken := seedReplyFixture(t, dataStore)

	response := pollMessages(t, server, sessionID, sessionToken, "not%20a%20message%20id%3Cscript%3E")
	if response.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422, got %d: %s", response.Code, response.Body.String())
	}
}
