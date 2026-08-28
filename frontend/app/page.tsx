import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Bot,
  Check,
  CheckCircle2,
  Code2,
  DatabaseZap,
  Gauge,
  HeartHandshake,
  MessageCircleMore,
  MousePointerClick,
  Play,
  ShieldCheck,
  Sparkles,
  WandSparkles,
  Zap,
} from "lucide-react";
import { SiteNav } from "@/components/site/site-nav";
import { MarketingChat } from "@/components/site/marketing-chat";
import { Brand } from "@/components/brand";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const features = [
  { icon: MessageCircleMore, title: "Useful customer conversations", text: "Responds from your approved context, discovers intent, and guides each visitor toward a clear next step." },
  { icon: DatabaseZap, title: "Grounded in your knowledge", text: "Add approved product, service, pricing, and policy text. Every source remains visible in your workspace." },
  { icon: MousePointerClick, title: "Consent-based lead capture", text: "Collects contact details only after explicit visitor consent and keeps the captured record with the conversation." },
  { icon: BarChart3, title: "A clear activity overview", text: "Review persisted messages, conversations, leads, and daily activity from one focused workspace." },
  { icon: HeartHandshake, title: "Private draft testing", text: "Test each agent against its current instructions and knowledge before you publish it to customers." },
  { icon: Code2, title: "A secure website embed", text: "Publish an agent, copy its embed snippet, and restrict widget sessions to the domains you approve." },
];

const steps = [
  { number: "01", title: "Tell Garuda about your business", text: "Answer a few thoughtful questions and share your website. That’s enough context to begin.", icon: Sparkles },
  { number: "02", title: "Meet your first AI agent", text: "Garuda writes its playbook, personality and qualification flow around your goals.", icon: WandSparkles },
  { number: "03", title: "Add it to your website", text: "Copy one small snippet. Your agent starts helping visitors and collecting leads right away.", icon: Zap },
];

export default function LandingPage() {
  return (
    <main className="overflow-hidden bg-white">
      <SiteNav />

      <section className="relative border-b border-slate-100 pb-20 pt-16 sm:pt-20 lg:pb-28 lg:pt-24">
        <div className="surface-grid pointer-events-none absolute inset-0" />
        <div className="pointer-events-none absolute left-[15%] top-10 h-72 w-72 rounded-full bg-indigo-100/70 blur-[100px]" />
        <div className="pointer-events-none absolute right-[2%] top-20 h-72 w-72 rounded-full bg-fuchsia-100/55 blur-[110px]" />
        <div className="container relative grid items-center gap-14 lg:grid-cols-[1.04fr_.96fr] lg:gap-12">
          <div className="mx-auto max-w-2xl text-center lg:mx-0 lg:text-left">
            <Badge variant="purple" className="mb-6 gap-1.5 border-indigo-200 bg-white/80 py-1.5 pl-2 pr-3 shadow-sm">
              <span className="grid h-5 w-5 place-items-center rounded-full bg-indigo-600 text-white"><Sparkles className="h-3 w-3" /></span>
              Your best conversation, available 24/7
            </Badge>
            <h1 className="text-balance text-[44px] font-bold leading-[1.04] tracking-[-0.045em] text-slate-950 sm:text-6xl lg:text-[68px]">
              Turn every visit into a <span className="gradient-text">real opportunity.</span>
            </h1>
            <p className="mx-auto mt-6 max-w-xl text-balance text-lg leading-8 text-slate-600 lg:mx-0 lg:text-xl">
              Garuda creates AI sales agents that know your business, speak like your best teammate, and turn curious visitors into qualified leads.
            </p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row lg:justify-start">
              <Button size="lg" className="h-[52px] rounded-xl px-7 shadow-glow" asChild><Link href="/auth/sign-up">Build my AI agent <ArrowRight className="ml-2 h-4 w-4" /></Link></Button>
              <Button size="lg" variant="outline" className="h-[52px] rounded-xl bg-white/80 px-6" asChild><Link href="#how-it-works"><Play className="mr-2 h-4 w-4 fill-slate-900" /> See how it works</Link></Button>
            </div>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs font-medium text-slate-500 lg:justify-start">
              <span className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-emerald-500" /> Four-question setup</span>
              <span className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-emerald-500" /> Secure Stripe checkout</span>
              <span className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-emerald-500" /> Cancel anytime</span>
            </div>
          </div>
          <div className="relative lg:pl-6"><MarketingChat /></div>
        </div>
      </section>

      <section className="border-b bg-slate-50/60 py-10">
        <div className="container">
          <p className="text-center text-[11px] font-bold uppercase tracking-[.22em] text-slate-400">A focused path from idea to published agent</p>
          <div className="mt-7 grid grid-cols-2 gap-6 text-center sm:grid-cols-3 lg:grid-cols-6">
            {["ONBOARD", "CONFIGURE", "GROUND", "TEST", "PUBLISH", "LEARN"].map((name) => <div key={name} className="text-xs font-bold tracking-[.14em] text-slate-400">{name}</div>)}
          </div>
        </div>
      </section>

      <section id="product" className="py-20 sm:py-28">
        <div className="container">
          <div className="mx-auto max-w-2xl text-center">
            <Badge variant="outline" className="mb-4 border-indigo-200 text-indigo-700">Everything it needs to win</Badge>
            <h2 className="text-balance text-3xl font-bold tracking-[-0.035em] text-slate-950 sm:text-5xl">One agent. Every customer conversation.</h2>
            <p className="mt-5 text-lg leading-8 text-slate-600">Garuda combines the warmth of your best salesperson with the speed and consistency only AI can deliver.</p>
          </div>
          <div className="mt-14 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {features.map((feature, index) => (
              <Card key={feature.title} className="group border-slate-200/80 bg-white shadow-none transition duration-300 hover:-translate-y-1 hover:border-indigo-200 hover:shadow-soft">
                <CardContent className="p-6 sm:p-7">
                  <div className={`grid h-11 w-11 place-items-center rounded-xl ${index % 3 === 0 ? "bg-indigo-50 text-indigo-600" : index % 3 === 1 ? "bg-violet-50 text-violet-600" : "bg-cyan-50 text-cyan-600"}`}><feature.icon className="h-5 w-5" /></div>
                  <h3 className="mt-5 text-lg font-semibold tracking-tight text-slate-950">{feature.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{feature.text}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section id="how-it-works" className="relative overflow-hidden bg-slate-950 py-20 text-white sm:py-28">
        <div className="absolute inset-0 opacity-25 [background-image:radial-gradient(circle_at_25%_20%,#6366f1_0,transparent_25%),radial-gradient(circle_at_85%_75%,#9333ea_0,transparent_22%)]" />
        <div className="container relative">
          <div className="grid items-end gap-8 lg:grid-cols-2">
            <div><Badge className="mb-4 border-white/15 bg-white/10 text-indigo-200">From idea to live agent</Badge><h2 className="max-w-xl text-balance text-3xl font-bold tracking-[-0.035em] sm:text-5xl">Your smartest teammate, ready before lunch.</h2></div>
            <p className="max-w-xl text-base leading-7 text-slate-300 lg:justify-self-end">No prompt engineering. No flowchart maze. Garuda learns what matters and builds a polished first version for you.</p>
          </div>
          <div className="mt-14 grid gap-5 lg:grid-cols-3">
            {steps.map((step) => (
              <div key={step.number} className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/[.055] p-7 backdrop-blur-sm">
                <div className="flex items-center justify-between"><span className="text-sm font-bold text-indigo-300">{step.number}</span><div className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-500/15 text-indigo-300"><step.icon className="h-5 w-5" /></div></div>
                <h3 className="mt-14 text-xl font-semibold tracking-tight">{step.title}</h3>
                <p className="mt-3 text-sm leading-6 text-slate-400">{step.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 sm:py-28">
        <div className="container grid items-center gap-12 lg:grid-cols-2">
          <div className="order-2 lg:order-1">
            <div className="relative mx-auto max-w-xl rounded-2xl border bg-slate-50 p-3 shadow-soft">
              <div className="rounded-xl border bg-white p-5 sm:p-6">
                <div className="flex items-start justify-between"><div><p className="text-sm font-semibold text-slate-900">Conversation performance</p><p className="mt-1 text-xs text-slate-500">Illustrative product preview</p></div><Badge variant="secondary">Demo data</Badge></div>
                <div className="mt-7 grid grid-cols-3 gap-3"><Metric label="Conversations" value="2,131" /><Metric label="Qualified" value="364" /><Metric label="Meetings" value="89" /></div>
                <div className="mt-8 h-44">
                  <svg viewBox="0 0 600 180" className="h-full w-full overflow-visible" preserveAspectRatio="none" aria-label="Conversation growth chart">
                    <defs><linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#6366f1" stopOpacity=".28" /><stop offset="100%" stopColor="#6366f1" stopOpacity="0" /></linearGradient></defs>
                    {[20, 70, 120, 170].map((y) => <line key={y} x1="0" y1={y} x2="600" y2={y} stroke="#e2e8f0" strokeWidth="1" />)}
                    <path d="M0 152 C45 142,72 158,112 124 S174 91,215 110 S286 145,330 92 S407 72,446 83 S516 51,600 28 L600 180 L0 180Z" fill="url(#chartFill)" />
                    <path d="M0 152 C45 142,72 158,112 124 S174 91,215 110 S286 145,330 92 S407 72,446 83 S516 51,600 28" fill="none" stroke="#6366f1" strokeWidth="4" strokeLinecap="round" />
                    <circle cx="600" cy="28" r="6" fill="white" stroke="#6366f1" strokeWidth="4" />
                  </svg>
                </div>
                <div className="mt-1 flex justify-between text-[10px] text-slate-400"><span>Aug 1</span><span>Aug 8</span><span>Aug 15</span><span>Aug 22</span><span>Aug 29</span></div>
              </div>
              <div className="absolute -bottom-6 -right-4 hidden w-52 rounded-xl border bg-white p-3 shadow-soft sm:block"><div className="flex items-center gap-2"><div className="grid h-8 w-8 place-items-center rounded-lg bg-emerald-50"><Gauge className="h-4 w-4 text-emerald-600" /></div><div><p className="text-[10px] text-slate-500">Example conversion</p><p className="text-sm font-bold text-slate-950">17.1% <span className="text-[10px] text-slate-400">demo</span></p></div></div></div>
            </div>
          </div>
          <div className="order-1 lg:order-2 lg:pl-8">
            <Badge variant="outline" className="mb-4 border-indigo-200 text-indigo-700">Know what drives revenue</Badge>
            <h2 className="text-balance text-3xl font-bold tracking-[-0.035em] text-slate-950 sm:text-5xl">Every conversation becomes an insight.</h2>
            <p className="mt-5 text-lg leading-8 text-slate-600">See what prospects care about, who is ready to buy, and where your agent is making a measurable difference.</p>
            <ul className="mt-7 space-y-4">
              {["Persisted conversations and messages in one inbox", "Explicit-consent lead details beside the transcript", "Workspace totals and daily conversation activity"].map((item) => <li key={item} className="flex items-start gap-3 text-sm font-medium text-slate-700"><span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-emerald-50"><Check className="h-3.5 w-3.5 text-emerald-600" /></span>{item}</li>)}
            </ul>
          </div>
        </div>
      </section>

      <section id="pricing" className="border-y bg-slate-50/70 py-20 sm:py-28">
        <div className="container">
          <div className="mx-auto max-w-2xl text-center"><Badge variant="outline" className="mb-4 border-indigo-200 text-indigo-700">Simple pricing</Badge><h2 className="text-3xl font-bold tracking-[-0.035em] text-slate-950 sm:text-5xl">Start turning visits into pipeline.</h2><p className="mt-5 text-lg text-slate-600">Everything you need to launch your first high-converting agent. No hidden setup fee.</p></div>
          <Card className="mx-auto mt-12 max-w-[520px] overflow-hidden border-indigo-200 shadow-[0_24px_70px_rgba(79,70,229,.12)]">
            <div className="bg-gradient-to-r from-indigo-600 to-violet-600 px-6 py-2.5 text-center text-xs font-semibold text-white">GARUDA LAUNCH PLAN</div>
            <CardContent className="p-7 sm:p-9">
              <div className="flex items-end justify-between"><div><p className="text-sm font-semibold text-slate-500">Everything you need</p><div className="mt-2 flex items-end gap-1"><span className="text-5xl font-bold tracking-[-.05em] text-slate-950">$17</span><span className="mb-1.5 text-sm font-medium text-slate-500">/month</span></div></div><div className="rounded-xl bg-indigo-50 p-3 text-indigo-600"><Bot className="h-6 w-6" /></div></div>
              <div className="my-7 h-px bg-slate-100" />
              <ul className="space-y-3.5">{["Up to 10 custom AI agents", "100 conversations every month", "Explicit-consent lead capture", "Approved text knowledge sources", "Conversation history and dashboard totals", "Allowed-domain widget controls"].map((item) => <li key={item} className="flex items-center gap-3 text-sm text-slate-700"><span className="grid h-5 w-5 place-items-center rounded-full bg-indigo-50"><Check className="h-3 w-3 text-indigo-600" /></span>{item}</li>)}</ul>
              <Button size="lg" className="mt-8 w-full rounded-xl" asChild><Link href="/auth/sign-up">Start building for $17 <ArrowRight className="ml-2 h-4 w-4" /></Link></Button>
              <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-[11px] text-slate-500"><ShieldCheck className="h-3.5 w-3.5" /> Secure checkout · Cancel any time</p>
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="py-20 sm:py-28">
        <div className="container">
          <div className="relative overflow-hidden rounded-[28px] bg-slate-950 px-6 py-14 text-center text-white sm:px-12 sm:py-20">
            <div className="absolute -left-24 -top-24 h-64 w-64 rounded-full bg-indigo-600/45 blur-[90px]" /><div className="absolute -bottom-32 -right-20 h-72 w-72 rounded-full bg-violet-600/35 blur-[100px]" />
            <div className="relative mx-auto max-w-2xl"><Badge className="mb-5 border-white/15 bg-white/10 text-indigo-200">Your next customer is already visiting</Badge><h2 className="text-balance text-3xl font-bold tracking-[-0.04em] sm:text-5xl">Give them someone brilliant to talk to.</h2><p className="mx-auto mt-5 max-w-xl text-base leading-7 text-slate-300">Create an AI agent that understands your business and starts better conversations today.</p><Button size="lg" className="mt-8 bg-white text-slate-950 hover:bg-slate-100" asChild><Link href="/auth/sign-up">Create my Garuda agent <ArrowRight className="ml-2 h-4 w-4" /></Link></Button></div>
          </div>
        </div>
      </section>

      <footer className="border-t bg-white py-10">
        <div className="container flex flex-col items-center justify-between gap-6 sm:flex-row"><Brand /><p className="text-xs text-slate-500">© 2026 Garuda. Better conversations, better business.</p><div className="flex gap-5 text-xs font-medium text-slate-500"><Link href="/privacy" className="hover:text-slate-900">Privacy</Link><Link href="/terms" className="hover:text-slate-900">Terms</Link><Link href="#pricing" className="hover:text-slate-900">Pricing</Link></div></div>
      </footer>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><p className="text-[10px] font-medium text-slate-500">{label}</p><p className="mt-1 text-lg font-bold tracking-tight text-slate-950 sm:text-xl">{value}</p></div>;
}
