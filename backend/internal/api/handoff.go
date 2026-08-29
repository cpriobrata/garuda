package api

import (
	"context"
	"net/http"
	"net/mail"
	"net/url"
	"strings"
	"time"

	"garuda/backend/internal/mailer"
	"garuda/backend/internal/model"
)

// Human handoff over WhatsApp.
//
// The shape of this feature is set by one constraint: the site owner's phone
// number is personal data that must not be published. The widget bootstrap is a
// public document -- any origin the customer allowed can fetch it, and so can
// anything that scrapes their page -- so the number never appears there. The
// bootstrap says only that a handoff is available and what to call the button.
// The number becomes a wa.me link inside startWidgetHandoff, which first proves
// the caller holds a live session token for a real conversation.
//
// That is also why there is no "handoff" field on the agent's public payload
// beyond the resolved struct below: adding the number to publicAgent later, for
// convenience, would undo the whole design.

const (
	// wa.me accepts E.164 digits with no plus and no separators. Fifteen is the
	// E.164 maximum; eight rejects the obvious typos without excluding the short
	// national formats some countries still use.
	minWhatsAppDigits = 8
	maxWhatsAppDigits = 15

	maxHandoffLabelLength        = 60
	maxHandoffMessageLength      = 400
	maxHandoffAvailabilityLength = 120
	maxHandoffTriggerPhrases     = 12
	maxHandoffTriggerLength      = 60
	maxHandoffAutoOfferTurns     = 50

	defaultHandoffLabel   = "Talk to a person on WhatsApp"
	defaultHandoffMessage = "Hi, I was chatting on your website and would like to speak with someone."
)

// resolvedHandoff is what the widget is allowed to know. Note what is absent.
type resolvedHandoff struct {
	Enabled        bool     `json:"enabled"`
	Channel        string   `json:"channel,omitempty"`
	Label          string   `json:"label,omitempty"`
	Availability   string   `json:"availability,omitempty"`
	TriggerPhrases []string `json:"trigger_phrases,omitempty"`
	AutoOfferAfter int      `json:"auto_offer_after,omitempty"`
}

// handoffAvailable is the single definition of "this agent can hand off". A
// configuration switched on but missing a number is not available: offering a
// visitor a button that leads nowhere is worse than not offering it.
func handoffAvailable(handoff model.HandoffConfig) bool {
	return handoff.Enabled && handoff.WhatsAppNumber != ""
}

func resolveHandoff(agent model.Agent) resolvedHandoff {
	handoff := agent.Handoff
	if !handoffAvailable(handoff) {
		return resolvedHandoff{Enabled: false}
	}
	label := handoff.ButtonLabel
	if label == "" {
		label = defaultHandoffLabel
	}
	return resolvedHandoff{
		Enabled:        true,
		Channel:        "whatsapp",
		Label:          label,
		Availability:   handoff.Availability,
		TriggerPhrases: append([]string(nil), handoff.TriggerPhrases...),
		AutoOfferAfter: handoff.AutoOfferAfter,
	}
}

// normalizeHandoff trims what the owner typed and reduces the number to the one
// spelling wa.me understands, so a customer can paste "+91 98765 43210" from
// their own phone and have it work.
func normalizeHandoff(handoff *model.HandoffConfig) {
	handoff.WhatsAppNumber = normalizeWhatsAppNumber(handoff.WhatsAppNumber)
	handoff.ButtonLabel = strings.TrimSpace(handoff.ButtonLabel)
	handoff.Message = strings.TrimSpace(handoff.Message)
	handoff.Availability = strings.TrimSpace(handoff.Availability)
	handoff.NotifyEmail = strings.ToLower(strings.TrimSpace(handoff.NotifyEmail))
	handoff.TriggerPhrases = cleanStrings(handoff.TriggerPhrases, maxHandoffTriggerPhrases, maxHandoffTriggerLength)
	for index := range handoff.TriggerPhrases {
		handoff.TriggerPhrases[index] = strings.ToLower(handoff.TriggerPhrases[index])
	}
	if handoff.AutoOfferAfter < 0 {
		handoff.AutoOfferAfter = 0
	}
}

// normalizeWhatsAppNumber keeps digits and drops everything else, including the
// leading plus, spaces, dashes and the parentheses people paste from a contact
// card. A value with no digits at all normalizes to empty, which is what makes
// "switched on but unusable" impossible to store.
func normalizeWhatsAppNumber(value string) string {
	var digits strings.Builder
	for _, character := range value {
		if character >= '0' && character <= '9' {
			digits.WriteRune(character)
		}
	}
	return digits.String()
}

func validateHandoff(handoff model.HandoffConfig, details map[string]string) {
	// An owner who has not switched handoff on may leave every field blank; the
	// fields are still validated so a saved-then-disabled configuration cannot
	// carry rubbish that becomes live the moment the switch is flipped.
	if handoff.WhatsAppNumber != "" {
		if len(handoff.WhatsAppNumber) < minWhatsAppDigits || len(handoff.WhatsAppNumber) > maxWhatsAppDigits {
			details["handoff.whatsapp_number"] = "Enter the full WhatsApp number including the country code"
		} else if handoff.WhatsAppNumber[0] == '0' {
			// A leading zero is a national trunk prefix, never part of E.164, and
			// wa.me silently fails on it rather than reporting an error.
			details["handoff.whatsapp_number"] = "Drop the leading zero and start with the country code"
		}
	}
	if handoff.Enabled && handoff.WhatsAppNumber == "" {
		details["handoff.whatsapp_number"] = "Add the WhatsApp number visitors should reach"
	}
	if len(handoff.ButtonLabel) > maxHandoffLabelLength {
		details["handoff.button_label"] = "Keep the button label short"
	}
	if len(handoff.Message) > maxHandoffMessageLength {
		details["handoff.message"] = "The pre-filled message is too long"
	}
	if len(handoff.Availability) > maxHandoffAvailabilityLength {
		details["handoff.availability"] = "Keep the availability note short"
	}
	if handoff.AutoOfferAfter > maxHandoffAutoOfferTurns {
		details["handoff.auto_offer_after"] = "Offer the handoff within the first 50 replies"
	}
	if handoff.NotifyEmail != "" && !validEmail(handoff.NotifyEmail) {
		details["handoff.notify_email"] = "Enter a valid email address"
	}
}

// whatsAppLink builds the deep link the visitor is sent to. The message is
// pre-typed for them but never sent on their behalf: wa.me opens the chat with
// the text in the compose box, and the visitor still presses send. That is the
// difference between a helpful shortcut and messaging a stranger's phone
// without their consent.
func whatsAppLink(handoff model.HandoffConfig, pageURL string) string {
	body := handoff.Message
	if body == "" {
		body = defaultHandoffMessage
	}
	// The page the visitor was on is the single most useful thing the owner can
	// be told, and the visitor can see and edit it before sending.
	if pageURL != "" && len(body)+len(pageURL) < maxHandoffMessageLength*2 {
		body += "\n\n" + pageURL
	}
	link := url.URL{Scheme: "https", Host: "wa.me", Path: "/" + handoff.WhatsAppNumber}
	query := url.Values{}
	query.Set("text", body)
	link.RawQuery = query.Encode()
	return link.String()
}

// startWidgetHandoff hands the visitor the WhatsApp link and records that the
// conversation left the agent.
//
// The record matters as much as the link. Without it the owner's inbox shows a
// conversation that simply stops, with no way to tell a bored visitor from one
// who asked for a human and is now waiting on WhatsApp.
func (s *Server) startWidgetHandoff(w http.ResponseWriter, r *http.Request) {
	session, authorized := s.authorizeWidgetSession(r)
	if !authorized {
		s.writeError(w, r, http.StatusUnauthorized, "invalid_session", "The widget session is invalid or expired", nil)
		return
	}
	agent, found := s.findPublishedAgentByID(session.AccountID, session.AgentID)
	if !found {
		s.writeError(w, r, http.StatusNotFound, "agent_not_found", "Published agent not found", nil)
		return
	}
	if !handoffAvailable(agent.Handoff) {
		// 404 rather than 403: a visitor probing for which agents have a human
		// behind them learns nothing from a route that is simply not there.
		s.writeError(w, r, http.StatusNotFound, "handoff_unavailable", "This assistant does not offer a human handoff", nil)
		return
	}

	handoff := agent.Handoff.Clone()
	now := time.Now().UTC()

	// alreadyHandedOff keeps the notification to once per conversation. A visitor
	// who taps the button twice must still get their link -- that is why the link
	// is built regardless -- but the owner should not get a second email.
	alreadyHandedOff := false
	err := s.store.Update(func(state *model.State) error {
		for _, message := range state.Messages {
			if message.SessionID == session.ID && message.Role == "system" && message.Metadata != nil && message.Metadata["event"] == handoffEventName {
				alreadyHandedOff = true
				break
			}
		}
		if !alreadyHandedOff {
			state.Messages = append(state.Messages, model.Message{
				ID: newID("msg_"), AccountID: session.AccountID, AgentID: session.AgentID, SessionID: session.ID,
				VisitorID: session.VisitorID, Role: "system",
				Content:   "The visitor asked to continue with a person on WhatsApp.",
				Metadata:  map[string]any{"event": handoffEventName, "channel": "whatsapp"},
				CreatedAt: now,
			})
		}
		for index := range state.Sessions {
			if state.Sessions[index].ID == session.ID {
				state.Sessions[index].LastSeenAt = now
				state.Sessions[index].UpdatedAt = now
				break
			}
		}
		return nil
	})
	if err != nil {
		s.storageFailure(w, r, err)
		return
	}

	if !alreadyHandedOff {
		s.notifyHandoff(agent, session, handoff)
	}

	label := handoff.ButtonLabel
	if label == "" {
		label = defaultHandoffLabel
	}
	s.writeData(w, http.StatusOK, map[string]any{
		"channel":      "whatsapp",
		"url":          whatsAppLink(handoff, session.PageURL),
		"label":        label,
		"availability": handoff.Availability,
	})
}

const handoffEventName = "handoff"

// notifyHandoff tells the owner a visitor is on their way to WhatsApp, so a
// missed message is a choice rather than an accident. Delivery is best-effort
// and off the request path: the visitor's link must not wait on SendGrid, and a
// mail failure must not turn a working handoff into an error.
func (s *Server) notifyHandoff(agent model.Agent, session model.Session, handoff model.HandoffConfig) {
	if handoff.NotifyEmail == "" || !s.mailer.Enabled() {
		return
	}
	// The page URL is the visitor's own browsing context and belongs in the
	// owner's notification. Nothing the visitor typed is included: a chat
	// transcript in an email is a copy of personal data outside the product.
	body := "A visitor asked to speak with a person.\n\n" +
		"Assistant: " + agent.Name + "\n"
	if session.PageURL != "" {
		body += "Page: " + session.PageURL + "\n"
	}
	body += "\nThey were shown your WhatsApp number and may message you shortly.\n" +
		"The conversation is in your Garuda inbox."

	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		_ = s.mailer.Send(ctx, mailer.Message{
			ToEmail: handoff.NotifyEmail,
			Subject: "A website visitor asked for a person",
			Text:    body,
		})
	}()
}

// validEmail mirrors the rule the signup path already applies: the address must
// parse and round-trip to exactly what was typed, so a display name or a stray
// bracket is rejected rather than quietly stored.
func validEmail(address string) bool {
	if len(address) > 254 {
		return false
	}
	parsed, err := mail.ParseAddress(address)
	return err == nil && strings.EqualFold(parsed.Address, address)
}
