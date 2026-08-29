import type { HelpArticle } from "./types";

export const article: HelpArticle = {
  slug: "exporting-your-leads",
  category: "operating",
  title: "Exporting your leads",
  description:
    "Export CSV on the Leads screen downloads every lead in your workspace as a spreadsheet file, optionally filtered to one status, with eleven columns and a UTF-8 byte order mark.",
  answer:
    "On the Leads screen, pick a status in the dropdown beside Export CSV — or leave it on All statuses — and choose Export CSV. The file downloads immediately with eleven columns, newest lead first.",
  updated: "2026-08-30",
  keywords: ["export leads", "csv", "download leads", "leads spreadsheet", "lead export columns"],
  intro: [
    {
      kind: "p",
      text: [
        "The export is the whole table, not the page you are looking at, and it is the way to get your contacts into a CRM, a mail tool or a spreadsheet.",
      ],
    },
  ],
  steps: [
    {
      title: "Open Leads",
      body: [
        {
          kind: "p",
          text: [
            { kind: "strong", text: "Leads" },
            " in the workspace sidebar. The export control sits at the top right, next to Manual add.",
          ],
        },
      ],
    },
    {
      title: "Choose the scope",
      body: [
        {
          kind: "p",
          text: [
            "The dropdown to the left of the button reads ",
            { kind: "strong", text: "All statuses" },
            " by default. The alternatives are New only, Qualified only, Contacted only, Converted only and Disqualified only.",
          ],
        },
        {
          kind: "note",
          tone: "note",
          title: "The dropdown offers one status the table does not",
          body: [
            "The status pills above the table are All, New, Qualified, Contacted and Customer — Customer being what the table calls a converted lead. The export dropdown uses the underlying words and adds Disqualified, which the table has no pill for.",
          ],
        },
      ],
    },
    {
      title: "Choose Export CSV",
      body: [
        {
          kind: "p",
          text: [
            "The button reads ",
            { kind: "strong", text: "Preparing CSV…" },
            " while it works, then the browser downloads the file and a green line confirms the name. Nothing is emailed and nothing is stored — the file goes straight to your downloads folder.",
          ],
        },
      ],
    },
    {
      title: "Find the file",
      body: [
        {
          kind: "p",
          text: [
            "It is named ",
            { kind: "code", text: "garuda-leads-YYYY-MM-DD.csv" },
            ", with the status inserted when you filtered — for example ",
            { kind: "code", text: "garuda-leads-qualified-2026-08-30.csv" },
            ".",
          ],
        },
      ],
    },
    {
      title: "Know what is in it",
      body: [
        {
          kind: "p",
          text: ["Eleven columns, in this order, with the newest lead first:"],
        },
        {
          kind: "table",
          caption: "The columns in a Garuda lead export",
          columns: ["Column", "Contents"],
          rows: [
            { header: "id", cells: [["The lead identifier."]] },
            { header: "created_at", cells: [["When the lead was captured, in UTC."]] },
            { header: "updated_at", cells: [["When it was last changed, in UTC."]] },
            { header: "name", cells: [["The name given, if any."]] },
            { header: "email", cells: [["The email address."]] },
            { header: "phone", cells: [["The phone number."]] },
            { header: "company", cells: [["The company given, if any."]] },
            {
              header: "status",
              cells: [["new, qualified, contacted, converted or disqualified."]],
            },
            {
              header: "source",
              cells: [
                [
                  { kind: "code", text: "widget" },
                  " for a consented capture, ",
                  { kind: "code", text: "manual" },
                  " for a row typed in by hand.",
                ],
              ],
            },
            { header: "agent_id", cells: [["Which agent the lead came from."]] },
            { header: "notes", cells: [["Notes recorded on the lead."]] },
          ],
        },
      ],
    },
    {
      title: "Open it",
      body: [
        {
          kind: "p",
          text: [
            "The file starts with a UTF-8 byte order mark, so Excel reads accented names correctly instead of turning them into nonsense. Every other spreadsheet and CSV reader skips it.",
          ],
        },
      ],
    },
  ],
  after: [
    {
      kind: "note",
      tone: "note",
      title: "Why some cells start with an apostrophe",
      body: [
        "A cell that would otherwise begin with =, +, - or @ is written with a leading single quote. Those characters make a spreadsheet evaluate the cell as a formula, and this text was typed by a stranger into a website widget. The quote makes the spreadsheet treat it as plain text. Delete it if you need the raw value.",
      ],
    },
    {
      kind: "p",
      text: [
        "Custom lead-form answers are stored with the lead but are not columns in this file. The eleven columns above are the whole export.",
      ],
    },
  ],
  stuck: [
    {
      problem: "Export CSV is greyed out",
      body: [
        {
          kind: "p",
          text: [
            "The screen has not connected to the API, and a line under the buttons says so. Reload the page; if it persists, sign out and back in.",
          ],
        },
      ],
    },
    {
      problem: "The export says your session has expired",
      body: [
        {
          kind: "p",
          text: ["Sign in again and repeat the export. Nothing was downloaded, so nothing was lost."],
        },
      ],
    },
    {
      problem: "The file downloaded but has only a header row",
      body: [
        {
          kind: "p",
          text: [
            "The status filter matched nothing. Set the dropdown back to All statuses and export again.",
          ],
        },
      ],
    },
    {
      problem: "You are exporting repeatedly and it starts failing",
      body: [
        {
          kind: "p",
          text: [
            "The export is rate limited to 30 requests a minute per workspace. Wait a moment and try again.",
          ],
        },
      ],
    },
  ],
  related: [
    "reading-conversations-and-leads",
    "sending-leads-to-your-crm-with-a-webhook",
    "building-a-custom-lead-form",
  ],
};
