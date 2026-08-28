"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Bot, BrainCircuit, Edit3, Globe2, MessageSquareText, Target, UsersRound } from "lucide-react";
import { AgentTestPanel } from "@/components/agents/agent-test-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { garudaApi, type AgentRecord } from "@/lib/api";
import { agents as demoAgents } from "@/lib/demo-data";
import { cn } from "@/lib/utils";

export function AgentDetail({ agentId }: { agentId: string }) {
  const connected = Boolean(process.env.NEXT_PUBLIC_API_URL);
  const demo = demoAgents.find((item) => item.id === agentId) || demoAgents[0];
  const [record, setRecord] = useState<AgentRecord | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!connected) return;
    let active = true;
    garudaApi.getAgent(agentId).then((value) => { if (active) setRecord(value); }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Agent could not be retrieved."); });
    return () => { active = false; };
  }, [agentId, connected]);

  const name = connected ? record?.name : demo.name;
  const status = connected ? record?.status : demo.status;
  const live = status === "published" || status === "live";
  const domain = connected ? record?.branding?.allowed_domains?.[0] : "northstar.example";

  return <div className="mx-auto max-w-[1320px] space-y-6">
    <Button variant="ghost" size="sm" className="-ml-2 text-slate-500" asChild><Link href="/app/agents"><ArrowLeft className="mr-1.5 h-3.5 w-3.5" /> Back to agents</Link></Button>

    {!name ? <Card className="shadow-none"><CardContent className="flex items-center gap-3 p-6"><span className="grid h-11 w-11 place-items-center rounded-xl bg-slate-100 text-slate-500"><Bot className="h-5 w-5" /></span><div><p className="text-sm font-semibold text-slate-800">{error ? "Agent unavailable" : "Retrieving agent configuration"}</p><p className="mt-1 text-xs text-slate-500">{error || "Garuda is loading the current server record."}</p></div></CardContent></Card> : <>
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-center">
        <div className="flex items-center gap-4"><div className={cn("grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br text-lg font-bold text-white shadow-md", connected ? "from-indigo-500 to-violet-600" : demo.color)}>{name[0]?.toUpperCase()}</div><div><div className="flex items-center gap-2"><h1 className="text-2xl font-bold tracking-[-.035em] text-slate-950">{name}</h1><Badge variant={live ? "success" : "secondary"} className="capitalize">{status?.replaceAll("_", " ")}</Badge>{!connected && <Badge variant="secondary">Demo</Badge>}</div><p className="mt-1 text-sm text-slate-500">{connected ? (record?.description || "AI website agent") : `${demo.type} · ${demo.lastActive}`}</p></div></div>
        <div className="flex gap-2"><Button variant="outline" size="sm" disabled>Pause · coming soon</Button><Button size="sm" asChild><Link href={`/app/agents/${encodeURIComponent(agentId)}/edit`}><Edit3 className="mr-1.5 h-3.5 w-3.5" /> Edit agent</Link></Button></div>
      </div>

      {connected ? <div className="grid gap-4 md:grid-cols-3">
        <ConfigCard icon={BrainCircuit} label="Knowledge" value={`${record?.knowledge?.length || 0} source${record?.knowledge?.length === 1 ? "" : "s"}`} note="Server-persisted sources" />
        <ConfigCard icon={MessageSquareText} label="Welcome message" value={record?.welcome_message ? "Configured" : "Not configured"} note={record?.welcome_message || "Add an opening message in the editor."} />
        <ConfigCard icon={Globe2} label="Allowed domain" value={domain || "Not configured"} note={domain ? "Approved widget origin" : "Required before publishing"} />
      </div> : <div className="grid gap-3 sm:grid-cols-3"><MetricCard label="Demo conversations" value={demo.conversations.toLocaleString()} icon={MessageSquareText} /><MetricCard label="Demo leads" value={demo.leads.toLocaleString()} icon={UsersRound} /><MetricCard label="Demo conversion" value={`${demo.conversionRate}%`} icon={Target} /></div>}

      <div className="grid gap-6 xl:grid-cols-[1fr_390px]">
        <div className="space-y-6">
          <Card className="border-slate-200/80 shadow-none"><CardHeader><CardTitle className="text-sm">Agent configuration</CardTitle><p className="text-xs text-slate-500">{connected ? "Current values from the API" : "Preview fixture configuration"}</p></CardHeader><CardContent className="space-y-4"><ConfigRow label="Agent ID" value={agentId} /><ConfigRow label="Status" value={status || "unknown"} /><ConfigRow label="Widget domain" value={domain || "Not configured"} />{connected && <ConfigRow label="Knowledge sources" value={String(record?.knowledge?.length || 0)} />}</CardContent></Card>
          {connected ? <Card className="border-dashed shadow-none"><CardContent className="p-6 text-center"><p className="text-sm font-semibold text-slate-800">Agent analytics are not available yet</p><p className="mx-auto mt-2 max-w-lg text-xs leading-5 text-slate-500">This page does not estimate performance, intent, readiness, or installation counts. Persisted conversations and leads are available in their respective portal views.</p></CardContent></Card> : <Card className="shadow-none"><CardHeader><CardTitle className="text-sm">Demo top intents</CardTitle><p className="text-xs text-slate-500">Illustrative analytics only</p></CardHeader><CardContent className="space-y-3">{["Plan and pricing questions", "Book a product demo", "Integration capabilities"].map((label, index) => <div key={label} className="flex items-center gap-3"><div className="h-1.5 flex-1 rounded-full bg-slate-100"><div className="h-full rounded-full bg-indigo-500" style={{ width: `${82 - index * 20}%` }} /></div><span className="w-36 text-[10px] text-slate-500">{label}</span></div>)}</CardContent></Card>}
        </div>
        <div><p className="mb-3 text-xs font-semibold text-slate-700">Conversation playground</p><AgentTestPanel agentId={agentId} agentName={name} welcomeMessage={connected ? record?.welcome_message : undefined} /></div>
      </div>
    </>}
  </div>;
}

function ConfigCard({ icon: Icon, label, value, note }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; note: string }) {
  return <Card className="shadow-none"><CardContent className="p-5"><span className="grid h-9 w-9 place-items-center rounded-xl bg-indigo-50 text-indigo-600"><Icon className="h-4 w-4" /></span><p className="mt-4 text-[10px] text-slate-400">{label}</p><p className="mt-1 text-sm font-bold text-slate-900">{value}</p><p className="mt-1 line-clamp-2 text-[10px] leading-4 text-slate-500">{note}</p></CardContent></Card>;
}

function MetricCard({ label, value, icon: Icon }: { label: string; value: string; icon: React.ComponentType<{ className?: string }> }) {
  return <Card className="shadow-none"><CardContent className="flex items-center justify-between p-5"><div><p className="text-xs text-slate-500">{label}</p><p className="mt-2 text-2xl font-bold text-slate-950">{value}</p></div><Icon className="h-5 w-5 text-indigo-500" /></CardContent></Card>;
}

function ConfigRow({ label, value }: { label: string; value: string }) {
  return <div className="flex flex-col justify-between gap-1 rounded-xl bg-slate-50 px-4 py-3 sm:flex-row sm:items-center"><span className="text-xs text-slate-500">{label}</span><span className="break-all text-xs font-semibold text-slate-800">{value}</span></div>;
}
