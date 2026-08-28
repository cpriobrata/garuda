import Link from "next/link";
import { ArrowLeft, CheckCircle2, MessageCircleMore, ShieldCheck, Sparkles } from "lucide-react";
import { Brand } from "@/components/brand";

export function AuthShell({ children, eyebrow, title, description }: { children: React.ReactNode; eyebrow?: string; title: string; description: string }) {
  return (
    <main className="min-h-screen bg-white lg:grid lg:grid-cols-[.92fr_1.08fr]">
      <section className="flex min-h-screen flex-col px-5 py-5 sm:px-8 lg:px-12 xl:px-20">
        <div className="flex items-center justify-between"><Brand /><Link href="/" className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900"><ArrowLeft className="h-3.5 w-3.5" /> Home</Link></div>
        <div className="mx-auto flex w-full max-w-[430px] flex-1 flex-col justify-center py-12">
          {eyebrow && <p className="mb-3 text-xs font-bold uppercase tracking-[.18em] text-indigo-600">{eyebrow}</p>}
          <h1 className="text-3xl font-bold tracking-[-0.035em] text-slate-950 sm:text-4xl">{title}</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">{description}</p>
          <div className="mt-8">{children}</div>
        </div>
        <p className="text-center text-[11px] text-slate-400">© 2026 Garuda · Privacy-first AI conversations</p>
      </section>

      <section className="relative hidden min-h-screen overflow-hidden bg-slate-950 p-12 lg:flex lg:flex-col lg:justify-between xl:p-16">
        <div className="absolute inset-0 opacity-40 [background-image:radial-gradient(circle_at_15%_15%,#4f46e5_0,transparent_28%),radial-gradient(circle_at_85%_80%,#7c3aed_0,transparent_30%)]" />
        <div className="surface-grid absolute inset-0 opacity-20" />
        <div className="relative z-10 flex items-center gap-2 text-xs font-semibold text-indigo-200"><Sparkles className="h-4 w-4" /> Illustrative product preview</div>
        <div className="relative z-10 mx-auto w-full max-w-xl">
          <div className="rounded-3xl border border-white/10 bg-white/[.075] p-5 shadow-2xl backdrop-blur-xl">
            <div className="rounded-2xl border border-white/10 bg-white p-5 text-slate-900 shadow-xl">
              <div className="flex items-center gap-3 border-b pb-4"><div className="grid h-10 w-10 place-items-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-sm font-bold text-white">A</div><div><p className="text-sm font-semibold">Aria</p><p className="text-[11px] text-slate-500">Your AI sales agent · Online</p></div></div>
              <div className="space-y-3 py-5"><ChatBubble>Hi! Based on what you shared, the Growth plan looks like a good fit for your team.</ChatBubble><ChatBubble visitor>I’d like someone to follow up with more detail.</ChatBubble><ChatBubble>I can ask for your contact details with consent and preserve this context for the team.</ChatBubble></div>
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3"><div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-600" /><p className="text-xs font-semibold text-emerald-900">Example lead captured</p><span className="ml-auto text-[10px] text-emerald-700">demo</span></div></div>
            </div>
          </div>
          <p className="mt-8 text-balance text-xl font-medium leading-8 text-white">See how an approved-knowledge agent can answer, capture a consensual lead, and preserve the conversation for your team.</p>
          <div className="mt-5 flex items-center gap-3"><div className="grid h-9 w-9 place-items-center rounded-full bg-indigo-400 text-xs font-bold text-indigo-950">D</div><div><p className="text-sm font-semibold text-white">Demo workspace</p><p className="text-xs text-slate-400">Illustrative customer journey</p></div></div>
        </div>
        <div className="relative z-10 flex items-center gap-5 text-[11px] text-slate-400"><span className="flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5" /> Stripe-hosted checkout</span><span className="flex items-center gap-1.5"><MessageCircleMore className="h-3.5 w-3.5" /> Explicit-consent lead capture</span></div>
      </section>
    </main>
  );
}

function ChatBubble({ children, visitor = false }: { children: React.ReactNode; visitor?: boolean }) {
  return <div className={`flex ${visitor ? "justify-end" : "justify-start"}`}><div className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-xs leading-5 ${visitor ? "rounded-br-md bg-slate-950 text-white" : "rounded-bl-md bg-slate-100 text-slate-700"}`}>{children}</div></div>;
}
