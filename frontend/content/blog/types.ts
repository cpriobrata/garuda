// Article source lives in typed TypeScript modules rather than MDX or a CMS.
// The trade is deliberate: no new dependency, no runtime parsing, and the
// compiler catches a malformed heading or a missing anchor before the article
// ever reaches a reader.

/** A run of text inside a paragraph, list item or table cell. */
export type Inline =
  | string
  | { kind: "strong"; text: string }
  | { kind: "em"; text: string }
  | { kind: "code"; text: string }
  | { kind: "link"; text: string; href: string };

export type Block =
  /** Section heading. `id` is the anchor the table of contents links to. */
  | { kind: "h2"; id: string; text: string }
  | { kind: "h3"; text: string }
  | { kind: "p"; text: Inline[] }
  | { kind: "ul"; items: Inline[][] }
  | { kind: "ol"; items: Inline[][] }
  | { kind: "steps"; items: { title: string; body: Inline[] }[] }
  | { kind: "callout"; tone: CalloutTone; title: string; body: Inline[] }
  | { kind: "code"; label: string; code: string }
  | {
      kind: "table";
      caption: string;
      columns: string[];
      rows: { header: string; cells: Inline[][] }[];
    };

export type CalloutTone = "note" | "caution" | "tip";

export type Article = {
  slug: string;
  /** Rendered as the page's single h1. */
  title: string;
  /** Shorter variant for <title> and search results. Falls back to `title`. */
  metaTitle?: string;
  /** Meta description and Article JSON-LD description. */
  description: string;
  /** Standfirst shown above the article and on the index card. */
  excerpt: string;
  /** ISO-8601 date. The day the article was first published, never back-dated. */
  datePublished: string;
  /** ISO-8601 date. Shown to readers as the last-updated date. */
  dateModified: string;
  author: string;
  topic: string;
  keywords: string[];
  blocks: Block[];
  /** Slugs of articles worth reading next. */
  related: string[];
};
