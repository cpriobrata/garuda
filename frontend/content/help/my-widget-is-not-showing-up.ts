import type { HelpArticle } from "./types";

export const article: HelpArticle = {
  slug: "my-widget-is-not-showing-up",
  category: "troubleshooting",
  title: "My widget is not showing up",
  description:
    "Four causes account for nearly every missing widget: the agent is not published, the domain is not approved, the snippet is not really on the page, or the Chat toggle is off. Check them in that order.",
  answer:
    "Check four things in order: the agent is published, the browser origin exactly matches the allowed domain, the snippet is really in the page source, and the Chat toggle in the widget studio is on.",
  updated: "2026-08-30",
  keywords: [
    "widget not showing",
    "chatbot not appearing",
    "launcher missing",
    "agent not found for this origin",
    "widget troubleshooting",
  ],
  intro: [
    {
      kind: "p",
      text: [
        "Two symptoms, and they point at different halves of this list. If ",
        { kind: "strong", text: "no launcher appears at all" },
        ", the widget never mounted: look at steps 1, 3, 4 and 6. If ",
        { kind: "strong", text: "the launcher appears but the panel says the assistant is unavailable" },
        ", the widget mounted and the server refused it: look at steps 2, 5 and 7.",
      ],
    },
  ],
  steps: [
    {
      title: "Confirm the agent is published",
      body: [
        {
          kind: "p",
          text: [
            "Open ",
            { kind: "strong", text: "Agents" },
            " and read the badge on the agent. Only an agent whose status is exactly ",
            { kind: "strong", text: "published" },
            " is served. A draft is not, and neither is a paused agent — every widget entry point checks the same status, so there is no partial state where some of it works.",
          ],
        },
        {
          kind: "p",
          text: [
            "Publish the draft, or choose Resume agent on a paused one, then reload your site.",
          ],
        },
      ],
    },
    {
      title: "Compare the origin with the allowed domain, character for character",
      body: [
        {
          kind: "p",
          text: [
            "Read your browser's address bar, then read ",
            { kind: "strong", text: "Allowed website domain" },
            " in the agent editor's Appearance section. Garuda matches the origin the browser reports against that value exactly.",
          ],
        },
        {
          kind: "table",
          caption: "Origin mismatches that silently refuse the widget",
          columns: ["What you see", "What is wrong"],
          rows: [
            {
              header: "Address bar shows www., allowlist has the bare domain",
              cells: [["Two different origins. Approve the one your site actually serves."]],
            },
            {
              header: "Testing on a staging or preview hostname",
              cells: [["A different hostname is a different origin. It is not covered."]],
            },
            {
              header: "The page was opened as a file on your computer",
              cells: [["A local file sends no origin, and a request with no origin is refused."]],
            },
            {
              header: "The allowlist is empty",
              cells: [
                [
                  "Saving the editor with the field blank clears it. Put the hostname back and save.",
                ],
              ],
            },
          ],
        },
        {
          kind: "note",
          tone: "note",
          title: "Wildcards do not work",
          body: [
            "There is no subdomain matching and no pattern syntax. shop.example.com and example.com are separate values, and the editor holds one at a time.",
          ],
        },
      ],
    },
    {
      title: "Prove the snippet is really on the page",
      body: [
        {
          kind: "p",
          text: [
            "Not in your site builder — in the page the browser received. Open the page, view source or open developer tools, and search the markup for ",
            { kind: "code", text: "data-agent-key" },
            ".",
          ],
        },
        {
          kind: "ul",
          items: [
            [
              "Not there at all: the builder stripped the script, or the code block only renders on one page or one template. Many builders refuse script tags in ordinary rich-text blocks — use the site-wide custom code or footer field instead.",
            ],
            [
              "There, but the key is wrong or truncated: copy it again from Widget, Install. An invalid key makes the widget stop before it draws anything, and it does so without writing to the console.",
            ],
            [
              "There, and the tag has picked up a ",
              { kind: "code", text: "data-garuda-loaded" },
              " attribute: the script ran. Move on to the next step.",
            ],
          ],
        },
      ],
    },
    {
      title: "Check the Chat toggle",
      body: [
        {
          kind: "p",
          text: [
            "Open ",
            { kind: "strong", text: "Widget" },
            ", the ",
            { kind: "strong", text: "Customize" },
            " tab, section 5. ",
            { kind: "strong", text: "Chat" },
            " is on by default, and turning it off hides the entire widget — launcher included — because typing is the only conversation this widget offers. It is the most easily missed cause of a launcher that has vanished with no error anywhere.",
          ],
        },
        {
          kind: "p",
          text: [
            "While you are there, check the ",
            { kind: "strong", text: "Widget position" },
            " in section 4 matches the corner you have been looking at.",
          ],
        },
      ],
    },
    {
      title: "Read the network requests",
      body: [
        {
          kind: "p",
          text: [
            "Open developer tools, go to the Network tab and reload the page. Three requests matter, and their responses name the problem precisely:",
          ],
        },
        {
          kind: "table",
          caption: "Widget network requests and what a failure means",
          columns: ["Request", "What a failure tells you"],
          rows: [
            {
              header: "widget.js",
              cells: [
                [
                  "Blocked or not requested at all means the snippet is missing, or a content blocker or a Content-Security-Policy on your site is stopping it. Allow the API host in your script-src and connect-src.",
                ],
              ],
            },
            {
              header: "The agent lookup",
              cells: [
                [
                  "A 404 saying the published agent was not found covers both causes deliberately: the agent is not published, or this origin is not on its allowlist. Go back to steps 1 and 2.",
                ],
              ],
            },
            {
              header: "The session request",
              cells: [
                [
                  "402 means the workspace has no active subscription. 429 means it has reached its rolling 30-day conversation allowance of 100.",
                ],
              ],
            },
          ],
        },
        {
          kind: "note",
          tone: "note",
          title: "The console is often empty, and that is expected",
          body: [
            "A widget with an invalid configuration fails closed on purpose and writes nothing to the console, so that a misconfigured embed cannot leak identifiers into a stranger's browser. An empty console is not evidence that the snippet is fine — the Network tab is where the answer is.",
          ],
        },
      ],
    },
    {
      title: "Look for something on top of it",
      body: [
        {
          kind: "p",
          text: [
            "A cookie banner, a sticky footer or a chat bar from another vendor can cover the launcher completely. The widget defaults to a very high stacking order, but you can raise or lower it with ",
            { kind: "code", text: "data-z-index" },
            " on the script tag; the value is clamped between 1,000 and 2,147,483,000.",
          ],
        },
      ],
    },
    {
      title: "Rule out caching and the browser itself",
      body: [
        {
          kind: "p",
          text: [
            "The widget script is cacheable for five minutes, and your own site or CDN may cache the page for much longer. Hard-refresh, then try a private window and a second browser. A tracking blocker or a strict privacy extension will also stop the script.",
          ],
        },
      ],
    },
  ],
  after: [
    {
      kind: "p",
      text: [
        "One more check that is worth doing early with several agents: the key in your snippet has to belong to the agent you have been editing. The Widget screen shows the first live agent it finds, so it is easy to install one agent and then spend an afternoon configuring another.",
      ],
    },
  ],
  stuck: [
    {
      problem: "It works on your computer but not on a colleague's",
      body: [
        {
          kind: "p",
          text: [
            "That points at their browser rather than your setup: an ad or tracker blocker, a corporate proxy, or an extension stopping third-party scripts. Ask them to try a private window with extensions disabled.",
          ],
        },
      ],
    },
    {
      problem: "Two launchers appear",
      body: [
        {
          kind: "p",
          text: [
            "The snippet is on the page twice with two different keys. One key per page: Garuda already prevents the same key mounting twice, including on single-page-application navigations.",
          ],
        },
      ],
    },
    {
      problem: "The panel opens but replies never come",
      body: [
        {
          kind: "p",
          text: [
            "That is not an installation problem. Check the agent answers in the Conversation playground on its own page; if it fails there too, the problem is in the agent rather than the embed.",
          ],
        },
      ],
    },
    {
      problem: "You have worked through all of it and it still does not appear",
      body: [
        {
          kind: "p",
          text: [
            "Write to ",
            { kind: "link", text: "info@ravan.ai", href: "mailto:info@ravan.ai" },
            " with the page URL, the agent name, and the status codes you saw in the Network tab. Those three make it diagnosable in one reply.",
          ],
        },
      ],
    },
  ],
  related: [
    "installing-the-widget-on-your-website",
    "approving-the-domains-your-agent-may-run-on",
    "pausing-or-unpublishing-an-agent",
  ],
};
