package model

// BookingConfig lets a visitor take a real slot in the owner's own calendar,
// from inside the chat, without anybody sending an email about it.
//
// This is one of the two things integrations exist for in this product; the
// other is lead data leaving by webhook. It reads free time from the customer's
// connected Google Calendar and writes an event there, so it is switched off by
// default and stays off until the owner both connects a calendar and turns it
// on. An appointment created by mistake in a real person's calendar has no undo.
//
// Every field is additive. An agent stored before this existed decodes with
// Enabled false, which is exactly how it behaved yesterday.
type BookingConfig struct {
	Enabled bool `json:"enabled"`

	// Calendar is the connected app appointments are written to -- the toolkit
	// slug, such as googlecalendar, outlook, cal or calendly. Empty means the
	// account's Google Calendar, which is what every agent configured before
	// other providers existed was using.
	//
	// ONE calendar per agent, deliberately. An agent stands for one job -- the
	// sales agent, the clinic front desk -- and "when are you free" has to have
	// a single answer. Two calendars would mean choosing one at booking time
	// with no basis for the choice, or offering times somebody else owns.
	Calendar string `json:"calendar,omitempty"`

	// CalendarSetting is the one value a provider needs beyond the connection:
	// a Cal.com event type id, a Calendly event URL. Empty for the calendars
	// that need nothing.
	CalendarSetting string `json:"calendar_setting,omitempty"`

	// ButtonLabel is what the visitor clicks. Title is what the owner will see
	// in their own calendar, where "Appointment" from a stranger is less useful
	// than the business's own wording.
	ButtonLabel string `json:"button_label,omitempty"`
	Title       string `json:"title,omitempty"`

	// DurationMinutes is how long one appointment is. Zero resolves to thirty.
	DurationMinutes int `json:"duration_minutes,omitempty"`

	// Timezone is the owner's, as an IANA name. Without it "9am" is ambiguous
	// between the owner's morning and the visitor's.
	Timezone string `json:"timezone,omitempty"`

	// StartHour and EndHour bound the working day in that time zone. Without
	// them, "free" means 3am as readily as 3pm and a visitor would book it.
	StartHour int `json:"start_hour,omitempty"`
	EndHour   int `json:"end_hour,omitempty"`

	// Weekdays are the days that can be booked, as 0 for Sunday through 6 for
	// Saturday. Empty means Monday to Friday.
	Weekdays []int `json:"weekdays,omitempty"`

	// LeadDaysAhead is how far into the future slots are offered, and
	// NoticeHours is how little warning the owner will accept. Somebody booking
	// a slot eight minutes from now is a meeting nobody attends.
	LeadDaysAhead int `json:"lead_days_ahead,omitempty"`
	// NoticeHours carries NO omitempty, deliberately. Zero here is a real answer
	// -- "no minimum, book me in ten minutes" -- and normalizeBooking never
	// replaces it with a default, so omitting it from the payload made that
	// answer indistinguishable from an old agent that had never been asked. The
	// builder read the absence as "unset" and showed 4 hours, so an owner who
	// chose no minimum found it silently back to four on the next load.
	NoticeHours int `json:"notice_hours"`
}

// Clone returns a copy that shares no mutable state with the store. Weekdays is
// the only reference type, and handing out the live slice is how a concurrent
// write becomes a data race in the caller.
func (b BookingConfig) Clone() BookingConfig {
	cloned := b
	if b.Weekdays != nil {
		cloned.Weekdays = append([]int(nil), b.Weekdays...)
	}
	return cloned
}
