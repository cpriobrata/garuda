import { Cautions, DoesRefuses, InstructionSnippet, KnowledgeSources, LeadRecord, NotBuiltYet, QuestionList } from "@/components/usecase/blocks";
import { PageShell } from "@/components/usecase/page-shell";
import { RelatedPages } from "@/components/usecase/related";
import { PointGrid, Prose, Section } from "@/components/usecase/sections";
import { pageMetadata } from "@/lib/seo";

const HREF = "/for/healthcare-clinics";

export const metadata = pageMetadata({
  title: "AI front-desk agent for clinic websites — administration only",
  description:
    "An agent for clinic websites that answers hours, location, insurance, fees and booking questions. No medical advice, no diagnosis, no triage, no health records — stated plainly and written into the agent.",
  path: HREF,
});

const hardLimits = [
  {
    title: "No medical advice, ever",
    body: "Not a symptom opinion, not a medication question, not a “does this sound serious”. There is no configuration of Garuda in which giving clinical guidance to a website visitor is acceptable, and the refusal must be written into the agent by you and tested before you publish.",
  },
  {
    title: "No diagnosis and no triage",
    body: "Garuda is not a medical device and has not been assessed as one. It must never rank urgency, decide who needs to be seen first, or tell someone whether they can wait until Monday.",
  },
  {
    title: "No health records, in either direction",
    body: "Do not paste patient information into a knowledge source, and do not build a form that asks for it. There is no integration with a practice management system or an electronic health record, and none should be improvised.",
  },
  {
    title: "No HIPAA coverage and no certification",
    body: "Garuda does not offer a Business Associate Agreement and is not configured to act as a business associate. It holds no SOC 2 report or other security certification. If protected health information would be involved, this is the wrong tool for that data.",
  },
];

const problems = [
  {
    title: "The bottleneck is administrative, and it is enormous",
    body: "Hours, parking, which plans you accept, what a first visit costs without insurance, whether you are taking new patients, how to move an appointment. Every one of those calls occupies a person who is also standing in front of a waiting room.",
  },
  {
    title: "None of it is clinical",
    body: "That is what makes a clinic a good fit despite everything on this page. The high-volume questions are about the practice, not the patient — which means an agent can be genuinely useful while staying entirely outside clinical territory.",
  },
  {
    title: "Insurance questions are the ones that never end",
    body: "“Do you take my plan” is asked in a hundred phrasings and answered from one list. Publishing that list properly removes more front-desk minutes than anything else you will do this year.",
  },
  {
    title: "People do ask at midnight",
    body: "Not for clinical reasons — they are checking whether it is worth calling in the morning. Answering the administrative question at midnight means the morning call is a booking rather than a query.",
  },
];

const answersFreely = [
  "Opening hours, holiday closures, and how to reach the practice urgently",
  "Address, parking, public transport, step-free access and where the entrance is",
  "Which insurers or plans are accepted, and which are not",
  "Self-pay prices for named services, and what a first appointment includes",
  "Whether the practice is accepting new patients, and current waiting times",
  "What to bring to a first appointment, and how long to arrive beforehand",
  "Cancellation and no-show policy, and how to reschedule",
  "How to request records, and how a prescription renewal request is submitted",
];

const neverSays = [
  "Whether a symptom is serious, or what it might be",
  "Whether to take, stop, change or double a medication",
  "What a test result means",
  "Whether someone should go to hospital or wait for an appointment",
  "Anything about a named patient, their history, or their appointments",
  "Reassurance of any kind about a described symptom",
  "A clinical opinion dressed up as general information",
];

const questions = [
  { question: "Are you taking new patients?", source: "Your practice source. Keep it current; it is the answer that changes most often and wastes the most time when it is wrong." },
  { question: "Do you accept my insurance, and do you bill them directly?", source: "The insurance source — accepted plans, plans you do not accept, and what direct billing means at your practice." },
  { question: "What does a first appointment cost if I pay myself?", source: "The fees source, per named service." },
  { question: "Where do I park, and is there step-free access?", source: "The access source: parking, entrance, lifts, accessible toilets, and how far it is from the drop-off point." },
  { question: "What is your cancellation policy?", source: "The policies source, including the fee and the notice period." },
  { question: "How do I transfer my records to you?", source: "The policies source — the process and the form, never the records themselves." },
  { question: "Do you have Saturday or evening appointments?", source: "The practice source." },
  { question: "I have had a headache for three days — should I be worried?", source: "Nothing. This is the question the agent must decline, with the script you wrote, every single time." },
];

const sources = [
  {
    title: "The practice",
    contains: [
      "Every location, with opening hours and holiday closures",
      "Whether you are accepting new patients, per location and per clinician",
      "Named clinicians, their public qualifications and the services they provide",
      "Current typical wait to a first appointment",
      "How to reach a person urgently during hours, and what to do outside them",
    ],
  },
  {
    title: "Insurance and fees",
    contains: [
      "Plans and insurers accepted, written out in full",
      "Plans you do not accept, written out just as plainly",
      "Self-pay prices for named services",
      "Whether you bill insurers directly, and what a patient pays at the visit",
      "Deposits, and how a refund works",
    ],
  },
  {
    title: "Getting here and getting in",
    contains: [
      "Address, entrance, and what the building looks like from the street",
      "Parking, permits, drop-off points and blue badge or accessible spaces",
      "Step-free access, lifts, accessible toilets, hearing loops",
      "Public transport and walking time from the nearest stop",
      "Whether a carer, interpreter or chaperone can attend",
    ],
  },
  {
    title: "Policies and paperwork",
    contains: [
      "Cancellation and no-show policy, notice period and fee",
      "How to reschedule, and how far ahead you book",
      "Records request process, and the form or portal that handles it",
      "Prescription renewal process — the mechanics only, never the decision",
      "What to bring, including identification and referral requirements",
    ],
  },
  {
    title: "Refusal and escalation scripts",
    contains: [
      "The exact wording used when a visitor describes a symptom",
      "The exact wording for a medication or test-result question",
      "The emergency wording, with the emergency number for your country, used whenever anything sounds urgent",
      "The sentence that tells visitors not to type health details into the chat",
      "How to reach a human at the practice, repeated in every one of these scripts",
    ],
  },
];

const leadFields = [
  { label: "Name", type: "text" as const, value: "A. Fernandes", required: true },
  {
    label: "What do you need?",
    type: "select" as const,
    value: "Book a first appointment",
    required: true,
    why: "A dropdown, deliberately. A free-text box here is an invitation to describe a medical problem, and everything typed into it is stored. Six fixed options cover almost every front-desk request without collecting a single clinical detail.",
  },
  { label: "New or existing patient", type: "select" as const, value: "New patient", required: true },
  { label: "Preferred contact method", type: "select" as const, value: "Phone" },
  { label: "Phone", type: "telephone" as const, value: "+353 1 555 01xx" },
  { label: "Email", type: "email" as const, value: "a.fernandes@example.com" },
  { label: "Preferred day", type: "date" as const, value: "2026-09-08" },
  {
    label: "Preferred time of day",
    type: "select" as const,
    value: "Morning",
    why: "Enough for the front desk to offer two real slots on the callback, which is the entire purpose of the form.",
  },
];

const cautions = [
  {
    title: "Write the refusal, then attack it",
    body: "Do not assume a general-purpose model will refuse correctly. Garuda lets you talk to an agent privately while it is still a draft. Spend that session trying to get clinical guidance out of it — indirectly, hypothetically, on behalf of a friend — and only publish when it holds.",
  },
  {
    title: "Emergencies come first, not the lead form",
    body: "If anything a visitor types sounds urgent, the reply must be the emergency script and nothing else: no qualifying questions, no consent prompt, no contact form. Put that instruction above every other instruction in the agent.",
  },
  {
    title: "Everything typed is stored, including what you asked them not to type",
    body: "Conversations and captured leads persist in your workspace. Some visitors will describe symptoms anyway. Decide in advance who may read transcripts, how long you keep them, and treat them with the care that content deserves.",
  },
  {
    title: "Advertising rules apply to whatever is in a source",
    body: "Outcome claims, before-and-after language, superlatives and patient testimonials are restricted for healthcare advertising in most jurisdictions. Sources are supplied to the model on every reply, so anything you put in one can come back out in an answer. Keep clinical claims out of them entirely.",
  },
];

export default function HealthcareClinicsPage() {
  return (
    <PageShell
      crumbs={[{ label: "Home", href: "/" }, { label: "By industry", href: "/for" }, { label: "Healthcare clinics", href: HREF }]}
      eyebrow="For clinics and practices"
      title="A front desk that answers at midnight. Nothing clinical, by design."
      lede="Clinics get a very high volume of administrative questions and almost no capacity to answer them. Garuda can answer those — hours, access, insurance, fees, booking, policies — from information you have approved. It must not answer anything clinical, and the first section of this page is about making sure it does not."
      facts={["Administrative questions only", "No medical advice, diagnosis or triage", "No health records"]}
      cta={{ label: "Build an administrative agent", href: "/auth/sign-up" }}
      secondary={{ label: "Read the limits first", href: "#limits" }}
    >
      <Section
        id="limits"
        eyebrow="Before anything else"
        title="What a Garuda agent must never do on a clinic website"
        lede="These are not disclaimers at the bottom of a marketing page. They are the constraints that decide whether this product is appropriate for your practice at all, so they are at the top."
      >
        <Cautions points={hardLimits} tone="rose" />
        <div className="mt-8">
          <NotBuiltYet title="Stated plainly">
            <p>
              Garuda is a website chat product. It is not a medical device, not a triage system, and not a patient portal.
              It has not been evaluated by any medical regulator, and nothing on this site should be read as a claim that
              it has.
            </p>
            <p>
              If your use case requires protected health information, a Business Associate Agreement, or a formal security
              certification, Garuda cannot support it today. That is a limitation to plan around, not one to work around.
            </p>
          </NotBuiltYet>
        </div>
      </Section>

      <Section
        id="problem"
        tone="muted"
        eyebrow="The problem"
        title="Almost everything that swamps a front desk is administrative"
        lede="Which is the reason a clinic can use this well: the questions that consume the most staff time are the ones furthest from clinical judgement."
      >
        <PointGrid points={problems} />
      </Section>

      <Section
        id="boundary"
        eyebrow="The boundary"
        title="Administrative on the left, clinical on the right"
        lede="Every item on the right has to be refused in words you wrote, routed to a person, and escalated to emergency services when anything sounds urgent."
      >
        <DoesRefuses
          doesTitle="Answers from your published information"
          does={answersFreely}
          refusesTitle="Refuses and redirects, always"
          refuses={neverSays}
        />
        <div className="mt-10">
          <InstructionSnippet
            label="Paste into the agent instructions, above everything else"
            lines={[
              "You handle administrative questions about this practice only: hours, location, access, insurance, fees, booking, policies and paperwork.",
              "You never give medical advice, opinions, reassurance, diagnosis, triage or medication guidance, and you never interpret symptoms or test results — not directly, not hypothetically, and not on behalf of somebody else.",
              "If a visitor describes a symptom or asks anything clinical, reply only with the refusal script from the escalation source and give them the practice number.",
              "If anything sounds urgent or life-threatening, reply only with the emergency script. Do not ask questions and do not offer the contact form.",
              "Ask visitors not to include health details, and never repeat a health detail a visitor has typed.",
            ]}
          />
        </div>
      </Section>

      <Section
        id="questions"
        tone="muted"
        eyebrow="What visitors ask"
        title="Seven questions worth answering, and one that is not"
        lede="The first seven are the reason to do this at all. The eighth is the reason to configure it carefully."
      >
        <QuestionList items={questions} />
      </Section>

      <Section
        id="knowledge"
        eyebrow="What to give it"
        title="Five sources, and the fifth one is refusals"
        lede="Each agent gets five knowledge sources on the $17 plan. For a clinic, one of them is not information at all — it is the exact wording used when the agent declines. Public, administrative information only: nothing about a patient goes into any of these."
      >
        <KnowledgeSources sources={sources} />
        <Prose className="mt-8">
          Sources are pasted text that you approve. Garuda does not crawl a URL you supply, and there is no connection to a
          practice management system or an electronic health record — which, for a clinic, is a useful property rather than
          a missing feature.
        </Prose>
      </Section>

      <Section
        id="lead"
        tone="muted"
        eyebrow="What you get back"
        title="A callback request that contains no health information"
        lede="The form is yours to build from up to twenty fields. For a clinic the design goal is subtraction: collect enough to return the call and nothing more. Contact details are stored only after the visitor explicitly agrees."
      >
        <LeadRecord
          heading="Callback request · illustrative example"
          fields={leadFields}
          consentLine="Consent recorded with the capture, along with the version of the notice the visitor agreed to. Point that notice at your own privacy policy."
          note="An invented example. Note what is missing: there is no “describe your symptoms” box, no reason-for-visit free text, and no upload. Every field is administrative, and the one open-ended question was replaced by a dropdown on purpose."
        />
      </Section>

      <Section
        id="cautions"
        eyebrow="Read this part"
        title="Four things to settle before this goes live"
      >
        <Cautions points={cautions} />
      </Section>

      <RelatedPages currentHref={HREF} />
    </PageShell>
  );
}
