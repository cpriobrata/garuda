package composio

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
)

// Appointment booking through the customer's own connected Google Calendar.
//
// This is one of the two things integrations exist for in this product -- the
// other being lead data leaving by webhook -- so it is a purpose-built pair of
// calls rather than a general tool-calling loop.
//
// WHY NOT LET THE MODEL CALL TOOLS FREELY. A model deciding on its own to create
// events in a real person's calendar is a class of mistake with no undo, made on
// somebody else's business, in front of their customer. Free slots are read and
// an event is written only from an explicit visitor choice: they see the times
// and they pick one. The model's job is to have the conversation, not to hold
// the pen.
//
// The two tool slugs and their parameter names below were read from Composio's
// own tool catalogue, not assumed.

const (
	toolFindFreeSlots = "GOOGLECALENDAR_FIND_FREE_SLOTS"
	toolCreateEvent   = "GOOGLECALENDAR_CREATE_EVENT"

	// maxSlotsReturned bounds what a visitor is offered. A wall of times is not
	// a choice, it is a form; and the response travels to a widget on somebody
	// else's page.
	maxSlotsReturned = 12
)

// ErrNotConnected means this account has no usable Google Calendar connection.
// It is distinguished so the caller can say "connect your calendar" rather than
// reporting a failure the customer cannot act on.
var ErrNotConnected = errors.New("no active calendar connection for this account")

// Slot is one bookable window.
type Slot struct {
	Start time.Time `json:"start"`
	End   time.Time `json:"end"`
}

// BookingRequest is one appointment, already agreed with the visitor.
type BookingRequest struct {
	Start           time.Time
	DurationMinutes int
	Timezone        string
	Summary         string
	Description     string

	// AttendeeName is needed by the scheduling products, which book on behalf
	// of a named person rather than simply writing an event into a diary.
	AttendeeName string
	// AttendeeEmail is the visitor's, and it is the only piece of their data
	// that reaches the calendar provider. It is optional: a visitor who did not
	// give an email still gets the appointment, the owner simply has no invite
	// to send.
	AttendeeEmail string
}

// executeResult is Composio's envelope. Both the successful and failed shapes
// come back with HTTP 200, so `successful` is the field that decides.
type executeResult struct {
	Data       map[string]any `json:"data"`
	Successful bool           `json:"successful"`
	Error      string         `json:"error"`
}

// execute runs one tool as the given Garuda account. user_id is the tenant
// boundary: Composio resolves it to that account's own connection, so one
// customer can never reach another's calendar even by guessing an id.
func (c *Client) execute(ctx context.Context, userID, slug string, arguments map[string]any) (map[string]any, error) {
	if !c.Enabled() {
		return nil, errors.New("integrations are not configured")
	}
	if strings.TrimSpace(userID) == "" {
		return nil, errors.New("an account is required to run an integration")
	}
	body := map[string]any{"user_id": userID, "arguments": arguments}
	var result executeResult
	if err := c.request(ctx, "POST", "/tools/execute/"+slug, body, &result); err != nil {
		return nil, err
	}
	if !result.Successful {
		message := strings.TrimSpace(result.Error)
		// Composio reports a missing connection as an ordinary tool failure, so
		// the distinction has to be recovered from the message. Getting it wrong
		// only costs a less helpful error, never a wrong action.
		lowered := strings.ToLower(message)
		if strings.Contains(lowered, "no connected account") || strings.Contains(lowered, "not connected") || strings.Contains(lowered, "connection not found") {
			return nil, ErrNotConnected
		}
		if message == "" {
			message = "the calendar did not accept that request"
		}
		return nil, fmt.Errorf("calendar: %s", message)
	}
	return result.Data, nil
}

// FreeSlots asks the customer's calendar what is free in a window and turns the
// answer into bookable slots.
//
// Composio's FIND_FREE_SLOTS returns BUSY periods, which is the opposite of what
// a visitor needs to see, so the inversion happens here: busy periods are
// subtracted from the working day and what remains is divided into appointments.
// Doing it on the server rather than in the widget means the rule can be
// corrected without shipping a new widget to every customer website.
func (c *Client) FreeSlots(ctx context.Context, userID string, from, to time.Time, duration time.Duration, timezone string, day WorkingDay) ([]Slot, error) {
	if duration <= 0 {
		duration = 30 * time.Minute
	}
	arguments := map[string]any{
		"time_min": from.UTC().Format(time.RFC3339),
		"time_max": to.UTC().Format(time.RFC3339),
		"items":    []map[string]any{{"id": "primary"}},
	}
	if strings.TrimSpace(timezone) != "" {
		arguments["timezone"] = timezone
	}
	data, err := c.execute(ctx, userID, toolFindFreeSlots, arguments)
	if err != nil {
		return nil, err
	}
	return slotsFromBusy(data, from, to, duration, day), nil
}

// WorkingDay is when the owner is willing to be booked, in the calendar's own
// time zone. Without it, "free" means 3am as readily as 3pm.
type WorkingDay struct {
	StartHour int
	EndHour   int
	// Weekdays is the set of time.Weekday values that are bookable. Empty means
	// Monday to Friday, which is the answer for almost every business this
	// product serves and is a better default than "every day".
	Weekdays map[time.Weekday]bool
}

func (d WorkingDay) bookable(moment time.Time) bool {
	if len(d.Weekdays) > 0 && !d.Weekdays[moment.Weekday()] {
		return false
	}
	if len(d.Weekdays) == 0 && (moment.Weekday() == time.Saturday || moment.Weekday() == time.Sunday) {
		return false
	}
	hour := moment.Hour()
	return hour >= d.StartHour && hour < d.EndHour
}

// slotsFromBusy is the whole inversion, separated from the network so it can be
// tested exhaustively without a calendar.
func slotsFromBusy(data map[string]any, from, to time.Time, duration time.Duration, day WorkingDay) []Slot {
	return slotsFromBusyPeriods(busyPeriods(data), from, to, duration, day)
}

// slotsFromBusyPeriods is the inversion itself, taking periods rather than a
// provider payload so every free/busy calendar shares one implementation of the
// arithmetic that decides whether somebody gets double-booked.
func slotsFromBusyPeriods(busy []Slot, from, to time.Time, duration time.Duration, day WorkingDay) []Slot {
	sort.Slice(busy, func(i, j int) bool { return busy[i].Start.Before(busy[j].Start) })

	// A last-resort guard only. normalizeBooking resolves the working day at save
	// time, so a stored configuration reaching here with no window means it was
	// built by a caller that skipped normalization -- a test, or a future path.
	// Offering nothing would look like a fully booked calendar, which is a worse
	// lie than a sensible default.
	if day.EndHour <= day.StartHour {
		day.StartHour, day.EndHour = 9, 18
	}

	var slots []Slot
	// Walk the window in whole appointment lengths. Starting on the duration
	// boundary is what makes the offered times look like appointments (9:00,
	// 9:30) rather than whatever moment the previous meeting happened to end.
	for start := from.Truncate(duration); start.Before(to); start = start.Add(duration) {
		if start.Before(from) {
			continue
		}
		end := start.Add(duration)
		if end.After(to) {
			break
		}
		local := start.In(from.Location())
		if !day.bookable(local) || !day.bookable(local.Add(duration-time.Minute)) {
			continue
		}
		if overlapsAny(start, end, busy) {
			continue
		}
		slots = append(slots, Slot{Start: start, End: end})
		if len(slots) >= maxSlotsReturned {
			break
		}
	}
	return slots
}

func overlapsAny(start, end time.Time, busy []Slot) bool {
	for _, period := range busy {
		// Touching at an edge is not an overlap: a meeting that ends at 10:00
		// leaves 10:00 free.
		if start.Before(period.End) && end.After(period.Start) {
			return true
		}
	}
	return false
}

// busyPeriods digs the busy list out of the provider's response. The shape is
// read defensively rather than modelled, because a provider changing a nesting
// level should cost an empty result and a visible "no times available", not a
// panic on somebody else's website.
func busyPeriods(data map[string]any) []Slot {
	calendars, ok := data["calendars"].(map[string]any)
	if !ok {
		// Some responses nest the whole payload one level deeper.
		if inner, nested := data["data"].(map[string]any); nested {
			calendars, ok = inner["calendars"].(map[string]any)
		}
		if !ok {
			return nil
		}
	}
	var periods []Slot
	for _, entry := range calendars {
		calendar, isMap := entry.(map[string]any)
		if !isMap {
			continue
		}
		list, isList := calendar["busy"].([]any)
		if !isList {
			continue
		}
		for _, item := range list {
			period, isMap := item.(map[string]any)
			if !isMap {
				continue
			}
			start, startOK := parseMoment(period["start"])
			end, endOK := parseMoment(period["end"])
			if startOK && endOK && end.After(start) {
				periods = append(periods, Slot{Start: start, End: end})
			}
		}
	}
	return periods
}

func parseMoment(value any) (time.Time, bool) {
	text, ok := value.(string)
	if !ok {
		return time.Time{}, false
	}
	moment, err := time.Parse(time.RFC3339, text)
	if err != nil {
		return time.Time{}, false
	}
	return moment.UTC(), true
}

// Book creates the appointment. It is only ever called from an explicit visitor
// choice of a slot this service offered, never from a model's decision.
func (c *Client) Book(ctx context.Context, userID string, request BookingRequest) (string, error) {
	if request.Start.IsZero() {
		return "", errors.New("an appointment needs a start time")
	}
	duration := request.DurationMinutes
	if duration <= 0 {
		duration = 30
	}
	summary := strings.TrimSpace(request.Summary)
	if summary == "" {
		summary = "Appointment"
	}
	arguments := map[string]any{
		// The provider's own parameter names, read from its tool schema.
		"start_datetime":         request.Start.Format(time.RFC3339),
		"event_duration_minutes": duration,
		"summary":                summary,
		"calendar_id":            "primary",
	}
	if timezone := strings.TrimSpace(request.Timezone); timezone != "" {
		arguments["timezone"] = timezone
	}
	if description := strings.TrimSpace(request.Description); description != "" {
		arguments["description"] = description
	}
	if email := strings.TrimSpace(request.AttendeeEmail); email != "" {
		arguments["attendees"] = []string{email}
		// Without this the visitor gets no invitation, which is the whole point
		// of having asked for their address.
		arguments["send_updates"] = "all"
	}
	data, err := c.execute(ctx, userID, toolCreateEvent, arguments)
	if err != nil {
		return "", err
	}
	return eventIdentifier(data), nil
}

// eventIdentifier finds the created event's id wherever the provider put it. An
// empty result is not an error: the appointment exists, and the id is only used
// for the owner's own reference.
func eventIdentifier(data map[string]any) string {
	for _, key := range []string{"id", "event_id", "htmlLink"} {
		if value, ok := data[key].(string); ok && value != "" {
			return value
		}
	}
	if inner, ok := data["response_data"].(map[string]any); ok {
		return eventIdentifier(inner)
	}
	if inner, ok := data["data"].(map[string]any); ok {
		return eventIdentifier(inner)
	}
	return ""
}
