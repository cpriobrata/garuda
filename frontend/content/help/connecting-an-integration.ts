import type { HelpArticle } from "./types";

export const article: HelpArticle = {
  slug: "connecting-an-integration",
  category: "configuring",
  title: "Connecting an integration such as Google Calendar or a CRM",
  description:
    "Integrations in the workspace sidebar holds a searchable catalogue of third-party apps. Choose one, sign in with the provider in its own tab, and the connection belongs to your workspace.",
  answer:
    "Open Integrations in the sidebar, search the catalogue for the app you want, and choose Connect. You sign in on the provider's own site, and the connection appears against your workspace when you come back.",
  updated: "2026-08-30",
  keywords: [
    "connect an app",
    "crm integration",
    "google calendar",
    "slack",
    "hubspot",
    "connected accounts",
  ],
  intro: [
    {
      kind: "p",
      text: [
        "You connect your own accounts. Garuda does not hold a shared company account for Slack or Google that everybody borrows: you sign in at the provider, the authorisation is stored against your workspace, and no other Garuda customer can see or use it.",
      ],
    },
    {
      kind: "p",
      text: [
        "The Integrations screen has two halves. This article covers the top one, ",
        { kind: "strong", text: "Connect your apps" },
        ". The other half, outbound webhooks, is the route for pushing captured leads into a CRM or an automation tool, and has ",
        {
          kind: "link",
          text: "its own article",
          href: "/help/sending-leads-to-your-crm-with-a-webhook",
        },
        ".",
      ],
    },
  ],
  steps: [
    {
      title: "Open Integrations",
      body: [
        {
          kind: "p",
          text: [
            "It is in the workspace sidebar, under Widget, at ",
            { kind: "code", text: "/app/integrations" },
            ". Settings, Integrations also links to it.",
          ],
        },
      ],
    },
    {
      title: "Find the app",
      body: [
        {
          kind: "p",
          text: [
            "The catalogue runs to well over a thousand products, so it arrives a page at a time rather than all at once. Type into ",
            { kind: "strong", text: "Search apps" },
            " — the results update as you stop typing — or narrow it with the ",
            { kind: "strong", text: "Category" },
            " dropdown. ",
            { kind: "strong", text: "Show more apps" },
            " at the foot of the grid fetches the next page, and the line above the grid tells you how many apps are available and how many you have connected.",
          ],
        },
      ],
    },
    {
      title: "Choose Connect",
      body: [
        {
          kind: "p",
          text: [
            "Garuda asks the provider for a sign-in link and opens it in a new tab. You authenticate and approve the access on the provider's own site — Garuda never sees or asks for that password.",
          ],
        },
        {
          kind: "note",
          tone: "caution",
          title: "Allow pop-ups if nothing opens",
          body: [
            "The sign-in has to open in a new tab. If your browser blocks it, the card says so and nothing else happens: allow pop-ups for the workspace and choose Connect again.",
          ],
        },
      ],
    },
    {
      title: "Finish signing in, then come back",
      body: [
        {
          kind: "p",
          text: [
            "Until the provider confirms, the card reads ",
            { kind: "strong", text: "Awaiting sign-in" },
            ". Nothing is authorised at that point — a started link is not a connection. Finish in the provider's tab and return to Garuda; the screen rechecks your accounts when you come back to it, and ",
            { kind: "strong", text: "Refresh" },
            " does the same on demand.",
          ],
        },
        {
          kind: "p",
          text: [
            "A card that got interrupted keeps ",
            { kind: "strong", text: "Finish connecting" },
            " and a ",
            { kind: "strong", text: "Cancel" },
            " beside it, so an abandoned attempt can be discarded rather than left sitting there.",
          ],
        },
      ],
    },
    {
      title: "Confirm it says Connected",
      body: [
        {
          kind: "p",
          text: [
            "A live connection carries a green ",
            { kind: "strong", text: "Connected" },
            " badge and its button changes to ",
            { kind: "strong", text: "Disconnect" },
            ". Disconnecting removes the authorisation at the provider and takes effect immediately; connecting again means signing in again.",
          ],
        },
      ],
    },
  ],
  after: [
    {
      kind: "note",
      tone: "caution",
      title: "Agents cannot use these connections during a conversation",
      body: [
        "Connecting an account does not give the agent a tool. Nothing in the chat pipeline calls out to a third party, so an agent cannot check your calendar, look up a contact or write to your CRM mid-conversation. A connection is an authorisation Garuda holds for your workspace, not something the model can reach for while a visitor is typing.",
      ],
    },
    {
      kind: "note",
      tone: "note",
      title: "Connecting an app needs an active subscription",
      body: [
        "Browsing the catalogue is free. Starting a connection is refused without a live plan, with a message saying so. Check Billing if you see it.",
      ],
    },
    {
      kind: "p",
      text: [
        "Your connections are scoped to your workspace on the server, not just hidden in the interface: the account is taken from your session rather than from anything the browser sends, and a disconnect request for a connection that is not yours comes back as though it does not exist.",
      ],
    },
  ],
  stuck: [
    {
      problem: "The screen says there is no app catalogue here",
      body: [
        {
          kind: "p",
          text: [
            "This deployment has no integration credentials configured, so there is nothing to browse. That is a property of the installation rather than of your account, and outbound webhooks remain available on the same screen.",
          ],
        },
      ],
    },
    {
      problem: "The catalogue will not load",
      body: [
        {
          kind: "p",
          text: [
            "A red bar carries the reason. The catalogue is fetched live from the integration provider, so a failure there shows up here; try again in a moment. If it persists, sign out and back in, because an expired session produces the same symptom.",
          ],
        },
      ],
    },
    {
      problem: "The card still says Awaiting sign-in after you signed in",
      body: [
        {
          kind: "p",
          text: [
            "Nothing tells the workspace tab when the provider's tab finishes. Choose ",
            { kind: "strong", text: "Refresh" },
            ". If it stays that way, the provider did not complete the authorisation: use Cancel and start again.",
          ],
        },
      ],
    },
    {
      problem: "The app you need is not in the catalogue",
      body: [
        {
          kind: "p",
          text: [
            "Search a shorter word first — the catalogue lists products under their own names. If it genuinely is not there, an outbound webhook reaches anything with an HTTP endpoint; see ",
            {
              kind: "link",
              text: "Sending leads to your CRM with a webhook",
              href: "/help/sending-leads-to-your-crm-with-a-webhook",
            },
            ", or write to ",
            { kind: "link", text: "info@ravan.ai", href: "mailto:info@ravan.ai" },
            " and describe what you are trying to connect.",
          ],
        },
      ],
    },
  ],
  related: [
    "sending-leads-to-your-crm-with-a-webhook",
    "reading-conversations-and-leads",
    "exporting-your-leads",
  ],
};
