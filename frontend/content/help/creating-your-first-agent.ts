import type { HelpArticle } from "./types";

export const article: HelpArticle = {
  slug: "creating-your-first-agent",
  category: "getting-started",
  title: "Creating your first agent",
  description:
    "Answer four setup questions to get a drafted agent, or build one by hand in Agents. Either way it stays a draft until you add an allowed domain and publish it.",
  answer:
    "New workspaces get a drafted agent from a four-question setup; after that, go to Agents and choose Create an agent. Every agent starts as a draft and only serves visitors once you publish it.",
  updated: "2026-08-30",
  keywords: ["create an agent", "first agent", "agent builder", "publish an agent", "garuda setup"],
  intro: [
    {
      kind: "p",
      text: [
        "An agent is one chat assistant for one website. It holds a name, an opening greeting, the instructions it follows, the knowledge it answers from, its colours, and the website domain it is allowed to run on.",
      ],
    },
  ],
  steps: [
    {
      title: "Finish the four-question setup, if you have not already",
      body: [
        {
          kind: "p",
          text: [
            "A workspace that has not completed onboarding is sent to it automatically the first time you open the portal. Garuda asks four questions: what your business is, who your ideal customer is and what the agent should help them with, the single outcome you want from conversations, and what kind of teammate to create.",
          ],
        },
        {
          kind: "p",
          text: [
            "It then drafts an agent from those answers and shows a page headed ",
            { kind: "strong", text: "Your first agent is ready" },
            ", with a button to test it. That draft is a starting point, not a finished agent, so read the rest of these steps before you publish it.",
          ],
        },
      ],
    },
    {
      title: "Or open the builder yourself",
      body: [
        {
          kind: "p",
          text: [
            "In the workspace sidebar choose ",
            { kind: "strong", text: "Agents" },
            ", then ",
            { kind: "strong", text: "Create an agent" },
            ". The ",
            { kind: "strong", text: "New agent" },
            " button in the top bar opens the same builder.",
          ],
        },
        {
          kind: "p",
          text: [
            "The builder has five sections down the left: Identity, Goal & behavior, Knowledge, Appearance and Handoff rules. You can move between them in any order, and Save, Test and Publish stay in the top bar throughout.",
          ],
        },
      ],
    },
    {
      title: "Fill in Identity",
      body: [
        {
          kind: "ul",
          items: [
            [
              { kind: "strong", text: "Agent name" },
              " — 2 to 120 characters. It is what the widget header shows unless you set a separate display name later.",
            ],
            [
              { kind: "strong", text: "Role description" },
              " — up to 500 characters. Internal context; visitors do not see it.",
            ],
            [
              { kind: "strong", text: "Opening greeting" },
              " — the first message a visitor sees. The editor shows a 240-character guide; the server accepts up to 500.",
            ],
          ],
        },
      ],
    },
    {
      title: "Set the goal in Goal & behavior",
      body: [
        {
          kind: "p",
          text: [
            "This box holds the instructions the agent follows, up to 16,000 characters. Three templates fill it for you — ",
            { kind: "strong", text: "Sales guide" },
            ", ",
            { kind: "strong", text: "Lead qualification" },
            " and ",
            { kind: "strong", text: "Customer support" },
            " — and you can edit whatever they put there.",
          ],
        },
        {
          kind: "note",
          tone: "tip",
          title: "Instructions are not facts",
          body: [
            "Keep this box about behaviour: tone, what to do when the agent does not know something, when to offer a human. The facts belong in Knowledge, where you can change them without rewriting the instructions.",
          ],
        },
      ],
    },
    {
      title: "Add at least one knowledge source",
      body: [
        {
          kind: "p",
          text: [
            "Open ",
            { kind: "strong", text: "Knowledge" },
            " and paste in the text your agent should answer from. An agent with no knowledge can still be published, but it has nothing of yours to answer with. See ",
            {
              kind: "link",
              text: "Adding knowledge your agent can answer from",
              href: "/help/adding-knowledge-your-agent-can-answer-from",
            },
            ".",
          ],
        },
      ],
    },
    {
      title: "Approve the domain in Appearance",
      body: [
        {
          kind: "p",
          text: [
            "The ",
            { kind: "strong", text: "Allowed website domain" },
            " field at the bottom of Appearance is required before you can publish. Type the hostname on its own — ",
            { kind: "code", text: "yourcompany.com" },
            ", not a full URL. The same section holds the header colour, accent colour, launcher text and widget position.",
          ],
        },
      ],
    },
    {
      title: "Test the draft",
      body: [
        {
          kind: "p",
          text: [
            { kind: "strong", text: "Test" },
            " saves the draft and then asks the agent a sample question, showing the reply in the preview on the right. An agent detail page also has a ",
            { kind: "strong", text: "Conversation playground" },
            " where you can type your own questions. Both are private previews and neither appears in Conversations.",
          ],
        },
      ],
    },
    {
      title: "Publish",
      body: [
        {
          kind: "p",
          text: [
            { kind: "strong", text: "Publish agent" },
            " saves the draft and then puts it on the air. The badge in the top bar changes from Draft to Live, and the install snippet becomes available under Widget. On an agent that is already live the same button reads ",
            { kind: "strong", text: "Publish updates" },
            ".",
          ],
        },
        {
          kind: "note",
          tone: "note",
          title: "Edits to a published agent apply straight away",
          body: [
            "The widget reads the agent record as it currently stands, so a saved change reaches visitors on their next page load. You only need to publish again if the agent has been put back into Draft.",
          ],
        },
      ],
    },
  ],
  after: [
    {
      kind: "note",
      tone: "caution",
      title: "Handoff rules are not built yet",
      body: [
        "The fifth builder section says so itself. Garuda stores conversations and captured leads, but there are no team notifications, no assignment rules and no live takeover. If you want a person to follow up, say so in the instructions and watch Conversations and Leads.",
      ],
    },
  ],
  stuck: [
    {
      problem: "Publish says an allowed domain is needed",
      body: [
        {
          kind: "p",
          text: [
            "The builder jumps to Appearance and marks the field. Fill in the hostname and publish again. Garuda refuses to publish an agent with no approved domain, because the widget would then have no origin it was allowed to run on.",
          ],
        },
      ],
    },
    {
      problem: "A field is rejected when you save",
      body: [
        {
          kind: "p",
          text: [
            "The message appears under the field it belongs to, and the builder switches to that section for you. Anything the builder has no input for is listed in a red block above the section instead.",
          ],
        },
      ],
    },
    {
      problem: "Publishing says the agent limit is reached",
      body: [
        {
          kind: "p",
          text: [
            "The plan allows 10 published agents at a time. Pause one you are not using and try again — see ",
            {
              kind: "link",
              text: "Pausing or unpublishing an agent",
              href: "/help/pausing-or-unpublishing-an-agent",
            },
            ".",
          ],
        },
      ],
    },
    {
      problem: "Publishing says a subscription is required",
      body: [
        {
          kind: "p",
          text: [
            "Publishing, previewing and adding knowledge all need an active subscription. Open ",
            { kind: "strong", text: "Billing" },
            " in the sidebar and check the subscription state there.",
          ],
        },
      ],
    },
  ],
  related: [
    "adding-knowledge-your-agent-can-answer-from",
    "installing-the-widget-on-your-website",
    "approving-the-domains-your-agent-may-run-on",
  ],
};
