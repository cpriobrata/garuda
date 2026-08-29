import type { Metadata } from "next";
import Link from "next/link";
import { AnswerSection, FactTable, SeoPageShell } from "@/components/site/seo-page-shell";
import { faqPageJsonLd, pageMetadata } from "@/lib/seo";

const PATH = "/security";
const REVIEWED = "30 August 2026";

export const metadata: Metadata = pageMetadata({
  title: "Security and data handling",
  description:
    "How Garuda handles consent, visitor identity, domain allowlisting, sessions, passwords, rate limits and third parties — and a plain list of the things Garuda does not have, including any SOC 2 report.",
  path: PATH,
  socialTitle: "Garuda security and data handling",
});

const answers = [
  {
    id: "who-can-see-my-data",
    question: "Who can see the conversations and leads my agent collects?",
    answer:
      "Your workspace, and nobody else's. Every portal request resolves an account from the caller's signed token and filters every record on it; every widget request resolves the account from the published agent's key. There is no endpoint that returns records across workspaces.",
    body: (
      <p>
        A workspace is created with your account. Agents, knowledge sources, conversations, messages and leads all carry that
        account id, and each handler looks records up by account id and record id together rather than by record id alone.
      </p>
    ),
  },
  {
    id: "consent",
    question: "When is Garuda allowed to store a visitor's contact details?",
    answer:
      "Only after the visitor has explicitly agreed. The lead form carries a consent checkbox, and the API rejects any lead submission that does not carry consent — it answers with a 422 error and writes nothing at all. Consent is a precondition in the server, not a checkbox the browser is trusted to honour.",
    body: (
      <>
        <p>When consent is given, the record is stored with the conversation it came from and with the evidence beside it:</p>
        <FactTable
          caption="What is stored alongside a consented lead"
          head={["Stored with the lead", "Why"]}
          rows={[
            ["The consent flag itself", "The affirmative permission the visitor gave"],
            ["The notice version shown", "Which wording the visitor actually agreed to"],
            ["Whether the privacy notice was accepted", "Recorded separately from permission to be contacted"],
            [
              "The moment of consent",
              "Kept only when the browser supplies a genuine timestamp, and normalised before it is stored",
            ],
            ["The conversation it came from", "So a request about that person can be answered with its context"],
          ]}
        />
        <p>
          Contact details typed into the portal by hand are recorded as a manual lead and say plainly that no consent evidence
          was collected there, so anything counting consented captures cannot silently include them.
        </p>
      </>
    ),
  },
  {
    id: "visitor-identity",
    question: "How does Garuda recognise a returning visitor without tracking them?",
    answer:
      "With an identifier that is scoped to a single agent. Garuda derives it as an HMAC of the server's secret key over the agent's id and the visitor's own opaque token, so the same browser talking to a different Garuda agent produces a completely different identifier, and the two cannot be linked. There is no cross-site identifier of any kind.",
    body: (
      <>
        <FactTable
          caption="How a returning visitor is identified"
          head={["Question", "Answer"]}
          rows={[
            ["What is stored in the visitor's browser?", "One opaque random token, namespaced per agent"],
            ["What does Garuda store?", "An HMAC over the server secret, the agent id and that token — never the token itself"],
            ["Can two agents' identifiers be linked?", "No. Different agent id, different HMAC, no shared value"],
            [
              "What happens if the visitor declines memory?",
              "No token is stored, and the session is given a throwaway identifier that resumes nothing",
            ],
            ["How long can a conversation be resumed?", "Within a 30-day window, and only with memory consent"],
          ]}
        />
        <p>
          The visitor-facing consent choice is remembered per agent in the browser, so declining on one site does not have to be
          repeated on another, and no default assumes agreement.
        </p>
      </>
    ),
  },
  {
    id: "domain-allowlisting",
    question: "Can my agent be embedded on a website I did not approve?",
    answer:
      "No. Each agent carries a list of allowed domains, and every widget request carries the browser's Origin header. In production, a request whose origin is missing or absent from that list is answered as though the agent does not exist — the same response an unknown key gets, so probing tells an attacker nothing.",
    body: (
      <p>
        Origin is checked when the widget loads the agent&rsquo;s configuration and again when a session is created, and the
        session is then pinned to the origin it started on: a session token lifted from one site cannot be replayed from
        another. The agent key in your embed snippet is public by design, and this is what makes it safe for it to be public.
      </p>
    ),
  },
  {
    id: "widget-sessions",
    question: "What protects a conversation while it is happening?",
    answer:
      "Each widget session gets a 256-bit random token that Garuda stores only as a hash, expires after 15 minutes, compares in constant time, and pins to the origin that created it. Visitor input is bounded too: messages are capped at 4,000 characters and custom lead fields at 20 fields.",
    body: (
      <p>
        Message delivery is idempotent — a retried send returns the original exchange instead of asking the model twice — and
        every response carries a request id you can quote if something needs investigating.
      </p>
    ),
  },
  {
    id: "accounts",
    question: "How are Garuda account passwords and sessions handled?",
    answer:
      "Passwords are stored as PBKDF2-HMAC-SHA256 hashes with 160,000 iterations and a 16-byte random salt, and verified in constant time. Refresh tokens rotate on every use, and a token that is presented twice revokes its whole family, so a stolen refresh token stops working the moment the real one is used.",
    body: (
      <p>
        Password reset and email verification tokens are stored as hashes with an expiry and a single-use marker, and the
        requests that issue them are rate limited by the hour rather than by the minute.
      </p>
    ),
  },
  {
    id: "prompt-injection",
    question: "What stops pasted knowledge or a visitor message from hijacking the agent?",
    answer:
      "Knowledge sources and retrieved passages are placed in the prompt under an explicit instruction that they are reference data and never instructions, and the hidden context is marked as not to be revealed. This reduces prompt-injection risk; no prompt-level defence is complete, which is why the honest framing matters more than a reassuring one.",
    body: (
      <p>
        The practical consequence: treat your knowledge sources as content you have reviewed. Garuda gives an agent nothing to
        answer from except the sources you added and the instructions you approved, and an agent stays a draft — invisible to
        the widget — until you publish it.
      </p>
    ),
  },
  {
    id: "rate-limits",
    question: "What limits protect the service from abuse?",
    answer:
      "Every sensitive route is rate limited per client IP address. Sign-up allows 20 requests a minute, sign-in 30 a minute, password resets 10 an hour, widget sessions 60 a minute, widget messages 120 a minute, lead submissions 30 a minute, and agent generation 20 an hour.",
    body: (
      <>
        <FactTable
          caption="Rate limits enforced per client IP address"
          head={["Action", "Limit"]}
          rows={[
            ["Create an account", "20 per minute"],
            ["Sign in", "30 per minute"],
            ["Request a password reset", "10 per hour"],
            ["Resend a verification email", "5 per hour"],
            ["Start a widget conversation", "60 per minute"],
            ["Send a widget message", "120 per minute"],
            ["Submit a lead", "30 per minute"],
            ["Generate an agent with the model", "20 per hour"],
          ]}
        />
        <p>
          The client address is taken from the connection itself unless the request came through a reverse proxy the deployment
          explicitly trusts, so forwarding headers cannot be spoofed to escape a bucket or to frame somebody else&rsquo;s IP.
        </p>
      </>
    ),
  },
  {
    id: "third-parties",
    question: "Which third parties see my data?",
    answer:
      "Five, and each one only sees what its job requires: Google for model responses and optional Google sign-in, Stripe for subscriptions and payment, SendGrid for transactional email, Composio for integrations you choose to connect, and Vercel for serving this website.",
    body: (
      <>
        <FactTable
          caption="Third-party services in Garuda's data path"
          head={["Service", "What reaches it"]}
          rows={[
            [
              "Google (Gemini)",
              "The agent's instructions, the approved knowledge included in the prompt, and the conversation messages needed for a reply",
            ],
            ["Google Sign-In", "Only if you choose to sign in with Google: the identity token Google issues"],
            ["Stripe", "Subscription and payment details. Card details are entered on Stripe's own checkout page"],
            ["SendGrid", "Transactional email: verification, password reset and welcome messages"],
            [
              "Composio",
              "Only for customers who connect integrations: the authorisation flow and the connection list, keyed by account id",
            ],
            ["Vercel", "Serves this marketing website. The API runs on its own server behind Caddy over HTTPS"],
            [
              "Retrieval service (optional)",
              "Where a deployment enables retrieval: knowledge-source text and the visitor's question",
            ],
          ]}
        />
        <p>
          The production deployment configuration also backs up the data store every six hours, verifies each copy is readable
          before keeping it, and retains 14 days of copies.
        </p>
      </>
    ),
  },
  {
    id: "not-in-place",
    question: "What does Garuda not have?",
    answer:
      "Garuda holds no SOC 2, ISO 27001, HIPAA or PCI certification, has published no independent penetration test, and offers no uptime SLA. There is no two-factor authentication on accounts, no SAML or SCIM single sign-on, no customer-managed encryption keys, no choice of data region, no customer-facing audit log and no self-service account deletion.",
    body: (
      <>
        <p>
          That list is deliberately blunt. A young product that implies certifications it does not hold is worse than one that
          says plainly where it stands, and every item above is a thing you might reasonably require before trusting a vendor.
        </p>
        <FactTable
          caption="Assurances Garuda does not currently offer"
          head={["Assurance", "Status"]}
          rows={[
            ["SOC 2, ISO 27001, HIPAA, PCI attestation", "None held"],
            ["Independent penetration test report", "None published"],
            ["Two-factor authentication on Garuda accounts", "Not available"],
            ["SAML or SCIM single sign-on", "Not available. Google sign-in is offered, which is not the same thing"],
            ["Customer-managed encryption keys, data-region choice", "Not available"],
            ["Customer-facing audit log", "Not available"],
            ["Self-service account deletion", "Not available; deletion is handled as a request"],
            ["Uptime SLA", "Not offered"],
          ]}
        />
        <p>
          Card data is one thing Garuda genuinely never touches: payment happens on Stripe&rsquo;s own hosted checkout, so card
          numbers do not reach Garuda&rsquo;s servers at any point.
        </p>
      </>
    ),
  },
  {
    id: "reporting",
    question: "How do I report a security problem or make a data request?",
    answer:
      "Use the contact address published on the privacy page. Please include what you did, what you observed, and the request id from the response if you have one — every Garuda API response carries one, which makes a report far quicker to trace.",
    body: (
      <p>
        The{" "}
        <Link href="/privacy" className="font-medium text-indigo-700 underline underline-offset-4">
          privacy page
        </Link>{" "}
        covers what is collected, how it is used, and how to ask for data to be removed. The{" "}
        <Link href="/terms" className="font-medium text-indigo-700 underline underline-offset-4">
          terms
        </Link>{" "}
        cover what you are responsible for as the owner of a published agent — including reviewing its instructions, its
        knowledge and its lead-capture behaviour before publishing.
      </p>
    ),
  },
];

export default function SecurityPage() {
  return (
    <SeoPageShell
      eyebrow="Security and data handling"
      title="What Garuda protects, and what it does not claim"
      summary="Garuda gates lead capture behind explicit consent, identifies returning visitors with an agent-scoped value that cannot be linked across sites, restricts each agent to domains its owner approved, and stores session tokens only as hashes. It holds no SOC 2 or equivalent certification, and this page says so as plainly as it says the rest."
      breadcrumb={{ name: "Security", path: "/security" }}
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
