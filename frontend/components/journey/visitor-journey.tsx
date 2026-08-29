import { Clock, Eye, FileText, Globe2, Layers, Mail, MapPin, Megaphone, MessageSquare, MousePointerClick, Search, Share2, Smartphone } from "lucide-react";
import { campaignTags, channelLabel, deviceLabel, describeArrival, formatDuration, formatMoment } from "@/components/journey/format";
import { Badge } from "@/components/ui/badge";
import type { VisitorJourney as JourneyData } from "@/lib/api";
import { cn } from "@/lib/utils";

// The visitor journey: arrival, every page read, and the conversation, as one
// vertical timeline. It is a list and is marked up as one — an <ol>, because the
// order is the whole story — inside its own scroll container so a fifty-page
// visit never pushes a dialog past the viewport.

const channelIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  paid: Megaphone,
  organic: Search,
  social: Share2,
  email: Mail,
  referral: Globe2,
  campaign: Megaphone,
  direct: MousePointerClick,
};

export function VisitorJourney({ journey, startedAt, absentNote, className }: {
  journey?: JourneyData | null;
  // The conversation's own created_at, so the final event is the moment the
  // visitor actually spoke rather than the last page report.
  startedAt?: string;
  absentNote?: string;
  className?: string;
}) {
  if (!journey) return <JourneyAbsent note={absentNote} className={className} />;

  const { source, device, pages } = journey;
  const ArrivalIcon = channelIcons[source.channel] || Globe2;
  const arrivedAt = formatMoment(journey.first_seen_at);
  const spoke = formatMoment(startedAt || journey.last_seen_at);
  const engaged = formatDuration(journey.engaged_seconds);
  const tags = campaignTags(source);
  const region = device.region?.trim();
  // The API sets region_is_approximate whenever it emits a region, because a
  // region is only ever read from the time zone. Either signal is enough to
  // label it: presenting a place as confirmed is the one mistake to rule out.
  const approximateRegion = Boolean(region) || journey.region_is_approximate;

  return (
    <section className={cn("min-w-0", className)} aria-label="Visitor journey">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[10px] font-bold uppercase tracking-[.13em] text-slate-400">Visitor journey</p>
        <Badge variant="secondary" className="text-[9px]">{channelLabel(source.channel)}</Badge>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-2">
        <Stat icon={Eye} label="Pages viewed" value={journey.page_count.toLocaleString()} />
        <Stat icon={Clock} label="Engaged time" value={engaged.short} spoken={engaged.spoken} />
        <Stat icon={Smartphone} label="Device" value={deviceLabel(device)} note={[device.language, device.timezone].filter(Boolean).join(" · ")} />
        <Stat icon={MapPin} label="Region" value={region || "Unknown"} note={approximateRegion ? "Approximate" : ""} tip={approximateRegion ? "Approximate — read from the visitor’s time zone, not from a location lookup" : undefined} />
      </dl>

      {region && approximateRegion && (
        // Said in words on the page, not only in a tooltip: this number is never
        // a confirmed location, and a reader who never hovers must still know it.
        <p className="mt-2 text-[9px] leading-4 text-slate-400">
          {region} is approximate — it is read from the browser&rsquo;s time zone{device.timezone ? ` (${device.timezone})` : ""}, not from a location lookup.
        </p>
      )}

      {/* Scrollable, and focusable so the scroll is reachable without a pointer. */}
      <div
        tabIndex={0}
        role="group"
        aria-label="Visit timeline"
        className="mt-3 max-h-72 overflow-y-auto rounded-xl border bg-white p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25 sm:max-h-80"
      >
        <ol className="min-w-0">
          <Event icon={ArrivalIcon} tone="arrival" title={describeArrival(source)} time={arrivedAt}>
            {source.landing_path && <Path path={source.landing_path} prefix="Landed on" />}
            {tags.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-1">
                {tags.map((tag) => (
                  <li key={tag.label} className="max-w-full rounded-md bg-slate-100 px-1.5 py-0.5 text-[9px] text-slate-600">
                    <span className="text-slate-400">{tag.label}</span> <span className="break-all font-medium">{tag.value}</span>
                  </li>
                ))}
              </ul>
            )}
          </Event>

          {journey.pages_truncated && (
            // The count above and the list below disagree on purpose; saying why
            // beats quietly showing a total that the visible pages cannot add up to.
            <Event icon={Layers} tone="muted" title="Earlier pages are no longer kept">
              <p className="mt-0.5 text-[10px] leading-4 text-slate-500">
                Showing the {pages.length} most recent of {journey.page_count.toLocaleString()} pages. The oldest were dropped as the visit grew.
              </p>
            </Event>
          )}

          {pages.map((page, index) => {
            const onPage = formatDuration(page.seconds);
            const at = formatMoment(page.arrived_at);
            return (
              <Event
                key={`${page.path}-${page.arrived_at}-${index}`}
                icon={FileText}
                tone="page"
                title={page.title || page.path}
                time={at}
                aside={<span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold tabular-nums text-slate-600"><span aria-hidden="true">{onPage.short}</span><span className="sr-only">{onPage.spoken} on this page</span></span>}
              >
                {page.title ? <Path path={page.path} /> : null}
              </Event>
            );
          })}

          <Event icon={MessageSquare} tone="chat" title="Opened the chat and started talking" time={spoke} last>
            <p className="mt-0.5 text-[10px] leading-4 text-slate-500">Everything above happened before this conversation began.</p>
          </Event>
        </ol>
      </div>
    </section>
  );
}

// A visit with nothing recorded is ordinary — an old session, or a browser that
// blocked the widget's reports — so it reads as an explanation, not a failure.
export function JourneyAbsent({ note, className }: { note?: string; className?: string }) {
  return (
    <section className={cn("rounded-xl border border-dashed bg-slate-50/70 p-4", className)} aria-label="Visitor journey">
      <p className="text-xs font-semibold text-slate-800">No visit was recorded</p>
      <p className="mt-1 text-[10px] leading-4 text-slate-500">
        {note || "This conversation started before visit tracking existed, or the visitor’s browser did not report it. The transcript itself is unaffected."}
      </p>
    </section>
  );
}

function Stat({ icon: Icon, label, value, spoken, note, tip }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  // The value written out for a screen reader, where the abbreviated one reads
  // as letters.
  spoken?: string;
  note?: string;
  tip?: string;
}) {
  return (
    <div className="min-w-0 rounded-xl border bg-slate-50/60 p-2.5" title={tip || undefined}>
      <dt className="flex items-center gap-1.5 text-[9px] text-slate-400"><Icon className="h-3 w-3 shrink-0" /> <span className="truncate">{label}</span></dt>
      <dd className="mt-1 break-words text-[11px] font-semibold text-slate-800">
        {spoken ? <><span aria-hidden="true">{value}</span><span className="sr-only">{spoken}</span></> : value}
        {note && <span className="mt-0.5 block break-words text-[9px] font-normal leading-4 text-slate-400">{note}</span>}
      </dd>
    </div>
  );
}

function Event({ icon: Icon, tone, title, time, aside, children, last }: {
  icon: React.ComponentType<{ className?: string }>;
  tone: "arrival" | "page" | "chat" | "muted";
  title: string;
  time?: { short: string; full: string; iso: string };
  aside?: React.ReactNode;
  children?: React.ReactNode;
  last?: boolean;
}) {
  return (
    // The rail is an ::after on the row rather than a separate element, so the
    // last event never trails a line into empty space.
    <li className={cn(
      "relative flex min-w-0 gap-3 pb-4 last:pb-0",
      !last && "after:absolute after:bottom-1 after:left-[11px] after:top-7 after:w-px after:bg-slate-200 after:content-['']",
    )}>
      <span aria-hidden="true" className={cn(
        "relative z-[1] grid h-6 w-6 shrink-0 place-items-center rounded-full border",
        tone === "arrival" ? "border-indigo-200 bg-indigo-50 text-indigo-600"
          : tone === "chat" ? "border-violet-200 bg-violet-50 text-violet-600"
            : tone === "muted" ? "border-dashed border-slate-200 bg-white text-slate-300"
              : "border-slate-200 bg-white text-slate-400",
      )}>
        <Icon className="h-3 w-3" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-start gap-2">
          <p className={cn("min-w-0 flex-1 break-words text-[11px] font-semibold leading-4", tone === "muted" ? "text-slate-500" : "text-slate-900")}>{title}</p>
          {aside}
        </div>
        {time?.short && <p className="mt-0.5 text-[9px] text-slate-400"><time dateTime={time.iso}>{time.short}</time><span className="sr-only"> — {time.full}</span></p>}
        {children}
      </div>
    </li>
  );
}

function Path({ path, prefix }: { path: string; prefix?: string }) {
  return (
    <p className="mt-0.5 break-words font-mono text-[9px] leading-4 text-slate-500">
      {prefix ? <span className="font-sans text-slate-400">{prefix} </span> : null}{path}
    </p>
  );
}
