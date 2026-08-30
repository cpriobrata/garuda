/**
 * One place that builds page metadata and structured data.
 *
 * Every public page should call `pageMetadata` instead of hand-rolling a
 * Metadata object, so that title, description, canonical, Open Graph and
 * Twitter always come out in the same shape. The JSON-LD builders below cover
 * the four types that genuinely apply to this product: Organization,
 * SoftwareApplication, FAQPage and BreadcrumbList.
 *
 * About the Open Graph image: app/opengraph-image.tsx is file-based metadata,
 * and Next attaches it automatically only to routes that do NOT declare an
 * `openGraph` object of their own. A page that sets one — which is exactly what
 * this helper does — replaces the inherited object, image included, and would
 * ship a card with no picture. So `pageMetadata` points at that same generated
 * route explicitly. The cache-busting query Next appends is not part of the
 * route, so the bare path serves the identical image.
 */

import type { Metadata } from "next";

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://garuda.ravan.ai").replace(/\/+$/, "");
export const API_URL = "https://api.garuda.ravan.ai";
export const SITE_NAME = "Garuda";

/** The one-line description of the product, reused wherever a default is needed. */
export const SITE_DESCRIPTION =
  "Garuda builds knowledge-grounded AI chat agents for your website. Answer four questions, edit the draft agent, publish it, and paste one script tag into your site.";

/** Price shown on the site, kept beside the backend value it mirrors (GARUDA_PLAN_AMOUNT_CENTS=1700). */
export const PLAN_PRICE_USD = "17";

/** Plan limits, mirroring backend/internal/config/plan.go. */
export const PLAN_LIMITS = {
  publishedAgents: 10,
  monthlyConversations: 100,
  conversationWindowDays: 30,
  knowledgeSourcesPerAgent: 5,
  charactersPerSource: 100_000,
} as const;

/** Alt text for the generated social card, shared with app/opengraph-image.tsx. */
export const OG_IMAGE_ALT = "Garuda — AI chat agents that answer from your own knowledge";

export function absoluteUrl(path = "/"): string {
  if (!path || path === "/") return `${SITE_URL}/`;
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * Public marketing routes, and the sitemap's only source of truth for static
 * pages.
 *
 * ADDING A PUBLIC PAGE? Add its path here. That is the whole job — app/sitemap.ts
 * reads this list, and a page that is not in it will never be submitted to a
 * search engine. Blog articles are the one exception: the sitemap derives those
 * from content/blog so a new article needs no edit here.
 *
 * Deliberately absent:
 *   - /app, /auth and /checkout need a session to be useful. They are disallowed
 *     in robots.ts and must never appear in the sitemap.
 *   - /pricing, /login, /signup, /dashboard, /onboarding and /reset-password are
 *     redirects. A sitemap should list the destination of a redirect, not the
 *     redirect. The moment app/pricing/page.tsx becomes a page of its own rather
 *     than a redirect to the "#pricing" section of the home page, add
 *     { path: "/pricing", priority: 0.9, changeFrequency: "monthly" } here.
 */
export const marketingRoutes: ReadonlyArray<{
  path: string;
  priority: number;
  changeFrequency: "daily" | "weekly" | "monthly" | "yearly";
}> = [
  { path: "/", priority: 1, changeFrequency: "weekly" },
  { path: "/faq", priority: 0.9, changeFrequency: "monthly" },
  { path: "/integrations", priority: 0.8, changeFrequency: "monthly" },
  { path: "/use-cases", priority: 0.8, changeFrequency: "monthly" },
  { path: "/for", priority: 0.8, changeFrequency: "monthly" },
  { path: "/security", priority: 0.7, changeFrequency: "monthly" },
  { path: "/use-cases/after-hours-lead-capture", priority: 0.7, changeFrequency: "monthly" },
  { path: "/use-cases/repeat-questions", priority: 0.7, changeFrequency: "monthly" },
  { path: "/for/real-estate", priority: 0.7, changeFrequency: "monthly" },
  { path: "/for/home-services", priority: 0.7, changeFrequency: "monthly" },
  { path: "/for/professional-services", priority: 0.7, changeFrequency: "monthly" },
  { path: "/for/healthcare-clinics", priority: 0.7, changeFrequency: "monthly" },
  // Reachable, linked from the landing page and the footer, and previously
  // absent from the sitemap -- which for pages a buyer reads before paying is a
  // real loss, not a technicality.
  { path: "/help", priority: 0.7, changeFrequency: "weekly" },
  { path: "/blog", priority: 0.6, changeFrequency: "weekly" },
  { path: "/support", priority: 0.5, changeFrequency: "monthly" },
  { path: "/contact", priority: 0.5, changeFrequency: "monthly" },
  { path: "/refunds", priority: 0.4, changeFrequency: "yearly" },
  { path: "/privacy", priority: 0.4, changeFrequency: "yearly" },
  { path: "/terms", priority: 0.4, changeFrequency: "yearly" },
];

type PageMetadataInput = {
  /** Bare page name. The root layout template appends " · Garuda". */
  title: string;
  description: string;
  /** Site-relative path, e.g. "/faq". Used for the canonical and og:url. */
  path: string;
  /** Full title for social cards, where no template is applied. */
  socialTitle?: string;
  /** Set false for pages that should stay out of search results. */
  index?: boolean;
};

export function pageMetadata({ title, description, path, socialTitle, index = true }: PageMetadataInput): Metadata {
  const url = absoluteUrl(path);
  const shareTitle = socialTitle ?? `${title} · ${SITE_NAME}`;
  const images = [{ url: absoluteUrl("/opengraph-image"), width: 1200, height: 630, alt: OG_IMAGE_ALT }];
  return {
    metadataBase: new URL(SITE_URL),
    title,
    description,
    alternates: { canonical: url },
    robots: index
      ? {
          index: true,
          follow: true,
          googleBot: { index: true, follow: true, "max-snippet": -1, "max-image-preview": "large", "max-video-preview": -1 },
        }
      : { index: false, follow: false },
    openGraph: { type: "website", url, siteName: SITE_NAME, title: shareTitle, description, locale: "en_US", images },
    twitter: { card: "summary_large_image", title: shareTitle, description, images },
  };
}

/* ---------------------------------------------------------------------------
 * Structured data
 * ------------------------------------------------------------------------ */

export type JsonLd = Record<string, unknown>;

export const ORGANIZATION_ID = `${SITE_URL}/#organization`;
export const SOFTWARE_ID = `${SITE_URL}/#software`;

export function organizationJsonLd(): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": ORGANIZATION_ID,
    name: SITE_NAME,
    url: absoluteUrl("/"),
    description: SITE_DESCRIPTION,
  };
}

export function softwareApplicationJsonLd(featureList: string[]): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "@id": SOFTWARE_ID,
    name: SITE_NAME,
    url: absoluteUrl("/"),
    applicationCategory: "BusinessApplication",
    applicationSubCategory: "AI chat agent for websites",
    operatingSystem: "Any modern web browser",
    description: SITE_DESCRIPTION,
    publisher: { "@id": ORGANIZATION_ID },
    featureList,
    offers: {
      "@type": "Offer",
      price: PLAN_PRICE_USD,
      priceCurrency: "USD",
      category: "SaaS subscription",
      url: absoluteUrl("/pricing"),
      availability: "https://schema.org/InStock",
    },
  };
}

export type QuestionAnswer = { question: string; answer: string };

export function faqPageJsonLd(items: ReadonlyArray<QuestionAnswer>, path: string): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "@id": `${absoluteUrl(path)}#faq`,
    url: absoluteUrl(path),
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };
}

export function breadcrumbJsonLd(trail: ReadonlyArray<{ name: string; path: string }>): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      item: absoluteUrl(crumb.path),
    })),
  };
}

/**
 * Props for a <script type="application/ld+json"> tag. `<` is escaped so a
 * string inside the payload can never close the script element early.
 */
export function jsonLdScriptProps(data: JsonLd | JsonLd[]) {
  return {
    type: "application/ld+json",
    dangerouslySetInnerHTML: { __html: JSON.stringify(data).replace(/</g, "\\u003c") },
  };
}
