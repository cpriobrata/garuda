import { Cautions, DoesRefuses, InstructionSnippet } from "@/components/usecase/blocks";
import { PageShell } from "@/components/usecase/page-shell";
import { RelatedPages } from "@/components/usecase/related";
import { PointGrid, Prose, Section, StepList } from "@/components/usecase/sections";
import { pageMetadata } from "@/lib/seo";

const HREF = "/use-cases/repeat-questions";

export const metadata = pageMetadata({
  title: "Stop retyping the same answers on your website",
  description:
    "How a small team turns its twenty most repeated replies into a knowledge-grounded website agent: finding the real questions, writing sources that survive, and keeping them correct.",
  path: HREF,
});

const problems = [
  {
    title: "The answers already exist — in eleven different inboxes",
    body: "Every repeat question has been answered well at least once, usually by whoever was quickest to reply. That answer is now buried in a sent folder where nobody else can find it.",
  },
  {
    title: "Each retype is slightly different, and slowly worse",
    body: "The twentieth version of an answer drifts. Prices go stale, caveats fall off, and two people give a customer two different figures. The cost is not the minutes; it is the inconsistency.",
  },
  {
    title: "It falls hardest on the person who knows the most",
    body: "In a small team, repetitive questions route to whoever can answer them fastest — which is the person whose time is most valuable. That is a bad allocation and everybody knows it.",
  },
  {
    title: "Visitors do not read the FAQ page",
    body: "They read the page they landed on, and ask. Answering in the place where the question occurs is a different thing from having published the answer somewhere on the site.",
  },
];

const findSteps = [
  {
    title: "Search your sent mail, not your memory",
    body: "Search your own outbox for the phrases you are sure you have typed too often — “our lead time is”, “we do cover”, “the price includes”. What comes back is the real list, and it is rarely the list you would have guessed.",
  },
  {
    title: "Ask the person who answers the phone",
    body: "They can give you the top ten in about ninety seconds, in the exact words customers use. Write down the customer phrasing, not the internal phrasing — it is what people will type.",
  },
  {
    title: "Then read your own conversations",
    body: "Once the agent is live, the workspace keeps every conversation. Reading a week of transcripts tells you which answers are missing and which questions you never anticipated, which is the loop that makes the second version much better than the first.",
  },
];

const mechanics = [
  {
    title: "Five sources per agent",
    body: "The $17 plan allows five knowledge sources on each agent. That constraint is genuinely useful: it forces you to group by topic rather than dumping one document per source, and topics are what visitors ask about.",
  },
  {
    title: "100,000 characters stored, 12,000 supplied",
    body: "A single source can hold up to 100,000 characters, but only the first 12,000 of it is passed to the model with any given reply. Lead with the answer and leave the small print underneath — do not bury the price on page nine.",
  },
  {
    title: "About 40,000 characters, all in",
    body: "Sources are added to the prompt in order until it reaches roughly 40,000 characters, then it stops. If you have five very long sources, the last one may not reach the model at all. Order them so the most-asked topic is first.",
  },
  {
    title: "The recent conversation comes too",
    body: "The last thirty messages of the conversation go to the model alongside your sources, so follow-up questions work without the visitor repeating themselves. Individual visitor messages are capped at 4,000 characters.",
  },
];

const belongs = [
  "The actual answer, in the first two sentences, in the words customers use",
  "Real numbers: prices, lead times, dimensions, coverage, thresholds",
  "The conditions and exceptions that make the answer true",
  "The date you last checked it, written into the text",
  "What to do next, and who to ask when the agent cannot help",
  "Your own wording for anything a regulator, insurer or contract requires you to say",
];

const doesNotBelong = [
  "Anything you would not publish on a public web page",
  "Internal margins, supplier costs, discount ceilings or negotiating positions",
  "Personal data about customers, staff or anybody else",
  "Figures that change more often than you are willing to edit them",
  "Marketing copy with no facts in it — it dilutes the source and the answers",
  "Credentials, keys or internal links of any kind",
];

const testSteps = [
  {
    title: "Talk to the draft first",
    body: "You can chat with an agent privately while it is still a draft, before any visitor can reach it. Ask it your real repeat questions in the phrasing customers actually use, not the phrasing you wrote the source in.",
  },
  {
    title: "Try to make it wrong",
    body: "Ask about something you deliberately did not include. A well-instructed agent says it does not know and offers a person; a badly instructed one invents a plausible answer. Better to find that out now.",
  },
  {
    title: "Publish deliberately",
    body: "Publishing is an explicit step, and it requires at least one approved domain. Nothing reaches a visitor because a draft looked finished.",
  },
];

const cautions = [
  {
    title: "A stale source is repeated with total confidence",
    body: "The agent has no way to know your price changed in March. It answers from the text you gave it. Put a “last checked” line inside each source and set a recurring reminder to edit them — this is the single largest failure mode of this whole approach.",
  },
  {
    title: "Leaving the instructions blank is not a policy",
    body: "If an agent has no instructions, it falls back to a built-in line telling it to be concise and never invent missing business facts. That is a floor. The behaviour you actually want — what it declines, when it offers a person, what tone it takes — has to be written.",
  },
  {
    title: "Sources are read on every reply",
    body: "Everything in a source is available to the model each time it answers, which means anything in there can surface in an answer. That is the reason the right-hand list above exists, and it is worth re-reading a source with that in mind before you paste it.",
  },
  {
    title: "Garuda does not fetch your pages for you",
    body: "You can record a source URL for your own reference, but the text is not crawled from it. Paste the wording you want used. It is more work once, and it is the only way to be certain the agent is quoting something you approved.",
  },
];

export default function RepeatQuestionsPage() {
  return (
    <PageShell
      crumbs={[{ label: "Home", href: "/" }, { label: "Use cases", href: "/use-cases" }, { label: "Answering repeat questions", href: HREF }]}
      eyebrow="Use case"
      title="Write the answer once. Stop typing it every week."
      lede="Small teams answer the same twenty questions forever, slightly differently each time, and always by the person who can least afford the interruption. This page is about turning those answers into knowledge sources an agent can use — including the parts of how that works that most product pages leave out."
      facts={["Five knowledge sources per agent", "Sources you approve, not pages we crawl", "$17/month"]}
      cta={{ label: "Turn your answers into an agent", href: "/auth/sign-up" }}
    >
      <Section
        id="problem"
        eyebrow="The problem"
        title="Repetition is not the real cost. Drift is."
        lede="If it were only about time, an FAQ page would have solved it a decade ago. The reason it keeps coming back is that the answers live in people, and people give slightly different versions."
      >
        <PointGrid points={problems} />
      </Section>

      <Section
        id="find"
        tone="muted"
        eyebrow="Step one"
        title="Find the questions you actually get"
        lede="Not the questions you wish you got, and not the ones on your competitor’s FAQ page. There is a reliable way to find the real list, and it takes about an hour."
      >
        <StepList steps={findSteps} />
      </Section>

      <Section
        id="mechanics"
        eyebrow="How it really works"
        title="What reaches the model, and what does not"
        lede="Most pages describing this feature stop at “add your knowledge”. The specifics matter, because they change how you should write a source."
      >
        <PointGrid points={mechanics} />
        <Prose className="mt-8">
          Every source that processed successfully is supplied to the model as reference data, explicitly marked as
          reference rather than as instructions. Where semantic retrieval is configured for the workspace, the closest
          passages from your sources are supplied alongside. Either way, the answer comes from material you approved and
          nothing else was added on your behalf.
        </Prose>
      </Section>

      <Section
        id="write"
        tone="muted"
        eyebrow="Step two"
        title="Write a source that survives contact with a real question"
        lede="A knowledge source is not a brochure and not a document dump. It is the answer, with the numbers in it, written the way you would say it to a customer who asked."
      >
        <DoesRefuses
          doesTitle="Belongs in a source"
          does={belongs}
          refusesTitle="Keep it out"
          refuses={doesNotBelong}
        />
        <div className="mt-10">
          <InstructionSnippet
            label="Paste into the agent instructions"
            lines={[
              "Answer only from the knowledge sources provided. If the answer is not there, say so plainly and offer to have a person follow up.",
              "Quote figures exactly as written in the sources, including any conditions attached to them. Never estimate, average or round a number.",
              "If a source gives a date it was last checked and the question is about a price or availability, mention that date.",
            ]}
          />
        </div>
      </Section>

      <Section
        id="test"
        eyebrow="Step three"
        title="Test it before a customer does"
        lede="The gap between a source you are proud of and an agent that answers well is one afternoon of asking it awkward questions."
      >
        <StepList steps={testSteps} />
        <Prose className="mt-8">
          One workspace can run up to ten published agents, so a team with several distinct audiences can keep them apart —
          a support agent grounded in policies and a sales agent grounded in pricing will each answer better than one agent
          carrying both.
        </Prose>
      </Section>

      <Section
        id="cautions"
        tone="muted"
        eyebrow="Read this part"
        title="Four ways this quietly goes wrong"
      >
        <Cautions points={cautions} />
      </Section>

      <RelatedPages currentHref={HREF} />
    </PageShell>
  );
}
