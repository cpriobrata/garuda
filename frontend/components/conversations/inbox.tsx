"use client";

import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowUp, Bot, CheckCircle2, Globe2, Inbox, Mail, Phone, Search, Sparkles, UserRound } from "lucide-react";
import { useDemoJourney } from "@/components/journey/demo-journey";
import { VisitorJourney } from "@/components/journey/visitor-journey";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiRequest, garudaApi, type ConversationDetail, type VisitorJourney as JourneyData } from "@/lib/api";
import { useBusyAction } from "@/lib/busy-action";
import { conversations as demoConversations, type Conversation } from "@/lib/demo-data";
import { cn } from "@/lib/utils";

type DisplayMessage = { id?: string; from: "visitor" | "agent" | "team"; text: string; time: string };

// A persisted turn carries `metadata` on the wire -- that is where the API records
// who wrote an assistant message -- but ConversationDetail in lib/api.ts does not
// declare the field and that file is not this component's to widen. The marker is
// read through this narrow local shape instead of an unchecked `any`.
type PersistedMessage = ConversationDetail["messages"][number] & { metadata?: { author?: string } | null };

// Mirrors maxTeamReplyLength in backend/internal/api/team_reply.go: the server
// rejects anything longer, so the composer stops the person before the round trip.
const maxReplyLength = 4000;
// The counter is noise until the limit is actually in view.
const counterThreshold = 3600;

function toDisplayMessage(message: PersistedMessage): DisplayMessage {
  // A team reply is stored with role "assistant" so the widget and the model both
  // read it as part of the same conversation; only the author marker separates a
  // person's answer from the model's.
  const operator = message.metadata?.author === "operator";
  return {
    id: message.id,
    from: message.role === "user" ? "visitor" : message.role === "assistant" && !operator ? "agent" : "team",
    text: message.content,
    time: new Date(message.created_at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }),
  };
}

const demoTranscript: DisplayMessage[] = [
  { from: "agent", text: "Hi Maya! I’m Aria from Northstar Labs. What brought you to our pricing page today?", time: "10:34" },
  { from: "visitor", text: "We’re evaluating tools to convert more site visitors into qualified demos. We get around 8,000 visitors a month.", time: "10:35" },
  { from: "agent", text: "How are you handling website conversations today?", time: "10:35" },
  { from: "visitor", text: "Mostly forms. Our sales team follows up, but it can take a day and we lose people.", time: "10:36" },
  { from: "agent", text: "Would a short walkthrough be useful?", time: "10:36" },
  { from: "visitor", text: "Yes. Thursday at 2 PM works perfectly. Can you send an invite?", time: "10:38" },
];

export function ConversationInbox() {
  const connected = Boolean(process.env.NEXT_PUBLIC_API_URL);
  const [items, setItems] = useState<Conversation[]>(connected ? [] : demoConversations);
  const [selected, setSelected] = useState(connected ? "" : demoConversations[0].id);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [detailError, setDetailError] = useState("");
  const [query, setQuery] = useState("");
  const [mobileDetail, setMobileDetail] = useState(false);
  const [reply, setReply] = useState("");
  const [replyError, setReplyError] = useState("");
  const [extraMessages, setExtraMessages] = useState<DisplayMessage[]>([]);
  const sendReply = useBusyAction();
  const demoJourney = useDemoJourney();
  const transcriptRef = useRef<HTMLDivElement>(null);
  // Read by an in-flight send to check the owner has not moved on to another
  // conversation before the response landed.
  const selectedRef = useRef(selected);
  const active = items.find((item) => item.id === selected);
  const filtered = useMemo(() => items.filter((item) => `${item.visitor} ${item.message} ${item.intent}`.toLowerCase().includes(query.toLowerCase())), [items, query]);

  useEffect(() => {
    garudaApi.listConversations().then((next) => {
      setItems(next);
      const requested = new URLSearchParams(window.location.search).get("id");
      setSelected((current) => requested && next.some((item) => item.id === requested) ? requested : next.some((item) => item.id === current) ? current : next[0]?.id || "");
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    selectedRef.current = selected;
    if (!connected || !selected) return;
    let alive = true;
    setDetail(null);
    setDetailError("");
    // Replies sent against the previous conversation belong to that transcript, not
    // to this one, and the failure notice goes with them. The draft goes too: a
    // half-written answer must not follow the owner into a different visitor's box.
    setExtraMessages([]);
    setReplyError("");
    setReply("");
    garudaApi.getConversation(selected)
      .then((value) => { if (alive) setDetail(value); })
      .catch((reason) => { if (alive) setDetailError(reason instanceof Error ? reason.message : "Transcript could not be retrieved."); });
    return () => { alive = false; };
  }, [connected, selected]);

  const messages: DisplayMessage[] = connected
    ? (detail?.messages || []).map((message) => toDisplayMessage(message as PersistedMessage))
    : (selected === demoConversations[0].id ? demoTranscript : [
      { from: "agent", text: "Hi! I’m Aria. What can I help you with today?", time: "Earlier" },
      ...(active ? [{ from: "visitor" as const, text: active.message, time: "Just now" }] : []),
    ]);
  const transcript = [...messages, ...extraMessages];
  // The API measures the trimmed reply in bytes -- Go's len() over a UTF-8 string --
  // so the counter does too. A JS character count would wave an emoji-heavy or CJK
  // reply past the button and let the server reject it as too long.
  const replyBytes = useMemo(() => new TextEncoder().encode(reply.trim()).length, [reply]);
  const overReplyLimit = replyBytes > maxReplyLength;
  const canSendReply = Boolean(reply.trim()) && !overReplyLimit;

  useEffect(() => {
    // A transcript is read from its newest end, and a reply that lands below the
    // fold reads as a send that did nothing.
    const pane = transcriptRef.current;
    if (pane) pane.scrollTop = pane.scrollHeight;
  }, [selected, transcript.length]);

  function send(event: FormEvent) {
    event.preventDefault();
    if (connected || !reply.trim()) return;
    setExtraMessages((current) => [...current, { from: "team", text: reply.trim(), time: "Now" }]);
    setReply("");
  }

  async function sendTeamReply() {
    const content = reply.trim();
    const conversationId = selected;
    if (!connected || !conversationId || !canSendReply) return;
    await sendReply.run(async () => {
      setReplyError("");
      try {
        const created = await apiRequest<{ message: PersistedMessage }>(`/conversations/${encodeURIComponent(conversationId)}/messages`, {
          method: "POST",
          body: JSON.stringify({ content }),
          timeoutMs: 20000,
        });
        // A send that outlives the conversation being open is still delivered; it
        // just must not surface in whichever transcript happens to be on screen.
        if (selectedRef.current !== conversationId) return;
        // The server's own copy is what gets rendered, so the id and the timestamp
        // in the transcript are the ones the visitor's widget will poll for -- not a
        // hopeful local echo that a failed write would have left behind.
        setExtraMessages((current) => [...current, toDisplayMessage(created.message)]);
        setReply("");
      } catch (reason) {
        if (selectedRef.current !== conversationId) return;
        // The draft is left in the box on purpose: losing a long reply to a network
        // blip costs far more than making someone press send a second time.
        setReplyError(reason instanceof Error ? reason.message : "The reply could not be sent.");
      }
    });
  }

  function replyKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends, Shift+Enter breaks the line. isComposing keeps an IME's Enter --
    // which commits a candidate word -- from firing the message off mid-sentence.
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void sendTeamReply();
  }

  // 100dvh where it exists: on a phone the browser chrome eats into 100vh, which
  // pushed the composer under the fold with nothing to scroll it back into view.
  return (
    <div className="-m-4 h-[calc(100vh-4rem)] overflow-hidden bg-white supports-[height:100dvh]:h-[calc(100dvh-4rem)] sm:-m-6 lg:-m-8">
      {/* The single explicit row is what lets the panes scroll instead of growing:
          an implicit auto row sizes to the transcript and overflows the container. */}
      <div className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)] md:grid-cols-[310px_1fr] xl:grid-cols-[330px_1fr_280px]">
        <aside className={cn("flex min-h-0 flex-col border-r bg-white", mobileDetail && "hidden md:flex")}>
          <div className="border-b p-4">
            <div className="flex items-center justify-between"><div><h1 className="text-lg font-bold tracking-tight text-slate-950">Conversations</h1><p className="mt-0.5 text-[10px] text-slate-500">{connected ? `${items.length} conversation${items.length === 1 ? "" : "s"}` : "3 need your attention · demo"}</p></div><Badge variant="secondary"><Inbox className="mr-1 h-3 w-3" /> {connected ? "All" : "Demo inbox"}</Badge></div>
            <div className="relative mt-4"><Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search conversations…" className="h-9 bg-slate-50 pl-9 text-xs shadow-none" /></div>
          </div>
          <div className="hide-scrollbar min-h-0 flex-1 overflow-y-auto">
            {!filtered.length && <div className="p-8 text-center"><Inbox className="mx-auto h-6 w-6 text-slate-300" /><p className="mt-3 text-xs font-semibold text-slate-700">No conversations found</p><p className="mt-1 text-[10px] text-slate-400">New widget conversations will appear here.</p></div>}
            {filtered.map((conversation, index) => (
              <button key={conversation.id} onClick={() => { setSelected(conversation.id); setMobileDetail(true); setExtraMessages([]); }} className={cn("flex w-full gap-3 border-b px-4 py-4 text-left transition hover:bg-slate-50", selected === conversation.id && "bg-indigo-50/65 md:border-l-2 md:border-l-indigo-600 md:pl-[14px]")}>
                <Avatar className="h-9 w-9"><AvatarFallback className={cn("text-[10px]", index % 2 ? "bg-cyan-100 text-cyan-700" : "bg-indigo-100 text-indigo-700")}>{conversation.initials}</AvatarFallback></Avatar>
                <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><p className="truncate text-xs font-semibold text-slate-900">{conversation.visitor}</p><span className="ml-auto shrink-0 text-[9px] text-slate-400">{conversation.time}</span></div><p className="mt-1 line-clamp-2 text-[10px] leading-4 text-slate-500">{conversation.message}</p><div className="mt-2"><ConversationStatus status={conversation.status} /></div></div>
              </button>
            ))}
          </div>
        </aside>

        <section className={cn("min-h-0 flex-col bg-[#fbfcfe]", mobileDetail ? "flex" : "hidden md:flex")}>
          {!active ? <div className="grid h-full place-items-center p-8 text-center"><div><Bot className="mx-auto h-8 w-8 text-slate-300" /><p className="mt-4 text-sm font-semibold text-slate-700">Select a conversation</p><p className="mt-1 text-xs text-slate-400">The persisted transcript will appear here.</p></div></div> : <>
            <div className="flex h-16 shrink-0 items-center border-b bg-white px-4 sm:px-5">
              <Button variant="ghost" size="icon" className="mr-1 h-8 w-8 md:hidden" onClick={() => setMobileDetail(false)}><ArrowLeft className="h-4 w-4" /></Button>
              <Avatar className="h-9 w-9"><AvatarFallback className="bg-indigo-100 text-[10px] font-bold text-indigo-700">{active.initials}</AvatarFallback></Avatar>
              <div className="ml-3 min-w-0"><div className="flex items-center gap-2"><p className="truncate text-xs font-semibold text-slate-900">{active.visitor}</p>{connected && detail?.lead ? <Badge variant="success" className="capitalize">{detail.lead.status}</Badge> : !connected ? <Badge variant="success">Demo · high intent</Badge> : null}</div><p className="mt-0.5 text-[9px] text-slate-400">{detail?.conversation.page_title || active.source}{connected && detail?.conversation.agent_id ? ` · Agent ${detail.conversation.agent_id}` : " · Aria (demo)"}</p></div>
              <div className="ml-auto pl-2">{connected ? null : <Button variant="outline" size="sm" className="h-8 text-[10px]"><UserRound className="mr-1.5 h-3.5 w-3.5" /> Demo takeover</Button>}</div>
            </div>
            <div ref={transcriptRef} className="hide-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8">
              <div className="mx-auto max-w-2xl">
                {/* The details rail only exists from xl up. Below that the journey
                    rides above the transcript, folded shut: it is the context for
                    the conversation, not a competitor for its space. */}
                {(connected ? Boolean(detail) : Boolean(demoJourney)) && <details className="mb-5 rounded-xl border bg-white p-3 shadow-sm xl:hidden">
                  <summary className="cursor-pointer text-[10px] font-bold uppercase tracking-[.13em] text-slate-500 marker:text-slate-300">{connected ? "Visitor journey" : "Demo visitor journey"}</summary>
                  <div className="mt-3"><VisitorJourney journey={connected ? detail?.conversation.journey : demoJourney} startedAt={connected ? detail?.conversation.created_at : undefined} /></div>
                </details>}
                <div className="mb-6 flex items-center gap-3"><div className="h-px flex-1 bg-slate-200" /><span className="text-[9px] font-medium text-slate-400">{detail?.conversation.created_at ? new Date(detail.conversation.created_at).toLocaleString() : connected ? "TRANSCRIPT" : "DEMO TRANSCRIPT"}</span><div className="h-px flex-1 bg-slate-200" /></div>
                {detailError && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-700">{detailError}</div>}
                {connected && !detail && !detailError && <div className="rounded-xl border border-dashed bg-white p-5 text-center text-xs text-slate-500">Retrieving the persisted transcript…</div>}
                {connected && detail && !messages.length && <div className="rounded-xl border border-dashed bg-white p-5 text-center text-xs text-slate-500">This conversation has no persisted messages yet.</div>}
                <div role="log" aria-live="polite" aria-relevant="additions" aria-label="Conversation transcript" className="space-y-4">{transcript.map((message, index) => <ChatMessage key={message.id || `${index}-${message.text}`} {...message} connected={connected} />)}</div>
                {!connected && active.status === "Needs you" && <div className="my-6 rounded-xl border border-amber-200 bg-amber-50 p-3"><div className="flex items-start gap-3"><Sparkles className="mt-1 h-4 w-4 text-amber-700" /><div><p className="text-xs font-semibold text-amber-900">Demo recommendation</p><p className="mt-1 text-[10px] leading-4 text-amber-700">Confirm the requested calendar time to keep momentum.</p></div></div></div>}
              </div>
            </div>
            {connected ? <form onSubmit={(event) => { event.preventDefault(); void sendTeamReply(); }} className="shrink-0 border-t bg-white p-3 sm:p-4"><div className="mx-auto max-w-2xl">{replyError && <p role="alert" className="mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[10px] leading-4 text-red-700">{replyError} Your reply is still in the box — send it again when you are ready.</p>}<div className="rounded-xl border bg-white shadow-sm focus-within:border-indigo-300"><label htmlFor="team-reply" className="sr-only">Reply to {active.visitor}</label><textarea id="team-reply" value={reply} onChange={(event) => setReply(event.target.value)} onKeyDown={replyKeyDown} aria-describedby="team-reply-hint team-reply-counter" aria-invalid={overReplyLimit || undefined} className="min-h-[68px] w-full resize-none rounded-t-xl bg-transparent px-3.5 py-3 text-xs outline-none" placeholder="Write a reply…" /><div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t bg-slate-50/50 px-3 py-2"><span id="team-reply-hint" className="text-[9px] leading-4 text-slate-400"><span className="hidden sm:inline">Enter to send · Shift+Enter for a new line · </span>The visitor sees this in their widget</span><span id="team-reply-counter" className={cn("text-[9px] tabular-nums", replyBytes < counterThreshold ? "sr-only" : overReplyLimit ? "font-semibold text-red-600" : "text-amber-600")}>{replyBytes.toLocaleString()}/4,000<span className="sr-only"> used of the 4,000 allowed</span></span><Button type="submit" size="sm" className="ml-auto h-7" disabled={!canSendReply} loading={sendReply.busy} loadingLabel="Sending your reply"><ArrowUp className="mr-1.5 h-3.5 w-3.5" /> Send</Button></div></div></div></form> : <form onSubmit={send} className="shrink-0 border-t bg-white p-3 sm:p-4"><div className="mx-auto max-w-2xl rounded-xl border bg-white shadow-sm"><textarea value={reply} onChange={(event) => setReply(event.target.value)} className="min-h-[68px] w-full resize-none rounded-t-xl px-3.5 py-3 text-xs outline-none" placeholder="Add a demo reply…" /><div className="flex items-center border-t bg-slate-50/50 px-2 py-2"><span className="text-[9px] text-slate-400">Demo-only reply</span><Button type="submit" size="icon" className="ml-auto h-7 w-7"><ArrowUp className="h-3.5 w-3.5" /></Button></div></div></form>}
          </>}
        </section>

        <aside className="hidden min-h-0 border-l bg-white xl:flex xl:flex-col">
          <div className="flex h-16 items-center border-b px-4"><p className="text-xs font-semibold text-slate-900">{connected ? "Conversation details" : "Demo visitor details"}</p></div>
          <div className="hide-scrollbar min-h-0 flex-1 overflow-y-auto p-4">
            {active ? <><div className="text-center"><Avatar className="mx-auto h-12 w-12"><AvatarFallback className="bg-indigo-100 text-xs font-bold text-indigo-700">{active.initials}</AvatarFallback></Avatar><p className="mt-3 text-sm font-semibold text-slate-900">{detail?.lead?.name || active.visitor}</p>{detail?.lead?.status && <Badge variant="success" className="mt-2 capitalize">{detail.lead.status}</Badge>}</div><div className="my-5 h-px bg-slate-100" />{connected ? <ConnectedDetails detail={detail} /> : <DemoDetails journey={demoJourney} />}</> : <p className="text-center text-xs text-slate-400">Select a conversation to inspect it.</p>}
          </div>
        </aside>
      </div>
    </div>
  );
}

function ConnectedDetails({ detail }: { detail: ConversationDetail | null }) {
  if (!detail) return <p className="text-xs leading-5 text-slate-500">Persisted visitor and page metadata will appear after the transcript loads.</p>;
  return <div className="space-y-1">
    {detail.lead ? <><p className="mb-3 text-[10px] font-bold uppercase tracking-[.13em] text-slate-400">Captured lead</p>{detail.lead.email && <Detail label="Email" value={detail.lead.email} icon={Mail} />}{detail.lead.phone && <Detail label="Phone" value={detail.lead.phone} icon={Phone} />}{detail.lead.company && <Detail label="Company" value={detail.lead.company} icon={UserRound} />}</> : <p className="rounded-lg bg-slate-50 p-3 text-[10px] leading-4 text-slate-500">No lead was captured in this conversation.</p>}
    <div className="my-5 h-px bg-slate-100" /><VisitorJourney journey={detail.conversation.journey} startedAt={detail.conversation.created_at} />
    <div className="my-5 h-px bg-slate-100" /><p className="mb-3 text-[10px] font-bold uppercase tracking-[.13em] text-slate-400">Page metadata</p>
    {detail.conversation.origin && <Detail label="Origin" value={detail.conversation.origin} icon={Globe2} />}{detail.conversation.page_title && <Detail label="Page" value={detail.conversation.page_title} icon={CheckCircle2} />}{detail.conversation.locale && <Detail label="Locale" value={detail.conversation.locale} icon={Globe2} />}
  </div>;
}

function DemoDetails({ journey }: { journey: JourneyData | null }) {
  return <><Detail label="Email" value="maya@northstar.example" icon={Mail} /><Detail label="Phone" value="+1 415 555 0138" icon={Phone} /><Detail label="Location" value="San Francisco, CA" icon={Globe2} /><div className="my-5 h-px bg-slate-100" /><VisitorJourney journey={journey} absentNote="The sample visit appears once this preview has loaded." /><div className="my-5 h-px bg-slate-100" /><p className="text-[10px] font-bold uppercase tracking-[.13em] text-slate-400">Demo AI summary</p><p className="mt-3 text-[11px] leading-5 text-slate-600">A sample high-intent visitor evaluating conversational AI and asking for a product walkthrough.</p></>;
}

function ChatMessage({ from, text, time, connected }: DisplayMessage & { connected: boolean }) {
  const isVisitor = from === "visitor";
  const isTeam = from === "team";
  return <div className={cn("flex items-end gap-2", isVisitor ? "justify-end" : "justify-start")}>{!isVisitor && <div className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-full text-[8px] font-bold text-white", isTeam ? "bg-violet-600" : "bg-indigo-600")}>{isTeam ? "T" : "AI"}</div>}<div className="min-w-0 max-w-[85%] sm:max-w-[80%]">{isTeam && <span className="mb-1 inline-flex items-center rounded-full bg-violet-100 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[.08em] text-violet-700">Team</span>}<div className={cn("break-words rounded-2xl px-3.5 py-2.5 text-xs leading-5", isVisitor ? "rounded-br-md bg-slate-950 text-white" : isTeam ? "rounded-bl-md border border-violet-200 bg-violet-50 text-violet-950" : "rounded-bl-md border bg-white text-slate-700 shadow-sm")}>{text}</div><p className={cn("mt-1 text-[8px] text-slate-400", isVisitor && "text-right")}>{isTeam ? (connected ? "Your team" : "Team") : from === "agent" ? (connected ? "AI agent" : "Aria · demo AI") : "Visitor"} · {time}</p></div></div>;
}

function ConversationStatus({ status }: { status: string }) {
  return <span className={cn("rounded-full px-2 py-0.5 text-[8px] font-semibold", status === "Needs you" ? "bg-amber-100 text-amber-700" : status === "AI active" ? "bg-emerald-100 text-emerald-700" : status === "Lead captured" ? "bg-indigo-100 text-indigo-700" : "bg-slate-100 text-slate-500")}>{status}</span>;
}

function Detail({ label, value, icon: Icon }: { label: string; value: string; icon: React.ComponentType<{ className?: string }> }) {
  return <div className="mb-3 flex items-center gap-3"><span className="grid h-8 w-8 place-items-center rounded-lg bg-slate-50 text-slate-400"><Icon className="h-3.5 w-3.5" /></span><div className="min-w-0"><p className="text-[9px] text-slate-400">{label}</p><p className="truncate text-[10px] font-medium text-slate-700">{value}</p></div></div>;
}
