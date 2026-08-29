import type { HelpArticle } from "./types";

export const article: HelpArticle = {
  slug: "setting-up-lead-capture-and-consent",
  category: "configuring",
  title: "Setting up lead capture and consent",
  description:
    "Lead capture is on by default and offers the contact form after three exchanges. Nothing is stored until the visitor ticks the consent box, and the server refuses submissions without it.",
  answer:
    "A new agent already captures leads: after three exchanges the widget offers a contact form, and nothing is saved unless the visitor ticks the consent box, which the server checks before it writes anything.",
  updated: "2026-08-30",
  keywords: [
    "lead capture",
    "consent checkbox",
    "collect contact details",
    "chatbot lead form",
    "gdpr consent chat",
  ],
  intro: [
    {
      kind: "p",
      text: [
        "There are two separate consents in the widget and it is worth keeping them apart. One is about remembering the visitor on their own browser. The other is about you contacting them. This article is about the second.",
      ],
    },
  ],
  steps: [
    {
      title: "Know what you get without changing anything",
      body: [
        {
          kind: "p",
          text: [
            "An agent created in Garuda starts with lead capture switched on, a follow-up prompt, and a form asking for name, email and phone. After three exchanges the widget offers that form. A ",
            { kind: "strong", text: "Contact the team" },
            " button also appears under the conversation once the visitor has sent a message and the agent has replied, so they can ask for follow-up sooner.",
          ],
        },
      ],
    },
    {
      title: "Decide when the form should appear",
      body: [
        {
          kind: "p",
          text: [
            "Open ",
            { kind: "strong", text: "Widget" },
            ", then the ",
            { kind: "strong", text: "Customize" },
            " tab, and look at section 5, Toggle options. ",
            { kind: "strong", text: "Show lead form" },
            " moves the form to the front: it is shown the moment the panel opens, before any conversation. Leave it off and the form stays where it is, offered part-way through.",
          ],
        },
        {
          kind: "note",
          tone: "note",
          title: "Autostart and Show lead form are mutually exclusive",
          body: [
            "One opens the conversation immediately and the other gates it behind a form, so Garuda refuses to store both. Switching one on switches the other off in front of you.",
          ],
        },
      ],
    },
    {
      title: "Confirm submissions are actually saved",
      body: [
        {
          kind: "p",
          text: [
            "Section 6 of the Customize tab holds a switch called ",
            { kind: "strong", text: "Save submissions as leads" },
            ". When it is off, the form is drawn but nothing submitted is kept, and the section says so. It is only visible while Show lead form is on, so turn that on to check the switch, then turn it back off if you would rather the form stayed later in the conversation.",
          ],
        },
      ],
    },
    {
      title: "Check what the visitor is agreeing to",
      body: [
        {
          kind: "p",
          text: [
            "Every contact form carries a required checkbox reading ",
            { kind: "strong", text: "I agree to be contacted about my request" },
            ". It cannot be removed, and the form will not submit until it is ticked. If the agent has a privacy policy URL, a ",
            { kind: "strong", text: "View privacy policy" },
            " link appears beneath it.",
          ],
        },
        {
          kind: "p",
          text: ["When a lead is saved, Garuda stores the evidence beside it:"],
        },
        {
          kind: "ul",
          items: [
            ["the consent itself, recorded as granted"],
            ["the version of the notice the visitor was shown"],
            ["whether the privacy notice was separately accepted"],
            ["the moment of consent, kept only when the browser supplies a real timestamp"],
            ["the conversation it came from"],
          ],
        },
      ],
    },
    {
      title: "Set the fields you actually need",
      body: [
        {
          kind: "p",
          text: [
            "The form must be able to reach the person: a submission with neither an email address nor a phone number is refused. Everything beyond that is your choice, and the builder is covered in ",
            {
              kind: "link",
              text: "Building a custom lead form",
              href: "/help/building-a-custom-lead-form",
            },
            ".",
          ],
        },
      ],
    },
    {
      title: "Test it end to end",
      body: [
        {
          kind: "p",
          text: [
            "On your own site, open the widget, have a short conversation, submit the form, then check ",
            { kind: "strong", text: "Leads" },
            " in the portal. The new row should carry the source ",
            { kind: "code", text: "widget" },
            ".",
          ],
        },
      ],
    },
  ],
  after: [
    {
      kind: "p",
      text: [
        "The other consent — the one headed ",
        { kind: "strong", text: "Your chat, your choice" },
        " — appears when the widget first opens and offers ",
        { kind: "strong", text: "Remember this chat" },
        " or ",
        { kind: "strong", text: "Use once" },
        ". Choosing to be remembered stores one opaque token in that browser, scoped to that agent alone, so the same browser talking to a different customer's Garuda agent cannot be linked to this one. Declining keeps the conversation to that visit.",
      ],
    },
    {
      kind: "note",
      tone: "caution",
      title: "The prompt wording and the three-exchange delay are not editable yet",
      body: [
        "The portal has no input for the follow-up prompt, the number of exchanges before the form is offered, or the privacy sentence under the form. They are stored on the agent and carried through untouched by every save. Email info@ravan.ai if you need one of them changed.",
      ],
    },
    {
      kind: "note",
      tone: "caution",
      title: "Leads you type in by hand are not consented captures",
      body: [
        "Manual add on the Leads screen stores the row with the source manual and records that no consent was collected there. Record consent separately before contacting somebody you added that way.",
      ],
    },
  ],
  stuck: [
    {
      problem: "The form never appears in the conversation",
      body: [
        {
          kind: "p",
          text: [
            "Check Save submissions as leads is on. With it off and Show lead form off too, the widget has no reason to offer a form at all — not even the Contact the team button.",
          ],
        },
      ],
    },
    {
      problem: "A visitor says their details would not send",
      body: [
        {
          kind: "p",
          text: [
            "The consent box is required and the form names it in red until it is ticked. Beyond that, an email address must parse as an address and a phone number must be at least seven digits after formatting characters are stripped.",
          ],
        },
      ],
    },
    {
      problem: "Submissions stopped being saved",
      body: [
        {
          kind: "p",
          text: [
            "Lead capture needs an active subscription, the same as every other widget surface. Check Billing. A workspace over its rolling 30-day conversation allowance will also stop opening new conversations.",
          ],
        },
      ],
    },
    {
      problem: "The same person appears once, not twice",
      body: [
        {
          kind: "p",
          text: [
            "That is deliberate. A second submission in the same conversation with the same email or phone updates the existing lead rather than creating a duplicate.",
          ],
        },
      ],
    },
  ],
  related: [
    "building-a-custom-lead-form",
    "reading-conversations-and-leads",
    "exporting-your-leads",
  ],
};
