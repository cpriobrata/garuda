import type { HelpArticle } from "./types";

export const article: HelpArticle = {
  slug: "customising-the-widget-appearance",
  category: "configuring",
  title: "Customising the widget's appearance",
  description:
    "Widget, Customize holds six numbered sections: bot identity, theme, chat logo, placement, nine toggles and the lead form. Changes preview live and are written when you save.",
  answer:
    "Open Widget in the sidebar and switch to the Customize tab. Six numbered sections cover the name, colours, logo, placement, toggles and lead form, with a live preview beside them and one Save changes button.",
  updated: "2026-08-30",
  keywords: [
    "widget appearance",
    "chat colours",
    "widget theme",
    "widget position",
    "brand the chatbot",
  ],
  intro: [
    {
      kind: "p",
      text: [
        "Everything on this screen belongs to one agent. The header shows which one, along with its revision number and whether it is published or still a draft.",
      ],
    },
    {
      kind: "note",
      tone: "caution",
      title: "Check which agent you are editing",
      body: [
        "The Widget screen picks an agent for you: the first live one in the workspace, or the first agent of any kind if none is live. With several agents, read the name in the sticky bar before you start changing colours.",
      ],
    },
  ],
  steps: [
    {
      title: "Section 1 — Bot identity",
      body: [
        {
          kind: "p",
          text: [
            { kind: "strong", text: "Bot display name" },
            " (up to 60 characters) is the name in the widget header. Leave it empty to keep using the agent's own name. ",
            { kind: "strong", text: "Tagline" },
            " (up to 140 characters) sits underneath it.",
          ],
        },
      ],
    },
    {
      title: "Section 2 — Theme",
      body: [
        {
          kind: "p",
          text: [
            "Five ready palettes and one custom option. The palettes are defined on the server, so they look identical in the preview and on your site.",
          ],
        },
        {
          kind: "table",
          caption: "The theme presets available in the widget studio",
          columns: ["Theme", "Description"],
          rows: [
            { header: "Ocean blue", cells: [["Calm and professional"]] },
            { header: "Forest green", cells: [["Natural and balanced"]] },
            { header: "Sunset orange", cells: [["Warm and energetic"]] },
            { header: "Summer yellow", cells: [["Bright and cheerful"]] },
            { header: "Royal purple", cells: [["Creative and luxurious"]] },
            { header: "Custom", cells: [["Customizable for you — you set each colour yourself"]] },
          ],
        },
        {
          kind: "p",
          text: [
            "Choosing ",
            { kind: "strong", text: "Custom" },
            " reveals seven colour fields: Primary (header and launcher), Accent (send button and highlights), Background, Message bubble, Text, and the two text-on-colour values. Leave the last two empty and Garuda picks whichever of black or white is more readable on your fill.",
          ],
        },
        {
          kind: "note",
          tone: "note",
          title: "Unreadable colours are refused, not just warned about",
          body: [
            "The screen measures the same contrast ratios the server enforces — 4.5:1 for body text, 3:1 for interface text — and shows an amber warning as you type. If you save anyway, the server rejects it and names the pairing that failed.",
          ],
        },
      ],
    },
    {
      title: "Section 3 — Chat logo",
      body: [
        {
          kind: "p",
          text: [
            "Paste an absolute HTTPS URL to an image you already host. There is no upload here, so the file has to live somewhere already. Leave it empty and the widget shows a monogram taken from the display name. A URL that will not load falls back to the monogram, and the screen tells you.",
          ],
        },
      ],
    },
    {
      title: "Section 4 — Widget position",
      body: [
        {
          kind: "p",
          text: [
            "Six placements, drawn as the page they land on: bottom right, bottom left, middle right, middle left, top right and top left. The ",
            { kind: "strong", text: "Launcher label" },
            " field sits under them; leave it empty for the icon on its own.",
          ],
        },
      ],
    },
    {
      title: "Section 5 — Toggle options",
      body: [
        {
          kind: "p",
          text: ["Nine switches. Four of them change what a visitor sees today:"],
        },
        {
          kind: "table",
          caption: "The widget toggles that change what a visitor sees",
          columns: ["Toggle", "Effect"],
          rows: [
            {
              header: "Chat",
              cells: [
                [
                  "On by default. Turning it ",
                  { kind: "strong", text: "off hides the entire widget" },
                  " — launcher included — because typing is the only conversation this widget offers.",
                ],
              ],
            },
            { header: "Autostart", cells: [["Opens the conversation as soon as the page loads."]] },
            {
              header: "Show lead form",
              cells: [["Asks for contact details before the conversation starts."]],
            },
            { header: "Glowing launcher", cells: [["Adds a soft glow around the launcher button."]] },
            { header: "Transparent panel", cells: [["Lets the page show through the widget panel."]] },
          ],
        },
        {
          kind: "p",
          text: [
            "Autostart and Show lead form cannot both be on: one opens the conversation immediately, the other gates it behind a form. Switching one on switches the other off, and the rows say so.",
          ],
        },
      ],
    },
    {
      title: "Section 6 — Lead form",
      body: [
        {
          kind: "p",
          text: [
            "Only shown when Show lead form is on. It is covered in ",
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
      title: "Save changes",
      body: [
        {
          kind: "p",
          text: [
            "The sticky bar shows an ",
            { kind: "strong", text: "Unsaved changes" },
            " badge while anything is pending, and the browser asks before you leave the page with work in it. ",
            { kind: "strong", text: "Discard" },
            " puts everything back to the last saved state. Once saved, the change reaches visitors on their next page load.",
          ],
        },
      ],
    },
  ],
  after: [
    {
      kind: "note",
      tone: "caution",
      title: "Four switches have no visible effect yet",
      body: [
        "Transcription, Mute on minimize, Mute on tab change and Agent mute describe audio behaviour, and this widget is text only. Their values are saved and published on the widget element for a future voice surface to read; Agent mute additionally shows a muted badge in the panel. Nothing else about them changes what a visitor experiences today.",
      ],
    },
    {
      kind: "p",
      text: [
        "The agent editor's Appearance section also holds a header colour, accent colour, launcher text and two of the six positions. It writes the same underlying fields, so the two screens agree — this one simply offers all of them.",
      ],
    },
  ],
  stuck: [
    {
      problem: "Save changes is greyed out",
      body: [
        {
          kind: "p",
          text: ["Nothing has changed since the last save. The bar reads Everything here is saved."],
        },
      ],
    },
    {
      problem: "A red bar says the agent was changed somewhere else",
      body: [
        {
          kind: "p",
          text: [
            "Somebody saved this agent in another tab or another screen while you were working. Use ",
            { kind: "strong", text: "Reload the agent" },
            " to take the newer version — which discards what is on your screen — and make your changes again.",
          ],
        },
      ],
    },
    {
      problem: "The save is rejected over contrast",
      body: [
        {
          kind: "p",
          text: [
            "The message names the pairing: text on the background, text on a message bubble, header text on the primary colour, or button text on the accent colour. Darken or lighten one of the two colours in that pair until the amber warning clears.",
          ],
        },
      ],
    },
    {
      problem: "The widget on your site still looks the same",
      body: [
        {
          kind: "p",
          text: [
            "Hard-refresh the page. If it still looks unchanged, check the sticky bar named the agent whose key is actually in your snippet — editing one agent and installing another is the usual explanation.",
          ],
        },
      ],
    },
  ],
  related: [
    "building-a-custom-lead-form",
    "setting-up-lead-capture-and-consent",
    "my-widget-is-not-showing-up",
  ],
};
