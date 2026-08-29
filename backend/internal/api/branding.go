package api

import (
	"fmt"
	"math"
	"net/url"
	"strconv"
	"strings"

	"garuda/backend/internal/model"
)

// This file is the whole branding contract: the theme table, the widget
// placements, the nine toggles, the lead form builder, and the readability rule
// that stops a customer configuring text nobody can read on their own website.
//
// Two principles hold everything together and neither is negotiable.
//
// First, every field here arrived after agents were already serving traffic, so
// absent has to mean "behave exactly as the product behaved yesterday" rather
// than "zero value". A stored agent with no theme, no toggles and no form still
// resolves to the palette, the switches and the name/email/phone form it has
// always shown.
//
// Second, resolution happens on the server. The widget is loaded from other
// companies' websites and cannot be redeployed on demand, so it must never carry
// the preset table or a default table of its own. It receives concrete colours
// and concrete booleans, which means a preset can be retuned here and every
// embedded widget picks the change up on its next bootstrap.

// The six widget placements. The original two keep their exact names so no
// stored agent has to be migrated; the four added complete a left/right column
// against a top/middle/bottom row.
const (
	positionBottomRight = "bottom_right"
	positionBottomLeft  = "bottom_left"
	positionMiddleRight = "middle_right"
	positionMiddleLeft  = "middle_left"
	positionTopRight    = "top_right"
	positionTopLeft     = "top_left"
)

// widgetPositions is the enum, in the order a settings screen should offer it.
var widgetPositions = []string{
	positionBottomRight, positionBottomLeft,
	positionMiddleRight, positionMiddleLeft,
	positionTopRight, positionTopLeft,
}

// The six themes. Five are fixed palettes; "custom" hands the individual colours
// back to the customer.
const (
	themeOceanBlue    = "ocean_blue"
	themeForestGreen  = "forest_green"
	themeSunsetOrange = "sunset_orange"
	themeSummerYellow = "summer_yellow"
	themeRoyalPurple  = "royal_purple"
	themeCustom       = "custom"
)

// themePreset is one row of the theme picker. Description is the sentence the
// owner's design puts under the swatch, and it is served rather than hardcoded
// in the settings screen so the wording has one home.
// Colors is a pointer so the custom row can carry null rather than seven empty
// strings: custom has no fixed palette, and null says that where "" would read
// as a colour nobody set.
type themePreset struct {
	ID          string             `json:"id"`
	Label       string             `json:"label"`
	Description string             `json:"description"`
	Colors      *model.ThemeColors `json:"colors"`
}

// themePresets is the whole table, in picker order. Every palette in it is
// verified against the same contrast thresholds a customer's own colours face,
// so a preset can never be the reason a widget is unreadable.
var themePresets = []themePreset{
	{
		ID: themeOceanBlue, Label: "Ocean blue", Description: "Calm and professional",
		Colors: &model.ThemeColors{
			Primary: "#0F4C81", Accent: "#2E8BC0", Background: "#FFFFFF",
			Surface: "#EEF4FA", Text: "#0F1D2B", OnPrimary: "#FFFFFF", OnAccent: "#FFFFFF",
		},
	},
	{
		ID: themeForestGreen, Label: "Forest green", Description: "Natural and balanced",
		Colors: &model.ThemeColors{
			Primary: "#1B5E3F", Accent: "#2E9E63", Background: "#FFFFFF",
			Surface: "#EDF6F0", Text: "#10231A", OnPrimary: "#FFFFFF", OnAccent: "#FFFFFF",
		},
	},
	{
		ID: themeSunsetOrange, Label: "Sunset orange", Description: "Warm and energetic",
		Colors: &model.ThemeColors{
			Primary: "#B23A0B", Accent: "#F97316", Background: "#FFFFFF",
			Surface: "#FFF3EA", Text: "#2A1508", OnPrimary: "#FFFFFF", OnAccent: "#111827",
		},
	},
	{
		ID: themeSummerYellow, Label: "Summer yellow", Description: "Bright and cheerful",
		Colors: &model.ThemeColors{
			Primary: "#A16207", Accent: "#FACC15", Background: "#FFFFFF",
			Surface: "#FEF9E7", Text: "#2B2205", OnPrimary: "#FFFFFF", OnAccent: "#111827",
		},
	},
	{
		ID: themeRoyalPurple, Label: "Royal purple", Description: "Creative and luxurious",
		Colors: &model.ThemeColors{
			Primary: "#4C1D95", Accent: "#7C3AED", Background: "#FFFFFF",
			Surface: "#F4EFFE", Text: "#1E1235", OnPrimary: "#FFFFFF", OnAccent: "#FFFFFF",
		},
	},
	{
		ID: themeCustom, Label: "Custom", Description: "Customizable for you",
	},
}

// The colours a custom theme falls back to when the customer has not set one.
// They are the palette the widget has always painted with, so an agent that
// predates the theme picker resolves to exactly the widget it has today.
const (
	defaultBackgroundColor = "#FFFFFF"
	defaultSurfaceColor    = "#F3F4F6"
	defaultTextColor       = "#111827"
	lightForegroundColor   = "#FFFFFF"
	darkForegroundColor    = "#111827"
)

// The two WCAG 2.1 contrast floors this service enforces. Body text sits at the
// AA minimum for normal text. The label printed on a filled control -- the
// header title over the primary fill, the send button's label over the accent --
// is large text on a user interface component, whose AA minimum is 3:1.
//
// The lower floor is not a shortcut. When a foreground is derived rather than
// chosen, the best of white and near-black against the worst possible mid-grey
// fill reaches only about 4.06:1, so a 4.5 floor would reject a colour the
// customer never picked a foreground for. 3:1 is the correct standard for that
// pairing and it is always satisfiable.
const (
	contrastMinimumBodyText  = 4.5
	contrastMinimumInterface = 3.0
)

// The lead form builder's field types, in the order a picker should offer them.
const (
	leadFieldTypeText      = "text"
	leadFieldTypeEmail     = "email"
	leadFieldTypeTelephone = "telephone"
	leadFieldTypeNumber    = "number"
	leadFieldTypeTextarea  = "textarea"
	leadFieldTypeSelect    = "select"
	leadFieldTypeCheckbox  = "checkbox"
	leadFieldTypeDate      = "date"
)

var leadFormFieldTypes = []string{
	leadFieldTypeText, leadFieldTypeEmail, leadFieldTypeTelephone, leadFieldTypeNumber,
	leadFieldTypeTextarea, leadFieldTypeSelect, leadFieldTypeCheckbox, leadFieldTypeDate,
}

// The limits on a customer-authored form. The field count and the identifier
// length match the caps the widget lead endpoint already applies to a submitted
// custom_fields object, so a form that validates here can always be submitted.
const (
	leadFormFieldLimit       = widgetLeadCustomFieldLimit
	leadFormFieldIDLimit     = widgetLeadCustomFieldKeyLimit
	leadFormLabelLimit       = 80
	leadFormPlaceholderLimit = 120
	leadFormHeadingLimit     = 120
	leadFormSubmitLabelLimit = 40
	leadFormOptionLimit      = 20
	leadFormOptionTextLimit  = 80
	displayNameLimit         = 60
	taglineLimit             = 140
)

// reservedLeadFieldIDs are the identifiers whose answers land on the lead
// record's own columns instead of in its custom metadata. A customer may
// reorder, relabel or remove them, but an identifier means the same thing for
// every account, which is what lets one leads table hold every customer's form.
var reservedLeadFieldIDs = []string{"name", "email", "phone", "company"}

// legacyLeadFieldTypes maps the strings the original Fields list could hold onto
// the builder's field types, so an agent that never opened the builder still
// resolves to a complete, ordered form.
var legacyLeadFieldTypes = map[string]string{
	"name": leadFieldTypeText, "email": leadFieldTypeEmail,
	"phone": leadFieldTypeTelephone, "company": leadFieldTypeText,
}

var legacyLeadFieldLabels = map[string]string{
	"name": "Name", "email": "Email", "phone": "Phone", "company": "Company",
}

// resolvedToggles is what the widget receives: nine plain booleans with no
// absent case left in them.
type resolvedToggles struct {
	Transcription   bool `json:"transcription"`
	Chat            bool `json:"chat"`
	Autostart       bool `json:"autostart"`
	MuteOnMinimize  bool `json:"mute_on_minimize"`
	MuteOnTabChange bool `json:"mute_on_tab_change"`
	ShowLeadForm    bool `json:"show_lead_form"`
	IsGlowing       bool `json:"is_glowing"`
	IsTransparent   bool `json:"is_transparent"`
	AgentMute       bool `json:"agent_mute"`
}

// defaultToggles is the answer for an agent that has never been through the new
// settings screen, and therefore has to be today's widget exactly: chat on,
// everything else off.
func defaultToggles() resolvedToggles {
	return resolvedToggles{Chat: true}
}

// resolvedBranding is the complete, concrete branding the widget and the
// settings preview both paint from.
type resolvedBranding struct {
	DisplayName  string            `json:"display_name"`
	Tagline      string            `json:"tagline"`
	LogoURL      string            `json:"logo_url"`
	AvatarURL    string            `json:"avatar_url"`
	LauncherText string            `json:"launcher_text"`
	PrivacyURL   string            `json:"privacy_url"`
	Position     string            `json:"position"`
	Theme        string            `json:"theme"`
	Colors       model.ThemeColors `json:"colors"`
	Toggles      resolvedToggles   `json:"toggles"`
}

// resolvedLeadForm is the ordered form the widget renders. Fields is never null
// and never empty for an agent with lead capture switched on, whether or not the
// customer has ever used the builder.
type resolvedLeadForm struct {
	Enabled     bool                  `json:"enabled"`
	Prompt      string                `json:"prompt"`
	AfterTurns  int                   `json:"after_turns"`
	Heading     string                `json:"heading"`
	SubmitLabel string                `json:"submit_label"`
	PrivacyText string                `json:"privacy_text"`
	Fields      []model.LeadFormField `json:"fields"`
}

// resolveTheme turns a stored branding configuration into concrete colours.
//
// A named preset wins outright: its palette is returned whole, so retuning a
// preset here changes every widget using it. "custom", and an absent theme,
// which means the same thing, take primary and accent from the fields that have
// always held them and fill the rest from the customer's custom colours or the
// documented defaults.
func resolveTheme(branding model.BrandingConfig) model.ThemeColors {
	theme := normalizeTheme(branding.Theme)
	for _, preset := range themePresets {
		if preset.ID == theme && preset.Colors != nil {
			return *preset.Colors
		}
	}
	custom := model.CustomColors{}
	if branding.CustomColors != nil {
		custom = *branding.CustomColors
	}
	colors := model.ThemeColors{
		Primary:    firstValidColor(branding.PrimaryColor, darkForegroundColor),
		Accent:     firstValidColor(branding.AccentColor, "#F97316"),
		Background: firstValidColor(custom.Background, defaultBackgroundColor),
		Surface:    firstValidColor(custom.Surface, defaultSurfaceColor),
		Text:       firstValidColor(custom.Text, defaultTextColor),
	}
	// A foreground the customer has not chosen is derived rather than defaulted,
	// because a fixed default would be unreadable on half the possible fills.
	colors.OnPrimary = firstValidColor(custom.OnPrimary, readableForeground(colors.Primary))
	colors.OnAccent = firstValidColor(custom.OnAccent, readableForeground(colors.Accent))
	return colors
}

// resolveToggles fills in every switch the customer has not set. It applies the
// mutual exclusion as a last line of defence too: validation rejects a request
// that turns on both autostart and the lead form, but state written before that
// rule existed must still resolve to one coherent answer rather than to a widget
// that tries to open a form and start talking at the same time.
func resolveToggles(branding model.BrandingConfig) resolvedToggles {
	toggles := defaultToggles()
	if branding.Toggles == nil {
		return toggles
	}
	stored := branding.Toggles
	toggles.Transcription = boolOrDefault(stored.Transcription, toggles.Transcription)
	toggles.Chat = boolOrDefault(stored.Chat, toggles.Chat)
	toggles.Autostart = boolOrDefault(stored.Autostart, toggles.Autostart)
	toggles.MuteOnMinimize = boolOrDefault(stored.MuteOnMinimize, toggles.MuteOnMinimize)
	toggles.MuteOnTabChange = boolOrDefault(stored.MuteOnTabChange, toggles.MuteOnTabChange)
	toggles.ShowLeadForm = boolOrDefault(stored.ShowLeadForm, toggles.ShowLeadForm)
	toggles.IsGlowing = boolOrDefault(stored.IsGlowing, toggles.IsGlowing)
	toggles.IsTransparent = boolOrDefault(stored.IsTransparent, toggles.IsTransparent)
	toggles.AgentMute = boolOrDefault(stored.AgentMute, toggles.AgentMute)
	if toggles.Autostart && toggles.ShowLeadForm {
		toggles.Autostart = false
	}
	return toggles
}

// resolveBranding is the single place either consumer gets its answer from.
func resolveBranding(agent model.Agent) resolvedBranding {
	return resolvedBranding{
		DisplayName:  firstProvidedValue(agent.Branding.DisplayName, agent.Name),
		Tagline:      strings.TrimSpace(agent.Branding.Tagline),
		LogoURL:      strings.TrimSpace(agent.Branding.LogoURL),
		AvatarURL:    strings.TrimSpace(agent.Branding.AvatarURL),
		LauncherText: strings.TrimSpace(agent.Branding.LauncherText),
		PrivacyURL:   strings.TrimSpace(agent.Branding.PrivacyURL),
		Position:     normalizePosition(agent.Branding.Position),
		Theme:        normalizeTheme(agent.Branding.Theme),
		Colors:       resolveTheme(agent.Branding),
		Toggles:      resolveToggles(agent.Branding),
	}
}

// resolveLeadForm returns the ordered form to render. When the customer has
// built one it is used as authored. When they have not -- every agent created
// before the builder shipped -- the legacy Fields list is turned into the same
// form the widget has always drawn, in the same order, with nothing marked
// required, because nothing was required before.
func resolveLeadForm(agent model.Agent) resolvedLeadForm {
	capture := agent.LeadCapture
	form := resolvedLeadForm{
		Enabled:     capture.Enabled,
		Prompt:      strings.TrimSpace(capture.Prompt),
		AfterTurns:  capture.AfterTurns,
		Heading:     firstProvidedValue(capture.FormHeading, capture.Prompt, "Share your contact details"),
		SubmitLabel: firstProvidedValue(capture.SubmitLabel, "Submit"),
		PrivacyText: strings.TrimSpace(capture.PrivacyText),
		Fields:      make([]model.LeadFormField, 0, len(capture.FormFields)),
	}
	if len(capture.FormFields) > 0 {
		for _, field := range capture.FormFields {
			field.Options = append([]string(nil), field.Options...)
			form.Fields = append(form.Fields, field)
		}
		return form
	}
	legacy := capture.Fields
	if len(legacy) == 0 {
		legacy = []string{"name", "email", "phone"}
	}
	for _, name := range legacy {
		identifier := slugifyFieldID(name)
		if identifier == "" {
			continue
		}
		fieldType, known := legacyLeadFieldTypes[identifier]
		if !known {
			fieldType = leadFieldTypeText
		}
		label, known := legacyLeadFieldLabels[identifier]
		if !known {
			label = strings.TrimSpace(name)
		}
		form.Fields = append(form.Fields, model.LeadFormField{ID: identifier, Label: label, Type: fieldType})
	}
	return form
}

// widgetBrandingPayload is the branding half of the widget bootstrap. It is a
// map so it can be merged into the payload publicAgent already builds without
// changing any key that is there today: display_name, position and accent_color
// resolve to the same values they hold now whenever the customer has not set the
// new fields.
func widgetBrandingPayload(agent model.Agent) map[string]any {
	branding := resolveBranding(agent)
	return map[string]any{
		"display_name":   branding.DisplayName,
		"tagline":        branding.Tagline,
		"logo_url":       branding.LogoURL,
		"launcher_label": branding.LauncherText,
		"position":       branding.Position,
		"theme":          branding.Theme,
		"theme_colors":   branding.Colors,
		"primary_color":  branding.Colors.Primary,
		"accent_color":   branding.Colors.Accent,
		"toggles":        branding.Toggles,
		"lead_form":      resolveLeadForm(agent),
	}
}

// normalizeBranding trims and lowercases what the customer typed so that
// validation, storage and comparison all see one spelling of each value.
func normalizeBranding(branding *model.BrandingConfig) {
	branding.PrimaryColor = strings.TrimSpace(branding.PrimaryColor)
	branding.AccentColor = strings.TrimSpace(branding.AccentColor)
	branding.Position = normalizePosition(branding.Position)
	branding.AvatarURL = strings.TrimSpace(branding.AvatarURL)
	branding.LauncherText = strings.TrimSpace(branding.LauncherText)
	branding.PrivacyURL = strings.TrimSpace(branding.PrivacyURL)
	branding.DisplayName = strings.TrimSpace(branding.DisplayName)
	branding.Tagline = strings.TrimSpace(branding.Tagline)
	branding.LogoURL = strings.TrimSpace(branding.LogoURL)
	branding.Theme = strings.ToLower(strings.TrimSpace(branding.Theme))
	if branding.CustomColors != nil {
		branding.CustomColors.Background = strings.TrimSpace(branding.CustomColors.Background)
		branding.CustomColors.Surface = strings.TrimSpace(branding.CustomColors.Surface)
		branding.CustomColors.Text = strings.TrimSpace(branding.CustomColors.Text)
		branding.CustomColors.OnPrimary = strings.TrimSpace(branding.CustomColors.OnPrimary)
		branding.CustomColors.OnAccent = strings.TrimSpace(branding.CustomColors.OnAccent)
	}
}

// normalizeLeadCapture trims the form's text and gives every field a stable
// identifier. A field the settings screen created without one is keyed off its
// label, so the customer never has to invent a slug; duplicates are left alone
// for validation to reject by name rather than silently renamed, because a
// silently renamed field is a field whose captured answers stop matching.
func normalizeLeadCapture(capture *model.LeadCaptureConfig) {
	capture.Prompt = strings.TrimSpace(capture.Prompt)
	capture.PrivacyText = strings.TrimSpace(capture.PrivacyText)
	capture.FormHeading = strings.TrimSpace(capture.FormHeading)
	capture.SubmitLabel = strings.TrimSpace(capture.SubmitLabel)
	for index := range capture.FormFields {
		field := &capture.FormFields[index]
		field.Label = strings.TrimSpace(field.Label)
		field.Type = strings.ToLower(strings.TrimSpace(field.Type))
		field.Placeholder = strings.TrimSpace(field.Placeholder)
		field.ID = slugifyFieldID(field.ID)
		if field.ID == "" {
			field.ID = slugifyFieldID(field.Label)
		}
		if field.Type == "" {
			field.Type = leadFieldTypeText
		}
		field.Options = cleanStrings(field.Options, leadFormOptionLimit, leadFormOptionTextLimit)
		if len(field.Options) == 0 {
			field.Options = nil
		}
	}
}

// validateBranding reports every branding problem at once, keyed by the field
// the settings screen should mark. It never stops at the first failure: a
// customer fixing one colour at a time is a customer submitting five times.
func validateBranding(branding model.BrandingConfig, details map[string]string) {
	if !isKnownPosition(branding.Position) {
		details["branding.position"] = "must be one of " + strings.Join(widgetPositions, ", ")
	}
	if branding.Theme != "" && !isKnownTheme(branding.Theme) {
		details["branding.theme"] = "must be one of " + strings.Join(themeIDs(), ", ")
	}
	if len(branding.DisplayName) > displayNameLimit {
		details["branding.display_name"] = fmt.Sprintf("must not exceed %d characters", displayNameLimit)
	}
	if len(branding.Tagline) > taglineLimit {
		details["branding.tagline"] = fmt.Sprintf("must not exceed %d characters", taglineLimit)
	}
	if branding.LogoURL != "" && !isAbsoluteHTTPSURL(branding.LogoURL) {
		details["branding.logo_url"] = "must be an absolute HTTPS URL"
	}
	if branding.CustomColors != nil {
		for field, value := range map[string]string{
			"background": branding.CustomColors.Background,
			"surface":    branding.CustomColors.Surface,
			"text":       branding.CustomColors.Text,
			"on_primary": branding.CustomColors.OnPrimary,
			"on_accent":  branding.CustomColors.OnAccent,
		} {
			if value != "" && !validHexColor(value) {
				details["branding.custom_colors."+field] = "must use a six-digit hex color"
			}
		}
	}
	validateToggles(branding, details)
	validateContrast(resolveTheme(branding), details)
}

// validateToggles enforces the one rule the settings screen cannot be trusted
// with alone. Autostart opens the conversation immediately; the lead form gates
// it behind a form. A configuration asking for both has no coherent widget
// behaviour, so it is refused here rather than resolved by a coin toss in the
// browser.
func validateToggles(branding model.BrandingConfig, details map[string]string) {
	if branding.Toggles == nil {
		return
	}
	autostart := boolOrDefault(branding.Toggles.Autostart, false)
	showLeadForm := boolOrDefault(branding.Toggles.ShowLeadForm, false)
	if autostart && showLeadForm {
		details["branding.toggles"] = "autostart and show_lead_form are mutually exclusive; enabling one must disable the other"
	}
}

// validateContrast refuses a palette a visitor could not read. The pairs are the
// four that carry words: body text over the panel background, body text over a
// message bubble, and the label printed on each of the two filled controls.
func validateContrast(colors model.ThemeColors, details map[string]string) {
	pairs := []struct {
		key        string
		foreground string
		background string
		minimum    float64
	}{
		{"branding.contrast.text_on_background", colors.Text, colors.Background, contrastMinimumBodyText},
		{"branding.contrast.text_on_surface", colors.Text, colors.Surface, contrastMinimumBodyText},
		{"branding.contrast.on_primary_over_primary", colors.OnPrimary, colors.Primary, contrastMinimumInterface},
		{"branding.contrast.on_accent_over_accent", colors.OnAccent, colors.Accent, contrastMinimumInterface},
	}
	for _, pair := range pairs {
		if !validHexColor(pair.foreground) || !validHexColor(pair.background) {
			continue
		}
		ratio := contrastRatio(pair.foreground, pair.background)
		if ratio < pair.minimum {
			details[pair.key] = fmt.Sprintf("%s on %s has a contrast ratio of %.2f:1, below the %.1f:1 minimum", pair.foreground, pair.background, ratio, pair.minimum)
		}
	}
}

// validateLeadCapture checks the customer-authored form. A form that cannot be
// submitted is worse than no form, so the rule that at least one way of reaching
// the visitor is present is enforced here rather than discovered by the visitor
// when their submission is refused.
func validateLeadCapture(capture model.LeadCaptureConfig, details map[string]string) {
	if len(capture.FormHeading) > leadFormHeadingLimit {
		details["lead_capture.form_heading"] = fmt.Sprintf("must not exceed %d characters", leadFormHeadingLimit)
	}
	if len(capture.SubmitLabel) > leadFormSubmitLabelLimit {
		details["lead_capture.submit_label"] = fmt.Sprintf("must not exceed %d characters", leadFormSubmitLabelLimit)
	}
	if len(capture.FormFields) == 0 {
		return
	}
	if len(capture.FormFields) > leadFormFieldLimit {
		details["lead_capture.form_fields"] = fmt.Sprintf("must not contain more than %d fields", leadFormFieldLimit)
		return
	}
	seen := map[string]bool{}
	reachable := false
	for index, field := range capture.FormFields {
		prefix := fmt.Sprintf("lead_capture.form_fields.%d", index)
		switch {
		case field.ID == "":
			details[prefix+".id"] = "must contain letters, digits, dashes or underscores"
		case len(field.ID) > leadFormFieldIDLimit:
			details[prefix+".id"] = fmt.Sprintf("must not exceed %d characters", leadFormFieldIDLimit)
		case seen[field.ID]:
			details[prefix+".id"] = "must be unique within the form"
		}
		seen[field.ID] = true
		if field.Label == "" || len(field.Label) > leadFormLabelLimit {
			details[prefix+".label"] = fmt.Sprintf("must contain 1 to %d characters", leadFormLabelLimit)
		}
		if len(field.Placeholder) > leadFormPlaceholderLimit {
			details[prefix+".placeholder"] = fmt.Sprintf("must not exceed %d characters", leadFormPlaceholderLimit)
		}
		if !isKnownLeadFieldType(field.Type) {
			details[prefix+".type"] = "must be one of " + strings.Join(leadFormFieldTypes, ", ")
		}
		if field.Type == leadFieldTypeSelect && len(field.Options) < 2 {
			details[prefix+".options"] = "a select field needs at least two options"
		}
		if field.Type != leadFieldTypeSelect && len(field.Options) > 0 {
			details[prefix+".options"] = "only a select field may carry options"
		}
		if field.Type == leadFieldTypeEmail || field.Type == leadFieldTypeTelephone {
			reachable = true
		}
	}
	if !reachable {
		details["lead_capture.form_fields"] = "include at least one email or telephone field, or a submitted form cannot be saved as a lead"
	}
}

// relativeLuminance is the WCAG 2.1 definition, straight from the specification:
// each channel is scaled to 0..1, linearized through the sRGB transfer curve, and
// weighted by how much the eye reads it as brightness.
func relativeLuminance(color string) float64 {
	channel := func(offset int) float64 {
		value, err := strconv.ParseUint(color[offset:offset+2], 16, 8)
		if err != nil {
			return 0
		}
		component := float64(value) / 255
		if component <= 0.03928 {
			return component / 12.92
		}
		return math.Pow((component+0.055)/1.055, 2.4)
	}
	return 0.2126*channel(1) + 0.7152*channel(3) + 0.0722*channel(5)
}

// contrastRatio is the WCAG 2.1 ratio between two colours: 1 for identical
// colours and 21 for black against white. Both arguments must already be valid
// six-digit hex.
func contrastRatio(foreground, background string) float64 {
	lighter, darker := relativeLuminance(foreground), relativeLuminance(background)
	if lighter < darker {
		lighter, darker = darker, lighter
	}
	return (lighter + 0.05) / (darker + 0.05)
}

// readableForeground picks the text colour a customer would have picked for a
// fill they gave no foreground for. Whichever of the two reads better wins, and
// the worse of the two is still above the interface floor for every possible
// fill, so a derived foreground can never be the reason a save is refused.
func readableForeground(background string) string {
	if !validHexColor(background) {
		return darkForegroundColor
	}
	if contrastRatio(lightForegroundColor, background) >= contrastRatio(darkForegroundColor, background) {
		return lightForegroundColor
	}
	return darkForegroundColor
}

func firstValidColor(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); validHexColor(trimmed) {
			return trimmed
		}
	}
	return ""
}

func boolOrDefault(value *bool, fallback bool) bool {
	if value == nil {
		return fallback
	}
	return *value
}

func normalizePosition(value string) string {
	position := strings.ToLower(strings.TrimSpace(value))
	if position == "" {
		return positionBottomRight
	}
	return position
}

// normalizeTheme reads an absent theme as "custom". An agent stored before the
// picker existed already has its colours in primary_color and accent_color,
// which is precisely what the custom theme means.
func normalizeTheme(value string) string {
	theme := strings.ToLower(strings.TrimSpace(value))
	if theme == "" {
		return themeCustom
	}
	return theme
}

func isKnownPosition(value string) bool {
	for _, position := range widgetPositions {
		if position == normalizePosition(value) {
			return true
		}
	}
	return false
}

func isKnownTheme(value string) bool {
	for _, preset := range themePresets {
		if preset.ID == strings.ToLower(strings.TrimSpace(value)) {
			return true
		}
	}
	return false
}

func isKnownLeadFieldType(value string) bool {
	for _, fieldType := range leadFormFieldTypes {
		if fieldType == value {
			return true
		}
	}
	return false
}

func themeIDs() []string {
	identifiers := make([]string, 0, len(themePresets))
	for _, preset := range themePresets {
		identifiers = append(identifiers, preset.ID)
	}
	return identifiers
}

func isAbsoluteHTTPSURL(value string) bool {
	parsed, err := url.Parse(value)
	return err == nil && parsed.Scheme == "https" && parsed.Host != ""
}

// slugifyFieldID reduces a label or an identifier to the stable key answers are
// stored under: lowercase letters, digits, dash and underscore, with every other
// run collapsed to a single underscore.
func slugifyFieldID(value string) string {
	var builder strings.Builder
	previousUnderscore := false
	for _, character := range strings.ToLower(strings.TrimSpace(value)) {
		switch {
		case character >= 'a' && character <= 'z', character >= '0' && character <= '9', character == '-':
			builder.WriteRune(character)
			previousUnderscore = false
		default:
			if !previousUnderscore && builder.Len() > 0 {
				builder.WriteRune('_')
				previousUnderscore = true
			}
		}
		if builder.Len() >= leadFormFieldIDLimit {
			break
		}
	}
	return strings.Trim(builder.String(), "_-")
}
