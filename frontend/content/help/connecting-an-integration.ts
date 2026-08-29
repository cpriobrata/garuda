import type { HelpArticle } from "./types";

export const article: HelpArticle = {
  slug: "connecting-an-integration",
  category: "configuring",
  title: "Connecting an integration such as Google Calendar or a CRM",
  description:
    "Today the working route is a signed outbound webhook from the Integrations screen into Zapier, Make, n8n or your CRM. The in-portal account catalogue is not built yet.",
  answer:
    "Register a signed webhook endpoint at /app/integrations and point it at your CRM or an automation tool such as Zapier, Make, n8n or Pipedream. There is no in-portal catalogue for connecting a Google or CRM account yet.",
  updated: "2026-08-30",
  keywords: [
    "crm integration",
    "webhook",
    "zapier",
    "google calendar",
    "hubspot",
    "signed webhook",
  ],
  intro: [
    {
      kind: "note",
      tone: "caution",
      title: "Read this before you go looking for a Connect button",
      body: [
        "Garuda has server-side support for customers connecting their own third-party accounts, but no screen in the workspace browses that catalogue or lists connections yet. The Integrations tab under Settings shows HubSpot, Slack, Google Calendar and Zapier as Coming soon cards with disabled buttons, and that is accurate. What does work today is outbound webhooks, and that is what this article covers.",
      ],
    },
    {
      kind: "p",
      text: [
        "A webhook means Garuda posts a small JSON message to a URL you own the moment something happens. Every automation tool and most CRMs accept one, which is how a captured lead ends up as a contact, a calendar hold or a row in a sheet.",
      ],
    },
  ],
  steps: [
    {
      title: "Open the Integrations screen",
      body: [
        {
          kind: "p",
          text: [
            "It lives at ",
            { kind: "code", text: "/app/integrations" },
            " in the workspace. There is no sidebar link to it yet — the sidebar holds Overview, Agents, Conversations, Leads, Widget, Billing and Settings — so type or bookmark the path.",
          ],
        },
      ],
    },
    {
      title: "Get a destination URL",
      body: [
        {
          kind: "p",
          text: [
            "In Zapier create a Catch Hook trigger; in Make a Custom webhook; in n8n or Pipedream a webhook trigger. Some CRMs publish an inbound URL of their own. Copy whatever URL the tool gives you.",
          ],
        },
        {
          kind: "p",
          text: [
            "It has to be https on the default port and resolve to a public address. Garuda refuses anything else, including a private or internal address.",
          ],
        },
      ],
    },
    {
      title: "Add the endpoint",
      body: [
        {
          kind: "p",
          text: [
            "Paste the URL into ",
            { kind: "strong", text: "Add an endpoint" },
            ", give it a label you will recognise later, tick the events you want, and choose ",
            { kind: "strong", text: "Add endpoint" },
            ". At least one event is required.",
          ],
        },
        {
          kind: "table",
          caption: "The events an endpoint can subscribe to",
          columns: ["Event", "When it fires"],
          rows: [
            {
              header: "lead.created",
              cells: [["A visitor completed the lead form on one of your agents."]],
            },
            {
              header: "conversation.started",
              cells: [["A visitor sent their first message to one of your agents."]],
            },
            {
              header: "conversation.ended",
              cells: [["A conversation went quiet and is considered finished."]],
            },
          ],
        },
      ],
    },
    {
      title: "Copy the signing secret now",
      body: [
        {
          kind: "p",
          text: [
            "The secret is shown once, immediately after the endpoint is created. Copy it into your receiver before you leave the page. If you lose it, ",
            { kind: "strong", text: "Rotate secret" },
            " issues a new one — which invalidates the old one.",
          ],
        },
      ],
    },
    {
      title: "Send a test",
      body: [
        {
          kind: "p",
          text: [
            { kind: "strong", text: "Send test" },
            " queues a ",
            { kind: "code", text: "webhook.test" },
            " event. It is delivered in the background and goes to the endpoint whatever it is subscribed to, because its whole job is to prove the wiring. Open ",
            { kind: "strong", text: "Recent deliveries" },
            " on the endpoint a moment later to see the attempt, its status and any response code.",
          ],
        },
      ],
    },
    {
      title: "Verify the signature in your receiver",
      body: [
        {
          kind: "p",
          text: [
            "Garuda signs every delivery. The scheme is identical to Stripe's, so a Stripe verifier works unchanged.",
          ],
        },
        {
          kind: "table",
          caption: "How a Garuda webhook delivery is signed and delivered",
          columns: ["Detail", "Value"],
          rows: [
            { header: "Signature header", cells: [[{ kind: "code", text: "Garuda-Signature" }]] },
            {
              header: "Header format",
              cells: [[{ kind: "code", text: "t=<unix seconds>,v1=<hex HMAC-SHA256>" }]],
            },
            { header: "Signed value", cells: [[{ kind: "code", text: "<t>.<raw request body>" }]] },
            { header: "Clock tolerance", cells: [["300 seconds"]] },
            { header: "Method", cells: [["POST, application/json"]] },
            {
              header: "Retries",
              cells: [["5 retries with exponential backoff after the first attempt"]],
            },
            {
              header: "Guarantee",
              cells: [
                [
                  "At least once. De-duplicate on the ",
                  { kind: "code", text: "Garuda-Event-Id" },
                  " header.",
                ],
              ],
            },
            {
              header: "Expected reply",
              cells: [
                [
                  "Any 2xx. Reply ",
                  { kind: "code", text: "410 Gone" },
                  " to have Garuda stop retrying immediately.",
                ],
              ],
            },
          ],
        },
        {
          kind: "note",
          tone: "caution",
          title: "Sign the raw bytes",
          body: [
            "Verify against the body exactly as it arrived, not against a re-encoding of the parsed JSON, and reject a timestamp further than the tolerance from your own clock.",
          ],
        },
      ],
    },
    {
      title: "Build the rest in your own tool",
      body: [
        {
          kind: "p",
          text: [
            "Once the payload is arriving, everything downstream is the automation tool's job: create the HubSpot contact, add the Google Calendar event, append the sheet row. Garuda's part ends at a signed, retried POST.",
          ],
        },
      ],
    },
  ],
  after: [
    {
      kind: "note",
      tone: "caution",
      title: "Agents cannot use third-party tools during a conversation",
      body: [
        "Even where an account connection exists, nothing in the chat pipeline calls a third-party tool. An agent cannot check your calendar or write to your CRM mid-conversation. Webhooks fire after the fact, which is a different thing and worth being clear about before you promise a visitor anything.",
      ],
    },
    {
      kind: "p",
      text: [
        "An account may register up to 10 endpoints. An endpoint that exhausts its retries five times in a row is suspended for an hour, so a receiver that goes down does not keep costing deliveries; the log shows the failures and the endpoint resumes on its own.",
      ],
    },
  ],
  stuck: [
    {
      problem: "The URL is rejected when you add it",
      body: [
        {
          kind: "p",
          text: [
            "It must be https, on the default port, and resolve to a public address. Localhost, a private range and a custom port are all refused.",
          ],
        },
      ],
    },
    {
      problem: "Deliveries show as failed",
      body: [
        {
          kind: "p",
          text: [
            "Open Recent deliveries and read the response status and error. A 401 or 403 usually means your receiver is rejecting the signature; a 404 means the URL has moved; a 5xx means the receiver itself is failing.",
          ],
        },
      ],
    },
    {
      problem: "The endpoint shows failures in a row and nothing new arrives",
      body: [
        {
          kind: "p",
          text: [
            "It has been suspended by the circuit breaker. Fix the receiver, then use Send test to confirm it is answering again.",
          ],
        },
      ],
    },
    {
      problem: "You need an account connection rather than a webhook",
      body: [
        {
          kind: "p",
          text: [
            "There is no way to do that from the workspace today. Write to ",
            { kind: "link", text: "info@ravan.ai", href: "mailto:info@ravan.ai" },
            " and describe what you are trying to connect.",
          ],
        },
      ],
    },
  ],
  related: ["reading-conversations-and-leads", "exporting-your-leads", "setting-up-lead-capture-and-consent"],
};
