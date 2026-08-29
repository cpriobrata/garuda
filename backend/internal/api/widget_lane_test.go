package api

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"garuda/backend/internal/config"
	"garuda/backend/internal/model"
	"garuda/backend/internal/store"
)

// newWidgetLaneServer builds a server whose demo mode can be turned off, because
// demo mode short circuits every entitlement check and would hide the very thing
// the lead capture test is about.
func newWidgetLaneServer(t *testing.T, demoMode bool) (*Server, *store.FileStore) {
	t.Helper()
	dataStore, err := store.OpenFile(filepath.Join(t.TempDir(), "garuda.json"))
	if err != nil {
		t.Fatalf("OpenFile: %v", err)
	}
	configuration := config.Config{
		PublicURL: "http://localhost:8080", JWTSecret: "test-secret-at-least-thirty-two-bytes-long",
		VisitorHMACKey: "visitor-hmac-test-secret", AccessTokenTTL: time.Hour, RefreshTokenTTL: 30 * 24 * time.Hour, PasswordResetTTL: time.Hour,
		AllowedOrigins: []string{"http://localhost:3000"}, DemoMode: demoMode,
		LLMBaseURL: "https://api.openai.com/v1", LLMModel: "test-model",
	}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	return New(configuration, dataStore, logger), dataStore
}

func widgetLaneSeedAgent(t *testing.T, dataStore *store.FileStore, billingStatus string, allowedDomains []string) model.Agent {
	t.Helper()
	now := time.Now().UTC()
	account := model.Account{ID: "org_widget_lane", Name: "Widget lane", BillingStatus: billingStatus, CreatedAt: now, UpdatedAt: now}
	agent := model.Agent{
		ID: "agt_widget_lane", AccountID: account.ID, Name: "Assistant", PublicKey: "pub_widget_lane", Status: "published",
		LeadCapture: model.LeadCaptureConfig{Enabled: true, AfterTurns: 1, Prompt: "Share your details", Fields: []string{"name", "email"}},
		Branding:    model.BrandingConfig{PrimaryColor: "#111827", AccentColor: "#F97316", Position: "bottom_right", AllowedDomains: allowedDomains},
		CreatedAt:   now, UpdatedAt: now,
	}
	if err := dataStore.Update(func(state *model.State) error {
		state.Accounts = append(state.Accounts, account)
		state.Agents = append(state.Agents, agent)
		return nil
	}); err != nil {
		t.Fatalf("seed widget lane agent: %v", err)
	}
	return agent
}

func widgetLaneBootstrap(t *testing.T, handler http.Handler, agentKey, origin string) (string, string) {
	t.Helper()
	response := performJSON(t, handler, http.MethodPost, "/widget/v1/sessions", "", origin, map[string]any{
		"agent_key": agentKey, "consent": map[string]bool{"memory": false},
	})
	data := dataFrom(t, response, http.StatusCreated)
	sessionID, _ := data["session_id"].(string)
	sessionToken, _ := data["session_token"].(string)
	if sessionID == "" || sessionToken == "" {
		t.Fatalf("widget bootstrap returned no session material: %s", response.Body.String())
	}
	return sessionID, sessionToken
}

func widgetLanePost(t *testing.T, handler http.Handler, path, origin, sessionToken, accept, body string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(http.MethodPost, path, bytes.NewBufferString(body))
	request.Header.Set("Content-Type", "application/json")
	if origin != "" {
		request.Header.Set("Origin", origin)
	}
	if sessionToken != "" {
		request.Header.Set("X-Garuda-Session-Token", sessionToken)
	}
	if accept != "" {
		request.Header.Set("Accept", accept)
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

func widgetLaneLeads(t *testing.T, dataStore *store.FileStore) []model.Lead {
	t.Helper()
	var leads []model.Lead
	_ = dataStore.View(func(state *model.State) error {
		for _, lead := range state.Leads {
			leads = append(leads, lead.Clone())
		}
		return nil
	})
	return leads
}

// TestWidgetLeadCaptureRequiresAnEntitledAccount covers the surface that had no
// entitlement check at all: a workspace whose subscription lapsed could keep
// collecting contact details for as long as one issued session token lived.
func TestWidgetLeadCaptureRequiresAnEntitledAccount(t *testing.T) {
	server, dataStore := newWidgetLaneServer(t, false)
	agent := widgetLaneSeedAgent(t, dataStore, "active", []string{"customer.example"})
	handler := server.Handler()
	origin := "https://customer.example"
	sessionID, sessionToken := widgetLaneBootstrap(t, handler, agent.PublicKey, origin)
	leadPath := "/widget/v1/sessions/" + sessionID + "/leads"

	entitled := widgetLanePost(t, handler, leadPath, origin, sessionToken, "",
		`{"client_capture_id":"cap_entitled","fields":{"name":"Ravi","email":"ravi@example.com"},"consent":{"granted":true,"notice_version":"garuda-widget-v1"}}`)
	dataFrom(t, entitled, http.StatusCreated)

	if err := dataStore.Update(func(state *model.State) error {
		for index := range state.Accounts {
			if state.Accounts[index].ID == agent.AccountID {
				state.Accounts[index].BillingStatus = "past_due"
			}
		}
		return nil
	}); err != nil {
		t.Fatalf("lapse the subscription: %v", err)
	}

	lapsed := widgetLanePost(t, handler, leadPath, origin, sessionToken, "",
		`{"client_capture_id":"cap_lapsed","fields":{"name":"Priya","email":"priya@example.com"},"consent":{"granted":true,"notice_version":"garuda-widget-v1"}}`)
	if lapsed.Code != http.StatusPaymentRequired {
		t.Fatalf("expected a lapsed workspace to be refused with 402, got %d: %s", lapsed.Code, lapsed.Body.String())
	}
	if !strings.Contains(lapsed.Body.String(), "subscription_required") {
		t.Fatalf("expected the subscription_required code, got %s", lapsed.Body.String())
	}
	if stored := widgetLaneLeads(t, dataStore); len(stored) != 1 {
		t.Fatalf("expected the capture from the lapsed workspace to be dropped, stored %d leads", len(stored))
	}
}

type widgetLaneStreamEvent struct {
	name string
	data map[string]any
}

func widgetLaneParseStream(t *testing.T, body string) []widgetLaneStreamEvent {
	t.Helper()
	var events []widgetLaneStreamEvent
	for _, block := range strings.Split(strings.TrimSpace(body), "\n\n") {
		block = strings.TrimSpace(block)
		if block == "" {
			continue
		}
		lines := strings.Split(block, "\n")
		if len(lines) != 2 || !strings.HasPrefix(lines[0], "event: ") || !strings.HasPrefix(lines[1], "data: ") {
			t.Fatalf("unexpected server sent event block: %q", block)
		}
		event := widgetLaneStreamEvent{name: strings.TrimPrefix(lines[0], "event: ")}
		if err := json.Unmarshal([]byte(strings.TrimPrefix(lines[1], "data: ")), &event.data); err != nil {
			t.Fatalf("decode server sent event data: %v", err)
		}
		events = append(events, event)
	}
	return events
}

// TestWidgetMessageStreamUsesTheContractEventNames pins the stream to the names
// and the delta key the integration contract publishes. The exact event count
// matters as much as the names: emitting the old short names alongside the new
// ones would make the shipped widget, which accepts both spellings, append every
// delta twice.
func TestWidgetMessageStreamUsesTheContractEventNames(t *testing.T) {
	server, dataStore := newWidgetLaneServer(t, true)
	agent := widgetLaneSeedAgent(t, dataStore, "active", nil)
	handler := server.Handler()
	origin := "http://localhost:3000"
	sessionID, sessionToken := widgetLaneBootstrap(t, handler, agent.PublicKey, origin)

	response := widgetLanePost(t, handler, "/widget/v1/sessions/"+sessionID+"/messages", origin, sessionToken, "text/event-stream",
		`{"client_message_id":"widget-lane-stream","content":"Hello there"}`)
	if response.Code != http.StatusOK {
		t.Fatalf("expected a streamed reply, got %d: %s", response.Code, response.Body.String())
	}
	if contentType := response.Header().Get("Content-Type"); contentType != "text/event-stream" {
		t.Fatalf("expected a text/event-stream response, got %q", contentType)
	}

	events := widgetLaneParseStream(t, response.Body.String())
	names := make([]string, 0, len(events))
	for _, event := range events {
		names = append(names, event.name)
	}
	if strings.Join(names, ",") != "message.start,message.delta,message.done" {
		t.Fatalf("expected the contract event names exactly once each, got %v", names)
	}
	if messageID, _ := events[0].data["message_id"].(string); messageID == "" {
		t.Fatalf("message.start carried no message_id: %v", events[0].data)
	}
	text, _ := events[1].data["text"].(string)
	if text == "" {
		t.Fatalf("message.delta carried no text: %v", events[1].data)
	}
	if conversationID, _ := events[2].data["conversation_id"].(string); conversationID != sessionID {
		t.Fatalf("message.done carried conversation_id %q, want %q", conversationID, sessionID)
	}
	assistant, _ := events[2].data["assistant_message"].(map[string]any)
	if content, _ := assistant["content"].(string); content != text {
		t.Fatalf("the delta text does not match the assistant message it belongs to")
	}
}

// TestWidgetLeadAcceptsBothDocumentedBodies proves the contract body reaches the
// store instead of being refused by DisallowUnknownFields, and that the body the
// deployed widget sends still works unchanged.
func TestWidgetLeadAcceptsBothDocumentedBodies(t *testing.T) {
	server, dataStore := newWidgetLaneServer(t, true)
	agent := widgetLaneSeedAgent(t, dataStore, "active", nil)
	handler := server.Handler()
	origin := "http://localhost:3000"
	sessionID, sessionToken := widgetLaneBootstrap(t, handler, agent.PublicKey, origin)
	leadPath := "/widget/v1/sessions/" + sessionID + "/leads"

	contract := widgetLanePost(t, handler, leadPath, origin, sessionToken, "",
		`{"client_capture_id":"cap_contract","name":"Ravi Kumar","email":"ravi@example.com","phone":"+919810000000","company":null,`+
			`"custom_fields":{"property_type":"2 bedroom"},"consent":{"contact":true,"privacy_policy":true,"captured_at":"2026-08-29T10:34:00Z"}}`)
	dataFrom(t, contract, http.StatusCreated)

	widget := widgetLanePost(t, handler, leadPath, origin, sessionToken, "",
		`{"client_capture_id":"cap_widget","fields":{"name":"Priya Nair","email":"priya@example.com"},"consent":{"granted":true,"notice_version":"garuda-widget-v1"}}`)
	dataFrom(t, widget, http.StatusCreated)

	leads := widgetLaneLeads(t, dataStore)
	if len(leads) != 2 {
		t.Fatalf("expected both documented bodies to store a lead, stored %d", len(leads))
	}
	fromContract := leads[0]
	if fromContract.Name != "Ravi Kumar" || fromContract.Email != "ravi@example.com" || fromContract.Phone != "+919810000000" {
		t.Fatalf("the top level contract fields did not reach the lead: %+v", fromContract)
	}
	if fromContract.Metadata["custom.property_type"] != "2 bedroom" {
		t.Fatalf("custom_fields were dropped: %v", fromContract.Metadata)
	}
	if fromContract.Metadata["privacy_policy_accepted"] != "true" || fromContract.Metadata["consent_captured_at"] != "2026-08-29T10:34:00Z" {
		t.Fatalf("consent evidence was not recorded: %v", fromContract.Metadata)
	}
	if leads[1].Name != "Priya Nair" || leads[1].Email != "priya@example.com" {
		t.Fatalf("the widget body no longer reaches the lead: %+v", leads[1])
	}

	withoutConsent := widgetLanePost(t, handler, leadPath, origin, sessionToken, "",
		`{"client_capture_id":"cap_no_consent","name":"Anil","email":"anil@example.com","consent":{"contact":false,"privacy_policy":true}}`)
	if withoutConsent.Code != http.StatusUnprocessableEntity || !strings.Contains(withoutConsent.Body.String(), "consent_required") {
		t.Fatalf("expected a contract body without contact consent to be refused, got %d: %s", withoutConsent.Code, withoutConsent.Body.String())
	}
}
