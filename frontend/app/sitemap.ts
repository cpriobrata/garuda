import type { MetadataRoute } from "next";
import { articles } from "@/content/blog";
import { absoluteUrl, marketingRoutes } from "@/lib/seo";

/**
 * Served at /sitemap.xml.
 *
 * Public marketing pages only. The workspace (/app), the auth screens and the
 * checkout funnel are excluded here and disallowed in robots.ts: they need a
 * session to be useful, so indexing them would only put sign-in pages into
 * search results.
 *
 * Static routes come from `marketingRoutes` in lib/seo.ts. Blog entries are
 * derived from the article modules so a new article is listed the moment it is
 * added, with its own dateModified as the lastmod. Anything malformed is
 * skipped rather than emitted as a broken entry.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const staticEntries: MetadataRoute.Sitemap = marketingRoutes.map((route) => ({
    url: absoluteUrl(route.path),
    lastModified: now,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));

  const posts = Array.isArray(articles) ? articles : [];

  const blogEntries: MetadataRoute.Sitemap = posts.flatMap((article) => {
    const slug = typeof article?.slug === "string" ? article.slug.trim() : "";
    if (!slug) return [];
    const modified = new Date(article.dateModified ?? article.datePublished);
    return [
      {
        url: absoluteUrl(`/blog/${slug}`),
        lastModified: Number.isNaN(modified.getTime()) ? now : modified,
        changeFrequency: "monthly" as const,
        priority: 0.6,
      },
    ];
  });

  const blogIndex: MetadataRoute.Sitemap = blogEntries.length
    ? [{ url: absoluteUrl("/blog"), lastModified: now, changeFrequency: "weekly" as const, priority: 0.7 }]
    : [];

  return [...staticEntries, ...blogIndex, ...blogEntries];
}
