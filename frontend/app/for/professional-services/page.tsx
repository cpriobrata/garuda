import { Cautions, DoesRefuses, InstructionSnippet, KnowledgeSources, LeadRecord, QuestionList } from "@/components/usecase/blocks";
import { PageShell } from "@/components/usecase/page-shell";
import { RelatedPages } from "@/components/usecase/related";
import { PointGrid, Prose, Section } from "@/components/usecase/sections";
import { pageMetadata } from "@/lib/seo";

const HREF = "/for/professional-services";

export const metadata = pageMetadata({
  title: "AI chat agent for law, accounting and consulting firms",
  description:
    "A website agent that answers about your firm — services, fees, jurisdictions, intake — and refuses to advise on the visitor’s own matter, while collecting what a conflict check actually needs.",
  path: HREF,
});

const problems = [
  {
    title: "The risk here is the wrong answer, not the slow one",
    body: "A roofer who replies late loses a job. A firm whose website appears to give tax or legal guidance to a stranger has a different kind of problem, and it does not go away when the enquiry does.",
  },
  {
    title: "You cannot accept work just because someone asked",
    body: "Conflict checks, jurisdiction, capacity and scope all come before a yes. Intake is a filtering process, so a chat that only says “great, someone will call you” has done almost none of the work.",
  },
  {
    title: "Visitors will describe their situation whether you invite it or not",
    body: "Someone with a deadline in nine days is going to type the facts into the first box they find. Your agent needs a prepared, repeatable way of receiving that without answering it.",
  },
  {
    title: "The genuinely repetitive questions are about you, not about them",
    body: "Fees, engagement structure, which jurisdictions you are admitted in, what the first meeting costs, whether you are taking new clients. All of it is answerable and none of it is advice.",
  },
];

const answersFreely = [
  "Practice areas and matter types you take — and the ones you decline",
  "Fee structure: hourly, fixed fee, retainer, contingency where permitted",
  "What an initial consultation costs, how long it lasts, and whether it is chargeable",
  "Jurisdictions, admissions, registrations and professional body membership",
  "Whether you are accepting new clients, and typical lead time to a first meeting",
  "What the intake process looks like and what to bring to a first meeting",
  "How documents are exchanged securely once you are engaged",
];

const neverSays = [
  "Whether the visitor has a case, a claim, or a problem",
  "What the visitor should do, file, sign, sell or say",
  "An interpretation of a statute, a contract clause, a notice or a tax position",
  "An estimate of what a matter is worth or what it will cost to run",
  "How long the visitor has left before a deadline or limitation period",
  "Anything that reads as though the firm has been engaged",
];

const questions = [
  { question: "Do you handle this kind of matter?", source: "Your practice-areas source — including an explicit list of what you do not take, which is the half most firms leave out." },
  { question: "How do you charge — hourly, fixed fee, or a retainer?", source: "The fees source." },
  { question: "Is the first consultation free, and how long is it?", source: "The fees source. Say plainly whether it is chargeable; that is the question behind the question." },
  { question: "Which states or jurisdictions are you admitted in?", source: "The firm source: admissions, registration numbers, regulator and professional body membership." },
  { question: "Are you taking new clients this quarter?", source: "The intake source — keep this one current, because it is the fastest way to stop wasting both parties’ time." },
  { question: "What do I need to bring to a first meeting?", source: "The intake source." },
  { question: "Can you take on our year-end at this stage?", source: "The intake source: cut-off dates, what you need from a new client, and what a late handover means in practice." },
  { question: "Here is my situation — what should I do?", source: "Nothing. This is the question the agent exists to decline gracefully, and the one to test hardest before you publish." },
];

const sources = [
  {
    title: "Practice areas, both ways",
    contains: [
      "Matter types you take, described the way a client would search for them",
      "Matter types you explicitly decline, and where you refer them instead",
      "Sectors and client sizes you are set up for",
      "Anything seasonal or capacity-limited",
    ],
  },
  {
    title: "Fees and engagement",
    contains: [
      "How you charge, per service, in plain figures or ranges",
      "Whether the first consultation is chargeable, and what it includes",
      "Disbursements, filing fees and third-party costs a client should expect",
      "Billing cycle, payment terms and retainer mechanics",
      "The plain-language version of your engagement terms — never the engagement letter itself",
    ],
  },
  {
    title: "Credentials and jurisdiction",
    contains: [
      "Admissions, licences, registration numbers and the regulator behind each",
      "Professional indemnity cover you publish",
      "Named practitioners, their qualifications and the areas they cover",
      "Languages the firm works in, and offices",
    ],
  },
  {
    title: "Intake, step by step",
    contains: [
      "What happens between an enquiry and a first meeting",
      "That a conflict check must clear before the firm can act",
      "What a new client needs to supply, including identity verification",
      "Typical lead time to a first appointment",
      "How and when documents should be sent — and that it is never through the chat",
    ],
  },
  {
    title: "Boundary language",
    contains: [
      "The exact sentence the agent uses when someone starts describing their own matter",
      "Your standard no-advice and no-engagement wording",
      "The line telling visitors not to send confidential or privileged material through the chat",
      "The referral wording for matters you do not take",
    ],
  },
];

const leadFields = [
  { label: "Name", type: "text" as const, value: "M. Okafor", required: true },
  { label: "Email", type: "email" as const, value: "m.okafor@example.com", required: true },
  { label: "Phone", type: "telephone" as const, value: "+44 20 7946 0xxx" },
  {
    label: "Matter type",
    type: "select" as const,
    value: "Commercial lease dispute",
    required: true,
    why: "A select built from your practice-areas source. It routes the enquiry and, just as usefully, it lets the agent say early that a matter type is one you do not take.",
  },
  {
    label: "Other parties involved",
    type: "text" as const,
    value: "Harbourline Properties Ltd",
    required: true,
    why: "The field that makes this form different from every other lead form on this site. Without the counterparty you cannot start a conflict check, so the first callback is spent asking for it. With it, the check can run before anyone picks up the phone.",
  },
  {
    label: "Jurisdiction",
    type: "select" as const,
    value: "England and Wales",
    why: "Cheaper to ask than to discover in the meeting. It also prevents a polite conversation with somebody you are not admitted to act for.",
  },
  {
    label: "Any deadline you are aware of",
    type: "date" as const,
    value: "2026-09-19",
    why: "A date field, and nothing more. The agent records the date; it must never comment on whether the deadline is achievable or what it means.",
  },
  { label: "How did you hear about us", type: "select" as const, value: "Search" },
  {
    label: "Brief description, in your own words",
    type: "textarea" as const,
    value: "Landlord has served notice; we want to understand our options.",
    why: "Keep it optional, keep it short, and put the non-confidential notice directly above it. People will write here regardless — the honest thing is to tell them what it is before they do.",
  },
];

const cautions = [
  {
    title: "Nothing here is privileged, and visitors assume it is",
    body: "A chat with a website agent is not a solicitor-client or accountant-client communication, and no privilege attaches to it. Put that in the lead form’s privacy text and in the agent’s boundary source, in words a non-lawyer will understand, before the description box rather than after it.",
  },
  {
    title: "Nothing the agent says creates an engagement",
    body: "State it explicitly and instruct the agent to repeat it whenever someone starts describing facts. The sentence you want is short: the firm is not engaged, no advice is being given, and a person will follow up.",
  },
  {
    title: "The transcript is stored, so plan for it",
    body: "Conversations and leads persist in your workspace, and anything a visitor types is part of that record. Tell visitors not to send documents or sensitive details, and treat the transcript with the same care as any other intake record.",
  },
  {
    title: "Your regulator has opinions about advertising",
    body: "Outcome claims, success rates, comparative superlatives and testimonials are restricted for regulated professions in most jurisdictions. Whatever you put in a source can end up in an answer, so keep those claims out of the sources entirely.",
  },
];

export default function ProfessionalServicesPage() {
  return (
    <PageShell
      crumbs={[{ label: "Home", href: "/" }, { label: "By industry", href: "/for" }, { label: "Professional services", href: HREF }]}
      eyebrow="For legal, accounting and consulting firms"
      title="Answer about the firm. Never about the matter."
      lede="A website agent for a regulated practice has one job and one prohibition. The job is to answer the genuinely repetitive questions — fees, scope, jurisdictions, intake, availability. The prohibition is advice: it must not evaluate a visitor’s situation, and it must say so when asked. This page is about configuring both."
      facts={["Answers only from sources you add", "Consent-based capture", "$17/month"]}
      cta={{ label: "Build an agent for your firm", href: "/auth/sign-up" }}
    >
      <Section
        id="problem"
        eyebrow="The problem"
        title="Intake is a filter, and a chat widget is a very fast way to fail at filtering"
        lede="Most chatbot advice assumes any enquiry is a good enquiry. For a professional firm that is exactly wrong, and the pages that say otherwise are not written by anybody who has run a conflict check."
      >
        <PointGrid points={problems} />
      </Section>

      <Section
        id="boundary"
        tone="muted"
        eyebrow="The boundary"
        title="The line that has to be drawn before you publish"
        lede="Everything on the left is a published fact about your practice. Everything on the right is professional judgement, which is the thing your clients pay for and the thing a website agent must never simulate."
      >
        <DoesRefuses
          doesTitle="Answers about the firm"
          does={answersFreely}
          refusesTitle="Refuses, every time"
          refuses={neverSays}
        />
        <div className="mt-10">
          <InstructionSnippet
            label="Paste into the agent instructions"
            lines={[
              "You describe this firm. You never give legal, tax, accounting or financial advice, and you never assess a visitor's own situation, documents, deadlines or prospects.",
              "If a visitor describes their matter, acknowledge it in one sentence, state plainly that this conversation is not advice and does not create a client relationship, and offer to pass the details to the intake team.",
              "Never say whether the firm can act until a conflict check has been completed by a person. Never comment on a deadline other than to record it.",
              "Ask visitors not to send documents or confidential details through this chat.",
            ]}
          />
        </div>
        <Prose className="mt-8">
          Put the same boundary in the welcome message, so it is the first thing a visitor reads rather than a correction
          they receive after typing three paragraphs. The welcome message is stored as the opening message of every
          conversation.
        </Prose>
      </Section>

      <Section
        id="questions"
        eyebrow="What visitors ask"
        title="Eight questions a firm gets weekly"
        lede="Seven are about you. The eighth is the one to rehearse a refusal for."
      >
        <QuestionList items={questions} />
      </Section>

      <Section
        id="knowledge"
        tone="muted"
        eyebrow="What to give it"
        title="Five sources, and one of them is nothing but boundary language"
        lede="Each agent gets five knowledge sources on the $17 plan. Most businesses spend all five on marketing material. A regulated firm should spend one of them on the exact words the agent uses when it declines."
      >
        <KnowledgeSources sources={sources} />
        <Prose className="mt-8">
          A source can hold up to 100,000 characters, but only the first 12,000 of each is supplied to the model with any
          given reply, and the combined prompt stops adding sources at roughly 40,000 characters. Put the boundary source
          first and keep it short: it is the one that must never be the text that got truncated.
        </Prose>
      </Section>

      <Section
        id="lead"
        eyebrow="What you get back"
        title="An enquiry a conflict check can start from"
        lede="This is where a professional services form diverges from every other form on this site. You are not only collecting a way to reach someone; you are collecting the minimum needed to decide whether you may act at all."
      >
        <LeadRecord
          heading="Captured enquiry · illustrative example"
          fields={leadFields}
          consentLine="Consent recorded with the capture, alongside the notice version the visitor agreed to."
          note="An invented example. The two fields worth arguing about are the counterparty and the deadline: both are cheap to ask for at 11pm and expensive to chase the next afternoon."
        />
      </Section>

      <Section
        id="cautions"
        eyebrow="Read this part"
        title="Four things to settle with your risk partner first"
      >
        <Cautions points={cautions} />
      </Section>

      <RelatedPages currentHref={HREF} />
    </PageShell>
  );
}
