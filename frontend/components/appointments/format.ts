import type { Appointment } from "@/components/appointments/appointments-api";

// An appointment belongs to the hour the visitor and the owner agreed on, which
// is an hour in the AGENT'S time zone -- model.BookingConfig.Timezone, recorded
// on the booking itself. Rendering it in the browser's zone instead would move
// a 9am appointment to 4:30am for an owner reading their phone in another
// country, so every clock here is built against that stored zone and the zone
// is printed beside it.
//
// Durations are formatted here rather than through formatDuration in
// @/components/journey/format: that one buckets anything past an hour as "over
// an hour", which is right for a visit that was measured and wrong for an
// appointment that was chosen -- a 60-minute booking is an hour exactly.

// A stored zone can be absent (an old record) or unusable (a name Intl does not
// know). Intl throws a RangeError on the second, so the only honest test is to
// try it. The answer is cached because the same handful of zones is asked about
// once per row.
const zoneChecks = new Map<string, boolean>();

function zoneWorks(zone: string) {
  const cached = zoneChecks.get(zone);
  if (cached !== undefined) return cached;
  let usable = true;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone }).format(new Date());
  } catch {
    usable = false;
  }
  zoneChecks.set(zone, usable);
  return usable;
}

export function browserZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

// `declared` false means the appointment carried no usable zone of its own and
// is being shown in the reader's, which the UI has to say out loud: the same
// wall-clock time under two different zones is two different appointments.
export function resolveZone(supplied: string | undefined, fallback: string): { zone: string; declared: boolean } {
  const named = (supplied || "").trim();
  if (named && zoneWorks(named)) return { zone: named, declared: true };
  return { zone: zoneWorks(fallback) ? fallback : "UTC", declared: false };
}

function partsIn(at: Date, zone: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en-US", { timeZone: zone, ...options }).formatToParts(at);
}

// A calendar day as seen from one zone, as YYYY-MM-DD. Built from parts rather
// than from a locale that happens to print in that order, because the key is
// compared, never read.
export function dayKeyIn(at: Date, zone: string) {
  const parts = partsIn(at, zone, { year: "numeric", month: "2-digit", day: "2-digit" });
  const pick = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

function clockIn(at: Date, zone: string) {
  return new Intl.DateTimeFormat(undefined, { timeZone: zone, hour: "numeric", minute: "2-digit" }).format(at);
}

function zoneAbbreviationIn(at: Date, zone: string) {
  const parts = partsIn(at, zone, { timeZoneName: "short" });
  return parts.find((part) => part.type === "timeZoneName")?.value || "";
}

export type AppointmentLength = { short: string; spoken: string };

export function appointmentLength(minutes: number | undefined): AppointmentLength {
  const total = Math.round(Number.isFinite(minutes) ? Number(minutes) : 0);
  // The API omits `minutes` when it was never recorded. Nothing is a truer
  // answer than a made-up half hour.
  if (total <= 0) return { short: "", spoken: "" };
  if (total < 60) return { short: `${total} min`, spoken: `${total} minute${total === 1 ? "" : "s"}` };
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  const hourWords = `${hours} hour${hours === 1 ? "" : "s"}`;
  if (!rest) return { short: `${hours} hr`, spoken: hourWords };
  return { short: `${hours} hr ${rest} min`, spoken: `${hourWords} ${rest} minute${rest === 1 ? "" : "s"}` };
}

export type AppointmentClock = {
  at: Date;
  iso: string;
  zone: string;
  declared: boolean;
  dayKey: string;
  start: string;
  // Empty when the length was never recorded, so the row shows a start time
  // rather than a range it cannot support.
  end: string;
  abbreviation: string;
  length: AppointmentLength;
  // The same moment in the reader's own zone, and only when that reads
  // differently. An owner in Berlin looking at a New York appointment needs it;
  // an owner in the agent's own zone would only be shown the same time twice.
  viewerStart: string;
  viewerZone: string;
};

export function appointmentClock(appointment: Appointment, viewer: string): AppointmentClock | null {
  const at = new Date(appointment.starts_at);
  // Go marshals an unset time.Time as year 1. The API skips those rows before
  // they reach us, but a row that arrives unreadable is dropped rather than
  // painted at the epoch.
  if (Number.isNaN(at.getTime()) || at.getFullYear() < 2000) return null;

  const { zone, declared } = resolveZone(appointment.timezone, viewer);
  const length = appointmentLength(appointment.minutes);
  const start = clockIn(at, zone);
  const finish = appointment.minutes && appointment.minutes > 0 ? new Date(at.getTime() + appointment.minutes * 60000) : null;
  const viewerStart = clockIn(at, viewer);
  const sameClock = !declared || (viewer === zone) || (viewerStart === start && zoneAbbreviationIn(at, viewer) === zoneAbbreviationIn(at, zone));

  return {
    at,
    iso: at.toISOString(),
    zone,
    declared,
    dayKey: dayKeyIn(at, zone),
    start,
    end: finish ? clockIn(finish, zone) : "",
    abbreviation: zoneAbbreviationIn(at, zone),
    length,
    viewerStart: sameClock ? "" : viewerStart,
    viewerZone: sameClock ? "" : viewer,
  };
}

export type AppointmentDay = {
  key: string;
  // "Today", "Tomorrow" or "" -- said in front of the date rather than instead
  // of it, because somebody scanning a list still wants the date.
  relative: string;
  heading: string;
  entries: Array<{ appointment: Appointment; clock: AppointmentClock }>;
};

function headingFor(at: Date, zone: string, now: Date) {
  const thisYear = dayKeyIn(now, zone).slice(0, 4) === dayKeyIn(at, zone).slice(0, 4);
  return new Intl.DateTimeFormat(undefined, {
    timeZone: zone, weekday: "long", day: "numeric", month: "long",
    ...(thisYear ? {} : { year: "numeric" }),
  }).format(at);
}

const oneDay = 86400000;

// Grouped by the day the appointment falls on IN ITS OWN ZONE, keeping the
// order the API sent -- soonest first for what is coming, most recent first for
// what has been. Re-sorting here would quietly contradict a decision the server
// already made and documented.
export function groupByDay(appointments: Appointment[], viewer: string, now: Date): AppointmentDay[] {
  const days: AppointmentDay[] = [];
  const index = new Map<string, AppointmentDay>();

  for (const appointment of appointments) {
    const clock = appointmentClock(appointment, viewer);
    if (!clock) continue;
    const existing = index.get(clock.dayKey);
    if (existing) {
      existing.entries.push({ appointment, clock });
      continue;
    }
    // The heading is written in the zone of the first appointment of that day,
    // which is the only zone the day boundary was measured against.
    const relative = clock.dayKey === dayKeyIn(now, clock.zone) ? "Today"
      : clock.dayKey === dayKeyIn(new Date(now.getTime() + oneDay), clock.zone) ? "Tomorrow"
        : clock.dayKey === dayKeyIn(new Date(now.getTime() - oneDay), clock.zone) ? "Yesterday" : "";
    const day: AppointmentDay = { key: clock.dayKey, relative, heading: headingFor(clock.at, clock.zone, now), entries: [{ appointment, clock }] };
    index.set(clock.dayKey, day);
    days.push(day);
  }

  return days;
}

// The owner's own follow-up marker, which travels on the lead this appointment
// was recorded as. It says nothing about whether the appointment still stands,
// so the UI labels it as the lead's status and never as the booking's.
const leadStatusNames: Record<string, string> = {
  new: "New",
  qualified: "Qualified",
  contacted: "Contacted",
  converted: "Customer",
  disqualified: "Disqualified",
};

export function leadStatusLabel(status: string) {
  return leadStatusNames[(status || "").trim().toLowerCase()] || "";
}
