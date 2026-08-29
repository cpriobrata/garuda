import type { Article } from "./types";
import { article as addChatbot } from "./how-to-add-an-ai-chatbot-to-your-website";
import { article as compare } from "./ai-chatbot-vs-live-chat-vs-contact-form";
import { article as grounding } from "./how-to-stop-your-ai-chatbot-inventing-answers";
import { article as privacy } from "./collecting-leads-from-website-chat-without-breaking-privacy-rules";

/** Newest first. The index renders them in this order. */
export const articles: Article[] = [addChatbot, compare, grounding, privacy];

export function getArticle(slug: string): Article | undefined {
  return articles.find((entry) => entry.slug === slug);
}

export function articleSlugs(): string[] {
  return articles.map((entry) => entry.slug);
}

export function relatedArticles(article: Article): Article[] {
  return article.related
    .map(getArticle)
    .filter((entry): entry is Article => Boolean(entry) && entry !== article);
}

export const BLOG_TITLE = "The Garuda blog";
export const BLOG_DESCRIPTION =
  "Practical writing about website chat for people who run small businesses: what to set up, what to avoid, and how to keep it accurate and honest.";

/** Canonical origin. The custom domain is the address we publish under. */
export const SITE_URL = "https://garuda.ravan.ai";

export function articleUrl(slug: string): string {
  return `${SITE_URL}/blog/${slug}`;
}

export type { Article };
