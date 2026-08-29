import type { Metadata, Viewport } from "next";
import { MetaPixel } from "@/components/analytics/meta-pixel";
import {
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_URL,
  absoluteUrl,
  jsonLdScriptProps,
  organizationJsonLd,
  softwareApplicationJsonLd,
} from "@/lib/seo";
import "./globals.css";

/**
 * The site shell.
 *
 * Metadata here is the site-wide default: the title template, the fallback
 * description, and the Open Graph and Twitter shapes every page inherits unless
 * it sets its own through `pageMetadata` in lib/seo.ts. `metadataBase` is what
 * lets each page declare a relative canonical and still emit an absolute URL.
 *
 * Canonicals are deliberately NOT declared here. A canonical set on the root
 * layout is inherited by every route that does not override it, which would have
 * the workspace and auth screens all claiming to be the home page.
 *
 * The Open Graph image is file-based (app/opengraph-image.tsx) and applies to
 * every route, so the Twitter card is a large-image card and no image is
 * declared in config metadata, which would only fight the file convention.
 */
const TITLE = "Garuda — AI chat agents that answer from your own knowledge";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: TITLE, template: `%s · ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: [
    "AI chat agent",
    "website chatbot",
    "knowledge-grounded assistant",
    "consent-based lead capture",
    "embeddable chat widget",
  ],
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    url: absoluteUrl("/"),
    title: TITLE,
    description: SITE_DESCRIPTION,
    locale: "en_US",
  },
  twitter: { card: "summary_large_image", title: TITLE, description: SITE_DESCRIPTION },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#fafbff" };

/**
 * Site-wide structured data: the organisation that publishes the product, and
 * the product itself with its one real price. Both come from lib/seo.ts, so
 * every page that emits the same nodes emits them identically and under the same
 * @id — which is what lets a consumer merge them rather than see a contradiction.
 *
 * There is no aggregateRating and no review. Garuda has no public customers yet,
 * and inventing either would be a lie that a single search resolves.
 */
const siteFeatureList = [
  "Conversational onboarding that drafts an agent from four questions",
  "Answers grounded in knowledge sources the owner approves",
  "Consent-based lead capture stored with its conversation",
  "Opt-in returning-visitor memory using agent-scoped tokens",
  "Shadow-DOM isolated widget restricted to approved domains",
  "Customer-owned third-party account connections through Composio",
];

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        {children}
        <script {...jsonLdScriptProps([organizationJsonLd(), softwareApplicationJsonLd(siteFeatureList)])} />
        <MetaPixel />
      </body>
    </html>
  );
}
