import type { Metadata } from "next";
import Link from "next/link";
import { AnswerSection, FactTable, SeoPageShell } from "@/components/site/seo-page-shell";
import { PLAN_LIMITS, faqPageJsonLd, pageMetadata } from "@/lib/seo";

const PATH = "/faq";
const REVIEWED = "30 August 2026";

export const metadata: Metadata = pageMetadata({
  title: "Garuda FAQ",
  description:
    "Direct answers about Garuda: what it is, the $17/month plan and its limits, how the website widget is installed, where answers come from, how visitor consent works, and what Garuda is not certified for.",
  path: PATH,
  socialTitle: "Garuda FAQ — direct answers about the product",
});

/**
 * The questions and their answers.
 *
 * `answer` is the complete, self-contained response. It is rendered as the lead
 * paragraph of the section AND used verbatim as the acceptedAnswer text in the
 * FAQPage JSON-LD, so the markup can never drift from what a reader sees.
 * `details` is optional supporting material.
 */
type Faq = { id: string; question: string; answer: string; details?: React.ReactNode };

const faqs: Faq[] = [
  {
    id: "what-is-garuda",
    question: "What is Garuda?",
    answer:
      "Garuda is a subscription service that creates a knowledge-grounded AI chat agent for your website. You answer four onboarding questions, Garuda drafts an agent from your answers, you edit that draft, and nothing reaches visitors until you publish it. Publishing gives you one script tag to paste into your site.",
    details: (
      <ul className="list-disc space-y-2 pl-5">
        <li>The agent answers from knowledge you approve, not from a crawl of the open web.</li>
        <li>It asks for contact details only after the visitor explicitly agrees, and stores the lead with its conversation.</li>
        <li>It runs only on the domains you allow.</li>
        <li>
          You review conversations, leads and workspace activity in the portal at{" "}
          <Link href="/auth/sign-in" className="font-medium text-indigo-700 underline underline-offset-4">
            your Garuda workspace
          </Link>
          .
        </li>
      </ul>
    ),
  },
  {
    id: "how-much-does-garuda-cost",
    question: "How much does Garuda cost?",
    answer:
      "Garuda costs USD $17 per month. There is one plan, no setup fee and no free tier: you subscribe through Stripe Checkout before you generate your first agent, and you can cancel at any time.",
    details: (
      <p>
        Payment runs through Stripe Checkout, so card details go to Stripe and never reach Garuda&rsquo;s servers. Cancelling
        applies at the end of the period you have already paid for, as set out in the{" "}
        <Link href="/terms" className="font-medium text-indigo-700 underline underline-offset-4">
          terms
        </Link>
        .
      </p>
    ),
  },
  {
    id: "plan-limits",
    question: "What are the limits on the $17 plan?",
    answer: `One workspace can keep up to ${PLAN_LIMITS.publishedAgents} agents published, start ${PLAN_LIMITS.monthlyConversations} conversations in any rolling ${PLAN_LIMITS.conversationWindowDays}-day window, and attach ${PLAN_LIMITS.knowledgeSourcesPerAgent} knowledge sources per agent of up to ${PLAN_LIMITS.charactersPerSource.toLocaleString("en-US")} characters each.`,
    details: (
      <FactTable
        caption="Limits enforced on the Garuda plan"
        head={["Limit", "Value"]}
        rows={[
          ["Published agents per workspace", `${PLAN_LIMITS.publishedAgents}`],
          [
            "Conversations",
            `${PLAN_LIMITS.monthlyConversations} in any rolling ${PLAN_LIMITS.conversationWindowDays}-day window, counted per workspace`,
          ],
          ["Knowledge sources per agent", `${PLAN_LIMITS.knowledgeSourcesPerAgent}`],
          ["Characters per knowledge source", PLAN_LIMITS.charactersPerSource.toLocaleString("en-US")],
          ["Returning-visitor memory window", `${PLAN_LIMITS.conversationWindowDays} days, and only with the visitor's consent`],
          ["Draft agents", "Not limited; the limit applies to published agents"],
        ]}
      />
    ),
  },
  {
    id: "conversation-limit",
    question: "What happens when I reach the conversation limit?",
    answer: `A conversation is counted from the visitor's first message. Once a workspace has started ${PLAN_LIMITS.monthlyConversations} conversations inside the rolling ${PLAN_LIMITS.conversationWindowDays}-day window, new ones are refused with a "conversation limit reached" response until older conversations fall outside the window. Conversations already under way carry on normally.`,
  },
  {
    id: "setting-up-an-agent",
    question: "What does setting up an agent actually involve?",
    answer:
      "Four steps. You answer four onboarding questions about your business, Garuda drafts an agent from those answers, you edit the draft and add the knowledge it should answer from, then you publish it and paste the embed snippet into your site.",
    details: (
      <>
        <p>The four onboarding questions are, word for word:</p>
        <ol className="list-decimal space-y-2 pl-5">
          <li>Tell me about your business, what it offers, and your website if you have one.</li>
          <li>What is the main outcome you want this assistant to create?</li>
          <li>Who is your ideal visitor, and what products or services should the assistant discuss?</li>
          <li>How should the assistant sound, and when should it request contact details or hand off to a person?</li>
        </ol>
        <p>
          A generated agent is created as a draft. Draft agents are not reachable from the widget at all, so you can rewrite the
          instructions and test the agent privately before anyone sees it.
        </p>
      </>
    ),
  },
  {
    id: "install-the-widget",
    question: "How do I add the agent to my website?",
    answer:
      "You copy one script tag from the agent's page in the portal and paste it into your site's HTML. It has the form <script async src=\"https://api.garuda.ravan.ai/widget.js\" data-agent-key=\"…\"></script>. There is no package to install and no build step.",
    details: (
      <>
        <pre className="overflow-x-auto rounded-xl border border-slate-200 bg-slate-950 p-4 text-xs leading-6 text-slate-100">
          <code>{`<script async src="https://api.garuda.ravan.ai/widget.js"\n        data-agent-key="pub_live_…"></script>`}</code>
        </pre>
        <p>
          The script loads asynchronously and waits for the page to be ready before it mounts, so it can sit anywhere in the
          HTML. The agent key it carries is the public key of one published agent — it is meant to be visible in your page
          source, and on its own it only works from the domains you allowed.
        </p>
      </>
    ),
  },
  {
    id: "widget-impact",
    question: "Will the chat widget interfere with my site's design or speed?",
    answer:
      "The widget renders inside a Shadow DOM, so its styles and your site's styles cannot reach each other. It is served gzipped at about 27 KB, loads asynchronously, and pulls in no third-party scripts or fonts — the only network requests it makes are to the Garuda API.",
  },
  {
    id: "where-answers-come-from",
    question: "Where do the agent's answers come from?",
    answer:
      "From the instructions you approve and the knowledge sources you add to that agent. Garuda passes that text to the model as reference material and explicitly instructs the model to treat it as data rather than as commands, which limits what a hostile piece of pasted text can do.",
    details: (
      <p>
        Garuda does not crawl your website for you. You can record the URL a source came from, but the text itself has to be
        supplied — server-side URL fetching is not enabled, and the API says so outright when a URL arrives without text. If a
        question is outside the knowledge you added, the agent has nothing of yours to answer from.
      </p>
    ),
  },
  {
    id: "which-model",
    question: "Which AI model does Garuda use?",
    answer:
      "Google's Gemini, reached through Gemini's OpenAI-compatible API endpoint. The model is a deployment setting rather than something hard-coded, so any OpenAI-compatible endpoint can be configured, but Gemini is what the live service runs on.",
  },
  {
    id: "lead-consent",
    question: "When does Garuda collect a visitor's contact details?",
    answer:
      "Only after the visitor explicitly agrees. The lead form carries a consent checkbox, and the API rejects any submission that does not carry consent with a 422 error and stores nothing. When consent is given, the contact record is saved with the conversation it came from and with the consent evidence beside it.",
    details: (
      <p>
        The stored evidence includes the consent flag, the notice version the visitor saw, whether they accepted the privacy
        notice, and the moment of consent when the browser supplies a valid timestamp. Details typed into the portal by hand are
        recorded as a manual lead, never as a consented capture.
      </p>
    ),
  },
  {
    id: "cross-site-tracking",
    question: "Does Garuda track visitors across websites?",
    answer:
      "No. A returning visitor is recognised by an identifier derived from the server's secret key, the specific agent's id and the visitor's own token, so the same browser talking to a different Garuda agent produces a different, unlinkable id. If the visitor declines memory, no token is kept and the session gets a throwaway identifier.",
    details: (
      <p>
        There is no cross-site cookie and no shared visitor identifier of any kind.{" "}
        <Link href="/security" className="font-medium text-indigo-700 underline underline-offset-4">
          The security page
        </Link>{" "}
        sets out exactly how the identifier is derived.
      </p>
    ),
  },
  {
    id: "domain-control",
    question: "Can I control which websites my agent runs on?",
    answer:
      "Yes. Each agent carries a list of allowed domains. Every widget request includes the browser's Origin header, and in production a request from an origin that is not on that list is answered as though the agent does not exist. A session is then pinned to the origin it started on.",
  },
  {
    id: "integrations",
    question: "What can Garuda connect to?",
    answer:
      "1,431 third-party products through Composio, including Google Calendar, Slack, HubSpot, Salesforce and Highlevel — a count checked against the live catalogue on 30 August 2026. Each customer connects their own account. Today this is connection management: agents cannot yet call those tools during a conversation.",
    details: (
      <p>
        The{" "}
        <Link href="/integrations" className="font-medium text-indigo-700 underline underline-offset-4">
          integrations page
        </Link>{" "}
        lists the real categories, example tools and what is and is not built yet.
      </p>
    ),
  },
  {
    id: "who-sees-my-data",
    question: "Who can see my conversations and leads?",
    answer:
      "Your workspace. Every portal request resolves an account from the caller's signed token and filters on it, and every widget request resolves the account from the published agent's key, so there is no view across workspaces. Garuda does not sell personal information.",
  },
  {
    id: "certifications",
    question: "Is Garuda SOC 2 certified?",
    answer:
      "No. Garuda holds no SOC 2, ISO 27001, HIPAA or PCI attestation, and no independent penetration test has been published. Card details are handled by Stripe Checkout and never reach Garuda's servers.",
    details: (
      <p>
        The{" "}
        <Link href="/security" className="font-medium text-indigo-700 underline underline-offset-4">
          security page
        </Link>{" "}
        lists both what is in place — consent gating, agent-scoped visitor identifiers, domain allowlisting, hashed session
        tokens, rate limits — and what is not, in plain terms.
      </p>
    ),
  },
  {
    id: "cancelling",
    question: "Can I cancel, and what happens to my data?",
    answer:
      "You can cancel at any time from the Stripe billing portal, and the subscription runs to the end of the period you paid for. Once a subscription is no longer active, published agents stop serving visitors and answer that the assistant is unavailable, while your conversations and leads stay in your workspace.",
    details: (
      <p>
        There is no self-service account-deletion button yet. Deletion requests go through the contact address published on the{" "}
        <Link href="/privacy" className="font-medium text-indigo-700 underline underline-offset-4">
          privacy page
        </Link>
        .
      </p>
    ),
  },
  {
    id: "developer-needed",
    question: "Do I need a developer to use Garuda?",
    answer:
      "Only to paste one line of HTML into your site. Onboarding, editing the agent, adding knowledge, publishing, and reviewing conversations and leads all happen in the portal with no code.",
  },
  {
    id: "what-the-portal-shows",
    question: "What does the Garuda portal show me?",
    answer:
      "Your agents and their drafts, the conversations your agents have handled with the full message history, the leads captured with consent, and workspace activity totals.",
  },
];

export default function FaqPage() {
  return (
    <SeoPageShell
      eyebrow="Frequently asked questions"
      title="Garuda, answered directly"
      summary="Garuda builds a knowledge-grounded AI chat agent for your website: four onboarding questions, a draft you edit, one script tag, USD $17 per month. Every answer below is written from the product as it works today, including the parts that are not built yet."
      breadcrumb={{ name: "FAQ", path: "/faq" }}
      reviewed={REVIEWED}
      structuredData={[
        faqPageJsonLd(
          faqs.map((faq) => ({ question: faq.question, answer: faq.answer })),
          PATH,
        ),
      ]}
    >
      <nav aria-labelledby="on-this-page" className="mb-10 rounded-2xl border border-slate-200 bg-slate-50/70 p-5 sm:p-6">
        <h2 id="on-this-page" className="text-sm font-bold uppercase tracking-[.14em] text-slate-500">
          On this page
        </h2>
        <ol className="mt-4 grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {faqs.map((faq) => (
            <li key={faq.id}>
              <Link
                href={`#${faq.id}`}
                className="rounded-sm text-sm leading-6 text-slate-700 underline-offset-4 hover:text-indigo-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                {faq.question}
              </Link>
            </li>
          ))}
        </ol>
      </nav>

      <div>
        {faqs.map((faq) => (
          <AnswerSection key={faq.id} id={faq.id} question={faq.question} answer={faq.answer}>
            {faq.details}
          </AnswerSection>
        ))}
      </div>
    </SeoPageShell>
  );
}
