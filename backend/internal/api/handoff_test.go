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

func seedHandoffFixture(t *testing.T, dataStore *store.FileStore, handoff model.HandoffConfig) (agentKey, sessionID, sessionToken string) {
	t.Helper()
	token, err := security.RandomToken(32)
	if err != nil {
		t.Fatalf("token: %v", err)
	}
	now := time.Now().UTC()
	agentKey = "pub_handoff_key"
	sessionID = "cvs_handoff_one"
	if err := dataStore.Update(func(state *model.State) error {
		state.Accounts = append(state.Accounts, model.Account{ID: "org_handoff", BillingStatus: "active"})
		state.Agents = append(state.Agents, model.Agent{
			ID: "agt_handoff", AccountID: "org_handoff", Name: "Handoff Bot", Status: "published",
			PublicKey: agentKey, WelcomeMessage: "Hi there!", Handoff: handoff,
		})
		state.Sessions = append(state.Sessions, model.Session{
			ID: sessionID, AccountID: "org_handoff", AgentID: "agt_handoff", VisitorID: "vst_handoff",
			SessionTokenHash: security.HashOpaqueToken(token), MemoryConsent: true,
			PageURL:   "https://example.com/pricing",
			ExpiresAt: now.Add(time.Hour), CreatedAt: now, UpdatedAt: now, LastSeenAt: now,
		})
		return nil
	}); err != nil {
		t.Fatalf("seed: %v", err)
	}
	return agentKey, sessionID, token
}

func postHandoff(t *testing.T, server *Server, sessionID, sessionToken string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(http.MethodPost, "/widget/v1/sessions/"+sessionID+"/handoff", nil)
	request.SetPathValue("sessionID", sessionID)
	request.Header.Set("X-Garuda-Session-Token", sessionToken)
	response := httptest.NewRecorder()
	server.startWidgetHandoff(response, request)
	return response
}

// The point of the whole feature: a visitor gets a WhatsApp link that reaches
// the site owner, with the page they were on pre-typed for context.
func TestHandoffReturnsAWhatsAppLinkForTheOwner(t *testing.T) {
	server, dataStore := newTestServer(t)
	_, sessionID, sessionToken := seedHandoffFixture(t, dataStore, model.HandoffConfig{
		Enabled: true, WhatsAppNumber: "919876543210", ButtonLabel: "Chat with Priya",
		Message: "Hi, I have a question", Availability: "Mon-Fri, 9am-6pm IST",
	})

	response := postHandoff(t, server, sessionID, sessionToken)
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
	}
	var envelope struct {
		Data struct {
			Channel      string `json:"channel"`
			URL          string `json:"url"`
			Label        string `json:"label"`
			Availability string `json:"availability"`
		} `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if envelope.Data.Channel != "whatsapp" {
		t.Errorf("channel = %q", envelope.Data.Channel)
	}
	if !strings.HasPrefix(envelope.Data.URL, "https://wa.me/919876543210?") {
		t.Errorf("link does not address the owner's number: %s", envelope.Data.URL)
	}
	if !strings.Contains(envelope.Data.URL, "example.com") {
		t.Errorf("link drops the page the visitor was on: %s", envelope.Data.URL)
	}
	if envelope.Data.Label != "Chat with Priya" || envelope.Data.Availability != "Mon-Fri, 9am-6pm IST" {
		t.Errorf("label/availability not returned: %+v", envelope.Data)
	}
}

// The owner's phone number is personal data. The bootstrap is a public document
// served to any allowed origin, so the number must not be reachable from it --
// only the fact that a handoff exists.
func TestPublicAgentNeverCarriesTheOwnersNumber(t *testing.T) {
	agent := model.Agent{
		Name: "Handoff Bot",
		Handoff: model.HandoffConfig{
			Enabled: true, WhatsAppNumber: "919876543210",
			Message: "text", NotifyEmail: "owner@example.com",
		},
	}
	encoded, err := json.Marshal(publicAgent(agent))
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if strings.Contains(string(encoded), "919876543210") {
		t.Fatalf("the widget bootstrap leaks the owner's WhatsApp number: %s", encoded)
	}
	if strings.Contains(string(encoded), "owner@example.com") {
		t.Fatalf("the widget bootstrap leaks the owner's notification address: %s", encoded)
	}
	if !strings.Contains(string(encoded), `"handoff"`) {
		t.Fatalf("the widget is never told a handoff is available: %s", encoded)
	}
}

// A configuration switched on but missing a number would render a button that
// goes nowhere, so it must not be reachable.
func TestHandoffWithoutANumberIsNotOffered(t *testing.T) {
	server, dataStore := newTestServer(t)
	_, sessionID, sessionToken := seedHandoffFixture(t, dataStore, model.HandoffConfig{Enabled: true})

	response := postHandoff(t, server, sessionID, sessionToken)
	if response.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", response.Code, response.Body.String())
	}
}

// Without a session token the link is not obtainable at all, which is what keeps
// the number off a scraper's shopping list.
func TestHandoffRequiresALiveSession(t *testing.T) {
	server, dataStore := newTestServer(t)
	_, sessionID, _ := seedHandoffFixture(t, dataStore, model.HandoffConfig{
		Enabled: true, WhatsAppNumber: "919876543210",
	})

	response := postHandoff(t, server, sessionID, "not-the-real-token")
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", response.Code, response.Body.String())
	}
}

// Tapping twice must still hand the visitor their link, but the owner is told
// once. The stored record is the marker, so it survives a restart.
func TestHandoffRecordsTheConversationOnceButAlwaysReturnsTheLink(t *testing.T) {
	server, dataStore := newTestServer(t)
	_, sessionID, sessionToken := seedHandoffFixture(t, dataStore, model.HandoffConfig{
		Enabled: true, WhatsAppNumber: "919876543210",
	})

	for attempt := 0; attempt < 3; attempt++ {
		if code := postHandoff(t, server, sessionID, sessionToken).Code; code != http.StatusOK {
			t.Fatalf("attempt %d: expected 200, got %d", attempt, code)
		}
	}

	handoffRecords := 0
	if err := dataStore.View(func(state *model.State) error {
		for _, message := range state.Messages {
			if message.SessionID == sessionID && message.Metadata != nil && message.Metadata["event"] == handoffEventName {
				handoffRecords++
			}
		}
		return nil
	}); err != nil {
		t.Fatalf("view: %v", err)
	}
	if handoffRecords != 1 {
		t.Fatalf("expected exactly one handoff record, got %d", handoffRecords)
	}
}

// The handoff note is bookkeeping for the owner's inbox. Replaying it to the
// visitor, or feeding it to the model as conversation, would both be wrong.
func TestHandoffRecordIsNotReplayedToTheVisitor(t *testing.T) {
	messages := []model.Message{
		{ID: "msg_1", Role: "user", Content: "hello"},
		{ID: "msg_2", Role: "system", Content: "The visitor asked to continue with a person on WhatsApp."},
	}
	visible := publicWidgetHistory(messages, 30)
	for _, message := range visible {
		if message.Role == "system" {
			t.Fatalf("the handoff record was replayed into the widget transcript: %+v", message)
		}
	}
	if len(visible) != 1 {
		t.Fatalf("expected the visitor's own message to survive, got %d", len(visible))
	}
}

// Owners paste the number off their own phone, in their own country's format.
func TestWhatsAppNumberAcceptsTheFormatsPeopleActuallyPaste(t *testing.T) {
	for _, typed := range []string{"+91 98765 43210", "(919) 876-543210", "+91-98765-43210"} {
		handoff := model.HandoffConfig{Enabled: true, WhatsAppNumber: typed}
		normalizeHandoff(&handoff)
		details := map[string]string{}
		validateHandoff(handoff, details)
		if len(details) != 0 {
			t.Errorf("%q was rejected: %v", typed, details)
		}
	}
}

// A leading zero is a national trunk prefix. wa.me accepts the link and then
// silently fails to open a chat, so it has to be caught here.
func TestHandoffRejectsUnusableNumbers(t *testing.T) {
	for name, number := range map[string]string{
		"trunk prefix": "09876543210",
		"too short":    "12345",
		"too long":     "1234567890123456",
	} {
		handoff := model.HandoffConfig{Enabled: true, WhatsAppNumber: number}
		normalizeHandoff(&handoff)
		details := map[string]string{}
		validateHandoff(handoff, details)
		if details["handoff.whatsapp_number"] == "" {
			t.Errorf("%s (%q) was accepted", name, number)
		}
	}
}

// Switching the feature on without a number is the mistake an owner is most
// likely to make, and it must be caught at save time rather than by a visitor.
func TestEnablingHandoffWithoutANumberFailsValidation(t *testing.T) {
	handoff := model.HandoffConfig{Enabled: true}
	normalizeHandoff(&handoff)
	details := map[string]string{}
	validateHandoff(handoff, details)
	if details["handoff.whatsapp_number"] == "" {
		t.Fatal("handoff was allowed to be enabled with no number")
	}
}

// Clone exists so a caller cannot reach back into live store state through the
// slice header a plain struct copy would share.
func TestHandoffCloneDoesNotShareTriggerPhrases(t *testing.T) {
	original := model.HandoffConfig{TriggerPhrases: []string{"human", "agent"}}
	cloned := original.Clone()
	cloned.TriggerPhrases[0] = "mutated"
	if original.TriggerPhrases[0] != "human" {
		t.Fatal("Clone shares the trigger phrase slice with the original")
	}
}
