"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, PlugZap, RefreshCw, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  connectToolkit,
  disconnectToolkit,
  fetchCategories,
  fetchConnections,
  fetchToolkits,
  type Category,
  type Connection,
  type Toolkit,
} from "@/components/integrations/connected-apps-api";
import { ApiError } from "@/lib/api";
import { useBusyAction } from "@/lib/busy-action";
import { cn } from "@/lib/utils";

// The catalogue is over 1,400 toolkits, so it only ever arrives a page at a time.
const pageSize = 24;

// Composio's own status strings reach the browser untouched, and they are
// uppercase. A link is INITIATED from the moment it is created and only turns
// ACTIVE once the customer has finished signing in at the provider; FAILED and
// EXPIRED are the other ways one ends. ACTIVE is therefore the only value that
// may be shown as connected -- an initiated link authorises nothing.
function isActive(connection: Connection) {
  return (connection.status || "").trim().toUpperCase() === "ACTIVE";
}

// Only the API's own message is fit to print. A dead connection surfaces as
// "Failed to fetch", which tells the reader nothing they can act on.
function messageOf(reason: unknown, fallback: string) {
  return reason instanceof ApiError && reason.message ? reason.message : fallback;
}

// A deployment with no Composio credentials answers 503 here. That is a fact
// about the deployment rather than a failure, so it reads as an empty state.
function notConfigured(reason: unknown) {
  return reason instanceof ApiError && reason.code === "integrations_not_configured";
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
    if (!connected) return;
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
  }, [category, connected, term]);

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
    // Signing in happens in the provider's own tab, and nothing tells this page
    // when it finishes. Coming back to the tab is the moment worth re-reading.
    function refreshOnReturn() {
      if (startedConnect.current) void loadConnections();
    }
    window.addEventListener("focus", refreshOnReturn);
    return () => window.removeEventListener("focus", refreshOnReturn);
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

  const activeCount = (connections || []).filter(isActive).length;
  const filtered = Boolean(term || category);

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
          <select id="app-category" value={category} onChange={(event) => setCategory(event.target.value)} disabled={categories.length === 0} className="h-11 w-full rounded-lg border bg-white px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50">
            <option value="">All categories</option>
            {categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </div>
        <Button type="button" variant="outline" className="h-11 shrink-0" loading={refresh.busy} loadingLabel="Rechecking your connected accounts" onClick={() => void refresh.run(loadConnections)}><RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Refresh</Button>
      </div>

      <p className="text-xs text-slate-500">
        {total > 0 ? `${total.toLocaleString()} app${total === 1 ? "" : "s"} available` : `${toolkits.length} app${toolkits.length === 1 ? "" : "s"}`}
        {" · "}
        {connections === null ? "checking your connected accounts…" : `${activeCount} connected`}
      </p>

      {error && <p role="alert" className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> {error}</p>}
      {connectionsError && <p role="alert" className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> {connectionsError}</p>}

      {loading && toolkits.length === 0 ? (
        <div aria-busy="true">
          <p className="sr-only">Loading the app catalogue…</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="animate-pulse rounded-xl border bg-white p-4"><div className="h-10 w-10 rounded-xl bg-slate-100" /><div className="mt-3 h-3 w-28 rounded bg-slate-100" /><div className="mt-2.5 h-2.5 w-full rounded bg-slate-50" /><div className="mt-1.5 h-2.5 w-3/5 rounded bg-slate-50" /><div className="mt-4 h-8 w-24 rounded-lg bg-slate-100" /></div>
            ))}
          </div>
        </div>
      ) : toolkits.length === 0 ? (
        !error && (
          <div className="rounded-xl border border-dashed bg-white p-8 text-center">
            <p className="text-sm font-semibold text-slate-900">{filtered ? "No apps match that search" : "The catalogue came back empty"}</p>
            <p className="mx-auto mt-1.5 max-w-md text-xs leading-5 text-slate-500">{filtered ? "Try a shorter word, or widen the category back to all apps." : "Nothing was returned for this workspace. Try again in a moment."}</p>
            {filtered && <Button type="button" variant="outline" size="sm" className="mt-4" onClick={() => { setSearch(""); setTerm(""); setCategory(""); }}>Clear filters</Button>}
          </div>
        )
      ) : (
        <div className={cn("grid gap-3 sm:grid-cols-2 lg:grid-cols-3", loading && "opacity-60")} aria-busy={loading || undefined}>
          {toolkits.map((toolkit) => (
            <ToolkitCard key={toolkit.slug} toolkit={toolkit} connection={byToolkit.get(toolkit.slug.trim().toLowerCase())} onStarted={recordStarted} onDisconnected={recordDisconnected} />
          ))}
        </div>
      )}

      {cursor && toolkits.length > 0 && (
        <div className="flex justify-center pt-1">
          {/* Disabled mid-search: the cursor still belongs to the results on
              screen, and paging it now would append the outgoing query's page. */}
          <Button type="button" variant="outline" disabled={loading} loading={more.busy} loadingLabel="Loading more apps" onClick={() => void more.run(() => load(cursor))}>Show more apps</Button>
        </div>
      )}
    </div>
  );
}

function ToolkitCard({ toolkit, connection, onStarted, onDisconnected }: { toolkit: Toolkit; connection?: Connection; onStarted: (connection: Connection) => void; onDisconnected: (connectionID: string) => void }) {
  const action = useBusyAction();
  const cancel = useBusyAction();
  const [logoBroken, setLogoBroken] = useState(false);
  const [message, setMessage] = useState("");
  const live = connection ? isActive(connection) : false;
  const pending = Boolean(connection) && !live;

  async function connect() {
    setMessage("");
    try {
      const started = await connectToolkit(toolkit.slug);
      onStarted(started);
      // A link with nowhere to send the customer is a failure, not a no-op: the
      // button would otherwise look like it had simply done nothing.
      if (!started.redirect_url) {
        setMessage("No sign-in link came back for this app, so there is nowhere to send you yet. Try again in a moment.");
        return;
      }
      const opened = window.open(started.redirect_url, "_blank", "noopener,noreferrer");
      if (!opened) setMessage("Your browser blocked the sign-in window. Allow pop-ups for this site, then try again.");
    } catch (reason) {
      setMessage(messageOf(reason, `${toolkit.name} could not be connected. Please try again.`));
    }
  }

  async function disconnect() {
    if (!connection) return;
    setMessage("");
    try {
      await disconnectToolkit(connection.id);
      onDisconnected(connection.id);
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
            <p className="truncate text-sm font-semibold text-slate-900">{toolkit.name}</p>
            {live && <Badge variant="success" className="shrink-0">Connected</Badge>}
            {pending && <Badge variant="warning" className="shrink-0">Awaiting sign-in</Badge>}
          </div>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{toolkit.description?.trim() || `Connect your ${toolkit.name} account to this workspace.`}</p>
        </div>
      </div>

      {message && <p role="alert" className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] leading-4 text-rose-700">{message}</p>}

      <div className="mt-auto flex items-center gap-2 pt-4">
        {live ? (
          <Button type="button" variant="outline" size="sm" loading={action.busy} loadingLabel={`Disconnecting ${toolkit.name}`} onClick={() => void action.run(disconnect)}>Disconnect</Button>
        ) : (
          <Button type="button" size="sm" loading={action.busy} loadingLabel={`Opening the ${toolkit.name} sign-in`} onClick={() => void action.run(connect)}>{pending ? "Finish connecting" : "Connect"}</Button>
        )}
        {pending && <Button type="button" variant="ghost" size="sm" className="text-slate-500" loading={cancel.busy} loadingLabel={`Discarding the ${toolkit.name} sign-in`} onClick={() => void cancel.run(disconnect)}>Cancel</Button>}
      </div>
    </div>
  );
}
