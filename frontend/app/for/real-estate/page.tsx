import { Cautions, InstructionSnippet, KnowledgeSources, LeadRecord, QuestionList } from "@/components/usecase/blocks";
import { PageShell } from "@/components/usecase/page-shell";
import { RelatedPages } from "@/components/usecase/related";
import { PointGrid, Prose, Section } from "@/components/usecase/sections";
import { pageMetadata } from "@/lib/seo";

const HREF = "/for/real-estate";

export const metadata = pageMetadata({
  title: "AI chat agent for real estate websites",
  description:
    "Put an agent on your listing pages that answers from your own particulars, and turns a 10pm browser into an enquiry with the property reference, budget and viewing window attached.",
  path: HREF,
});

const problems = [
  {
    title: "A property enquiry goes stale in hours, not days",
    body: "The same buyer messages three agencies in one evening. Whoever gives them something useful first is the one they call back. A form submission that sits until 9am has already lost that race.",
  },
  {
    title: "Your contact form throws away the context",
    body: "Someone reads one listing for four minutes, clicks Contact, and you receive “interested, please call”. Garuda stores the page the conversation started on beside the transcript, so you at least know which property they were looking at.",
  },
  {
    title: "The questions were answerable all along",
    body: "Tenure, service charge, floor, parking, measured area, earliest move-in — it is all in particulars you have already written. It just needs somebody awake to read it out.",
  },
  {
    title: "An enquiry from your own site is one you own",
    body: "Portal enquiries arrive on someone else’s terms. A conversation on your own listing page is yours: your wording, your qualifying questions, your record of it.",
  },
];

const questions = [
  {
    question: "Is it still available, or has an offer been accepted?",
    source: "Your stock source — and only as fresh as you last edited it. Tell the agent to offer to confirm rather than state availability as fact.",
  },
  {
    question: "What is the service charge and ground rent, and how many years are left on the lease?",
    source: "The tenure and outgoings block of the stock source.",
  },
  {
    question: "Is that the carpet area or the built-up area, and which floor is it on?",
    source: "The specification block — write which measurement standard you quote, exactly as it appears in the particulars.",
  },
  {
    question: "Is there allocated parking, and can a visitor park?",
    source: "The specification block.",
  },
  {
    question: "How far is the station, and which schools are nearby?",
    source: "Your area notes source — verifiable facts such as distances, journey times and named schools.",
  },
  {
    question: "Can I view on Saturday morning?",
    source: "Your viewings source. The agent explains how viewings work and takes the request; a person confirms the slot, because Garuda does not hold your diary.",
  },
  {
    question: "What do I pay before I move in?",
    source: "The fees source — holding deposit, security deposit, referencing, first month, and when each is due.",
  },
  {
    question: "Would the seller take fifteen under asking?",
    source: "Nothing. This is the question to refuse in writing. Negotiation is a conversation for a person who knows the vendor.",
  },
];

const sources = [
  {
    title: "Current stock",
    contains: [
      "One block per available property, starting with its reference",
      "Asking price or rent, and what the rent includes",
      "Bedrooms, bathrooms, floor area and the measurement standard used",
      "Floor, aspect, parking, outside space",
      "Tenure, lease years remaining, service charge, ground rent, council tax band",
      "Availability and earliest move-in date, with the date you last checked it",
    ],
  },
  {
    title: "Viewings and offers",
    contains: [
      "The days and hours you show properties, and how far ahead you book",
      "Who attends a viewing, and whether tenants are in occupation",
      "How an offer is made and what proof of funds you ask for",
      "What happens between offer accepted and exchange, in plain order",
      "Anything a buyer must supply before you can proceed",
    ],
  },
  {
    title: "Money, in full",
    contains: [
      "Tenant costs: holding deposit, security deposit, referencing, rent in advance",
      "What a buyer pays and at which stage",
      "Your fee to a vendor or landlord and what it covers",
      "Which of these are capped or prohibited where you operate, and the wording you use to say so",
    ],
  },
  {
    title: "Area notes",
    contains: [
      "Station names and walking or driving times",
      "Named schools and the inspection ratings you already publish",
      "Parking zones, permit costs, council tax bands",
      "Facts only — no characterisation of who lives in a neighbourhood",
    ],
  },
  {
    title: "The agency itself",
    contains: [
      "Offices, opening hours, and how to reach a person out of hours",
      "Which negotiator covers which patch",
      "Your complaints procedure and redress or ombudsman scheme membership",
      "Registration and licence numbers you are required to display",
    ],
  },
];

const leadFields = [
  { label: "Full name", type: "text" as const, value: "Priya N.", required: true },
  {
    label: "Phone",
    type: "telephone" as const,
    value: "+44 7700 900xxx",
    required: true,
    why: "Property enquiries convert on a call, not an email thread. Make the phone number required and everything else optional if you have to choose.",
  },
  { label: "Email", type: "email" as const, value: "priya@example.com", required: true },
  {
    label: "Property reference",
    type: "text" as const,
    value: "MPL-1408",
    required: true,
    why: "The lead form does not read the page it is sitting on, so ask for the reference outright. The transcript beside the lead also records the page the conversation started on, which is your fallback when someone leaves it blank.",
  },
  {
    label: "Buying or renting",
    type: "select" as const,
    value: "Renting",
    required: true,
    why: "A select rather than a free-text box, because this is the field that routes the enquiry to the right person.",
  },
  { label: "Budget", type: "select" as const, value: "£1,800 – £2,200 pcm", why: "Bands, not a number field. People answer a band honestly and abandon a box that demands a figure." },
  {
    label: "Mortgage in principle / funds confirmed",
    type: "checkbox" as const,
    value: "Not yet",
    why: "One checkbox separates a serious buyer from a browser without an interrogation.",
  },
  { label: "Earliest viewing date", type: "date" as const, value: "2026-09-06" },
  { label: "Anything we should know", type: "textarea" as const, value: "Two cats, needs parking, moving from out of area." },
];

const cautions = [
  {
    title: "Never let it negotiate",
    body: "Write an explicit refusal into the agent’s instructions for price, offers and “what would they accept”. An AI guess at a vendor’s floor is a number your seller never agreed to, published on your own website.",
  },
  {
    title: "Stale stock is repeated with total confidence",
    body: "The agent answers from the text you gave it and has no way to know it is out of date. Put a “last checked” date in the stock source, edit it on a fixed day each week, and instruct the agent to offer to confirm availability rather than assert it.",
  },
  {
    title: "Do not describe who lives in an area",
    body: "Keep area answers to transport, schools, amenities and tax bands. Answering “is this a good area for a family like mine” is steering, and in many jurisdictions it is unlawful discrimination. Instruct the agent to redirect those questions to published data.",
  },
  {
    title: "Whatever is in a source can end up in an answer",
    body: "Sources are supplied to the model as reference data on every reply. Vendor names, access codes, the reason for the sale and anything else you would not print in the particulars do not belong in there.",
  },
];

export default function RealEstatePage() {
  return (
    <PageShell
      crumbs={[{ label: "Home", href: "/" }, { label: "By industry", href: "/for" }, { label: "Real estate", href: HREF }]}
      eyebrow="For estate agents and property teams"
      title="Answer the listing question while they are still on the listing"
      lede="Garuda puts a knowledge-grounded agent on your property pages. It answers from the particulars you approved, refuses the questions only a person should handle, and — with the visitor’s explicit consent — hands you an enquiry that already carries the property reference, the budget band and a viewing window."
      facts={[
        "Answers only from sources you add",
        "Publishes to the domains you approve",
        "$17/month",
      ]}
      cta={{ label: "Build an agent for your listings", href: "/auth/sign-up" }}
    >
      <Section
        id="problem"
        eyebrow="The problem"
        title="Property enquiries are perishable in a way most web leads are not"
        lede="Every business says it wants faster follow-up. In property the cost of a slow reply is specific and measurable: the viewing is booked with someone else."
      >
        <PointGrid points={problems} />
      </Section>

      <Section
        id="questions"
        tone="muted"
        eyebrow="What visitors ask"
        title="Eight questions your listing pages get at ten at night"
        lede="Seven of these have an answer sitting in a document you have already written. The eighth is the one your agent should be told to refuse."
      >
        <QuestionList items={questions} />
      </Section>

      <Section
        id="knowledge"
        eyebrow="What to give it"
        title="Five sources, arranged for property"
        lede="Each agent gets five knowledge sources on the $17 plan, so group them by topic rather than by document. A source can hold up to 100,000 characters, but only the first 12,000 of each is passed to the model with a reply — put the answers near the top and the small print underneath."
      >
        <KnowledgeSources sources={sources} />
        <Prose className="mt-8">
          Sources are added as text. You can attach a source URL for your own reference, but Garuda does not crawl it: paste
          the wording you want the agent to use, which is also the only way to be sure it is quoting particulars you have
          approved.
        </Prose>
      </Section>

      <Section
        id="lead"
        tone="muted"
        eyebrow="What you get back"
        title="What a useful property enquiry actually contains"
        lede="The lead form is yours to build — up to twenty fields, using text, email, telephone, number, textarea, select, checkbox and date. Contact details are only stored after the visitor explicitly agrees, and the record is kept with the conversation it came from."
      >
        <LeadRecord
          heading="Captured lead · illustrative example"
          fields={leadFields}
          consentLine="Consent recorded with the capture. Without it, Garuda refuses to store the contact details at all."
          note="This is an invented example, not a customer record. What matters is the shape: nine fields, one of which is a reference number, and none of which asks the visitor to write an essay before you will call them back."
        />
      </Section>

      <Section
        id="instructions"
        eyebrow="How to say it"
        title="Two instructions worth writing before you publish"
        lede="Garuda drafts an agent for you from a short conversation about your business, and you edit it before it goes live. These are the two lines a property agent should add by hand."
      >
        <InstructionSnippet
          label="Paste into the agent instructions"
          lines={[
            "Never discuss price negotiation, what an offer might be accepted at, or a vendor's circumstances. Say that offers are handled by a named negotiator and take the visitor's details.",
            "Availability changes daily. Never state that a property is definitely still available; say what the stock source records, give the date it was last checked, and offer to have someone confirm.",
          ]}
        />
        <Prose className="mt-8">
          If you leave the instructions empty, the agent falls back to a built-in line telling it to be concise and never
          invent missing business facts. That is a floor, not a policy — the two lines above are the ones that keep a
          property business out of an argument.
        </Prose>
      </Section>

      <Section
        id="cautions"
        eyebrow="Read this part"
        title="Where an agent gets a property business into trouble"
        lede="An agent on a listing page is a publisher of your statements. Everything below is a decision you make when you configure it, not something the software decides for you."
      >
        <Cautions points={cautions} />
      </Section>

      <RelatedPages currentHref={HREF} />
    </PageShell>
  );
}
