package api

import (
	"testing"

	"garuda/backend/internal/model"
)

// Without the branding overlay in publicAgent, everything a customer configures in
// the widget studio stops at the database and never reaches their website.
func TestWidgetBootstrapCarriesResolvedBranding(t *testing.T) {
	showForm := true
	agent := model.Agent{
		ID: "agt_boot", AccountID: "org_boot", Name: "Internal Name", Status: "published",
		WelcomeMessage: "Hello",
		Branding: model.BrandingConfig{
			DisplayName: "Acme Support", Tagline: "Here to help", LogoURL: "https://cdn.example.com/logo.png",
			Theme: "ocean_blue", Position: "bottom_left",
			Toggles: &model.WidgetToggles{ShowLeadForm: &showForm},
		},
	}
	payload := publicAgent(agent)

	for _, key := range []string{"display_name", "tagline", "logo_url", "theme", "theme_colors", "toggles", "lead_form", "position"} {
		if _, present := payload[key]; !present {
			t.Errorf("the widget bootstrap is missing %q, so the studio cannot reach a website", key)
		}
	}
	if payload["display_name"] != "Acme Support" {
		t.Errorf("the customer's display name must win over the internal agent name, got %v", payload["display_name"])
	}
	if payload["tagline"] != "Here to help" {
		t.Errorf("tagline missing: %v", payload["tagline"])
	}
	if payload["position"] != "bottom_left" {
		t.Errorf("placement not carried: %v", payload["position"])
	}
}

// An agent saved before the studio existed must still bootstrap exactly as it does
// today, or every live widget changes appearance on deploy.
func TestWidgetBootstrapKeepsLegacyAgentsIntact(t *testing.T) {
	legacy := model.Agent{
		ID: "agt_legacy", AccountID: "org_legacy", Name: "Legacy Bot", Status: "published",
		WelcomeMessage: "Hi", Branding: model.BrandingConfig{AccentColor: "#F97316", Position: "bottom_right"},
	}
	payload := publicAgent(legacy)

	if payload["display_name"] != "Legacy Bot" {
		t.Errorf("an agent with no display name must fall back to its own name, got %v", payload["display_name"])
	}
	if payload["position"] != "bottom_right" {
		t.Errorf("placement changed for a legacy agent: %v", payload["position"])
	}
	// The keys the deployed widget already reads must still be present.
	for _, key := range []string{"welcome_message", "avatar_url", "privacy_url", "memory_enabled", "lead_capture_enabled"} {
		if _, present := payload[key]; !present {
			t.Errorf("legacy bootstrap key %q disappeared", key)
		}
	}
}
