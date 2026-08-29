import type { Metadata } from "next";
import Link from "next/link";
import { LegalList, LegalNote, LegalPage, LegalSection, LegalSubsection, LegalTable } from "@/components/legal/legal-page";
import { PLAN_LIMITS, PLAN_PRICE_USD, pageMetadata } from "@/lib/seo";

/**
 * The terms of service.
 *
 * Two rules govern edits here:
 *
 *   1. Every number about the plan comes from PLAN_LIMITS and PLAN_PRICE_USD in
 *      lib/seo.ts, which mirror backend/internal/config/plan.go. Do not type a
 *      limit by hand; the pricing card and this page must not disagree.
 *   2. Section 12 is a marked placeholder, not an omission. Governing law and
 *      venue have not been chosen. Inventing a jurisdiction would be worse than
 *      admitting the gap, so the gap is admitted in the open.
 */

const PATH = "/terms";
const LAST_UPDATED = "30 August 2026";

export const metadata: Metadata = pageMetadata({
  title: "Terms of service",
  description:
    "The agreement between Ravan AI and businesses using Garuda: what the service does, what you are responsible for, acceptable use, ownership, billing at $17 a month, suspension, and the limits of our liability.",
  path: PATH,
  socialTitle: "Garuda terms of service",
});

const contents = [
  { id: "agreement", label: "Who this agreement is between" },
  { id: "service", label: "What Garuda does" },
  { id: "account", label: "Your account" },
  { id: "acceptable-use", label: "Acceptable use" },
  { id: "your-knowledge", label: "The knowledge you provide" },
  { id: "ai-output", label: "AI output can be wrong" },
  { id: "visitors", label: "Your obligations to your visitors" },
  { id: "ownership", label: "Ownership and licences" },
  { id: "billing", label: "Billing" },
  { id: "suspension", label: "Suspension and termination" },
  { id: "liability", label: "Warranties and liability" },
  { id: "governing-law", label: "Governing law" },
  { id: "changes", label: "Changes and contact" },
] as const;

export default function TermsPage() {
  return (
    <LegalPage
      eyebrow="Terms"
      title="Terms of service"
      intro="This is the agreement between Ravan AI and the businesses that use Garuda. It sets out what the service does, what you are responsible for, and what happens when something goes wrong. It is written to be read."
      lastUpdated={LAST_UPDATED}
      breadcrumb="Terms"
      contents={contents}
    >
      <LegalSection id="agreement" title="1. Who this agreement is between">
        <p>
          Garuda is a product of Ravan AI. In this document, <strong>we</strong> and <strong>us</strong> mean Ravan AI, and{" "}
          <strong>you</strong> means the business or person who creates a Garuda account. By creating an account or using the
          service you accept these terms. If you are agreeing on behalf of a company, you confirm you are allowed to bind it.
        </p>
        <p>
          These terms cover your relationship with us. They do not create any agreement between us and the visitors who chat with
          your agent — your relationship with them is yours to manage, and{" "}
          <Link className="font-medium text-indigo-700 underline underline-offset-4" href="#visitors">
            section 7
          </Link>{" "}
          says what we expect of you there.
        </p>
        <p>
          How we handle data is set out separately in our{" "}
          <Link className="font-medium text-indigo-700 underline underline-offset-4" href="/privacy">
            privacy policy
          </Link>
          , which forms part of this agreement.
        </p>
      </LegalSection>

      <LegalSection id="service" title="2. What Garuda does">
        <p>
          Garuda builds an AI chat agent for your website. You answer a few questions about your business, edit the draft agent,
          add the knowledge you want it to answer from, and publish it. Publishing gives you a script tag; pasting that tag into
          your site puts the chat widget on it. The agent only runs on the domains you list.
        </p>
        <p>
          The agent answers from the knowledge you provided, captures contact details when a visitor consents to give them, and
          stores conversations and leads in your workspace, where you can read them and export leads as CSV. Agents use a model
          provider to generate their replies; the privacy policy names it and says what is sent.
        </p>
        <p>
          We may change, add or remove features. If we remove something you depend on, we will give you reasonable notice. The
          service is provided as it is, and nothing on our website is a commitment to build a feature that does not yet exist.
        </p>
      </LegalSection>

      <LegalSection id="account" title="3. Your account">
        <LegalList
          items={[
            "Give accurate account details, and keep your email address current — password resets and service notices go there.",
            "Keep your password and your session private. Everything done through your account is treated as done by you.",
            "Tell us promptly at info@ravan.ai if you think someone else has access to your account.",
            "You are responsible for anyone you let use your workspace, and for what your agents do on your behalf.",
            "You must be old enough to enter a contract where you live, and you must not use Garuda if we have previously terminated your account.",
          ]}
        />
      </LegalSection>

      <LegalSection id="acceptable-use" title="4. Acceptable use">
        <p>Some of these are the law, some are our line. All of them are conditions of using the service.</p>
        <LegalSubsection title="Do not use an agent to give regulated advice">
          <p>
            You must not configure or hold out a Garuda agent as giving medical, legal or financial advice. An agent may state
            your published policies, describe your services and take an enquiry. It must not diagnose, prescribe, advise on a
            legal matter, or recommend a financial product or investment. If your business operates in one of these fields, keep
            the agent to facts and hand the person to a qualified human.
          </p>
        </LegalSubsection>
        <LegalSubsection title="Only upload knowledge you are entitled to use">
          <p>
            You must have the right to use every document, page and passage you add as a knowledge source, and the right to let us
            process it to run your agent. Do not upload someone else&apos;s copyrighted material, confidential information you were
            not permitted to share, or personal data you have no lawful basis to hold.
          </p>
        </LegalSubsection>
        <LegalSubsection title="Do not put sensitive data into an agent">
          <p>
            Do not add protected health information, payment card data, government identifiers or other special-category personal
            data to a knowledge source, and do not configure an agent to ask visitors for them. Garuda holds no certification for
            handling that kind of data, and our privacy policy says so plainly.
          </p>
        </LegalSubsection>
        <LegalSubsection title="And the general rules">
          <LegalList
            items={[
              "Do not use Garuda for anything unlawful, deceptive, harassing, hateful, or designed to defraud.",
              "Do not impersonate another business, or present your agent as a person when someone asks whether they are talking to a human.",
              "Do not embed an agent on a website you do not control, and keep your allowed-domains list accurate.",
              "Do not use an agent to generate spam, bulk unsolicited messages, or content that exists to manipulate search results.",
              "Do not probe, scan or attempt to break the service, evade its rate limits or plan limits, or reach another customer's data.",
              "Do not resell Garuda as your own product, or use it to build a competing service.",
              "Do not use the service in a way that degrades it for other customers, including automated traffic aimed at running up model usage.",
            ]}
          />
        </LegalSubsection>
      </LegalSection>

      <LegalSection id="your-knowledge" title="5. The knowledge you provide">
        <p>
          Your agent answers from what you give it. That makes the accuracy of your knowledge sources your responsibility, and it
          matters more than it might sound: an out-of-date price, an old opening time or a superseded policy will be repeated
          confidently to every visitor who asks.
        </p>
        <p>
          Garuda does not crawl your website. For a source added by URL you supply the extracted text yourself, which means your
          agent&apos;s knowledge does not update when your site does. Review your sources when your business changes, and remove
          the ones that no longer hold.
        </p>
        <p>
          You are responsible for reviewing what your agent says before you publish it, and for the consequences of what it says
          afterwards.
        </p>
      </LegalSection>

      <LegalSection id="ai-output" title="6. AI output can be wrong">
        <p>
          Agent replies are generated by a language model. Generated text can be wrong, incomplete, out of date, or confidently
          plausible and still false. It can also misread a question. This is a property of the technology, not a defect we can
          undertake to fix.
        </p>
        <LegalList
          items={[
            "Test your agent before publishing it, including the questions you would least like it to get wrong.",
            "Do not present agent output as professional advice, a quotation, a guarantee, or a binding commitment on your part.",
            "Check anything you are going to act on. An agent's answer is a draft, not a decision.",
            "You are responsible for what your published agent tells your visitors, including where it is wrong.",
          ]}
        />
        <p>
          We give no warranty that agent output will be accurate, complete or fit for any particular purpose, and we are not
          liable for decisions you or your visitors take on the strength of it.
        </p>
      </LegalSection>

      <LegalSection id="visitors" title="7. Your obligations to your visitors">
        <p>
          You choose to put a chat agent on your website, so the relationship with the people who use it is yours. Two duties
          follow from that.
        </p>
        <LegalSubsection title="Tell people they are talking to an AI, where your law requires it">
          <p>
            Some jurisdictions require you to disclose that a visitor is interacting with an automated system. Whether that
            applies to you is yours to determine and yours to comply with. Nothing in Garuda decides it for you, and we do not
            give legal advice about it.
          </p>
        </LegalSubsection>
        <LegalSubsection title="Have a privacy notice, and mean it">
          <p>
            You must have your own privacy notice covering the chat on your site, and you should link it in the widget — there is a
            field for exactly that. Your notice must reflect what actually happens: conversations are stored for you, and messages
            are sent to a model provider to generate replies.
          </p>
          <p>
            By default the widget asks each visitor whether to remember them before a conversation starts. You can configure it to
            skip that prompt. If you do, the consequences of that choice — and any consent you needed to obtain another way — are
            yours.
          </p>
        </LegalSubsection>
        <p>
          For visitor data, we act on your instructions. When a visitor asks you to delete their conversation or their contact
          details, tell us at{" "}
          <a className="font-medium text-indigo-700 underline underline-offset-4" href="mailto:info@ravan.ai">
            info@ravan.ai
          </a>{" "}
          and we will act on it. If a visitor comes to us first, we will point them to you or act on your instruction.
        </p>
      </LegalSection>

      <LegalSection id="ownership" title="8. Ownership and licences">
        <LegalSubsection title="What stays yours">
          <p>
            Your content stays yours. That means your knowledge sources, your agent&apos;s instructions and configuration, your
            branding, the conversations your agents hold and the leads they capture. We claim no ownership of any of it.
          </p>
          <p>
            You grant us a licence to host, store, copy, transmit and process that content for one purpose: running the service
            for you — which includes sending the relevant parts to the sub-processors named in the privacy policy. The licence
            lasts as long as we hold the content and exists for no other reason. We do not train models on your content.
          </p>
        </LegalSubsection>
        <LegalSubsection title="What stays ours">
          <p>
            Garuda itself stays ours: the platform, the portal, the widget, the API, the designs and the documentation, together
            with the Garuda and Ravan AI names and logos. Using the service gives you the right to use it, not to own any part of
            it. You may not copy, reverse engineer or redistribute the platform.
          </p>
        </LegalSubsection>
        <LegalSubsection title="Feedback">
          <p>
            If you send us ideas for improving Garuda, we may use them without owing you anything. We will not treat feedback as
            confidential unless you tell us it is before you send it.
          </p>
        </LegalSubsection>
      </LegalSection>

      <LegalSection id="billing" title="9. Billing">
        <p>
          Garuda has one plan: <strong>USD ${PLAN_PRICE_USD} per month</strong>. Checkout, invoices, payment methods and
          cancellation all run through Stripe. We never see or store your card number.
        </p>
        <LegalTable
          caption="What the plan includes and how billing works"
          head={["Term", "What it means"]}
          rows={[
            ["Price", `USD $${PLAN_PRICE_USD} per month, charged monthly in advance until you cancel.`],
            ["Published agents", `Up to ${PLAN_LIMITS.publishedAgents} at a time.`],
            [
              "Conversations",
              `${PLAN_LIMITS.monthlyConversations} in any rolling ${PLAN_LIMITS.conversationWindowDays}-day window. Past the limit, agents stop accepting new messages until the window moves forward.`,
            ],
            [
              "Knowledge",
              `Up to ${PLAN_LIMITS.knowledgeSourcesPerAgent} sources per agent, ${PLAN_LIMITS.charactersPerSource.toLocaleString("en-US")} characters each.`,
            ],
            ["Cancelling", "Cancel whenever you like. Your workspace stays active until the end of the period you have paid for."],
            [
              "Refunds",
              "Part-months are not refunded automatically, and we have not set a fixed refund window. If you think a refund is due, ask at info@ravan.ai and a person will decide. Nothing here limits a refund the law where you live requires.",
            ],
            [
              "Failed payment",
              "If a payment fails and the subscription lapses, your published agents stop answering on your site. Your data stays in your workspace and comes back when billing is fixed.",
            ],
            ["Taxes", "Prices exclude any taxes that apply where you are. Those are yours to pay."],
          ]}
        />
        <p>
          If we change the price, we will tell account holders by email before the change takes effect, and you can cancel before
          it applies to you. How cancellation and refunds work in practice is set out on our{" "}
          <Link className="font-medium text-indigo-700 underline underline-offset-4" href="/refunds">
            refunds and cancellation page
          </Link>
          ; where that page and these terms differ, these terms govern.
        </p>
      </LegalSection>

      <LegalSection id="suspension" title="10. Suspension and termination">
        <LegalSubsection title="What you can do">
          <p>
            Cancel your subscription at any time from the portal. Export your leads to CSV before you go — that is the fastest way
            to take your data with you. If you want your account and its data deleted rather than left dormant, ask us at{" "}
            <a className="font-medium text-indigo-700 underline underline-offset-4" href="mailto:info@ravan.ai">
              info@ravan.ai
            </a>
            ; deletion is a request we handle by hand, as the privacy policy explains.
          </p>
        </LegalSubsection>
        <LegalSubsection title="What we can do">
          <p>
            We may suspend or terminate an account that breaches these terms, that puts the service or other customers at risk, or
            where the law requires it. Where the circumstances allow, we will warn you first and give you a chance to put it
            right. A serious breach — anything unlawful, or an attack on the service — can be acted on immediately.
          </p>
          <p>
            If we terminate your account without cause, we will refund the unused portion of the period you have paid for. If we
            terminate it for a breach of these terms, we will not.
          </p>
        </LegalSubsection>
        <p>
          After termination, give us a reasonable window to export anything you still need, then ask us to delete it. Sections
          about ownership, liability and governing law survive the end of this agreement.
        </p>
      </LegalSection>

      <LegalSection id="liability" title="11. Warranties and liability">
        <p>
          Garuda is provided as it is and as it is available. To the fullest extent the law allows, we exclude all implied
          warranties, including merchantability, fitness for a particular purpose, and non-infringement. We do not warrant that
          the service will be uninterrupted or error-free, that agent output will be accurate, or that our sub-processors will
          always be available. We publish no uptime guarantee, because nothing in the product enforces one.
        </p>
        <p>
          To the fullest extent the law allows, neither party is liable for indirect, incidental, special or consequential loss,
          or for lost profits, lost revenue, lost business, lost goodwill or lost or corrupted data, however caused.
        </p>
        <p>
          To the fullest extent the law allows, our total liability arising out of or relating to this agreement, taken across all
          claims together, is limited to the amount you paid us in the twelve months before the event that gave rise to the
          claim.
        </p>
        <p>
          Nothing in this section excludes liability that cannot lawfully be excluded, and some jurisdictions do not allow some of
          these exclusions — in which case they apply to you only as far as the law allows.
        </p>
        <p>
          You will indemnify us against claims arising from your content, your use of the service, your breach of these terms, and
          what your published agent says to your visitors.
        </p>
      </LegalSection>

      <LegalSection id="governing-law" title="12. Governing law">
        <LegalNote tone="warning" title="Placeholder — not yet decided">
          <p>
            <strong>[PLACEHOLDER: governing law and venue]</strong> The governing law of this agreement and the courts that would
            hear a dispute have not been settled, and we are not going to name a jurisdiction here that we have not actually
            chosen. This clause will be completed, and the date at the top of this page will change when it is.
          </p>
          <p>
            Until then, nothing in this section limits any right you have under the mandatory law of the place where you live or
            do business. If you need a governing-law clause settled before you can sign up — because your procurement process
            requires one — write to{" "}
            <a className="font-medium text-indigo-700 underline underline-offset-4" href="mailto:info@ravan.ai">
              info@ravan.ai
            </a>{" "}
            and we will deal with it directly rather than leave you guessing.
          </p>
        </LegalNote>
        <p>
          If any part of these terms is found unenforceable, the rest stays in force. Our not enforcing a term on one occasion
          does not waive it. You may not transfer this agreement without our consent; we may transfer it as part of a merger or
          sale of the business, on notice to you.
        </p>
      </LegalSection>

      <LegalSection id="changes" title="13. Changes and contact">
        <p>
          We may update these terms. The date at the top changes when we do, and we will email account holders about a change that
          materially affects their rights or obligations. Continuing to use Garuda after a change means you accept the updated
          terms; if you do not, cancel before the change takes effect.
        </p>
        <p>
          Together with the{" "}
          <Link className="font-medium text-indigo-700 underline underline-offset-4" href="/privacy">
            privacy policy
          </Link>
          , this is the whole agreement between us about the service, and it replaces anything said before it.
        </p>
        <p>
          Garuda is operated by Ravan AI. Questions about these terms go to{" "}
          <a className="font-medium text-indigo-700 underline underline-offset-4" href="mailto:info@ravan.ai">
            info@ravan.ai
          </a>
          .
        </p>
      </LegalSection>
    </LegalPage>
  );
}
