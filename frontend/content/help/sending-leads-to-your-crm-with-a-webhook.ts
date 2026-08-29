import type { HelpArticle } from "./types";

export const article: HelpArticle = {
  slug: "sending-leads-to-your-crm-with-a-webhook",
  category: "configuring",
  title: "Sending leads to your CRM with a webhook",
  description:
    "Register a signed HTTPS endpoint on the Integrations screen and Garuda posts every new lead and conversation event to it. Zapier, Make, n8n, Pipedream and most CRMs accept one directly.",
  answer:
    "Add an HTTPS endpoint under Webhooks on the Integrations screen, subscribe it to the events you care about, copy the signing secret it shows you once, and verify that signature in your receiver.",
  updated: "2026-08-30",
  keywords: [
    "webhook",
    "crm integration",
    "zapier",
    "signed webhook",
    "lead.created",
    "hubspot",
  ],
  intro: [
    {
      kind: "p",
      text: [
        "A webhook means Garuda posts a small JSON message to a URL you own the moment something happens. Every automation tool and most CRMs accept one, which is how a captured lead ends up as a contact, a calendar hold or a row in a sheet.",
      ],
    },
    {
      kind: "note",
      tone: "note",
      title: "This is the outbound half of integrations",
      body: [
        "Webhooks push what happened in Garuda out to your own tools. Connecting a third-party account so that it belongs to your workspace is a separate thing, covered in Connecting an integration.",
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
            " in the workspace. Settings, Integrations links to it as ",
            { kind: "strong", text: "Open integrations" },
            " if you would rather not type the path.",
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
      kind: "p",
      text: [
        "An account may register up to 10 endpoints. An endpoint that exhausts its retries five times in a row is suspended for an hour, so a receiver that goes down does not keep costing deliveries; the log shows the failures and the endpoint resumes on its own.",
      ],
    },
    {
      kind: "note",
      tone: "note",
      title: "Webhooks fire after the fact",
      body: [
        "A webhook tells your tools what already happened. It is not a way for the agent to look something up mid-conversation — nothing in the chat pipeline calls out to a third-party tool — so be careful what you promise a visitor on the strength of one.",
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
      problem: "You want an account connection rather than a webhook",
      body: [
        {
          kind: "p",
          text: [
            "That is the other half of the Integrations screen. See ",
            {
              kind: "link",
              text: "Connecting an integration",
              href: "/help/connecting-an-integration",
            },
            ".",
          ],
        },
      ],
    },
  ],
  related: [
    "connecting-an-integration",
    "exporting-your-leads",
    "reading-conversations-and-leads",
  ],
};
