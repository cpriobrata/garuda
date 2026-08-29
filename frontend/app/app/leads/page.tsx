"use client";

import { useCallback, useEffect, useState } from "react";
import { TrendingUp, UsersRound } from "lucide-react";
import { LeadActions } from "@/components/leads/lead-actions";
import { LeadsTable } from "@/components/leads/leads-table";
import { Badge } from "@/components/ui/badge";
import { garudaApi } from "@/lib/api";

type Metrics = Awaited<ReturnType<typeof garudaApi.dashboard>>["metrics"];

export default function LeadsPage() {
  const connected = Boolean(process.env.NEXT_PUBLIC_API_URL);
  const [metrics, setMetrics] = useState<Metrics | null>(connected ? null : { agents: 3, published_agents: 2, conversations: 2131, messages: 8492, leads: 364, lead_conversion_rate: 17.1 });
  // The table loads its own rows once, on mount. Bumping this remounts it, which
  // is what makes a hand-added lead appear without the operator reloading.
  const [tableGeneration, setTableGeneration] = useState(0);

  const loadMetrics = useCallback(() => {
    if (!connected) return;
    garudaApi.dashboard().then((value) => setMetrics(value.metrics)).catch(() => undefined);
  }, [connected]);

  useEffect(() => { loadMetrics(); }, [loadMetrics]);

  return <div className="mx-auto max-w-[1360px] space-y-6">
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div>
        <div className="flex items-center gap-2"><h1 className="text-2xl font-bold tracking-[-.035em] text-slate-950">Leads</h1><Badge variant="secondary">{typeof metrics?.leads === "number" ? `${metrics.leads} total` : "Awaiting API"}</Badge>{!connected && <Badge variant="secondary">Demo</Badge>}</div>
        <p className="mt-1.5 text-sm text-slate-500">Consented contacts captured from agent conversations, plus anything your team adds by hand.</p>
      </div>
      <LeadActions connected={connected} onLeadAdded={() => { setTableGeneration((generation) => generation + 1); loadMetrics(); }} />
    </div>
    <div className="grid gap-3 sm:grid-cols-3"><MiniSummary label="Captured leads" value={metrics?.leads.toLocaleString() || "—"} note={connected ? "Server total" : "Demo total"} color="indigo" /><MiniSummary label="Lead conversion" value={metrics ? `${metrics.lead_conversion_rate.toFixed(1)}%` : "—"} note={connected ? "Dashboard API" : "Demo metric"} color="emerald" /><MiniSummary label="Conversations" value={metrics?.conversations.toLocaleString() || "—"} note="Workspace context" color="violet" /></div>
    <LeadsTable key={tableGeneration} />
  </div>;
}

function MiniSummary({ label, value, note, color }: { label: string; value: string; note: string; color: string }) {
  const style = color === "emerald" ? "bg-emerald-50 text-emerald-600" : color === "violet" ? "bg-violet-50 text-violet-600" : "bg-indigo-50 text-indigo-600";
  return <div className="flex items-center gap-4 rounded-xl border bg-white p-4"><span className={`grid h-10 w-10 place-items-center rounded-xl ${style}`}>{color === "indigo" ? <UsersRound className="h-4 w-4" /> : <TrendingUp className="h-4 w-4" />}</span><div><p className="text-[10px] font-medium text-slate-500">{label}</p><div className="mt-0.5 flex items-baseline gap-2"><p className="text-xl font-bold text-slate-950">{value}</p><p className="text-[9px] text-slate-400">{note}</p></div></div></div>;
}
