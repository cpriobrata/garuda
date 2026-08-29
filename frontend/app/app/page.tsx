"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Bot, ChevronRight, MessageSquareText, MousePointerClick, Plus, Sparkles, UsersRound } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { garudaApi } from "@/lib/api";
import { agents as seededAgents, chartData, conversations as seededConversations, type Agent, type Conversation } from "@/lib/demo-data";
import { cn } from "@/lib/utils";

type Metrics = { agents: number; published_agents: number; conversations: number; messages: number; leads: number; lead_conversion_rate: number };

const demoMetrics: Metrics = { agents: 3, published_agents: 2, conversations: 2131, messages: 8492, leads: 364, lead_conversion_rate: 17.1 };

export default function DashboardPage() {
  const connected = Boolean(process.env.NEXT_PUBLIC_API_URL);
  const [name, setName] = useState(connected ? "there" : "Maya");
  const [metrics, setMetrics] = useState<Metrics | null>(connected ? null : demoMetrics);
  const [activity, setActivity] = useState<number[]>(connected ? [] : chartData);
  const [agentItems, setAgentItems] = useState<Agent[]>(connected ? [] : seededAgents);
  const [conversationItems, setConversationItems] = useState<Conversation[]>(connected ? [] : seededConversations);
  // The date has to be produced in the browser after mount. Formatting it while
  // rendering bakes the build date into the prerendered page and then disagrees
  // with the browser during hydration.
  const [today, setToday] = useState("");

  useEffect(() => {
    setToday(new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long" }).format(new Date()));
  }, []);

  useEffect(() => {
    if (!connected) return;
    Promise.allSettled([garudaApi.me(), garudaApi.dashboard(), garudaApi.listAgents(), garudaApi.listConversations()]).then(([meResult, dashboardResult, agentsResult, conversationsResult]) => {
      if (meResult.status === "fulfilled") setName(meResult.value.user.name?.trim() || meResult.value.user.email.split("@")[0] || "there");
      if (dashboardResult.status === "fulfilled") {
        setMetrics(dashboardResult.value.metrics);
        setActivity(dashboardResult.value.activity.map((point) => point.conversations));
      }
      if (agentsResult.status === "fulfilled") setAgentItems(agentsResult.value);
      if (conversationsResult.status === "fulfilled") setConversationItems(conversationsResult.value);
    });
  }, [connected]);

  const stats = [
    { label: "Agents", value: metrics?.agents, note: metrics ? `${metrics.published_agents} published` : "Awaiting API", icon: Bot },
    { label: "Conversations", value: metrics?.conversations, note: connected ? "Server-recorded total" : "Demo total", icon: MessageSquareText },
    { label: "Messages", value: metrics?.messages, note: connected ? "Persisted messages" : "Demo total", icon: Sparkles },
    { label: "Leads", value: metrics?.leads, note: metrics ? `${metrics.lead_conversion_rate.toFixed(1)}% conversion` : "Awaiting API", icon: UsersRound },
  ];

  return <div className="mx-auto max-w-[1440px] space-y-6">
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-xs font-medium text-indigo-600">{today || "\u00A0"}</p><h1 className="mt-1 text-2xl font-bold tracking-[-.03em] text-slate-950 sm:text-3xl">Welcome back, {name}.</h1><p className="mt-1.5 text-sm text-slate-500">Your workspace activity and customer conversations at a glance.</p></div><div className="flex gap-2"><Button variant="outline" size="sm" asChild><Link href="/app/widget"><MousePointerClick className="mr-1.5 h-3.5 w-3.5" /> Install widget</Link></Button><Button size="sm" asChild><Link href="/app/agents/new"><Plus className="mr-1.5 h-3.5 w-3.5" /> Create agent</Link></Button></div></div>

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{stats.map((stat) => <Card key={stat.label} className="shadow-none"><CardContent className="p-5"><div className="flex items-start justify-between"><div><p className="text-xs text-slate-500">{stat.label}</p><p className="mt-2 text-2xl font-bold tracking-tight text-slate-950">{typeof stat.value === "number" ? stat.value.toLocaleString() : "—"}</p></div><span className="grid h-9 w-9 place-items-center rounded-xl bg-indigo-50 text-indigo-600"><stat.icon className="h-4 w-4" /></span></div><p className="mt-3 text-[10px] text-slate-400">{stat.note}</p></CardContent></Card>)}</div>

    <div className="grid gap-6 xl:grid-cols-[1.5fr_.72fr]">
      <Card className="shadow-none"><CardHeader><CardTitle className="text-sm">Conversation activity</CardTitle><p className="text-xs text-slate-500">{connected ? "Daily totals returned by the dashboard API" : "Fourteen-day demo preview"}</p></CardHeader><CardContent>{activity.length > 1 ? <ConversationChart data={activity} /> : <div className="grid h-[220px] place-items-center rounded-xl border border-dashed bg-slate-50 text-center"><div><MessageSquareText className="mx-auto h-6 w-6 text-slate-300" /><p className="mt-3 text-xs font-semibold text-slate-700">No activity series yet</p><p className="mt-1 text-[10px] text-slate-400">Conversation history will appear after widget traffic arrives.</p></div></div>}</CardContent></Card>
      <Card className="border-slate-800 bg-gradient-to-br from-slate-950 to-indigo-950 text-white shadow-none"><CardContent className="flex h-full min-h-[300px] flex-col p-6"><span className="grid h-10 w-10 place-items-center rounded-xl bg-white/10 text-indigo-200"><Sparkles className="h-5 w-5" /></span>{connected ? <><h2 className="mt-8 text-xl font-semibold">Workspace insights are coming soon.</h2><p className="mt-3 text-sm leading-6 text-slate-300">Garuda will surface grounded trends after enough real conversation activity is available. No estimated recommendations are shown.</p><Button variant="secondary" size="sm" className="mt-auto w-fit" asChild><Link href="/app/conversations">Review conversations <ArrowRight className="ml-1.5 h-3.5 w-3.5" /></Link></Button></> : <><Badge className="mt-6 w-fit border-white/10 bg-white/10 text-indigo-100">Demo insight</Badge><h2 className="mt-4 text-xl font-semibold">Pricing visitors are ready to talk.</h2><p className="mt-3 text-sm leading-6 text-slate-300">Illustrative preview: a sales agent can reveal where visitors need the most help.</p><Button variant="secondary" size="sm" className="mt-auto w-fit" asChild><Link href="/app/agents/aria-sales">Open demo agent <ArrowRight className="ml-1.5 h-3.5 w-3.5" /></Link></Button></>}</CardContent></Card>
    </div>

    <div className="grid gap-6 xl:grid-cols-[1.08fr_.92fr]">
      <Card className="shadow-none"><CardHeader className="flex-row items-center justify-between"><div><CardTitle className="text-sm">Recent conversations</CardTitle><p className="text-xs text-slate-500">{connected ? "Latest persisted threads" : "Demo visitor threads"}</p></div><Button variant="ghost" size="sm" asChild><Link href="/app/conversations">View inbox <ChevronRight className="ml-1 h-3.5 w-3.5" /></Link></Button></CardHeader><CardContent className="px-3 pb-3"><div className="divide-y">{conversationItems.slice(0, 5).map((conversation, index) => <Link key={conversation.id} href={`/app/conversations?id=${conversation.id}`} className="flex items-center gap-3 rounded-lg px-3 py-3 hover:bg-slate-50"><Avatar className="h-9 w-9"><AvatarFallback className={cn("text-[10px]", index % 2 ? "bg-cyan-100 text-cyan-700" : "bg-indigo-100 text-indigo-700")}>{conversation.initials}</AvatarFallback></Avatar><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold text-slate-900">{conversation.visitor}</p><p className="mt-1 truncate text-[11px] text-slate-500">{conversation.message}</p></div><Badge variant="secondary">{conversation.status}</Badge></Link>)}{!conversationItems.length && <Empty text="No conversations yet" />}</div></CardContent></Card>
      <Card className="shadow-none"><CardHeader className="flex-row items-center justify-between"><div><CardTitle className="text-sm">Agents</CardTitle><p className="text-xs text-slate-500">{connected ? "Current server records" : "Demo workspace"}</p></div><Button variant="ghost" size="sm" asChild><Link href="/app/agents">All agents <ChevronRight className="ml-1 h-3.5 w-3.5" /></Link></Button></CardHeader><CardContent className="space-y-3">{agentItems.map((agent) => <Link href={`/app/agents/${agent.id}`} key={agent.id} className="flex items-center gap-3 rounded-xl border p-3 hover:border-indigo-200 hover:bg-indigo-50/30"><div className={cn("grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br text-xs font-bold text-white", agent.color)}>{agent.name[0]}</div><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold text-slate-900">{agent.name}</p><p className="mt-1 truncate text-[10px] text-slate-500">{agent.description}</p></div><Badge variant={agent.status === "live" ? "success" : "secondary"} className="capitalize">{agent.status}</Badge></Link>)}{!agentItems.length && <Empty text="No agents yet" />}</CardContent></Card>
    </div>

    <div className="flex flex-col items-start gap-4 rounded-xl border border-indigo-200 bg-indigo-50/40 p-5 sm:flex-row sm:items-center"><span className="grid h-11 w-11 place-items-center rounded-xl bg-indigo-600 text-white"><Sparkles className="h-5 w-5" /></span><div className="flex-1"><p className="text-sm font-semibold text-indigo-950">Build a focused customer experience</p><p className="mt-1 text-xs text-indigo-700">Add approved knowledge, test the private preview, and configure an allowed domain before publishing.</p></div><Button variant="outline" className="border-indigo-200 bg-white text-indigo-700" asChild><Link href="/app/agents">Review agents <ArrowRight className="ml-2 h-3.5 w-3.5" /></Link></Button></div>
  </div>;
}

function Empty({ text }: { text: string }) {
  return <div className="py-8 text-center text-xs text-slate-400">{text}</div>;
}

function ConversationChart({ data }: { data: number[] }) {
  const width = 700; const height = 185; const max = Math.max(...data, 1); const min = Math.min(...data, 0); const span = Math.max(max - min, 1); const step = width / Math.max(data.length - 1, 1);
  const points = data.map((value, index) => `${index * step},${height - 15 - ((value - min) / span) * (height - 40)}`).join(" ");
  return <svg viewBox={`0 0 ${width} ${height}`} className="h-[220px] w-full" preserveAspectRatio="none" role="img" aria-label="Conversation activity"><defs><linearGradient id="dashboardArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#6366f1" stopOpacity=".28" /><stop offset="100%" stopColor="#6366f1" stopOpacity="0" /></linearGradient></defs>{[20, 60, 100, 140, 180].map((y) => <line key={y} x1="0" y1={y} x2={width} y2={y} stroke="#eef0f4" />)}<polygon points={`0,${height} ${points} ${width},${height}`} fill="url(#dashboardArea)" /><polyline points={points} fill="none" stroke="#6366f1" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
