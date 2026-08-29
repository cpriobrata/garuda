import type { HelpArticle } from "./types";

export const article: HelpArticle = {
  slug: "handing-a-conversation-to-a-person-on-whatsapp",
  category: "configuring",
  title: "Handing a conversation to a person on WhatsApp",
  description:
    "Switch on Handoff rules in the agent editor and add your WhatsApp number. A button appears in the widget, and tapping it opens WhatsApp with a message already typed. Your number is never published on your website.",
  answer:
    "Open the agent editor, go to Handoff rules, tick Offer a WhatsApp handoff, enter your WhatsApp number with its country code, and publish. Visitors then get a button that opens WhatsApp with a message pre-typed for them.",
  updated: "2026-08-30",
  keywords: [
    "whatsapp handoff",
    "talk to a human",
    "live agent",
    "escalate to a person",
    "wa.me link",
  ],
  intro: [
    {
      kind: "p",
      text: [
        "The agent answers from what you taught it. When that is not enough, the visitor should be able to reach you rather than keep rephrasing the question. WhatsApp is the channel because you already carry it: there is no inbox to watch and nothing to install, on either side.",
      ],
    },
    {
      kind: "note",
      tone: "note",
      title: "Your number is not published on your website",
      body: [
        "The widget's configuration is a public document — any browser on an approved page can fetch it, and so can anything that scrapes the page. Your number is deliberately not in it. The widget is told only that a handoff exists and what to call the button; the wa.me link is built by the server when a visitor with a live conversation actually taps it.",
      ],
    },
  ],
  steps: [
    {
      title: "Open Handoff rules in the agent editor",
      body: [
        {
          kind: "p",
          text: [
            "Go to ",
            { kind: "strong", text: "Agents" },
            ", open the agent, choose ",
            { kind: "strong", text: "Edit agent" },
            ", and select the ",
            { kind: "strong", text: "Handoff rules" },
            " section — the last one in the list, after Appearance.",
          ],
        },
      ],
    },
    {
      title: "Tick Offer a WhatsApp handoff and enter your number",
      body: [
        {
          kind: "p",
          text: [
            "Include the country code. Spaces, dashes and brackets are fine: Garuda keeps the digits and throws the rest away, so ",
            { kind: "code", text: "+91 98765 43210" },
            " and ",
            { kind: "code", text: "+919876543210" },
            " store the same thing.",
          ],
        },
        {
          kind: "table",
          caption: "What the number field accepts",
          columns: ["Value", "Result"],
          rows: [
            { header: "+91 98765 43210", cells: [["Accepted, stored as the digits alone."]] },
            { header: "(44) 7700-900123", cells: [["Accepted. Brackets and dashes are stripped."]] },
            {
              header: "07700 900123",
              cells: [
                [
                  "Rejected. A leading zero is a national trunk prefix, never part of an international number, and WhatsApp fails silently on it. Drop it and start with the country code.",
                ],
              ],
            },
            {
              header: "98765",
              cells: [["Rejected. The number must be between 8 and 15 digits once the separators are gone."]],
            },
            {
              header: "Empty, with the box ticked",
              cells: [
                [
                  "Rejected. A handoff that is switched on but has nowhere to go would show visitors a button that leads nowhere, so it cannot be saved.",
                ],
              ],
            },
          ],
        },
      ],
    },
    {
      title: "Write the button label and the availability note",
      body: [
        {
          kind: "p",
          text: [
            { kind: "strong", text: "Button label" },
            " is what the visitor sees, up to 60 characters. Left empty it reads ",
            { kind: "strong", text: "Talk to a person on WhatsApp" },
            ".",
          ],
        },
        {
          kind: "p",
          text: [
            { kind: "strong", text: "When you reply" },
            " is free text of up to 120 characters — ",
            { kind: "code", text: "Mon–Fri, 9am–6pm IST" },
            ", say — shown directly under the button. It is worth filling in: a visitor who messages at 3am and hears nothing back reads the silence as being ignored.",
          ],
        },
      ],
    },
    {
      title: "Write the message that is typed for them",
      body: [
        {
          kind: "p",
          text: [
            "Up to 400 characters. WhatsApp opens with this already in the compose box, and the page the visitor was on is added beneath it. Left empty it reads ",
            { kind: "strong", text: "Hi, I was chatting on your website and would like to speak with someone." },
          ],
        },
        {
          kind: "note",
          tone: "note",
          title: "The visitor still presses send",
          body: [
            "Garuda pre-types the message; it never sends it. The visitor sees the text, can edit or delete it, and sends it themselves — which is the difference between a shortcut and messaging a stranger's phone on their behalf.",
          ],
        },
      ],
    },
    {
      title: "Decide when the button gets pushed forward",
      body: [
        {
          kind: "p",
          text: [
            "Once handoff is on, the button is present for the whole conversation. These two settings only control when it is highlighted, so a visitor who needs it does not have to go hunting.",
          ],
        },
        {
          kind: "ul",
          items: [
            [
              { kind: "strong", text: "Phrases that offer it straight away" },
              " — comma separated, up to twelve, each up to 60 characters. Matching is case-insensitive and looks anywhere inside what the visitor typed, so ",
              { kind: "code", text: "real person" },
              " matches “can I speak to a real person please”. The field starts with a sensible list you can edit.",
            ],
            [
              { kind: "strong", text: "Offer it automatically after" },
              " — 3, 5 or 8 messages from the visitor, or ",
              { kind: "strong", text: "Only when they ask" },
              ", which is the default and highlights nothing.",
            ],
          ],
        },
      ],
    },
    {
      title: "Add a notification address, if you want one",
      body: [
        {
          kind: "p",
          text: [
            { kind: "strong", text: "Email me when this happens" },
            " is optional. Fill it in and Garuda emails you once per conversation the moment a visitor asks for a person — so a WhatsApp message you never received is still something you know about.",
          ],
        },
        {
          kind: "p",
          text: [
            "The email names the assistant and the page the visitor was on. It contains nothing the visitor typed: a transcript in an inbox is a copy of their personal data sitting outside the product.",
          ],
        },
      ],
    },
    {
      title: "Save, then publish",
      body: [
        {
          kind: "p",
          text: [
            "The editor shows the exact ",
            { kind: "code", text: "https://wa.me/…" },
            " link visitors will open, with the pre-typed message beside it, once the box is ticked and the number is long enough. An agent that is already live picks the new settings up on the next widget load; a draft needs ",
            { kind: "strong", text: "Publish agent" },
            " first.",
          ],
        },
      ],
    },
  ],
  after: [
    {
      kind: "p",
      text: ["What the visitor sees, in order:"],
    },
    {
      kind: "ol",
      items: [
        [
          "The button appears just above the message box once they have started a conversation, with your availability note under it. It is hidden while the lead form is on screen, so the two never compete.",
        ],
        [
          "A trigger phrase, or the message count you set, tints it and pulses it briefly — twice, and not at all for a visitor whose system asks for reduced motion. Nothing else changes: the button was already there.",
        ],
        [
          "They tap it, the label changes to ",
          { kind: "strong", text: "Opening WhatsApp…" },
          ", and WhatsApp opens in a new tab with your message and their page URL typed in. If their browser blocks the new tab, the current one navigates instead rather than leaving a button that looks broken.",
        ],
        [
          "The chat says the handoff is opening and that they can keep typing there if they would rather. The conversation is not closed.",
        ],
      ],
    },
    {
      kind: "p",
      text: [
        "On your side the conversation gains a line in the transcript — ",
        { kind: "strong", text: "The visitor asked to continue with a person on WhatsApp" },
        " — recorded once, on the first tap. Without it, a thread that ends in a handoff would look identical to a visitor who simply got bored. Read it in ",
        {
          kind: "link",
          text: "Conversations",
          href: "/help/reading-conversations-and-leads",
        },
        ".",
      ],
    },
    {
      kind: "note",
      tone: "caution",
      title: "The handoff is a link, not an inbox",
      body: [
        "The conversation continues in your own WhatsApp, on your own phone. Garuda does not read it, store it or show it in the workspace, and the visitor's WhatsApp identity is not attached to their lead record. Only the fact that a handoff happened is recorded.",
      ],
    },
  ],
  stuck: [
    {
      problem: "The button does not appear in the widget",
      body: [
        {
          kind: "p",
          text: [
            "Check, in this order: the box is ticked, a number is saved, and the agent has been published since you saved. The widget is also only told about a handoff on a published agent — an unpublished or paused one has no live configuration to send.",
          ],
        },
      ],
    },
    {
      problem: "Saving is rejected with a message about the number",
      body: [
        {
          kind: "p",
          text: [
            "Between 8 and 15 digits once spaces and punctuation are removed, and no leading zero. Type it the way you would give it to somebody abroad: country code first, then the number.",
          ],
        },
      ],
    },
    {
      problem: "WhatsApp opens on an empty chat with no message",
      body: [
        {
          kind: "p",
          text: [
            "That is WhatsApp deciding the number is not reachable rather than Garuda failing to send the text. Message the same number from another phone to confirm it has an active WhatsApp account, and check you have not saved a landline.",
          ],
        },
      ],
    },
    {
      problem: "The visitor is told speaking with a person is not set up",
      body: [
        {
          kind: "p",
          text: [
            "The widget asked for a handoff and the server had none to give — the configuration was switched off, or the number was cleared, between the page loading and the button being tapped. Reload the page after saving and publishing.",
          ],
        },
      ],
    },
    {
      problem: "No notification email arrives",
      body: [
        {
          kind: "p",
          text: [
            "It is sent once per conversation, so a second tap in the same thread is silent by design. Otherwise check the address in Handoff rules and your spam folder. Delivery is deliberately off the critical path: a mail failure never stops the visitor getting their link.",
          ],
        },
      ],
    },
  ],
  related: [
    "reading-conversations-and-leads",
    "creating-your-first-agent",
    "setting-up-lead-capture-and-consent",
  ],
};
