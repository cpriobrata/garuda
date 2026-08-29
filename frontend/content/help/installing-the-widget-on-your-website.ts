import type { HelpArticle } from "./types";

export const article: HelpArticle = {
  slug: "installing-the-widget-on-your-website",
  category: "getting-started",
  title: "Installing the widget on your website",
  description:
    "Copy the one-line script from Widget, Install and paste it before the closing body tag on every page that should show the chat. Step-by-step guides for Webflow, WordPress, Shopify and Framer are on the same tab.",
  answer:
    "Publish the agent, copy the script tag from Widget, Install, and paste it immediately before the closing body tag of every page you want the chat to appear on — or open the guide for your website builder, which carries the same snippet.",
  updated: "2026-08-30",
  keywords: [
    "install chat widget",
    "embed code",
    "script tag",
    "add chatbot to website",
    "data-agent-key",
    "webflow wordpress shopify framer",
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
        {
          kind: "p",
          text: [
            "Everything you need is on that one tab: the snippet, the domains the agent is allowed to run on, a guide for each of the popular website builders, a panel for handing the job to somebody else, and a checklist of what is still outstanding.",
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
      title: "Or open the guide for your website builder",
      body: [
        {
          kind: "p",
          text: [
            "Under ",
            { kind: "strong", text: "Platform guides" },
            " there is a tile for Webflow, WordPress, Shopify, Framer and one for any hand-written site or framework. Choosing one opens a dialog with your own snippet at the top and numbered steps beneath it, naming the site-wide custom-code or footer field to paste into rather than a menu path that moves between releases.",
          ],
        },
        {
          kind: "p",
          text: [
            "Each guide also states the awkward part of that platform: Webflow and Framer run site-wide custom code only on paid plans and only on the published site, never in the canvas or preview; WordPress.com allows custom scripts only on its higher plans; and Shopify's theme code does not run on checkout pages, so the launcher appears across the storefront but not during checkout.",
          ],
        },
      ],
    },
    {
      title: "Check the site's domain is approved",
      body: [
        {
          kind: "p",
          text: [
            "The widget starts only on domains the agent allows, and refuses every other origin — so the snippet on an unapproved domain does nothing at all. ",
            { kind: "strong", text: "Publishing & domain access" },
            " on the same tab lists the approved domains; it is a display, and the editable field is in the agent editor under Appearance. See ",
            {
              kind: "link",
              text: "Approving the domains your agent may run on",
              href: "/help/approving-the-domains-your-agent-may-run-on",
            },
            ".",
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
      tone: "tip",
      title: "Handing the job to whoever manages the site",
      body: [
        "The panel headed ",
        { kind: "strong", text: "Need a teammate to install it?" },
        " has two buttons that hand over the same note. ",
        { kind: "strong", text: "Email the install steps" },
        " opens your own mail client with it already written, for you to address and send; ",
        { kind: "strong", text: "Copy install instructions" },
        " puts the identical text on the clipboard. The note carries your snippet, that it belongs in the shared layout rather than on one page, that it loads asynchronously, the domains this agent is allowed to run on, and the reminder to republish the site afterwards. Both are inactive until the agent is published, because until then there is no live snippet to hand over.",
      ],
    },
    {
      kind: "note",
      tone: "note",
      title: "If a copy button reports it was blocked",
      body: [
        "Copying needs a secure origin and the browser's permission. Where it is refused, the text you were copying appears in a box below the button, selected, so you can copy it by hand rather than being told it worked when it did not.",
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
