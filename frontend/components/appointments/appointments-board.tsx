"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarClock, History, Info, RefreshCw, TriangleAlert } from "lucide-react";
import { AppointmentCard } from "@/components/appointments/appointment-card";
import { AppointmentsEmpty } from "@/components/appointments/appointments-empty";
import {
  bookingReadiness,
  fetchAppointments,
  fetchBookingSetup,
  type Appointment,
  type AppointmentList,
  type BookingSetup,
} from "@/components/appointments/appointments-api";
import { browserZone, groupByDay, type AppointmentDay } from "@/components/appointments/format";
import { Badge } from "@/components/ui/badge";
import { Button, Spinner } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { useBusyAction } from "@/lib/busy-action";

// What Garuda has booked, soonest first.
//
// The list is fetched one scope at a time rather than as scope=all. The API
// returns upcoming and past concatenated in that order and reports the counts,
// so the split could be inferred from an index -- but that turns a documented
// ordering into a load-bearing one, and asking for the scope the screen is
// showing costs one request nobody makes until they open the past.

// A request that outruns its timeout rejects with a DOMException, never an
// ApiError, so it has to be recognised separately or it reaches the screen as
// "signal is aborted without reason".
function messageOf(reason: unknown, fallback: string) {
  if (reason instanceof Error && reason.name === "AbortError") {
    return "That took longer than this page was willing to wait. Check your connection and try again.";
  }
  return reason instanceof ApiError && reason.message ? reason.message : fallback;
}

export function AppointmentsBoard() {
  const [upcoming, setUpcoming] = useState<AppointmentList | null>(null);
  const [error, setError] = useState("");
  const [past, setPast] = useState<Appointment[] | null>(null);
  const [pastError, setPastError] = useState("");
  const [showPast, setShowPast] = useState(false);
  const [setup, setSetup] = useState<BookingSetup | null>(null);
  // Both are read after mount. Resolving the browser's zone or the current time
  // during render would make the server's HTML disagree with the browser's.
  const [viewer, setViewer] = useState("");
  const [now, setNow] = useState<Date | null>(null);
  const refresh = useBusyAction();
  const openPast = useBusyAction();
  // Read by a refresh to decide whether the past list is on screen and therefore
  // worth reloading. State would be the value captured when `load` was created.
  const pastOpen = useRef(false);
  pastOpen.current = showPast;

  const loadPast = useCallback(async () => {
    try {
      const list = await fetchAppointments("past");
      setPast(list.appointments);
      setPastError("");
    } catch (reason) {
      setPastError(messageOf(reason, "Your past appointments could not be loaded."));
    }
  }, []);

  const load = useCallback(async () => {
    setNow(new Date());
    setViewer(browserZone());
    // Neither secondary call may take the list down with it: the agents and the
    // calendar table only sharpen the empty state.
    const [list, booking] = await Promise.allSettled([fetchAppointments("upcoming"), fetchBookingSetup()]);
    if (list.status === "fulfilled") {
      setUpcoming(list.value);
      setError("");
    } else {
      setError(messageOf(list.reason, "Your appointments could not be loaded."));
    }
    setSetup(booking.status === "fulfilled" ? booking.value : null);
    if (pastOpen.current) await loadPast();
  }, [loadPast]);

  useEffect(() => {
    load().catch(() => setError("Your appointments could not be loaded."));
  }, [load]);

  const upcomingDays = useMemo(
    () => (now && upcoming ? groupByDay(upcoming.appointments, viewer || browserZone(), now) : []),
    [now, upcoming, viewer],
  );
  const pastDays = useMemo(
    () => (now && past ? groupByDay(past, viewer || browserZone(), now) : []),
    [now, past, viewer],
  );

  // An agent whose calendar finishes the booking on its own page books nothing
  // Garuda can record, so those appointments never reach this list. Saying it
  // beats an owner concluding the page is broken. `books_in_chat` comes from
  // GET /v1/integrations/roles rather than from a slug written down here.
  const elsewhere = useMemo(() => {
    if (!setup) return [];
    return setup.agents.flatMap((agent) => {
      const readiness = bookingReadiness(agent, setup.calendars, setup.connectedToolkits);
      if (readiness?.state !== "ready" || !readiness.calendar || readiness.calendar.books_in_chat) return [];
      return [{ agent: agent.name, calendar: readiness.calendar.label }];
    });
  }, [setup]);

  const loading = !upcoming && !error;
  const pastCount = upcoming?.past_count ?? 0;

  return (
    <div className="space-y-5">
      <Notices unmirrored={!upcoming || !upcoming.reflects_changes_made_in_the_calendar} elsewhere={elsewhere} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold tracking-[-.01em] text-slate-900">Coming up</h2>
          {upcoming && <Badge variant="secondary" className="text-[9px]">{upcoming.upcoming_count} {upcoming.upcoming_count === 1 ? "appointment" : "appointments"}</Badge>}
        </div>
        <Button
          variant="outline"
          size="sm"
          loading={refresh.busy}
          loadingLabel="Refreshing your appointments"
          onClick={() => refresh.run(() => load().catch(() => setError("Your appointments could not be loaded.")))}
        >
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Refresh
        </Button>
      </div>

      {loading && (
        <div role="status" aria-busy="true" className="rounded-2xl border bg-white p-10 text-center">
          <Spinner className="mx-auto h-6 w-6 text-slate-300" />
          <p className="mt-3 text-xs font-semibold text-slate-700">Loading your appointments…</p>
          <p className="mt-1 text-[10px] text-slate-400">Reading everything Garuda has booked for this workspace.</p>
        </div>
      )}

      {error && (
        <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-5">
          <p className="flex items-start gap-2 text-xs font-semibold text-red-800"><TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" /> Your appointments could not be loaded</p>
          <p className="mt-1.5 pl-[22px] text-[11px] leading-4 text-red-700">{error}</p>
          <div className="mt-3 pl-[22px]">
            <Button
              variant="outline"
              size="sm"
              className="border-red-200 bg-white"
              loading={refresh.busy}
              loadingLabel="Trying again"
              onClick={() => refresh.run(() => load().catch(() => setError("Your appointments could not be loaded.")))}
            >
              Try again
            </Button>
          </div>
        </div>
      )}

      {!loading && !error && (upcomingDays.length ? <DayList days={upcomingDays} /> : <AppointmentsEmpty setup={setup} scope="upcoming" />)}

      {!error && (
        <section className="border-t pt-5" aria-labelledby="past-appointments">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="past-appointments" className="text-sm font-semibold tracking-[-.01em] text-slate-900">Already happened</h2>
              {upcoming && <Badge variant="secondary" className="text-[9px]">{pastCount} {pastCount === 1 ? "appointment" : "appointments"}</Badge>}
            </div>
            <Button
              variant="ghost"
              size="sm"
              aria-expanded={showPast}
              aria-controls="past-appointment-list"
              loading={openPast.busy}
              loadingLabel="Loading your past appointments"
              onClick={() => {
                if (showPast) { setShowPast(false); return; }
                if (past) { setShowPast(true); return; }
                openPast.run(async () => { await loadPast(); setShowPast(true); });
              }}
            >
              <History className="mr-1.5 h-3.5 w-3.5" /> {showPast ? "Hide past appointments" : "Show past appointments"}
            </Button>
          </div>

          <div id="past-appointment-list" hidden={!showPast}>
            {pastError && (
              <div role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3">
                <p className="text-[11px] leading-4 text-red-700">{pastError}</p>
                <Button variant="outline" size="sm" className="mt-2 border-red-200 bg-white" loading={openPast.busy} loadingLabel="Trying again" onClick={() => openPast.run(loadPast)}>Try again</Button>
              </div>
            )}
            {!pastError && (pastDays.length ? <div className="mt-4"><DayList days={pastDays} past /></div> : <div className="mt-4"><AppointmentsEmpty setup={setup} scope="past" /></div>)}
          </div>
        </section>
      )}
    </div>
  );
}

function DayList({ days, past }: { days: AppointmentDay[]; past?: boolean }) {
  return (
    <div className="space-y-6">
      {days.map((day) => (
        <section key={day.key} aria-label={`${day.relative ? `${day.relative}, ` : ""}${day.heading}`}>
          <div className="flex items-center gap-3">
            <h3 className="text-[11px] font-bold uppercase tracking-[.1em] text-slate-500">
              {day.relative && <span className={past ? "text-slate-400" : "text-indigo-600"}>{day.relative} · </span>}
              {day.heading}
            </h3>
            <span className="h-px flex-1 bg-slate-200" aria-hidden="true" />
            <span className="shrink-0 text-[10px] font-medium text-slate-400">{day.entries.length}</span>
          </div>
          <ol className="mt-2.5 space-y-2">
            {day.entries.map(({ appointment, clock }) => (
              <AppointmentCard key={appointment.id} appointment={appointment} clock={clock} dayLabel={day.heading} past={past} />
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

// The one thing this screen must never let somebody assume. It sits above the
// list rather than under it, and it is driven by the payload's own flag so it
// cannot outlive the limitation it describes.
function Notices({ unmirrored, elsewhere }: { unmirrored: boolean; elsewhere: Array<{ agent: string; calendar: string }> }) {
  if (!unmirrored && !elsewhere.length) return null;
  return (
    <div className="space-y-2">
      {unmirrored && (
        <p className="flex items-start gap-2 rounded-xl border border-slate-200 bg-white p-3 text-[11px] leading-5 text-slate-600">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
          <span>
            <span className="font-semibold text-slate-900">This is what Garuda booked, not a copy of your calendar.</span>{" "}
            If an appointment was moved or cancelled inside your own calendar, nothing tells Garuda, so it still appears here exactly as it was booked. Your calendar stays the last word on what is really in it.
          </span>
        </p>
      )}
      {elsewhere.length > 0 && (
        <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] leading-5 text-amber-900">
          <CalendarClock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden="true" />
          <span>
            {elsewhere.map((entry) => `${entry.agent} books through ${entry.calendar}`).join("; ")}
            {elsewhere.length === 1 ? ", which completes the booking on its own page." : ", each of which completes the booking on its own page."}{" "}
            Garuda never sees those confirmations, so appointments taken that way will not appear in this list.
          </span>
        </p>
      )}
    </div>
  );
}
