"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, BrainCircuit, Check, MessageSquareText, PartyPopper, Sparkles, Target } from "lucide-react";
import { Brand } from "@/components/brand";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export default function GeneratingPage() {
  const connected = Boolean(process.env.NEXT_PUBLIC_API_URL);
  const [agent, setAgent] = useState({ id: connected ? "" : "aria-sales", name: connected ? "Your agent" : "Aria" });

  useEffect(() => {
    setAgent({
      id: window.sessionStorage.getItem("garuda_new_agent_id") || (connected ? "" : "aria-sales"),
      name: window.sessionStorage.getItem("garuda_new_agent_name") || (connected ? "Your agent" : "Aria"),
    });
  }, [connected]);

  return (
    <main className="relative min-h-screen overflow-hidden bg-slate-950 text-white">
      <div className="absolute inset-0 opacity-45 [background-image:radial-gradient(circle_at_50%_20%,#4f46e5_0,transparent_28%),radial-gradient(circle_at_80%_80%,#7c3aed_0,transparent_26%)]" />
      <div className="surface-grid absolute inset-0 opacity-10" />
      <header className="relative z-10 border-b border-white/10"><div className="container flex h-16 max-w-6xl items-center justify-between"><Brand href="/app" className="[&_span:last-child]:text-white" /><Badge className="border-white/10 bg-white/10 text-indigo-100">Setup complete</Badge></div></header>
      <div className="relative z-10 container flex min-h-[calc(100vh-4rem)] max-w-5xl items-center py-12">
        <div className="grid w-full items-center gap-12 lg:grid-cols-[.9fr_1.1fr]">
          <section>
            <div className="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-indigo-400 to-violet-500 shadow-[0_20px_60px_rgba(99,102,241,.4)]"><PartyPopper className="h-6 w-6" /></div>
            <p className="mt-7 text-xs font-bold uppercase tracking-[.18em] text-indigo-300">Your first agent is ready</p>
            <h1 className="mt-3 text-balance text-4xl font-bold tracking-[-.045em] sm:text-5xl">Meet {agent.name}, your new AI sales specialist.</h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-slate-300">{agent.name} has a tailored draft, conversation goal, and voice based on what you shared. Test the first conversation, then publish when it feels right.</p>
            <div className="mt-7 grid gap-3 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">{[
              { icon: BrainCircuit, label: "Draft", value: "Ready to review" },
              { icon: Target, label: "Primary goal", value: "From your answers" },
              { icon: MessageSquareText, label: "Voice", value: "Configured" },
            ].map((item) => <div key={item.label} className="rounded-xl border border-white/10 bg-white/[.055] p-3"><item.icon className="h-4 w-4 text-indigo-300" /><p className="mt-2 text-[10px] text-slate-400">{item.label}</p><p className="mt-0.5 text-xs font-semibold text-white">{item.value}</p></div>)}</div>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row"><Button size="lg" className="bg-white text-slate-950 hover:bg-slate-100" asChild><Link href={agent.id ? `/app/agents/${encodeURIComponent(agent.id)}` : "/app/agents"}>Test {agent.name} now <ArrowRight className="ml-2 h-4 w-4" /></Link></Button><Button size="lg" variant="outline" className="border-white/15 bg-white/5 text-white hover:bg-white/10 hover:text-white" asChild><Link href="/app">Go to dashboard</Link></Button></div>
          </section>
          <section className="relative mx-auto w-full max-w-lg">
            <div className="absolute -inset-8 rounded-full bg-indigo-600/20 blur-3xl" />
            <div className="relative rounded-3xl border border-white/10 bg-white/[.07] p-4 backdrop-blur-xl">
              <div className="overflow-hidden rounded-2xl bg-white text-slate-900 shadow-2xl">
                <div className="flex items-center gap-3 border-b p-4"><div className="grid h-10 w-10 place-items-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 font-bold text-white">{agent.name[0] || "A"}</div><div><p className="text-sm font-semibold">{agent.name}</p><p className="text-[11px] text-emerald-600">● Ready to help</p></div><Sparkles className="ml-auto h-4 w-4 text-indigo-500" /></div>
                <div className="space-y-4 bg-slate-50/60 p-5">
                  <AgentMessage>Hello! I’m {agent.name}{connected ? ". I’m ready to help visitors understand your business and find the right next step." : " from Northstar Labs. I help growing teams turn more website traffic into qualified opportunities."}</AgentMessage>
                  <AgentMessage>If you tell me what you’re working toward, I can point you in the right direction — what would make this conversation useful?</AgentMessage>
                  <div className="flex flex-wrap gap-2">{["Book more demos", "Improve lead quality", "See how it works"].map((item) => <span key={item} className="rounded-full border border-indigo-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-indigo-700">{item}</span>)}</div>
                </div>
                <div className="border-t p-4"><div className="flex h-10 items-center justify-between rounded-xl border bg-slate-50 px-3 text-xs text-slate-400">Type a message…<span className="grid h-7 w-7 place-items-center rounded-lg bg-indigo-600 text-white">↑</span></div></div>
              </div>
            </div>
            <div className="absolute -bottom-5 -left-5 hidden items-center gap-2 rounded-xl border border-white/10 bg-slate-900 px-3 py-2 shadow-xl sm:flex"><span className="grid h-7 w-7 place-items-center rounded-lg bg-emerald-500/15"><Check className="h-4 w-4 text-emerald-400" /></span><div><p className="text-[10px] text-slate-400">Agent draft generated</p><p className="text-xs font-semibold text-white">Review before publishing</p></div></div>
          </section>
        </div>
      </div>
    </main>
  );
}

function AgentMessage({ children }: { children: React.ReactNode }) {
  return <div className="flex justify-start"><div className="max-w-[88%] rounded-2xl rounded-bl-md border bg-white px-3.5 py-2.5 text-xs leading-5 text-slate-700 shadow-sm">{children}</div></div>;
}
