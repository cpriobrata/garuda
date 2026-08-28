"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUp, Building2, Check, MessageSquareText, Sparkles, Target, UsersRound } from "lucide-react";
import { Brand } from "@/components/brand";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { garudaApi } from "@/lib/api";
import { cn } from "@/lib/utils";

type Question = {
  id: string;
  prompt: string;
  helper: string;
  icon: React.ComponentType<{ className?: string }>;
  kind: "text" | "url" | "choices" | "textarea";
  placeholder?: string;
  choices?: { label: string; description: string; value: string }[];
  response: (answer: string) => string;
};

const questions: Question[] = [
  { id: "business_profile", prompt: "First, tell me about your business.", helper: "Share its name, what it offers, and your website if you have one.", icon: Building2, kind: "textarea", placeholder: "e.g. Northstar Labs helps growth teams improve website conversion — northstarlabs.com", response: (answer) => `${answer.split(/[—,-]/)[0].trim()} — got it. Let’s give your agent the right customer context.` },
  { id: "audience_and_offer", prompt: "Who is your ideal customer, and what should the agent help them with?", helper: "A clear answer helps your agent recognize high-intent visitors and discuss the right offer.", icon: UsersRound, kind: "textarea", placeholder: "Tell me who you serve, what they need, and which products or services matter most…", response: () => "That’s helpful. I can already see how to make the conversation feel specific to your buyers." },
  { id: "primary_outcome", prompt: "What is the #1 outcome you want from conversations?", helper: "Pick the action your agent should optimize for first.", icon: Target, kind: "choices", choices: [
    { label: "Arrange more follow-ups", description: "Qualify visitors and offer a clear human next step", value: "book_meetings" },
    { label: "Capture qualified leads", description: "Collect contact details after explicit consent", value: "capture_leads" },
    { label: "Answer support questions", description: "Resolve common questions and hand off edge cases", value: "support" },
    { label: "Recommend products", description: "Guide shoppers toward the right product or plan", value: "recommend" },
  ], response: (answer) => `${labelFor(answer)} is a strong primary goal. I’ll make every conversation work toward that naturally.` },
  { id: "voice_and_capture", prompt: "Last one — what kind of teammate should I create?", helper: "This sets its tone and opening approach. Garuda will ask for contact details only after providing value.", icon: MessageSquareText, kind: "choices", choices: [
    { label: "Sales specialist", description: "Consultative, confident and focused on conversion", value: "sales" },
    { label: "Lead qualifier", description: "Efficient, curious and great at finding fit", value: "qualifier" },
    { label: "Customer concierge", description: "Warm, helpful and experience-focused", value: "concierge" },
    { label: "Support expert", description: "Clear, patient and resolution-oriented", value: "support_expert" },
  ], response: () => "Excellent choice. I have everything I need to build your first Garuda agent." },
];

function labelFor(value: string) {
  return questions.flatMap((question) => question.choices || []).find((choice) => choice.value === value)?.label || value;
}

export function OnboardingFlow() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [value, setValue] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [history, setHistory] = useState<{ from: "garuda" | "user"; text: string }[]>([
    { from: "garuda", text: "Welcome — I’m Garuda. I’ll create your first AI agent with you through four useful business questions." },
  ]);
  const [error, setError] = useState("");
  const current = questions[step];
  const progress = useMemo(() => Math.round(((step + 1) / questions.length) * 100), [step]);

  async function answer(nextValue: string) {
    const clean = nextValue.trim();
    if (!clean) return;
    const nextAnswers = { ...answers, [current.id]: clean };
    setAnswers(nextAnswers);
    setHistory((items) => [...items, { from: "user", text: current.kind === "choices" ? labelFor(clean) : clean }, { from: "garuda", text: current.response(clean) }]);
    setValue("");
    setError("");
    if (step < questions.length - 1) {
      setStep((currentStep) => currentStep + 1);
      return;
    }
    try {
      const result = await garudaApi.completeOnboarding(nextAnswers);
      window.sessionStorage.setItem("garuda_new_agent_id", result.agent_id);
      window.sessionStorage.setItem("garuda_new_agent_name", result.agent_name);
      router.push("/app/generating");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "We couldn’t save your answers. Please try again.");
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    answer(value);
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#f8f9fc]">
      <div className="surface-grid pointer-events-none absolute inset-0" />
      <header className="relative z-10 border-b bg-white/85 backdrop-blur-xl"><div className="container flex h-16 max-w-6xl items-center justify-between"><Brand /><div className="flex items-center gap-3"><span className="hidden text-xs font-medium text-slate-500 sm:inline">Agent setup</span><span className="text-xs font-bold text-slate-900">{step + 1} / {questions.length}</span></div></div></header>
      <div className="relative z-10 container grid min-h-[calc(100vh-4rem)] max-w-6xl gap-8 py-8 lg:grid-cols-[.8fr_1.2fr] lg:items-center lg:py-12">
        <section className="hidden lg:block">
          <Badge variant="purple" className="mb-5"><Sparkles className="mr-1.5 h-3.5 w-3.5" /> AI-guided setup</Badge>
          <h1 className="max-w-md text-4xl font-bold tracking-[-.045em] text-slate-950">A brilliant agent starts with a little context.</h1>
          <p className="mt-4 max-w-md text-sm leading-6 text-slate-600">Your answers create the first version. You’ll be able to review, test and change every detail before going live.</p>
          <div className="mt-9 max-w-sm space-y-4">
            {questions.map((question, index) => <div key={question.id} className={cn("flex items-center gap-3 text-sm transition", index <= step ? "text-slate-900" : "text-slate-400")}><span className={cn("grid h-8 w-8 place-items-center rounded-lg border", index < step ? "border-emerald-200 bg-emerald-50 text-emerald-600" : index === step ? "border-indigo-200 bg-indigo-50 text-indigo-600" : "bg-white")} >{index < step ? <Check className="h-4 w-4" /> : <question.icon className="h-4 w-4" />}</span><span className="font-medium">{["Your business", "Ideal customer", "Primary goal", "Agent type & voice"][index]}</span></div>)}
          </div>
          <div className="mt-9 max-w-sm"><div className="mb-2 flex justify-between text-[10px] font-semibold text-slate-500"><span>SETUP PROGRESS</span><span>{progress}%</span></div><Progress value={progress} /></div>
        </section>

        <section className="mx-auto w-full max-w-2xl overflow-hidden rounded-3xl border bg-white shadow-[0_30px_90px_rgba(41,37,92,.11)]">
          <div className="flex items-center gap-3 border-b px-5 py-4 sm:px-6"><div className="relative grid h-10 w-10 place-items-center rounded-xl bg-slate-950"><Brand compact className="scale-75" /><span className="absolute -bottom-1 -right-1 h-3 w-3 rounded-full border-2 border-white bg-emerald-500" /></div><div><p className="text-sm font-semibold text-slate-900">Garuda setup guide</p><p className="text-[11px] text-slate-500">Building your agent with you</p></div><span className="ml-auto rounded-full bg-indigo-50 px-2.5 py-1 text-[10px] font-semibold text-indigo-700 lg:hidden">{step + 1} of {questions.length}</span></div>
          <div className="hide-scrollbar h-[280px] overflow-y-auto bg-slate-50/50 px-5 py-5 sm:h-[340px] sm:px-6">
            <div className="space-y-3">
              {history.map((message, index) => <div key={`${index}-${message.text}`} className={cn("flex", message.from === "user" ? "justify-end" : "justify-start")}><div className={cn("max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-6", message.from === "user" ? "rounded-br-md bg-slate-950 text-white" : "rounded-bl-md border bg-white text-slate-700 shadow-sm")}>{message.text}</div></div>)}
              <div className="flex justify-start animate-enter"><div className="max-w-[85%] rounded-2xl rounded-bl-md border border-indigo-100 bg-indigo-50/60 px-4 py-3"><p className="text-sm font-medium leading-6 text-indigo-950">{current.prompt}</p><p className="mt-1 text-xs leading-5 text-indigo-700/80">{current.helper}</p></div></div>
            </div>
          </div>
          <div className="border-t bg-white p-4 sm:p-5">
            {current.kind === "choices" ? (
              <div className="grid gap-2 sm:grid-cols-2">{current.choices?.map((choice) => <button key={choice.value} onClick={() => answer(choice.value)} className="group rounded-xl border p-3 text-left transition hover:border-indigo-300 hover:bg-indigo-50/50 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"><div className="flex items-start gap-3"><span className="mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 border-slate-300 transition group-hover:border-indigo-500" /><div><p className="text-xs font-semibold text-slate-900">{choice.label}</p><p className="mt-1 text-[10px] leading-4 text-slate-500">{choice.description}</p></div></div></button>)}</div>
            ) : (
              <form onSubmit={submit} className="relative">
                {current.kind === "textarea" ? <Textarea value={value} onChange={(event) => setValue(event.target.value)} placeholder={current.placeholder} className="min-h-[90px] resize-none pr-12" autoFocus /> : <Input value={value} onChange={(event) => setValue(event.target.value)} type={current.kind === "url" ? "url" : "text"} placeholder={current.placeholder} className="h-12 pr-12" autoFocus />}
                <Button type="submit" size="icon" className={cn("absolute right-2 h-8 w-8", current.kind === "textarea" ? "bottom-2" : "top-2")} disabled={!value.trim()} aria-label="Send answer"><ArrowUp className="h-4 w-4" /></Button>
                {current.kind === "url" && <button type="button" onClick={() => answer("Pre-launch — no website yet")} className="mt-2 text-[11px] font-semibold text-slate-500 hover:text-indigo-600">I don’t have a website yet</button>}
              </form>
            )}
            {error && <p role="alert" className="mt-3 text-xs text-red-600">{error}</p>}
          </div>
        </section>
      </div>
    </main>
  );
}
