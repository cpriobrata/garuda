package composio

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
)

// Booking against whichever calendar the customer actually uses.
//
// This started as Google Calendar with its two tool names written into the
// booking code, which meant a customer on Outlook or Cal.com had a Book button
// that could never work. The provider abstraction below is what makes the
// calendar a customer's choice rather than ours.
//
// THE TWO SHAPES OF CALENDAR, and the difference matters more than it looks:
//
//	FREE/BUSY calendars -- Google, Outlook -- answer "when are you busy" and let
//	  anything write an event. We invert the busy periods into offerable slots
//	  ourselves, against the working day the owner configured, and we create the
//	  event. The owner's working hours are OUR rule.
//
//	SCHEDULING calendars -- Cal.com, Calendly -- already own the concept of an
//	  event type with its own availability rules, buffers and limits. Asking them
//	  for free/busy and re-deriving slots would fight rules the customer has
//	  already set. So we ask THEM for bookable slots and take the answer.
//
// Calendly is a third case again: it publishes availability but deliberately has
// no third-party create-booking API, because booking happens on their page. It
// is supported as read-plus-hand-off, and the product says so rather than
// showing a Book button that cannot finish.

// CalendarKind decides how a provider is driven.
type CalendarKind string

const (
	// KindFreeBusy: we ask what is busy and decide the slots ourselves.
	KindFreeBusy CalendarKind = "free_busy"
	// KindScheduling: the provider decides the slots and we take them.
	KindScheduling CalendarKind = "scheduling"
)

// CalendarProvider is everything needed to offer and take an appointment on one
// calendar product.
type CalendarProvider struct {
	Toolkit string
	Label   string
	Kind    CalendarKind

	// SettingLabel is the one thing this provider needs from the customer, and
	// is empty for the ones that need nothing.
	SettingLabel string

	// BookInProduct is false when the provider finishes the booking on its own
	// page. The visitor is handed a link instead, and the UI must say so.
	BookInProduct bool

	slotsTool  string
	createTool string

	// slotsArguments builds the availability request.
	slotsArguments func(request slotRequest) map[string]any
	// readSlots turns the provider's answer into offerable times. A free/busy
	// provider returns busy periods here and the caller inverts them; a
	// scheduling provider returns the bookable slots directly.
	readSlots func(data map[string]any, request slotRequest) ([]Slot, bool)
	// createArguments builds the event, and is nil where the provider cannot be
	// booked through an API.
	createArguments func(request BookingRequest, setting string) map[string]any
}

type slotRequest struct {
	From     time.Time
	To       time.Time
	Duration time.Duration
	Timezone string
	Setting  string
}

var calendarProviders = map[string]CalendarProvider{
	"googlecalendar": {
		Toolkit: "googlecalendar", Label: "Google Calendar", Kind: KindFreeBusy, BookInProduct: true,
		slotsTool: toolFindFreeSlots, createTool: toolCreateEvent,
		slotsArguments: func(request slotRequest) map[string]any {
			arguments := map[string]any{
				"time_min": request.From.UTC().Format(time.RFC3339),
				"time_max": request.To.UTC().Format(time.RFC3339),
				"items":    []map[string]any{{"id": "primary"}},
			}
			if request.Timezone != "" {
				arguments["timezone"] = request.Timezone
			}
			return arguments
		},
		readSlots: func(data map[string]any, _ slotRequest) ([]Slot, bool) {
			// Busy periods, for the caller to invert.
			return busyPeriods(data), false
		},
		createArguments: func(request BookingRequest, _ string) map[string]any {
			return googleEventArguments(request)
		},
	},
	"outlook": {
		Toolkit: "outlook", Label: "Outlook Calendar", Kind: KindFreeBusy, BookInProduct: true,
		slotsTool: "OUTLOOK_OUTLOOK_GET_SCHEDULE", createTool: "OUTLOOK_OUTLOOK_CALENDAR_CREATE_EVENT",
		slotsArguments: func(request slotRequest) map[string]any {
			// Outlook wants the mailboxes to query. "me" is the connected
			// account's own calendar, which is the only one we have consent for.
			return map[string]any{
				"Schedules":                []string{"me"},
				"StartTime":                map[string]any{"dateTime": request.From.UTC().Format("2006-01-02T15:04:05"), "timeZone": "UTC"},
				"EndTime":                  map[string]any{"dateTime": request.To.UTC().Format("2006-01-02T15:04:05"), "timeZone": "UTC"},
				"availabilityViewInterval": 30,
			}
		},
		readSlots: func(data map[string]any, _ slotRequest) ([]Slot, bool) {
			return outlookBusyPeriods(data), false
		},
		createArguments: func(request BookingRequest, _ string) map[string]any {
			end := request.Start.Add(time.Duration(request.DurationMinutes) * time.Minute)
			arguments := map[string]any{
				"subject":        request.Summary,
				"body":           request.Description,
				"is_html":        false,
				"start_datetime": request.Start.UTC().Format("2006-01-02T15:04:05"),
				"end_datetime":   end.UTC().Format("2006-01-02T15:04:05"),
				"time_zone":      "UTC",
			}
			if request.AttendeeEmail != "" {
				arguments["attendees_info"] = []map[string]any{{"email": request.AttendeeEmail}}
			}
			return arguments
		},
	},
	"cal": {
		Toolkit: "cal", Label: "Cal.com", Kind: KindScheduling, BookInProduct: true,
		SettingLabel: "Event type ID",
		slotsTool:    "CAL_GET_AVAILABLE_SLOTS_INFO", createTool: "CAL_CREATE_BOOKING",
		slotsArguments: func(request slotRequest) map[string]any {
			arguments := map[string]any{
				"startTime":   request.From.UTC().Format(time.RFC3339),
				"endTime":     request.To.UTC().Format(time.RFC3339),
				"eventTypeId": request.Setting,
				"duration":    int(request.Duration / time.Minute),
			}
			if request.Timezone != "" {
				arguments["timeZone"] = request.Timezone
			}
			return arguments
		},
		readSlots: func(data map[string]any, request slotRequest) ([]Slot, bool) {
			// Already bookable: Cal.com has applied the event type's own
			// availability, buffers and limits, which we must not second-guess.
			return schedulingSlots(data, request.Duration), true
		},
		createArguments: func(request BookingRequest, setting string) map[string]any {
			return map[string]any{
				"eventTypeId": setting,
				"start":       request.Start.UTC().Format(time.RFC3339),
				"timeZone":    request.Timezone,
				"attendee": map[string]any{
					"name": request.AttendeeName, "email": request.AttendeeEmail,
					"timeZone": request.Timezone,
				},
			}
		},
	},
	"calendly": {
		Toolkit: "calendly", Label: "Calendly", Kind: KindScheduling, BookInProduct: false,
		SettingLabel: "Event type URL",
		slotsTool:    "CALENDLY_LIST_EVENT_TYPE_AVAILABLE_TIMES",
		slotsArguments: func(request slotRequest) map[string]any {
			return map[string]any{
				"event_type": request.Setting,
				"start_time": request.From.UTC().Format(time.RFC3339),
				"end_time":   request.To.UTC().Format(time.RFC3339),
			}
		},
		readSlots: func(data map[string]any, request slotRequest) ([]Slot, bool) {
			return schedulingSlots(data, request.Duration), true
		},
		// Deliberately nil. Calendly has no third-party create-booking API
		// because booking happens on their own page, and pretending otherwise
		// would be a Book button that cannot finish.
		createArguments: nil,
	},
}

// CalendarProviderFor returns how to drive one calendar product.
func CalendarProviderFor(toolkit string) (CalendarProvider, bool) {
	provider, found := calendarProviders[strings.ToLower(strings.TrimSpace(toolkit))]
	return provider, found
}

// CalendarProviders lists what can hold an appointment, alphabetically.
func CalendarProviders() []CalendarProvider {
	list := make([]CalendarProvider, 0, len(calendarProviders))
	for _, provider := range calendarProviders {
		list = append(list, provider)
	}
	sort.Slice(list, func(i, j int) bool { return list[i].Label < list[j].Label })
	return list
}

// ErrCalendarNotSupported means the connected app cannot hold an appointment.
var ErrCalendarNotSupported = errors.New("this app cannot be used as a calendar")

// ErrBookingIsExternal means the provider finishes the booking on its own page.
var ErrBookingIsExternal = errors.New("this calendar completes bookings on its own page")

// FreeSlotsOn asks whichever calendar the customer chose what is offerable.
func (c *Client) FreeSlotsOn(ctx context.Context, userID, toolkit, setting string, from, to time.Time, duration time.Duration, timezone string, day WorkingDay) ([]Slot, error) {
	provider, found := CalendarProviderFor(toolkit)
	if !found {
		return nil, ErrCalendarNotSupported
	}
	if provider.SettingLabel != "" && strings.TrimSpace(setting) == "" {
		return nil, fmt.Errorf("%s needs its %s before times can be offered", provider.Label, strings.ToLower(provider.SettingLabel))
	}
	if duration <= 0 {
		duration = 30 * time.Minute
	}
	request := slotRequest{From: from, To: to, Duration: duration, Timezone: timezone, Setting: strings.TrimSpace(setting)}

	data, err := c.execute(ctx, userID, provider.slotsTool, provider.slotsArguments(request))
	if err != nil {
		return nil, err
	}
	slots, bookable := provider.readSlots(data, request)
	if bookable {
		// The provider already applied its own rules. Re-deriving against our
		// working day would fight availability the customer has configured
		// there, so the answer is taken as given and only bounded.
		if len(slots) > maxSlotsReturned {
			slots = slots[:maxSlotsReturned]
		}
		return slots, nil
	}
	return slotsFromBusyPeriods(slots, from, to, duration, day), nil
}

// BookOn writes the appointment to whichever calendar the customer chose.
func (c *Client) BookOn(ctx context.Context, userID, toolkit, setting string, request BookingRequest) (string, error) {
	provider, found := CalendarProviderFor(toolkit)
	if !found {
		return "", ErrCalendarNotSupported
	}
	if provider.createArguments == nil {
		return "", ErrBookingIsExternal
	}
	if request.Start.IsZero() {
		return "", errors.New("an appointment needs a start time")
	}
	if request.DurationMinutes <= 0 {
		request.DurationMinutes = 30
	}
	if strings.TrimSpace(request.Summary) == "" {
		request.Summary = "Appointment"
	}
	data, err := c.execute(ctx, userID, provider.createTool, provider.createArguments(request, strings.TrimSpace(setting)))
	if err != nil {
		return "", err
	}
	return eventIdentifier(data), nil
}

// outlookBusyPeriods reads Microsoft's schedule shape. Like the Google reader it
// is defensive rather than modelled: a provider changing a nesting level should
// cost an empty result and a visible "no times available", not a panic.
func outlookBusyPeriods(data map[string]any) []Slot {
	rows, ok := data["value"].([]any)
	if !ok {
		if inner, nested := data["data"].(map[string]any); nested {
			rows, ok = inner["value"].([]any)
		}
		if !ok {
			return nil
		}
	}
	var periods []Slot
	for _, row := range rows {
		schedule, isMap := row.(map[string]any)
		if !isMap {
			continue
		}
		items, isList := schedule["scheduleItems"].([]any)
		if !isList {
			continue
		}
		for _, item := range items {
			entry, isMap := item.(map[string]any)
			if !isMap {
				continue
			}
			start, startOK := graphMoment(entry["start"])
			end, endOK := graphMoment(entry["end"])
			if startOK && endOK && end.After(start) {
				periods = append(periods, Slot{Start: start, End: end})
			}
		}
	}
	return periods
}

// graphMoment reads Microsoft's {dateTime, timeZone} pair. The zone is ignored
// deliberately: the request asked for UTC, so that is what comes back, and
// trusting a zone name we did not send would be trusting the wrong thing.
func graphMoment(value any) (time.Time, bool) {
	entry, ok := value.(map[string]any)
	if !ok {
		return parseMoment(value)
	}
	text, ok := entry["dateTime"].(string)
	if !ok {
		return time.Time{}, false
	}
	for _, layout := range []string{time.RFC3339, "2006-01-02T15:04:05.9999999", "2006-01-02T15:04:05"} {
		if moment, err := time.Parse(layout, text); err == nil {
			return moment.UTC(), true
		}
	}
	return time.Time{}, false
}

// schedulingSlots reads the already-bookable times a scheduling product returns.
// The shapes differ between them, so every plausible nesting is tried rather
// than one being assumed.
func schedulingSlots(data map[string]any, duration time.Duration) []Slot {
	var times []time.Time
	var walk func(value any)
	walk = func(value any) {
		switch typed := value.(type) {
		case map[string]any:
			for key, nested := range typed {
				// Both products name the moment "start" or "time"; anything else
				// is a container to descend into.
				if key == "start" || key == "time" || key == "start_time" {
					if moment, ok := parseMoment(nested); ok {
						times = append(times, moment)
						continue
					}
				}
				walk(nested)
			}
		case []any:
			for _, item := range typed {
				walk(item)
			}
		}
	}
	walk(data)

	sort.Slice(times, func(i, j int) bool { return times[i].Before(times[j]) })
	slots := make([]Slot, 0, len(times))
	var previous time.Time
	for _, moment := range times {
		if moment.Equal(previous) {
			continue
		}
		previous = moment
		slots = append(slots, Slot{Start: moment, End: moment.Add(duration)})
	}
	return slots
}

func googleEventArguments(request BookingRequest) map[string]any {
	arguments := map[string]any{
		"start_datetime":         request.Start.Format(time.RFC3339),
		"event_duration_minutes": request.DurationMinutes,
		"summary":                request.Summary,
		"calendar_id":            "primary",
	}
	if request.Timezone != "" {
		arguments["timezone"] = request.Timezone
	}
	if request.Description != "" {
		arguments["description"] = request.Description
	}
	if request.AttendeeEmail != "" {
		arguments["attendees"] = []string{request.AttendeeEmail}
		arguments["send_updates"] = "all"
	}
	return arguments
}
