"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, Clock, Compass, MessageSquareText, MonitorSmartphone, RefreshCw, Sigma, Signpost, Target, UsersRound } from "lucide-react";
import { channelLabel, deviceLabel, formatDuration } from "@/components/journey/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiError, apiRequest, type VisitorJourney } from "@/lib/api";
import { useBusyAction } from "@/lib/busy-action";

// What one agent's own conversations and leads actually say, and nothing else.
//
// THE CONSTRAINT THAT SHAPES EVERY NUMBER HERE: a visitor journey is optional. A
// session recorded before tracking existed has none, and neither does a visitor
// whose browser refused the reporting. So a breakdown by channel or landing page
// is computed from a SUBSET of the conversations, and presenting that subset as
// the whole would be an invented number. Every share therefore carries the count
// it was computed from, and a sample too small to read is refused rather than
// drawn.

// Under this many tracked visits a ranked list is noise wearing a chart's
// clothes: one more visitor moves a bar by twenty points.
const journeySampleFloor = 5;

// The conversation fields this card counts. Deliberately narrower than the API
// summary: nothing here displays a conversation, it only tallies them.
type AnalyticsConversation = { message_count?: number; journey?: VisitorJourney | null };

export type RankedSlice = { label: string; count: number };

export type AgentAnalytics = {
  // The headline counts come from the paginated response's meta, so they are the
  // true totals even though only the first page is read for the breakdowns.
  conversations: number;
  leads: number;
  // How many conversations the breakdowns below were actually computed over.
  sample: number;
  averageMessages: number | null;
  journeys: number;
  channels: RankedSlice[];
  devices: RankedSlice[];
  landings: RankedSlice[];
  landingSample: number;
  engagedSample: number;
  averageEngagedSeconds: number | null;
};

function bump(counts: Map<string, number>, label: string) {
  counts.set(label, (counts.get(label) || 0) + 1);
}

function rank(counts: Map<string, number>): RankedSlice[] {
  return [...counts].map(([label, count]) => ({ label, count })).sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}

export function summarizeAgentAnalytics(items: AnalyticsConversation[], conversationTotal: number, leadTotal: number): AgentAnalytics {
  const channels = new Map<string, number>();
  const devices = new Map<string, number>();
  const landings = new Map<string, number>();
  let messages = 0;
  let journeys = 0;
  let landingSample = 0;
  let engagedSample = 0;
  let engagedSeconds = 0;

  for (const item of items) {
    messages += Math.max(0, item.message_count || 0);
    const journey = item.journey;
    if (!journey) continue;
    journeys += 1;
    // channelLabel and deviceLabel both name the missing case -- "Unrecorded",
    // "Unknown" -- instead of dropping it, so every tracked visit lands in a
    // bucket and the bars add back up to the sample they were counted from.
    bump(channels, channelLabel(journey.source?.channel || ""));
    bump(devices, deviceLabel(journey.device || {}));
    const landing = journey.source?.landing_path?.trim();
    if (landing) {
      bump(landings, landing);
      landingSample += 1;
    }
    // Engaged time is a measurement only where a page was actually reported. A
    // journey holding nothing but a source would otherwise contribute a zero
    // that reads as "stayed no time" rather than "was never timed".
    if ((journey.page_count || 0) > 0) {
      engagedSample += 1;
      engagedSeconds += Math.max(0, journey.engaged_seconds || 0);
    }
  }

  return {
    conversations: Math.max(conversationTotal, items.length),
    leads: Math.max(leadTotal, 0),
    sample: items.length,
    averageMessages: items.length ? messages / items.length : null,
    journeys,
    channels: rank(channels),
    devices: rank(devices),
    landings: rank(landings),
    landingSample,
    engagedSample,
    averageEngagedSeconds: engagedSample ? engagedSeconds / engagedSample : null,
  };
}

function totalFrom(meta: unknown, fallback: number) {
  const total = (meta as { total?: unknown } | undefined)?.total;
  return typeof total === "number" && Number.isFinite(total) && total >= 0 ? total : fallback;
}

export async function fetchAgentAnalytics(agentId: string): Promise<AgentAnalytics> {
  // The API caps page_size at 100 and returns both lists newest first, so the
  // breakdowns describe the most recent hundred conversations while the headline
  // counts come from meta.total. Which of the two a number came from is stated on
  // the card rather than left for the reader to guess.
  const query = `agent_id=${encodeURIComponent(agentId)}&page_size=100`;
  let conversationMeta: unknown;
  let leadMeta: unknown;
  const [items, leads] = await Promise.all([
    apiRequest<AnalyticsConversation[]>(`/conversations?${query}`, { onMeta: (meta) => { conversationMeta = meta; } }),
    apiRequest<unknown[]>(`/leads?${query}`, { onMeta: (meta) => { leadMeta = meta; } }),
  ]);
  const conversations = items || [];
  return summarizeAgentAnalytics(conversations, totalFrom(conversationMeta, conversations.length), totalFrom(leadMeta, (leads || []).length));
}

// An agent with nothing to measure gets the step that would produce something,
// and which step that is depends on why it is collecting nothing: a draft is not
// serving at all, while a published agent is only waiting on the snippet.
function nextStep(agentId: string, status?: string) {
  if (status === "published" || status === "live") return { note: "This agent is live and ready. Add the widget snippet to your site and the first conversation will show up here.", href: "/app/widget", label: "Install the widget" };
  if (status === "paused") return { note: "This agent is paused, so the widget is not serving it. Resume it above to start collecting conversations again.", href: "/app/widget", label: "Widget install guide" };
  return { note: "This agent has not been published yet, so nothing is serving it. Publish it from the editor, then install the widget on your site.", href: `/app/agents/${encodeURIComponent(agentId)}/edit`, label: "Open the editor" };
}

export function AgentAnalytics({ agentId, status }: { agentId: string; status?: string }) {
  const [data, setData] = useState<AgentAnalytics | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const { busy, run } = useBusyAction();

  useEffect(() => {
    let active = true;
    void run(async () => {
      try {
        const next = await fetchAgentAnalytics(agentId);
        if (!active) return;
        setData(next);
        setError("");
      } catch (reason) {
        if (active) setError(reason instanceof ApiError ? reason.message : "Agent analytics could not be read.");
      }
    });
    return () => { active = false; };
  }, [agentId, attempt, run]);

  const engaged = data && data.averageEngagedSeconds !== null ? formatDuration(data.averageEngagedSeconds) : null;
  const step = nextStep(agentId, status);

  return <Card className="border-slate-200/80 shadow-none">
    <CardHeader className="gap-3 space-y-0 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0"><CardTitle className="text-sm">Agent performance</CardTitle><p className="mt-1.5 text-xs text-slate-500">Counted from this agent&rsquo;s stored conversations and leads. Nothing on this card is estimated.</p></div>
      <Button variant="ghost" size="sm" className="-ml-3 self-start text-slate-500 sm:ml-0 sm:shrink-0" onClick={() => setAttempt((value) => value + 1)} loading={busy} loadingLabel="Reading this agent&rsquo;s conversations"><RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Refresh</Button>
    </CardHeader>
    <CardContent className="space-y-5">
      {error && <p className="flex items-start gap-1.5 rounded-lg bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-700"><AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /> {error}</p>}

      {!data ? <p className="text-xs text-slate-500">{error ? "Nothing has been read yet. Refresh once the API answers." : "Reading this agent’s conversations and leads…"}</p>
        : data.conversations === 0 ? <div className="rounded-xl border border-dashed border-slate-200 p-5 text-center">
            <p className="text-sm font-semibold text-slate-800">No conversations yet</p>
            <p className="mx-auto mt-2 max-w-md text-xs leading-5 text-slate-500">{step.note}</p>
            <Button variant="outline" size="sm" className="mt-4" asChild><Link href={step.href}>{step.label}</Link></Button>
          </div>
        : <>
          <dl className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            <Stat icon={MessageSquareText} label="Conversations" value={data.conversations.toLocaleString()} note={data.conversations > data.sample ? `All time. The breakdowns below read the latest ${data.sample}.` : "All time"} />
            <Stat icon={UsersRound} label="Leads captured" value={data.leads.toLocaleString()} note="Leads the API attributes to this agent" />
            <Stat icon={Target} label="Conversion" value={`${((data.leads / data.conversations) * 100).toFixed(1)}%`} note={`${data.leads.toLocaleString()} of ${data.conversations.toLocaleString()} conversations left a lead`} />
            <Stat icon={Sigma} label="Messages each" value={data.averageMessages === null ? "Not counted" : data.averageMessages.toFixed(1)} note={`Average across ${data.sample.toLocaleString()} conversation${data.sample === 1 ? "" : "s"}`} />
            <Stat icon={Clock} label="Engaged time" value={engaged ? engaged.short : "Not recorded"} spoken={engaged?.spoken} note={data.engagedSample ? `Average across ${data.engagedSample} of ${data.sample} conversations with pages recorded` : "No conversation here recorded a page view"} />
          </dl>

          {data.journeys < journeySampleFloor ? <p className="rounded-xl border border-dashed border-slate-200 px-3.5 py-3 text-[11px] leading-5 text-slate-500">
              {data.journeys === 0
                ? "None of these conversations carry visit data, so there is nothing to break down. A visit is recorded only from the moment the widget loads its tracking: conversations from before that, and visitors whose browser blocked it, have none."
                : `Only ${data.journeys} of the ${data.sample} conversations read here carry visit data. That is too small a sample to rank channels or landing pages from, so the breakdowns stay hidden until more visits are recorded.`}
            </p>
            : <div className="space-y-5">
              {/* The denominator is stated once, in words, ahead of any bar: every
                  share underneath is a share of the tracked visits, never of this
                  agent's conversations as a whole. */}
              <p className="text-[11px] leading-5 text-slate-500">Every share below is computed across the {data.journeys} of {data.sample} conversations that carry visit data{data.conversations > data.sample ? `, themselves the latest of ${data.conversations.toLocaleString()}` : ""}.</p>
              <RankedList icon={Compass} title="Where these visitors came from" note={`${data.journeys} tracked visits`} items={data.channels} total={data.journeys} />
              {data.landingSample >= journeySampleFloor
                ? <RankedList icon={Signpost} title="Pages they landed on first" note={`${data.landingSample} visits recorded a landing page`} items={data.landings} total={data.landingSample} limit={5} />
                : <p className="text-[11px] leading-5 text-slate-500">A landing page was recorded on only {data.landingSample} of these visits, which is too few to rank.</p>}
              <RankedList icon={MonitorSmartphone} title="Device" note={`${data.journeys} tracked visits`} items={data.devices} total={data.journeys} />
            </div>}
        </>}
    </CardContent>
  </Card>;
}

// A share that rounds to a flat 100% while its bar is not the whole sample would
// read as "all of them", so it stops one point short of the lie.
export function sharePercent(count: number, total: number) {
  if (total <= 0) return "0%";
  const share = (count / total) * 100;
  if (share > 0 && share < 1) return "<1%";
  const rounded = Math.round(share);
  return `${rounded === 100 && count < total ? 99 : rounded}%`;
}

function Stat({ icon: Icon, label, value, note, spoken }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; note: string; spoken?: string }) {
  return <div className="min-w-0 rounded-xl border border-slate-200/70 bg-slate-50/70 p-3">
    <dt className="flex items-center gap-1.5 text-[10px] font-medium text-slate-500"><Icon className="h-3 w-3 shrink-0" aria-hidden="true" /> <span className="min-w-0 break-words">{label}</span></dt>
    <dd className="mt-1.5 text-lg font-bold leading-tight tracking-[-.02em] text-slate-950">{spoken ? <><span aria-hidden="true">{value}</span><span className="sr-only">{spoken}</span></> : value}</dd>
    <dd className="mt-1 text-[10px] leading-4 text-slate-500">{note}</dd>
  </div>;
}

function RankedList({ icon: Icon, title, note, items, total, limit = 6 }: { icon: React.ComponentType<{ className?: string }>; title: string; note: string; items: RankedSlice[]; total: number; limit?: number }) {
  const shown = items.slice(0, limit);
  if (!shown.length) return null;
  return <section className="min-w-0">
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <h4 className="flex items-center gap-1.5 text-xs font-semibold text-slate-800"><Icon className="h-3.5 w-3.5 text-indigo-500" aria-hidden="true" /> {title}</h4>
      <p className="text-[10px] text-slate-400">{note}</p>
    </div>
    <ol className="mt-2.5 space-y-2">
      {shown.map((slice) => <li key={slice.label} className="min-w-0">
        <div className="flex items-baseline justify-between gap-3">
          <span className="min-w-0 break-words text-xs font-medium text-slate-700">{slice.label}</span>
          {/* The percentage is text, not a bar width, so it survives a screen
              reader, a copy-paste and a print. */}
          <span className="shrink-0 text-[10px] tabular-nums text-slate-500">{sharePercent(slice.count, total)} · {slice.count.toLocaleString()}</span>
        </div>
        <div className="mt-1 h-1.5 w-full rounded-full bg-slate-100" aria-hidden="true"><div className="h-full rounded-full bg-indigo-500" style={{ width: `${Math.max(2, Math.min(100, total > 0 ? (slice.count / total) * 100 : 0))}%` }} /></div>
      </li>)}
    </ol>
    {items.length > shown.length && <p className="mt-2 text-[10px] text-slate-400">Top {shown.length} of {items.length.toLocaleString()}.</p>}
  </section>;
}
