import Link from "next/link";
import { CalendarClock, CalendarPlus, Settings2, TriangleAlert } from "lucide-react";
import { bookingReadiness, type BookingAgent, type BookingSetup } from "@/components/appointments/appointments-api";
import { Button } from "@/components/ui/button";

// An empty appointments list has four different causes and they are not
// interchangeable. "Nobody has booked yet" told to somebody whose agents cannot
// take a booking at all is a screen that waits forever on their behalf, so the
// agents and the calendar table are read before a word is written.
//
// The builder holds its own step in component state, so no URL points straight
// at Appointments. The link goes to the agent and the sentence names the step,
// which is the truth rather than a query parameter nothing reads.

type EmptyReason =
  | { kind: "unknown" }
  | { kind: "no-agents" }
  | { kind: "booking-off"; agents: BookingAgent[] }
  | { kind: "booking-incomplete"; problems: Array<{ agent: BookingAgent; reason: string }> }
  | { kind: "nothing-booked"; ready: BookingAgent[] };

export function emptyReason(setup: BookingSetup | null): EmptyReason {
  // The setup calls failed. Guessing at a cause here would be inventing one.
  if (!setup) return { kind: "unknown" };
  if (!setup.agents.length) return { kind: "no-agents" };

  const ready: BookingAgent[] = [];
  const problems: Array<{ agent: BookingAgent; reason: string }> = [];
  for (const agent of setup.agents) {
    const readiness = bookingReadiness(agent, setup.calendars);
    if (!readiness) continue;
    if (readiness.state === "ready") ready.push(agent);
    else problems.push({ agent, reason: readiness.reason });
  }

  if (ready.length) return { kind: "nothing-booked", ready };
  if (problems.length) return { kind: "booking-incomplete", problems };
  return { kind: "booking-off", agents: setup.agents };
}

export function AppointmentsEmpty({ setup, scope }: { setup: BookingSetup | null; scope: "upcoming" | "past" }) {
  // Nothing in the past is a fact about the past, not a configuration problem,
  // and offering to switch booking on would be answering a question nobody asked.
  if (scope === "past") {
    return <EmptyShell icon={CalendarClock} title="No appointment has happened yet" body="Once an appointment’s time has passed it moves here, so you can look back at who you saw and read what they said beforehand." />;
  }

  const reason = emptyReason(setup);

  if (reason.kind === "no-agents") {
    return (
      <EmptyShell
        icon={CalendarPlus}
        title="You have no agents yet"
        body="An appointment is booked by an agent during a conversation, so the first step is building one. Switch on Appointments in its builder and visitors can pick a time from your real free hours."
        action={<Button size="sm" asChild><Link href="/app/agents/new">Build your first agent</Link></Button>}
      />
    );
  }

  if (reason.kind === "booking-off") {
    return (
      <EmptyShell
        icon={CalendarPlus}
        title="No agent is taking appointments yet"
        body={`None of your ${reason.agents.length === 1 ? "agents has" : `${reason.agents.length} agents have`} booking switched on, so nothing can be booked. Open an agent, go to the Appointments step, and turn it on to offer visitors your real free times.`}
        action={<AgentLinks agents={reason.agents} />}
      />
    );
  }

  if (reason.kind === "booking-incomplete") {
    return (
      <EmptyShell
        icon={TriangleAlert}
        tone="warning"
        title="Booking is switched on but not finished"
        body="Garuda will not offer a time it cannot honour, so these agents are not showing a booking button to anyone yet. Each one needs one more thing in its Appointments step."
      >
        <ul className="mt-3 space-y-1.5">
          {reason.problems.map(({ agent, reason: detail }) => (
            <li key={agent.id} className="flex flex-wrap items-baseline gap-x-1.5 text-[11px] leading-4 text-amber-900">
              <Link href={`/app/agents/${encodeURIComponent(agent.id)}/edit`} className="font-semibold underline underline-offset-2 hover:text-amber-950">{agent.name}</Link>
              <span className="text-amber-800">cannot take bookings because {detail}.</span>
            </li>
          ))}
        </ul>
      </EmptyShell>
    );
  }

  if (reason.kind === "nothing-booked") {
    return (
      <EmptyShell
        icon={CalendarClock}
        title="Nothing is booked yet"
        body={`${reason.ready.length === 1 ? `${reason.ready[0].name} is` : `${reason.ready.length} of your agents are`} offering appointments, and no visitor has taken one so far. The first booking will appear here the moment it is made, with the conversation that led to it.`}
        action={<Button variant="outline" size="sm" asChild><Link href="/app/widget">Check the widget is installed</Link></Button>}
      />
    );
  }

  return (
    <EmptyShell
      icon={CalendarClock}
      title="Nothing is booked yet"
      body="Your agents could not be checked just now, so this screen cannot tell whether any of them is taking appointments. Reload to try again, or open an agent and look at its Appointments step."
      action={<Button variant="outline" size="sm" asChild><Link href="/app/agents">Open your agents</Link></Button>}
    />
  );
}

// Up to three named agents, because "open an agent" is easier to act on when the
// agent is a link. Past three the list stops being a shortcut and becomes a
// second copy of the agents page.
function AgentLinks({ agents }: { agents: BookingAgent[] }) {
  if (agents.length > 3) return <Button size="sm" asChild><Link href="/app/agents">Open your agents</Link></Button>;
  return (
    <div className="flex flex-wrap gap-2">
      {agents.map((agent) => (
        <Button key={agent.id} size="sm" variant="outline" asChild>
          <Link href={`/app/agents/${encodeURIComponent(agent.id)}/edit`}><Settings2 className="mr-1.5 h-3.5 w-3.5" /> {agent.name}</Link>
        </Button>
      ))}
    </div>
  );
}

function EmptyShell({ icon: Icon, title, body, action, tone, children }: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: React.ReactNode;
  action?: React.ReactNode;
  tone?: "warning";
  children?: React.ReactNode;
}) {
  const warning = tone === "warning";
  return (
    <div className={warning ? "rounded-2xl border border-amber-200 bg-amber-50/70 p-6 sm:p-8" : "rounded-2xl border border-dashed bg-white p-6 sm:p-8"}>
      <div className="mx-auto max-w-lg text-center">
        <span className={warning ? "mx-auto grid h-11 w-11 place-items-center rounded-xl bg-amber-100 text-amber-700" : "mx-auto grid h-11 w-11 place-items-center rounded-xl bg-indigo-50 text-indigo-600"}>
          <Icon className="h-5 w-5" />
        </span>
        <p className={warning ? "mt-3.5 text-sm font-semibold text-amber-950" : "mt-3.5 text-sm font-semibold text-slate-900"}>{title}</p>
        <p className={warning ? "mt-1.5 text-xs leading-5 text-amber-800" : "mt-1.5 text-xs leading-5 text-slate-500"}>{body}</p>
        {children && <div className="text-left">{children}</div>}
        {action && <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div>}
      </div>
    </div>
  );
}
