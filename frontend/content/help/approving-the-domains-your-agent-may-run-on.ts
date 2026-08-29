import type { HelpArticle } from "./types";

export const article: HelpArticle = {
  slug: "approving-the-domains-your-agent-may-run-on",
  category: "getting-started",
  title: "Approving the domains your agent may run on",
  description:
    "The allowed domain is set in the agent editor, under Appearance. Garuda compares it to the browser origin exactly, with no wildcards and no automatic subdomain matching.",
  answer:
    "Put the bare hostname in Allowed website domain in the agent editor's Appearance section. Garuda compares it to the origin the browser reports, character for character, and refuses any other site.",
  updated: "2026-08-30",
  keywords: [
    "allowed domain",
    "domain allowlist",
    "widget origin",
    "restrict chatbot to my site",
    "agent not found for this origin",
  ],
  intro: [
    {
      kind: "p",
      text: [
        "The allowlist is what stops somebody copying your snippet onto their own site and spending your conversation allowance. Every widget request carries the browser origin, and Garuda checks it before it will hand over the agent or open a session.",
      ],
    },
  ],
  steps: [
    {
      title: "Open the agent editor",
      body: [
        {
          kind: "p",
          text: [
            "Go to ",
            { kind: "strong", text: "Agents" },
            ", open the agent, choose ",
            { kind: "strong", text: "Edit agent" },
            ", and select the ",
            { kind: "strong", text: "Appearance" },
            " section. The field is at the bottom, labelled ",
            { kind: "strong", text: "Allowed website domain" },
            ".",
          ],
        },
        {
          kind: "note",
          tone: "note",
          title: "It is not on the Widget screen",
          body: [
            "Widget, Install shows the approved domains as a read-only list under Publishing and domain access. It is a display, not an editor. The editable field lives in the agent editor only.",
          ],
        },
      ],
    },
    {
      title: "Enter the hostname on its own",
      body: [
        {
          kind: "p",
          text: [
            "Type ",
            { kind: "code", text: "yourcompany.com" },
            ". No scheme, no path, no trailing slash. The editor strips ",
            { kind: "code", text: "http://" },
            " or ",
            { kind: "code", text: "https://" },
            " and anything after the first slash, and lowercases what is left, so a pasted URL is usually salvaged — but typing the hostname is what makes the result predictable.",
          ],
        },
        {
          kind: "table",
          caption: "Values the allowed-domain field accepts and rejects",
          columns: ["Value", "Result"],
          rows: [
            { header: "yourcompany.com", cells: [["Accepted."]] },
            { header: "shop.yourcompany.com", cells: [["Accepted, and matches that subdomain only."]] },
            { header: "yourcompany.com:8443", cells: [["Accepted. A port is allowed."]] },
            { header: "https://yourcompany.com/", cells: [["The editor trims it to the hostname before saving."]] },
            { header: "*.yourcompany.com", cells: [["Rejected. Wildcards are not supported."]] },
            { header: "yourcompany.com/shop", cells: [["Rejected once saved: paths are not part of an origin."]] },
          ],
        },
      ],
    },
    {
      title: "Save, then publish if the agent is a draft",
      body: [
        {
          kind: "p",
          text: [
            { kind: "strong", text: "Save" },
            " stores it. An agent that is already live picks the new value up on the next widget load. An agent still in Draft needs ",
            { kind: "strong", text: "Publish agent" },
            ", which refuses to run at all while the field is empty.",
          ],
        },
      ],
    },
    {
      title: "Check it on the site itself",
      body: [
        {
          kind: "p",
          text: [
            "Load a page that carries the snippet and open the launcher. If the panel says the assistant is unavailable, the origin your browser sent does not match what you saved — the address bar tells you exactly what it sent.",
          ],
        },
      ],
    },
  ],
  after: [
    {
      kind: "note",
      tone: "caution",
      title: "www and the bare domain are two different origins",
      body: [
        "A visitor on https://www.yourcompany.com sends a different origin from one on https://yourcompany.com, and Garuda treats them as different. The editor holds one domain, so approve the one your site actually serves and redirect the other to it at your host or DNS provider.",
      ],
    },
    {
      kind: "note",
      tone: "caution",
      title: "Saving the editor with the field empty clears the allowlist",
      body: [
        "The Appearance field writes the whole allowed-domain list, so an empty box saves an empty list. A published agent whose allowlist has been emptied will refuse every visitor until a domain is put back and saved.",
      ],
    },
  ],
  stuck: [
    {
      problem: "The widget loads on your live site but not on staging",
      body: [
        {
          kind: "p",
          text: [
            "Staging is a different hostname, so it is a different origin. There is no way to approve two hostnames from this field; use a second agent for staging, or test against the live hostname.",
          ],
        },
      ],
    },
    {
      problem: "The widget does not load from a file opened on your computer",
      body: [
        {
          kind: "p",
          text: [
            "A page opened as a local file sends no origin at all, and a request with no origin is refused. Serve the test page over http or https from a hostname you have approved.",
          ],
        },
      ],
    },
    {
      problem: "Saving is rejected with a message about hostnames",
      body: [
        {
          kind: "p",
          text: [
            "The value has to be a hostname and nothing else: no scheme, path, wildcard, query string, fragment or credentials, and no characters outside letters, digits, dots, dashes and a colon before a port. Retype it as a bare hostname.",
          ],
        },
      ],
    },
    {
      problem: "You need the chat on several different domains",
      body: [
        {
          kind: "p",
          text: [
            "Create one agent per domain. Each has its own key, its own allowlist and its own snippet, and the plan allows 10 published agents at a time.",
          ],
        },
      ],
    },
  ],
  related: [
    "installing-the-widget-on-your-website",
    "my-widget-is-not-showing-up",
    "creating-your-first-agent",
  ],
};
