import type { HelpArticle } from "./types";

export const article: HelpArticle = {
  slug: "pausing-or-unpublishing-an-agent",
  category: "operating",
  title: "Pausing or unpublishing an agent",
  description:
    "Pause takes a published agent off the air from its detail page and keeps every setting; resuming is one click back. Unpublishing to Draft has no button in the portal yet.",
  answer:
    "Open the agent from Agents and choose Pause agent. The widget stops serving immediately, every setting is kept, and Resume agent puts it back.",
  updated: "2026-08-30",
  keywords: [
    "pause an agent",
    "turn off the chatbot",
    "unpublish",
    "stop the widget",
    "resume agent",
  ],
  intro: [
    {
      kind: "p",
      text: [
        "Pausing is the right tool for taking the chat down for a while: a holiday shutdown, a pricing change you have not written up yet, a site migration. It changes nothing except whether visitors can reach the agent.",
      ],
    },
  ],
  steps: [
    {
      title: "Open the agent",
      body: [
        {
          kind: "p",
          text: [
            { kind: "strong", text: "Agents" },
            " in the sidebar, then the agent's card. The buttons are at the top right of its page.",
          ],
        },
      ],
    },
    {
      title: "Choose Pause agent",
      body: [
        {
          kind: "p",
          text: [
            "The status badge changes to ",
            { kind: "strong", text: "paused" },
            " and a line underneath says the widget is not serving this agent and its configuration is kept. The change is immediate: the widget stops answering on the next request it makes.",
          ],
        },
        {
          kind: "note",
          tone: "note",
          title: "What a visitor sees",
          body: [
            "The launcher script still runs, but the panel reports that the assistant is unavailable rather than opening a conversation. If you would rather nothing appeared at all, remove the snippet from your pages instead.",
          ],
        },
      ],
    },
    {
      title: "Resume when you are ready",
      body: [
        {
          kind: "p",
          text: [
            "The same button now reads ",
            { kind: "strong", text: "Resume agent" },
            ". Nothing was lost while it slept: the public key in your snippet, the published date, the instructions, the branding and the knowledge sources are all exactly as they were, so the widget picks up where it stopped.",
          ],
        },
      ],
    },
    {
      title: "Edit while it is paused, if you want to",
      body: [
        {
          kind: "p",
          text: [
            "A paused agent is still listed, still readable and still editable. Resuming re-checks the same rules publishing applies, because the configuration may have changed while it was off the air.",
          ],
        },
      ],
    },
  ],
  after: [
    {
      kind: "table",
      caption: "How the three agent states differ",
      columns: ["State", "Serves visitors", "Counts against the 10 published agents", "Still in the portal"],
      rows: [
        { header: "Published", cells: [["Yes"], ["Yes"], ["Yes"]] },
        { header: "Paused", cells: [["No"], ["No"], ["Yes, fully editable"]] },
        { header: "Draft", cells: [["No"], ["No"], ["Yes, fully editable"]] },
      ],
    },
    {
      kind: "note",
      tone: "caution",
      title: "Unpublishing back to Draft has no button yet",
      body: [
        "The API can move a published agent back to Draft, but nothing in the portal calls it. Pause is the control that exists, and for taking an agent off the air it does the same job while keeping the slot free. If you specifically need the agent back in Draft, email info@ravan.ai.",
      ],
    },
    {
      kind: "note",
      tone: "caution",
      title: "There is no delete either",
      body: [
        "Archiving an agent exists in the API and hides it from every agent route, but the portal has no control for it. Pausing is what you have; conversations and leads already captured are unaffected either way.",
      ],
    },
  ],
  stuck: [
    {
      problem: "The pause button is disabled",
      body: [
        {
          kind: "p",
          text: [
            "Hover it and the tooltip explains why. Only a published agent can be paused; a draft was never serving anyone, so there is nothing to take down.",
          ],
        },
      ],
    },
    {
      problem: "Resuming says a subscription is required",
      body: [
        {
          kind: "p",
          text: [
            "Resuming puts the agent back in front of visitors, which needs an active subscription — the same check publishing makes. Pausing deliberately makes no such check: you can always stop your agent. Open Billing.",
          ],
        },
      ],
    },
    {
      problem: "Resuming says the published agent limit is reached",
      body: [
        {
          kind: "p",
          text: [
            "A paused agent frees its slot, so something else may have taken it while this one slept. Pause an agent you are not using, then resume this one.",
          ],
        },
      ],
    },
    {
      problem: "Resuming is rejected over a field",
      body: [
        {
          kind: "p",
          text: [
            "The agent was edited while it was paused and no longer passes the publishing checks — most often the allowed domain was cleared. Fix the named field in the editor and resume again.",
          ],
        },
      ],
    },
    {
      problem: "The launcher is still on your site after you paused it",
      body: [
        {
          kind: "p",
          text: [
            "That is the snippet, which is still in your pages and still runs. What stops is the answering: the agent status is checked on every widget request, including each message, so a conversation already open cannot send another one. If you want nothing at all to appear, take the snippet out of your pages as well.",
          ],
        },
      ],
    },
  ],
  related: [
    "creating-your-first-agent",
    "my-widget-is-not-showing-up",
    "reading-conversations-and-leads",
  ],
};
