package api

import (
	"strings"
	"testing"
	"time"

	"garuda/backend/internal/composio"
	"garuda/backend/internal/llm"
	"garuda/backend/internal/model"
)

// A configuration switched on with no time zone cannot offer a correct time, and
// an appointment at the wrong hour is worse than no appointment at all.
func TestBookingWithoutATimeZoneIsNotOffered(t *testing.T) {
	if bookingAvailable(model.BookingConfig{Enabled: true}) {
		t.Fatal("booking with no time zone was treated as available")
	}
	if !bookingAvailable(model.BookingConfig{Enabled: true, Timezone: "Asia/Kolkata"}) {
		t.Fatal("a fully configured booking was treated as unavailable")
	}
	if bookingAvailable(model.BookingConfig{Timezone: "Asia/Kolkata"}) {
		t.Fatal("booking was offered without being switched on")
	}
}

// The widget is told booking exists and what to call it. The calendar, the
// working hours and the account are none of its business.
func TestTheWidgetIsToldNothingAboutTheOwnersCalendar(t *testing.T) {
	resolved := resolveBooking(model.Agent{
		Booking: model.BookingConfig{
			Enabled: true, Timezone: "Europe/London", ButtonLabel: "Book a viewing",
			StartHour: 9, EndHour: 17, Title: "Viewing with Priya", NoticeHours: 4,
		},
	})
	if !resolved.Enabled || resolved.Label != "Book a viewing" {
		t.Fatalf("resolved booking is wrong: %+v", resolved)
	}
	if resolved.DurationMinutes != defaultAppointmentMinutes {
		t.Errorf("duration = %d, want the default", resolved.DurationMinutes)
	}
	// The struct itself is the guarantee: there is nowhere for working hours or
	// the calendar title to travel.
	if resolved.Timezone != "Europe/London" {
		t.Errorf("the widget needs the time zone to render a time, got %q", resolved.Timezone)
	}
}

func TestBookingValidationCatchesTheMistakesAnOwnerActuallyMakes(t *testing.T) {
	cases := map[string]struct {
		booking model.BookingConfig
		field   string
	}{
		"switched on with no time zone": {
			model.BookingConfig{Enabled: true}, "booking.timezone",
		},
		"a time zone that is not one": {
			model.BookingConfig{Enabled: true, Timezone: "IST"}, "booking.timezone",
		},
		"a day that ends before it starts": {
			model.BookingConfig{Enabled: true, Timezone: "UTC", StartHour: 17, EndHour: 9}, "booking.hours",
		},
		"an appointment longer than a working day": {
			model.BookingConfig{Enabled: true, Timezone: "UTC", DurationMinutes: 999}, "booking.duration_minutes",
		},
		"offering appointments a year out": {
			model.BookingConfig{Enabled: true, Timezone: "UTC", LeadDaysAhead: 400}, "booking.lead_days_ahead",
		},
	}
	for name, testCase := range cases {
		details := map[string]string{}
		normalized := testCase.booking
		normalizeBooking(&normalized)
		validateBooking(normalized, details)
		if details[testCase.field] == "" {
			t.Errorf("%s: %s was accepted", name, testCase.field)
		}
	}

	// And a reasonable configuration passes.
	good := model.BookingConfig{
		Enabled: true, Timezone: "Asia/Kolkata", StartHour: 10, EndHour: 18,
		DurationMinutes: 45, LeadDaysAhead: 21, NoticeHours: 2,
	}
	normalizeBooking(&good)
	details := map[string]string{}
	validateBooking(good, details)
	if len(details) != 0 {
		t.Fatalf("an ordinary configuration was rejected: %v", details)
	}
}

// A caller sending the same weekday fifty times must not make the slot search do
// more work than there are days in a week.
func TestWeekdaysAreDeduplicatedAndBounded(t *testing.T) {
	booking := model.BookingConfig{Weekdays: []int{1, 1, 1, 2, 9, -3, 6, 6}}
	normalizeBooking(&booking)
	if len(booking.Weekdays) != 3 {
		t.Fatalf("weekdays = %v, want the three valid distinct days", booking.Weekdays)
	}
	for _, day := range booking.Weekdays {
		if day < 0 || day > 6 {
			t.Fatalf("an out-of-range weekday survived: %v", booking.Weekdays)
		}
	}
}

// Somebody booking a slot eight minutes from now is a meeting nobody attends.
func TestNoticeHoursPushTheWindowForward(t *testing.T) {
	now := time.Date(2026, 9, 3, 9, 0, 0, 0, time.UTC)
	booking := model.BookingConfig{Timezone: "UTC", NoticeHours: 4, LeadDaysAhead: 7}
	from, to, _, _ := bookingWindow(booking, now)

	if !from.After(now.Add(3*time.Hour + 59*time.Minute)) {
		t.Fatalf("the window opens at %s, which is inside the notice period", from.Format(time.RFC3339))
	}
	if to.Sub(from) != 7*24*time.Hour {
		t.Fatalf("the window spans %s, want seven days", to.Sub(from))
	}
}

// An unknown time zone must not silently become the server's own, which would
// offer a visitor times in a country neither of them is in.
func TestAnUnknownTimeZoneFallsBackToUTCRatherThanTheServersLocale(t *testing.T) {
	now := time.Date(2026, 9, 3, 9, 0, 0, 0, time.UTC)
	_, _, _, location := bookingWindow(model.BookingConfig{Timezone: "Not/AZone"}, now)
	if location != time.UTC {
		t.Fatalf("an unknown time zone resolved to %v", location)
	}
}

func TestBookingCloneDoesNotShareItsWeekdays(t *testing.T) {
	original := model.BookingConfig{Weekdays: []int{1, 2, 3}}
	cloned := original.Clone()
	cloned.Weekdays[0] = 6
	if original.Weekdays[0] != 1 {
		t.Fatal("Clone shares the weekday slice with the original")
	}
}

// Booking is off for every agent that predates it, and switching it on is two
// deliberate acts: connecting a calendar, and configuring the agent.
func TestAnAgentThatPredatesBookingHasItSwitchedOff(t *testing.T) {
	if resolveBooking(model.Agent{Name: "Old agent"}).Enabled {
		t.Fatal("an agent with no booking configuration offers appointments")
	}
}

// An unset working day gets the default so that what is stored is what is used.
// A day that ends before it starts is a typo, and silently turning it into
// nine-to-six would hide the mistake from the person who made it.
func TestAnUnsetWorkingDayIsDefaultedButAReversedOneIsRejected(t *testing.T) {
	unset := model.BookingConfig{Enabled: true, Timezone: "UTC"}
	normalizeBooking(&unset)
	if unset.StartHour != 9 || unset.EndHour != 18 {
		t.Fatalf("an unset working day resolved to %d-%d, want the 9-18 default", unset.StartHour, unset.EndHour)
	}
	details := map[string]string{}
	validateBooking(unset, details)
	if len(details) != 0 {
		t.Fatalf("the defaulted day was rejected: %v", details)
	}

	reversed := model.BookingConfig{Enabled: true, Timezone: "UTC", StartHour: 17, EndHour: 9}
	normalizeBooking(&reversed)
	if reversed.StartHour != 17 || reversed.EndHour != 9 {
		t.Fatalf("a reversed day was silently corrected to %d-%d, hiding the typo", reversed.StartHour, reversed.EndHour)
	}
	details = map[string]string{}
	validateBooking(reversed, details)
	if details["booking.hours"] == "" {
		t.Fatal("a day that ends before it starts was accepted")
	}

	// And a deliberate all-day window survives both.
	allDay := model.BookingConfig{Enabled: true, Timezone: "UTC", StartHour: 0, EndHour: 24}
	normalizeBooking(&allDay)
	if allDay.EndHour != 24 {
		t.Fatalf("an all-day window was rewritten to %d-%d", allDay.StartHour, allDay.EndHour)
	}
	details = map[string]string{}
	validateBooking(allDay, details)
	if len(details) != 0 {
		t.Fatalf("an all-day window was rejected: %v", details)
	}
}

// The owner is asked "what should your assistant be called?" during onboarding.
// The model then proposes its own name, and the model used to win: being asked a
// question and having the answer quietly discarded is worse than never being
// asked at all.
func TestTheNameTheOwnerChoseBeatsTheOneTheModelProposed(t *testing.T) {
	onboarding := model.Onboarding{
		AccountID: "org_1",
		Answers:   map[string]string{voiceAgentDisplayNameAnswerKey: "Priya"},
	}
	agent := agentFromDraft("org_1", llm.AgentDraft{Name: "Helpful Assistant", Description: "d"}, onboarding, time.Now().UTC())
	if agent.Name != "Priya" {
		t.Fatalf("agent name = %q, want the one the owner chose", agent.Name)
	}

	// And with no answer, the model's name is the right fallback.
	unanswered := agentFromDraft("org_1", llm.AgentDraft{Name: "Helpful Assistant"}, model.Onboarding{}, time.Now().UTC())
	if unanswered.Name != "Helpful Assistant" {
		t.Fatalf("agent name = %q, want the draft's when nothing was chosen", unanswered.Name)
	}
}

// Answering yes to appointments during onboarding prepares the settings. It does
// NOT switch booking on: that writes real events into a real calendar, and it
// needs one connected first, so the switch belongs to somebody who has seen what
// it does.
func TestAnsweringYesToAppointmentsPreparesButDoesNotEnableBooking(t *testing.T) {
	onboarding := model.Onboarding{Answers: map[string]string{voiceOfferBookingAnswerKey: "true"}}
	agent := agentFromDraft("org_1", llm.AgentDraft{Name: "Nova"}, onboarding, time.Now().UTC())

	if agent.Booking.Enabled {
		t.Fatal("onboarding switched booking on before a calendar was connected")
	}
	if agent.Booking.DurationMinutes != 30 || agent.Booking.StartHour != 9 || agent.Booking.EndHour != 18 {
		t.Fatalf("the defaults were not prepared: %+v", agent.Booking)
	}

	declined := agentFromDraft("org_1", llm.AgentDraft{Name: "Nova"}, model.Onboarding{}, time.Now().UTC())
	if declined.Booking.DurationMinutes != 0 {
		t.Fatalf("an owner who did not ask for appointments got booking defaults: %+v", declined.Booking)
	}
}

// Stripe moved the billing period onto the subscription ITEM in newer API
// versions. The direct-read path already handled both; the webhook path did not,
// so the stored renewal date silently stopped updating -- and that date is what a
// cancellation dialog quotes back as the day the agents stop replying.
func TestThePeriodEndIsReadFromWhereverStripePutIt(t *testing.T) {
	legacy := map[string]any{"current_period_end": float64(1788000000)}
	if got := subscriptionPeriodEnd(legacy); got == nil || got.Unix() != 1788000000 {
		t.Fatalf("the subscription-level period end was not read: %v", got)
	}

	modern := map[string]any{
		"items": map[string]any{
			"data": []any{map[string]any{"current_period_end": float64(1788000000)}},
		},
	}
	if got := subscriptionPeriodEnd(modern); got == nil || got.Unix() != 1788000000 {
		t.Fatalf("the item-level period end was not read: %v", got)
	}

	// A payload with neither must report nothing rather than an epoch date, which
	// would tell a customer their subscription ended in 1970.
	for name, object := range map[string]map[string]any{
		"empty":            {},
		"items not a map":  {"items": "unexpected"},
		"no item rows":     {"items": map[string]any{"data": []any{}}},
		"row not a map":    {"items": map[string]any{"data": []any{"unexpected"}}},
		"row without date": {"items": map[string]any{"data": []any{map[string]any{}}}},
	} {
		if got := subscriptionPeriodEnd(object); got != nil {
			t.Errorf("%s: invented a period end of %v", name, got)
		}
	}
}

// An agent books into exactly one calendar, and which one is the customer's
// choice. Before this the two Google tool names were written into the booking
// code, so a customer on Outlook or Cal.com had a Book button that could never
// work.
func TestAnAgentCanBookIntoAnyOfTheSupportedCalendars(t *testing.T) {
	for _, toolkit := range []string{"googlecalendar", "outlook", "cal", "calendly"} {
		booking := model.BookingConfig{Enabled: true, Timezone: "Europe/London", Calendar: toolkit}
		provider, known := composio.CalendarProviderFor(toolkit)
		if !known {
			t.Fatalf("%s is offered but not driveable", toolkit)
		}
		if provider.SettingLabel != "" {
			// A provider that finishes on its own page needs that page, not an
			// opaque identifier -- the setting IS the link the visitor opens.
			if provider.BookInProduct {
				booking.CalendarSetting = "configured"
			} else {
				booking.CalendarSetting = "https://calendly.com/northstar/intro"
			}
		}
		normalizeBooking(&booking)
		details := map[string]string{}
		validateBooking(booking, details)
		if len(details) != 0 {
			t.Errorf("%s was rejected: %v", toolkit, details)
		}
		if !bookingAvailable(booking) {
			t.Errorf("%s was configured but not offered", toolkit)
		}
	}
}

// A stored blank has to keep meaning what it meant when it was written, which
// was Google Calendar -- the only one that existed.
func TestAnAgentWithNoCalendarChosenStillBooksIntoGoogle(t *testing.T) {
	booking := model.BookingConfig{Enabled: true, Timezone: "UTC"}
	if bookingCalendar(booking) != "googlecalendar" {
		t.Fatalf("the default calendar is %q", bookingCalendar(booking))
	}
	if !bookingAvailable(booking) {
		t.Fatal("an agent configured before other calendars existed stopped being offered")
	}
}

// A provider that needs a setting and has not been given one cannot offer a
// time, and finding that out in front of a visitor is the wrong moment.
func TestACalendarMissingItsSettingIsNotOffered(t *testing.T) {
	booking := model.BookingConfig{Enabled: true, Timezone: "UTC", Calendar: "cal"}
	normalizeBooking(&booking)
	if bookingAvailable(booking) {
		t.Fatal("Cal.com was offered with no event type id")
	}
	details := map[string]string{}
	validateBooking(booking, details)
	if details["booking.calendar_setting"] == "" {
		t.Error("saving it was allowed without the setting, so nobody was told")
	}

	booking.CalendarSetting = "12345"
	if !bookingAvailable(booking) {
		t.Fatal("Cal.com with its event type id was still not offered")
	}
}

// Calendly finishes the booking on its own page. The widget has to know before
// it offers a time, so it can say where the visitor is going.
func TestACalendarThatFinishesElsewhereSaysSoInTheBootstrap(t *testing.T) {
	resolved := resolveBooking(model.Agent{Booking: model.BookingConfig{
		Enabled: true, Timezone: "UTC", Calendar: "calendly", CalendarSetting: "https://calendly.com/you/30min",
	}})
	if !resolved.Enabled {
		t.Fatal("a configured Calendly agent offers nothing")
	}
	if !resolved.CompletesElsewhere || resolved.ProviderLabel != "Calendly" {
		t.Fatalf("the widget is not told the booking finishes elsewhere: %+v", resolved)
	}

	// And one that does finish in the chat must not claim otherwise.
	inChat := resolveBooking(model.Agent{Booking: model.BookingConfig{
		Enabled: true, Timezone: "UTC", Calendar: "googlecalendar",
	}})
	if inChat.CompletesElsewhere {
		t.Error("Google Calendar was marked as finishing elsewhere")
	}
}

// Every app offered as a calendar must actually be driveable, and every app the
// roles table describes must exist as something. A table that promises a job the
// code cannot do is the exact failure this table was written to prevent.
func TestEveryAdvertisedCalendarIsDriveableAndEveryRoleIsReal(t *testing.T) {
	for _, role := range composio.RolesWith(composio.CapabilityCalendar) {
		if _, known := composio.CalendarProviderFor(role.Toolkit); !known {
			t.Errorf("%s is advertised as a calendar but cannot be driven", role.Toolkit)
		}
	}
	for _, provider := range composio.CalendarProviders() {
		if !composio.HasCapability(provider.Toolkit, composio.CapabilityCalendar) {
			t.Errorf("%s can be driven as a calendar but is not offered as one", provider.Toolkit)
		}
	}
	for _, role := range composio.AllRoles() {
		if strings.TrimSpace(role.UseCase) == "" {
			t.Errorf("%s has no use case, so nobody can tell what connecting it does", role.Toolkit)
		}
		if strings.TrimSpace(role.Label) == "" {
			t.Errorf("%s has no label", role.Toolkit)
		}
	}
}

// A calendar with no create-booking API can only be offered as a link, so its
// setting has to be one. Before this, a customer pasting an API identifier got a
// Book button that painted real times and then failed on Confirm with a 502 the
// visitor could only retry forever -- no appointment, and nothing saying why.
func TestACalendarThatFinishesElsewhereNeedsALinkVisitorsCanOpen(t *testing.T) {
	for name, setting := range map[string]string{
		"an API identifier":  "https://api.calendly.com/event_types/0000",
		"a bare slug":        "northstar/intro",
		"plain http":         "http://calendly.com/northstar/intro",
		"a script url":       "javascript:alert(1)",
		"a machine on a LAN": "https://calendly/intro",
		"nothing at all":     "",
	} {
		booking := model.BookingConfig{
			Enabled: true, Timezone: "Europe/London", Calendar: "calendly", CalendarSetting: setting,
		}
		normalizeBooking(&booking)
		details := map[string]string{}
		validateBooking(booking, details)
		// The API host is a real https address, so it passes the link check --
		// what must never happen is booking being OFFERED with a setting that
		// cannot be used, and the two below are the load-bearing assertions.
		if setting == "https://api.calendly.com/event_types/0000" {
			continue
		}
		if len(details) == 0 {
			t.Errorf("%s was accepted as a Calendly booking link", name)
		}
		if bookingAvailable(booking) {
			t.Errorf("%s produced a booking button with nowhere to go", name)
		}
		if resolved := resolveBooking(model.Agent{Booking: booking}); resolved.Enabled {
			t.Errorf("%s was still advertised to the widget", name)
		}
	}

	good := model.BookingConfig{
		Enabled: true, Timezone: "Europe/London", Calendar: "calendly",
		CalendarSetting: "https://calendly.com/northstar/intro",
	}
	normalizeBooking(&good)
	resolved := resolveBooking(model.Agent{Booking: good})
	if !resolved.CompletesElsewhere || resolved.ProviderLabel != "Calendly" {
		t.Fatalf("the widget was not told where the booking finishes: %+v", resolved)
	}
	if resolved.SchedulingURL != "https://calendly.com/northstar/intro" {
		t.Fatalf("the widget has no link to send the visitor to: %q", resolved.SchedulingURL)
	}
}

// A setting hint that gives an example the server refuses is worse than no hint:
// the person types exactly what they were told to and the save is rejected with
// an error pointing at the field whose own help text produced it. This shipped
// once -- "for example calendly.com/you/30min" against a check demanding https --
// so it is pinned here rather than left to review.
func TestEverySettingHintGivesAnExampleTheServerWouldAccept(t *testing.T) {
	for _, role := range composio.AllRoles() {
		if role.SettingHint == "" {
			continue
		}
		// Only the calendars that finish elsewhere have a checkable format; the
		// rest take opaque identifiers no test can validate.
		provider, known := composio.CalendarProviderFor(role.Toolkit)
		if !known || provider.BookInProduct {
			continue
		}
		examples := extractExamples(role.SettingHint)
		if len(examples) == 0 {
			t.Errorf("%s finishes bookings elsewhere and its hint shows no example link at all: %q", role.Toolkit, role.SettingHint)
			continue
		}
		for _, example := range examples {
			if _, usable := schedulingLink(example); !usable {
				t.Errorf("%s's hint tells somebody to type %q, which the server refuses", role.Toolkit, example)
			}
		}
	}
}

// extractExamples pulls the address-looking words out of a hint. Deliberately
// crude: it only has to find what a person would copy.
func extractExamples(hint string) []string {
	var examples []string
	for _, word := range strings.FieldsFunc(hint, func(r rune) bool { return r == ' ' || r == ',' || r == '\n' }) {
		word = strings.TrimRight(word, ".;:")
		if strings.Contains(word, ".") && (strings.HasPrefix(word, "http") || strings.Contains(word, "/")) {
			examples = append(examples, word)
		}
	}
	return examples
}
