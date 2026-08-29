import Link from "next/link";
import { NotBuiltYet } from "@/components/usecase/blocks";
import { PageShell } from "@/components/usecase/page-shell";
import { LandingList } from "@/components/usecase/related";
import { PointGrid, Prose, Section } from "@/components/usecase/sections";
import { pageMetadata } from "@/lib/seo";

const HREF = "/for";

export const metadata = pageMetadata({
  title: "Garuda by industry",
  description:
    "How a knowledge-grounded website agent is configured for real estate, home services, professional services and healthcare clinics — including what it must be told to refuse in each.",
  path: HREF,
});

const criteria = [
  {
    title: "A single enquiry is worth a lot",
    body: "A listing viewing, a boiler replacement, an engagement, a new patient. When one missed conversation is worth more than a year of the subscription, answering at 11pm stops being a nicety.",
  },
  {
    title: "The repeated questions have documented answers",
    body: "Coverage areas, fees, tenure, opening hours, accepted insurers. All of it exists in writing already, which is the only reason an agent grounded in approved sources can help at all.",
  },
  {
    title: "There is a real line it must not cross",
    body: "Price negotiation, a firm quote, professional advice, anything clinical. Each of these four pages spends as much space on the refusals as on the answers, because that is where these projects actually fail.",
  },
  {
    title: "The visitor is deciding between several providers tonight",
    body: "They are on your site and two others. Being the one that answered is a bigger factor in that decision than most businesses would like it to be.",
  },
];

export default function IndustryHubPage() {
  return (
    <PageShell
      crumbs={[{ label: "Home", href: "/" }, { label: "By industry", href: "/for" }]}
      eyebrow="By industry"
      title="Four businesses where a website answer at 11pm is worth real money"
      lede="These are not four copies of the same page. The questions differ, the knowledge differs, the useful shape of a captured lead differs, and — most of all — what the agent must be instructed to refuse differs. Pick the one closest to your business and read the refusals first."
      facts={["Written against what the product does today", "Refusals included, not just features"]}
      cta={{ label: "Build your first agent", href: "/auth/sign-up" }}
      secondary={{ label: "Browse use cases instead", href: "/use-cases" }}
    >
      <Section id="pages" eyebrow="Industry guides" title="Choose the closest fit">
        <LandingList kind="industry" />
      </Section>

      <Section
        id="why"
        tone="muted"
        eyebrow="Why these four"
        title="What they have in common"
        lede="They were chosen against four criteria rather than by market size, and the criteria are worth stating because they also tell you whether your own business belongs on this list."
      >
        <PointGrid points={criteria} />
        <div className="mt-10">
          <NotBuiltYet title="Not on this list">
            <p>
              If your industry is not here, that is not a statement about fit — it is a statement about what has been
              written up carefully. Garuda is not industry-specific: an agent is grounded in the sources you add and the
              instructions you write, whatever business you run.
            </p>
            <p>
              The two <Link href="/use-cases" className="font-semibold text-indigo-700 underline underline-offset-2 hover:text-indigo-900">use-case guides</Link>{" "}
              are written to be industry-neutral, and are the better starting point if none of the four above is close.
            </p>
          </NotBuiltYet>
        </div>
      </Section>

      <Section id="how" eyebrow="The same underneath" title="What every one of these pages assumes">
        <Prose>
          The product is the same in all four cases. You answer four questions about your business, Garuda drafts an agent,
          and you edit it before anything goes live. You add the knowledge it answers from as text you approve. You publish
          it explicitly, to the domains you list, and it appears on your site through one embed snippet, isolated inside a
          Shadow DOM. Contact details are collected only after a visitor explicitly agrees, and each lead is stored with the
          conversation that produced it.
        </Prose>
        <Prose className="mt-5">
          What changes between industries is everything you decide: the sources, the wording, the shape of the form, and
          the list of things the agent is told never to say.
        </Prose>
      </Section>
    </PageShell>
  );
}
