import type { Metadata } from "next";
import Link from "next/link";
import { LegalList, LegalNote, LegalPage, LegalSection, LegalSubsection, LegalTable } from "@/components/legal/legal-page";
import { PlainSummary } from "@/components/legal/plain-summary";
import { PLAN_LIMITS, pageMetadata } from "@/lib/seo";

/**
 * The privacy policy.
 *
 * Every factual sentence on this page was written from the code that implements
 * it, and the comment beside each section names the file to re-check when that
 * code changes. The distinctions this document exists to keep straight:
 *
 *   CUSTOMER  a business with a Garuda account. We hold their data for them.
 *   VISITOR   a person chatting on that business's website. We hold their data
 *             on the customer's behalf and on the customer's instructions.
 *
 * Nothing here promises a retention period, a deletion deadline or an audit that
 * the product cannot currently honour. There is no retention sweeper in the
 * backend — see the note in section 8 — so the policy says so plainly instead of
 * inventing a schedule.
 */

const PATH = "/privacy";
const LAST_UPDATED = "30 August 2026";

export const metadata: Metadata = pageMetadata({
  title: "Privacy policy",
  description:
    "How Garuda handles data for two different groups: the businesses that own an account and the visitors who chat with their agents. What is collected, what is sent to a model provider, how the agent-scoped visitor token works, and who the sub-processors are.",
  path: PATH,
  socialTitle: "Garuda privacy policy",
});

const contents = [
  { id: "two-groups", label: "Two groups of people" },
  { id: "customer-data", label: "What we collect from customers" },
  { id: "visitor-data", label: "What we collect from visitors" },
  { id: "consent", label: "Consent in the chat" },
  { id: "visitor-token", label: "The returning-visitor token" },
  { id: "model-provider", label: "Conversations go to a model provider" },
  { id: "subprocessors", label: "Sub-processors" },
  { id: "storage-retention", label: "Where data lives, and for how long" },
  { id: "rights", label: "Your rights, and how to use them" },
  { id: "cookies", label: "Cookies and browser storage" },
  { id: "security", label: "Security, and what we do not claim" },
  { id: "children", label: "Children" },
  { id: "changes", label: "Changes and contact" },
] as const;

const summaryPoints = [
  {
    point:
      "There are two kinds of people in this policy. If you run a business with a Garuda account, we hold your data for you. If you chatted with an agent on someone's website, we hold that conversation for that business, on its instructions.",
    href: "#two-groups",
    detail: "Which one you are",
  },
  {
    point:
      "Nothing a visitor types becomes a saved lead until they explicitly agree in the conversation. The server refuses to write contact details without that consent.",
    href: "#consent",
    detail: "How consent works",
  },
  {
    point:
      "Chat messages are sent to Google's Gemini API to produce a reply. If you are about to embed a chatbot on your site, you should know that before you paste the script tag.",
    href: "#model-provider",
    detail: "What is sent, and what is not",
  },
  {
    point:
      "A returning visitor is recognised by a token that only works for one agent. The same browser produces a different identifier on a different customer's site, so the token cannot follow anyone around the web.",
    href: "#visitor-token",
    detail: "Why it cannot track you",
  },
  {
    point:
      "We do not sell personal information, we run no advertising or analytics trackers, and Garuda's own pages set no cookies at all.",
    href: "#cookies",
    detail: "What is stored in your browser",
  },
  {
    point:
      "There is no automated deletion schedule yet, and we are not going to pretend otherwise. Access, correction and deletion requests are handled by hand, by email.",
    href: "#rights",
    detail: "How to make a request",
  },
] as const;

export default function PrivacyPage() {
  return (
    <LegalPage
      eyebrow="Privacy"
      title="Privacy policy"
      intro="Garuda is a chat agent that businesses embed on their own websites. That means two very different groups of people have data here, and most privacy policies blur them together. This one keeps them apart."
      lastUpdated={LAST_UPDATED}
      breadcrumb="Privacy"
      contents={contents}
      summary={<PlainSummary points={summaryPoints} />}
    >
      {/* Roles. The visitor-facing half of the product is entirely account-scoped:
          every widget request resolves an account from the published agent's key
          (backend/internal/api/widget.go, findPublishedAgent). */}
      <LegalSection id="two-groups" title="1. Two groups of people">
        <p>
          Garuda is operated by Ravan AI. Throughout this policy, <strong>we</strong> means Ravan AI and <strong>Garuda</strong>{" "}
          means the product.
        </p>
        <LegalSubsection title="Customers">
          <p>
            A customer is a business or a person who creates a Garuda account, builds an agent and embeds it on a website they
            control. We hold customer data for the customer, and we decide how the account itself works — sign-in, billing,
            support. This policy governs that data directly.
          </p>
        </LegalSubsection>
        <LegalSubsection title="Visitors">
          <p>
            A visitor is someone who opens a chat with an agent on a customer&apos;s website. We do not choose what that agent is
            for, what it asks, or what the business does with the answers. The customer does. For visitor data we act on the
            customer&apos;s behalf: we store it, we make it available to that customer and to nobody else, and we act on that
            customer&apos;s instructions about it.
          </p>
          <p>
            The practical consequence for a visitor: if you want a conversation or your contact details removed, the business
            whose website you were on is the fastest route, because it is their record. You can also write to us at{" "}
            <a className="font-medium text-indigo-700 underline underline-offset-4" href="mailto:info@ravan.ai">
              info@ravan.ai
            </a>{" "}
            and we will help — see <Link className="font-medium text-indigo-700 underline underline-offset-4" href="#rights">
              your rights
            </Link>
            .
          </p>
        </LegalSubsection>
        <LegalNote title="One boundary that is enforced in code, not just here">
          <p>
            Every record in Garuda — agent, knowledge source, conversation, message, lead — carries the account id it belongs to,
            and every request is resolved against that account before any record is returned. One customer cannot read
            another&apos;s conversations or leads.
          </p>
        </LegalNote>
      </LegalSection>

      {/* Customer data: backend/internal/model/model.go (User, Account, Agent,
          KnowledgeItem), backend/internal/api/voice_onboarding.go for the audio,
          backend/internal/billing/stripe.go for the billing fields. */}
      <LegalSection id="customer-data" title="2. What we collect from customers">
        <LegalTable
          caption="Data collected from a business with a Garuda account"
          head={["What", "Why we have it"]}
          rows={[
            [
              "Your name and email address",
              "To create your account, sign you in, verify your address, and send password-reset and welcome email.",
            ],
            [
              "A password, stored only as a hash",
              "Sign-in. We store a PBKDF2-SHA256 hash with a random salt, never the password. If you sign in with Google instead, we store the Google account identifier rather than a password.",
            ],
            [
              "Your workspace name",
              "To label the account in the portal.",
            ],
            [
              "Agent configuration",
              "The agent's name, description, instructions, welcome message, suggested replies, lead-capture settings, colours and branding, the privacy-policy link shown in the widget, and the list of domains the widget is allowed to run on.",
            ],
            [
              "Knowledge sources",
              `The text you paste in, its title, and an optional source URL. Garuda does not crawl your website: for a URL source you supply the extracted text yourself. Up to ${PLAN_LIMITS.knowledgeSourcesPerAgent} sources per agent, ${PLAN_LIMITS.charactersPerSource.toLocaleString("en-US")} characters each.`,
            ],
            [
              "Voice notes, if you record one",
              "During onboarding you can describe your business by speaking instead of typing. That audio is sent to a transcription provider and you are shown the text it produced. Nothing is drafted from a recording you have not read.",
            ],
            [
              "Billing identifiers and subscription state",
              "A Stripe customer id, the subscription id, its status and renewal date. Card details are entered on Stripe's own pages — Garuda never receives or stores a card number.",
            ],
            [
              "Support correspondence",
              "If you email us, we keep the email so we can answer it.",
            ],
          ]}
        />
        <p>
          When you connect a third-party account through Composio, or add a webhook endpoint, we store the connection record and
          the endpoint you configured. We do not store the credentials for your third-party accounts; Composio holds those. See{" "}
          <Link className="font-medium text-indigo-700 underline underline-offset-4" href="#subprocessors">
            sub-processors
          </Link>
          .
        </p>
      </LegalSection>

      {/* Visitor data: createWidgetSession in backend/internal/api/widget.go
          stores Origin, Locale, PageURL, PageTitle, Referrer and MemoryConsent on
          the session row; widget/src/v1.js is what sends them. */}
      <LegalSection id="visitor-data" title="3. What we collect from visitors">
        <p>
          This is what the widget sends when someone opens a chat on a customer&apos;s website, and what the server keeps. It is
          stored for the business that owns the agent.
        </p>
        <LegalTable
          caption="Data collected from a person chatting with an agent"
          head={["What", "Why it is collected"]}
          rows={[
            [
              "The messages in the conversation",
              "What the visitor typed and what the agent replied, with timestamps. This is the conversation the business reads in its inbox.",
            ],
            [
              "The page the chat happened on",
              "The URL and title of the embedding page, plus the referrer your browser reported to it. It tells the business which page prompted the question.",
            ],
            [
              "The site the widget was loaded from",
              "The origin of the embedding page, checked against the domains the customer approved. A widget loaded from an unlisted domain is refused.",
            ],
            [
              "Your browser language",
              "Sent as a language tag, such as en-GB, so the conversation can be labelled.",
            ],
            [
              "An identifier for the conversation",
              "Either a per-visit identifier that links nothing, or — only if you agreed to be remembered — an agent-scoped one. See the next two sections.",
            ],
            [
              "Contact details, only after you agree",
              "Name, email address, phone number, company and any extra fields the business configured. Never stored without explicit consent.",
            ],
          ]}
        />
        <LegalSubsection title="Your IP address">
          <p>
            Your IP address reaches our server, as it does with any website. It is used to apply rate limits, held in memory for
            the length of the limit window, and then discarded. It is not written into the conversation record, and our request
            log records the method, path, status, duration and a request id — not the address.
          </p>
        </LegalSubsection>
        <LegalSubsection title="What the agent is not given">
          <p>
            The widget does not read the page around it, does not see forms you have filled in elsewhere on the site, and does not
            fingerprint your device. It sends the fields in the table above and the messages you type, and nothing else.
          </p>
        </LegalSubsection>
      </LegalSection>

      {/* Consent: widgetLead rejects a submission without consent with 422 and
          writes nothing (backend/internal/api/widget.go). The memory prompt is
          renderConsentPrompt in widget/src/v1.js, default data-memory-consent
          is "prompt". */}
      <LegalSection id="consent" title="4. Consent in the chat">
        <p>There are two separate consents, and they do different jobs.</p>
        <LegalSubsection title="Consent to be remembered">
          <p>
            By default the widget asks before it starts: <em>remember this chat on this browser</em>, or <em>use once</em>. No
            session is created until the visitor picks one. Choosing <em>use once</em> means no token is kept in the browser and
            the server labels the conversation with a per-visit identifier that links to nothing else. The choice is remembered
            per agent, and choosing <em>use once</em> also clears anything the widget had stored for that agent.
          </p>
          <p>
            A customer can configure the widget to skip that prompt and assume the answer. If you run a Garuda agent, that
            decision — and telling your visitors about it — is yours; our terms say so.
          </p>
        </LegalSubsection>
        <LegalSubsection title="Consent to be contacted">
          <p>
            Contact details are different, and stricter. Nothing a visitor types becomes a stored lead until they explicitly
            agree. The consent is a precondition in the server, not a checkbox the browser is trusted to honour: a submission
            without it is rejected and nothing is written at all.
          </p>
          <p>
            When consent is given, the record is stored with the evidence beside it — that consent was granted, the version of the
            notice shown, whether the privacy notice was accepted, and the moment it was captured.
          </p>
        </LegalSubsection>
        <LegalNote tone="warning" title="Being honest about what consent does not cover">
          <p>
            The conversation itself is stored for the business either way. Declining to be remembered means you are not linked
            across visits; it does not mean the messages vanish. If you would rather a business did not have a transcript of your
            chat, ask them to delete it — or do not start the chat.
          </p>
        </LegalNote>
      </LegalSection>

      {/* Token: security.RandomToken(32) then HashScopedToken(HMAC-SHA256, key,
          agent.ID, token) in createWidgetSession. The scoping is covered by
          backend/internal/security/security_test.go. Browser side: the token is
          stored under garuda:v1:visitor:<agent key> in widget/src/v1.js. */}
      <LegalSection id="visitor-token" title="5. The returning-visitor token">
        <p>
          If a visitor agrees to be remembered, the agent can pick up where the last conversation left off. Here is exactly how
          that works, because the design is the reason it cannot be used for tracking.
        </p>
        <LegalList
          items={[
            "The server generates 32 random bytes. The token is that random value and nothing else — it contains no name, no email address, no device information and no account identifier.",
            "The widget stores it in the embedding site's own browser storage, under a key that names the specific agent it belongs to. A token from one customer's site is never read by another customer's widget, because the key does not match.",
            "On the next visit the widget sends that token back. The server does not store the token itself: it derives an identifier using HMAC-SHA256 over a server-held secret, the agent's id and the token, and stores only that.",
            "Because the agent's id is mixed into the derivation, the same token would produce a completely different identifier for a different agent. There is no shared identifier that could join two customers' records together.",
          ]}
        />
        <p>
          So the token recognises a returning visitor <strong>for one agent, on one site</strong>. It cannot correlate the same
          browser across different customers&apos; websites, and we could not build a cross-site profile from it even if we wanted
          to. That property is covered by a test in our codebase, so a change that broke it would fail the build.
        </p>
        <p>
          A visitor who wants to be forgotten by an agent can clear that site&apos;s browser storage: the token is gone, and the
          next visit starts as a new one. That does not delete the transcripts already stored for the business — for those, see{" "}
          <Link className="font-medium text-indigo-700 underline underline-offset-4" href="#rights">
            your rights
          </Link>
          .
        </p>
      </LegalSection>

      {/* Model provider: s.llm.Chat(ctx, prompt, history) in widgetMessage. The
          prompt is promptForAgent + promptWithRetrieved (retrieved chunks); the
          history is chatHistory, which passes role and content only. */}
      <LegalSection id="model-provider" title="6. Conversations go to a model provider">
        <p>
          A Garuda agent does not write its answers by itself. To produce a reply, the server sends a request to Google&apos;s
          Gemini API through its OpenAI-compatible endpoint. If you are deciding whether to embed a chat agent on your site, this
          is the paragraph that matters.
        </p>
        <LegalTable
          caption="What is and is not sent to the model provider on each reply"
          head={["Sent with each request", "Not sent"]}
          rows={[
            [
              "The agent's instructions",
              "Your account name or email address",
            ],
            [
              "Passages retrieved from the customer's own knowledge sources, when they are relevant to the question",
              "The visitor identifier or the visitor token",
            ],
            [
              "The recent messages of the conversation, as roles and text",
              "The page URL, page title or referrer",
            ],
            [
              "Nothing else",
              "Any contact details captured as a lead",
            ],
          ]}
        />
        <p>
          Whatever a visitor types into the chat is part of the conversation and therefore reaches the model provider. Tell your
          visitors not to type card numbers, passwords or government identifiers into a chat window — no chat agent is the right
          place for those. Google&apos;s handling of the request is governed by Google&apos;s own terms for that API.
        </p>
        <p>
          We do not train any model on your content. Garuda has no training pipeline: your knowledge sources and conversations are
          used to answer questions in your own workspace and for nothing else.
        </p>
      </LegalSection>

      {/* Sub-processors: config.go holds every endpoint — Gemini, Stripe,
          SendGrid, Composio, Deepgram, the RAG edge service. Frontend and widget
          are on Vercel; the API runs on a VPS behind Caddy (deploy/README.md). */}
      <LegalSection id="subprocessors" title="7. Sub-processors">
        <p>
          These are the companies that process data on our behalf so the product can work. We name what each one actually
          receives rather than listing them as a formality.
        </p>
        <LegalTable
          caption="Sub-processors and what each one receives"
          head={["Provider", "What it receives", "When"]}
          rows={[
            [
              "Google (Gemini API)",
              "Agent instructions, retrieved knowledge passages, and the recent messages of a conversation.",
              "Every time an agent replies.",
            ],
            [
              "Supabase",
              "Knowledge source text, split into passages and indexed so the agent can retrieve the relevant part, plus the search query. It also backs account sign-in when Garuda is configured to use it.",
              "When a knowledge source is added, and on each retrieval.",
            ],
            [
              "Stripe",
              "Your billing email address, an account identifier, and the card details you enter on Stripe's own payment pages.",
              "Checkout, renewals, invoices and the billing portal.",
            ],
            [
              "SendGrid",
              "A customer's email address and name, to deliver account email: address verification, password reset and the welcome message. Visitor email addresses are never sent to SendGrid.",
              "Account email only.",
            ],
            [
              "Deepgram",
              "The audio of an onboarding voice note, if you choose to record one instead of typing.",
              "Only when you use the voice recorder.",
            ],
            [
              "Composio",
              "An identifier for your workspace and the name of the tool you are connecting. You authorise your own third-party account; Composio holds that connection, not us.",
              "Only for integrations you connect yourself.",
            ],
            [
              "Vercel",
              "Hosting for this website, the customer portal and the widget script. Standard request data reaches it, as with any hosted site.",
              "Whenever a page or the widget script is loaded.",
            ],
            [
              "Our API host",
              "The API at api.garuda.ravan.ai runs on a virtual server we operate and administer. Its provider necessarily holds the disk that our data file sits on.",
              "All the time.",
            ],
          ]}
        />
        <p>
          Every one of these is a company based in the United States, so assume that data sent to them is processed there. There
          are no advertising networks and no analytics vendors on this list, because we use none.
        </p>
        <p>
          If you configure an outbound webhook, Garuda will send lead and conversation events to the URL you chose. Once an event
          leaves for your endpoint, it is in your hands and your provider&apos;s. Our delivery log records the event name, its
          status and the attempt count — never a visitor&apos;s email address or phone number.
        </p>
      </LegalSection>

      {/* Retention: there is no sweeper anywhere in backend/. The rolling 30-day
          StarterConversationWindow governs which prior conversation a returning
          visitor resumes, not deletion. DELETE routes exist for agents, sources,
          integration connections and webhook endpoints only. */}
      <LegalSection id="storage-retention" title="8. Where data lives, and for how long">
        <LegalSubsection title="Where">
          <p>
            Accounts, agents, conversations, messages and leads are held by our API service. Knowledge source text is additionally
            indexed by the retrieval service described above, so an agent can find the relevant passage. Both are covered by the
            sub-processor list.
          </p>
        </LegalSubsection>
        <LegalSubsection title="For how long">
          <p>
            Plainly: <strong>we do not currently delete anything on a schedule.</strong> There is no automated retention or
            deletion sweeper in the product today. Conversations, messages and leads stay in the customer&apos;s workspace until
            the customer or we remove them.
          </p>
          <p>
            One number on the site is easy to mistake for a retention period, so to be clear about what it is: a returning visitor
            resumes a previous conversation only if it was active within the last {PLAN_LIMITS.conversationWindowDays} days, and
            the plan&apos;s {PLAN_LIMITS.monthlyConversations} conversations are counted over the same rolling window. Both are
            product limits. Neither deletes anything.
          </p>
        </LegalSubsection>
        <LegalSubsection title="What a customer can delete themselves, today">
          <p>
            From the portal, a customer can archive an agent and delete a knowledge source — deleting a source also removes its
            indexed passages from the retrieval service. There is no self-serve button yet for deleting a conversation, a lead or
            a whole account. Those are requests we handle by hand, and the next section says how.
          </p>
        </LegalSubsection>
        <LegalNote tone="warning" title="A promise we are not making">
          <p>
            We are not going to state a retention period, a deletion deadline or a response-time guarantee that nothing in the
            product enforces. When automated retention exists, this section will say what it does and this page&apos;s date will
            change.
          </p>
        </LegalNote>
      </LegalSection>

      <LegalSection id="rights" title="9. Your rights, and how to use them">
        <p>
          Depending on where you live, you may have rights over your personal data — to get a copy of it, to correct it, to have
          it deleted, or to object to how it is used. We will act on these requests regardless of whether a particular law applies
          to you. Requests are handled by people, by email, not by an automated flow.
        </p>
        <LegalSubsection title="If you are a customer">
          <p>
            Email{" "}
            <a className="font-medium text-indigo-700 underline underline-offset-4" href="mailto:info@ravan.ai">
              info@ravan.ai
            </a>{" "}
            from the address on your account and say what you want. You can also help yourself first: leads export to CSV from the
            portal, and conversations and their transcripts are all visible there.
          </p>
        </LegalSubsection>
        <LegalSubsection title="If you are a visitor">
          <p>
            The business whose website you chatted on holds the record, so ask them first — they can act immediately and they know
            which conversation you mean. If that gets you nowhere, or you do not know who to ask, email{" "}
            <a className="font-medium text-indigo-700 underline underline-offset-4" href="mailto:info@ravan.ai">
              info@ravan.ai
            </a>{" "}
            with the website, the approximate date and time, and anything that identifies the conversation. We will locate it and
            act on the customer&apos;s instructions, or tell you who to contact.
          </p>
        </LegalSubsection>
        <p>
          We will acknowledge a request when we read it and tell you what we are doing. We deliberately do not publish a
          fixed-hours response guarantee, because nothing in the product enforces one and a promise we cannot keep is worse than
          no promise.
        </p>
      </LegalSection>

      {/* Cookies: the frontend contains no document.cookie use and no cookies()
          call; auth lives in localStorage (frontend/lib/api.ts) and the widget
          uses localStorage keys built by storageKey() in widget/src/v1.js. */}
      <LegalSection id="cookies" title="10. Cookies and browser storage">
        <p>
          Garuda&apos;s own pages set no cookies. There is no cookie banner on this site because there is nothing to consent to:
          no advertising pixels, no analytics scripts, no third-party trackers. What the product does use is browser storage, and
          here is all of it.
        </p>
        <LegalTable
          caption="What Garuda stores in a browser"
          head={["Where", "What is stored", "How long"]}
          rows={[
            [
              "The customer portal",
              "Your access token, refresh token and their expiry, in local storage.",
              "Cleared when you sign out, and when the token expires. Closing the tab does not clear it, so that signing in through Google in a new tab returns you to the app still signed in.",
            ],
            [
              "The customer portal",
              "The id and name of an agent you just created, so the next screen can open it.",
              "Cleared on sign-out.",
            ],
            [
              "The chat widget, on the customer's own site",
              "The remember-or-not choice for that agent.",
              "Until the visitor clears that site's storage.",
            ],
            [
              "The chat widget, on the customer's own site",
              "The returning-visitor token for that agent, only if the visitor chose to be remembered.",
              "Until the visitor clears that site's storage, or chooses use once.",
            ],
          ]}
        />
        <p>
          Widget storage lives under the customer&apos;s own website address, not ours, and every key names the single agent it
          belongs to. If browser storage is unavailable — a private window, or a browser that blocks it — the widget still works;
          it simply cannot remember anything between visits.
        </p>
      </LegalSection>

      <LegalSection id="security" title="11. Security, and what we do not claim">
        <p>
          The measures in place today include: passwords stored only as salted PBKDF2-SHA256 hashes; session tokens stored as
          digests rather than as the tokens themselves and compared in constant time; a widget that only runs on domains the
          customer has listed; per-address rate limits on every public endpoint; and HTTPS everywhere.{" "}
          <Link className="font-medium text-indigo-700 underline underline-offset-4" href="/security">
            The security page
          </Link>{" "}
          goes through each of these in detail.
        </p>
        <LegalNote tone="warning" title="Certifications we do not hold">
          <p>
            Garuda has no SOC 2 report, no ISO 27001 certificate, and is not HIPAA compliant. There has been no independent
            security audit. If a vendor questionnaire asks, the honest answer is no. Do not put protected health information,
            payment card data or government identifiers into a Garuda agent.
          </p>
        </LegalNote>
        <p>
          No service can promise it will never be breached. If a breach affects your data, we will tell you what happened, what we
          know and what we are doing about it.
        </p>
      </LegalSection>

      <LegalSection id="children" title="12. Children">
        <p>
          Garuda is a business tool and is not directed at children. We do not knowingly collect personal data from a child. If
          you believe a child&apos;s data has ended up in a Garuda workspace, write to{" "}
          <a className="font-medium text-indigo-700 underline underline-offset-4" href="mailto:info@ravan.ai">
            info@ravan.ai
          </a>{" "}
          and we will remove it. Customers must not configure an agent to collect contact details from children.
        </p>
      </LegalSection>

      <LegalSection id="changes" title="13. Changes and contact">
        <p>
          When this policy changes, the date at the top changes with it. A change that materially affects how we handle personal
          data will also be announced by email to account holders. Continuing to use Garuda after a change means the updated
          policy applies to you.
        </p>
        <p>
          Garuda is operated by Ravan AI. For anything in this policy — a question, a correction, or a request about your data —
          write to{" "}
          <a className="font-medium text-indigo-700 underline underline-offset-4" href="mailto:info@ravan.ai">
            info@ravan.ai
          </a>
          . Our terms of service are at{" "}
          <Link className="font-medium text-indigo-700 underline underline-offset-4" href="/terms">
            garuda.ravan.ai/terms
          </Link>
          .
        </p>
      </LegalSection>
    </LegalPage>
  );
}
