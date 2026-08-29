import { NotBuiltYet } from "@/components/usecase/blocks";
import { PageShell } from "@/components/usecase/page-shell";
import { LandingList } from "@/components/usecase/related";
import { Prose, Section, StepList } from "@/components/usecase/sections";
import { pageMetadata } from "@/lib/seo";

const HREF = "/use-cases";

export const metadata = pageMetadata({
  title: "Garuda use cases",
  description:
    "Two jobs a knowledge-grounded website agent does well: capturing enquiries after hours, and answering the repeat questions a small team is tired of retyping.",
  path: HREF,
});

const shared = [
  {
    title: "Give it knowledge you approved",
    body: "Sources are text you paste and can edit at any time. Nothing is crawled from your site on your behalf, so the agent quotes material you chose.",
  },
  {
    title: "Write what it should refuse",
    body: "The instructions matter more than the knowledge. What it declines, when it offers a person, and how it behaves when it does not know are all things you write.",
  },
  {
    title: "Test the draft, then publish",
    body: "You can talk to an agent privately before anyone else can. Publishing is a separate, deliberate step that needs at least one approved domain.",
  },
];

export default function UseCasesHubPage() {
  return (
    <PageShell
      crumbs={[{ label: "Home", href: "/" }, { label: "Use cases", href: "/use-cases" }]}
      eyebrow="Use cases"
      title="Two jobs worth doing properly"
      lede="Both of these are ordinary. That is the point: they are the two things a website agent genuinely does well today, written up with the configuration detail and the limitations included rather than a list of adjectives."
      facts={["Industry-neutral", "Written against the product as it is"]}
      cta={{ label: "Build your first agent", href: "/auth/sign-up" }}
      secondary={{ label: "Browse by industry instead", href: "/for" }}
    >
      <Section id="pages" eyebrow="Guides" title="Pick the job in front of you">
        <LandingList kind="use-case" />
      </Section>

      <Section
        id="shared"
        tone="muted"
        eyebrow="Either way"
        title="Three things both of them depend on"
        lede="Whichever job you start with, the same three decisions determine whether the result is useful or embarrassing."
      >
        <StepList steps={shared} />
        <div className="mt-10">
          <NotBuiltYet title="What neither of them does">
            <p>
              An agent answers, and captures a lead with the visitor’s explicit consent. It does not book the
              appointment itself — the agent cannot yet take actions inside a connected tool. A captured lead can be
              sent to your own systems over a signed webhook, so it reaches Zapier, Make, or your CRM without anyone
              opening the workspace.
            </p>
            <p>
              You can connect your own third-party accounts through Composio, which covers Google Calendar, Slack, HubSpot,
              Salesforce, HighLevel and well over a thousand other tools. Today that is account linking: the agent does not
              yet take actions in those tools during a conversation.
            </p>
          </NotBuiltYet>
        </div>
      </Section>

      <Section id="industry" eyebrow="Also" title="Or start from your industry">
        <Prose>
          If your business is property, a trade, a professional practice or a clinic, the industry guides go further: the
          questions those visitors really ask, how to arrange the five knowledge sources, what a good captured lead looks
          like, and the specific things each kind of business must instruct an agent never to say.
        </Prose>
        <div className="mt-8">
          <LandingList kind="industry" />
        </div>
      </Section>
    </PageShell>
  );
}
