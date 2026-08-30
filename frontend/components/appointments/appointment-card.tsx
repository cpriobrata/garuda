import Link from "next/link";
import { ArrowUpRight, Bot, CalendarDays, Clock3, Mail, Phone } from "lucide-react";
import type { Appointment } from "@/components/appointments/appointments-api";
import { leadStatusLabel, type AppointmentClock } from "@/components/appointments/format";
import { formatMoment } from "@/components/journey/format";
import { cn } from "@/lib/utils";

// One booking. The four questions it has to answer without being opened are
// when, how long, who, and where it landed -- an owner running Google on one
// agent and Cal.com on another cannot act on a list that does not say which.

export function AppointmentCard({ appointment, clock, dayLabel, past }: {
  appointment: Appointment;
  clock: AppointmentClock;
  // The day this row sits under, repeated for a screen reader: the visible time
  // carries no date because the heading above it does.
  dayLabel: string;
  past?: boolean;
}) {
  const calendar = (appointment.calendar_label || appointment.calendar || "").trim();
  const agentName = (appointment.agent_name || "").trim();
  const status = leadStatusLabel(appointment.status);
  const booked = formatMoment(appointment.booked_at);
  const phoneDigits = (appointment.phone || "").replace(/[^\d+]/g, "");
  const spokenTime = `${clock.start}${clock.end ? ` to ${clock.end}` : ""}${clock.abbreviation ? ` ${clock.abbreviation}` : ""}, ${dayLabel}${clock.length.spoken ? `, ${clock.length.spoken}` : ""}`;

  return (
    <li className={cn("rounded-xl border bg-white p-3.5 shadow-sm transition sm:p-4", past ? "border-slate-200/80" : "hover:border-slate-300")}>
      <div className="flex flex-col gap-3 sm:flex-row sm:gap-5">
        <div className="sm:w-[148px] sm:shrink-0">
          <p className={cn("flex flex-wrap items-baseline gap-x-1.5 text-[15px] font-bold tracking-[-.02em]", past ? "text-slate-500" : "text-slate-950")}>
            <time dateTime={clock.iso} className="tabular-nums">{clock.start}</time>
            {clock.end && <span className="text-[11px] font-semibold tabular-nums text-slate-400">&ndash; {clock.end}</span>}
            <span className="sr-only">{spokenTime}</span>
          </p>
          <p className="mt-0.5 text-[9px] font-medium leading-4 text-slate-500">
            {clock.abbreviation && <span className="tabular-nums">{clock.abbreviation} · </span>}
            <span className="break-words">{clock.zone}</span>
          </p>
          {/* A booking with no zone of its own is being read in the reader's, and
              the same wall-clock hour under two zones is two different meetings. */}
          {!clock.declared && <p className="mt-0.5 text-[9px] leading-4 text-amber-700">No time zone was recorded for this booking, so it is shown in yours.</p>}
          {clock.viewerStart && <p className="mt-0.5 text-[9px] leading-4 text-slate-400"><span className="tabular-nums">{clock.viewerStart}</span> where you are ({clock.viewerZone})</p>}
          {clock.length.short && (
            <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-semibold text-slate-600">
              <Clock3 className="h-2.5 w-2.5" aria-hidden="true" />
              <span aria-hidden="true">{clock.length.short}</span>
              <span className="sr-only">{clock.length.spoken} long</span>
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1 border-t pt-3 sm:border-l sm:border-t-0 sm:pl-5 sm:pt-0">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <p className={cn("min-w-0 break-words text-[13px] font-semibold", past ? "text-slate-600" : "text-slate-900")}>
              {appointment.name?.trim() || "No name was given"}
            </p>
            {status && <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-medium text-slate-500">Lead status · {status}</span>}
          </div>

          <div className="mt-1.5 flex flex-col gap-1">
            {appointment.email
              ? <Contact icon={Mail} href={`mailto:${appointment.email}`} value={appointment.email} />
              : <Contact icon={Mail} value="No email given" muted />}
            {appointment.phone
              ? <Contact icon={Phone} href={phoneDigits ? `tel:${phoneDigits}` : undefined} value={appointment.phone} />
              : <Contact icon={Phone} value="No phone number given" muted />}
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <Chip icon={Bot} label="Booked by" value={agentName || "An agent that has since been removed"} />
            <Chip icon={CalendarDays} label="Written into" value={calendar || "A calendar that was not recorded"} />
          </div>

          {appointment.notes?.trim() && (
            // The visitor's own words, exactly as the booking form took them.
            <p className="mt-2.5 rounded-lg bg-slate-50 p-2 text-[11px] leading-4 text-slate-600">
              <span className="text-slate-400">Their note: </span>{appointment.notes.trim()}
            </p>
          )}

          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            {appointment.session_id ? (
              <Link
                href={`/app/conversations?id=${encodeURIComponent(appointment.session_id)}`}
                className="inline-flex items-center gap-1 text-[10px] font-semibold text-indigo-600 hover:underline"
              >
                Read the conversation <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
                <span className="sr-only">with {appointment.name?.trim() || "this visitor"}</span>
              </Link>
            ) : (
              <span className="text-[10px] text-slate-400">No conversation is linked to this booking.</span>
            )}
            {booked.full && <p className="text-[9px] text-slate-400">Booked <time dateTime={booked.iso}>{booked.full}</time></p>}
          </div>
        </div>
      </div>
    </li>
  );
}

function Contact({ icon: Icon, href, value, muted }: {
  icon: React.ComponentType<{ className?: string }>;
  href?: string;
  value: string;
  muted?: boolean;
}) {
  const body = <><Icon className="h-3 w-3 shrink-0 text-slate-400" aria-hidden="true" /><span className="min-w-0 break-all">{value}</span></>;
  if (!href || muted) return <p className={cn("flex items-start gap-1.5 text-[11px] leading-4", muted ? "text-slate-400" : "text-slate-600")}>{body}</p>;
  return <a href={href} className="flex items-start gap-1.5 text-[11px] leading-4 text-slate-600 hover:text-indigo-600 hover:underline">{body}</a>;
}

function Chip({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-md border bg-slate-50/70 px-1.5 py-0.5 text-[9px] text-slate-600">
      <Icon className="h-2.5 w-2.5 shrink-0 text-slate-400" aria-hidden="true" />
      <span className="text-slate-400">{label}</span>
      <span className="min-w-0 truncate font-semibold">{value}</span>
    </span>
  );
}
