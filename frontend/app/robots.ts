import type { MetadataRoute } from "next";
import { SITE_URL, absoluteUrl } from "@/lib/seo";

/**
 * Served at /robots.txt.
 *
 * Two decisions worth stating plainly:
 *
 * 1. Everything private is disallowed. /app is the signed-in workspace, /auth
 *    holds the sign-in, sign-up, verification and password screens, and
 *    /checkout is the payment funnel. None of them are useful without a
 *    session, and none belong in a search result.
 *
 * 2. Answer engines are welcome. The public pages exist to be read and quoted,
 *    so the crawlers behind AI answers get their own rule group with the same
 *    permissions as everyone else, stated explicitly rather than left to a
 *    wildcard.
 */
const disallow = ["/app/", "/app", "/auth/", "/auth", "/checkout/", "/checkout"];

const answerEngineCrawlers = [
  "Applebot-Extended",
  "ChatGPT-User",
  "Claude-User",
  "ClaudeBot",
  "GPTBot",
  "Google-Extended",
  "OAI-SearchBot",
  "PerplexityBot",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow },
      { userAgent: answerEngineCrawlers, allow: "/", disallow },
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
    host: SITE_URL,
  };
}
