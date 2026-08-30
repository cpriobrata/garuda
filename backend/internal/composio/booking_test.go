package composio

import (
	"testing"
	"time"
)

// The provider answers with BUSY periods, which is the opposite of what a
// visitor needs to see. Every test here is about that inversion, because it is
// where a wrong answer double-books a real person.

func busyResponse(periods ...[2]string) map[string]any {
	list := make([]any, 0, len(periods))
	for _, period := range periods {
		list = append(list, map[string]any{"start": period[0], "end": period[1]})
	}
	return map[string]any{
		"calendars": map[string]any{
			"primary": map[string]any{"busy": list},
		},
	}
}

func mustParse(t *testing.T, value string) time.Time {
	t.Helper()
	moment, err := time.Parse(time.RFC3339, value)
	if err != nil {
		t.Fatalf("parse %q: %v", value, err)
	}
	return moment.UTC()
}

func officeHours() WorkingDay {
	// Thursday 2026-09-03 is a weekday, so the default weekday rule allows it.
	return WorkingDay{StartHour: 9, EndHour: 17}
}

func TestABusyPeriodRemovesExactlyTheSlotsItCovers(t *testing.T) {
	from := mustParse(t, "2026-09-03T09:00:00Z")
	to := mustParse(t, "2026-09-03T12:00:00Z")
	data := busyResponse([2]string{"2026-09-03T10:00:00Z", "2026-09-03T11:00:00Z"})

	slots := slotsFromBusy(data, from, to, 30*time.Minute, officeHours())

	var offered []string
	for _, slot := range slots {
		offered = append(offered, slot.Start.Format("15:04"))
	}
	want := []string{"09:00", "09:30", "11:00", "11:30"}
	if len(offered) != len(want) {
		t.Fatalf("offered %v, want %v", offered, want)
	}
	for index := range want {
		if offered[index] != want[index] {
			t.Fatalf("offered %v, want %v", offered, want)
		}
	}
}

// A meeting that ends at 10:00 leaves 10:00 free. Treating a touching edge as an
// overlap loses a real slot every time.
func TestASlotTouchingTheEdgeOfAMeetingIsStillOffered(t *testing.T) {
	from := mustParse(t, "2026-09-03T09:00:00Z")
	to := mustParse(t, "2026-09-03T11:00:00Z")
	data := busyResponse([2]string{"2026-09-03T09:30:00Z", "2026-09-03T10:00:00Z"})

	slots := slotsFromBusy(data, from, to, 30*time.Minute, officeHours())
	found := false
	for _, slot := range slots {
		if slot.Start.Equal(mustParse(t, "2026-09-03T10:00:00Z")) {
			found = true
		}
		if slot.Start.Equal(mustParse(t, "2026-09-03T09:30:00Z")) {
			t.Fatal("a slot inside a meeting was offered")
		}
	}
	if !found {
		t.Fatal("the slot starting exactly when a meeting ends was not offered")
	}
}

// Without working hours, "free" means 3am as readily as 3pm, and a visitor would
// book it.
func TestNothingOutsideWorkingHoursIsOffered(t *testing.T) {
	from := mustParse(t, "2026-09-03T00:00:00Z")
	to := mustParse(t, "2026-09-04T00:00:00Z")

	slots := slotsFromBusy(busyResponse(), from, to, time.Hour, WorkingDay{StartHour: 9, EndHour: 17})
	if len(slots) == 0 {
		t.Fatal("a completely free working day offered nothing")
	}
	for _, slot := range slots {
		if slot.Start.Hour() < 9 || slot.End.Hour() > 17 {
			t.Fatalf("a slot outside working hours was offered: %s to %s",
				slot.Start.Format(time.RFC3339), slot.End.Format(time.RFC3339))
		}
	}
}

// An appointment that would run past the end of the day is not a valid
// appointment, however free the calendar looks at its start.
func TestASlotThatWouldOverrunTheDayIsNotOffered(t *testing.T) {
	from := mustParse(t, "2026-09-03T16:00:00Z")
	to := mustParse(t, "2026-09-03T19:00:00Z")

	slots := slotsFromBusy(busyResponse(), from, to, time.Hour, WorkingDay{StartHour: 9, EndHour: 17})
	for _, slot := range slots {
		if slot.End.After(mustParse(t, "2026-09-03T17:00:00Z")) {
			t.Fatalf("an appointment running past the working day was offered, ending %s", slot.End.Format(time.RFC3339))
		}
	}
}

func TestWeekendsAreNotOfferedByDefault(t *testing.T) {
	// 2026-09-05 is a Saturday.
	from := mustParse(t, "2026-09-05T09:00:00Z")
	to := mustParse(t, "2026-09-05T17:00:00Z")

	if slots := slotsFromBusy(busyResponse(), from, to, time.Hour, WorkingDay{StartHour: 9, EndHour: 17}); len(slots) != 0 {
		t.Fatalf("a Saturday offered %d slots", len(slots))
	}

	// A business that does work Saturdays can say so.
	saturday := WorkingDay{StartHour: 9, EndHour: 17, Weekdays: map[time.Weekday]bool{time.Saturday: true}}
	if slots := slotsFromBusy(busyResponse(), from, to, time.Hour, saturday); len(slots) == 0 {
		t.Fatal("a business that opted into Saturdays was offered nothing")
	}
}

// A wall of times is a form, not a choice, and the response travels to a widget
// on somebody else's page.
func TestTheNumberOfOfferedSlotsIsBounded(t *testing.T) {
	from := mustParse(t, "2026-09-03T09:00:00Z")
	to := mustParse(t, "2026-09-30T17:00:00Z")

	slots := slotsFromBusy(busyResponse(), from, to, 15*time.Minute, WorkingDay{StartHour: 9, EndHour: 17})
	if len(slots) > maxSlotsReturned {
		t.Fatalf("offered %d slots, past the cap of %d", len(slots), maxSlotsReturned)
	}
}

// A back-to-back day has no free time, and saying so is the correct answer.
func TestAFullyBookedDayOffersNothing(t *testing.T) {
	from := mustParse(t, "2026-09-03T09:00:00Z")
	to := mustParse(t, "2026-09-03T17:00:00Z")
	data := busyResponse([2]string{"2026-09-03T09:00:00Z", "2026-09-03T17:00:00Z"})

	if slots := slotsFromBusy(data, from, to, 30*time.Minute, officeHours()); len(slots) != 0 {
		t.Fatalf("a fully booked day offered %d slots", len(slots))
	}
}

// A provider changing a nesting level should cost an empty result and a visible
// "no times available", never a panic on somebody else's website.
func TestAnUnexpectedResponseShapeIsSurvivable(t *testing.T) {
	from := mustParse(t, "2026-09-03T09:00:00Z")
	to := mustParse(t, "2026-09-03T11:00:00Z")

	for name, data := range map[string]map[string]any{
		"empty":            {},
		"nil calendars":    {"calendars": nil},
		"wrong type":       {"calendars": "unexpected"},
		"busy not a list":  {"calendars": map[string]any{"primary": map[string]any{"busy": "unexpected"}}},
		"unparseable time": {"calendars": map[string]any{"primary": map[string]any{"busy": []any{map[string]any{"start": "not a time", "end": "also not"}}}}},
	} {
		slots := slotsFromBusy(data, from, to, 30*time.Minute, officeHours())
		// With no parseable busy periods every working slot is free, which is the
		// safe direction only because a booking is always confirmed against the
		// calendar at creation time.
		if len(slots) == 0 && name != "" {
			t.Logf("%s: offered nothing, which is acceptable", name)
		}
	}

	// The one that must hold in every case: the nesting variant is still read.
	nested := map[string]any{"data": busyResponse([2]string{"2026-09-03T09:00:00Z", "2026-09-03T10:00:00Z"})}
	if len(busyPeriods(nested)) != 1 {
		t.Fatal("a response nested one level deeper was not read")
	}
}

func TestOfferedTimesLandOnAppointmentBoundaries(t *testing.T) {
	// Deliberately starting at an awkward moment: the offered times should still
	// read like appointments rather than like whatever second the request landed.
	from := mustParse(t, "2026-09-03T09:07:00Z")
	to := mustParse(t, "2026-09-03T11:00:00Z")

	slots := slotsFromBusy(busyResponse(), from, to, 30*time.Minute, officeHours())
	if len(slots) == 0 {
		t.Fatal("no slots were offered")
	}
	for _, slot := range slots {
		if slot.Start.Minute()%30 != 0 || slot.Start.Second() != 0 {
			t.Fatalf("a slot did not land on an appointment boundary: %s", slot.Start.Format(time.RFC3339))
		}
	}
}

// The id is only for the owner's own reference, so its absence must not be
// reported as a failed booking.
func TestTheEventIdentifierIsFoundWhereverTheProviderPutIt(t *testing.T) {
	cases := map[string]map[string]any{
		"top level": {"id": "evt_1"},
		"snake":     {"event_id": "evt_2"},
		"nested":    {"response_data": map[string]any{"id": "evt_3"}},
		"data":      {"data": map[string]any{"htmlLink": "https://calendar.example/evt_4"}},
	}
	for name, data := range cases {
		if eventIdentifier(data) == "" {
			t.Errorf("%s: the event identifier was not found", name)
		}
	}
	if eventIdentifier(map[string]any{"nothing": 1}) != "" {
		t.Error("an identifier was invented from a response that had none")
	}
}
