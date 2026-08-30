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
 * THE REFUND POLICY — decided by the owner, 30 August 2026: Garuda does not give
 * refunds. Cancelling stops the next charge and the period already paid for runs
 * to its end.
 *
 * It is stated plainly and early rather than buried, for the owner's sake as much
 * as the customer's: a no-refund policy a customer only discovers after paying is
 * the one that produces a chargeback, and a chargeback costs the fee, the amount,
 * and a mark against the Stripe account. Stripe requires the policy be clearly
 * published; this page is where.
 *
 * The single carve-out is not a softening of it. Consumer law in some countries
 * gives a right to cancel a digital purchase that no contract term can remove,
 * and a clause claiming otherwise is the kind a regulator strikes out whole.
 * Naming the exception is what makes the rest of the clause stand up.
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
    "Garuda gives no refunds: payments are final and part-months are not prorated. How the $17 monthly subscription is cancelled, what happens to access and data at the end of a paid period, and what a failed payment does to a workspace.",
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
      "In the portal: open Billing in the left-hand menu and choose Cancel subscription. Cancelling schedules the subscription to end when the period you have already paid for runs out, so nothing stops the moment you click. Only the owner of the workspace can do it.",
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
          <li>Choose Cancel subscription, and confirm in the dialog. It tells you the exact date access ends before you confirm.</li>
          <li>Nothing else is needed. If you change your mind, Resume subscription appears in the same place.</li>
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
              "Choose Resume subscription in Billing and it simply keeps running, at the same price",
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
      "No. Garuda does not give refunds, in whole or in part. Cancelling stops the next charge and the period you have already paid for runs to its end, so nothing is cut short — but the payment already taken is not returned.",
    body: (
      <>
        <div className="rounded-xl border border-slate-300 bg-slate-50 p-5">
          <p className="text-sm font-semibold text-slate-900">Garuda does not give refunds</p>
          <p className="mt-2 text-[15px] leading-7 text-slate-600">
            Payments for the ${PLAN_PRICE_USD} monthly plan are final. Part-months are not prorated, unused time is not
            refunded, and a period that has been charged for is not returned — whether the workspace was used heavily, lightly
            or not at all. This is the whole policy, and it is on this page rather than in the small print because you should
            know it before you pay, not after.
          </p>
          <p className="mt-3 text-[15px] leading-7 text-slate-600">
            Cancelling is the remedy, and it is immediate in effect: it stops the next charge. Everything you have paid for
            keeps running to the end of the period you paid for.
          </p>
        </div>
        <p>
          One exception, and it is the law&rsquo;s rather than ours: if the country you buy from gives you a statutory right to
          cancel a digital purchase and get your money back, you keep that right. Nothing on this page removes it. Write to{" "}
          {SUPPORT_EMAIL} from the account email and say which right you are exercising.
        </p>
        <p>
          If Garuda took money for something that does not work, that is a different conversation from a refund request, and it
          starts the same way — write to {SUPPORT_EMAIL} and describe what happened.
        </p>
      </>
    ),
  },
  {
    id: "how-to-ask",
    question: "What should I do instead of asking for a refund?",
    answer: `Cancel. It takes one click in Billing, it stops the next charge, and everything you have paid for keeps working until the period ends. Because Garuda gives no refunds, cancelling early is the only thing that changes what you are charged — so do it as soon as you know.`,
    body: (
      <>
        <FactTable
          caption="What cancelling does, and what it does not"
          head={["What happens", "Detail"]}
          rows={[
            ["The next charge stops", "Immediately, from the moment you cancel. There is nothing else to do"],
            ["This period keeps running", `Your agents stay live and answering until the date shown in Billing`],
            ["The payment already taken stays taken", "It is not prorated and not returned. That is the policy above"],
            ["Nothing is deleted", "Agents, knowledge, conversations and every captured lead stay in the workspace"],
            ["You can come back", "Resume the plan before the period ends and nothing goes quiet at all"],
          ]}
        />
        <p>
          If something is genuinely broken, that is worth writing about whatever the refund policy says — email {SUPPORT_EMAIL}{" "}
          from the account address with what happened and when. Garuda publishes no support SLA and no response time is promised
          here; see{" "}
          <Link href="/support" className="font-medium text-indigo-700 underline underline-offset-4">
            the support page
          </Link>{" "}
          for how that works.
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
            ["You update the card", "Billing, then add a card. Card details are entered on Stripe so they never reach Garuda"],
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
          So the sequence is genuinely pay first, build second — which, with no refunds, is worth being blunt about on this
          page rather than anywhere else.
        </p>
        <p>
          Before you decide it is not for you, it is worth ten minutes on{" "}
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
      summary={`Garuda is one USD ${PLAN_PRICE_USD} monthly subscription with no minimum term and no refunds. Payments are final: part-months are not prorated and unused time is not returned. Cancel whenever you like — it stops the next charge, and your workspace keeps working until the end of the period you have already paid for.`}
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
