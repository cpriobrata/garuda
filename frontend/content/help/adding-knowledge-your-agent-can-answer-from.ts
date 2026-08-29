import type { HelpArticle } from "./types";

export const article: HelpArticle = {
  slug: "adding-knowledge-your-agent-can-answer-from",
  category: "getting-started",
  title: "Adding knowledge your agent can answer from",
  description:
    "Paste approved text into the Knowledge section of the agent editor. Each agent holds up to five sources of up to 100,000 characters each. Website crawling is not built.",
  answer:
    "Open the agent editor, go to Knowledge, and add a titled block of text. Each agent can hold five sources of up to 100,000 characters each, and every source is saved against the agent the moment you add it.",
  updated: "2026-08-30",
  keywords: [
    "knowledge source",
    "train the chatbot",
    "add content to an agent",
    "chatbot knowledge base",
    "garuda knowledge",
  ],
  intro: [
    {
      kind: "p",
      text: [
        "Knowledge is the material the agent answers from: your prices, your policies, your opening hours, the questions people keep asking. It is separate from the instructions, so you can correct a fact without rewriting how the agent behaves.",
      ],
    },
  ],
  steps: [
    {
      title: "Open the agent editor",
      body: [
        {
          kind: "p",
          text: [
            "Go to ",
            { kind: "strong", text: "Agents" },
            ", open the agent, then choose ",
            { kind: "strong", text: "Edit agent" },
            ". In the builder, select the ",
            { kind: "strong", text: "Knowledge" },
            " section.",
          ],
        },
      ],
    },
    {
      title: "Give the source a title",
      body: [
        {
          kind: "p",
          text: [
            "The title box under ",
            { kind: "strong", text: "Add a text knowledge source" },
            " takes 1 to 200 characters. It is for you, not for visitors: something like ",
            { kind: "code", text: "Pricing and payment terms" },
            " makes the list readable later.",
          ],
        },
      ],
    },
    {
      title: "Paste the text",
      body: [
        {
          kind: "p",
          text: [
            "The second box takes 1 to 100,000 characters. Paste plain text — the wording you would give a new member of staff. Long enough to be complete, short enough that every sentence is true.",
          ],
        },
        {
          kind: "note",
          tone: "tip",
          title: "One subject per source",
          body: [
            "Five sources is the whole allowance, so group by subject rather than by web page: pricing, delivery and returns, services, opening hours and contact, and a general company overview is a workable split.",
          ],
        },
      ],
    },
    {
      title: "Choose Add and save source",
      body: [
        {
          kind: "p",
          text: [
            "The source is written to the agent immediately — there is no separate save for it. If the agent has not been created yet, Garuda creates it first and then attaches the source.",
          ],
        },
      ],
    },
    {
      title: "Check the status badge",
      body: [
        {
          kind: "p",
          text: ["Each saved source appears as a row with its title, its character count and a status:"],
        },
        {
          kind: "table",
          caption: "What a knowledge source status means",
          columns: ["Status", "Meaning"],
          rows: [
            {
              header: "Ready",
              cells: [["The text is stored and available to the agent."]],
            },
            {
              header: "Processing",
              cells: [
                [
                  "The deployment has retrieval indexing switched on and the source is still being prepared.",
                ],
              ],
            },
            {
              header: "Failed",
              cells: [["Preparation did not complete. Remove the source and add it again."]],
            },
          ],
        },
      ],
    },
    {
      title: "Test the answer",
      body: [
        {
          kind: "p",
          text: [
            "Use ",
            { kind: "strong", text: "Test" },
            " in the builder, or the ",
            { kind: "strong", text: "Conversation playground" },
            " on the agent page, and ask the question a customer would ask. If the answer is wrong, the fix is almost always in the text you pasted rather than in the instructions.",
          ],
        },
      ],
    },
  ],
  after: [
    {
      kind: "note",
      tone: "caution",
      title: "Two things this screen does not do yet",
      body: [
        "There is no website crawler: the URL box under Website ingestion is disabled, and says so. And the builder has no button to delete a source once it is saved — the API supports removal, but no control in the portal calls it yet, so contact info@ravan.ai if you need a source taken off an agent.",
      ],
    },
  ],
  stuck: [
    {
      problem: "Add and save source is greyed out",
      body: [
        {
          kind: "p",
          text: [
            "Both the title and the text must contain something. The button also stays disabled while another action in the builder is still running.",
          ],
        },
      ],
    },
    {
      problem: "The save is rejected with a source limit message",
      body: [
        {
          kind: "p",
          text: [
            "An agent holds a maximum of five sources. Consolidate two of your existing sources into one and re-add, or use a second agent for a different part of the site.",
          ],
        },
      ],
    },
    {
      problem: "The text is refused as too long",
      body: [
        {
          kind: "p",
          text: [
            "The limit is 100,000 characters for a single source. Split the material by subject rather than pasting a whole site export into one box.",
          ],
        },
      ],
    },
    {
      problem: "The agent still answers as though the source is not there",
      body: [
        {
          kind: "p",
          text: [
            "Check the status badge is Ready, and check the wording actually contains the fact you expect. Instructions that tell the agent to answer only from approved knowledge will make it decline rather than guess — which is the intended behaviour, and the signal that the fact is missing.",
          ],
        },
      ],
    },
  ],
  related: [
    "creating-your-first-agent",
    "installing-the-widget-on-your-website",
    "reading-conversations-and-leads",
  ],
};
