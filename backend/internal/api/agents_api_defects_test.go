package api

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"garuda/backend/internal/model"
	"garuda/backend/internal/store"
)

// agentsAPIWorkspace seeds one entitled account with a single owner and agent,
// and returns the agent together with an access token for that owner.
func agentsAPIWorkspace(t *testing.T, server *Server, dataStore *store.FileStore, suffix string, knowledge []model.KnowledgeItem) (model.Agent, string) {
	t.Helper()
	now := time.Now().UTC()
	account := model.Account{ID: "org_" + suffix, Name: "Workspace", Plan: "starter_17", BillingStatus: "active", CreatedAt: now, UpdatedAt: now}
	user := model.User{ID: "usr_" + suffix, AccountID: account.ID, Name: "Owner", Email: suffix + "@example.com", Role: "owner", CreatedAt: now, UpdatedAt: now}
	agent := model.Agent{
		ID: "agt_" + suffix, AccountID: account.ID, Name: "Website assistant", PublicKey: "pub_live_" + suffix,
		Status: "draft", Revision: 4, Knowledge: knowledge,
		LeadCapture: model.LeadCaptureConfig{Enabled: true, AfterTurns: 3, Fields: []string{"name", "email"}},
		Branding:    model.BrandingConfig{PrimaryColor: "#111827", AccentColor: "#F97316", Position: "bottom_right"},
		CreatedAt:   now, UpdatedAt: now,
	}
	if err := dataStore.Update(func(state *model.State) error {
		state.Accounts = append(state.Accounts, account)
		state.Users = append(state.Users, user)
		state.Agents = append(state.Agents, agent)
		state.Subscriptions = append(state.Subscriptions, model.Subscription{ID: "sub_" + suffix, AccountID: account.ID, Status: "active", Plan: "starter_17", CreatedAt: now, UpdatedAt: now})
		return nil
	}); err != nil {
		t.Fatalf("seed workspace: %v", err)
	}
	token, err := server.issueToken(user)
	if err != nil {
		t.Fatalf("issue token: %v", err)
	}
	return agent, token
}

func performAgentsAPIRequest(t *testing.T, handler http.Handler, method, path, token string, headers map[string]string, body string) *httptest.ResponseRecorder {
	t.Helper()
	var payload io.Reader = http.NoBody
	if body != "" {
		payload = strings.NewReader(body)
	}
	request := httptest.NewRequest(method, path, payload)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", "http://localhost:3000")
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	for name, value := range headers {
		request.Header.Set(name, value)
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

func agentsAPIErrorBody(t *testing.T, response *httptest.ResponseRecorder, status int) map[string]any {
	t.Helper()
	if response.Code != status {
		t.Fatalf("expected status %d, got %d: %s", status, response.Code, response.Body.String())
	}
	var envelope struct {
		Error map[string]any `json:"error"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode error envelope: %v", err)
	}
	return envelope.Error
}

func agentsAPIListBody(t *testing.T, response *httptest.ResponseRecorder, status int) []map[string]any {
	t.Helper()
	if response.Code != status {
		t.Fatalf("expected status %d, got %d: %s", status, response.Code, response.Body.String())
	}
	var envelope struct {
		Data []map[string]any `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode data envelope: %v", err)
	}
	return envelope.Data
}

func agentsAPIStoredAgent(t *testing.T, dataStore *store.FileStore, accountID, agentID string) (int, string) {
	t.Helper()
	revision := 0
	status := ""
	_ = dataStore.View(func(state *model.State) error {
		if agent, ok := findAgent(state, accountID, agentID); ok {
			revision, status = agent.Revision, agent.Status
		}
		return nil
	})
	return revision, status
}

// A 412 that withholds the current revision wedges the agent editor: the client
// is told its revision is stale but never told which revision to send next, so
// every retry fails the same way.
func TestAgentsAPIStaleRevisionReportsTheCurrentRevision(t *testing.T) {
	server, dataStore := newTestServer(t)
	agent, token := agentsAPIWorkspace(t, server, dataStore, "stale", nil)

	response := performAgentsAPIRequest(t, server.Handler(), http.MethodPatch, "/v1/agents/"+agent.ID, token,
		map[string]string{"If-Match": `"2"`}, `{"name":"Renamed assistant"}`)
	body := agentsAPIErrorBody(t, response, http.StatusPreconditionFailed)
	if body["code"] != "stale_revision" {
		t.Fatalf("expected a stale_revision code, got %v", body["code"])
	}
	details, ok := body["details"].(map[string]any)
	if !ok {
		t.Fatalf("412 carried no details, so the client cannot resynchronise: %s", response.Body.String())
	}
	current, ok := details["current_revision"].(float64)
	if !ok || int(current) != 4 {
		t.Fatalf("expected details.current_revision 4, got %v", details["current_revision"])
	}

	// The revision the client was handed must be the one that lets it save.
	retry := performAgentsAPIRequest(t, server.Handler(), http.MethodPatch, "/v1/agents/"+agent.ID, token,
		map[string]string{"If-Match": `"` + strconv.Itoa(int(current)) + `"`}, `{"name":"Renamed assistant"}`)
	if retry.Code != http.StatusOK {
		t.Fatalf("retry with the reported revision failed: %d %s", retry.Code, retry.Body.String())
	}
}

// An If-Match the server cannot parse used to be discarded, which turned a
// conditional write into an unconditional one and let a corrupt header overwrite
// a concurrent edit.
func TestAgentsAPIRejectsUnparseableIfMatch(t *testing.T) {
	server, dataStore := newTestServer(t)
	agent, token := agentsAPIWorkspace(t, server, dataStore, "ifmatch", nil)

	for _, header := range []string{`"abc"`, "not-a-revision", `""`, `"0"`, `"-3"`, `"4`, `"4x"`, `"3", "4"`, `W/"lost"`} {
		response := performAgentsAPIRequest(t, server.Handler(), http.MethodPatch, "/v1/agents/"+agent.ID, token,
			map[string]string{"If-Match": header}, `{"name":"Overwritten by a corrupt header"}`)
		if response.Code != http.StatusBadRequest {
			t.Fatalf("If-Match %q returned %d, want 400: %s", header, response.Code, response.Body.String())
		}
		if body := agentsAPIErrorBody(t, response, http.StatusBadRequest); body["code"] != "invalid_if_match" {
			t.Fatalf("If-Match %q returned code %v, want invalid_if_match", header, body["code"])
		}
	}
	revision, _ := agentsAPIStoredAgent(t, dataStore, agent.AccountID, agent.ID)
	if revision != 4 {
		t.Fatalf("a rejected If-Match still wrote to the agent: revision %d", revision)
	}
	_ = dataStore.View(func(state *model.State) error {
		stored, _ := findAgent(state, agent.AccountID, agent.ID)
		if stored.Name != "Website assistant" {
			t.Fatalf("a rejected If-Match still renamed the agent to %q", stored.Name)
		}
		return nil
	})

	// The tags this API issues, weak or strong, still work, and so does the
	// wildcard, which asks only that the agent still exist.
	for _, accepted := range []string{`"4"`, `W/"5"`, "*"} {
		response := performAgentsAPIRequest(t, server.Handler(), http.MethodPatch, "/v1/agents/"+agent.ID, token,
			map[string]string{"If-Match": accepted}, `{"name":"Website assistant"}`)
		if response.Code != http.StatusOK {
			t.Fatalf("If-Match %q returned %d, want 200: %s", accepted, response.Code, response.Body.String())
		}
	}
}

// Listing agents shipped every knowledge source body, so a workspace with a few
// large sources sent megabytes of text on a request that only needed names.
func TestAgentsAPIListOmitsKnowledgeBodies(t *testing.T) {
	server, dataStore := newTestServer(t)
	body := strings.Repeat("Opening hours and refund policy. ", 400)
	knowledge := []model.KnowledgeItem{
		{ID: "src_first", Type: "text", Status: "ready", Title: "Pricing FAQ", Content: body, CreatedAt: time.Now().UTC()},
		{ID: "src_second", Type: "url", Status: "processing", Title: "Support policy", Content: body, SourceURL: "https://example.com/policy", CreatedAt: time.Now().UTC()},
	}
	agent, token := agentsAPIWorkspace(t, server, dataStore, "list", knowledge)

	response := performAgentsAPIRequest(t, server.Handler(), http.MethodGet, "/v1/agents?page_size=25", token, nil, "")
	items := agentsAPIListBody(t, response, http.StatusOK)
	if len(items) != 1 {
		t.Fatalf("expected one agent, got %d", len(items))
	}
	if strings.Contains(response.Body.String(), "Opening hours and refund policy") {
		t.Fatal("the agent list still carries knowledge source bodies")
	}
	if count, ok := items[0]["knowledge_count"].(float64); !ok || int(count) != 2 {
		t.Fatalf("expected knowledge_count 2, got %v", items[0]["knowledge_count"])
	}
	sources, ok := items[0]["knowledge"].([]any)
	if !ok || len(sources) != 2 {
		t.Fatalf("expected two knowledge summaries, got %v", items[0]["knowledge"])
	}
	first, ok := sources[0].(map[string]any)
	if !ok {
		t.Fatalf("unexpected knowledge summary shape: %v", sources[0])
	}
	if _, present := first["content"]; present {
		t.Fatal("knowledge summaries must not carry a content field")
	}
	for field, want := range map[string]string{"id": "src_first", "title": "Pricing FAQ", "status": "ready", "type": "text"} {
		if first[field] != want {
			t.Errorf("knowledge summary %s = %v, want %q", field, first[field], want)
		}
	}

	// The detail endpoint is the one that carries full source text, and must.
	detail := performAgentsAPIRequest(t, server.Handler(), http.MethodGet, "/v1/agents/"+agent.ID, token, nil, "")
	if detail.Code != http.StatusOK || !strings.Contains(detail.Body.String(), "Opening hours and refund policy") {
		t.Fatalf("the agent detail endpoint lost its knowledge bodies: %d", detail.Code)
	}
}

// An agent with no sources answered with null, and clients that call .map() on
// the result throw.
func TestAgentsAPIEmptySourceListIsAnArray(t *testing.T) {
	server, dataStore := newTestServer(t)
	agent, token := agentsAPIWorkspace(t, server, dataStore, "sources", nil)

	response := performAgentsAPIRequest(t, server.Handler(), http.MethodGet, "/v1/agents/"+agent.ID+"/sources", token, nil, "")
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
	}
	if strings.Contains(response.Body.String(), `"data":null`) {
		t.Fatalf("an agent without sources answered with null: %s", response.Body.String())
	}
	var envelope struct {
		Data []model.KnowledgeItem `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode sources: %v", err)
	}
	if envelope.Data == nil {
		t.Fatalf("expected an empty array, got null: %s", response.Body.String())
	}
	if len(envelope.Data) != 0 {
		t.Fatalf("expected no sources, got %d", len(envelope.Data))
	}
}

// Deleting an already-archived agent reported success and bumped its revision,
// so a repeated delete looked like it had archived something.
func TestAgentsAPIDeletingAnArchivedAgentIsNotFound(t *testing.T) {
	server, dataStore := newTestServer(t)
	agent, token := agentsAPIWorkspace(t, server, dataStore, "archive", nil)

	first := performAgentsAPIRequest(t, server.Handler(), http.MethodDelete, "/v1/agents/"+agent.ID, token, nil, "")
	if first.Code != http.StatusNoContent {
		t.Fatalf("first delete returned %d: %s", first.Code, first.Body.String())
	}
	archivedRevision, status := agentsAPIStoredAgent(t, dataStore, agent.AccountID, agent.ID)
	if status != "archived" {
		t.Fatalf("first delete left status %q", status)
	}

	second := performAgentsAPIRequest(t, server.Handler(), http.MethodDelete, "/v1/agents/"+agent.ID, token, nil, "")
	if body := agentsAPIErrorBody(t, second, http.StatusNotFound); body["code"] != "agent_not_found" {
		t.Fatalf("second delete returned code %v, want agent_not_found", body["code"])
	}
	revision, _ := agentsAPIStoredAgent(t, dataStore, agent.AccountID, agent.ID)
	if revision != archivedRevision {
		t.Fatalf("deleting an archived agent bumped its revision from %d to %d", archivedRevision, revision)
	}
}
