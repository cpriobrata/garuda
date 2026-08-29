package api

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"garuda/backend/internal/config"
	"garuda/backend/internal/model"
	"garuda/backend/internal/store"
)

// leadsLaneServer builds a server whose demo mode can be switched off, because
// demo mode short circuits every entitlement check and would hide the one the
// unpause route applies.
func leadsLaneServer(t *testing.T, demoMode bool) (*Server, *store.FileStore) {
	t.Helper()
	dataStore, err := store.OpenFile(filepath.Join(t.TempDir(), "garuda.json"))
	if err != nil {
		t.Fatalf("OpenFile: %v", err)
	}
	configuration := config.Config{
		PublicURL: "http://localhost:8080", JWTSecret: "test-secret-at-least-thirty-two-bytes-long",
		VisitorHMACKey: "visitor-hmac-test-secret", AccessTokenTTL: time.Hour, RefreshTokenTTL: 30 * 24 * time.Hour,
		AllowedOrigins: []string{"http://localhost:3000"}, DemoMode: demoMode,
		LLMBaseURL: "https://api.openai.com/v1", LLMModel: "test-model",
	}
	return New(configuration, dataStore, slog.New(slog.NewTextHandler(io.Discard, nil))), dataStore
}

// leadsLaneIdentity seeds an account with one owner and returns the identity the
// authentication middleware would have put on the request context.
func leadsLaneIdentity(t *testing.T, dataStore *store.FileStore, suffix, billingStatus string) Identity {
	t.Helper()
	now := time.Now().UTC()
	account := model.Account{ID: "org_" + suffix, Name: "Workspace " + suffix, Plan: "starter_17", BillingStatus: billingStatus, CreatedAt: now, UpdatedAt: now}
	user := model.User{ID: "usr_" + suffix, AccountID: account.ID, Name: "Owner", Email: suffix + "@example.com", Role: "owner", CreatedAt: now, UpdatedAt: now}
	if err := dataStore.Update(func(state *model.State) error {
		state.Accounts = append(state.Accounts, account)
		state.Users = append(state.Users, user)
		return nil
	}); err != nil {
		t.Fatalf("seed workspace %s: %v", suffix, err)
	}
	return Identity{UserID: user.ID, AccountID: account.ID, Email: user.Email, Role: user.Role}
}

// leadsLaneRequest builds the request a wired route would have handed the
// handler: the identity the auth middleware resolved, plus the path values the
// router would have parsed.
func leadsLaneRequest(method, target string, identity Identity, pathValues map[string]string, body string) *http.Request {
	var payload io.Reader = http.NoBody
	if body != "" {
		payload = strings.NewReader(body)
	}
	request := httptest.NewRequest(method, target, payload)
	request.Header.Set("Content-Type", "application/json")
	for name, value := range pathValues {
		request.SetPathValue(name, value)
	}
	return request.WithContext(context.WithValue(request.Context(), identityKey, identity))
}

func leadsLaneSeedLead(t *testing.T, dataStore *store.FileStore, lead model.Lead) {
	t.Helper()
	if err := dataStore.Update(func(state *model.State) error {
		state.Leads = append(state.Leads, lead)
		return nil
	}); err != nil {
		t.Fatalf("seed lead %s: %v", lead.ID, err)
	}
}

// leadsLaneParseCSV strips the byte order mark and decodes the export into rows.
func leadsLaneParseCSV(t *testing.T, body string) [][]string {
	t.Helper()
	trimmed := strings.TrimPrefix(body, "\xef\xbb\xbf")
	if trimmed == body {
		t.Fatal("export is missing the UTF-8 byte order mark Excel needs to read accented names")
	}
	rows, err := csv.NewReader(strings.NewReader(trimmed)).ReadAll()
	if err != nil {
		t.Fatalf("export is not well formed CSV: %v", err)
	}
	return rows
}

// leadsLaneRowByID finds one exported row by its id column.
func leadsLaneRowByID(t *testing.T, rows [][]string, leadID string) []string {
	t.Helper()
	for _, row := range rows[1:] {
		if row[0] == leadID {
			return row
		}
	}
	t.Fatalf("lead %s is missing from the export", leadID)
	return nil
}

// leadsLaneColumn resolves a column position by name so the assertions below do
// not silently follow the header row if its order is ever rearranged.
func leadsLaneColumn(t *testing.T, header []string, name string) int {
	t.Helper()
	for index, column := range header {
		if column == name {
			return index
		}
	}
	t.Fatalf("export header has no %q column: %v", name, header)
	return -1
}

// TestLeadExportNeutralisesSpreadsheetFormulasAndStaysInsideTheAccount covers the
// hazard that makes this export dangerous rather than merely useful: a lead's
// name, company and notes are text a stranger typed into somebody's website, and
// a cell starting with =, +, -, @, a tab or a carriage return is executed by
// Excel when the customer opens the download.
func TestLeadExportNeutralisesSpreadsheetFormulasAndStaysInsideTheAccount(t *testing.T) {
	server, dataStore := leadsLaneServer(t, true)
	identity := leadsLaneIdentity(t, dataStore, "export", "active")
	other := leadsLaneIdentity(t, dataStore, "neighbour", "active")
	now := time.Now().UTC()

	leadsLaneSeedLead(t, dataStore, model.Lead{
		ID: "lead_formula", AccountID: identity.AccountID, AgentID: "agt_export",
		Name:    `=cmd|' /c calc'!A1`,
		Email:   `+attacker@example.com`,
		Phone:   `-15550100`,
		Company: "\tTab Industries",
		Notes:   `@SUM(1+1)*cmd`,
		Status:  "new", Source: "widget", CreatedAt: now, UpdatedAt: now,
	})
	leadsLaneSeedLead(t, dataStore, model.Lead{
		ID: "lead_quoted", AccountID: identity.AccountID, AgentID: "agt_export",
		Name: `Ann "Bee", Cee`, Email: "ann@example.com", Company: "Line\nBreak Ltd",
		Status: "new", Source: "widget", CreatedAt: now.Add(-time.Minute), UpdatedAt: now,
	})
	leadsLaneSeedLead(t, dataStore, model.Lead{
		ID: "lead_neighbour", AccountID: other.AccountID,
		Name: "Not yours", Email: "neighbour-secret@example.com",
		Status: "new", Source: "widget", CreatedAt: now, UpdatedAt: now,
	})

	response := httptest.NewRecorder()
	server.exportLeads(response, leadsLaneRequest(http.MethodGet, "/v1/leads/export", identity, nil, ""))
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
	}
	if contentType := response.Header().Get("Content-Type"); contentType != "text/csv; charset=utf-8" {
		t.Fatalf("expected a CSV content type, got %q", contentType)
	}
	expectedDisposition := `attachment; filename="garuda-leads-` + time.Now().UTC().Format("2006-01-02") + `.csv"`
	if disposition := response.Header().Get("Content-Disposition"); disposition != expectedDisposition {
		t.Fatalf("expected Content-Disposition %q, got %q", expectedDisposition, disposition)
	}

	body := response.Body.String()
	if strings.Contains(body, "neighbour-secret@example.com") {
		t.Fatal("the export leaked a lead belonging to another account")
	}
	rows := leadsLaneParseCSV(t, body)
	header := rows[0]
	formula := leadsLaneRowByID(t, rows, "lead_formula")
	for _, expectation := range []struct {
		column string
		want   string
	}{
		{"name", `'=cmd|' /c calc'!A1`},
		{"email", `'+attacker@example.com`},
		{"phone", `'-15550100`},
		{"company", "'\tTab Industries"},
		{"notes", `'@SUM(1+1)*cmd`},
	} {
		if got := formula[leadsLaneColumn(t, header, expectation.column)]; got != expectation.want {
			t.Fatalf("column %s: expected the formula defused as %q, got %q", expectation.column, expectation.want, got)
		}
	}

	// Quotes, commas and newlines have to survive as data rather than tearing the
	// row apart, which is what makes the escaping worth checking separately from
	// the formula prefix.
	quoted := leadsLaneRowByID(t, rows, "lead_quoted")
	if got := quoted[leadsLaneColumn(t, header, "name")]; got != `Ann "Bee", Cee` {
		t.Fatalf("expected the quoted name to round trip, got %q", got)
	}
	if got := quoted[leadsLaneColumn(t, header, "company")]; got != "Line\nBreak Ltd" {
		t.Fatalf("expected the embedded newline to round trip, got %q", got)
	}
	if !strings.Contains(body, `"Ann ""Bee"", Cee"`) {
		t.Fatalf("expected the raw CSV to double the embedded quotes: %s", body)
	}
}

// TestLeadExportRespectsTheStatusFilter keeps the download matching the table the
// customer exported it from, and refuses a status outside the vocabulary rather
// than handing back an empty file that reads like "you have no such leads".
func TestLeadExportRespectsTheStatusFilter(t *testing.T) {
	server, dataStore := leadsLaneServer(t, true)
	identity := leadsLaneIdentity(t, dataStore, "filter", "active")
	now := time.Now().UTC()
	leadsLaneSeedLead(t, dataStore, model.Lead{ID: "lead_new", AccountID: identity.AccountID, Name: "Fresh", Email: "fresh@example.com", Status: "new", Source: "widget", CreatedAt: now, UpdatedAt: now})
	leadsLaneSeedLead(t, dataStore, model.Lead{ID: "lead_qualified", AccountID: identity.AccountID, Name: "Ready", Email: "ready@example.com", Status: "qualified", Source: "widget", CreatedAt: now, UpdatedAt: now})

	response := httptest.NewRecorder()
	server.exportLeads(response, leadsLaneRequest(http.MethodGet, "/v1/leads/export?status=qualified", identity, nil, ""))
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
	}
	rows := leadsLaneParseCSV(t, response.Body.String())
	if len(rows) != 2 {
		t.Fatalf("expected the header plus one qualified lead, got %d rows: %v", len(rows), rows)
	}
	leadsLaneRowByID(t, rows, "lead_qualified")
	if disposition := response.Header().Get("Content-Disposition"); !strings.Contains(disposition, "garuda-leads-qualified-") {
		t.Fatalf("expected the filter named in the download filename, got %q", disposition)
	}

	rejected := httptest.NewRecorder()
	server.exportLeads(rejected, leadsLaneRequest(http.MethodGet, "/v1/leads/export?status=not-a-status", identity, nil, ""))
	if rejected.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected an unknown status to be rejected with 422, got %d: %s", rejected.Code, rejected.Body.String())
	}
	if contentType := rejected.Header().Get("Content-Type"); !strings.HasPrefix(contentType, "application/json") {
		t.Fatalf("expected the rejection to stay a JSON envelope, got %q", contentType)
	}
}

// TestManualLeadAddValidatesLikeTheWidgetAndIsNeverAConsentedCapture is the
// privacy-facing half of manual add: the record has to be as well formed as a
// widget capture, and it must never be mistakable for one.
func TestManualLeadAddValidatesLikeTheWidgetAndIsNeverAConsentedCapture(t *testing.T) {
	server, dataStore := leadsLaneServer(t, true)
	identity := leadsLaneIdentity(t, dataStore, "manual", "active")
	other := leadsLaneIdentity(t, dataStore, "manualneighbour", "active")
	now := time.Now().UTC()
	if err := dataStore.Update(func(state *model.State) error {
		state.Agents = append(state.Agents,
			model.Agent{ID: "agt_manual", AccountID: identity.AccountID, Name: "Assistant", PublicKey: "pub_manual", Status: "published", CreatedAt: now, UpdatedAt: now},
			model.Agent{ID: "agt_manual_neighbour", AccountID: other.AccountID, Name: "Theirs", PublicKey: "pub_manual_neighbour", Status: "published", CreatedAt: now, UpdatedAt: now},
		)
		return nil
	}); err != nil {
		t.Fatalf("seed agents: %v", err)
	}

	for _, rejection := range []struct {
		name string
		body string
	}{
		{"no contact detail at all", `{"name":"Nobody"}`},
		{"an unparseable email", `{"email":"not-an-email"}`},
		{"a phone that is not a phone", `{"phone":"call me maybe"}`},
		{"a phone too short to dial", `{"phone":"12345"}`},
		{"a status outside the vocabulary", `{"email":"ok@example.com","status":"warm"}`},
	} {
		response := httptest.NewRecorder()
		server.createLead(response, leadsLaneRequest(http.MethodPost, "/v1/leads", identity, nil, rejection.body))
		if response.Code != http.StatusUnprocessableEntity {
			t.Fatalf("%s: expected 422, got %d: %s", rejection.name, response.Code, response.Body.String())
		}
	}

	// An agent id in the body is a request, not authority: one from another
	// workspace is indistinguishable from one that does not exist.
	crossTenant := httptest.NewRecorder()
	server.createLead(crossTenant, leadsLaneRequest(http.MethodPost, "/v1/leads", identity, nil, `{"email":"ok@example.com","agent_id":"agt_manual_neighbour"}`))
	if crossTenant.Code != http.StatusNotFound {
		t.Fatalf("expected another account's agent to read as missing with 404, got %d: %s", crossTenant.Code, crossTenant.Body.String())
	}

	created := httptest.NewRecorder()
	server.createLead(created, leadsLaneRequest(http.MethodPost, "/v1/leads", identity, nil,
		`{"name":"Dara Okafor","email":"  Dara@Example.COM ","phone":"+1 (555) 010-1234","company":"Northwind","agent_id":"agt_manual","status":"qualified","notes":"Met at the trade show."}`))
	data := dataFrom(t, created, http.StatusCreated)
	if data["source"] != manualLeadSource {
		t.Fatalf("expected the source to mark this as a manual entry, got %v", data["source"])
	}
	if data["source"] == "widget" {
		t.Fatal("a hand-typed lead must never claim to be a consented widget capture")
	}
	if data["email"] != "dara@example.com" {
		t.Fatalf("expected the email normalised the way the widget normalises it, got %v", data["email"])
	}
	if data["phone"] != "+15550101234" {
		t.Fatalf("expected the phone normalised the way the widget normalises it, got %v", data["phone"])
	}
	metadata, _ := data["metadata"].(map[string]any)
	if metadata["consent"] != "not_collected" {
		t.Fatalf("expected the record to say outright that no consent was collected, got %v", metadata["consent"])
	}
	if metadata["added_by_user_id"] != identity.UserID {
		t.Fatalf("expected the operator recorded, got %v", metadata["added_by_user_id"])
	}

	createdID, _ := data["id"].(string)
	var stored model.Lead
	_ = dataStore.View(func(state *model.State) error {
		for _, lead := range state.Leads {
			if lead.ID == createdID {
				stored = lead.Clone()
			}
		}
		return nil
	})
	if stored.AccountID != identity.AccountID || stored.AgentID != "agt_manual" || stored.Status != "qualified" {
		t.Fatalf("stored lead did not keep its account, agent and status: %+v", stored)
	}

	listed := httptest.NewRecorder()
	server.listLeads(listed, leadsLaneRequest(http.MethodGet, "/v1/leads", identity, nil, ""))
	if listed.Code != http.StatusOK || !strings.Contains(listed.Body.String(), stored.ID) {
		t.Fatalf("expected the manual lead to appear in the lead list: %s", listed.Body.String())
	}
}

// pauseLaneAgent seeds a published agent complete enough to pass the publishing
// validation the unpause route repeats.
func pauseLaneAgent(t *testing.T, dataStore *store.FileStore, accountID, agentID, publicKey, status string) model.Agent {
	t.Helper()
	now := time.Now().UTC()
	publishedAt := now.Add(-time.Hour)
	agent := model.Agent{
		ID: agentID, AccountID: accountID, Name: "Website assistant", Description: "Greets visitors",
		PublicKey: publicKey, Status: status, Revision: 3,
		SystemPrompt: "Answer questions about the product.", WelcomeMessage: "Hello there!",
		LeadCapture: model.LeadCaptureConfig{Enabled: true, AfterTurns: 2, Fields: []string{"name", "email"}},
		Branding:    model.BrandingConfig{PrimaryColor: "#111827", AccentColor: "#F97316", Position: "bottom_right", AllowedDomains: []string{"northstar.example"}},
		Knowledge:   []model.KnowledgeItem{{ID: "kno_pause", Title: "Pricing", Content: "Starter is $17.", CreatedAt: now}},
		PublishedAt: &publishedAt, CreatedAt: now, UpdatedAt: now,
	}
	if err := dataStore.Update(func(state *model.State) error {
		state.Agents = append(state.Agents, agent)
		return nil
	}); err != nil {
		t.Fatalf("seed agent %s: %v", agentID, err)
	}
	return agent
}

// pauseLaneWidgetStatus asks the widget for the agent's public configuration the
// way a visitor's browser does.
func pauseLaneWidgetStatus(t *testing.T, server *Server, agentKey string) int {
	t.Helper()
	request := httptest.NewRequest(http.MethodGet, "/widget/v1/agents/"+agentKey, http.NoBody)
	request.SetPathValue("agentKey", agentKey)
	response := httptest.NewRecorder()
	server.widgetAgent(response, request)
	return response.Code
}

// TestPauseStopsTheWidgetAndUnpauseRestoresItWithItsConfiguration is the whole
// point of pause: the widget stops answering, nothing about the agent is lost,
// and putting it back is one call.
func TestPauseStopsTheWidgetAndUnpauseRestoresItWithItsConfiguration(t *testing.T) {
	server, dataStore := leadsLaneServer(t, true)
	identity := leadsLaneIdentity(t, dataStore, "pause", "active")
	seeded := pauseLaneAgent(t, dataStore, identity.AccountID, "agt_pause", "pub_pause", "published")

	if code := pauseLaneWidgetStatus(t, server, seeded.PublicKey); code != http.StatusOK {
		t.Fatalf("expected the widget to serve a published agent, got %d", code)
	}

	paused := httptest.NewRecorder()
	server.pauseAgent(paused, leadsLaneRequest(http.MethodPost, "/v1/agents/agt_pause/pause", identity, map[string]string{"agentID": seeded.ID}, ""))
	pausedData := dataFrom(t, paused, http.StatusOK)
	if pausedData["status"] != "paused" {
		t.Fatalf("expected the agent to report itself paused, got %v", pausedData["status"])
	}
	if code := pauseLaneWidgetStatus(t, server, seeded.PublicKey); code != http.StatusNotFound {
		t.Fatalf("expected the widget to stop serving a paused agent, got %d", code)
	}

	// Pausing is not archiving: the agent is still the customer's to see and edit.
	listed := httptest.NewRecorder()
	server.listAgents(listed, leadsLaneRequest(http.MethodGet, "/v1/agents", identity, nil, ""))
	if listed.Code != http.StatusOK || !strings.Contains(listed.Body.String(), seeded.ID) {
		t.Fatalf("expected a paused agent to stay listed: %s", listed.Body.String())
	}

	var whilePaused model.Agent
	_ = dataStore.View(func(state *model.State) error {
		if found, ok := findAgent(state, identity.AccountID, seeded.ID); ok {
			whilePaused = found.Clone()
		}
		return nil
	})
	if whilePaused.PublicKey != seeded.PublicKey {
		t.Fatal("pausing rotated the public key, which would break every embed on the customer's site")
	}
	if whilePaused.PublishedAt == nil || !whilePaused.PublishedAt.Equal(*seeded.PublishedAt) {
		t.Fatalf("pausing lost the publication timestamp: %v", whilePaused.PublishedAt)
	}
	if whilePaused.SystemPrompt != seeded.SystemPrompt || whilePaused.WelcomeMessage != seeded.WelcomeMessage || len(whilePaused.Knowledge) != 1 {
		t.Fatalf("pausing lost part of the agent configuration: %+v", whilePaused)
	}

	resumed := httptest.NewRecorder()
	server.unpauseAgent(resumed, leadsLaneRequest(http.MethodPost, "/v1/agents/agt_pause/unpause", identity, map[string]string{"agentID": seeded.ID}, ""))
	resumedData := dataFrom(t, resumed, http.StatusOK)
	if resumedData["status"] != "published" {
		t.Fatalf("expected unpause to put the agent back on the air, got %v", resumedData["status"])
	}
	if code := pauseLaneWidgetStatus(t, server, seeded.PublicKey); code != http.StatusOK {
		t.Fatalf("expected the widget to serve the agent again after unpause, got %d", code)
	}
}

// TestPauseLeavesTheDraftPublishedAndArchivedTransitionsAlone guards the states
// pause sits between. A draft was never on the air, an archived agent is gone,
// and neither may be quietly resurrected through the pause routes.
func TestPauseLeavesTheDraftPublishedAndArchivedTransitionsAlone(t *testing.T) {
	server, dataStore := leadsLaneServer(t, true)
	identity := leadsLaneIdentity(t, dataStore, "transitions", "active")
	other := leadsLaneIdentity(t, dataStore, "transitionsneighbour", "active")
	draft := pauseLaneAgent(t, dataStore, identity.AccountID, "agt_draft", "pub_draft", "draft")
	archived := pauseLaneAgent(t, dataStore, identity.AccountID, "agt_archived", "pub_archived", "archived")
	live := pauseLaneAgent(t, dataStore, identity.AccountID, "agt_live", "pub_live", "published")
	neighbour := pauseLaneAgent(t, dataStore, other.AccountID, "agt_neighbour", "pub_neighbour", "published")

	for _, expectation := range []struct {
		name    string
		handler func(http.ResponseWriter, *http.Request)
		agentID string
		want    int
	}{
		{"pausing a draft", server.pauseAgent, draft.ID, http.StatusConflict},
		{"unpausing a draft", server.unpauseAgent, draft.ID, http.StatusConflict},
		{"unpausing a live agent is a no-op", server.unpauseAgent, live.ID, http.StatusOK},
		{"pausing an archived agent", server.pauseAgent, archived.ID, http.StatusNotFound},
		{"unpausing an archived agent", server.unpauseAgent, archived.ID, http.StatusNotFound},
		{"pausing another account's agent", server.pauseAgent, neighbour.ID, http.StatusNotFound},
		{"unpausing another account's agent", server.unpauseAgent, neighbour.ID, http.StatusNotFound},
	} {
		response := httptest.NewRecorder()
		expectation.handler(response, leadsLaneRequest(http.MethodPost, "/v1/agents/"+expectation.agentID+"/pause", identity, map[string]string{"agentID": expectation.agentID}, ""))
		if response.Code != expectation.want {
			t.Fatalf("%s: expected %d, got %d: %s", expectation.name, expectation.want, response.Code, response.Body.String())
		}
	}

	// The neighbour's agent must still be serving: a cross-tenant 404 has to mean
	// "you cannot see it", never "it has been switched off for you".
	if code := pauseLaneWidgetStatus(t, server, neighbour.PublicKey); code != http.StatusOK {
		t.Fatalf("a rejected cross-tenant pause changed another account's agent, widget answered %d", code)
	}

	// Unpublishing and archiving still reach a paused agent, so the customer is
	// never stuck in the pause state.
	pause := httptest.NewRecorder()
	server.pauseAgent(pause, leadsLaneRequest(http.MethodPost, "/v1/agents/agt_live/pause", identity, map[string]string{"agentID": live.ID}, ""))
	if pause.Code != http.StatusOK {
		t.Fatalf("expected the live agent to pause, got %d: %s", pause.Code, pause.Body.String())
	}
	unpublish := httptest.NewRecorder()
	server.unpublishAgent(unpublish, leadsLaneRequest(http.MethodPost, "/v1/agents/agt_live/unpublish", identity, map[string]string{"agentID": live.ID}, ""))
	if data := dataFrom(t, unpublish, http.StatusOK); data["status"] != "draft" {
		t.Fatalf("expected unpublishing a paused agent to return it to draft, got %v", data["status"])
	}
	archive := httptest.NewRecorder()
	server.archiveAgent(archive, leadsLaneRequest(http.MethodDelete, "/v1/agents/agt_live", identity, map[string]string{"agentID": live.ID}, ""))
	if archive.Code != http.StatusNoContent {
		t.Fatalf("expected archiving to still work, got %d: %s", archive.Code, archive.Body.String())
	}
}

// TestPauseIsIdempotentAndDoesNotChurnTheRevision keeps a retried pause from
// invalidating the If-Match token an open editor is holding.
func TestPauseIsIdempotentAndDoesNotChurnTheRevision(t *testing.T) {
	server, dataStore := leadsLaneServer(t, true)
	identity := leadsLaneIdentity(t, dataStore, "idempotent", "active")
	seeded := pauseLaneAgent(t, dataStore, identity.AccountID, "agt_idempotent", "pub_idempotent", "published")

	first := httptest.NewRecorder()
	server.pauseAgent(first, leadsLaneRequest(http.MethodPost, "/v1/agents/agt_idempotent/pause", identity, map[string]string{"agentID": seeded.ID}, ""))
	firstRevision := dataFrom(t, first, http.StatusOK)["revision"]
	second := httptest.NewRecorder()
	server.pauseAgent(second, leadsLaneRequest(http.MethodPost, "/v1/agents/agt_idempotent/pause", identity, map[string]string{"agentID": seeded.ID}, ""))
	secondData := dataFrom(t, second, http.StatusOK)
	if secondData["status"] != "paused" {
		t.Fatalf("expected a repeated pause to stay paused, got %v", secondData["status"])
	}
	if secondData["revision"] != firstRevision {
		t.Fatalf("a repeated pause bumped the revision from %v to %v", firstRevision, secondData["revision"])
	}
}

// TestUnpauseRecheckesThePublishedAgentLimit closes the loophole pause opens: a
// paused agent stops counting against the plan limit, so the slot it left can be
// taken while it sleeps, and resuming without a recheck would carry the account
// past a limit publishing enforces.
func TestUnpauseRecheckesThePublishedAgentLimit(t *testing.T) {
	server, dataStore := leadsLaneServer(t, true)
	identity := leadsLaneIdentity(t, dataStore, "limit", "active")
	seeded := pauseLaneAgent(t, dataStore, identity.AccountID, "agt_limit", "pub_limit", "published")

	paused := httptest.NewRecorder()
	server.pauseAgent(paused, leadsLaneRequest(http.MethodPost, "/v1/agents/agt_limit/pause", identity, map[string]string{"agentID": seeded.ID}, ""))
	if paused.Code != http.StatusOK {
		t.Fatalf("expected the agent to pause, got %d: %s", paused.Code, paused.Body.String())
	}

	// The freed slot is taken by other agents while this one sleeps.
	for index := 0; index < config.StarterPublishedAgentLimit; index++ {
		suffix := string(rune('a' + index))
		pauseLaneAgent(t, dataStore, identity.AccountID, "agt_filler_"+suffix, "pub_filler_"+suffix, "published")
	}

	rejected := httptest.NewRecorder()
	server.unpauseAgent(rejected, leadsLaneRequest(http.MethodPost, "/v1/agents/agt_limit/unpause", identity, map[string]string{"agentID": seeded.ID}, ""))
	if rejected.Code != http.StatusConflict {
		t.Fatalf("expected unpause to be refused once the plan limit is full, got %d: %s", rejected.Code, rejected.Body.String())
	}
	var envelope struct {
		Error APIError `json:"error"`
	}
	if err := json.Unmarshal(rejected.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode error envelope: %v", err)
	}
	if envelope.Error.Code != "published_agent_limit_reached" {
		t.Fatalf("expected the published agent limit error, got %q", envelope.Error.Code)
	}
	if code := pauseLaneWidgetStatus(t, server, seeded.PublicKey); code != http.StatusNotFound {
		t.Fatalf("a refused unpause put the agent back on the air, widget answered %d", code)
	}
}

// TestUnpauseRequiresALiveSubscriptionButPauseNeverDoes: resuming puts an agent
// back in front of visitors, which is what publishing is gated on. Stopping one
// must never be gated on anything.
func TestUnpauseRequiresALiveSubscriptionButPauseNeverDoes(t *testing.T) {
	server, dataStore := leadsLaneServer(t, false)
	identity := leadsLaneIdentity(t, dataStore, "lapsed", "canceled")
	seeded := pauseLaneAgent(t, dataStore, identity.AccountID, "agt_lapsed", "pub_lapsed", "published")

	paused := httptest.NewRecorder()
	server.pauseAgent(paused, leadsLaneRequest(http.MethodPost, "/v1/agents/agt_lapsed/pause", identity, map[string]string{"agentID": seeded.ID}, ""))
	if paused.Code != http.StatusOK {
		t.Fatalf("a lapsed account must still be able to stop its agent, got %d: %s", paused.Code, paused.Body.String())
	}

	blocked := httptest.NewRecorder()
	server.unpauseAgent(blocked, leadsLaneRequest(http.MethodPost, "/v1/agents/agt_lapsed/unpause", identity, map[string]string{"agentID": seeded.ID}, ""))
	if blocked.Code != http.StatusPaymentRequired {
		t.Fatalf("expected a lapsed account to be refused a resume with 402, got %d: %s", blocked.Code, blocked.Body.String())
	}
}

// TestLeadExportStreamsRatherThanBufferingTheWholeFile checks the shape of the
// write path rather than its content: the rows have to reach the socket as they
// are produced, so a large workspace does not wait on the whole file first.
func TestLeadExportStreamsRatherThanBufferingTheWholeFile(t *testing.T) {
	server, dataStore := leadsLaneServer(t, true)
	identity := leadsLaneIdentity(t, dataStore, "stream", "active")
	now := time.Now().UTC()
	total := leadExportFlushInterval*2 + 5
	if err := dataStore.Update(func(state *model.State) error {
		for index := 0; index < total; index++ {
			state.Leads = append(state.Leads, model.Lead{
				ID: "lead_stream_" + strconv.Itoa(index), AccountID: identity.AccountID,
				Name: "Visitor", Email: "visitor@example.com", Status: "new", Source: "widget",
				CreatedAt: now, UpdatedAt: now,
			})
		}
		return nil
	}); err != nil {
		t.Fatalf("seed leads: %v", err)
	}

	recorder := &countingFlushRecorder{ResponseRecorder: httptest.NewRecorder()}
	server.exportLeads(recorder, leadsLaneRequest(http.MethodGet, "/v1/leads/export", identity, nil, ""))
	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", recorder.Code)
	}
	// Header row, two full batches and the remainder: anything that assembled the
	// file first would flush once at the end.
	if recorder.flushes < 4 {
		t.Fatalf("expected the export to flush progressively, saw %d flushes for %d leads", recorder.flushes, total)
	}
	rows := leadsLaneParseCSV(t, recorder.Body.String())
	if len(rows) != total+1 {
		t.Fatalf("expected %d rows plus a header, got %d", total, len(rows))
	}
}

// countingFlushRecorder counts the pushes towards the client that a real
// connection would have turned into writes.
type countingFlushRecorder struct {
	*httptest.ResponseRecorder
	flushes int
}

func (r *countingFlushRecorder) Flush() {
	r.flushes++
	r.ResponseRecorder.Flush()
}
