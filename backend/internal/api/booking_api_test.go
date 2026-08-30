package api

import (
	"testing"
	"time"

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
