"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, ChevronRight, CircleDot, Globe2, Plus, Sparkles, WandSparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { agents } from "@/lib/demo-data";
import { garudaApi } from "@/lib/api";
import { cn } from "@/lib/utils";

export default function AgentsPage() {
  const connected = Boolean(process.env.NEXT_PUBLIC_API_URL);
  const [agentItems, setAgentItems] = useState(connected ? [] : agents);

  useEffect(() => {
    garudaApi.listAgents().then(setAgentItems).catch(() => undefined);
  }, []);

  return (
    <div className="mx-auto max-w-[1280px] space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><h1 className="text-2xl font-bold tracking-[-.035em] text-slate-950">AI agents</h1><p className="mt-1.5 text-sm text-slate-500">Create specialists for each customer journey and manage them from one place.</p></div><Button asChild><Link href="/app/agents/new"><Plus className="mr-2 h-4 w-4" /> Create an agent</Link></Button></div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {agentItems.map((agent) => (
          <Card key={agent.id} className="group overflow-hidden border-slate-200/80 shadow-none transition hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-soft">
            <CardContent className="p-0">
              <div className="p-5">
                <div className="flex items-start justify-between"><div className={cn("grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br text-base font-bold text-white shadow-md", agent.color)}>{agent.name[0]}</div>{!connected && <Badge variant="secondary">Demo</Badge>}</div>
                <div className="mt-5 flex items-center gap-2"><h2 className="text-lg font-semibold tracking-tight text-slate-950">{agent.name}</h2><Badge variant={agent.status === "live" ? "success" : agent.status === "draft" ? "secondary" : "warning"} className="capitalize">{agent.status}</Badge></div>
                <p className="mt-1 text-[11px] font-medium text-indigo-600">{connected ? "Website agent" : agent.type}</p>
                <p className="mt-3 min-h-[48px] text-sm leading-6 text-slate-600">{agent.description}</p>
                <div className="mt-5 flex flex-wrap gap-2">{connected ? <span className="inline-flex items-center gap-1 rounded-full border bg-slate-50 px-2.5 py-1 text-[10px] font-medium text-slate-500"><Globe2 className="h-3 w-3" /> Website widget</span> : agent.channels.map((channel) => <span key={channel} className="inline-flex items-center gap-1 rounded-full border bg-slate-50 px-2.5 py-1 text-[10px] font-medium text-slate-500"><Globe2 className="h-3 w-3" /> {channel}</span>)}</div>
              </div>
              {connected ? <div className="border-y bg-slate-50/70 px-5 py-3 text-[10px] text-slate-500">Analytics are available from the workspace overview.</div> : <div className="grid grid-cols-3 border-y bg-slate-50/70 py-3"><MiniMetric value={agent.conversations.toLocaleString()} label="Chats" /><MiniMetric value={agent.leads.toLocaleString()} label="Leads" border /><MiniMetric value={`${agent.conversionRate}%`} label="Convert" /></div>}
              <div className="flex items-center justify-between p-4"><span className="flex items-center gap-1.5 text-[10px] text-slate-400"><CircleDot className="h-3 w-3" /> {agent.lastActive}</span><Button variant="ghost" size="sm" className="h-8 text-indigo-600" asChild><Link href={`/app/agents/${agent.id}`}>Open agent <ChevronRight className="ml-1 h-3.5 w-3.5" /></Link></Button></div>
            </CardContent>
          </Card>
        ))}

        <Link href="/app/agents/new" className="group flex min-h-[354px] flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white/60 p-8 text-center transition hover:border-indigo-300 hover:bg-indigo-50/30">
          <div className="grid h-14 w-14 place-items-center rounded-2xl border bg-white text-indigo-600 shadow-sm transition group-hover:-translate-y-1 group-hover:shadow-md"><Plus className="h-6 w-6" /></div>
          <h2 className="mt-5 text-sm font-semibold text-slate-900">Create another agent</h2><p className="mt-2 max-w-[220px] text-xs leading-5 text-slate-500">Build a specialist for another product, audience or customer journey.</p><span className="mt-5 inline-flex items-center text-xs font-semibold text-indigo-600">Start building <ArrowRight className="ml-1.5 h-3.5 w-3.5" /></span>
        </Link>
      </div>

      <Card className="overflow-hidden border-indigo-200 bg-gradient-to-r from-indigo-50 to-violet-50 shadow-none"><CardContent className="flex flex-col items-start gap-5 p-6 sm:flex-row sm:items-center"><div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-indigo-600 text-white shadow-md"><WandSparkles className="h-5 w-5" /></div><div className="flex-1"><h3 className="text-sm font-semibold text-indigo-950">Build one focused agent at a time</h3><p className="mt-1 text-xs leading-5 text-indigo-700">Give each agent a clear outcome, approved knowledge, and an allowed website domain before publishing.</p></div><Button variant="outline" className="border-indigo-200 bg-white text-indigo-700" disabled><Sparkles className="mr-2 h-4 w-4" /> Recommendations · coming soon</Button></CardContent></Card>
    </div>
  );
}

function MiniMetric({ value, label, border = false }: { value: string; label: string; border?: boolean }) {
  return <div className={cn("text-center", border && "border-x")}><p className="text-sm font-bold text-slate-900">{value}</p><p className="mt-0.5 text-[9px] font-medium uppercase tracking-wider text-slate-400">{label}</p></div>;
}
