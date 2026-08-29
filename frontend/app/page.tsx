import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  Boxes,
  CalendarClock,
  Check,
  CircleSlash,
  Code2,
  DatabaseZap,
  Fingerprint,
  Globe2,
  KeyRound,
  LayoutDashboard,
  MessageCircleQuestion,
  Repeat2,
  ShieldCheck,
  Sparkles,
  UserCheck,
} from "lucide-react";
import { SiteNav } from "@/components/site/site-nav";
import { SiteFooter } from "@/components/marketing/site-footer";
import { Faq } from "@/components/marketing/faq";
import { WidgetChatPreview, WidgetConsentPreview } from "@/components/marketing/widget-preview";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { API_URL, PLAN_LIMITS, PLAN_PRICE_USD, pageMetadata } from "@/lib/seo";

/**
 * The homepage.
 *
 * Rule for everything below: a sentence either describes behaviour that exists
 * in this repository today, or it says plainly that it does not exist yet. No
 * customers, no logos, no invented metrics. The numbers that do appear come from
 * backend/internal/config/plan.go — via PLAN_LIMITS, so the page cannot drift
 * from the server — and from a live request to https://api.garuda.ravan.ai.
 *
 * The FAQPage structured data for this product lives on /faq, which asks a wider
 * set of questions. The shorter list here is deliberately not marked up a second
 * time: one page should own that entity.
 */

const TITLE = "Garuda — AI chat agents that answer from your own knowledge";

export const metadata: Metadata = {
  ...pageMetadata({
    title: TITLE,
    description:
      "Garuda drafts an AI chat agent for your business from four questions. You edit the draft, ground it in the sources you approve, and publish it with one script tag. It answers from your knowledge, says when it does not know, and asks for contact details only with the visitor's consent. USD $17 per month.",
    path: "/",
    socialTitle: TITLE,
  }),
  // The template in the root layout would otherwise append " · Garuda" to a
  // title that already ends in the product name.
  title: { absolute: TITLE },
};

const CTA_HREF = "/auth/sign-up";
const CTA_LABEL = "Create your agent";

const heroFacts = [
  "Four questions to a first draft",
  "One async script tag",
  `USD $${PLAN_PRICE_USD}/month, cancel any time`,
];

const problems = [
  "Someone lands on my pricing page at 11pm with one question. By morning they have booked with somebody else.",
  "I tried a chatbot. It confidently invented a policy we do not have, and I was the one who had to apologise.",
  "I do not have an afternoon spare to write prompts and draw conversation flowcharts.",
  "I want the enquiry, but I am not willing to scrape an email address from someone who never agreed to give it.",
  "Every tool I look at wants to plant its own tracker on my site.",
];

const steps = [
  {
    number: "01",
    icon: MessageCircleQuestion,
    title: "Answer four questions",
    text: "Onboarding is a conversation, not a form maze. Garuda asks about your business and website, the outcome you want the assistant to create, who visits and what it should discuss, and how it should sound and when it should ask for contact details. That is the whole list — there is no fifth question.",
  },
  {
    number: "02",
    icon: Sparkles,
    title: "Read the draft before anyone else does",
    text: "The model writes a first agent from your answers: its name, welcome message, suggested questions, instructions and contact fields. It is created as a draft and it stays a draft. You can chat with it privately from the portal, edit anything you disagree with, and nothing reaches your website until you press publish.",
  },
  {
    number: "03",
    icon: DatabaseZap,
    title: "Ground it in knowledge you approve",
    text: "You paste in the text it may answer from — services, coverage, policies, the answers you retype every week. Up to five sources per agent, up to 100,000 characters each, and only sources marked ready are ever retrieved. Garuda does not crawl your website behind your back; what goes in is what you put in.",
  },
  {
    number: "04",
    icon: Code2,
    title: "Publish one snippet",
    text: "Publishing hands you a single script tag to paste before the closing body tag. Add the domains the agent is allowed to run on, and a request from any other origin is refused before a session is ever created.",
  },
];

const capabilities = [
  {
    icon: DatabaseZap,
    title: "Answers grounded in your sources",
    text: "Relevant passages from your approved knowledge are retrieved and passed to the model with each question, labelled explicitly as untrusted reference data rather than as instructions — so a document you paste in cannot quietly rewrite how your agent behaves.",
  },
  {
    icon: CircleSlash,
    title: "It says when it does not know",
    text: "Every drafted agent is instructed to use only the supplied knowledge, to say so when something is missing, to offer a human follow-up instead, and never to invent prices, availability, policies, guarantees or legal claims.",
  },
  {
    icon: UserCheck,
    title: "Contact details only with consent",
    text: "The contact form carries a required tick box reading “I agree to be contacted about my request.” A submission that arrives without it is refused by the API, and the consent that accompanied the lead — along with the version of the notice shown — is recorded with it.",
  },
  {
    icon: Repeat2,
    title: "Returning-visitor memory, opt in",
    text: "A first-time visitor chooses “Remember this chat” or “Use once”. Choose once and no visitor token is kept at all. Choose to be remembered and the conversation picks up where it left off, for up to thirty days.",
  },
  {
    icon: Globe2,
    title: "Domain-restricted, isolated embedding",
    text: "The widget mounts inside a Shadow DOM whose host style begins at all:initial, so your CSS and its CSS cannot collide in either direction. Sessions are only issued to origins on that agent's allowlist.",
  },
  {
    icon: LayoutDashboard,
    title: "One portal for the aftermath",
    text: "Your agents, every conversation with its full transcript, each lead sitting beside the conversation that produced it, and daily activity for the workspace — in one place, not three.",
  },
];

const integrationHighlights = [
  { name: "Google Calendar", detail: "Scheduling" },
  { name: "Slack", detail: "Team messaging" },
  { name: "HubSpot", detail: "CRM" },
  { name: "Salesforce", detail: "CRM" },
  { name: "HighLevel", detail: "Agency CRM" },
];

const securityPoints = [
  {
    icon: BadgeCheck,
    title: "Consent comes before contact details",
    text: "The lead endpoint rejects any submission that does not carry consent, with an explicit consent_required error. Consent is not a checkbox the copy mentions; it is a precondition the server enforces.",
  },
  {
    icon: Fingerprint,
    title: "Visitor tokens are scoped to one agent",
    text: "A visitor's identifier is an HMAC over your agent's id and their opaque token. The same person visiting two Garuda-powered websites produces two unrelated identifiers, so nothing can be correlated across sites.",
  },
  {
    icon: Globe2,
    title: "The widget runs where you allow it",
    text: "Every widget request is checked against the agent's allowed domains. An origin that is not on the list is answered as if the agent did not exist.",
  },
  {
    icon: KeyRound,
    title: "Short-lived, hashed session tokens",
    text: "A widget session token lasts fifteen minutes, is stored only as a hash, and is bound to the origin that created it.",
  },
  {
    icon: CircleSlash,
    title: "No cross-site tracking",
    text: "There is no third-party advertising cookie, no cross-site identifier, and no personal information sold on. Decline memory and no visitor token is stored at all — the browser keeps only the choice itself, so nobody is asked twice.",
  },
];

// Written from PLAN_LIMITS, which mirrors backend/internal/config/plan.go, so
// the price card and the server cannot quietly disagree.
const planFeatures = [
  `Up to ${PLAN_LIMITS.publishedAgents} published agents`,
  `${PLAN_LIMITS.monthlyConversations} conversations in any rolling ${PLAN_LIMITS.conversationWindowDays}-day window`,
  `Up to ${PLAN_LIMITS.knowledgeSourcesPerAgent} knowledge sources per agent, ${PLAN_LIMITS.charactersPerSource.toLocaleString("en-US")} characters each`,
  "Consent-based lead capture, stored with its conversation",
  "Full transcripts, leads and daily activity in the portal",
  "Domain allowlisting and widget appearance controls",
  "Connect your own third-party accounts through Composio",
];

export default function LandingPage() {
  return (
    <>
      <SiteNav />

      <main id="main" className="overflow-hidden bg-white">
        {/* ---------------------------------------------------------------- Hero */}
        <section className="relative border-b border-slate-100 pb-20 pt-14 sm:pt-16 lg:pb-28 lg:pt-20">
          <div className="surface-grid pointer-events-none absolute inset-0" aria-hidden="true" />
          <div className="pointer-events-none absolute left-[12%] top-8 h-72 w-72 rounded-full bg-indigo-100/70 blur-[100px]" aria-hidden="true" />
          <div className="pointer-events-none absolute right-[2%] top-24 h-72 w-72 rounded-full bg-fuchsia-100/50 blur-[110px]" aria-hidden="true" />
          <div className="container relative grid items-center gap-14 lg:grid-cols-[1.05fr_.95fr] lg:gap-12">
            <div className="mx-auto max-w-2xl text-center lg:mx-0 lg:text-left">
              <Badge variant="purple" className="mb-6 gap-1.5 border-indigo-200 bg-white/80 py-1.5 pl-2 pr-3 shadow-sm">
                <span className="grid h-5 w-5 place-items-center rounded-full bg-indigo-600 text-white" aria-hidden="true">
                  <Boxes className="h-3 w-3" />
                </span>
                New — connect your own accounts, 1,400+ tools
              </Badge>
              <h1 className="text-balance text-[42px] font-bold leading-[1.05] tracking-[-0.045em] text-slate-950 sm:text-6xl lg:text-[64px]">
                Answer every visitor from <span className="gradient-text">your own knowledge.</span>
              </h1>
              <p className="mx-auto mt-6 max-w-xl text-balance text-lg leading-8 text-slate-600 lg:mx-0">
                Garuda drafts an AI chat agent for your business from four questions. You edit it, ground it in the sources you
                approve, and publish it with one embed snippet. It answers from your knowledge, says plainly when it does not
                know, and asks for contact details only after the visitor agrees.
              </p>
              <p className="mx-auto mt-4 max-w-xl text-base leading-7 text-slate-500 lg:mx-0">
                Built for small teams whose website collects more questions than anyone has time to answer.
              </p>
              <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row lg:justify-start">
                <Button size="lg" className="h-[52px] rounded-xl px-7 shadow-glow" asChild>
                  <Link href={CTA_HREF}>
                    {CTA_LABEL} <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
                  </Link>
                </Button>
                <Button size="lg" variant="outline" className="h-[52px] rounded-xl bg-white/80 px-6" asChild>
                  <Link href="#how-it-works">See the four steps</Link>
                </Button>
              </div>
              <ul className="mt-7 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs font-medium text-slate-500 lg:justify-start">
                {heroFacts.map((fact) => (
                  <li key={fact} className="flex items-center gap-1.5">
                    <Check className="h-4 w-4 text-emerald-500" aria-hidden="true" />
                    {fact}
                  </li>
                ))}
              </ul>
              <p className="mx-auto mt-6 max-w-xl rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-xs leading-5 text-slate-500 lg:mx-0">
                You will not find logos, testimonials or star ratings on this page. Garuda is new and has no public customers yet.
                Everything described here is behaviour the product has today.
              </p>
            </div>
            <div className="relative lg:pl-6">
              <WidgetChatPreview />
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------- Problem */}
        <section id="problem" className="scroll-mt-20 border-b bg-slate-50/60 py-20 sm:py-24">
          <div className="container">
            <div className="mx-auto max-w-2xl text-center">
              <Badge variant="outline" className="mb-4 border-indigo-200 text-indigo-700">
                Why this exists
              </Badge>
              <h2 className="text-balance text-3xl font-bold tracking-[-0.035em] text-slate-950 sm:text-[42px]">
                Five sentences we kept hearing.
              </h2>
              <p className="mt-5 text-lg leading-8 text-slate-600">
                None of them are about artificial intelligence. They are about answers arriving too late, or arriving wrong.
              </p>
            </div>
            <ul className="mx-auto mt-12 grid max-w-5xl gap-4 md:grid-cols-2 lg:grid-cols-3">
              {problems.map((problem, index) => (
                <li key={problem} className={index === 0 ? "md:col-span-2 lg:col-span-1" : undefined}>
                  <figure className="h-full rounded-2xl border border-slate-200 bg-white p-6 shadow-none">
                    <blockquote className="text-[15px] leading-7 text-slate-700">
                      <p>“{problem}”</p>
                    </blockquote>
                  </figure>
                </li>
              ))}
              <li className="rounded-2xl border border-indigo-200 bg-indigo-50/60 p-6">
                <p className="text-[15px] font-semibold leading-7 text-indigo-900">
                  The rest of this page is how Garuda answers those five, and where it does not answer them yet.
                </p>
              </li>
            </ul>
          </div>
        </section>

        {/* --------------------------------------------------------- How it works */}
        <section id="how-it-works" className="relative scroll-mt-16 overflow-hidden bg-slate-950 py-20 text-white sm:py-28">
          <div
            className="absolute inset-0 opacity-25 [background-image:radial-gradient(circle_at_25%_20%,#6366f1_0,transparent_25%),radial-gradient(circle_at_85%_75%,#9333ea_0,transparent_22%)]"
            aria-hidden="true"
          />
          <div className="container relative">
            <div className="grid items-end gap-8 lg:grid-cols-2">
              <div>
                <Badge className="mb-4 border-white/15 bg-white/10 text-indigo-200">The actual journey</Badge>
                <h2 className="max-w-xl text-balance text-3xl font-bold tracking-[-0.035em] sm:text-[42px]">
                  Four steps, and you control the one that matters.
                </h2>
              </div>
              <p className="max-w-xl text-base leading-7 text-slate-300 lg:justify-self-end">
                The model does the drafting. You do the approving. Nothing your visitors can see exists until you deliberately
                publish it.
              </p>
            </div>

            <ol className="mt-14 grid gap-5 md:grid-cols-2">
              {steps.map((step) => (
                <li key={step.number} className="rounded-2xl border border-white/10 bg-white/[.055] p-7 backdrop-blur-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-indigo-300">{step.number}</span>
                    <span className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-500/15 text-indigo-300" aria-hidden="true">
                      <step.icon className="h-5 w-5" />
                    </span>
                  </div>
                  <h3 className="mt-6 text-xl font-semibold tracking-tight">{step.title}</h3>
                  <p className="mt-3 text-sm leading-6 text-slate-300">{step.text}</p>
                </li>
              ))}
            </ol>

            <div className="mt-10 rounded-2xl border border-white/10 bg-white/[.04] p-6 sm:p-7">
              <p className="text-sm font-semibold text-white">This is the entire installation.</p>
              <div className="mt-4 overflow-x-auto rounded-xl border border-white/10 bg-slate-900/80 p-4">
                <pre className="text-[12.5px] leading-6 text-indigo-200">
                  <code>{`<script async src="${API_URL}/widget.js" data-agent-key="pub_live_…"></script>`}</code>
                </pre>
              </div>
              <p className="mt-4 text-sm leading-6 text-slate-400">
                One tag, loaded asynchronously so it never blocks your page from rendering. Measured live on 29 August 2026, the
                script is about 27 KB gzipped and cached for five minutes.
              </p>
            </div>
          </div>
        </section>

        {/* -------------------------------------------------------- Capabilities */}
        <section id="capabilities" className="scroll-mt-16 py-20 sm:py-28">
          <div className="container">
            <div className="mx-auto max-w-2xl text-center">
              <Badge variant="outline" className="mb-4 border-indigo-200 text-indigo-700">
                What it does
              </Badge>
              <h2 className="text-balance text-3xl font-bold tracking-[-0.035em] text-slate-950 sm:text-[42px]">
                Grounded, consenting, and confined to your site.
              </h2>
              <p className="mt-5 text-lg leading-8 text-slate-600">
                Six behaviours, each one a decision already made in the product rather than a promise about a roadmap.
              </p>
            </div>
            <div className="mt-14 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {capabilities.map((capability, index) => (
                <Card
                  key={capability.title}
                  // The lift is decoration. Under prefers-reduced-motion both the
                  // transition and the translation itself are cancelled — the
                  // hover-scoped override is what actually beats the hover rule,
                  // since a plain motion-reduce:transform-none loses on specificity.
                  className="border-slate-200/80 bg-white shadow-none transition duration-300 hover:-translate-y-1 hover:border-indigo-200 hover:shadow-soft motion-reduce:transition-none motion-reduce:hover:translate-y-0"
                >
                  <CardContent className="p-6 sm:p-7">
                    <span
                      className={`grid h-11 w-11 place-items-center rounded-xl ${
                        index % 3 === 0
                          ? "bg-indigo-50 text-indigo-600"
                          : index % 3 === 1
                            ? "bg-violet-50 text-violet-600"
                            : "bg-cyan-50 text-cyan-600"
                      }`}
                      aria-hidden="true"
                    >
                      <capability.icon className="h-5 w-5" />
                    </span>
                    <h3 className="mt-5 text-lg font-semibold tracking-tight text-slate-950">{capability.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{capability.text}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* --------------------------------------------------------- Integrations */}
        <section id="integrations" className="scroll-mt-16 border-y bg-slate-50/70 py-20 sm:py-28">
          <div className="container">
            <div className="grid gap-12 lg:grid-cols-[1fr_1fr] lg:items-center lg:gap-16">
              <div>
                <Badge variant="purple" className="mb-4 border-indigo-200 bg-white">
                  New
                </Badge>
                <h2 className="text-balance text-3xl font-bold tracking-[-0.035em] text-slate-950 sm:text-[42px]">
                  Connect the tools your business already runs on.
                </h2>
                <p className="mt-5 text-lg leading-8 text-slate-600">
                  Every customer connects their own accounts. You authorise on the provider&rsquo;s own sign-in screen, through
                  Composio — Garuda never sees or stores your password. Connections belong to your workspace alone, and you can
                  revoke any of them from the portal at any time.
                </p>
                <p className="mt-4 text-base leading-7 text-slate-600">
                  Google Calendar, Slack, HubSpot, Salesforce, HighLevel and more than 1,400 other toolkits are in the catalogue
                  you browse from inside Garuda.
                </p>

                <div className="mt-8 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-5">
                    <p className="flex items-center gap-2 text-sm font-semibold text-emerald-900">
                      <Check className="h-4 w-4" aria-hidden="true" /> Live today
                    </p>
                    <p className="mt-2 text-sm leading-6 text-emerald-900/80">
                      Browsing the catalogue, connecting an account through the provider&rsquo;s own authorisation flow, seeing what
                      is connected, and disconnecting it again.
                    </p>
                  </div>
                  <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-5">
                    <p className="flex items-center gap-2 text-sm font-semibold text-amber-900">
                      <CalendarClock className="h-4 w-4" aria-hidden="true" /> Not yet
                    </p>
                    <p className="mt-2 text-sm leading-6 text-amber-900/80">
                      Agents taking actions inside those tools — booking the calendar slot, creating the CRM record — is the next
                      step and is not shipped. We would rather write that down than imply it.
                    </p>
                  </div>
                </div>
              </div>

              <div>
                <ul className="grid gap-3 sm:grid-cols-2">
                  {integrationHighlights.map((tool) => (
                    <li
                      key={tool.name}
                      className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-none"
                    >
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-500" aria-hidden="true">
                        <Boxes className="h-4 w-4" />
                      </span>
                      <span>
                        <span className="block text-sm font-semibold text-slate-900">{tool.name}</span>
                        <span className="block text-xs text-slate-500">{tool.detail}</span>
                      </span>
                    </li>
                  ))}
                  <li className="flex items-center gap-3 rounded-xl border border-indigo-200 bg-indigo-50/70 p-4">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-indigo-600 text-white" aria-hidden="true">
                      <Sparkles className="h-4 w-4" />
                    </span>
                    <span>
                      <span className="block text-sm font-semibold text-indigo-900">1,400+ more</span>
                      <span className="block text-xs text-indigo-700/80">Searchable by name and category</span>
                    </span>
                  </li>
                </ul>
                <p className="mt-4 text-xs leading-5 text-slate-500">
                  Connections are keyed to your Garuda account, so one customer&rsquo;s connected accounts are not visible or
                  revocable by another.
                </p>
                <p className="mt-4 text-sm">
                  <Link
                    href="/integrations"
                    className="font-semibold text-indigo-700 underline underline-offset-4 hover:text-indigo-900"
                  >
                    See the full integrations catalogue and how connecting works
                  </Link>
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------ Security */}
        <section id="security" className="scroll-mt-16 py-20 sm:py-28">
          <div className="container grid items-start gap-14 lg:grid-cols-[1fr_.85fr] lg:gap-16">
            <div>
              <Badge variant="outline" className="mb-4 border-indigo-200 text-indigo-700">
                Security and privacy
              </Badge>
              <h2 className="text-balance text-3xl font-bold tracking-[-0.035em] text-slate-950 sm:text-[42px]">
                Consent is enforced by the server, not promised by the copy.
              </h2>
              <p className="mt-5 text-lg leading-8 text-slate-600">
                A chat widget sits on your site and talks to your customers. That is a privacy decision before it is a marketing
                one, so here is exactly what the code does.
              </p>

              <ul className="mt-9 space-y-6">
                {securityPoints.map((point) => (
                  <li key={point.title} className="flex gap-4">
                    <span className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-600" aria-hidden="true">
                      <point.icon className="h-5 w-5" />
                    </span>
                    <span>
                      <span className="block text-base font-semibold text-slate-950">{point.title}</span>
                      <span className="mt-1.5 block text-sm leading-6 text-slate-600">{point.text}</span>
                    </span>
                  </li>
                ))}
              </ul>

              <div className="mt-9 rounded-2xl border border-slate-200 bg-slate-50/80 p-6">
                <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <ShieldCheck className="h-4 w-4 text-slate-500" aria-hidden="true" /> What we do not claim
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Garuda is not SOC 2 certified and holds no security certification today. Conversations are answered by
                  Google&rsquo;s Gemini through its OpenAI-compatible API. If a compliance badge is what your purchase depends on,
                  this is not yet the product for you — and we would rather you knew that now.
                </p>
                <p className="mt-4 text-sm">
                  <Link
                    href="/security"
                    className="font-semibold text-indigo-700 underline underline-offset-4 hover:text-indigo-900"
                  >
                    Read the full security and privacy detail
                  </Link>
                </p>
              </div>
            </div>

            <div className="lg:sticky lg:top-24">
              <WidgetConsentPreview />
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------- Pricing */}
        <section id="pricing" className="scroll-mt-16 border-y bg-slate-50/70 py-20 sm:py-28">
          <div className="container">
            <div className="mx-auto max-w-2xl text-center">
              <Badge variant="outline" className="mb-4 border-indigo-200 text-indigo-700">
                Pricing
              </Badge>
              <h2 className="text-3xl font-bold tracking-[-0.035em] text-slate-950 sm:text-[42px]">One plan. One price.</h2>
              <p className="mt-5 text-lg leading-8 text-slate-600">
                No setup fee, no per-seat maths, no sales call to find out the number.
              </p>
            </div>
            <Card className="mx-auto mt-12 max-w-[560px] overflow-hidden border-indigo-200 shadow-[0_24px_70px_rgba(79,70,229,.12)]">
              <p className="bg-gradient-to-r from-indigo-600 to-violet-600 px-6 py-2.5 text-center text-xs font-semibold uppercase tracking-[0.12em] text-white">
                Garuda starter plan
              </p>
              <CardContent className="p-7 sm:p-9">
                <div className="flex items-end justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-slate-500">Everything the product does today</p>
                    <p className="mt-2 flex items-end gap-1">
                      <span className="text-5xl font-bold tracking-[-.05em] text-slate-950">$17</span>
                      <span className="mb-1.5 text-sm font-medium text-slate-500">USD / month</span>
                    </p>
                  </div>
                  <span className="rounded-xl bg-indigo-50 p-3 text-indigo-600" aria-hidden="true">
                    <Sparkles className="h-6 w-6" />
                  </span>
                </div>
                <div className="my-7 h-px bg-slate-100" />
                <ul className="space-y-3.5">
                  {planFeatures.map((feature) => (
                    <li key={feature} className="flex items-start gap-3 text-sm leading-6 text-slate-700">
                      <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-indigo-50" aria-hidden="true">
                        <Check className="h-3 w-3 text-indigo-600" />
                      </span>
                      {feature}
                    </li>
                  ))}
                </ul>
                <Button size="lg" className="mt-8 w-full rounded-xl" asChild>
                  <Link href={CTA_HREF}>
                    {CTA_LABEL} <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
                  </Link>
                </Button>
                <p className="mt-4 text-center text-[11px] leading-5 text-slate-500">
                  Checkout and cancellation run through Stripe. Cancel whenever you like; the workspace stays active until the end
                  of the period you have already paid for.
                </p>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* ----------------------------------------------------------------- FAQ */}
        <section id="faq" className="scroll-mt-16 py-20 sm:py-28">
          <div className="container">
            <div className="mx-auto max-w-2xl text-center">
              <Badge variant="outline" className="mb-4 border-indigo-200 text-indigo-700">
                Questions buyers actually ask
              </Badge>
              <h2 className="text-balance text-3xl font-bold tracking-[-0.035em] text-slate-950 sm:text-[42px]">
                The objections, answered without a dodge.
              </h2>
            </div>
            <Faq />
            <p className="mx-auto mt-8 max-w-3xl text-center text-sm text-slate-600">
              More questions — limits, transcripts, who can see your data, what happens at the conversation cap —{" "}
              <Link href="/faq" className="font-semibold text-indigo-700 underline underline-offset-4 hover:text-indigo-900">
                are answered in the full FAQ
              </Link>
              .
            </p>
          </div>
        </section>

        {/* -------------------------------------------------------- Closing call */}
        <section className="pb-20 sm:pb-28">
          <div className="container">
            <div className="relative overflow-hidden rounded-[28px] bg-slate-950 px-6 py-14 text-center text-white sm:px-12 sm:py-20">
              <div className="absolute -left-24 -top-24 h-64 w-64 rounded-full bg-indigo-600/45 blur-[90px]" aria-hidden="true" />
              <div className="absolute -bottom-32 -right-20 h-72 w-72 rounded-full bg-violet-600/35 blur-[100px]" aria-hidden="true" />
              <div className="relative mx-auto max-w-2xl">
                <h2 className="text-balance text-3xl font-bold tracking-[-0.04em] sm:text-[42px]">
                  Four questions from now, you have a draft to read.
                </h2>
                <p className="mx-auto mt-5 max-w-xl text-base leading-7 text-slate-300">
                  Nothing appears on your website until you publish it, and the whole plan is USD $17 a month.
                </p>
                <Button size="lg" className="mt-8 bg-white text-slate-950 hover:bg-slate-100" asChild>
                  <Link href={CTA_HREF}>
                    {CTA_LABEL} <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
                  </Link>
                </Button>
                <p className="mt-5 text-xs text-slate-400">
                  Already have a workspace?{" "}
                  <Link href="/auth/sign-in" className="font-semibold text-white underline underline-offset-4">
                    Sign in
                  </Link>
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
