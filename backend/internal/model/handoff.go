package model

// HandoffConfig is the escape hatch: the point where a visitor stops talking to
// the model and starts talking to a person. WhatsApp is the channel because the
// site owner already carries it, so a handoff needs no inbox to be watched and
// no new app installed on either side.
//
// The number is stored here and NEVER travels in the widget bootstrap. That
// bootstrap is a public document served to every origin the customer allowed,
// so a personal phone number in it would be published to every crawler that
// loads the page. The widget learns only that a handoff is available; the number
// becomes a wa.me link inside the handoff endpoint, which requires a live
// visitor session.
//
// Every field is additive. An agent stored before this existed decodes with
// Enabled false, which is exactly how it behaved yesterday.
type HandoffConfig struct {
	Enabled bool `json:"enabled"`

	// WhatsAppNumber is stored as E.164 digits with no leading plus and no
	// separators, because that is the only form wa.me accepts.
	WhatsAppNumber string `json:"whatsapp_number,omitempty"`

	// ButtonLabel is what the visitor clicks. Message is pre-typed into WhatsApp
	// for them; an empty Message still opens the chat.
	ButtonLabel string `json:"button_label,omitempty"`
	Message     string `json:"message,omitempty"`

	// Availability is free text the owner writes, shown to the visitor before
	// they commit, so nobody messages into a void at 3am and reads the silence
	// as being ignored.
	Availability string `json:"availability,omitempty"`

	// TriggerPhrases are what a visitor types when the model is not enough.
	// Matching one offers the handoff on the spot.
	TriggerPhrases []string `json:"trigger_phrases,omitempty"`

	// AutoOfferAfter offers the handoff unprompted once the visitor has taken
	// this many turns. Zero means never offer unprompted; the button stays
	// reachable either way.
	AutoOfferAfter int `json:"auto_offer_after,omitempty"`

	// NotifyEmail is told about every handoff, so the owner has a record even
	// when the visitor never sends the WhatsApp message they were handed.
	NotifyEmail string `json:"notify_email,omitempty"`
}

// Clone returns a copy that shares no mutable state with the store. Only
// TriggerPhrases is a reference type, and handing out the live slice is how a
// concurrent write becomes a data race in the caller.
func (h HandoffConfig) Clone() HandoffConfig {
	cloned := h
	cloned.TriggerPhrases = cloneStrings(h.TriggerPhrases)
	return cloned
}
