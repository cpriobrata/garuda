import { apiRequest } from "@/lib/api";

// The appointments screen reads three things, and only the first is the list.
//
//   GET /v1/appointments        what Garuda booked           appointments.go
//   GET /v1/agents              whether booking is even on   agents.go
//   GET /v1/integrations/roles  which calendars exist        composio_api.go
//
// The last two exist for the empty state. "Nothing is booked" and "nothing can
// be booked" are different sentences, and only the agents plus the calendar
// table can tell them apart -- so the screen never tells somebody to wait for
// bookings that no agent is configured to take.

// appointmentView in backend/internal/api/appointments.go. Everything carrying
// `omitempty` on the Go side is optional here; id, status and the two times are
// the only fields always present.
export type Appointment = {
  id: string;
  lead_id: string;
  agent_id: string;
  agent_name?: string;
  session_id?: string;
  starts_at: string;
  minutes?: number;
  timezone?: string;
  calendar?: string;
  calendar_label?: string;
  name?: string;
  email?: string;
  phone?: string;
  notes?: string;
  status: string;
  booked_at: string;
};

export type AppointmentList = {
  appointments: Appointment[];
  upcoming_count: number;
  past_count: number;
  // The API's own caveat, carried in the payload rather than assumed by the UI:
  // a booking somebody moved or cancelled inside their own calendar is not
  // reflected here, because nothing tells us. Read rather than hard-coded, so
  // the day the backend can honestly say `true` the sentence disappears on its
  // own instead of outliving the limitation it describes.
  reflects_changes_made_in_the_calendar: boolean;
};

export type AppointmentScope = "upcoming" | "past" | "all";

// One calendar product, from GET /v1/integrations/roles. `books_in_chat` false
// means the provider finishes the booking on its own page -- Calendly -- which
// is also why such a booking never reaches this list.
export type CalendarOption = { toolkit: string; label: string; setting_label: string; books_in_chat: boolean };

// model.BookingConfig as it arrives on an agent summary. Every field is
// optional on the wire.
type AgentBooking = { enabled?: boolean; calendar?: string; calendar_setting?: string; timezone?: string };

export type BookingAgent = { id: string; name: string; status: string; booking: AgentBooking };

export type BookingSetup = { agents: BookingAgent[]; calendars: CalendarOption[] };

// The calendar an agent books into. Empty means Google Calendar, exactly as
// bookingCalendar does in backend/internal/api/booking.go: every agent
// configured before other providers existed stored a blank, and a blank has to
// keep meaning what it meant then.
export function agentCalendarToolkit(agent: BookingAgent) {
  return (agent.booking?.calendar || "").trim().toLowerCase() || "googlecalendar";
}

// Whether the backend would actually honour this agent's booking config, and if
// not, why. This mirrors bookingAvailable in backend/internal/api/booking.go:
// switched on is not the same as working, and an owner waiting on appointments
// that can never arrive deserves to be told which of the two they have.
export type BookingReadiness =
  | { state: "ready"; calendar: CalendarOption | null }
  | { state: "incomplete"; reason: string };

export function bookingReadiness(agent: BookingAgent, calendars: CalendarOption[]): BookingReadiness | null {
  if (!agent.booking?.enabled) return null;
  // No visitor can reach an agent that is not live, so it cannot be "offering
  // appointments" however well its booking is configured. Counting it as ready
  // told an owner to sit and wait for bookings from a draft nobody can see.
  if (agent.status === "draft") {
    return { state: "incomplete", reason: "it is still a draft, so no visitor can reach it yet" };
  }
  if (agent.status === "paused") {
    return { state: "incomplete", reason: "it is paused, so it is not answering on your website" };
  }
  if (agent.status === "archived") {
    return { state: "incomplete", reason: "it is archived" };
  }
  const toolkit = agentCalendarToolkit(agent);
  const calendar = calendars.find((option) => option.toolkit === toolkit) || null;
  if (!(agent.booking.timezone || "").trim()) {
    return { state: "incomplete", reason: "it has no time zone set, so it cannot offer a correct hour" };
  }
  // An unknown toolkit is only knowable once the calendar table has arrived.
  // With an empty table every calendar looks unknown, and calling that a
  // misconfiguration would invent a problem out of a failed request.
  if (!calendar && calendars.length) {
    return { state: "incomplete", reason: `${toolkit} is not a calendar Garuda can book into` };
  }
  if (calendar?.setting_label && !(agent.booking.calendar_setting || "").trim()) {
    return { state: "incomplete", reason: `its ${calendar.label} ${calendar.setting_label.toLowerCase()} has not been filled in` };
  }
  return { state: "ready", calendar };
}

// Relative to the moment the demo workspace is opened, so the day grouping, the
// "Today" heading and the past toggle all behave the way they will against a
// real API rather than freezing at whatever date this file was written.
function demoAt(days: number, hour: number, minute = 0) {
  const at = new Date();
  at.setDate(at.getDate() + days);
  at.setHours(hour, minute, 0, 0);
  return at.toISOString();
}

const demoUpcoming: Appointment[] = [
  { id: "lead_demo_appt_1", lead_id: "lead_demo_appt_1", agent_id: "aria-sales", agent_name: "Aria", session_id: "conv-1", starts_at: demoAt(0, 16, 30), minutes: 30, timezone: "Europe/London", calendar: "googlecalendar", calendar_label: "Google Calendar", name: "Priya Raman", email: "priya@northwind.example", phone: "+44 20 7946 0812", notes: "Wants to see the reporting side before renewing.", status: "qualified", booked_at: demoAt(-2, 11, 4) },
  { id: "lead_demo_appt_2", lead_id: "lead_demo_appt_2", agent_id: "aria-sales", agent_name: "Aria", session_id: "conv-2", starts_at: demoAt(1, 10, 0), minutes: 45, timezone: "Europe/London", calendar: "googlecalendar", calendar_label: "Google Calendar", name: "Tomas Berg", email: "tomas@lightfold.example", status: "new", booked_at: demoAt(-1, 9, 41) },
  { id: "lead_demo_appt_3", lead_id: "lead_demo_appt_3", agent_id: "nova-support", agent_name: "Nova", session_id: "conv-3", starts_at: demoAt(1, 14, 15), minutes: 60, timezone: "America/New_York", calendar: "cal", calendar_label: "Cal.com", name: "Dana Whitfield", email: "dana@harborline.example", notes: "Onboarding walkthrough for the ops team.", status: "contacted", booked_at: demoAt(-1, 16, 12) },
  { id: "lead_demo_appt_4", lead_id: "lead_demo_appt_4", agent_id: "nova-support", agent_name: "Nova", starts_at: demoAt(4, 11, 30), minutes: 30, timezone: "America/New_York", calendar: "cal", calendar_label: "Cal.com", name: "Marcus Ives", email: "marcus@quaystone.example", status: "new", booked_at: demoAt(-1, 18, 2) },
];

const demoPast: Appointment[] = [
  { id: "lead_demo_appt_5", lead_id: "lead_demo_appt_5", agent_id: "aria-sales", agent_name: "Aria", session_id: "conv-1", starts_at: demoAt(-3, 15, 0), minutes: 30, timezone: "Europe/London", calendar: "googlecalendar", calendar_label: "Google Calendar", name: "Helena Frost", email: "helena@brightpath.example", status: "converted", booked_at: demoAt(-9, 13, 22) },
  { id: "lead_demo_appt_6", lead_id: "lead_demo_appt_6", agent_id: "aria-sales", agent_name: "Aria", starts_at: demoAt(-8, 9, 30), minutes: 30, timezone: "Europe/London", calendar: "googlecalendar", calendar_label: "Google Calendar", name: "Owen Adeyemi", email: "owen@fieldmark.example", notes: "Asked about the annual plan.", status: "disqualified", booked_at: demoAt(-12, 8, 55) },
];

export function fetchAppointments(scope: AppointmentScope): Promise<AppointmentList> {
  return apiRequest<AppointmentList>(`/appointments?scope=${scope}`, {
    mock: () => ({
      appointments: scope === "past" ? demoPast : scope === "all" ? [...demoUpcoming, ...demoPast] : demoUpcoming,
      upcoming_count: demoUpcoming.length,
      past_count: demoPast.length,
      reflects_changes_made_in_the_calendar: false,
    }),
  });
}

// The agents and the calendar table are one call each, and neither blocks the
// list: they only sharpen the empty state, so losing them costs a less specific
// sentence rather than a screen.
export async function fetchBookingSetup(): Promise<BookingSetup> {
  const [agents, roles] = await Promise.all([
    apiRequest<Array<Record<string, unknown>>>("/agents?page_size=100", {
      mock: () => [
        { id: "aria-sales", name: "Aria", status: "published", booking: { enabled: true, calendar: "googlecalendar", timezone: "Europe/London" } },
        { id: "nova-support", name: "Nova", status: "published", booking: { enabled: true, calendar: "cal", calendar_setting: "428113", timezone: "America/New_York" } },
      ],
    }),
    apiRequest<{ calendars: CalendarOption[] }>("/integrations/roles", {
      mock: () => ({
        calendars: [
          { toolkit: "cal", label: "Cal.com", setting_label: "Event type ID", books_in_chat: true },
          { toolkit: "calendly", label: "Calendly", setting_label: "Event type URL", books_in_chat: false },
          { toolkit: "googlecalendar", label: "Google Calendar", setting_label: "", books_in_chat: true },
          { toolkit: "outlook", label: "Outlook Calendar", setting_label: "", books_in_chat: true },
        ],
      }),
    }),
  ]);

  return {
    agents: agents.map((agent, index) => ({
      id: String(agent.id || `agent-${index}`),
      name: String(agent.name || "Garuda agent"),
      status: String(agent.status || "draft"),
      booking: (agent.booking || {}) as AgentBooking,
    })),
    calendars: Array.isArray(roles.calendars) ? roles.calendars : [],
  };
}
