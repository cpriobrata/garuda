import { Cautions, DoesRefuses, InstructionSnippet, KnowledgeSources, LeadRecord, QuestionList } from "@/components/usecase/blocks";
import { PageShell } from "@/components/usecase/page-shell";
import { RelatedPages } from "@/components/usecase/related";
import { PointGrid, Prose, Section, StepList } from "@/components/usecase/sections";
import { pageMetadata } from "@/lib/seo";

const HREF = "/for/home-services";

export const metadata = pageMetadata({
  title: "AI chat agent for roofing, plumbing and HVAC websites",
  description:
    "A website agent for home services that answers coverage, callout and warranty questions instantly, qualifies the job and the urgency, and never quotes a price for work nobody has seen.",
  path: HREF,
});

const problems = [
  {
    title: "The first useful answer usually wins the job",
    body: "A tank is leaking through a ceiling at 11pm. That homeowner is opening four tabs and calling whoever responds. Nothing about the quality of your work is being compared yet.",
  },
  {
    title: "Speed alone is worthless if the job is not yours",
    body: "A large share of enquiries are outside the area you cover, or a job type you do not take. Answering them faster just wastes more of your time. The agent has to qualify while it answers.",
  },
  {
    title: "The same six questions, every single time",
    body: "Do you cover my postcode. What is the callout fee. Are you insured. Do you do free estimates. What brands do you work on. How long is the warranty. None of these need you.",
  },
  {
    title: "Your team is on a roof, not at a desk",
    body: "The people who can answer are physically unable to. A chat that answers the six questions and takes a proper job description is the difference between a callback list and a dead evening.",
  },
];

const questions = [
  { question: "Do you cover my postcode?", source: "Your coverage source — list the towns, postcodes or ZIP prefixes explicitly, including the ones you deliberately do not serve." },
  { question: "What is the callout fee, and does it come off the bill if I go ahead?", source: "The pricing source. Publish the fee and the rule, and the agent stops being asked." },
  { question: "Can someone come out today?", source: "Your emergency policy source. The agent explains how emergency jobs are handled and takes the details — it cannot see your dispatch board or promise a time." },
  { question: "Are you licensed and insured?", source: "The credentials source: registration numbers, the scheme name, your public liability cover, and what each one actually means." },
  { question: "Roughly what does a replacement boiler cost?", source: "The pricing source, as a published range with the words “subject to survey” attached. Never a firm figure." },
  { question: "Do you work on my brand of furnace?", source: "The credentials source — list brands serviced and any you decline." },
  { question: "Is there financing, and what does the warranty cover?", source: "The pricing source: finance options, warranty length, what voids it, and who honours it." },
  { question: "I can smell gas — what do I do?", source: "A scripted safety response you write yourself. This one is covered further down the page, and it matters more than any of the others." },
];

const answersFreely = [
  "Which areas you cover, and which you do not",
  "The callout or diagnostic fee, and whether it is credited against the work",
  "Published price ranges, always labelled as an estimate subject to survey",
  "Licences, registrations, insurance and the schemes you belong to",
  "Brands and system types you service",
  "Warranty terms, finance options, and how payment works",
  "How emergency jobs are prioritised, and your normal working hours",
];

const neverSays = [
  "A firm price for work nobody has inspected",
  "An arrival time, an engineer name or a slot — Garuda cannot see your schedule",
  "Step-by-step instructions for gas, live electrical or structural work",
  "That a job is safe to leave until morning",
  "Anything implying a warranty or a guarantee you have not published",
  "A diagnosis of the fault from a description in a chat window",
];

const sources = [
  {
    title: "Coverage and hours",
    contains: [
      "Every town, postcode or ZIP prefix you serve, written out",
      "Areas you are asked about and decline, so the agent can say no cleanly",
      "Normal working hours, and what out-of-hours means for you",
      "Whether coverage differs by job type — some firms travel further for installs",
    ],
  },
  {
    title: "Pricing, published",
    contains: [
      "Callout and diagnostic fee, and the rule about crediting it",
      "Ranges by job type, each one labelled as an estimate subject to survey",
      "Out-of-hours, weekend and holiday uplifts",
      "Finance options and the wording your regulator requires",
      "What a written quote includes and how long it stands",
    ],
  },
  {
    title: "Credentials and capability",
    contains: [
      "Registration and licence numbers, and the scheme behind each one",
      "Insurance held, and the cover level you publish",
      "Brands and system types you service, and any you refuse",
      "Certifications your engineers hold, in plain language",
      "Warranty length and what voids it",
    ],
  },
  {
    title: "Emergency policy and safety scripts",
    contains: [
      "What you class as an emergency, and what happens next",
      "The exact words the agent must use for a suspected gas leak",
      "The exact words for water ingress, electrical burning smells and no-heat in freezing weather",
      "The emergency numbers a visitor should call instead of waiting for you",
    ],
  },
  {
    title: "How a job actually runs",
    contains: [
      "What happens between the call and the visit",
      "What the homeowner needs to do before you arrive: access, parking, pets, water shut-off location",
      "How long common jobs take on site",
      "Payment terms, and what you leave behind — certificates, invoices, guarantees",
    ],
  },
];

const leadFields = [
  { label: "Name", type: "text" as const, value: "Dan R.", required: true },
  {
    label: "Phone",
    type: "telephone" as const,
    value: "+1 555 0142",
    required: true,
    why: "Put this second, right after the name. In home services the callback is the product; an email address is a consolation prize.",
  },
  {
    label: "Postcode or ZIP",
    type: "text" as const,
    value: "SE15",
    required: true,
    why: "The single most valuable field on the form. It decides whether the job is yours before anyone spends a minute on it.",
  },
  {
    label: "What is wrong",
    type: "select" as const,
    value: "Leak — water coming through a ceiling",
    required: true,
    why: "A select, not free text. Six to eight options that map to how you actually dispatch, so the list sorts itself.",
  },
  {
    label: "How urgent",
    type: "select" as const,
    value: "Today — it is getting worse",
    required: true,
    why: "This is the field that turns a list of leads into a running order at seven the next morning.",
  },
  { label: "Property type", type: "select" as const, value: "Terraced house, two storeys" },
  { label: "Access", type: "select" as const, value: "Someone home all day" },
  { label: "Description", type: "textarea" as const, value: "Started after the storm. Stain spreading above the kitchen light fitting." },
  { label: "Email", type: "email" as const, value: "dan@example.com" },
];

const setupSteps = [
  {
    title: "Write the coverage list first",
    body: "Before anything else, paste every postcode or ZIP prefix you serve into one source. This is what stops the agent being polite and useful to somebody two hours away.",
  },
  {
    title: "Publish your fee, then stop defending it",
    body: "Put the callout fee and the crediting rule in writing. Businesses that hide it get the question forty times a week; businesses that publish it get better-qualified calls.",
  },
  {
    title: "Write the safety scripts before you publish",
    body: "Gas, live electrical, water over electrics, carbon monoxide. Write the exact words, put them in a source, and test them in the draft agent before it ever reaches a customer.",
  },
];

const cautions = [
  {
    title: "Safety questions are not sales questions",
    body: "If somebody types that they can smell gas, the only acceptable reply routes them out of the building and to the emergency number — not into a lead form. Write that script yourself and test it; do not assume a general-purpose model will improvise it correctly.",
  },
  {
    title: "A quoted number becomes a promise",
    body: "Customers screenshot chats. Publish ranges, always attach the survey caveat, and instruct the agent to refuse a firm figure for anything unseen. Test it by trying hard to make it quote you a price.",
  },
  {
    title: "Do not let it commit your engineers",
    body: "Garuda has no view of your schedule, so it cannot know whether anyone is free. Instruct it to explain how emergency jobs are handled and take details, never to say when somebody will arrive.",
  },
  {
    title: "There is no photo upload today",
    body: "The lead form offers text, email, telephone, number, long text, dropdown, checkbox and date fields. There is no file or image field, so ask for a written description and collect photos on the callback.",
  },
];

export default function HomeServicesPage() {
  return (
    <PageShell
      crumbs={[{ label: "Home", href: "/" }, { label: "By industry", href: "/for" }, { label: "Home services", href: HREF }]}
      eyebrow="For roofing, plumbing and HVAC"
      title="Qualify the job before the phone rings"
      lede="A website agent that knows which postcodes you cover, what your callout fee is and which brands you service — and that hands you an enquiry sorted by urgency instead of a voicemail saying “please call me back”. It will not quote a price for work nobody has looked at, and it should not: that is the whole point."
      facts={["Answers only from sources you add", "Publishes to the domains you approve", "$17/month"]}
      cta={{ label: "Build an agent for your trade", href: "/auth/sign-up" }}
    >
      <Section
        id="problem"
        eyebrow="The problem"
        title="Speed wins the job, but only if the job is worth having"
        lede="Home services is the clearest case of first-response advantage there is, and also the easiest place to waste an evening answering enquiries that were never yours."
      >
        <PointGrid points={problems} />
      </Section>

      <Section
        id="boundary"
        tone="muted"
        eyebrow="The boundary"
        title="What it should answer, and what it must never say"
        lede="Draw this line before you publish. Everything on the left is a fact you have already published somewhere; everything on the right is a commitment only a person on site can make."
      >
        <DoesRefuses
          doesTitle="Answer freely, from your sources"
          does={answersFreely}
          refusesTitle="Never say, in any wording"
          refuses={neverSays}
        />
      </Section>

      <Section
        id="questions"
        eyebrow="What visitors ask"
        title="The eight questions a trade website gets over and over"
        lede="Answer the first seven from documents you already own. The eighth is the one that has to be scripted by hand."
      >
        <QuestionList items={questions} />
      </Section>

      <Section
        id="knowledge"
        tone="muted"
        eyebrow="What to give it"
        title="Five sources, arranged for a trade"
        lede="Each agent gets five knowledge sources on the $17 plan. A source can hold up to 100,000 characters, but only the first 12,000 of each is passed to the model with a reply — so lead with the answers and keep the small print below them."
      >
        <KnowledgeSources sources={sources} />
      </Section>

      <Section
        id="lead"
        eyebrow="What you get back"
        title="An enquiry you can put in a running order"
        lede="Build the form from up to twenty fields. Contact details are stored only after the visitor explicitly agrees, and the record is kept beside the conversation that produced it."
      >
        <LeadRecord
          heading="Captured lead · illustrative example"
          fields={leadFields}
          consentLine="Consent recorded with the capture. Garuda refuses to store contact details without it."
          note="An invented example. Notice what it is optimised for: at seven in the morning you should be able to sort the overnight list by area and urgency and start dialling, without opening a single transcript."
        />
      </Section>

      <Section
        id="safety"
        tone="muted"
        eyebrow="Do this first"
        title="Gas, water and electricity: the script you write before you publish"
        lede="This is the part of a home services agent that has nothing to do with marketing. A general-purpose model asked about a gas smell will produce something plausible. Plausible is not good enough, so write the words yourself."
      >
        <InstructionSnippet
          label="Paste into the agent instructions"
          lines={[
            "If a visitor mentions gas, a gas smell, carbon monoxide, a burning electrical smell, sparking, or water reaching electrics: do not troubleshoot, do not ask qualifying questions, and do not offer the lead form.",
            "Reply only with the emergency script from the safety source: leave the property, do not use switches or phones inside, and call the emergency number listed there.",
            "Never estimate a price, an arrival time or an engineer's availability. Explain the emergency policy and offer to take contact details for a callback.",
          ]}
        />
        <div className="mt-10">
          <StepList steps={setupSteps} />
        </div>
        <Prose className="mt-8">
          Test all of it against the draft agent before you publish. Garuda lets you talk to an agent privately while it is
          still a draft, and publishing is an explicit step you take once you are satisfied with what it says.
        </Prose>
      </Section>

      <Section
        id="cautions"
        eyebrow="Read this part"
        title="Four ways this goes wrong for a trade business"
      >
        <Cautions points={cautions} />
      </Section>

      <RelatedPages currentHref={HREF} />
    </PageShell>
  );
}
