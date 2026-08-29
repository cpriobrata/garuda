import type { HelpArticle } from "./types";

export const article: HelpArticle = {
  slug: "building-a-custom-lead-form",
  category: "configuring",
  title: "Building a custom lead form",
  description:
    "Section 6 of Widget, Customize lets you set the heading, the submit text and up to 20 fields, each with a type and an identifier that decides where the answer is stored.",
  answer:
    "Turn on Show lead form, then use section 6 of Widget, Customize to set the heading, the submit text and up to 20 fields. Each field's identifier decides whether the answer lands on the lead record or in its custom answers.",
  updated: "2026-08-30",
  keywords: [
    "custom lead form",
    "lead form fields",
    "form builder",
    "dropdown field",
    "required field",
  ],
  intro: [
    {
      kind: "p",
      text: [
        "The builder is section 6 of the Customize tab, and it only appears once ",
        { kind: "strong", text: "Show lead form" },
        " is on in section 5. What you build here is exactly what the widget draws.",
      ],
    },
  ],
  steps: [
    {
      title: "Write the heading and the button",
      body: [
        {
          kind: "p",
          text: [
            { kind: "strong", text: "Form heading" },
            " takes up to 120 characters and ",
            { kind: "strong", text: "Submit button text" },
            " up to 40. Leave either empty and the widget uses its own wording.",
          ],
        },
      ],
    },
    {
      title: "Decide whether submissions are kept",
      body: [
        {
          kind: "p",
          text: [
            "The ",
            { kind: "strong", text: "Save submissions as leads" },
            " switch sits under the heading fields. With it off the form is drawn but nothing is stored, and the row says so.",
          ],
        },
      ],
    },
    {
      title: "Add and order the fields",
      body: [
        {
          kind: "p",
          text: [
            { kind: "strong", text: "Add custom field" },
            " appends a row. Each row has a label, a type, a Required switch, arrows to move it, and a bin to remove it. A form holds at most 20 fields.",
          ],
        },
        {
          kind: "table",
          caption: "The field types available in the lead form builder",
          columns: ["Type", "What the visitor gets"],
          rows: [
            { header: "Text", cells: [["A single-line box."]] },
            { header: "Email", cells: [["A single line validated as an email address."]] },
            { header: "Phone", cells: [["A single line validated as a phone number."]] },
            { header: "Number", cells: [["A numeric box."]] },
            { header: "Long text", cells: [["A multi-line box."]] },
            { header: "Dropdown", cells: [["A list you define. It needs at least two options."]] },
            { header: "Checkbox", cells: [["A single tick box."]] },
            { header: "Date", cells: [["A date picker."]] },
          ],
        },
      ],
    },
    {
      title: "Understand the identifier under each row",
      body: [
        {
          kind: "p",
          text: [
            "Every row shows a small monospaced identifier. It is derived from the label when the field is first created, and it is the key answers are stored under. Four identifiers are special:",
          ],
        },
        {
          kind: "ul",
          items: [
            [
              { kind: "code", text: "name" },
              ", ",
              { kind: "code", text: "email" },
              ", ",
              { kind: "code", text: "phone" },
              " and ",
              { kind: "code", text: "company" },
              " land on the lead record's own columns. The row is badged ",
              { kind: "strong", text: "Saved on the lead record" },
              ", and those are the columns the Leads table and the CSV export show.",
            ],
            [
              "Any other identifier is stored as a custom answer alongside the lead, badged ",
              { kind: "strong", text: "Saved as a custom answer" },
              ".",
            ],
          ],
        },
        {
          kind: "note",
          tone: "note",
          title: "Relabelling a field never changes its identifier",
          body: [
            "That is on purpose. Renaming Email to Work email keeps the identifier email, so every address already collected under it stays attached to the right column instead of being orphaned.",
          ],
        },
      ],
    },
    {
      title: "Fill in dropdown options",
      body: [
        {
          kind: "p",
          text: [
            "Choosing Dropdown reveals an options editor under the row. Type an option and press Enter or choose Add; remove one with the small cross on its chip. Two options is the minimum. Switching the field to any other type discards the options.",
          ],
        },
      ],
    },
    {
      title: "Clear the warnings, then save",
      body: [
        {
          kind: "p",
          text: [
            "An amber block headed ",
            { kind: "strong", text: "This form cannot be saved yet" },
            " lists anything that would be rejected. It applies the same rules the server does, so clearing it means the save will go through.",
          ],
        },
        {
          kind: "ul",
          items: [
            ["every field needs a label"],
            ["every field needs an identifier of letters, digits, dashes or underscores"],
            ["two fields may not share an identifier"],
            ["a dropdown needs at least two options"],
            [
              "the form needs an email or a phone field, otherwise a submission cannot be saved as a lead at all",
            ],
          ],
        },
      ],
    },
  ],
  after: [
    {
      kind: "p",
      text: [
        "Whatever you build, the widget adds the consent checkbox itself and refuses to submit until it is ticked. You cannot remove it, and the server independently rejects any submission that arrives without consent.",
      ],
    },
    {
      kind: "note",
      tone: "note",
      title: "Sizes the server enforces on a submission",
      body: [
        "At most 20 custom answers, an identifier of at most 64 characters, and an answer of at most 500 characters. A form that passes the builder always fits inside these.",
      ],
    },
  ],
  stuck: [
    {
      problem: "The section is not there",
      body: [
        {
          kind: "p",
          text: [
            "Show lead form in section 5 is off. Turn it on and section 6 opens; note that this also switches Autostart off.",
          ],
        },
      ],
    },
    {
      problem: "Add custom field is greyed out",
      body: [{ kind: "p", text: ["The form already has 20 fields, which is the maximum."] }],
    },
    {
      problem: "The warning about an email or phone field will not clear",
      body: [
        {
          kind: "p",
          text: [
            "The check is on the field ",
            { kind: "strong", text: "type" },
            ", not the label. A field labelled Email but typed as Text does not count. Change its type to Email or Phone.",
          ],
        },
      ],
    },
    {
      problem: "Custom answers are not in the CSV export",
      body: [
        {
          kind: "p",
          text: [
            "The export carries the lead record's own columns only. Answers stored under a custom identifier are kept with the lead but are not columns in the file — see ",
            { kind: "link", text: "Exporting your leads", href: "/help/exporting-your-leads" },
            " for exactly what the file contains.",
          ],
        },
      ],
    },
  ],
  related: [
    "setting-up-lead-capture-and-consent",
    "customising-the-widget-appearance",
    "exporting-your-leads",
  ],
};
