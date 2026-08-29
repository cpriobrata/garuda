import type { Metadata } from "next";
import Link from "next/link";
import { AnswerSection, FactTable, SeoPageShell } from "@/components/site/seo-page-shell";
import { faqPageJsonLd, pageMetadata } from "@/lib/seo";

const PATH = "/integrations";
const REVIEWED = "30 August 2026";

/** Checked against the live Composio catalogue on the review date above. */
const TOOLKIT_COUNT = "1,431";

export const metadata: Metadata = pageMetadata({
  title: "Integrations",
  description:
    "Garuda customers connect their own third-party accounts through Composio — Google Calendar, Slack, HubSpot, Salesforce, Highlevel and 1,431 products in total. Here is how connecting works, and what is not built yet.",
  path: PATH,
  socialTitle: "Garuda integrations — connect your own accounts",
});

/** Every row verified against the live Composio catalogue on the review date. */
const exampleToolkits = [
  { name: "Google Calendar", categories: "Scheduling & Booking", actions: 45 },
  { name: "Slack", categories: "Team Chat, Team Collaboration", actions: 158 },
  { name: "HubSpot", categories: "CRM, Marketing Automation", actions: 244 },
  { name: "Salesforce", categories: "CRM, Contact Management", actions: 184 },
  { name: "Highlevel", categories: "Marketing Automation, CRM", actions: 218 },
  { name: "Zendesk", categories: "CRM, Customer Support", actions: 451 },
  { name: "Mailchimp", categories: "Email Newsletters, Marketing Automation", actions: 272 },
  { name: "Shopify", categories: "eCommerce", actions: 315 },
  { name: "Notion", categories: "Notes, Documents, Project Management", actions: 53 },
  { name: "Calendly", categories: "Scheduling & Booking, Calendar", actions: 52 },
];

/** Category names as the live catalogue spells them. */
const categoryRows = [
  ["CRM", "HubSpot, Salesforce, Zendesk, Highlevel"],
  ["Scheduling & Booking", "Google Calendar, Calendly"],
  ["Team Chat & Collaboration", "Slack"],
  ["Marketing Automation", "HubSpot, Mailchimp, Highlevel"],
  ["Email Newsletters", "Mailchimp"],
  ["Customer Support", "Zendesk"],
  ["eCommerce", "Shopify"],
  ["Notes, Documents & Project Management", "Notion"],
];

const answers = [
  {
    id: "what-can-i-connect",
    question: "What can Garuda connect to?",
    answer: `Garuda connects to third-party tools through Composio, an integration broker whose catalogue held ${TOOLKIT_COUNT} connectable products when this page was last checked on ${REVIEWED}. Google Calendar, Slack, HubSpot, Salesforce and Highlevel are all in it, alongside roughly 1,400 others.`,
    body: (
      <>
        <p>
          These are examples, not the whole catalogue. The &ldquo;actions&rdquo; column is the number of operations Composio
          publishes for that product, counted from its live API on {REVIEWED}.
        </p>
        <FactTable
          caption="Example connectable products, their catalogue categories and published action counts"
          head={["Product", "Listed under", "Actions in the catalogue"]}
          rows={exampleToolkits.map((toolkit) => [toolkit.name, toolkit.categories, `${toolkit.actions}`])}
        />
      </>
    ),
  },
  {
    id: "whose-account",
    question: "Whose account does an integration use — mine or Garuda's?",
    answer:
      "Yours. Every customer connects their own third-party account: you authorise the provider yourself, and the connection is stored against your Garuda account id, so one customer's connection can never be reached through another's. Garuda does not operate a shared account on your behalf.",
    body: (
      <p>
        The tokens for a connected account are held and refreshed by Composio against your account id. No third-party refresh
        token is stored in Garuda&rsquo;s own data. When a connection is removed, Garuda first re-reads the list of connections
        that belong to your account and refuses the request if the connection is not one of yours — a connection belonging to
        someone else is reported as simply not found.
      </p>
    ),
  },
  {
    id: "how-to-connect",
    question: "How do I connect a tool?",
    answer:
      "Open Integrations in your Garuda workspace, search the catalogue, choose a product and select Connect. Garuda asks Composio for an authorisation link, you sign in with the provider and approve the access, and you come back to a workspace that lists the connection. Disconnecting is one action in the same place.",
    body: (
      <>
        <ol className="list-decimal space-y-2 pl-5">
          <li>Search or browse the catalogue, which is paged rather than loaded whole — it is far too large for one screen.</li>
          <li>Select Connect on the product you want. Garuda requests an authorisation link scoped to your account id.</li>
          <li>Authorise with the provider itself. Most products in the catalogue use OAuth, so you never hand Garuda a password.</li>
          <li>The connection appears in your workspace, and only in your workspace.</li>
        </ol>
        <p>
          Connecting requires an active subscription: a workspace without one gets a &ldquo;subscription required&rdquo; response
          rather than an authorisation link. Integrations do not cost anything beyond the{" "}
          <Link href="/#pricing" className="font-medium text-indigo-700 underline underline-offset-4">
            $17 monthly plan
          </Link>
          , though the third-party services you connect have their own pricing.
        </p>
      </>
    ),
  },
  {
    id: "categories",
    question: "What kinds of tools are in the catalogue?",
    answer:
      "The catalogue is grouped into categories such as CRM, Scheduling & Booking, Team Chat, Marketing Automation, Email Newsletters, Customer Support, eCommerce and project management. Garuda reads those groupings straight from Composio, so the list grows as the catalogue does.",
    body: (
      <FactTable
        caption="Catalogue categories relevant to a website sales agent, with example products"
        head={["Category", "Examples in the catalogue"]}
        rows={categoryRows}
      />
    ),
  },
  {
    id: "not-built-yet",
    question: "Can my agent use a connected tool during a conversation?",
    answer:
      "Not yet, and it is worth being blunt about it. What exists today is connection management: browse the catalogue, connect your own account, see what is connected, disconnect it. Garuda's chat agents do not yet call those tools mid-conversation — no calendar is booked and no CRM record is written from inside a chat.",
    body: (
      <>
        <p>Stated as a table, so there is no room for misreading:</p>
        <FactTable
          caption="What the integrations surface does and does not do today"
          head={["Capability", "Status today"]}
          rows={[
            ["Browse the catalogue of connectable products", "Available"],
            ["Connect your own account through the provider", "Available"],
            ["See and remove your workspace's connections", "Available"],
            ["An agent calling a connected tool during a chat", "Not built yet"],
            ["Per-agent connections", "Not built yet — connections belong to the workspace"],
          ]}
        />
      </>
    ),
  },
  {
    id: "composio-role",
    question: "What exactly does Composio do in this?",
    answer:
      "Composio is the integration broker. It publishes the catalogue, runs the authorisation flow with each provider, and stores and refreshes the resulting tokens against the account id Garuda supplies. Garuda registers nothing per integration and holds no provider credentials of its own.",
    body: (
      <p>
        The reason Garuda uses a broker rather than writing one adapter per product is simple arithmetic: a catalogue of{" "}
        {TOOLKIT_COUNT} products is not something a small team converges on one integration at a time. The trade-off is equally
        plain — connected accounts live with Composio, which is a third party in your data path for anything you connect.
      </p>
    ),
  },
];

export default function IntegrationsPage() {
  return (
    <SeoPageShell
      eyebrow="Integrations"
      title="Connect your own tools, with your own accounts"
      summary={`Garuda customers connect their own third-party accounts through Composio, whose catalogue held ${TOOLKIT_COUNT} connectable products when this page was last checked. You authorise each provider yourself and the connection belongs to your workspace alone. Today that surface is connection management — agents do not yet call these tools during a conversation.`}
      breadcrumb={{ name: "Integrations", path: "/integrations" }}
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
