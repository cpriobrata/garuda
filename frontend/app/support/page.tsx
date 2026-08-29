import type { Metadata } from "next";
import Link from "next/link";
import { AnswerSection, FactTable, SeoPageShell } from "@/components/site/seo-page-shell";
import { faqPageJsonLd, pageMetadata, PLAN_LIMITS } from "@/lib/seo";

/**
 * Support.
 *
 * The three checks in "before you write" are the three failures the code makes
 * most likely, and each one is grounded:
 *
 *   - an origin that is not on the agent's allowlist is answered as though the
 *     agent does not exist        backend/internal/api/widget.go widgetOriginAllowed
 *   - the agent is told to use only supplied knowledge, to say when information
 *     is missing, and never to invent facts
 *                                backend/internal/llm/client.go, api/agents.go promptForAgent
 *   - a lead without consent is refused and nothing is written
 *                                backend/internal/api/widget.go widgetLead
 *
 * OWNER DECISION — THE REPLY TARGET. Garuda publishes no support SLA and nothing
 * in the product enforces a response time, so this page promises none. If Ravan
 * AI settles on a target it will stand behind, state it here and on /refunds as
 * an aim, labelled as an aim, in both places.
 */

const PATH = "/support";
const REVIEWED = "30 August 2026";
const SUPPORT_EMAIL = "info@ravan.ai";

export const metadata: Metadata = pageMetadata({
  title: "Support",
  description:
    "How to get help with Garuda: the three checks that explain most problems, what to put in a support email so it can be answered, where to find the request id, and where the written answers live.",
  path: PATH,
  socialTitle: "Garuda support",
});

const answers = [
  {
    id: "before-you-write",
    question: "Before you write: three checks that explain most problems",
    answer:
      "The widget not appearing, the agent saying it does not know, and a lead that never arrived. Each one usually has a single cause: a website domain that is not on the agent's allowlist, a question no knowledge source covers, and a visitor who never consented.",
    body: (
      <>
        <FactTable
          caption="The three most common problems and their usual cause"
          head={["What you are seeing", "Usual cause", "Where to look"]}
          rows={[
            [
              "No chat bubble on your website",
              "The agent is not published, or the domain is not on its allowlist",
              "The agent's Appearance settings, then the page's address bar",
            ],
            [
              "The agent says it does not know",
              "No approved knowledge source covers that question",
              "The agent's Knowledge sources",
            ],
            [
              "A conversation happened but no lead appeared",
              "The visitor never consented, or never gave an email or phone number",
              "The conversation in your inbox",
            ],
          ]}
        />

        <h3 className="pt-2 text-base font-semibold text-slate-900">The widget does not appear on my site</h3>
        <p>Four things have to be true before the chat bubble opens, and they fail in roughly this order.</p>
        <ul className="ml-5 list-disc space-y-2">
          <li>
            <strong className="font-semibold text-slate-900">The agent is published.</strong> A draft agent and a paused agent
            both serve nobody. Publishing is what puts an agent on the air.
          </li>
          <li>
            <strong className="font-semibold text-slate-900">The domain is on the allowlist.</strong> Every widget request
            carries the browser&rsquo;s origin, and Garuda answers a request from an origin the owner has not approved exactly
            as it answers an unknown agent: as though it does not exist. So the widget does not warn you, it simply never
            opens. Set the domain in the agent&rsquo;s Appearance settings.
          </li>
          <li>
            <strong className="font-semibold text-slate-900">The host matches exactly.</strong> The check compares hosts, not
            parent domains, so <code className="rounded bg-slate-100 px-1 py-0.5 text-[13px]">www.example.com</code> and{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5 text-[13px]">example.com</code> are two different entries, and a
            staging or preview domain is a third. Enter the host on its own, without{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5 text-[13px]">https://</code> and without a path.
          </li>
          <li>
            <strong className="font-semibold text-slate-900">The subscription is active.</strong> A past-due or cancelled
            workspace stops serving visitors, who are told the assistant is temporarily unavailable. See{" "}
            <Link href="/refunds#failed-payment" className="font-medium text-indigo-700 underline underline-offset-4">
              what a failed payment does
            </Link>
            .
          </li>
        </ul>
        <p>
          If all four hold, check that the embed snippet is really on the rendered page — copy it from the portal rather than
          retyping it, and view the page source to confirm it survived your CMS.
        </p>

        <h3 className="pt-2 text-base font-semibold text-slate-900">The agent answers that it does not know</h3>
        <p>
          That is usually the agent working correctly. An agent answers from the instructions and the knowledge sources you
          approved, and it is told to use only that material, to say so when information is missing, and never to invent prices,
          availability, policies, guarantees or legal claims. &ldquo;I do not know&rdquo; is the right answer to a question your
          knowledge does not cover, and it is the behaviour that keeps the agent from making something up.
        </p>
        <p>
          The fix is to add a knowledge source that answers the question in plain words. You can add up to{" "}
          {PLAN_LIMITS.knowledgeSourcesPerAgent} sources per agent, up to{" "}
          {PLAN_LIMITS.charactersPerSource.toLocaleString("en-US")} characters each. One non-obvious cause is worth knowing:
          when the prompt is assembled, each source contributes at most 12,000 characters and the assembled prompt stops at
          about 40,000, so the tail of a very long source can go unused. Split long documents into focused sources and put the
          answer near the top of each one.
        </p>

        <h3 className="pt-2 text-base font-semibold text-slate-900">A visitor chatted but no lead appeared</h3>
        <p>
          Consent is the usual answer. Garuda refuses to store contact details without it: a submission that does not carry
          consent is rejected and nothing at all is written, and the consent box on the widget&rsquo;s lead form is required
          before the form will send. A conversation in your inbox with no lead beside it means the visitor talked but never
          agreed.
        </p>
        <ul className="ml-5 list-disc space-y-2">
          <li>A lead also needs at least an email address or a phone number. Neither one, no lead.</li>
          <li>Lead capture has to be enabled on that agent for the form to be offered at all.</li>
          <li>
            Contact details you type into the portal yourself are stored as manual leads and say plainly that no consent
            evidence was collected, so they never get counted as consented captures.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "how-to-get-support",
    question: "How do I get support?",
    answer: `Email ${SUPPORT_EMAIL}. That is the only support channel: there is no phone line, no live chat with a person, and no ticket portal.`,
    body: (
      <p>
        Garuda offers no support SLA, and this page does not promise a response time, because nothing in the product enforces
        one and a number invented for a web page is worth nothing to you. What helps instead is a message that can be answered
        on the first reading — which is what the next section is about. If a reply matters by a particular date, say so in the
        subject line.
      </p>
    ),
  },
  {
    id: "what-to-include",
    question: "What should I put in the message?",
    answer:
      "Enough for someone to reproduce what you saw: the account email, which agent it was, what you expected, what actually happened, where and when, and the request id from any error.",
    body: (
      <>
        <FactTable
          caption="What to include in a support email"
          head={["Include", "Why"]}
          rows={[
            ["The email address on your account", "It identifies the workspace. Writing from that address is the fastest evidence"],
            ["The agent's name, and the site it is published on", "Most problems belong to one agent and one domain"],
            ["What you expected to happen", "The gap between expectation and behaviour is often the whole bug"],
            ["What actually happened, in the words on screen", "Exact error text is searchable; a paraphrase is not"],
            ["The page URL and roughly when it happened", "Server logs are found by time and path"],
            ["The request id, if there was an error", "It matches your report to the exact log line for that request"],
          ]}
        />
        <p>
          <strong className="font-semibold text-slate-900">Finding the request id.</strong> Every Garuda API response carries an{" "}
          <code className="rounded bg-slate-100 px-1 py-0.5 text-[13px]">X-Request-ID</code> header, and every error body
          carries the same value as{" "}
          <code className="rounded bg-slate-100 px-1 py-0.5 text-[13px]">request_id</code>. The portal does not print it on
          screen yet, so the reliable way to get it is your browser&rsquo;s developer tools: open the Network tab, repeat the
          action, select the failed request, and copy the id from the response headers. If you cannot get to it, send the exact
          error text and the time instead — that is usually enough.
        </p>
        <p>
          A screenshot helps. A password never does: no Garuda email will ever ask for your password, an access token or a card
          number, so please do not put any of them in a message.
        </p>
      </>
    ),
  },
  {
    id: "answers-first",
    question: "Where are the written answers?",
    answer:
      "In the help centre, for step-by-step guides to the setup tasks, and in the FAQ, which is the fullest set of short answers on this site. Anything about data handling is on the security page.",
    body: (
      <>
        <FactTable
          caption="Where each kind of question is answered"
          head={["Page", "What it answers"]}
          rows={[
            [
              <Link key="help" href="/help" className="font-medium text-indigo-700 underline underline-offset-4">
                Help centre
              </Link>,
              "Step-by-step guides: creating your first agent, adding knowledge, approving the domains an agent may run on, installing the widget",
            ],
            [
              <Link key="faq" href="/faq" className="font-medium text-indigo-700 underline underline-offset-4">
                FAQ
              </Link>,
              "Cost, plan limits, what happens at the conversation cap, installing the widget, where answers come from, cancelling",
            ],
            [
              <Link key="security" href="/security" className="font-medium text-indigo-700 underline underline-offset-4">
                Security
              </Link>,
              "Consent, visitor identity, domain allowlisting, third parties, and a plain list of what Garuda does not have",
            ],
            [
              <Link key="refunds" href="/refunds" className="font-medium text-indigo-700 underline underline-offset-4">
                Refunds
              </Link>,
              "Cancelling, what a failed payment does, part-months, and how to ask for a refund",
            ],
            [
              <Link key="privacy" href="/privacy" className="font-medium text-indigo-700 underline underline-offset-4">
                Privacy
              </Link>,
              "What is collected, how it is used, and how to ask for data to be removed",
            ],
            [
              <Link key="contact" href="/contact" className="font-medium text-indigo-700 underline underline-offset-4">
                Contact
              </Link>,
              "Which enquiry goes where, and what Garuda cannot help with",
            ],
          ]}
        />
        <p>
          If you would rather be walked through a task than look up an answer, start at the{" "}
          <Link href="/help" className="font-medium text-indigo-700 underline underline-offset-4">
            help centre
          </Link>
          . Two questions come up often enough to answer here as well. The conversation limit is{" "}
          {PLAN_LIMITS.monthlyConversations} conversations in any rolling {PLAN_LIMITS.conversationWindowDays} days: past that,
          new conversations are refused until older ones fall outside the window, while conversations already under way carry on
          normally. And billing is managed by the workspace owner only — Garuda refuses to open the billing portal for anyone
          else on the account.
        </p>
      </>
    ),
  },
  {
    id: "is-it-garuda",
    question: "How do I tell whether the problem is Garuda or my site?",
    answer:
      "Garuda publishes no status page and offers no uptime SLA, so the practical test is scope. If the portal works and your other agents answer, it is nearly always configuration on the one agent. If nothing responds anywhere, say so in your email and include the time it started.",
    body: (
      <p>
        A quick way to separate the two: open the page your widget is installed on in a private window and watch whether the
        bubble appears at all. A bubble that never appears points at publishing, the domain allowlist or the snippet. A bubble
        that appears and then fails on a message points at the conversation itself, and that is when the request id from an
        error is worth the two minutes it takes to find.
      </p>
    ),
  },
  {
    id: "billing-questions",
    question: "Where do billing questions go?",
    answer:
      "The same address, and the answers to most of them are already written down: cancelling, part-month refunds, failed payments and receipts are all covered on the refunds page.",
    body: (
      <p>
        Read{" "}
        <Link href="/refunds" className="font-medium text-indigo-700 underline underline-offset-4">
          refunds and cancellation
        </Link>{" "}
        first, then write to{" "}
        <a href={`mailto:${SUPPORT_EMAIL}`} className="font-medium text-indigo-700 underline underline-offset-4">
          {SUPPORT_EMAIL}
        </a>{" "}
        with the account email and the charge you are asking about.
      </p>
    ),
  },
];

export default function SupportPage() {
  return (
    <SeoPageShell
      eyebrow="Support"
      title="Getting help with Garuda"
      summary={`Support runs through one address: ${SUPPORT_EMAIL}. Most problems are one of three things — a domain that is not on the agent's allowlist, a question no knowledge source covers, or a visitor who never consented — and all three are fixable in the portal in minutes. The help centre and the FAQ answer the rest.`}
      breadcrumb={{ name: "Support", path: PATH }}
      reviewed={REVIEWED}
      structuredData={[
        faqPageJsonLd(
          answers.map((item) => ({ question: item.question, answer: item.answer })),
          PATH,
        ),
      ]}
    >
      <div>
        {answers.map((item) => (
          <AnswerSection key={item.id} id={item.id} question={item.question} answer={item.answer}>
            {item.body}
          </AnswerSection>
        ))}
      </div>
    </SeoPageShell>
  );
}
