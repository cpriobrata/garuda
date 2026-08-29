import type { Metadata } from "next";
import Link from "next/link";
import { AnswerSection, FactTable, SeoPageShell } from "@/components/site/seo-page-shell";
import { faqPageJsonLd, pageMetadata, PLAN_LIMITS, PLAN_PRICE_USD } from "@/lib/seo";

/**
 * Refunds and cancellation.
 *
 * Every statement here is taken from code that runs, not from intent:
 *
 *   - the price and the monthly interval          backend/internal/config/config.go (GARUDA_PLAN_AMOUNT_CENTS=1700)
 *   - no free trial, payment before access        backend/internal/billing/stripe.go CreateCheckout (no trial_period_days)
 *                                                 backend/internal/api/auth.go (a new account starts "incomplete")
 *   - cancel takes effect at the period end       backend/internal/api/billing.go cancelBillingSubscription
 *   - access while a cancellation is pending      backend/internal/api/server.go hasEntitlement (active or trialing)
 *   - a failed payment stops the agents           backend/internal/api/billing.go applyStripeEvent (past_due)
 *   - cancelling deletes nothing                  no deletion path exists anywhere in the API
 *
 * OWNER DECISION — THE REFUND WINDOW.
 * Nothing in the product enforces a refund window, and no window has been agreed,
 * so this page states none. Inventing one ("14 days") would be a promise the owner
 * never made. When Ravan AI decides on a window, replace the paragraph marked
 * "REFUND WINDOW" in the "partial-refunds" section below with the rule, and say
 * plainly how it is counted: from the charge, or from the day the workspace was
 * created. Until then the honest answer is that a person reads every request.
 *
 * OWNER DECISION — THE REPLY TARGET.
 * Garuda publishes no support SLA and nothing enforces a response time, so this
 * page promises none. If the team settles on a target it is willing to stand
 * behind, state it here and on /support as an aim, in both places, and label it
 * as an aim rather than a guarantee.
 */

const PATH = "/refunds";
const REVIEWED = "30 August 2026";
const SUPPORT_EMAIL = "info@ravan.ai";

export const metadata: Metadata = pageMetadata({
  title: "Refunds and cancellation",
  description:
    "How the $17 monthly Garuda subscription is cancelled, what happens to access and data at the end of a paid period, whether part-months are refunded, how to ask for a refund, and what a failed payment does to a workspace.",
  path: PATH,
  socialTitle: "Garuda refunds and cancellation policy",
});

const answers = [
  {
    id: "what-you-pay-for",
    question: "What am I paying for?",
    answer: `One subscription: USD $${PLAN_PRICE_USD} a month, taken by Stripe and renewing every month until you cancel. There is no setup fee, no per-seat pricing, no minimum term and no free trial — the first $${PLAN_PRICE_USD} is charged at checkout, before the workspace can publish anything.`,
    body: (
      <>
        <FactTable
          caption="The Garuda subscription at a glance"
          head={["Term", "What it is"]}
          rows={[
            ["Price", `USD $${PLAN_PRICE_USD} per month`],
            ["Billing interval", "Monthly, renewing until you cancel"],
            [
              "Who takes the payment",
              "Stripe. Card details are entered on Stripe's own hosted checkout page and never reach Garuda's servers",
            ],
            ["Free trial", "None. The first month is paid up front"],
            ["Discount codes", "Accepted on the Stripe checkout page"],
            ["Minimum term", "None. You can cancel at any time"],
          ]}
        />
        <p>
          The subscription includes up to {PLAN_LIMITS.publishedAgents} published agents,{" "}
          {PLAN_LIMITS.monthlyConversations} conversations in any rolling {PLAN_LIMITS.conversationWindowDays}-day window, and
          up to {PLAN_LIMITS.knowledgeSourcesPerAgent} knowledge sources per agent. The full list is on the{" "}
          <Link href="/#pricing" className="font-medium text-indigo-700 underline underline-offset-4">
            pricing section of the home page
          </Link>
          .
        </p>
      </>
    ),
  },
  {
    id: "how-to-cancel",
    question: "How do I cancel?",
    answer:
      "In the portal: open Billing in the left-hand menu and use Manage in Stripe. That opens your Stripe billing portal, where cancelling schedules the subscription to end when the period you have already paid for runs out. Only the owner of the workspace can open it.",
    body: (
      <>
        <ol className="ml-5 list-decimal space-y-2 marker:font-semibold marker:text-slate-400">
          <li>
            Sign in and open{" "}
            <Link href="/app/billing" className="font-medium text-indigo-700 underline underline-offset-4">
              Billing
            </Link>{" "}
            in the portal.
          </li>
          <li>Choose Manage in Stripe. The button opens the Stripe billing portal for your workspace.</li>
          <li>Cancel the subscription there, and Stripe tells Garuda what you did.</li>
        </ol>
        <p>
          That is the whole job. There is nothing else to switch off inside Garuda, and you do not need to email anyone to
          cancel. If the portal will not open for you, check that you are signed in as the workspace owner — Garuda refuses the
          request for anyone else.
        </p>
      </>
    ),
  },
  {
    id: "after-you-cancel",
    question: "What happens after I cancel?",
    answer:
      "Nothing changes until the period you paid for runs out. Your agents keep answering visitors and the portal keeps working. When the period ends, the subscription becomes cancelled: every published agent stops answering and visitors are told the assistant is unavailable. Your conversations, leads and agent settings stay in the workspace.",
    body: (
      <>
        <FactTable
          caption="What a cancellation changes, and when"
          head={["When", "What happens"]}
          rows={[
            [
              "The moment you cancel",
              "The cancellation is scheduled for the end of the period. Access, agents and the widget carry on exactly as before",
            ],
            [
              "Any time before the period ends",
              "You can undo it in the same Stripe portal and the subscription simply keeps running",
            ],
            [
              "The end of the paid period",
              "The subscription becomes cancelled, and every published agent stops answering visitors",
            ],
            [
              "After that",
              "Signing in still works. Conversations, leads and agent settings are all still there — cancelling deletes nothing",
            ],
          ]}
        />
        <p>
          Cancelling is not deletion, and Garuda has no self-service delete button. If you want the data removed as well, that
          is a separate request: write to{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="font-medium text-indigo-700 underline underline-offset-4">
            {SUPPORT_EMAIL}
          </a>{" "}
          from the account email and say so. Nothing sweeps a cancelled workspace clean on a timer, so the honest description is
          that removal happens when it is asked for.
        </p>
      </>
    ),
  },
  {
    id: "partial-refunds",
    question: "Do you refund part of a month?",
    answer:
      "Not automatically. Cancelling stops the next charge and leaves the month you already paid for running to its end, and nothing in the product prorates a part-month or issues a refund on its own. To get money back for a period you have been billed for, you have to ask, and a person decides.",
    body: (
      <>
        {/* REFUND WINDOW — see the OWNER DECISION note at the top of this file. */}
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-5">
          <p className="text-sm font-semibold text-slate-900">There is no published refund window yet</p>
          <p className="mt-2 text-[15px] leading-7 text-slate-600">
            Garuda has not agreed a fixed number of days inside which a refund is automatic, so this page does not state one
            rather than inventing a promise. Until a window is published here, every request is judged on what happened, not on
            a deadline. Asking early always helps.
          </p>
        </div>
        <p>
          Two situations are worth separating. If Garuda did not do what this site says it does, say so and ask — that is the
          case a refund exists for. If the product worked and you simply stopped using it, cancelling is the remedy: it ends the
          next charge, and the month you already paid for is one you already had.
        </p>
      </>
    ),
  },
  {
    id: "how-to-ask",
    question: "How do I ask for a refund?",
    answer: `Email ${SUPPORT_EMAIL} from the address on the account. Say what you want refunded and why, and include the charge details so the request can be matched to a payment without a round trip.`,
    body: (
      <>
        <FactTable
          caption="What to include in a refund request"
          head={["Include", "Why it matters"]}
          rows={[
            ["The account email", "It is how a workspace is identified. Sending from that address is the quickest evidence"],
            ["The date and amount of the charge", "Matches the request to one payment rather than to a subscription"],
            ["The invoice or receipt number from Stripe", "Both are in the Stripe billing portal, and Stripe emails the receipt"],
            ["What went wrong", "A refund decision is a judgement about what happened, so the account of it is the request"],
            ["Whether you have already cancelled", "A refund and a cancellation are separate actions; neither implies the other"],
          ]}
        />
        <p>
          Garuda offers no support SLA, and no response time is promised here — see{" "}
          <Link href="/support" className="font-medium text-indigo-700 underline underline-offset-4">
            the support page
          </Link>{" "}
          for how that works. If your request is time-critical, say so in the subject line. A refund, when it is agreed, is
          returned by Stripe to the card that paid, and the time it takes to appear is the card issuer&rsquo;s, not
          Garuda&rsquo;s.
        </p>
      </>
    ),
  },
  {
    id: "failed-payment",
    question: "What happens if a payment fails?",
    answer:
      "The workspace loses access as soon as Stripe reports the failed invoice. Garuda marks the subscription past due, and a workspace that is not active is not entitled: published agents stop answering and visitors are told the assistant is temporarily unavailable. Signing in still works, so you can fix the card.",
    body: (
      <>
        <FactTable
          caption="A failed payment, step by step"
          head={["Event", "What Garuda does"]}
          rows={[
            ["Stripe reports a failed invoice", "The subscription is marked past due, and published agents stop answering visitors"],
            ["You update the card", "Billing, then Manage in Stripe, then replace the payment method"],
            ["A later attempt succeeds", "The paid invoice puts the subscription back to active and agents answer again with no further action"],
            ["Stripe ends the subscription", "The workspace is marked cancelled. Your conversations, leads and agents remain"],
          ]}
        />
        <p>
          This is the part worth knowing before it happens: a failed card is not a grace period. The widget on your website
          stops the moment the failure is recorded, so an expiring card is worth replacing before it expires rather than after.
        </p>
      </>
    ),
  },
  {
    id: "first-purchase",
    question: "I have just subscribed and it is not what I expected.",
    answer:
      "Then write, and say what you expected. There is no free trial, so the first $17 is spent before you have built anything — which makes the first month the most reasonable time to ask for it back.",
    body: (
      <>
        <p>
          Creating a Garuda account and signing in are free. What the subscription buys is the ability to build: without an
          active subscription, onboarding, creating an agent and publishing one are all refused, and the widget does not serve.
          So the sequence is genuinely pay first, build second, and that is worth being blunt about on the page that handles
          refunds.
        </p>
        <p>
          Before asking for the money back, it is worth ten minutes on{" "}
          <Link href="/support" className="font-medium text-indigo-700 underline underline-offset-4">
            the support page
          </Link>
          . Most first-day problems are one of three things: the widget not appearing because the website domain is not on the
          agent&rsquo;s allowlist, the agent saying it does not know because no knowledge source covers the question, or a lead
          that was never captured because the visitor never consented. All three are fixable in the portal in minutes.
        </p>
      </>
    ),
  },
  {
    id: "receipts",
    question: "Where are my invoices and receipts?",
    answer:
      "In your Stripe billing portal. Open Billing in the portal and choose Open Stripe billing to download receipts, see past invoices or change the billing details Stripe holds.",
    body: (
      <p>
        Garuda&rsquo;s own billing screen shows the price, the date the current period ends and the plan limits, and hands
        everything else to Stripe. That is deliberate: invoices, cards and tax details live with the company that processes the
        payment.
      </p>
    ),
  },
  {
    id: "terms",
    question: "Does this page override the terms?",
    answer:
      "No. The terms are the agreement; this page describes how cancellation and refunds are handled in practice and what the software actually does. Where the two differ, the terms govern.",
    body: (
      <p>
        The{" "}
        <Link href="/terms" className="font-medium text-indigo-700 underline underline-offset-4">
          terms
        </Link>{" "}
        cover what you are responsible for as the owner of a published agent, and the{" "}
        <Link href="/privacy" className="font-medium text-indigo-700 underline underline-offset-4">
          privacy page
        </Link>{" "}
        covers what is collected and how to ask for it to be removed. Nothing here is legal advice.
      </p>
    ),
  },
];

export default function RefundsPage() {
  return (
    <SeoPageShell
      eyebrow="Refunds and cancellation"
      title="Cancelling, refunds, and what happens to your money"
      summary={`Garuda is one USD $${PLAN_PRICE_USD} monthly subscription with no minimum term. Cancel from the Stripe billing portal and your workspace keeps working until the end of the period you paid for. Part-months are not refunded automatically; a refund is a request a person answers, and this page does not invent a deadline for making one.`}
      breadcrumb={{ name: "Refunds", path: PATH }}
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
