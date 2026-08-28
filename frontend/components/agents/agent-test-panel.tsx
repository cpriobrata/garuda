"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { ArrowUp, RotateCcw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { garudaApi } from "@/lib/api";

type TestMessage = { from: "agent" | "user"; text: string };

export function AgentTestPanel({ agentId = "aria-sales", agentName = "Agent", welcomeMessage }: { agentId?: string; agentName?: string; welcomeMessage?: string }) {
  const connected = Boolean(process.env.NEXT_PUBLIC_API_URL);
  const initial = useMemo<TestMessage[]>(() => [{ from: "agent", text: welcomeMessage || (connected ? "Ask a question to preview this agent’s current draft." : "Hi! I’m Aria from Northstar Labs. What are you hoping to achieve today?") }], [connected, welcomeMessage]);
  const [messages, setMessages] = useState<TestMessage[]>(initial);
  const [value, setValue] = useState("");

  useEffect(() => setMessages(initial), [initial]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!value.trim()) return;
    const content = value.trim();
    setMessages((current) => [...current, { from: "user", text: content }]);
    setValue("");
    try {
      const result = await garudaApi.previewAgentMessage(agentId, content);
      setMessages((current) => [...current, { from: "agent", text: result.message.content }]);
    } catch {
      setMessages((current) => [...current, { from: "agent", text: "I couldn’t run that preview. Check the agent configuration and try again." }]);
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border bg-white">
      <div className="flex items-center gap-3 border-b p-4"><div className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-xs font-bold text-white">{agentName[0]?.toUpperCase() || "A"}</div><div><p className="text-xs font-semibold text-slate-900">Test {agentName}</p><p className="text-[10px] text-emerald-600">Private preview</p></div><Button variant="ghost" size="icon" className="ml-auto h-8 w-8" onClick={() => setMessages(initial)} aria-label="Restart test"><RotateCcw className="h-3.5 w-3.5" /></Button></div>
      <div className="h-[275px] space-y-3 overflow-y-auto bg-slate-50/50 p-4">{messages.map((message, index) => <div key={`${index}-${message.text}`} className={cn("flex", message.from === "user" ? "justify-end" : "justify-start")}><div className={cn("max-w-[84%] rounded-2xl px-3 py-2.5 text-[11px] leading-5", message.from === "user" ? "rounded-br-md bg-slate-950 text-white" : "rounded-bl-md border bg-white text-slate-700")}>{message.text}</div></div>)}</div>
      <form onSubmit={submit} className="border-t p-3"><div className="relative"><Input value={value} onChange={(event) => setValue(event.target.value)} placeholder="Test a visitor question…" className="h-10 pr-10 text-xs" /><Button size="icon" type="submit" className="absolute right-1.5 top-1.5 h-7 w-7"><ArrowUp className="h-3.5 w-3.5" /></Button></div><p className="mt-2 flex items-center justify-center gap-1 text-[9px] text-slate-400"><Sparkles className="h-3 w-3" /> Private preview · not shown in the inbox</p></form>
    </div>
  );
}
