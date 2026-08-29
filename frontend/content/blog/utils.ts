import type { Article, Block, Inline } from "./types";

/** Words a typical adult reads per minute of continuous prose. Used only to
 *  produce the "N min read" estimate, which is an estimate and labelled as one. */
const WORDS_PER_MINUTE = 220;

function inlineText(run: Inline): string {
  return typeof run === "string" ? run : run.text;
}

function inlineRunsText(runs: Inline[]): string {
  return runs.map(inlineText).join(" ");
}

function blockText(block: Block): string {
  switch (block.kind) {
    case "h2":
    case "h3":
      return block.text;
    case "p":
      return inlineRunsText(block.text);
    case "ul":
    case "ol":
      return block.items.map(inlineRunsText).join(" ");
    case "steps":
      return block.items.map((item) => `${item.title} ${inlineRunsText(item.body)}`).join(" ");
    case "callout":
      return `${block.title} ${inlineRunsText(block.body)}`;
    case "code":
      return block.label;
    case "table":
      return [
        block.caption,
        ...block.columns,
        ...block.rows.map((row) => `${row.header} ${row.cells.map(inlineRunsText).join(" ")}`),
      ].join(" ");
  }
}

export function articleText(article: Article): string {
  return article.blocks.map(blockText).join(" ");
}

export function wordCount(article: Article): number {
  return articleText(article).split(/\s+/).filter(Boolean).length;
}

export function readingMinutes(article: Article): number {
  return Math.max(1, Math.round(wordCount(article) / WORDS_PER_MINUTE));
}

export type TocEntry = { id: string; text: string };

export function tableOfContents(article: Article): TocEntry[] {
  return article.blocks
    .filter((block): block is Extract<Block, { kind: "h2" }> => block.kind === "h2")
    .map((block) => ({ id: block.id, text: block.text }));
}

/** en-GB long form, rendered identically on server and client so hydration is stable. */
export function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
