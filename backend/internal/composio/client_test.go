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

// Connect Link, not the retired initiate() path -- and the link endpoint needs an
// auth config, which the provider will not create implicitly.
//
// Sending only the toolkit is a 400, which is what made every Connect button in
// the product answer "this integration could not be started" with no way past it.
func TestConnectLinkCreatesAnAuthConfigThenLinksAgainstIt(t *testing.T) {
	var paths []string
	var linkBody map[string]any
	var authBody map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.Method+" "+r.URL.Path)
		switch {
		case strings.HasSuffix(r.URL.Path, "/auth_configs") && r.Method == http.MethodGet:
			_ = json.NewEncoder(w).Encode(map[string]any{"items": []any{}})
		case strings.HasSuffix(r.URL.Path, "/auth_configs"):
			_ = json.NewDecoder(r.Body).Decode(&authBody)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"auth_config": map[string]any{"id": "ac_created", "is_composio_managed": true},
			})
		default:
			_ = json.NewDecoder(r.Body).Decode(&linkBody)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"connected_account_id": "ca_new",
				"redirect_url":         "https://provider.example/authorize",
			})
		}
	}))
	defer server.Close()

	client := New(server.URL, "ak_test")
	connection, err := client.ConnectLink(context.Background(), "org_abc", "HighLevel", "https://garuda.ravan.ai/app/integrations")
	if err != nil {
		t.Fatalf("ConnectLink: %v", err)
	}

	if !strings.HasSuffix(paths[len(paths)-1], "/connected_accounts/link") {
		t.Errorf("the last call must be the link, got %v", paths)
	}
	if linkBody["auth_config_id"] != "ac_created" {
		t.Errorf("the link must reference the auth config, got %v", linkBody["auth_config_id"])
	}
	if linkBody["user_id"] != "org_abc" {
		t.Errorf("the account must be sent as user_id, got %v", linkBody["user_id"])
	}
	// Composio's managed auth is the whole reason this product uses a broker: it
	// means Garuda needs no OAuth app of its own for the toolkits it covers.
	config, _ := authBody["auth_config"].(map[string]any)
	if config == nil || config["type"] != "use_composio_managed_auth" {
		t.Errorf("the auth config must use the provider's managed auth, got %v", authBody["auth_config"])
	}
	toolkit, _ := authBody["toolkit"].(map[string]any)
	if toolkit == nil || toolkit["slug"] != "highlevel" {
		t.Errorf("toolkit should be normalised to lower case, got %v", authBody["toolkit"])
	}

	if connection.RedirectURL != "https://provider.example/authorize" {
		t.Errorf("redirect url not returned: %+v", connection)
	}
	if connection.ID != "ca_new" {
		t.Errorf("the connected account id was not read: %+v", connection)
	}
	if connection.Status != "INITIATED" {
		t.Errorf("a link that has not been walked through is INITIATED, got %q", connection.Status)
	}

	// A second connection to the same toolkit must not re-discover the config.
	before := len(paths)
	if _, err := client.ConnectLink(context.Background(), "org_other", "highlevel", ""); err != nil {
		t.Fatalf("second ConnectLink: %v", err)
	}
	if calls := len(paths) - before; calls != 1 {
		t.Errorf("a repeat connection cost %d calls, want just the link", calls)
	}
}

// An auth config that already exists -- from an earlier run, or made by hand in
// the provider's dashboard -- must be reused rather than duplicated.
func TestAnExistingAuthConfigIsReused(t *testing.T) {
	created := 0
	var linkBody map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, "/auth_configs") && r.Method == http.MethodGet:
			_ = json.NewEncoder(w).Encode(map[string]any{"items": []any{
				map[string]any{"id": "ac_existing", "toolkit": map[string]any{"slug": "googlecalendar"}},
			}})
		case strings.HasSuffix(r.URL.Path, "/auth_configs"):
			created++
			_ = json.NewEncoder(w).Encode(map[string]any{"auth_config": map[string]any{"id": "ac_new"}})
		default:
			_ = json.NewDecoder(r.Body).Decode(&linkBody)
			_ = json.NewEncoder(w).Encode(map[string]any{"connected_account_id": "ca_1", "redirect_url": "https://provider.example/a"})
		}
	}))
	defer server.Close()

	client := New(server.URL, "ak_test")
	if _, err := client.ConnectLink(context.Background(), "org_abc", "googlecalendar", ""); err != nil {
		t.Fatalf("ConnectLink: %v", err)
	}
	if created != 0 {
		t.Errorf("an auth config was created even though one existed")
	}
	if linkBody["auth_config_id"] != "ac_existing" {
		t.Errorf("the existing config was not used, got %v", linkBody["auth_config_id"])
	}
}

// The catalogue nests the logo and the description under "meta". Read from the
// top level they were always empty, and every card fell back to a monogram.
func TestToolkitReadsTheNestedLogoAndDescription(t *testing.T) {
	var toolkit Toolkit
	err := json.Unmarshal([]byte(`{
		"slug": "gmail",
		"name": "Gmail",
		"meta": {
			"description": "Google's email service",
			"logo": "https://logos.composio.dev/api/gmail",
			"categories": [{"id": "email", "name": "email"}]
		}
	}`), &toolkit)
	if err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if toolkit.LogoURL != "https://logos.composio.dev/api/gmail" {
		t.Errorf("logo = %q", toolkit.LogoURL)
	}
	if toolkit.Description != "Google's email service" {
		t.Errorf("description = %q", toolkit.Description)
	}
	if len(toolkit.Categories) != 1 || toolkit.Categories[0] != "email" {
		t.Errorf("categories = %v", toolkit.Categories)
	}
	if toolkit.Slug != "gmail" || toolkit.Name != "Gmail" {
		t.Errorf("the flat fields were lost: %+v", toolkit)
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
