import type { HelpArticle } from "./types";

export const article: HelpArticle = {
  slug: "installing-the-widget-on-your-website",
  category: "getting-started",
  title: "Installing the widget on your website",
  description:
    "Copy the one-line script from Widget, Install and paste it before the closing body tag on every page that should show the chat. The snippet only appears once the agent is published.",
  answer:
    "Publish the agent, copy the script tag from Widget, Install, and paste it immediately before the closing body tag of every page you want the chat to appear on.",
  updated: "2026-08-30",
  keywords: [
    "install chat widget",
    "embed code",
    "script tag",
    "add chatbot to website",
    "data-agent-key",
  ],
  intro: [
    {
      kind: "p",
      text: [
        "One script tag installs the whole widget. It loads asynchronously, so it does not hold up the rest of your page, and it draws itself inside a shadow root, so your site styles cannot leak into it and its styles cannot leak out.",
      ],
    },
  ],
  steps: [
    {
      title: "Publish the agent first",
      body: [
        {
          kind: "p",
          text: [
            "Until the agent is published there is no snippet to copy. The Widget screen says so, and the copy button reads ",
            { kind: "strong", text: "Publish first" },
            " instead of Copy.",
          ],
        },
      ],
    },
    {
      title: "Open Widget in the sidebar",
      body: [
        {
          kind: "p",
          text: [
            "The page opens on the ",
            { kind: "strong", text: "Install" },
            " tab. Garuda looks for a live agent in your workspace and shows its snippet; if none is live it falls back to the first agent in the list.",
          ],
        },
      ],
    },
    {
      title: "Copy the snippet",
      body: [
        {
          kind: "p",
          text: ["It is a single tag carrying your publishable agent key, and it looks like this:"],
        },
        {
          kind: "code",
          label: "The embed snippet",
          code:
            '<script async src="https://api.garuda.ravan.ai/widget.js" data-agent-key="pub_your_agent_key"></script>',
        },
        {
          kind: "p",
          text: [
            "The key that begins ",
            { kind: "code", text: "pub_" },
            " is publishable: it is meant to sit in page source where anyone can read it. It identifies a published agent and nothing else, and it cannot be used to sign in to your workspace.",
          ],
        },
      ],
    },
    {
      title: "Paste it before the closing body tag",
      body: [
        {
          kind: "p",
          text: [
            "Put it immediately before ",
            { kind: "code", text: "</body>" },
            " in your site template, so it appears on every page you want the chat on. Most site builders call this a custom code, footer code or before-body-end field.",
          ],
        },
        {
          kind: "note",
          tone: "note",
          title: "Once per page, not once per site section",
          body: [
            "If the same snippet ends up on the page twice, Garuda still mounts one widget: it records what is already mounted on the page itself, which also keeps single-page applications from stacking a new launcher on every navigation.",
          ],
        },
      ],
    },
    {
      title: "Load the page and check the launcher",
      body: [
        {
          kind: "p",
          text: [
            "Open your site in a normal browser tab — not a local file, and not a preview on a domain you have not approved. The launcher appears in the corner you chose, and opening it shows your greeting.",
          ],
        },
      ],
    },
  ],
  after: [
    {
      kind: "p",
      text: [
        "The tag accepts a few optional attributes if you need them. None of them are required, and each one only affects the page it is written on:",
      ],
    },
    {
      kind: "table",
      caption: "Optional attributes on the embed script tag",
      columns: ["Attribute", "What it does"],
      rows: [
        {
          header: "data-launcher-label",
          cells: [["Overrides the text beside the launcher button, up to 50 characters."]],
        },
        {
          header: "data-open",
          cells: [
            [
              "Set to ",
              { kind: "code", text: "true" },
              " to open the panel as soon as the widget mounts.",
            ],
          ],
        },
        {
          header: "data-z-index",
          cells: [
            [
              "Sets the stacking order, clamped between 1,000 and 2,147,483,000. The default is 2,147,482,000.",
            ],
          ],
        },
        {
          header: "data-memory-consent",
          cells: [
            [
              { kind: "code", text: "prompt" },
              " (the default) asks the visitor; ",
              { kind: "code", text: "true" },
              " or ",
              { kind: "code", text: "false" },
              " decides for them.",
            ],
          ],
        },
        {
          header: "data-api-origin",
          cells: [["Points the widget at a different API origin. Rarely needed; the script URL decides it otherwise."]],
        },
      ],
    },
    {
      kind: "note",
      tone: "caution",
      title: "Platform guides and email sharing are not built",
      body: [
        "The Webflow, WordPress, Shopify and Framer tiles on the Install tab are disabled and marked Coming soon, and so is the button for emailing the snippet to a developer. Copy the snippet and send it yourself.",
      ],
    },
  ],
  stuck: [
    {
      problem: "The snippet area says to publish an agent first",
      body: [
        {
          kind: "p",
          text: [
            "The agent is still a draft, or it is paused. Open it under Agents and publish or resume it.",
          ],
        },
      ],
    },
    {
      problem: "The embed code could not be loaded",
      body: [
        {
          kind: "p",
          text: [
            "The screen shows a red bar with a ",
            { kind: "strong", text: "Try again" },
            " button. It retries without a page reload. If it keeps failing, sign out and back in — an expired session produces the same symptom.",
          ],
        },
      ],
    },
    {
      problem: "The snippet is on the page but nothing appears",
      body: [
        {
          kind: "p",
          text: [
            "That is almost always the domain allowlist, the publishing state or a toggle. Work through ",
            {
              kind: "link",
              text: "My widget is not showing up",
              href: "/help/my-widget-is-not-showing-up",
            },
            ", which covers all four causes in order.",
          ],
        },
      ],
    },
  ],
  related: [
    "approving-the-domains-your-agent-may-run-on",
    "my-widget-is-not-showing-up",
    "customising-the-widget-appearance",
  ],
};
