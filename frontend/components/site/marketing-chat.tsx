"use client";

import { useMemo, useState } from "react";
import { ArrowUp, Check, LockKeyhole, MoreHorizontal, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Message = { from: "agent" | "visitor"; text: string };

const opening: Message[] = [
  { from: "agent", text: "Hey! I’m Aria, Acme’s AI product specialist. What are you hoping to improve?" },
  { from: "visitor", text: "We’re getting traffic, but not enough qualified follow-up requests." },
  { from: "agent", text: "I can help. A focused agent can answer questions, understand intent, and ask for contact details with consent. Roughly how many visit each month?" },
  { from: "visitor", text: "Around 8,000." },
  { from: "agent", text: "Perfect fit. Based on that, I’d recommend a focused sales agent. Want to see the exact playbook?" },
];

export function MarketingChat() {
  const [messages, setMessages] = useState<Message[]>(opening);
  const [value, setValue] = useState("");
  const [booked, setBooked] = useState(false);

  const lastIsAgent = useMemo(() => messages[messages.length - 1]?.from === "agent", [messages]);

  function send(text = value) {
    const clean = text.trim();
    if (!clean) return;
    setMessages((current) => [...current, { from: "visitor", text: clean }, { from: "agent", text: "Great — I’ve got enough context. I’d suggest a 20-minute walkthrough tailored to your funnel." }]);
    setValue("");
  }

  return (
    <div className="relative mx-auto w-full max-w-[520px] animate-float">
      <div className="absolute -inset-6 -z-10 rounded-[42px] bg-gradient-to-br from-indigo-200/60 via-violet-100/30 to-cyan-100/50 blur-2xl" />
      <div className="overflow-hidden rounded-[24px] border border-slate-200/80 bg-white shadow-[0_30px_90px_rgba(41,37,92,.18)]">
        <div className="flex items-center justify-between border-b bg-white px-4 py-3.5 sm:px-5">
          <div className="flex items-center gap-3">
            <div className="relative grid h-10 w-10 place-items-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-sm font-bold text-white shadow-md shadow-indigo-200">A</div>
            <div>
              <div className="flex items-center gap-1.5"><p className="text-sm font-semibold text-slate-900">Aria from Acme</p><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /></div>
              <p className="text-[11px] text-slate-500">Interactive product demo</p>
            </div>
          </div>
          <Button size="icon" variant="ghost" className="h-8 w-8 text-slate-500" aria-label="Conversation menu"><MoreHorizontal className="h-4 w-4" /></Button>
        </div>

        <div className="h-[430px] overflow-y-auto bg-[linear-gradient(180deg,#fbfcff_0%,#fff_70%)] px-4 py-5 sm:px-5" aria-live="polite">
          <div className="mb-4 flex justify-center"><span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-medium text-slate-500">Today</span></div>
          <div className="space-y-3.5">
            {messages.map((message, index) => (
              <div key={`${index}-${message.text}`} className={cn("flex animate-enter", message.from === "visitor" ? "justify-end" : "justify-start")}>
                <div className={cn("max-w-[84%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed", message.from === "visitor" ? "rounded-br-md bg-slate-950 text-white" : "rounded-bl-md border border-slate-200 bg-white text-slate-700 shadow-sm")}>
                  {message.text}
                </div>
              </div>
            ))}
            {lastIsAgent && !booked && (
              <div className="ml-0 flex animate-enter flex-wrap gap-2 pt-1">
                <button onClick={() => { setBooked(true); send("Yes, show me the playbook"); }} className="inline-flex items-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100"><Sparkles className="h-3.5 w-3.5" /> Show me</button>
                <button onClick={() => send("Tell me more first")} className="rounded-full border bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50">Tell me more</button>
              </div>
            )}
            {booked && (
              <div className="animate-enter rounded-xl border border-emerald-200 bg-emerald-50 p-3.5">
                <div className="flex gap-3"><div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-emerald-600 text-white"><Check className="h-4 w-4" /></div><div><p className="text-xs font-semibold text-emerald-900">Example follow-up captured</p><p className="mt-0.5 text-[11px] text-emerald-700">The demo inbox now has the conversation context.</p></div><Check className="ml-auto h-4 w-4 text-emerald-600" /></div>
              </div>
            )}
          </div>
        </div>

        <form onSubmit={(event) => { event.preventDefault(); send(); }} className="border-t bg-white p-3.5">
          <div className="relative">
            <Input value={value} onChange={(event) => setValue(event.target.value)} placeholder="Type a message…" className="h-11 rounded-xl border-slate-200 bg-slate-50/70 pr-11 shadow-none" aria-label="Demo message" />
            <Button size="icon" type="submit" className="absolute right-1.5 top-1.5 h-8 w-8 rounded-lg"><ArrowUp className="h-4 w-4" /></Button>
          </div>
          <p className="mt-2 flex items-center justify-center gap-1.5 text-[10px] text-slate-400"><LockKeyhole className="h-3 w-3" /> UI preview · no message is submitted</p>
        </form>
      </div>
      <div className="absolute -left-5 top-28 hidden rounded-xl border bg-white px-3 py-2 shadow-soft sm:block">
        <p className="text-[10px] font-medium text-slate-500">Illustrative intent</p><p className="mt-0.5 text-sm font-bold text-slate-900">High interest · demo</p>
      </div>
      <div className="absolute -right-6 bottom-28 hidden rounded-xl border bg-white px-3 py-2 shadow-soft sm:block">
        <div className="flex items-center gap-2"><span className="grid h-6 w-6 place-items-center rounded-md bg-emerald-50"><Check className="h-3.5 w-3.5 text-emerald-600" /></span><div><p className="text-[10px] font-medium text-slate-500">Example lead</p><p className="text-xs font-bold text-slate-900">Saved to demo inbox</p></div></div>
      </div>
    </div>
  );
}
