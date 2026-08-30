package api

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"garuda/backend/internal/composio"
	"garuda/backend/internal/model"
)

// Appointment booking, from inside the conversation.
//
// A visitor asks about availability, sees real free times from the owner's own
// calendar, picks one, and it is in the calendar before they close the tab.
//
// TWO THINGS DECIDE THE SHAPE OF THIS FILE.
//
// First, the model does not hold the pen. Slots are read and an event is written
// only from an explicit visitor choice of a slot this service offered. A model
// deciding on its own to create events in a real person's calendar is a class of
// mistake with no undo, made on somebody else's business, in front of their
// customer.
//
// Second, the offered slot is re-checked at booking time. Between seeing a time
// and choosing it, the owner may have taken that slot themselves -- so the
// booking path asks the calendar again rather than trusting what was offered.

const (
	defaultAppointmentMinutes = 30
	maxAppointmentMinutes     = 240
	defaultLeadDays           = 14
	maxLeadDays               = 60
	maxNoticeHours            = 168
	maxBookingLabel           = 60
	maxBookingTitle           = 120
)

// resolvedBooking is what the widget is told. The calendar itself, the owner's
// working hours and the account id are all absent: the widget needs to know that
// booking exists and what to call it, and nothing else.
type resolvedBooking struct {
	Enabled         bool   `json:"enabled"`
	Label           string `json:"label,omitempty"`
	DurationMinutes int    `json:"duration_minutes,omitempty"`
	Timezone        string `json:"timezone,omitempty"`
}

func bookingAvailable(booking model.BookingConfig) bool {
	// A configuration switched on with no time zone cannot offer a correct time,
	// and an appointment at the wrong hour is worse than no appointment.
	return booking.Enabled && strings.TrimSpace(booking.Timezone) != ""
}

func resolveBooking(agent model.Agent) resolvedBooking {
	booking := agent.Booking
	if !bookingAvailable(booking) {
		return resolvedBooking{Enabled: false}
	}
	label := booking.ButtonLabel
	if label == "" {
		label = "Book an appointment"
	}
	return resolvedBooking{
		Enabled:         true,
		Label:           label,
		DurationMinutes: appointmentMinutes(booking),
		Timezone:        booking.Timezone,
	}
}

func appointmentMinutes(booking model.BookingConfig) int {
	if booking.DurationMinutes <= 0 {
		return defaultAppointmentMinutes
	}
	if booking.DurationMinutes > maxAppointmentMinutes {
		return maxAppointmentMinutes
	}
	return booking.DurationMinutes
}

func normalizeBooking(booking *model.BookingConfig) {
	booking.ButtonLabel = strings.TrimSpace(booking.ButtonLabel)
	booking.Title = strings.TrimSpace(booking.Title)
	booking.Timezone = strings.TrimSpace(booking.Timezone)
	if booking.DurationMinutes < 0 {
		booking.DurationMinutes = 0
	}
	if booking.LeadDaysAhead <= 0 {
		booking.LeadDaysAhead = defaultLeadDays
	}
	if booking.NoticeHours < 0 {
		booking.NoticeHours = 0
	}
	// An UNSET working day gets the default here, so that what is stored is what
	// is used. The slot search used to fall back to 9-18 on its own, deep in the
	// availability arithmetic, which meant the saved configuration and the
	// effective one disagreed: the builder showed "0 to 0" while visitors were
	// offered nine to six.
	//
	// Only the unset case. A day that ENDS BEFORE IT STARTS is a typo, and
	// silently turning it into nine-to-six would hide the mistake from the person
	// who made it -- so that one is left for validation to reject.
	if booking.StartHour == 0 && booking.EndHour == 0 {
		booking.StartHour, booking.EndHour = 9, 18
	}
	// Deduplicate and bound the weekday set, so a caller sending [1,1,1,...]
	// cannot make the slot search do more work than there are days in a week.
	seen := map[int]bool{}
	days := make([]int, 0, 7)
	for _, day := range booking.Weekdays {
		if day < 0 || day > 6 || seen[day] {
			continue
		}
		seen[day] = true
		days = append(days, day)
	}
	booking.Weekdays = days
}

func validateBooking(booking model.BookingConfig, details map[string]string) {
	if booking.Enabled && booking.Timezone == "" {
		details["booking.timezone"] = "Choose the time zone your working hours are in"
	}
	if booking.Timezone != "" {
		if _, err := time.LoadLocation(booking.Timezone); err != nil {
			details["booking.timezone"] = "That is not a time zone name, for example Asia/Kolkata"
		}
	}
	if booking.DurationMinutes > maxAppointmentMinutes {
		details["booking.duration_minutes"] = "Appointments can be up to four hours"
	}
	if booking.StartHour < 0 || booking.StartHour > 23 || booking.EndHour < 0 || booking.EndHour > 24 {
		details["booking.hours"] = "Working hours must be between 0 and 24"
	} else if booking.EndHour != 0 && booking.EndHour <= booking.StartHour {
		details["booking.hours"] = "The working day has to end after it starts"
	}
	if booking.LeadDaysAhead > maxLeadDays {
		details["booking.lead_days_ahead"] = "Offer appointments within the next 60 days"
	}
	if booking.NoticeHours > maxNoticeHours {
		details["booking.notice_hours"] = "Notice cannot be longer than a week"
	}
	if utf8.RuneCountInString(booking.ButtonLabel) > maxBookingLabel {
		details["booking.button_label"] = "Keep the button label short"
	}
	if utf8.RuneCountInString(booking.Title) > maxBookingTitle {
		details["booking.title"] = "Keep the calendar title short"
	}
}

// bookingWindow turns the owner's configuration into the concrete question the
// calendar is asked, in the owner's own time zone.
func bookingWindow(booking model.BookingConfig, now time.Time) (from, to time.Time, day composio.WorkingDay, location *time.Location) {
	location, err := time.LoadLocation(booking.Timezone)
	if err != nil {
		location = time.UTC
	}
	from = now.In(location).Add(time.Duration(booking.NoticeHours) * time.Hour)
	days := booking.LeadDaysAhead
	if days <= 0 {
		days = defaultLeadDays
	}
	to = from.Add(time.Duration(days) * 24 * time.Hour)

	day = composio.WorkingDay{StartHour: booking.StartHour, EndHour: booking.EndHour}
	if len(booking.Weekdays) > 0 {
		day.Weekdays = make(map[time.Weekday]bool, len(booking.Weekdays))
		for _, value := range booking.Weekdays {
			day.Weekdays[time.Weekday(value)] = true
		}
	}
	return from, to, day, location
}

// listBookingSlots offers the visitor real free times from the owner's calendar.
func (s *Server) listBookingSlots(w http.ResponseWriter, r *http.Request) {
	session, authorized := s.authorizeWidgetSession(r)
	if !authorized {
		s.writeError(w, r, http.StatusUnauthorized, "invalid_session", "The widget session is invalid or expired", nil)
		return
	}
	agent, found := s.findPublishedAgentByID(session.AccountID, session.AgentID)
	if !found || !bookingAvailable(agent.Booking) {
		// 404 rather than 403, like every other tenant-scoped miss here: a
		// visitor probing which agents can book learns nothing from a route that
		// is simply not there.
		s.writeError(w, r, http.StatusNotFound, "booking_unavailable", "This assistant does not offer appointments", nil)
		return
	}

	booking := agent.Booking.Clone()
	from, to, day, location := bookingWindow(booking, time.Now().UTC())
	duration := time.Duration(appointmentMinutes(booking)) * time.Minute

	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	slots, err := s.composio.FreeSlots(ctx, session.AccountID, from, to, duration, booking.Timezone, day)
	if err != nil {
		s.writeBookingError(w, r, err)
		return
	}

	payload := make([]map[string]any, 0, len(slots))
	for _, slot := range slots {
		local := slot.Start.In(location)
		payload = append(payload, map[string]any{
			// Both forms travel: the machine-readable instant the booking call
			// will echo back, and the owner's own local wording, so the widget
			// never has to guess a time zone it was not told about.
			"start":   slot.Start.UTC().Format(time.RFC3339),
			"end":     slot.End.UTC().Format(time.RFC3339),
			"label":   local.Format("Mon 2 Jan, 15:04"),
			"day":     local.Format("Mon 2 Jan"),
			"time":    local.Format("15:04"),
			"minutes": appointmentMinutes(booking),
		})
	}
	s.writeData(w, http.StatusOK, map[string]any{
		"slots":            payload,
		"timezone":         booking.Timezone,
		"duration_minutes": appointmentMinutes(booking),
	})
}

type bookingRequest struct {
	Start string `json:"start"`
	Name  string `json:"name,omitempty"`
	Email string `json:"email,omitempty"`
	Notes string `json:"notes,omitempty"`
}

// createBooking writes the appointment the visitor chose.
func (s *Server) createBooking(w http.ResponseWriter, r *http.Request) {
	session, authorized := s.authorizeWidgetSession(r)
	if !authorized {
		s.writeError(w, r, http.StatusUnauthorized, "invalid_session", "The widget session is invalid or expired", nil)
		return
	}
	agent, found := s.findPublishedAgentByID(session.AccountID, session.AgentID)
	if !found || !bookingAvailable(agent.Booking) {
		s.writeError(w, r, http.StatusNotFound, "booking_unavailable", "This assistant does not offer appointments", nil)
		return
	}
	var input bookingRequest
	if !s.decodeJSON(w, r, &input) {
		return
	}
	start, err := time.Parse(time.RFC3339, strings.TrimSpace(input.Start))
	if err != nil {
		s.writeError(w, r, http.StatusUnprocessableEntity, "validation_failed", "Choose one of the offered times", map[string]string{"start": "invalid"})
		return
	}
	name := truncateRunes(input.Name, 160)
	email := strings.ToLower(strings.TrimSpace(input.Email))
	if email != "" && !validEmail(email) {
		s.writeError(w, r, http.StatusUnprocessableEntity, "validation_failed", "That email address is not valid", map[string]string{"email": "invalid"})
		return
	}
	notes := truncateRunes(input.Notes, 500)

	booking := agent.Booking.Clone()
	from, to, day, _ := bookingWindow(booking, time.Now().UTC())
	duration := time.Duration(appointmentMinutes(booking)) * time.Minute

	ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
	defer cancel()

	// Re-check rather than trust. Between being offered a time and choosing it,
	// the owner may have taken that slot themselves, and double-booking somebody
	// is the one outcome this feature must not produce.
	slots, err := s.composio.FreeSlots(ctx, session.AccountID, from, to, duration, booking.Timezone, day)
	if err != nil {
		s.writeBookingError(w, r, err)
		return
	}
	stillFree := false
	for _, slot := range slots {
		if slot.Start.Equal(start.UTC()) {
			stillFree = true
			break
		}
	}
	if !stillFree {
		s.writeError(w, r, http.StatusConflict, "slot_taken", "That time has just been taken. Please choose another.", nil)
		return
	}

	title := booking.Title
	if title == "" {
		title = "Appointment via " + agent.Name
	}
	if name != "" {
		title += " — " + name
	}
	// The visitor's own words, and nothing from the transcript. A chat history
	// copied into a calendar event is a copy of personal data outside the
	// product, in a place the owner cannot manage it.
	description := strings.TrimSpace(notes)
	if session.PageURL != "" {
		description = strings.TrimSpace(description + "\n\nBooked from " + session.PageURL)
	}

	eventID, err := s.composio.Book(ctx, session.AccountID, composio.BookingRequest{
		Start:           start.UTC(),
		DurationMinutes: appointmentMinutes(booking),
		Timezone:        booking.Timezone,
		Summary:         truncateRunes(title, maxBookingTitle+200),
		Description:     description,
		AttendeeEmail:   email,
	})
	if err != nil {
		s.writeBookingError(w, r, err)
		return
	}

	// The appointment is a lead. An owner should not have to read two lists to
	// find out somebody booked, and the lead is what survives retention.
	now := time.Now().UTC()
	lead := model.Lead{
		ID: newID("lead_"), AccountID: session.AccountID, AgentID: session.AgentID,
		SessionID: session.ID, VisitorID: session.VisitorID,
		Name: name, Email: email, Status: "new", Source: "appointment",
		Notes:     notes,
		Metadata:  map[string]string{"appointment_start": start.UTC().Format(time.RFC3339), "appointment_event_id": eventID},
		CreatedAt: now, UpdatedAt: now,
	}
	err = s.store.Update(func(state *model.State) error {
		state.Leads = append(state.Leads, lead)
		state.Messages = append(state.Messages, model.Message{
			ID: newID("msg_"), AccountID: session.AccountID, AgentID: session.AgentID, SessionID: session.ID,
			VisitorID: session.VisitorID, Role: "system",
			Content:   "The visitor booked an appointment.",
			Metadata:  map[string]any{"event": "appointment_booked", "start": start.UTC().Format(time.RFC3339)},
			CreatedAt: now,
		})
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
		// The appointment IS in the calendar at this point. Reporting a failure
		// would tell the visitor to book again and produce a duplicate, so the
		// booking is confirmed and the bookkeeping failure is logged instead.
		s.logger.Error("appointment stored in calendar but not recorded", "error", err, "request_id", requestID(r.Context()))
	}

	s.writeData(w, http.StatusCreated, map[string]any{
		"booked":   true,
		"start":    start.UTC().Format(time.RFC3339),
		"minutes":  appointmentMinutes(booking),
		"timezone": booking.Timezone,
	})
}

// writeBookingError keeps the customer's connection problems separate from the
// visitor's. A visitor cannot connect a calendar and should not be shown an
// error that reads as their fault.
func (s *Server) writeBookingError(w http.ResponseWriter, r *http.Request, err error) {
	if errors.Is(err, composio.ErrNotConnected) {
		s.writeError(w, r, http.StatusServiceUnavailable, "calendar_not_connected", "Appointments are not available right now. Please leave your details instead.", nil)
		return
	}
	s.logger.Warn("calendar request failed", "error", err, "request_id", requestID(r.Context()))
	s.writeError(w, r, http.StatusBadGateway, "calendar_unavailable", "The calendar could not be reached. Please try again in a moment.", nil)
}
