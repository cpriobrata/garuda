// Help-centre source lives in typed TypeScript modules rather than MDX or a CMS.
//
// The trade is the same one content/blog makes: no new dependency, no runtime
// parsing, and the compiler catches a broken link target or a step with no body
// before a customer reads it. The shape below is deliberately narrower than the
// blog's, because every article here answers exactly one task-shaped question:
// a one-line answer, numbered steps, and what to do when the steps did not work.

/** A run of text inside a paragraph, list item or table cell. */
export type Inline =
  | string
  | { kind: "strong"; text: string }
  | { kind: "code"; text: string }
  | { kind: "link"; text: string; href: string };

export type NoteTone = "note" | "caution" | "tip";

export type Block =
  | { kind: "p"; text: Inline[] }
  | { kind: "ul"; items: Inline[][] }
  | { kind: "ol"; items: Inline[][] }
  | { kind: "note"; tone: NoteTone; title: string; body: Inline[] }
  | { kind: "code"; label: string; code: string }
  | {
      kind: "table";
      caption: string;
      columns: string[];
      rows: { header: string; cells: Inline[][] }[];
    };

/** One numbered step. The title is the action; the body is everything else. */
export type Step = { title: string; body: Block[] };

/** One entry in the "if it still does not work" section. */
export type Remedy = { problem: string; body: Block[] };

export type HelpCategoryId = "getting-started" | "configuring" | "operating" | "troubleshooting";

export type HelpCategory = {
  id: HelpCategoryId;
  label: string;
  /** One line describing what this group of articles covers. */
  blurb: string;
};

export type HelpArticle = {
  slug: string;
  category: HelpCategoryId;
  /** Rendered as the page's single h1. */
  title: string;
  /** Shorter variant for the browser tab. Falls back to `title`. */
  metaTitle?: string;
  /** Meta description, and the summary shown on the index card. */
  description: string;
  /**
   * The whole answer in one sentence, shown before the steps. A reader who
   * only reads this line should already be able to act.
   */
  answer: string;
  /** Optional context between the answer and the first step. */
  intro?: Block[];
  steps: Step[];
  /** Optional context after the last step and before the remedies. */
  after?: Block[];
  /** "If it still does not work." Never empty: every article ends with one. */
  stuck: Remedy[];
  /** Slugs of the articles worth reading next. */
  related: string[];
  /** ISO-8601 date the article was last checked against the running product. */
  updated: string;
  keywords: string[];
};
