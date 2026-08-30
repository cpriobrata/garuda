"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Bell, CalendarClock, PlugZap, RefreshCw, Search, UserPlus, Webhook } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, Spinner } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  connectToolkit,
  disconnectToolkit,
  fetchCategories,
  fetchConnections,
  fetchRoles,
  fetchToolkits,
  type AppRole,
  type CalendarChoice,
  type Capability,
  type Category,
  type Connection,
  type Toolkit,
} from "@/components/integrations/connected-apps-api";
import { ApiError } from "@/lib/api";
import { useBusyAction } from "@/lib/busy-action";
import { cn } from "@/lib/utils";

// The catalogue is over 1,400 toolkits, so it only ever arrives a page at a time.
const pageSize = 24;

// The only three jobs a connected app can be given, named the way the API names
// them. They are also a better way to browse than the provider's own
// categories: "the four things that can hold an appointment" is not a category
// anybody publishes, and it is the question a customer actually arrives with.
const jobs = [
  {
    id: "calendar" as const,
    label: "Books appointments",
    blurb: "An agent offers your real free times from one of these and writes the appointment back into it.",
    icon: CalendarClock,
    tint: "border-violet-200 bg-violet-50 text-violet-700",
  },
  {
    id: "leads" as const,
    label: "Receives leads",
    blurb: "Every lead your agents capture is written into one of these, without you copying anything across.",
    icon: UserPlus,
    tint: "border-sky-200 bg-sky-50 text-sky-700",
  },
  {
    id: "notify" as const,
    label: "Notifies your team",
    blurb: "These tell a person the moment a lead is captured or a visitor asks to speak to somebody.",
    icon: Bell,
    tint: "border-teal-200 bg-teal-50 text-teal-700",
  },
];

function jobFor(capability: string) {
  return jobs.find((job) => job.id === capability);
}

// "a, b and c" — the calendar note is read as a sentence, not scanned as a list.
function sentenceList(items: string[]) {
  if (items.length < 2) return items[0] || "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function JobChip({ active, onSelect, children }: { active: boolean; onSelect: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onSelect}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
        active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900",
      )}
    >
      {children}
    </button>
  );
}

// Composio's own status strings reach the browser untouched, and they are
// uppercase. A link is INITIATED from the moment it is created and only turns
// ACTIVE once the customer has finished signing in at the provider; FAILED and
// EXPIRED are the other ways one ends. ACTIVE is therefore the only value that
// may be shown as connected -- an initiated link authorises nothing.
function isActive(connection: Connection) {
  return (connection.status || "").trim().toUpperCase() === "ACTIVE";
}

// A request that outruns its timeout rejects with a DOMException, never an
// ApiError, so it has to be recognised separately or it reaches the screen as
// "signal is aborted without reason".
function timedOut(reason: unknown) {
  return reason instanceof Error && reason.name === "AbortError";
}

// Only the API's own message is fit to print. A dead connection surfaces as
// "Failed to fetch", which tells the reader nothing they can act on.
function messageOf(reason: unknown, fallback: string) {
  if (timedOut(reason)) return "That took longer than this page was willing to wait. Check your connection and try again.";
  return reason instanceof ApiError && reason.message ? reason.message : fallback;
}

// A deployment with no Composio credentials answers 503 here. That is a fact
// about the deployment rather than a failure, so it reads as an empty state.
function notConfigured(reason: unknown) {
  return reason instanceof ApiError && reason.code === "integrations_not_configured";
}

// window.open with noopener in the features string returns null whether it
// worked or not, per spec, so nothing can be read from its result -- and taking
// null for "blocked" ran the fallback on every successful connect. Clicking a
// real anchor is what the widget settled on for the same reason. The card also
// prints the link, because a tab the browser genuinely blocked is undetectable
// and the customer needs something to press either way.
function openExternal(url: string) {
  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function monogram(name: string) {
  return name.split(/\s+/).filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "?";
}

export function ConnectedApps() {
  const connected = Boolean(process.env.NEXT_PUBLIC_API_URL);
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [category, setCategory] = useState("");
  const [categories, setCategories] = useState<Category[]>([]);
  const [toolkits, setToolkits] = useState<Toolkit[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(connected);
  const [error, setError] = useState("");
  const [unavailable, setUnavailable] = useState(connected ? "" : "This demo workspace runs without the Garuda API, so there is no live catalogue to browse here.");
  const [connections, setConnections] = useState<Connection[] | null>(connected ? null : []);
  const [connectionsError, setConnectionsError] = useState("");
  // What connecting each app will actually do. Until this table has arrived the
  // cards say nothing either way: "nothing is wired to this" is as wrong about
  // Slack as it is right about Jira, and a card that guesses is worse than one
  // that waits.
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [calendars, setCalendars] = useState<CalendarChoice[]>([]);
  const [rolesLoaded, setRolesLoaded] = useState(false);
  const [job, setJob] = useState<Capability | "">("");
  const more = useBusyAction();
  const refresh = useBusyAction();
  // Every catalogue load carries a token. Typing "sl" then "slack" starts two
  // requests, and the first can answer last; a response whose token is no longer
  // the current one is dropped rather than painted over the newer results.
  const loadToken = useRef(0);
  const startedConnect = useRef(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setTerm(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const load = useCallback(async (from?: string) => {
    // A job filter browses the role table rather than the catalogue, so paging
    // the catalogue underneath it would only spend requests on results nobody
    // is looking at.
    if (!connected || job) return;
    const token = (loadToken.current += 1);
    if (!from) setLoading(true);
    try {
      const page = await fetchToolkits({ search: term, category, cursor: from, limit: pageSize });
      if (token !== loadToken.current) return;
      setError("");
      setUnavailable("");
      setToolkits((current) => {
        if (!from) return page.items;
        // Appended by slug rather than blindly concatenated: a cursor can hand
        // back an entry already on screen if the catalogue shifts mid-browse.
        const seen = new Set(current.map((item) => item.slug));
        return [...current, ...page.items.filter((item) => !seen.has(item.slug))];
      });
      setCursor(page.nextCursor);
      setTotal(page.totalItems);
    } catch (reason) {
      if (token !== loadToken.current) return;
      if (notConfigured(reason)) {
        setUnavailable("Connected apps are not enabled on this deployment, so there is no catalogue to browse yet.");
        setToolkits([]);
        setCursor(undefined);
        return;
      }
      setError(messageOf(reason, "The app catalogue could not be loaded. Check your connection and try again."));
    } finally {
      if (token === loadToken.current) setLoading(false);
    }
  }, [category, connected, job, term]);

  const loadConnections = useCallback(async () => {
    if (!connected) return;
    try {
      setConnections(await fetchConnections());
      setConnectionsError("");
    } catch (reason) {
      setConnections((current) => current || []);
      // An unconfigured deployment already says so through the catalogue's empty
      // state, so it is not reported a second time here.
      setConnectionsError(notConfigured(reason) ? "" : messageOf(reason, "Your connected accounts could not be read, so the buttons below may be out of date."));
    }
  }, [connected]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadConnections();
  }, [loadConnections]);

  useEffect(() => {
    if (!connected) return;
    let active = true;
    fetchCategories().then((items) => { if (active) setCategories(items); }).catch(() => { if (active) setCategories([]); });
    return () => { active = false; };
  }, [connected]);

  useEffect(() => {
    if (!connected) return;
    let active = true;
    // This one is answered from a table inside the API rather than relayed to
    // the provider, so it arrives even where the catalogue itself is down.
    fetchRoles()
      .then((payload) => {
        if (!active) return;
        setRoles(payload.roles || []);
        setCalendars(payload.calendars || []);
        setRolesLoaded(true);
      })
      .catch(() => { if (active) setRolesLoaded(false); });
    return () => { active = false; };
  }, [connected]);

  useEffect(() => {
    if (!connected) return;
    // Signing in happens in the provider's own tab, and nothing tells this page
    // when it finishes. Coming back to this tab is the moment worth re-reading,
    // and it takes both events to catch: switching tabs inside one window fires
    // visibilitychange, and switching windows fires focus. Returning usually
    // fires both, so a re-read within a second of the last one is dropped.
    let lastRead = 0;
    function refreshOnReturn() {
      if (!startedConnect.current || document.visibilityState !== "visible") return;
      if (Date.now() - lastRead < 1000) return;
      lastRead = Date.now();
      void loadConnections();
    }
    window.addEventListener("focus", refreshOnReturn);
    document.addEventListener("visibilitychange", refreshOnReturn);
    return () => {
      window.removeEventListener("focus", refreshOnReturn);
      document.removeEventListener("visibilitychange", refreshOnReturn);
    };
  }, [connected, loadConnections]);

  const byToolkit = useMemo(() => {
    const map = new Map<string, Connection>();
    for (const connection of connections || []) {
      const key = (connection.toolkit || "").trim().toLowerCase();
      if (!key) continue;
      const existing = map.get(key);
      // A finished account always wins over a half-finished one for the same app.
      if (!existing || (!isActive(existing) && isActive(connection))) map.set(key, connection);
    }
    return map;
  }, [connections]);

  const rolesByToolkit = useMemo(() => {
    const map = new Map<string, AppRole[]>();
    for (const role of roles) {
      const key = (role.toolkit || "").trim().toLowerCase();
      if (!key) continue;
      map.set(key, [...(map.get(key) || []), role]);
    }
    return map;
  }, [roles]);

  // The handful of apps something is actually wired to, in the order the API
  // returned them, which is by job and then by name. The catalogue cannot be
  // asked for these: Google Calendar, Outlook, Cal.com and Calendly sit in four
  // different provider categories and only this table knows they are the same
  // answer to the same question.
  const wiredToolkits = useMemo(() => {
    const seen = new Set<string>();
    const list: Toolkit[] = [];
    for (const role of roles) {
      const key = (role.toolkit || "").trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      list.push({ slug: key, name: role.label });
    }
    return list;
  }, [roles]);

  const catalogueBySlug = useMemo(() => {
    const map = new Map<string, Toolkit>();
    for (const item of toolkits) map.set(item.slug.trim().toLowerCase(), item);
    return map;
  }, [toolkits]);

  const shown = useMemo(() => {
    if (!job) return toolkits;
    const needle = term.toLowerCase();
    return wiredToolkits
      .filter((item) => (rolesByToolkit.get(item.slug) || []).some((role) => role.capability === job))
      .filter((item) => !needle || item.name.toLowerCase().includes(needle) || item.slug.includes(needle))
      // The catalogue entry carries the provider's own logo, so it wins wherever
      // this page happens to have loaded it; the entry built from the role table
      // stands on its own when it has not.
      .map((item) => catalogueBySlug.get(item.slug) || item);
  }, [catalogueBySlug, job, rolesByToolkit, term, toolkits, wiredToolkits]);

  // Which calendars finish the booking here and which hand the visitor away,
  // read off the API rather than written down, so a new provider says the right
  // thing on the day it is added.
  const calendarNote = useMemo(() => {
    const inChat = calendars.filter((entry) => entry.books_in_chat).map((entry) => entry.label);
    const elsewhere = calendars.filter((entry) => !entry.books_in_chat).map((entry) => entry.label);
    if (inChat.length === 0 || elsewhere.length === 0) return "";
    return `${sentenceList(inChat)} ${inChat.length === 1 ? "finishes" : "finish"} the booking inside the chat; ${sentenceList(elsewhere)} ${elsewhere.length === 1 ? "hands" : "hand"} the visitor a link to finish on the provider's own page.`;
  }, [calendars]);

  const activeCount = (connections || []).filter(isActive).length;
  const filtered = Boolean(term || category || job);
  // Only the catalogue pages, so only the catalogue dims and skeletons.
  const busy = loading && !job;

  const recordStarted = useCallback((started: Connection) => {
    startedConnect.current = true;
    setConnections((current) => [...(current || []).filter((item) => item.id !== started.id), started]);
  }, []);

  const recordDisconnected = useCallback((connectionID: string) => {
    setConnections((current) => (current || []).filter((item) => item.id !== connectionID));
  }, []);

  if (unavailable) {
    return (
      <div className="rounded-xl border border-dashed bg-white p-8 text-center">
        <span className="mx-auto grid h-10 w-10 place-items-center rounded-xl bg-slate-100 text-slate-500"><PlugZap className="h-5 w-5" /></span>
        <p className="mt-3 text-sm font-semibold text-slate-900">No app catalogue here</p>
        <p className="mx-auto mt-1.5 max-w-md text-xs leading-5 text-slate-500">{unavailable}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1 space-y-1.5">
          <Label htmlFor="app-search">Search apps</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <Input id="app-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Slack, HubSpot, Google Calendar…" autoComplete="off" spellCheck={false} className="pl-9" />
          </div>
        </div>
        <div className="space-y-1.5 sm:w-56">
          <Label htmlFor="app-category">Category</Label>
          {/* The provider's categories describe the app; the chips below
              describe what Garuda will do with it. Mixing the two would filter
              a list of four calendars by "Productivity" and find one. */}
          <select id="app-category" value={category} onChange={(event) => setCategory(event.target.value)} disabled={categories.length === 0 || Boolean(job)} className="h-11 w-full rounded-lg border bg-white px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50">
            <option value="">All categories</option>
            {categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </div>
        <Button type="button" variant="outline" className="h-11 shrink-0" loading={refresh.busy} loadingLabel="Rechecking your connected accounts" onClick={() => void refresh.run(loadConnections)}><RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Refresh</Button>
      </div>

      {rolesLoaded && (
        <div className="space-y-2.5 rounded-xl border bg-white p-4">
          <p id="app-job-label" className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">What do you want it to do?</p>
          <div role="group" aria-labelledby="app-job-label" className="flex flex-wrap gap-2">
            <JobChip active={!job} onSelect={() => setJob("")}>All apps</JobChip>
            {jobs.map((entry) => {
              const Icon = entry.icon;
              return (
                <JobChip key={entry.id} active={job === entry.id} onSelect={() => { setJob(entry.id); setCategory(""); }}>
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" /> {entry.label}
                </JobChip>
              );
            })}
          </div>
          {job ? (
            <p className="text-xs leading-5 text-slate-600">
              {jobFor(job)?.blurb}
              {job === "calendar" && calendarNote ? ` ${calendarNote}` : ""}
            </p>
          ) : (
            // The honest headline for this screen: a catalogue this size is
            // almost entirely apps nothing reads yet, and the customer needs to
            // hear that here rather than after connecting one.
            <p className="flex items-start gap-2 text-xs leading-5 text-slate-600">
              <Webhook className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
              <span>
                {wiredToolkits.length} of these apps have a job wired to them, and the filters above are the quickest way to them. Every other
                app connects and keeps the account here, but nothing reads it yet — to move your leads into one of those today, send it an{" "}
                <a href="#outbound-webhooks" className="font-semibold text-slate-700 underline underline-offset-2 hover:text-slate-900">outbound webhook</a>{" "}
                through Zapier, Make or n8n.
              </span>
            </p>
          )}
        </div>
      )}

      <p className="text-xs text-slate-500">
        {job
          ? `${shown.length} app${shown.length === 1 ? "" : "s"}`
          : total > 0 ? `${total.toLocaleString()} app${total === 1 ? "" : "s"} available` : `${toolkits.length} app${toolkits.length === 1 ? "" : "s"}`}
        {" · "}
        {connections === null ? "checking your connected accounts…" : `${activeCount} connected`}
      </p>

      {error && <p role="alert" className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> {error}</p>}
      {connectionsError && <p role="alert" className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> {connectionsError}</p>}

      {busy && toolkits.length === 0 ? (
        <div aria-busy="true">
          <p className="sr-only">Loading the app catalogue…</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="animate-pulse rounded-xl border bg-white p-4"><div className="h-10 w-10 rounded-xl bg-slate-100" /><div className="mt-3 h-3 w-28 rounded bg-slate-100" /><div className="mt-2.5 h-2.5 w-full rounded bg-slate-50" /><div className="mt-1.5 h-2.5 w-3/5 rounded bg-slate-50" /><div className="mt-4 h-8 w-24 rounded-lg bg-slate-100" /></div>
            ))}
          </div>
        </div>
      ) : shown.length === 0 ? (
        !error && (
          <div className="rounded-xl border border-dashed bg-white p-8 text-center">
            <p className="text-sm font-semibold text-slate-900">{filtered ? "No apps match that search" : "The catalogue came back empty"}</p>
            <p className="mx-auto mt-1.5 max-w-md text-xs leading-5 text-slate-500">{filtered ? "Try a shorter word, or widen it back to all apps." : "Nothing was returned for this workspace. Try again in a moment."}</p>
            {filtered && <Button type="button" variant="outline" size="sm" className="mt-4" onClick={() => { setSearch(""); setTerm(""); setCategory(""); setJob(""); }}>Clear filters</Button>}
          </div>
        )
      ) : (
        <div className={cn("grid gap-3 sm:grid-cols-2 lg:grid-cols-3", busy && "opacity-60")} aria-busy={busy || undefined}>
          {shown.map((toolkit) => {
            const slug = toolkit.slug.trim().toLowerCase();
            return (
              <ToolkitCard
                key={slug}
                toolkit={toolkit}
                connection={byToolkit.get(slug)}
                roles={rolesByToolkit.get(slug) || []}
                rolesKnown={rolesLoaded}
                onStarted={recordStarted}
                onDisconnected={recordDisconnected}
              />
            );
          })}
        </div>
      )}

      {!job && cursor && toolkits.length > 0 && (
        <div className="flex justify-center pt-1">
          {/* Disabled mid-search: the cursor still belongs to the results on
              screen, and paging it now would append the outgoing query's page. */}
          <Button type="button" variant="outline" disabled={loading} loading={more.busy} loadingLabel="Loading more apps" onClick={() => void more.run(() => load(cursor))}>Show more apps</Button>
        </div>
      )}
    </div>
  );
}

function ToolkitCard({ toolkit, connection, roles, rolesKnown, onStarted, onDisconnected }: { toolkit: Toolkit; connection?: Connection; roles: AppRole[]; rolesKnown: boolean; onStarted: (connection: Connection) => void; onDisconnected: (connectionID: string) => void }) {
  const action = useBusyAction();
  const cancel = useBusyAction();
  const [logoBroken, setLogoBroken] = useState(false);
  const [message, setMessage] = useState("");
  // Kept on the card rather than read back off the connection: the connections
  // listing carries no redirect_url, so the first refresh would take the link
  // away again while the customer is still part-way through signing in.
  const [signInURL, setSignInURL] = useState("");
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const live = connection ? isActive(connection) : false;
  const pending = Boolean(connection) && !live;
  const settings = roles.filter((role) => role.setting_label);
  const caveats = roles.filter((role) => role.partial && role.partial_note);

  async function connect() {
    setMessage("");
    setSignInURL("");
    try {
      const started = await connectToolkit(toolkit.slug);
      onStarted(started);
      // A link with nowhere to send the customer is a failure, not a no-op: the
      // button would otherwise look like it had simply done nothing.
      if (!started.redirect_url) {
        setMessage("No sign-in link came back for this app, so there is nowhere to send you yet. Try again in a moment.");
        return;
      }
      // Recorded before the tab is opened, so the link is on the card even if
      // opening it throws.
      setSignInURL(started.redirect_url);
      openExternal(started.redirect_url);
    } catch (reason) {
      // The connect may well have finished at the provider after the wait was
      // abandoned, so a timeout points at Refresh rather than at trying again.
      setMessage(timedOut(reason)
        ? `Connecting ${toolkit.name} is taking longer than usual. It may still have gone through — use Refresh above to check before starting again.`
        : messageOf(reason, `${toolkit.name} could not be connected. Please try again.`));
    }
  }

  // What breaks, in the product's own terms. A calendar disconnected here means
  // visitors tapping "Book an appointment" get an apology instead of a time --
  // which is exactly what the builder spends a whole panel warning about before
  // publishing, and what a trash-adjacent button gave no hint of.
  function disconnectConsequences(): string[] {
    const sentences: string[] = [];
    for (const role of roles) {
      if (role.capability === "calendar") {
        sentences.push(`Agents that book into ${toolkit.name} stop offering times to visitors until you reconnect. Existing appointments stay in your calendar.`);
      } else if (role.capability === "leads") {
        sentences.push(`New leads stop being sent to ${toolkit.name}. They are still captured and saved in Garuda, so nothing is lost.`);
      } else if (role.capability === "notify") {
        sentences.push(`Your team stops being notified in ${toolkit.name} when a lead comes in.`);
      }
    }
    if (sentences.length === 0) {
      sentences.push(`Nothing in Garuda currently reads from ${toolkit.name}, so this only removes the connection itself.`);
    }
    sentences.push("Reconnecting means signing in with the provider again. Garuda never stored the password, so there is nothing to restore from here.");
    return sentences;
  }

  async function disconnect() {
    if (!connection) return;
    setMessage("");
    try {
      await disconnectToolkit(connection.id);
      onDisconnected(connection.id);
      setSignInURL("");
    } catch (reason) {
      setMessage(messageOf(reason, `${toolkit.name} could not be disconnected. Please try again.`));
    }
  }

  return (
    <div className="flex flex-col rounded-xl border bg-white p-4 shadow-sm transition-colors hover:border-slate-300">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-xl border bg-white text-[11px] font-bold text-slate-500">
          {toolkit.logo && !logoBroken ? (
            // The logo sits on the provider's own CDN, so it cannot go through
            // next/image, which needs every host allowlisted first. A dead URL
            // falls back to the monogram rather than a broken-image icon.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={toolkit.logo} alt="" className="h-full w-full object-contain p-1.5" onError={() => setLogoBroken(true)} />
          ) : monogram(toolkit.name)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="min-w-0 truncate text-sm font-semibold text-slate-900">{toolkit.name}</p>
            {live && <Badge variant="success" className="shrink-0">Connected</Badge>}
            {pending && <Badge variant="warning" className="shrink-0">Awaiting sign-in</Badge>}
          </div>
          {roles.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {roles.map((role) => {
                const roleJob = jobFor(role.capability);
                if (!roleJob) return null;
                const Icon = roleJob.icon;
                return (
                  <Badge key={`${role.capability}-${role.label}`} variant="outline" className={cn("shrink-0 gap-1 px-2 py-0.5 text-[10px]", roleJob.tint)}>
                    <Icon className="h-3 w-3" aria-hidden="true" /> {roleJob.label}
                  </Badge>
                );
              })}
            </div>
          )}
          {/* The use case replaces the provider's own blurb rather than joining
              it. What the app is has never been the question on this screen;
              what connecting it will do is, and the name is directly above. */}
          {roles.length > 0 ? (
            <div className="mt-1.5 space-y-1">
              {roles.map((role) => <p key={`use-${role.capability}-${role.label}`} className="text-xs leading-5 text-slate-600">{role.use_case}</p>)}
            </div>
          ) : (
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{toolkit.description?.trim() || `Connect your ${toolkit.name} account to this workspace.`}</p>
          )}
        </div>
      </div>

      {/* Said before the Connect button, not after: knowing an event type id is
          needed is the difference between finishing the setup and abandoning it
          half-connected. */}
      {settings.map((role) => (
        <p key={`setting-${role.capability}-${role.label}`} className="mt-3 rounded-lg border bg-slate-50 px-3 py-2 text-[11px] leading-4 text-slate-600">
          Needs one setting: <span className="font-semibold text-slate-900">{role.setting_label}</span>
          {role.setting_hint ? ` — ${role.setting_hint}` : ". Have it to hand before you connect."}
        </p>
      ))}

      {caveats.map((role) => (
        <p key={`partial-${role.capability}-${role.label}`} className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-4 text-amber-800">
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" /> {role.partial_note}
        </p>
      ))}

      {/* Only once the role table has actually arrived. Guessing here would put
          "nothing is wired to this" on the Slack card. */}
      {rolesKnown && roles.length === 0 && (
        <p className="mt-3 flex items-start gap-2 rounded-lg border bg-slate-50 px-3 py-2 text-[11px] leading-4 text-slate-600">
          <Webhook className="mt-px h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
          <span>
            Nothing is wired to {toolkit.name} yet — connecting keeps the account here for later. To get your leads into it today, use an{" "}
            <a href="#outbound-webhooks" className="font-semibold text-slate-700 underline underline-offset-2 hover:text-slate-900">outbound webhook</a>{" "}
            with Zapier, Make or n8n.
          </span>
        </p>
      )}

      {message && <p role="alert" className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] leading-4 text-rose-700">{message}</p>}

      {/* The button's own spinner replaces a label that is only three words
          wide, which is easy to miss on a card this size. This says so in
          words, from the first click, and names the wait so a minute of it does
          not read as nothing happening. */}
      {action.busy && !live && (
        <p role="status" className="mt-3 flex items-start gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-[11px] leading-4 text-indigo-700">
          <Spinner className="mt-px h-3.5 w-3.5 shrink-0 text-indigo-500" /> Starting the {toolkit.name} sign-in. The first connection to an app can take up to a minute.
        </p>
      )}

      {signInURL && !live && (
        <p className="mt-3 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-[11px] leading-4 text-indigo-700">
          A {toolkit.name} tab should have opened for you to sign in. If your browser blocked it,{" "}
          <a href={signInURL} target="_blank" rel="noopener noreferrer" className="font-semibold underline underline-offset-2 hover:text-indigo-900">open the sign-in yourself</a>, then come back to this tab.
        </p>
      )}

      <div className="mt-auto flex items-center gap-2 pt-4">
        {live ? (
          <Button type="button" variant="outline" size="sm" loading={action.busy} loadingLabel={`Disconnecting ${toolkit.name}`} onClick={() => setConfirmingDisconnect(true)}>Disconnect</Button>
        ) : (
          <Button type="button" size="sm" disabled={cancel.busy} loading={action.busy} loadingLabel={`Opening the ${toolkit.name} sign-in`} onClick={() => void action.run(connect)}>{pending ? "Finish connecting" : "Connect"}</Button>
        )}
        {/* Cancel and connect share one half-finished connection, so neither may
            run while the other is in flight. */}
        {pending && <Button type="button" variant="ghost" size="sm" className="text-slate-500" disabled={action.busy} loading={cancel.busy} loadingLabel={`Discarding the ${toolkit.name} sign-in`} onClick={() => void cancel.run(disconnect)}>Cancel</Button>}
      </div>

      <ConfirmDialog
        open={confirmingDisconnect}
        onOpenChange={setConfirmingDisconnect}
        title={`Disconnect ${toolkit.name}?`}
        description={`Garuda will lose access to your ${toolkit.name} account immediately.`}
        consequences={disconnectConsequences()}
        confirmLabel="Disconnect"
        confirmBusyLabel={`Disconnecting ${toolkit.name}`}
        cancelLabel="Stay connected"
        failureMessage={`${toolkit.name} could not be disconnected just now.`}
        onConfirm={disconnect}
      />
    </div>
  );
}
