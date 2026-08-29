import type { HelpArticle } from "./types";

export const article: HelpArticle = {
  slug: "reading-conversations-and-leads",
  category: "operating",
  title: "Reading conversations and leads",
  description:
    "Conversations holds every stored transcript with its page metadata; Leads holds the contacts captured with consent. Both screens are read-only: you cannot type a reply into a visitor's chat from here.",
  answer:
    "Conversations shows every stored transcript with the page it happened on; Leads shows the contacts captured with consent. Both are read-only, so you read them here and reach people elsewhere.",
  updated: "2026-08-30",
  keywords: [
    "conversation inbox",
    "read transcripts",
    "leads table",
    "lead details",
    "chat history",
    "reply to a visitor",
  ],
  intro: [
    {
      kind: "p",
      text: [
        "These two screens are where the work of the widget shows up. Nothing in either of them estimates, scores or predicts anything: they show what was actually stored.",
      ],
    },
  ],
  steps: [
    {
      title: "Start at Overview for the totals",
      body: [
        {
          kind: "p",
          text: [
            "The first screen in the sidebar has four counters — Agents (with how many are published), Conversations, Messages, and Leads (with the conversion rate) — plus a daily conversation chart, the five most recent conversations and your agents. Every number comes from the server; none is an estimate.",
          ],
        },
        {
          kind: "note",
          tone: "note",
          title: "Workspace insights are not built",
          body: [
            "The dark panel on Overview says so. There are no trend recommendations, no intent analysis and no per-agent performance scores in this release. Agent pages say the same thing.",
          ],
        },
      ],
    },
    {
      title: "Open Conversations",
      body: [
        {
          kind: "p",
          text: [
            "The list on the left is every stored conversation, newest first. The search box above it filters the list you already have by visitor name and message text. Selecting a row loads the transcript in the middle.",
          ],
        },
        {
          kind: "p",
          text: [
            "A conversation is labelled ",
            { kind: "strong", text: "Lead captured" },
            " when it produced a lead, and ",
            { kind: "strong", text: "AI active" },
            " otherwise. Where no lead was captured there is no name to show, so the row reads Anonymous visitor.",
          ],
        },
      ],
    },
    {
      title: "Read the transcript and its context",
      body: [
        {
          kind: "p",
          text: [
            "The middle column shows the messages in order, with the visitor on the right and the agent on the left, and the conversation start time at the top. The right-hand column carries the rest:",
          ],
        },
        {
          kind: "ul",
          items: [
            [
              { kind: "strong", text: "Captured lead" },
              " — the email, phone and company on the lead, if one was captured, or a line saying none was.",
            ],
            [
              { kind: "strong", text: "Page metadata" },
              " — the origin the widget ran on, the page title, and the visitor's locale.",
            ],
          ],
        },
        {
          kind: "p",
          text: [
            "A message badged ",
            { kind: "strong", text: "Team" },
            " is one Garuda recorded rather than one either side typed. The one you will actually see is ",
            { kind: "strong", text: "The visitor asked to continue with a person on WhatsApp" },
            ", written once when somebody used the handoff button, so a thread that moved to WhatsApp does not look like a visitor who simply stopped replying.",
          ],
        },
        {
          kind: "note",
          tone: "tip",
          title: "Conversations can be linked to directly",
          body: [
            "Adding ?id= and a conversation id to the Conversations URL opens that thread. The links from Overview use exactly that.",
          ],
        },
      ],
    },
    {
      title: "Open Leads",
      body: [
        {
          kind: "p",
          text: [
            "Three tiles at the top — captured leads, lead conversion and conversations — then a table of every lead, newest first. The search box matches name, email and company; the pills beside it filter by status: All, New, Qualified, Contacted and Customer.",
          ],
        },
      ],
    },
    {
      title: "Open a lead",
      body: [
        {
          kind: "p",
          text: [
            "Selecting a row opens a panel with the email, phone, company and source. ",
            { kind: "code", text: "widget" },
            " means the visitor consented in a conversation; ",
            { kind: "code", text: "manual" },
            " means somebody on your team typed the row in, and that no consent evidence was collected in Garuda.",
          ],
        },
      ],
    },
    {
      title: "Act on it outside Garuda",
      body: [
        {
          kind: "p",
          text: [
            "Reply by email or phone yourself, export the table for your CRM, or wire up a webhook so new leads arrive in your tools automatically. See ",
            { kind: "link", text: "Exporting your leads", href: "/help/exporting-your-leads" },
            " and ",
            {
              kind: "link",
              text: "Sending leads to your CRM with a webhook",
              href: "/help/sending-leads-to-your-crm-with-a-webhook",
            },
            ".",
          ],
        },
        {
          kind: "p",
          text: [
            "To reach somebody while they are still on the site, the route is the WhatsApp handoff rather than this screen. Switch it on in the agent's Handoff rules and visitors get a button that opens a WhatsApp chat with you: see ",
            {
              kind: "link",
              text: "Handing a conversation to a person on WhatsApp",
              href: "/help/handing-a-conversation-to-a-person-on-whatsapp",
            },
            ".",
          ],
        },
      ],
    },
  ],
  after: [
    {
      kind: "note",
      tone: "tip",
      title: "You can answer a visitor yourself",
      body: [
        "Type into the reply box under the transcript and press Enter, or Shift and Enter for a new line. Your answer appears in the visitor’s widget within about twelve seconds, in the same conversation, provided their chat panel is still open — the widget checks for new messages while it is open and stops while the tab is hidden. If they have closed the panel, they will see your reply the next time they open it.",
        "Your replies are marked Team in the transcript so you can tell them apart from the agent’s own answers. The agent reads them as part of the conversation, so it will not contradict what you just said. A reply is capped at 4,000 characters.",
        "If the visitor has already left the page, the WhatsApp handoff is the way to reach them instead.",
      ],
    },
    {
      kind: "note",
      tone: "caution",
      title: "Leads is read-only too",
      body: [
        "The Leads table carries the same badge. You can add a lead by hand and export the table, but you cannot edit or re-status an existing lead from the portal.",
      ],
    },
    {
      kind: "p",
      text: [
        "Private previews — the Test button and the Conversation playground — never appear in Conversations. Only real widget traffic is stored there.",
      ],
    },
    {
      kind: "p",
      text: [
        "Both screens request up to 100 records at a time and show that first page, so a busy workspace sees its 100 most recent rows here. The CSV export covers the whole table.",
      ],
    },
  ],
  stuck: [
    {
      problem: "Conversations is empty after you installed the widget",
      body: [
        {
          kind: "p",
          text: [
            "A conversation is stored when a visitor actually opens the widget and sends something. If nobody has, there is nothing to show — and if the widget is not appearing at all, work through ",
            {
              kind: "link",
              text: "My widget is not showing up",
              href: "/help/my-widget-is-not-showing-up",
            },
            ".",
          ],
        },
      ],
    },
    {
      problem: "The transcript will not load",
      body: [
        {
          kind: "p",
          text: [
            "A red box appears with the reason. Reselect the conversation to try again; if it persists, sign out and back in, because an expired session produces the same message.",
          ],
        },
      ],
    },
    {
      problem: "A conversation has a lead but the list still says Anonymous visitor",
      body: [
        {
          kind: "p",
          text: [
            "The name shown is the name on the captured lead. A visitor who gave only an email address has no name to display, and the lead panel on the right will still show the address.",
          ],
        },
      ],
    },
    {
      problem: "New conversations have stopped appearing",
      body: [
        {
          kind: "p",
          text: [
            "The plan allows 100 conversations in any rolling 30-day window. Past that, the widget tells visitors it is unavailable and no new conversation is opened. Check Billing, and check the agent has not been paused.",
          ],
        },
      ],
    },
  ],
  related: [
    "handing-a-conversation-to-a-person-on-whatsapp",
    "exporting-your-leads",
    "pausing-or-unpublishing-an-agent",
  ],
};
