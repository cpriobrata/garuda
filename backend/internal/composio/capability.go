package composio

import (
	"sort"
	"strings"
)

// What a connected app is FOR.
//
// The catalogue has over fourteen hundred products in it, and connecting one
// used to do nothing at all. That is the wrong shape for a product: a customer
// who connects Slack expects something to happen in Slack, and an app with no
// job attached is a button that lies.
//
// So every connectable app is placed against a small, fixed set of JOBS. There
// are only three, because there are only three things this product does that
// need somewhere else to send them:
//
//	calendar  read free time and write an appointment
//	leads     receive a captured lead
//	notify    tell a person something happened
//
// An app not listed here can still be connected -- the connection is real and
// keeps working for later -- but the screen has to say plainly that nothing is
// wired to it yet, and point at the outbound webhook, which reaches everything
// through Zapier, Make or n8n and needs no per-provider code at all.
//
// This file is the single place that answers "what will connecting this do".
// The UI reads it, so a customer is never shown a promise the code cannot keep.

type Capability string

const (
	CapabilityCalendar Capability = "calendar"
	CapabilityLeads    Capability = "leads"
	CapabilityNotify   Capability = "notify"
)

// AppRole is one job one app can do.
type AppRole struct {
	Toolkit    string     `json:"toolkit"`
	Capability Capability `json:"capability"`
	Label      string     `json:"label"`

	// UseCase is the sentence a customer reads before connecting. It says what
	// will happen, in their words, and it is the reason this table exists.
	UseCase string `json:"use_case"`

	// SettingLabel names the one thing this role needs configuring, and is
	// empty when it needs none. Anything wanting more than one field belongs
	// behind a webhook rather than behind a form nobody finishes.
	SettingLabel string `json:"setting_label,omitempty"`
	SettingHint  string `json:"setting_hint,omitempty"`

	// Partial marks a role the provider only half supports, so the UI can say
	// so rather than discovering it in front of a visitor.
	Partial     bool   `json:"partial,omitempty"`
	PartialNote string `json:"partial_note,omitempty"`
}

// appRoles is the whole map of app to job. Every entry was checked against the
// provider's own tool catalogue; nothing here is aspirational.
var appRoles = []AppRole{
	// ---- calendars: read free time, write an appointment ----
	{
		Toolkit: "googlecalendar", Capability: CapabilityCalendar, Label: "Google Calendar",
		UseCase: "Visitors see your real free times and book straight into this calendar.",
	},
	{
		Toolkit: "outlook", Capability: CapabilityCalendar, Label: "Outlook Calendar",
		UseCase: "Visitors see your real free times and book straight into your Outlook calendar.",
	},
	{
		Toolkit: "cal", Capability: CapabilityCalendar, Label: "Cal.com",
		UseCase:      "Visitors see the availability from your Cal.com event type and book it in the chat.",
		SettingLabel: "Event type ID", SettingHint: "The numeric id of the Cal.com event type visitors should book.",
	},
	{
		Toolkit: "calendly", Capability: CapabilityCalendar, Label: "Calendly",
		UseCase:      "Visitors see your Calendly availability and are handed the booking link for the time they pick.",
		SettingLabel: "Event type URL", SettingHint: "The full Calendly link visitors should open, starting https:// — for example https://calendly.com/you/30min. Not the API address from Calendly's developer settings.",
		Partial: true,
		// Calendly deliberately has no third-party create-booking API: booking
		// happens on their own page. Saying so is better than a Book button that
		// cannot finish.
		PartialNote: "Calendly completes the booking on its own page, so the visitor finishes there rather than in the chat.",
	},

	// ---- lead destinations ----
	{
		Toolkit: "hubspot", Capability: CapabilityLeads, Label: "HubSpot",
		UseCase: "Every captured lead becomes a HubSpot contact, with no setup.",
	},
	{
		Toolkit: "googlesheets", Capability: CapabilityLeads, Label: "Google Sheets",
		UseCase:      "Every captured lead is appended as a row, so you can sort and filter them yourself.",
		SettingLabel: "Spreadsheet ID", SettingHint: "The long id in the sheet's own URL, between /d/ and /edit.",
	},

	// ---- notifications ----
	{
		Toolkit: "slack", Capability: CapabilityNotify, Label: "Slack",
		UseCase:      "Your team gets a message the moment a lead is captured or a visitor asks for a person.",
		SettingLabel: "Channel", SettingHint: "Where to post, for example #sales or a channel id.",
	},
	{
		Toolkit: "gmail", Capability: CapabilityNotify, Label: "Gmail",
		UseCase:      "New leads are emailed to you from your own Gmail account.",
		SettingLabel: "Send to", SettingHint: "The address that should receive the notification.",
	},
}

// RolesFor returns every job a given app can do. An app with none can still be
// connected; the caller is responsible for saying that nothing is wired to it.
func RolesFor(toolkit string) []AppRole {
	slug := strings.ToLower(strings.TrimSpace(toolkit))
	var found []AppRole
	for _, role := range appRoles {
		if role.Toolkit == slug {
			found = append(found, role)
		}
	}
	return found
}

// RolesWith returns every app that can do a given job, alphabetically, so a
// settings screen does not reshuffle itself between loads.
func RolesWith(capability Capability) []AppRole {
	var found []AppRole
	for _, role := range appRoles {
		if role.Capability == capability {
			found = append(found, role)
		}
	}
	sort.Slice(found, func(i, j int) bool { return found[i].Label < found[j].Label })
	return found
}

// AllRoles is the full table, for the screen that explains what connecting
// anything will do.
func AllRoles() []AppRole {
	list := append([]AppRole(nil), appRoles...)
	sort.Slice(list, func(i, j int) bool {
		if list[i].Capability != list[j].Capability {
			return list[i].Capability < list[j].Capability
		}
		return list[i].Label < list[j].Label
	})
	return list
}

// HasCapability reports whether an app does a given job.
func HasCapability(toolkit string, capability Capability) bool {
	for _, role := range RolesFor(toolkit) {
		if role.Capability == capability {
			return true
		}
	}
	return false
}
