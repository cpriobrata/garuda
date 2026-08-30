package api

import (
	"net/http"
	"sort"
	"strings"
	"time"

	"garuda/backend/internal/composio"
	"garuda/backend/internal/model"
)

// Every appointment, whichever calendar it landed in.
//
// WHY THIS READS FROM LEADS RATHER THAN FROM THE CALENDARS. A customer may have
// Google on one agent and Cal.com on another; some appointments are booked
// through Garuda and some are put in by hand from a phone call. Asking each
// provider would mean N API calls on a page load, different shapes to reconcile,
// a failure mode per provider, and still no answer for the agent whose calendar
// was later disconnected.
//
// Garuda already records every appointment it books as a lead with source
// "appointment" and the time in its metadata. That record is ours, it survives
// the calendar being disconnected or the event being deleted there, and it is
// one read of state we already hold. The calendars remain the source of truth
// for what is IN them; this is the source of truth for what GARUDA booked, which
// is the question this page answers.
//
// The honest limit, and the UI says it: an appointment somebody moves or cancels
// inside their own calendar is not reflected here, because nothing tells us.

type appointmentView struct {
	ID        string `json:"id"`
	LeadID    string `json:"lead_id"`
	AgentID   string `json:"agent_id"`
	AgentName string `json:"agent_name,omitempty"`
	SessionID string `json:"session_id,omitempty"`

	StartsAt time.Time `json:"starts_at"`
	Minutes  int       `json:"minutes,omitempty"`
	Timezone string    `json:"timezone,omitempty"`

	// Calendar names where it was written, so a customer with more than one can
	// tell them apart at a glance.
	Calendar      string `json:"calendar,omitempty"`
	CalendarLabel string `json:"calendar_label,omitempty"`

	Name     string    `json:"name,omitempty"`
	Email    string    `json:"email,omitempty"`
	Phone    string    `json:"phone,omitempty"`
	Notes    string    `json:"notes,omitempty"`
	Status   string    `json:"status"`
	BookedAt time.Time `json:"booked_at"`
}

// listAppointments returns what Garuda has booked for this workspace, soonest
// first among those still to come.
func (s *Server) listAppointments(w http.ResponseWriter, r *http.Request) {
	identity := identityFrom(r.Context())
	now := time.Now().UTC()

	// "upcoming" by default, because the question a person opens this page to
	// ask is what is coming, not what happened.
	scope := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("scope")))
	if scope != "past" && scope != "all" {
		scope = "upcoming"
	}
	agentFilter := strings.TrimSpace(r.URL.Query().Get("agent_id"))

	upcoming := make([]appointmentView, 0)
	past := make([]appointmentView, 0)

	_ = s.store.View(func(state *model.State) error {
		agentNames := map[string]string{}
		agentCalendars := map[string]string{}
		for index := range state.Agents {
			agent := &state.Agents[index]
			if agent.AccountID != identity.AccountID {
				continue
			}
			agentNames[agent.ID] = agent.Name
			agentCalendars[agent.ID] = bookingCalendar(agent.Booking)
		}

		for index := range state.Leads {
			lead := &state.Leads[index]
			if lead.AccountID != identity.AccountID || lead.Source != "appointment" {
				continue
			}
			if agentFilter != "" && lead.AgentID != agentFilter {
				continue
			}
			startsAt, ok := appointmentStart(lead.Metadata)
			if !ok {
				continue
			}

			calendar := agentCalendars[lead.AgentID]
			// The calendar recorded ON the booking wins over the agent's current
			// one: an owner who switches provider must not have last week's
			// appointments relabelled as though they were booked in the new place.
			if stored := strings.TrimSpace(lead.Metadata["appointment_calendar"]); stored != "" {
				calendar = stored
			}
			label := calendar
			if provider, known := composio.CalendarProviderFor(calendar); known {
				label = provider.Label
			}

			view := appointmentView{
				ID: lead.ID, LeadID: lead.ID, AgentID: lead.AgentID,
				AgentName: agentNames[lead.AgentID], SessionID: lead.SessionID,
				StartsAt: startsAt, Timezone: lead.Metadata["appointment_timezone"],
				Calendar: calendar, CalendarLabel: label,
				Name: lead.Name, Email: lead.Email, Phone: lead.Phone,
				Notes: lead.Notes, Status: lead.Status, BookedAt: lead.CreatedAt,
			}
			if minutes := lead.Metadata["appointment_minutes"]; minutes != "" {
				view.Minutes = atoiSafe(minutes)
			}

			if startsAt.After(now) {
				upcoming = append(upcoming, view)
			} else {
				past = append(past, view)
			}
		}
		return nil
	})

	// Soonest first for what is coming; most recent first for what has been.
	sort.SliceStable(upcoming, func(i, j int) bool { return upcoming[i].StartsAt.Before(upcoming[j].StartsAt) })
	sort.SliceStable(past, func(i, j int) bool { return past[i].StartsAt.After(past[j].StartsAt) })

	items := upcoming
	switch scope {
	case "past":
		items = past
	case "all":
		items = append(append(make([]appointmentView, 0, len(upcoming)+len(past)), upcoming...), past...)
	}

	s.writeData(w, http.StatusOK, map[string]any{
		"appointments":   items,
		"upcoming_count": len(upcoming),
		"past_count":     len(past),
		// Said in the payload rather than only in the UI, so any consumer
		// inherits the caveat: a change made inside the customer's own calendar
		// is not reflected here, because nothing tells us about it.
		"reflects_changes_made_in_the_calendar": false,
	})
}

// appointmentStart reads the time a booking was made for. A lead whose metadata
// cannot be read is skipped rather than shown at the epoch, which would put a
// phantom appointment at the top of the past list forever.
func appointmentStart(metadata map[string]string) (time.Time, bool) {
	if metadata == nil {
		return time.Time{}, false
	}
	value := strings.TrimSpace(metadata["appointment_start"])
	if value == "" {
		return time.Time{}, false
	}
	moment, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return time.Time{}, false
	}
	return moment.UTC(), true
}

func atoiSafe(value string) int {
	total := 0
	for _, character := range value {
		if character < '0' || character > '9' {
			return 0
		}
		total = total*10 + int(character-'0')
		if total > 100_000 {
			return 0
		}
	}
	return total
}
