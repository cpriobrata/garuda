package composio

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// With no key the whole surface must report unavailable rather than fail, the
// same as every other provider adapter here.
func TestClientDegradesWithoutCredentials(t *testing.T) {
	client := New("", "")
	if client.Enabled() {
		t.Fatal("an unconfigured client must not report enabled")
	}
	if _, err := client.Toolkits(context.Background(), "", 10); err == nil {
		t.Error("Toolkits should refuse when unconfigured")
	}
	if _, err := client.Connections(context.Background(), "org_1"); err == nil {
		t.Error("Connections should refuse when unconfigured")
	}
	if _, err := client.ConnectLink(context.Background(), "org_1", "slack", ""); err == nil {
		t.Error("ConnectLink should refuse when unconfigured")
	}
}

// The user id is the tenant boundary. Listing connections without one would
// return every customer's connections, so it must be rejected outright.
func TestConnectionsRequireAUserID(t *testing.T) {
	client := New("https://example.invalid/api/v3", "ck_test")
	if _, err := client.Connections(context.Background(), "   "); err == nil {
		t.Fatal("listing connections without a user id must be refused")
	}
}

func TestConnectionsFilterByTheCallersAccount(t *testing.T) {
	var seenQuery string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seenQuery = r.URL.RawQuery
		if r.Header.Get("x-api-key") != "ck_test" {
			t.Errorf("api key header missing, got %q", r.Header.Get("x-api-key"))
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"items": []map[string]any{
			{"id": "conn_1", "status": "ACTIVE", "toolkit": map[string]string{"slug": "googlecalendar"}},
		}})
	}))
	defer server.Close()

	client := New(server.URL, "ck_test")
	connections, err := client.Connections(context.Background(), "org_abc")
	if err != nil {
		t.Fatalf("Connections: %v", err)
	}
	if !strings.Contains(seenQuery, "user_ids=org_abc") {
		t.Errorf("the request must be scoped to the account, got query %q", seenQuery)
	}
	if len(connections) != 1 || connections[0].Toolkit != "googlecalendar" || connections[0].UserID != "org_abc" {
		t.Errorf("unexpected connections: %+v", connections)
	}
}

// Connect Link, not the retired initiate() path.
func TestConnectLinkUsesTheLinkEndpointAndCarriesTheAccount(t *testing.T) {
	var seenPath string
	var seenBody map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seenPath = r.URL.Path
		_ = json.NewDecoder(r.Body).Decode(&seenBody)
		_ = json.NewEncoder(w).Encode(map[string]any{"id": "conn_new", "status": "INITIATED", "redirect_url": "https://provider.example/authorize"})
	}))
	defer server.Close()

	client := New(server.URL, "ck_test")
	connection, err := client.ConnectLink(context.Background(), "org_abc", "HighLevel", "https://garuda.ravan.ai/app/integrations")
	if err != nil {
		t.Fatalf("ConnectLink: %v", err)
	}
	if !strings.HasSuffix(seenPath, "/connected_accounts/link") {
		t.Errorf("expected the link endpoint, got %q", seenPath)
	}
	if seenBody["user_id"] != "org_abc" {
		t.Errorf("the account must be sent as user_id, got %v", seenBody["user_id"])
	}
	if seenBody["toolkit"] != "highlevel" {
		t.Errorf("toolkit should be normalised to lower case, got %v", seenBody["toolkit"])
	}
	if connection.RedirectURL != "https://provider.example/authorize" {
		t.Errorf("redirect url not returned: %+v", connection)
	}
}

// A provider failure must surface its message, and must never echo the key.
func TestProviderErrorsAreSurfacedWithoutLeakingTheKey(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]any{"message": "Invalid API key"}})
	}))
	defer server.Close()

	client := New(server.URL, "ck_supersecretvalue")
	_, err := client.Toolkits(context.Background(), "", 5)
	if err == nil {
		t.Fatal("expected an error")
	}
	if !strings.Contains(err.Error(), "Invalid API key") {
		t.Errorf("the provider message should be surfaced, got %q", err)
	}
	if strings.Contains(err.Error(), "ck_supersecretvalue") {
		t.Error("the api key leaked into an error message")
	}
}
