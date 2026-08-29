import type { HelpArticle, HelpCategory, HelpCategoryId } from "./types";

import { article as creatingYourFirstAgent } from "./creating-your-first-agent";
import { article as addingKnowledge } from "./adding-knowledge-your-agent-can-answer-from";
import { article as installingTheWidget } from "./installing-the-widget-on-your-website";
import { article as approvingDomains } from "./approving-the-domains-your-agent-may-run-on";
import { article as customisingAppearance } from "./customising-the-widget-appearance";
import { article as leadCaptureAndConsent } from "./setting-up-lead-capture-and-consent";
import { article as customLeadForm } from "./building-a-custom-lead-form";
import { article as whatsAppHandoff } from "./handing-a-conversation-to-a-person-on-whatsapp";
import { article as connectingAnIntegration } from "./connecting-an-integration";
import { article as outboundWebhooks } from "./sending-leads-to-your-crm-with-a-webhook";
import { article as conversationsAndLeads } from "./reading-conversations-and-leads";
import { article as exportingLeads } from "./exporting-your-leads";
import { article as pausingAnAgent } from "./pausing-or-unpublishing-an-agent";
import { article as widgetNotShowing } from "./my-widget-is-not-showing-up";

export const HELP_TITLE = "Garuda help centre";
export const HELP_DESCRIPTION =
  "Task-shaped guides to running a Garuda agent: creating one, teaching it, installing the widget, capturing leads with consent, handing a conversation to a person, and fixing the widget when it does not appear.";

/** The four groups, in the order the index renders them. */
export const helpCategories: readonly HelpCategory[] = [
  {
    id: "getting-started",
    label: "Getting started",
    blurb: "From an empty workspace to a working chat widget on your own site.",
  },
  {
    id: "configuring",
    label: "Configuring",
    blurb: "How the widget looks, what it asks for, and where the answers go.",
  },
  {
    id: "operating",
    label: "Operating",
    blurb: "Living with it: reading what came in, getting it out, and turning it off.",
  },
  {
    id: "troubleshooting",
    label: "Troubleshooting",
    blurb: "The problems people actually hit, in the order worth checking them.",
  },
];

/**
 * Every article, in reading order within its category. The index groups this
 * list rather than keeping a second copy of the ordering, so an article added
 * here appears on the index, in search, and as a static route with no other
 * edit.
 */
export const helpArticles: readonly HelpArticle[] = [
  creatingYourFirstAgent,
  addingKnowledge,
  installingTheWidget,
  approvingDomains,
  customisingAppearance,
  leadCaptureAndConsent,
  customLeadForm,
  whatsAppHandoff,
  connectingAnIntegration,
  outboundWebhooks,
  conversationsAndLeads,
  exportingLeads,
  pausingAnAgent,
  widgetNotShowing,
];

export function getHelpArticle(slug: string): HelpArticle | undefined {
  return helpArticles.find((entry) => entry.slug === slug);
}

export function helpArticleSlugs(): string[] {
  return helpArticles.map((entry) => entry.slug);
}

export function articlesInCategory(category: HelpCategoryId): HelpArticle[] {
  return helpArticles.filter((entry) => entry.category === category);
}

export function categoryLabel(category: HelpCategoryId): string {
  return helpCategories.find((entry) => entry.id === category)?.label ?? category;
}

/**
 * The articles listed at the foot of a piece. A slug that does not resolve is
 * dropped rather than rendered as a dead link, and an article never lists
 * itself.
 */
export function relatedHelpArticles(article: HelpArticle): HelpArticle[] {
  return article.related
    .map(getHelpArticle)
    .filter((entry): entry is HelpArticle => Boolean(entry) && entry?.slug !== article.slug);
}

export function helpArticlePath(slug: string): string {
  return `/help/${slug}`;
}

export type { HelpArticle, HelpCategory, HelpCategoryId };
