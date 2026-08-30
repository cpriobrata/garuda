package composio

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
)

// Delivering a captured lead into the app a customer connected.
//
// WHY THIS EXISTS ALONGSIDE WEBHOOKS. The outbound webhook already reaches every
// CRM worth naming, through Zapier, Make, n8n or a direct endpoint, and it needs
// no per-provider code. That is why it was built first and why it remains the
// answer for the long tail. But a customer who has just connected HubSpot in our
// own screen reasonably expects leads to appear in HubSpot, and telling them to
// go and build a Zap is the wrong answer to that.
//
// So this is a SHORT, NAMED list of destinations that receive leads directly.
// It is deliberately not an attempt to cover the catalogue: every destination
// here is a tool slug and a field mapping that somebody has to get right, and a
// lead silently landing in the wrong column is worse than one that arrives by
// webhook.
//
// WHAT IS NOT HERE IS AS IMPORTANT AS WHAT IS. Connecting an app that is not on
// this list stores the connection and nothing else, and the product must say so
// rather than implying that a thousand apps receive leads.

// Destination is one place a lead can be delivered directly.
type Destination struct {
	// Toolkit is the connection this needs, and Tool is what it runs.
	Toolkit string
	Tool    string

	// Label and Summary are what a customer reads when choosing.
	Label   string
	Summary string

	// SettingLabel names the one piece of configuration this destination needs,
	// and is empty when it needs none. Anything requiring more than one field is
	// better served by a webhook than by a form nobody finishes.
	SettingLabel string
	SettingHint  string

	// arguments turns a lead into the provider's own parameter names.
	arguments func(lead LeadPayload, setting string) map[string]any
}

// LeadPayload is what a delivery gets. It is deliberately a flat, explicit
// struct rather than the model type: this package must not gain an import of
// the whole data model to send somebody an email address.
type LeadPayload struct {
	Name      string
	Email     string
	Phone     string
	Company   string
	Notes     string
	Source    string
	AgentName string
	PageURL   string
	CreatedAt time.Time
}

func (l LeadPayload) displayName() string {
	if name := strings.TrimSpace(l.Name); name != "" {
		return name
	}
	if email := strings.TrimSpace(l.Email); email != "" {
		return email
	}
	return "Website visitor"
}

// summary is the human sentence used where a destination takes prose rather
// than fields. It carries no transcript: a chat history copied into a Slack
// channel is a copy of personal data outside the product.
func (l LeadPayload) summary() string {
	var builder strings.Builder
	builder.WriteString("New lead from ")
	if l.AgentName != "" {
		builder.WriteString(l.AgentName)
	} else {
		builder.WriteString("your website")
	}
	builder.WriteString("\n\nName: ")
	builder.WriteString(l.displayName())
	if l.Email != "" {
		builder.WriteString("\nEmail: " + l.Email)
	}
	if l.Phone != "" {
		builder.WriteString("\nPhone: " + l.Phone)
	}
	if l.Company != "" {
		builder.WriteString("\nCompany: " + l.Company)
	}
	if l.Notes != "" {
		builder.WriteString("\nNotes: " + l.Notes)
	}
	if l.PageURL != "" {
		builder.WriteString("\nPage: " + l.PageURL)
	}
	return builder.String()
}

// destinations is the whole list. Every tool slug and every parameter name below
// was read from the provider's own tool catalogue rather than assumed.
var destinations = map[string]Destination{
	"hubspot": {
		Toolkit: "hubspot",
		Tool:    "HUBSPOT_CREATE_CONTACT",
		Label:   "HubSpot",
		Summary: "Every captured lead becomes a HubSpot contact.",
		arguments: func(lead LeadPayload, _ string) map[string]any {
			properties := map[string]any{}
			if lead.Email != "" {
				properties["email"] = lead.Email
			}
			if lead.Phone != "" {
				properties["phone"] = lead.Phone
			}
			if lead.Company != "" {
				properties["company"] = lead.Company
			}
			// HubSpot keeps first and last separately. A single-word name is a
			// first name; anything after the first space is the surname, which is
			// wrong for some names and better than putting the lot in one field.
			if name := strings.TrimSpace(lead.Name); name != "" {
				if first, last, found := strings.Cut(name, " "); found {
					properties["firstname"] = first
					properties["lastname"] = strings.TrimSpace(last)
				} else {
					properties["firstname"] = name
				}
			}
			return map[string]any{"properties": properties}
		},
	},
	"slack": {
		Toolkit:      "slack",
		Tool:         "SLACK_CHAT_POST_MESSAGE",
		Label:        "Slack",
		Summary:      "Every captured lead is posted to a channel.",
		SettingLabel: "Channel",
		SettingHint:  "The channel to post in, for example #sales or a channel id.",
		arguments: func(lead LeadPayload, setting string) map[string]any {
			return map[string]any{"channel": setting, "text": lead.summary()}
		},
	},
	"googlesheets": {
		Toolkit:      "googlesheets",
		Tool:         "GOOGLESHEETS_SPREADSHEETS_VALUES_APPEND",
		Label:        "Google Sheets",
		Summary:      "Every captured lead is appended as a row.",
		SettingLabel: "Spreadsheet ID",
		SettingHint:  "The long id in the sheet's own URL, between /d/ and /edit.",
		arguments: func(lead LeadPayload, setting string) map[string]any {
			return map[string]any{
				"spreadsheet_id":     setting,
				"range":              "A1",
				"value_input_option": "USER_ENTERED",
				"insert_data_option": "INSERT_ROWS",
				"values": [][]any{{
					lead.CreatedAt.UTC().Format(time.RFC3339),
					lead.displayName(), lead.Email, lead.Phone, lead.Company,
					lead.Source, lead.AgentName, lead.PageURL, lead.Notes,
				}},
			}
		},
	},
}

// Destinations lists what can receive a lead directly, in a stable order so a
// settings screen does not reshuffle itself between loads.
func Destinations() []Destination {
	list := make([]Destination, 0, len(destinations))
	for _, destination := range destinations {
		list = append(list, destination)
	}
	sort.Slice(list, func(i, j int) bool { return list[i].Label < list[j].Label })
	return list
}

// DestinationFor returns the destination for a toolkit, and whether one exists.
func DestinationFor(toolkit string) (Destination, bool) {
	destination, found := destinations[strings.ToLower(strings.TrimSpace(toolkit))]
	return destination, found
}

// ErrNoDestination means this toolkit can be connected but does not receive
// leads directly. It is a distinct error so the caller can say that plainly
// instead of reporting a failure.
var ErrNoDestination = errors.New("this app does not receive leads directly")

// DeliverLead sends one lead to one connected app, as the given account.
//
// It runs off the request path. A customer's CRM being slow must never be a slow
// chat widget for a visitor on their website, which is the same reason the
// outbound webhook is polled rather than called inline.
func (c *Client) DeliverLead(ctx context.Context, userID, toolkit, setting string, lead LeadPayload) error {
	destination, found := DestinationFor(toolkit)
	if !found {
		return ErrNoDestination
	}
	if destination.SettingLabel != "" && strings.TrimSpace(setting) == "" {
		return fmt.Errorf("%s needs its %s before leads can be sent", destination.Label, strings.ToLower(destination.SettingLabel))
	}
	_, err := c.execute(ctx, userID, destination.Tool, destination.arguments(lead, strings.TrimSpace(setting)))
	return err
}
