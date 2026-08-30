"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { ArrowUp, RotateCcw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useBusyAction } from "@/lib/busy-action";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { garudaApi } from "@/lib/api";

type TestMessage = { from: "agent" | "user"; text: string };

export function AgentTestPanel({ agentId = "aria-sales", agentName = "Agent", welcomeMessage }: { agentId?: string; agentName?: string; welcomeMessage?: string }) {
  const connected = Boolean(process.env.NEXT_PUBLIC_API_URL);
  const initial = useMemo<TestMessage[]>(() => [{ from: "agent", text: welcomeMessage || (connected ? "Ask a question to preview this agent’s current draft." : "Hi! I’m Aria from Northstar Labs. What are you hoping to achieve today?") }], [connected, welcomeMessage]);
  const [messages, setMessages] = useState<TestMessage[]>(initial);
  const [value, setValue] = useState("");
  // The preview is a live model call with a 60 second budget. Without this the
  // box cleared and the screen sat still for several seconds with nothing
  // moving, and a second Enter sent the question twice -- two model calls, two
  // replies, and no way to tell which answer belonged to which press.
  const send = useBusyAction();

  useEffect(() => setMessages(initial), [initial]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!value.trim() || send.isRunning()) return;
    const content = value.trim();
    setMessages((current) => [...current, { from: "user", text: content }]);
    setValue("");
    await send.run(async () => {
      try {
        const result = await garudaApi.previewAgentMessage(agentId, content);
        setMessages((current) => [...current, { from: "agent", text: result.message.content }]);
      } catch {
        setMessages((current) => [...current, { from: "agent", text: "I couldn’t run that preview. Check the agent configuration and try again." }]);
      }
    });
  }

  return (
    <div className="overflow-hidden rounded-xl border bg-white">
      <div className="flex items-center gap-3 border-b p-4"><div className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-xs font-bold text-white">{agentName[0]?.toUpperCase() || "A"}</div><div><p className="text-xs font-semibold text-slate-900">Test {agentName}</p><p className="text-[10px] text-emerald-600">Private preview</p></div><Button variant="ghost" size="icon" className="ml-auto h-8 w-8" onClick={() => setMessages(initial)} aria-label="Restart test"><RotateCcw className="h-3.5 w-3.5" /></Button></div>
      <div className="h-[275px] space-y-3 overflow-y-auto bg-slate-50/50 p-4">{messages.map((message, index) => <div key={`${index}-${message.text}`} className={cn("flex", message.from === "user" ? "justify-end" : "justify-start")}><div className={cn("max-w-[84%] rounded-2xl px-3 py-2.5 text-[11px] leading-5", message.from === "user" ? "rounded-br-md bg-slate-950 text-white" : "rounded-bl-md border bg-white text-slate-700")}>{message.text}</div></div>)}{send.busy ? <div className="flex justify-start"><p role="status" className="flex items-center gap-1.5 rounded-2xl rounded-bl-md border bg-white px-3 py-2.5 text-[11px] leading-5 text-slate-500"><span className="sr-only">Waiting for the agent’s reply</span><span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400" /><span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400 [animation-delay:150ms]" /><span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400 [animation-delay:300ms]" /></p></div> : null}</div>
      <form onSubmit={submit} className="border-t p-3"><div className="relative"><Input value={value} onChange={(event) => setValue(event.target.value)} placeholder="Test a visitor question…" className="h-10 pr-10 text-xs" disabled={send.busy} /><Button size="icon" type="submit" className="absolute right-1.5 top-1.5 h-7 w-7" loading={send.busy} loadingLabel="Waiting for the agent’s reply" disabled={send.busy || !value.trim()}><ArrowUp className="h-3.5 w-3.5" /></Button></div><p className="mt-2 flex items-center justify-center gap-1 text-[9px] text-slate-400"><Sparkles className="h-3 w-3" /> Private preview · not shown in the inbox</p></form>
    </div>
  );
}
