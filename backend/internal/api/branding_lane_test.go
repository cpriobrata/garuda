package api

import (
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"strings"
	"testing"

	"garuda/backend/internal/model"
)

// resolvedBrandingOf pulls the server-resolved branding out of an agent detail
// response so a test asserts against the contract the widget and the settings
// screen actually consume rather than against the stored record.
func resolvedBrandingOf(t *testing.T, payload map[string]any) map[string]any {
	t.Helper()
	branding, ok := payload["resolved_branding"].(map[string]any)
	if !ok {
		t.Fatalf("expected resolved_branding on the agent payload, got %v", payload["resolved_branding"])
	}
	return branding
}

func nestedMap(t *testing.T, parent map[string]any, key string) map[string]any {
	t.Helper()
	value, ok := parent[key].(map[string]any)
	if !ok {
		t.Fatalf("expected %q to be an object, got %v", key, parent[key])
	}
	return value
}

// TestAbsentBrandingResolvesToTodaysWidget is the guard on the whole additive
// promise. An agent stored before themes, toggles and the form builder existed
// carries none of those keys, and every one of them has to resolve to the widget
// that agent already shows on a customer's website.
func TestAbsentBrandingResolvesToTodaysWidget(t *testing.T) {
	server, dataStore := newTestServer(t)
	agent, token := agentsAPIWorkspace(t, server, dataStore, "legacybrand", nil)

	response := performAgentsAPIRequest(t, server.Handler(), http.MethodGet, "/v1/agents/"+agent.ID, token, nil, "")
	payload := dataFrom(t, response, http.StatusOK)
	branding := resolvedBrandingOf(t, payload)

	if branding["display_name"] != "Website assistant" {
		t.Fatalf("expected the agent name as the display name, got %v", branding["display_name"])
	}
	if branding["position"] != "bottom_right" {
		t.Fatalf("expected an absent position to resolve to bottom_right, got %v", branding["position"])
	}
	if branding["theme"] != "custom" {
		t.Fatalf("expected an absent theme to resolve to custom, got %v", branding["theme"])
	}
	colors := nestedMap(t, branding, "colors")
	for key, want := range map[string]string{
		"primary": "#111827", "accent": "#F97316", "background": "#FFFFFF",
		"surface": "#F3F4F6", "text": "#111827", "on_primary": "#FFFFFF", "on_accent": "#111827",
	} {
		if colors[key] != want {
			t.Fatalf("expected resolved %s %s, got %v", key, want, colors[key])
		}
	}
	toggles := nestedMap(t, branding, "toggles")
	if toggles["chat"] != true {
		t.Fatalf("an absent toggle object must leave chat switched on, got %v", toggles["chat"])
	}
	for _, name := range []string{"transcription", "autostart", "mute_on_minimize", "mute_on_tab_change", "show_lead_form", "is_glowing", "is_transparent", "agent_mute"} {
		if toggles[name] != false {
			t.Fatalf("expected toggle %s to default off, got %v", name, toggles[name])
		}
	}

	form := nestedMap(t, payload, "resolved_lead_form")
	if form["submit_label"] != "Submit" || form["heading"] != "Share your contact details" {
		t.Fatalf("unexpected default form chrome: %v / %v", form["heading"], form["submit_label"])
	}
	fields, ok := form["fields"].([]any)
	if !ok || len(fields) != 2 {
		t.Fatalf("expected the legacy name and email fields to resolve into a form, got %v", form["fields"])
	}
	first := fields[0].(map[string]any)
	second := fields[1].(map[string]any)
	if first["id"] != "name" || first["type"] != "text" || first["label"] != "Name" {
		t.Fatalf("unexpected first legacy field: %v", first)
	}
	if second["id"] != "email" || second["type"] != "email" {
		t.Fatalf("unexpected second legacy field: %v", second)
	}
	if first["required"] == true || second["required"] == true {
		t.Fatalf("a legacy form marked nothing required and must not start doing so: %v %v", first, second)
	}
}

// TestLegacyBrandingEncodesWithoutTheNewKeys proves the additions are genuinely
// additive on disk. If any of them lost its omitempty the state file would grow
// a key for every agent, and a rollback to the previous binary would then be
// reading a file it never wrote.
func TestLegacyBrandingEncodesWithoutTheNewKeys(t *testing.T) {
	encoded, err := json.Marshal(model.Agent{
		Branding:    model.BrandingConfig{PrimaryColor: "#111827", AccentColor: "#F97316", Position: "bottom_right"},
		LeadCapture: model.LeadCaptureConfig{Enabled: true, Fields: []string{"name"}},
	})
	if err != nil {
		t.Fatalf("marshal agent: %v", err)
	}
	for _, key := range []string{"display_name", "tagline", "logo_url", "theme", "custom_colors", "toggles", "form_heading", "submit_label", "form_fields"} {
		if strings.Contains(string(encoded), `"`+key+`"`) {
			t.Fatalf("an unset %s must not be written to the state file: %s", key, encoded)
		}
	}
	if model.SchemaVersion != 2 {
		t.Fatalf("branding is additive and must not move the schema version, got %d", model.SchemaVersion)
	}
}

// TestThemePresetsResolveServerSideAndStayReadable covers the reason presets are
// resolved here at all: the widget never learns the table, so the table has to be
// right. Every palette faces the same contrast floors a customer's own colours do.
func TestThemePresetsResolveServerSideAndStayReadable(t *testing.T) {
	named := 0
	for _, preset := range themePresets {
		if preset.ID == themeCustom {
			if preset.Colors != nil {
				t.Fatalf("the custom theme must carry no fixed palette, got %+v", preset.Colors)
			}
			continue
		}
		named++
		if preset.Description == "" || preset.Label == "" {
			t.Fatalf("preset %s needs a label and a description for the picker", preset.ID)
		}
		details := map[string]string{}
		validateContrast(*preset.Colors, details)
		if len(details) > 0 {
			t.Fatalf("preset %s is unreadable: %v", preset.ID, details)
		}
	}
	if named != 5 || len(themePresets) != 6 {
		t.Fatalf("expected five named presets plus custom, got %d of %d", named, len(themePresets))
	}

	server, dataStore := newTestServer(t)
	agent, token := agentsAPIWorkspace(t, server, dataStore, "themepreset", nil)
	response := performAgentsAPIRequest(t, server.Handler(), http.MethodPatch, "/v1/agents/"+agent.ID, token, nil, `{"branding":{"theme":"royal_purple"}}`)
	branding := resolvedBrandingOf(t, dataFrom(t, response, http.StatusOK))
	colors := nestedMap(t, branding, "colors")
	if colors["primary"] != "#4C1D95" || colors["accent"] != "#7C3AED" || colors["on_primary"] != "#FFFFFF" {
		t.Fatalf("a preset must override the stored primary and accent, got %v", colors)
	}
	if branding["theme"] != "royal_purple" {
		t.Fatalf("expected the stored theme to be echoed, got %v", branding["theme"])
	}
}

// TestAutostartAndLeadFormAreMutuallyExclusive is the rule the settings screen
// cannot be trusted with alone: a widget cannot both open the conversation and
// gate it behind a form.
func TestAutostartAndLeadFormAreMutuallyExclusive(t *testing.T) {
	server, dataStore := newTestServer(t)
	agent, token := agentsAPIWorkspace(t, server, dataStore, "toggleconflict", nil)

	both := performAgentsAPIRequest(t, server.Handler(), http.MethodPatch, "/v1/agents/"+agent.ID, token, nil,
		`{"branding":{"toggles":{"autostart":true,"show_lead_form":true}}}`)
	failure := agentsAPIErrorBody(t, both, http.StatusUnprocessableEntity)
	details, ok := failure["details"].(map[string]any)
	if !ok || details["branding.toggles"] == nil {
		t.Fatalf("expected the conflict to be reported against branding.toggles, got %v", failure["details"])
	}

	single := performAgentsAPIRequest(t, server.Handler(), http.MethodPatch, "/v1/agents/"+agent.ID, token, nil,
		`{"branding":{"toggles":{"autostart":true,"is_glowing":true,"chat":false}}}`)
	toggles := nestedMap(t, resolvedBrandingOf(t, dataFrom(t, single, http.StatusOK)), "toggles")
	if toggles["autostart"] != true || toggles["show_lead_form"] != false {
		t.Fatalf("expected autostart alone to be accepted, got %v", toggles)
	}
	if toggles["is_glowing"] != true || toggles["chat"] != false {
		t.Fatalf("each toggle must switch independently, got %v", toggles)
	}
}

// TestUnreadableCustomColorsAreRejectedByPair is the readability guard. The
// error has to name the pairing, because "colors are invalid" against seven
// colours tells a customer nothing about which two to change.
func TestUnreadableCustomColorsAreRejectedByPair(t *testing.T) {
	server, dataStore := newTestServer(t)
	agent, token := agentsAPIWorkspace(t, server, dataStore, "contrastfail", nil)

	response := performAgentsAPIRequest(t, server.Handler(), http.MethodPatch, "/v1/agents/"+agent.ID, token, nil,
		`{"branding":{"custom_colors":{"text":"#FFFFFF","background":"#FFFFFF","surface":"#111827"}}}`)
	failure := agentsAPIErrorBody(t, response, http.StatusUnprocessableEntity)
	details, ok := failure["details"].(map[string]any)
	if !ok {
		t.Fatalf("expected validation details, got %v", failure)
	}
	message, ok := details["branding.contrast.text_on_background"].(string)
	if !ok {
		t.Fatalf("expected the failing pair to be named, got %v", details)
	}
	if !strings.Contains(message, "#FFFFFF") || !strings.Contains(message, "4.5:1") {
		t.Fatalf("expected the message to carry the colours and the threshold, got %q", message)
	}
	if details["branding.contrast.text_on_surface"] != nil {
		t.Fatalf("white on #111827 is readable and must not be reported: %v", details)
	}

	readable := performAgentsAPIRequest(t, server.Handler(), http.MethodPatch, "/v1/agents/"+agent.ID, token, nil,
		`{"branding":{"custom_colors":{"text":"#1F2937","background":"#FFFFFF","surface":"#F3F4F6","on_primary":"#FFFFFF","on_accent":"#111827"}}}`)
	colors := nestedMap(t, resolvedBrandingOf(t, dataFrom(t, readable, http.StatusOK)), "colors")
	if colors["text"] != "#1F2937" || colors["on_accent"] != "#111827" {
		t.Fatalf("expected a readable custom palette to be stored as authored, got %v", colors)
	}
}

// TestSixWidgetPositionsAreAccepted covers the placement enum widening from two
// to six without loosening it into a free-text field.
func TestSixWidgetPositionsAreAccepted(t *testing.T) {
	server, dataStore := newTestServer(t)
	agent, token := agentsAPIWorkspace(t, server, dataStore, "positions", nil)
	if len(widgetPositions) != 6 {
		t.Fatalf("expected six placements, got %d", len(widgetPositions))
	}
	for _, position := range widgetPositions {
		response := performAgentsAPIRequest(t, server.Handler(), http.MethodPatch, "/v1/agents/"+agent.ID, token, nil,
			fmt.Sprintf(`{"branding":{"position":%q}}`, position))
		branding := resolvedBrandingOf(t, dataFrom(t, response, http.StatusOK))
		if branding["position"] != position {
			t.Fatalf("expected position %s to survive the round trip, got %v", position, branding["position"])
		}
	}
	rejected := performAgentsAPIRequest(t, server.Handler(), http.MethodPatch, "/v1/agents/"+agent.ID, token, nil,
		`{"branding":{"position":"middle_center"}}`)
	failure := agentsAPIErrorBody(t, rejected, http.StatusUnprocessableEntity)
	if details, ok := failure["details"].(map[string]any); !ok || details["branding.position"] == nil {
		t.Fatalf("expected an unknown placement to be refused, got %v", failure["details"])
	}
}

// TestLeadFormBuilderAcceptsCustomFieldsAndRefusesBrokenOnes walks the builder
// end to end: custom fields beyond name, email and phone are kept in order with
// stable identifiers, and the four ways a form can be unusable are each refused
// against the field that caused it.
func TestLeadFormBuilderAcceptsCustomFieldsAndRefusesBrokenOnes(t *testing.T) {
	server, dataStore := newTestServer(t)
	agent, token := agentsAPIWorkspace(t, server, dataStore, "leadform", nil)

	valid := `{"lead_capture":{"enabled":true,"prompt":"","after_turns":2,"fields":[],
		"form_heading":"Tell us where to reach you","submit_label":"Send it",
		"form_fields":[
			{"label":"Full name","type":"text","required":true,"placeholder":"Ada Lovelace"},
			{"label":"Work email","type":"email","required":true},
			{"id":"budget","label":"Budget","type":"select","options":["Under 5k","5k to 20k"]},
			{"label":"Preferred date","type":"date"}
		]}}`
	response := performAgentsAPIRequest(t, server.Handler(), http.MethodPatch, "/v1/agents/"+agent.ID, token, nil, valid)
	payload := dataFrom(t, response, http.StatusOK)
	form := nestedMap(t, payload, "resolved_lead_form")
	if form["heading"] != "Tell us where to reach you" || form["submit_label"] != "Send it" {
		t.Fatalf("expected the customer's own heading and button text, got %v / %v", form["heading"], form["submit_label"])
	}
	fields, ok := form["fields"].([]any)
	if !ok || len(fields) != 4 {
		t.Fatalf("expected four ordered fields, got %v", form["fields"])
	}
	wantIDs := []string{"full_name", "work_email", "budget", "preferred_date"}
	for index, want := range wantIDs {
		field := fields[index].(map[string]any)
		if field["id"] != want {
			t.Fatalf("expected field %d to be %s, got %v", index, want, field["id"])
		}
	}
	if options, ok := fields[2].(map[string]any)["options"].([]any); !ok || len(options) != 2 {
		t.Fatalf("expected the select field to keep its options, got %v", fields[2])
	}
	if fields[0].(map[string]any)["required"] != true || fields[3].(map[string]any)["required"] == true {
		t.Fatalf("required must be per field, got %v and %v", fields[0], fields[3])
	}

	broken := map[string]string{
		"lead_capture.form_fields.0.options": `{"lead_capture":{"enabled":true,"after_turns":1,"form_fields":[
			{"label":"Budget","type":"select","options":["Only one"]},{"label":"Email","type":"email"}]}}`,
		"lead_capture.form_fields.1.id": `{"lead_capture":{"enabled":true,"after_turns":1,"form_fields":[
			{"id":"email","label":"Email","type":"email"},{"id":"email","label":"Second email","type":"email"}]}}`,
		"lead_capture.form_fields.0.type": `{"lead_capture":{"enabled":true,"after_turns":1,"form_fields":[
			{"label":"Signature","type":"canvas"},{"label":"Email","type":"email"}]}}`,
		"lead_capture.form_fields": `{"lead_capture":{"enabled":true,"after_turns":1,"form_fields":[
			{"label":"Full name","type":"text"}]}}`,
	}
	for wantKey, body := range broken {
		failure := agentsAPIErrorBody(t, performAgentsAPIRequest(t, server.Handler(), http.MethodPatch, "/v1/agents/"+agent.ID, token, nil, body), http.StatusUnprocessableEntity)
		details, ok := failure["details"].(map[string]any)
		if !ok || details[wantKey] == nil {
			t.Fatalf("expected %s to be reported, got %v", wantKey, failure["details"])
		}
	}
}

// TestLogoMustBeAnAbsoluteHTTPSURL: there is no object storage in this project,
// so the logo is a URL the customer supplies and it has to be one the widget can
// load from a page served over HTTPS.
func TestLogoMustBeAnAbsoluteHTTPSURL(t *testing.T) {
	server, dataStore := newTestServer(t)
	agent, token := agentsAPIWorkspace(t, server, dataStore, "logourl", nil)

	for _, rejected := range []string{"http://cdn.example.com/logo.png", "/logo.png", "javascript:alert(1)"} {
		body := fmt.Sprintf(`{"branding":{"logo_url":%q}}`, rejected)
		failure := agentsAPIErrorBody(t, performAgentsAPIRequest(t, server.Handler(), http.MethodPatch, "/v1/agents/"+agent.ID, token, nil, body), http.StatusUnprocessableEntity)
		details, ok := failure["details"].(map[string]any)
		if !ok || details["branding.logo_url"] == nil {
			t.Fatalf("expected %q to be refused, got %v", rejected, failure["details"])
		}
	}
	accepted := performAgentsAPIRequest(t, server.Handler(), http.MethodPatch, "/v1/agents/"+agent.ID, token, nil,
		`{"branding":{"logo_url":"https://cdn.example.com/logo.png","display_name":"Nova","tagline":"Answers in seconds"}}`)
	branding := resolvedBrandingOf(t, dataFrom(t, accepted, http.StatusOK))
	if branding["logo_url"] != "https://cdn.example.com/logo.png" || branding["display_name"] != "Nova" || branding["tagline"] != "Answers in seconds" {
		t.Fatalf("expected the widget identity to round trip, got %v", branding)
	}
}

// TestWidgetBootstrapPayloadCarriesResolvedBranding pins the shape the widget
// bootstrap merges in. The widget must be able to paint without knowing the
// preset table or any default, so every key here is already concrete.
func TestWidgetBootstrapPayloadCarriesResolvedBranding(t *testing.T) {
	agent := model.Agent{
		Name: "Website assistant",
		Branding: model.BrandingConfig{
			PrimaryColor: "#111827", AccentColor: "#F97316", Position: "top_left",
			Theme: "forest_green", Tagline: "Here to help", LogoURL: "https://cdn.example.com/logo.png",
		},
		LeadCapture: model.LeadCaptureConfig{Enabled: true, Fields: []string{"name", "phone"}},
	}
	payload := widgetBrandingPayload(agent)
	if payload["display_name"] != "Website assistant" || payload["tagline"] != "Here to help" {
		t.Fatalf("unexpected identity in the bootstrap payload: %v", payload)
	}
	if payload["position"] != "top_left" || payload["theme"] != "forest_green" {
		t.Fatalf("unexpected placement or theme: %v", payload)
	}
	colors, ok := payload["theme_colors"].(model.ThemeColors)
	if !ok || colors.Primary != "#1B5E3F" {
		t.Fatalf("expected the forest green palette resolved server-side, got %v", payload["theme_colors"])
	}
	if payload["primary_color"] != colors.Primary || payload["accent_color"] != colors.Accent {
		t.Fatalf("the flat colour keys the widget reads today must follow the resolved palette: %v", payload)
	}
	toggles, ok := payload["toggles"].(resolvedToggles)
	if !ok || !toggles.Chat {
		t.Fatalf("expected concrete toggles with chat on, got %v", payload["toggles"])
	}
	form, ok := payload["lead_form"].(resolvedLeadForm)
	if !ok || len(form.Fields) != 2 || form.Fields[1].Type != "telephone" {
		t.Fatalf("expected the legacy fields resolved into a form, got %v", payload["lead_form"])
	}
}

// TestContrastRatioMatchesWCAGReferenceValues checks the arithmetic against the
// three ratios the specification itself pins down, so a refactor of the transfer
// curve cannot quietly turn the readability guard into a rubber stamp.
func TestContrastRatioMatchesWCAGReferenceValues(t *testing.T) {
	cases := []struct {
		foreground, background string
		want                   float64
	}{
		{"#000000", "#FFFFFF", 21},
		{"#FFFFFF", "#FFFFFF", 1},
		{"#777777", "#FFFFFF", 4.478},
		{"#767676", "#FFFFFF", 4.541},
	}
	for _, testCase := range cases {
		got := contrastRatio(testCase.foreground, testCase.background)
		if math.Abs(got-testCase.want) > 0.005 {
			t.Fatalf("%s on %s: expected %.3f, got %.3f", testCase.foreground, testCase.background, testCase.want, got)
		}
	}
	if relativeLuminance("#FFFFFF") != 1 {
		t.Fatalf("white must have full relative luminance, got %v", relativeLuminance("#FFFFFF"))
	}
	// #767676 is the darkest grey that passes 4.5:1 on white and #777777 the
	// lightest that fails, which is exactly the boundary the guard sits on.
	if readableForeground("#FACC15") != darkForegroundColor || readableForeground("#4C1D95") != lightForegroundColor {
		t.Fatalf("a derived foreground must follow the fill it sits on")
	}
	for _, fill := range []string{"#808080", "#767676", "#000000", "#FFFFFF", "#F97316"} {
		if ratio := contrastRatio(readableForeground(fill), fill); ratio < contrastMinimumInterface {
			t.Fatalf("a derived foreground must always clear the interface floor, %s gave %.2f", fill, ratio)
		}
	}
}

// TestExistingAgentsStillSaveAndPublish is the production guard on the new
// rules. Validation runs against the stored record on every save and on every
// publish, so a rule that a legacy agent cannot satisfy does not fail a form --
// it locks a paying customer out of publishing. A mid-grey brand colour is the
// worst case for the derived foreground, and it still has to clear the floor.
func TestExistingAgentsStillSaveAndPublish(t *testing.T) {
	server, dataStore := newTestServer(t)
	agent, token := agentsAPIWorkspace(t, server, dataStore, "legacypublish", nil)

	for _, brandColor := range []string{"#808080", "#767676", "#FFFFFF", "#000000", "#FACC15"} {
		body := fmt.Sprintf(`{"branding":{"primary_color":%q,"accent_color":%q}}`, brandColor, brandColor)
		response := performAgentsAPIRequest(t, server.Handler(), http.MethodPatch, "/v1/agents/"+agent.ID, token, nil, body)
		if response.Code != http.StatusOK {
			t.Fatalf("brand colour %s must stay saveable, got %d: %s", brandColor, response.Code, response.Body.String())
		}
		colors := nestedMap(t, resolvedBrandingOf(t, dataFrom(t, response, http.StatusOK)), "colors")
		foreground, _ := colors["on_primary"].(string)
		if ratio := contrastRatio(foreground, brandColor); ratio < contrastMinimumInterface {
			t.Fatalf("derived foreground %s on %s is only %.2f:1", foreground, brandColor, ratio)
		}
	}

	published := performAgentsAPIRequest(t, server.Handler(), http.MethodPost, "/v1/agents/"+agent.ID+"/publish", token, nil, "")
	if published.Code != http.StatusOK {
		t.Fatalf("an agent carrying no branding additions must still publish, got %d: %s", published.Code, published.Body.String())
	}
}

// TestBrandingCloneDoesNotAliasLiveState covers house rule six for the two
// pointers and the nested option slices the branding contract adds. A value read
// under store.View and encoded after the lock is released would otherwise share
// memory with state another request is writing, which is a fatal error rather
// than a recoverable one.
func TestBrandingCloneDoesNotAliasLiveState(t *testing.T) {
	transcription, chat := true, true
	original := model.Agent{
		Branding: model.BrandingConfig{
			AllowedDomains: []string{"example.com"},
			CustomColors:   &model.CustomColors{Text: "#111827"},
			Toggles:        &model.WidgetToggles{Transcription: &transcription, Chat: &chat},
		},
		LeadCapture: model.LeadCaptureConfig{
			Fields:     []string{"name"},
			FormFields: []model.LeadFormField{{ID: "budget", Label: "Budget", Type: "select", Options: []string{"S", "M"}}},
		},
	}
	cloned := original.Clone()

	if cloned.Branding.CustomColors == original.Branding.CustomColors {
		t.Fatal("custom colors must not share an address with live state")
	}
	if cloned.Branding.Toggles == original.Branding.Toggles {
		t.Fatal("toggles must not share an address with live state")
	}
	if cloned.Branding.Toggles.Transcription == original.Branding.Toggles.Transcription {
		t.Fatal("each toggle pointer must be copied, not shared")
	}

	cloned.Branding.CustomColors.Text = "#FFFFFF"
	*cloned.Branding.Toggles.Transcription = false
	cloned.Branding.AllowedDomains[0] = "attacker.example"
	cloned.LeadCapture.FormFields[0].Options[0] = "XL"
	cloned.LeadCapture.Fields[0] = "email"

	if original.Branding.CustomColors.Text != "#111827" {
		t.Fatalf("writing the clone changed live custom colors: %v", original.Branding.CustomColors)
	}
	if !*original.Branding.Toggles.Transcription {
		t.Fatal("writing the clone changed a live toggle")
	}
	if original.Branding.AllowedDomains[0] != "example.com" {
		t.Fatalf("writing the clone changed live allowed domains: %v", original.Branding.AllowedDomains)
	}
	if original.LeadCapture.FormFields[0].Options[0] != "S" {
		t.Fatalf("writing the clone changed live form options: %v", original.LeadCapture.FormFields[0].Options)
	}
	if original.LeadCapture.Fields[0] != "name" {
		t.Fatalf("writing the clone changed the live legacy fields: %v", original.LeadCapture.Fields)
	}
}
