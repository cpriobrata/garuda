"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUp, Building2, CalendarCheck, Check, MessageSquareText, Mic, Sparkles, Tag, Target, UsersRound } from "lucide-react";
import { Brand } from "@/components/brand";
import { Badge } from "@/components/ui/badge";
import { Button, Spinner } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import {
  agentNameLimit,
  detectRecordingSupport,
  loadVoiceCapability,
  readRecordingEnvironment,
  saveVoiceDetails,
  VoiceOnboarding,
  voiceDetailsFailureMessage,
  type RecordingSupport,
  type VoiceCapability,
  type VoiceOnboardingResult,
} from "@/components/voice";
import { garudaApi } from "@/lib/api";
import { keepBusyUntilNavigation, useBusyAction } from "@/lib/busy-action";
import { cn } from "@/lib/utils";

type Question = {
  id: string;
  prompt: string;
  helper: string;
  // The step name in the side rail.
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  kind: "text" | "url" | "choices" | "textarea";
  // Where the answer belongs on the server. "answers" goes into the onboarding
  // answers map; "details" goes to the voice details endpoint, which is the
  // only route that stores those two — see saveOnboardingDetails below.
  target: "answers" | "details";
  placeholder?: string;
  maxLength?: number;
  choices?: { label: string; description: string; value: string }[];
  // Returns a message when the answer cannot be sent as typed, "" when it can.
  validate?: (answer: string) => string;
  response: (answer: string) => string;
};

const questions: Question[] = [
  { id: "business_profile", label: "Your business", prompt: "First, tell me about your business.", helper: "Share its name, what it offers, and your website if you have one.", icon: Building2, kind: "textarea", target: "answers", placeholder: "e.g. Northstar Labs helps growth teams improve website conversion — northstarlabs.com", response: (answer) => `${answer.split(/[—,-]/)[0].trim()} — got it. Let’s give your agent the right customer context.` },
  { id: "audience_and_offer", label: "Ideal customer", prompt: "Who is your ideal customer, and what should the agent help them with?", helper: "A clear answer helps your agent recognize high-intent visitors and discuss the right offer.", icon: UsersRound, kind: "textarea", target: "answers", placeholder: "Tell me who you serve, what they need, and which products or services matter most…", response: () => "That’s helpful. I can already see how to make the conversation feel specific to your buyers." },
  { id: "primary_outcome", label: "Primary goal", prompt: "What is the #1 outcome you want from conversations?", helper: "Pick the action your agent should optimize for first.", icon: Target, kind: "choices", target: "answers", choices: [
    { label: "Arrange more follow-ups", description: "Qualify visitors and offer a clear human next step", value: "book_meetings" },
    { label: "Capture qualified leads", description: "Collect contact details after explicit consent", value: "capture_leads" },
    { label: "Answer support questions", description: "Resolve common questions and hand off edge cases", value: "support" },
    { label: "Recommend products", description: "Guide shoppers toward the right product or plan", value: "recommend" },
  ], response: (answer) => `${labelFor(answer)} is a strong primary goal. I’ll make every conversation work toward that naturally.` },
  { id: "voice_and_capture", label: "Agent type & voice", prompt: "What kind of teammate should I create?", helper: "This sets its tone and opening approach. Garuda will ask for contact details only after providing value.", icon: MessageSquareText, kind: "choices", target: "answers", choices: [
    { label: "Sales specialist", description: "Consultative, confident and focused on conversion", value: "sales" },
    { label: "Lead qualifier", description: "Efficient, curious and great at finding fit", value: "qualifier" },
    { label: "Customer concierge", description: "Warm, helpful and experience-focused", value: "concierge" },
    { label: "Support expert", description: "Clear, patient and resolution-oriented", value: "support_expert" },
  ], response: () => "Excellent choice. Two short questions and your agent is ready to be built." },
  { id: "agent_display_name", label: "Agent name", prompt: "What should your agent be called?", helper: "Visitors see this name at the top of the chat, so pick something that sounds like your business.", icon: Tag, kind: "text", target: "details", placeholder: "e.g. Aria", maxLength: agentNameLimit, validate: (answer) => (answer.length < 2 ? "An agent name needs at least two characters." : ""), response: (answer) => `${answer} it is. One last question.` },
  { id: "offer_booking", label: "Appointments", prompt: "Does your business take appointments?", helper: "Turn this on if visitors should be able to arrange a call or a visit with you.", icon: CalendarCheck, kind: "choices", target: "details", choices: [
    { label: "Yes, we take appointments", description: "The agent can offer times and arrange a slot", value: "true" },
    { label: "No, not for now", description: "The agent answers questions and passes people on", value: "false" },
  ], response: () => "Perfect. I have everything I need to build your first Garuda agent." },
];

function labelFor(value: string) {
  return questions.flatMap((question) => question.choices || []).find((choice) => choice.value === value)?.label || value;
}

// Only the four question ids PUT /v1/onboarding recognises. The other two are
// dropped by that endpoint anyway; filtering them here keeps the request honest
// about what it is asking the server to store.
function businessAnswers(all: Record<string, string>) {
  const result: Record<string, string> = {};
  for (const question of questions) {
    if (question.target === "answers" && all[question.id]) result[question.id] = all[question.id];
  }
  return result;
}

// The next question with no answer yet, or -1 when every question is answered.
// Voice fills four of the six in one go, so the flow cannot simply step by one.
function firstUnanswered(all: Record<string, string>, from: number) {
  for (let index = Math.max(0, from); index < questions.length; index += 1) {
    if (!all[questions[index].id]) return index;
  }
  return -1;
}

export function OnboardingFlow() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [value, setValue] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [history, setHistory] = useState<{ from: "garuda" | "user"; text: string }[]>([
    { from: "garuda", text: "Welcome — I’m Garuda. I’ll create your first AI agent with you through a few useful business questions." },
  ]);
  const [error, setError] = useState("");
  // Typing is the flow. Voice is a route through the first questions that the
  // owner has to choose, and can leave at any point.
  const [mode, setMode] = useState<"typing" | "voice">("typing");
  const [capability, setCapability] = useState<VoiceCapability | null>(null);
  const [support, setSupport] = useState<RecordingSupport | null>(null);
  const complete = useBusyAction();
  // The step this flow has already answered. A ref, not state: the second of
  // two fast clicks arrives before React has re-rendered, so a state read would
  // still say the question is unanswered — and on the last question that second
  // answer is another full agent generation, billed and capable of colliding
  // with the first.
  const answeredStep = useRef(-1);
  const answersReference = useRef(answers);
  answersReference.current = answers;
  // What the details endpoint already holds, so the same two answers are not
  // written twice on the way to generating the agent.
  const savedDetails = useRef("");
  const conversation = useRef<HTMLDivElement | null>(null);
  const current = questions[step];
  const answeredCount = useMemo(() => questions.filter((question) => answers[question.id]).length, [answers]);
  const progress = Math.min(100, Math.round(((answeredCount + 1) / questions.length) * 100));

  // Two questions asked once, on mount, and neither of them touches the
  // microphone: whether this workspace has transcription configured at all, and
  // whether this browser could record if it were offered. The microphone itself
  // is requested only after the owner has pressed record.
  useEffect(() => {
    setSupport(detectRecordingSupport(readRecordingEnvironment()));
    let listening = true;
    void loadVoiceCapability().then((loaded) => {
      if (listening) setCapability(loaded);
    });
    return () => {
      listening = false;
    };
  }, []);

  // A spoken answer is far longer than a typed one, so the newest message can
  // easily sit below the fold along with the question that follows it.
  useEffect(() => {
    const element = conversation.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [history, step]);

  const saveOnboardingDetails = useCallback(async (agentDisplayName: string, offerBooking: boolean) => {
    const fingerprint = JSON.stringify([agentDisplayName, offerBooking]);
    if (savedDetails.current === fingerprint) return;
    await saveVoiceDetails({ agentDisplayName, offerBooking });
    savedDetails.current = fingerprint;
  }, []);

  const finish = useCallback(
    async (all: Record<string, string>) => {
      await complete.run(async () => {
        try {
          await saveOnboardingDetails(all.agent_display_name, all.offer_booking === "true");
        } catch (reason) {
          setError(voiceDetailsFailureMessage(reason));
          answeredStep.current = -1;
          return;
        }
        try {
          const result = await garudaApi.completeOnboarding(businessAnswers(all));
          window.sessionStorage.setItem("garuda_new_agent_id", result.agent_id);
          window.sessionStorage.setItem("garuda_new_agent_name", result.agent_name);
          router.push("/app/generating");
          // Building the agent takes a while and the route is already changing,
          // so the control stays busy rather than inviting another attempt.
          return keepBusyUntilNavigation;
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : "We couldn’t save your answers. Please try again.");
          // The attempt failed, so this question is open for answering again.
          answeredStep.current = -1;
        }
      });
    },
    [complete, router, saveOnboardingDetails],
  );

  async function answer(nextValue: string) {
    const clean = nextValue.trim();
    if (!clean) return;
    if (answeredStep.current === step) return;
    const invalid = current.validate?.(clean) || "";
    if (invalid) {
      setError(invalid);
      return;
    }
    answeredStep.current = step;
    const nextAnswers = { ...answers, [current.id]: clean };
    setAnswers(nextAnswers);
    setHistory((items) => [...items, { from: "user", text: current.kind === "choices" ? labelFor(clean) : clean }, { from: "garuda", text: current.response(clean) }]);
    setValue("");
    setError("");
    const next = firstUnanswered(nextAnswers, step + 1);
    if (next >= 0) {
      setStep(next);
      return;
    }
    await finish(nextAnswers);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    answer(value);
  }

  // What the recorder hands back, folded into the same answers a typed session
  // produces. Anything it throws is shown inside the voice panel, where the
  // owner still has their transcript and can try again.
  const completeByVoice = useCallback(
    async (result: VoiceOnboardingResult) => {
      try {
        await saveOnboardingDetails(result.agentName, result.booksAppointments);
      } catch (reason) {
        throw new Error(voiceDetailsFailureMessage(reason));
      }
      const nextAnswers = {
        ...answersReference.current,
        // One recording answers both written questions. The panel asks for what
        // the business sells, who buys it, and what the agent should do, which
        // is the ground those two cover between them — asking either of them
        // again in text would be asking for what was just said out loud.
        business_profile: result.transcript,
        audience_and_offer: result.transcript,
        agent_display_name: result.agentName,
        offer_booking: String(result.booksAppointments),
      };
      setAnswers(nextAnswers);
      setHistory((items) => [
        ...items,
        { from: "user", text: result.transcript },
        {
          from: "garuda",
          text: `Got that in your own words. Your agent is ${result.agentName}, and it ${result.booksAppointments ? "can arrange appointments" : "will pass people on rather than book"}. Two quick taps and I can build it.`,
        },
      ]);
      setMode("typing");
      setError("");
      answeredStep.current = -1;
      const next = firstUnanswered(nextAnswers, 0);
      if (next >= 0) {
        setStep(next);
        return;
      }
      await finish(nextAnswers);
    },
    [finish, saveOnboardingDetails],
  );

  // Voice is offered only before anything has been written, because it answers
  // both written questions at once and would otherwise replace an answer the
  // owner had already typed.
  const untouched = !answers.business_profile && !answers.audience_and_offer;
  const voiceOffered = untouched && capability?.enabled === true && support?.supported === true;
  // Transcription is configured, but this browser cannot record. Saying so once,
  // quietly, beats a button that leads to a dead end.
  const voiceBlockedByBrowser = untouched && capability?.enabled === true && support !== null && !support.supported;

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#f8f9fc]">
      <div className="surface-grid pointer-events-none absolute inset-0" />
      <header className="relative z-10 border-b bg-white/85 backdrop-blur-xl"><div className="container flex h-16 max-w-6xl items-center justify-between"><Brand /><div className="flex items-center gap-3"><span className="hidden text-xs font-medium text-slate-500 sm:inline">Agent setup</span><span className="text-xs font-bold text-slate-900">{Math.min(answeredCount + 1, questions.length)} / {questions.length}</span></div></div></header>
      <div className="relative z-10 container grid min-h-[calc(100vh-4rem)] max-w-6xl gap-8 py-8 lg:grid-cols-[.8fr_1.2fr] lg:items-center lg:py-12">
        <section className="hidden lg:block">
          <Badge variant="purple" className="mb-5"><Sparkles className="mr-1.5 h-3.5 w-3.5" /> AI-guided setup</Badge>
          <h1 className="max-w-md text-4xl font-bold tracking-[-.045em] text-slate-950">A brilliant agent starts with a little context.</h1>
          <p className="mt-4 max-w-md text-sm leading-6 text-slate-600">Your answers create the first version. You’ll be able to review, test and change every detail before going live.</p>
          <div className="mt-9 max-w-sm space-y-4">
            {questions.map((question) => {
              const done = Boolean(answers[question.id]);
              const active = mode === "typing" && question.id === current.id;
              return (
                <div key={question.id} className={cn("flex items-center gap-3 text-sm transition motion-reduce:transition-none", done || active ? "text-slate-900" : "text-slate-400")}>
                  <span className={cn("grid h-8 w-8 place-items-center rounded-lg border", done ? "border-emerald-200 bg-emerald-50 text-emerald-600" : active ? "border-indigo-200 bg-indigo-50 text-indigo-600" : "bg-white")}>
                    {done ? <Check className="h-4 w-4" /> : <question.icon className="h-4 w-4" />}
                  </span>
                  <span className="font-medium">{question.label}</span>
                </div>
              );
            })}
          </div>
          <div className="mt-9 max-w-sm"><div className="mb-2 flex justify-between text-[10px] font-semibold text-slate-500"><span>SETUP PROGRESS</span><span>{progress}%</span></div><Progress value={progress} /></div>
        </section>

        {mode === "voice" ? (
          <VoiceOnboarding
            capability={capability ?? undefined}
            submitLabel="Save and continue"
            submitLoadingLabel="Saving your answers"
            onComplete={completeByVoice}
            onSkip={() => {
              setError("");
              setMode("typing");
            }}
          />
        ) : (
        <section className="mx-auto w-full max-w-2xl overflow-hidden rounded-3xl border bg-white shadow-[0_30px_90px_rgba(41,37,92,.11)]">
          <div className="flex items-center gap-3 border-b px-5 py-4 sm:px-6"><div className="relative grid h-10 w-10 place-items-center rounded-xl bg-slate-950"><Brand compact className="scale-75" /><span className="absolute -bottom-1 -right-1 h-3 w-3 rounded-full border-2 border-white bg-emerald-500" /></div><div><p className="text-sm font-semibold text-slate-900">Garuda setup guide</p><p className="text-[11px] text-slate-500">Building your agent with you</p></div><span className="ml-auto rounded-full bg-indigo-50 px-2.5 py-1 text-[10px] font-semibold text-indigo-700 lg:hidden">{Math.min(answeredCount + 1, questions.length)} of {questions.length}</span></div>
          <div ref={conversation} className="hide-scrollbar h-[280px] overflow-y-auto bg-slate-50/50 px-5 py-5 sm:h-[340px] sm:px-6">
            <div className="space-y-3">
              {history.map((message, index) => <div key={`${index}-${message.text}`} className={cn("flex", message.from === "user" ? "justify-end" : "justify-start")}><div className={cn("max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-6", message.from === "user" ? "rounded-br-md bg-slate-950 text-white" : "rounded-bl-md border bg-white text-slate-700 shadow-sm")}>{message.text}</div></div>)}
              <div className="flex justify-start animate-enter"><div className="max-w-[85%] rounded-2xl rounded-bl-md border border-indigo-100 bg-indigo-50/60 px-4 py-3"><p className="text-sm font-medium leading-6 text-indigo-950">{current.prompt}</p><p className="mt-1 text-xs leading-5 text-indigo-700/80">{current.helper}</p></div></div>
            </div>
          </div>
          <div className="border-t bg-white p-4 sm:p-5">
            {current.kind === "choices" ? (
              <div className="grid gap-2 sm:grid-cols-2">{current.choices?.map((choice) => { const chosen = complete.busy && answers[current.id] === choice.value; return <button key={choice.value} onClick={() => answer(choice.value)} disabled={complete.busy} aria-busy={chosen || undefined} className={cn("group rounded-xl border p-3 text-left transition focus:outline-none focus:ring-2 focus:ring-indigo-500/20", complete.busy ? "cursor-progress" : "hover:border-indigo-300 hover:bg-indigo-50/50", complete.busy && !chosen && "opacity-50")}><div className="flex items-start gap-3"><span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center">{chosen ? <Spinner className="h-4 w-4 text-indigo-600" /> : <span className={cn("h-4 w-4 rounded-full border-2 border-slate-300 transition", !complete.busy && "group-hover:border-indigo-500")} />}</span><div><p className="text-xs font-semibold text-slate-900">{choice.label}</p><p className="mt-1 text-[10px] leading-4 text-slate-500">{choice.description}</p>{chosen && <p className="mt-1 text-[10px] font-semibold text-indigo-600">Building your agent…</p>}</div></div></button>; })}</div>
            ) : (
              <form onSubmit={submit} className="relative">
                {current.kind === "textarea" ? <Textarea value={value} onChange={(event) => setValue(event.target.value)} placeholder={current.placeholder} className="min-h-[90px] resize-none pr-12" autoFocus /> : <Input value={value} onChange={(event) => setValue(event.target.value)} type={current.kind === "url" ? "url" : "text"} placeholder={current.placeholder} maxLength={current.maxLength} className="h-12 pr-12" autoFocus />}
                <Button type="submit" size="icon" className={cn("absolute right-2 h-8 w-8", current.kind === "textarea" ? "bottom-2" : "top-2")} disabled={!value.trim()} loading={complete.busy} loadingLabel="Building your agent" aria-label="Send answer"><ArrowUp className="h-4 w-4" /></Button>
                {current.kind === "url" && <button type="button" onClick={() => answer("Pre-launch — no website yet")} disabled={complete.busy} className="mt-2 text-[11px] font-semibold text-slate-500 hover:text-indigo-600 disabled:opacity-50">I don’t have a website yet</button>}
              </form>
            )}
            {voiceOffered && (
              <button
                type="button"
                onClick={() => {
                  setError("");
                  setMode("voice");
                }}
                disabled={complete.busy}
                className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50/60 px-3 py-2.5 text-xs font-semibold text-indigo-700 transition hover:border-indigo-300 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 motion-reduce:transition-none sm:w-auto"
              >
                <Mic className="h-3.5 w-3.5" aria-hidden="true" /> Talk instead of typing — answer out loud in any language
              </button>
            )}
            {voiceBlockedByBrowser && support && <p className="mt-3 text-[11px] leading-4 text-slate-500">{support.message}</p>}
            {error && <p role="alert" className="mt-3 text-xs text-red-600">{error}</p>}
          </div>
        </section>
        )}
      </div>
    </main>
  );
}
