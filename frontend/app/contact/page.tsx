import type { Metadata } from "next";
import Link from "next/link";
import { AnswerSection, FactTable, SeoPageShell } from "@/components/site/seo-page-shell";
import { faqPageJsonLd, pageMetadata } from "@/lib/seo";

/**
 * Contact.
 *
 * Deliberately no contact form. A form has to post somewhere, and there is no
 * endpoint in this product that accepts one — a form that silently drops a
 * message is worse than an address that works. If a real endpoint is ever built,
 * a form can replace the mailto links here; until then the address is the honest
 * answer.
 *
 * The "cannot help" section is grounded in how visitor identity actually works:
 * a returning visitor is recognised by an HMAC over the server secret, the agent
 * id and the visitor's own opaque token (backend/internal/api/widget.go), which
 * cannot be reversed to a person and cannot be matched across two customers'
 * sites. Garuda genuinely cannot identify a website visitor from a chat.
 */

const PATH = "/contact";
const REVIEWED = "30 August 2026";
const SUPPORT_EMAIL = "info@ravan.ai";

export const metadata: Metadata = pageMetadata({
  title: "Contact",
  description:
    "How to reach Ravan AI about Garuda: one email address, what to say for each kind of enquiry, and the things Garuda cannot help with — including questions about another company's records.",
  path: PATH,
  socialTitle: "Contact Ravan AI about Garuda",
});

const answers = [
  {
    id: "how-to-reach-us",
    question: "How do I reach Ravan AI?",
    answer: `By email, at ${SUPPORT_EMAIL}. Garuda is made by Ravan AI, and email is the only channel: there is no phone line, no live chat with a person and no enquiry form on this site.`,
    body: (
      <p>
        There is no contact form here on purpose. A form has to send a message somewhere, and Garuda has no endpoint that
        receives one, so a form on this page would look like it worked while dropping everything typed into it. An address that
        reaches a person is worth more:{" "}
        <a href={`mailto:${SUPPORT_EMAIL}`} className="font-medium text-indigo-700 underline underline-offset-4">
          {SUPPORT_EMAIL}
        </a>
        .
      </p>
    ),
  },
  {
    id: "what-goes-where",
    question: "What should I say for each kind of enquiry?",
    answer: `Everything goes to ${SUPPORT_EMAIL}, so the subject line is what routes it. Name the kind of enquiry there, and include the details in the table below so the first reply can be an answer rather than a question.`,
    body: (
      <>
        <FactTable
          caption="What to include, by kind of enquiry"
          head={["Enquiry", "Put this in the message"]}
          rows={[
            [
              "Something is broken",
              <>
                Your account email, the agent, what you expected, what happened, and the request id from any error. The{" "}
                <Link key="support" href="/support" className="font-medium text-indigo-700 underline underline-offset-4">
                  support page
                </Link>{" "}
                lists the three checks worth doing first.
              </>,
            ],
            [
              "Billing, refunds or cancellation",
              <>
                Your account email, the date and amount of the charge, and the Stripe invoice number.{" "}
                <Link key="refunds" href="/refunds" className="font-medium text-indigo-700 underline underline-offset-4">
                  Refunds and cancellation
                </Link>{" "}
                answers most of these already.
              </>,
            ],
            [
              "A privacy or data request",
              "Your account email and exactly what you want done. There is no self-service deletion, so these are handled by hand and answered in writing.",
            ],
            [
              "A security report",
              "What you did, what you observed, and the request id if you have one. Garuda runs no bug bounty and pays no bounty, and a report is still welcome.",
            ],
            [
              "Sales, partnership or press",
              "What you are asking for and who you are. There is one plan and one price, so there is rarely much to negotiate.",
            ],
          ]}
        />
        <p>
          Writing from the email address on the account is the single most useful thing you can do. It is how a workspace is
          identified, and a request that arrives from an unrelated address takes longer precisely because it has to be checked.
        </p>
      </>
    ),
  },
  {
    id: "cannot-help",
    question: "What can Garuda not help you with?",
    answer:
      "Another company's records, legal or compliance advice, and anything that would need us to take someone's word for who they are. The first of those comes up most often, and it is the one where a helpful answer would be the wrong thing to give.",
    body: (
      <>
        <h3 className="pt-2 text-base font-semibold text-slate-900">
          If you chatted with an agent on somebody else&rsquo;s website
        </h3>
        <p>
          Garuda is the software that business uses, not the business itself. The conversation you had, and any contact details
          you gave, belong to the company whose website you were on — so questions about what they hold, requests to change it,
          and requests to delete it have to go to them. Ravan AI cannot confirm, alter or hand over another company&rsquo;s
          records to someone it cannot verify, and it will not do so on the strength of an email.
        </p>
        <p>
          There is also a technical limit, and it is deliberate. A returning visitor is recognised by a value derived from the
          server&rsquo;s secret key, the agent&rsquo;s id and an opaque token in that browser. It cannot be reversed into a
          person, and the same browser produces a completely different value on a different customer&rsquo;s site. So a chat on
          its own does not identify you to us, and no amount of goodwill changes that. Ask the business you were talking to; if
          they need help answering you, they can write from their account email.
        </p>

        <h3 className="pt-2 text-base font-semibold text-slate-900">Legal and compliance advice</h3>
        <p>
          Garuda cannot tell you whether your use of it satisfies a particular law or regulation, and nothing on this site is
          legal advice. What we can do is describe the data flows precisely so your own advisers can judge them: the{" "}
          <Link href="/security" className="font-medium text-indigo-700 underline underline-offset-4">
            security page
          </Link>{" "}
          sets out how consent, visitor identity and third parties work, and lists plainly what Garuda does not hold — no SOC 2,
          ISO 27001, HIPAA or PCI attestation, no published penetration test, and no uptime SLA.
        </p>

        <h3 className="pt-2 text-base font-semibold text-slate-900">What your agent should say</h3>
        <p>
          We can explain how knowledge sources, instructions and lead capture work, and the{" "}
          <Link href="/support" className="font-medium text-indigo-700 underline underline-offset-4">
            support page
          </Link>{" "}
          covers the usual traps. The content itself is yours: as the owner of a published agent you are responsible for its
          instructions, the knowledge it answers from and its lead-capture behaviour, which is worth reviewing before you
          publish rather than after.
        </p>
      </>
    ),
  },
  {
    id: "what-we-never-ask",
    question: "What will Ravan AI never ask you for?",
    answer:
      "Your password, an access token, or a card number. No genuine Garuda email asks for any of them, and no support problem needs them.",
    body: (
      <p>
        Card details are entered on Stripe&rsquo;s own checkout page and never reach Garuda&rsquo;s servers, so nobody here can
        ask you to confirm a card number for a legitimate reason. If a message claiming to be from Garuda asks for a credential,
        it is not from us — forward it to{" "}
        <a href={`mailto:${SUPPORT_EMAIL}`} className="font-medium text-indigo-700 underline underline-offset-4">
          {SUPPORT_EMAIL}
        </a>{" "}
        and delete it.
      </p>
    ),
  },
  {
    id: "response",
    question: "How quickly will I hear back?",
    answer:
      "Garuda offers no support SLA, and no response time is promised here, because nothing in the product enforces one. If your message is time-critical, say so in the subject line.",
    body: (
      <p>
        A message that arrives with the account email, the agent name and the exact error text can often be answered on the
        first reading, which is the fastest route there is. The{" "}
        <Link href="/support" className="font-medium text-indigo-700 underline underline-offset-4">
          support page
        </Link>{" "}
        has the full checklist.
      </p>
    ),
  },
];

export default function ContactPage() {
  return (
    <SeoPageShell
      eyebrow="Contact"
      title="Contact Ravan AI about Garuda"
      summary={`One address, ${SUPPORT_EMAIL}, for support, billing, privacy requests and security reports. Name the kind of enquiry in the subject line and write from your account email. There are things Garuda cannot answer — chiefly questions about another company's records — and this page says which.`}
      breadcrumb={{ name: "Contact", path: PATH }}
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
