import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { HelpBreadcrumb, HelpChrome, HelpContactBlock } from "@/components/help/help-chrome";
import { HelpSearch, type HelpSearchEntry } from "@/components/help/help-search";
import { HELP_DESCRIPTION, HELP_TITLE, helpArticles, helpCategories } from "@/content/help";
import { breadcrumbJsonLd, jsonLdScriptProps, pageMetadata } from "@/lib/seo";

const PATH = "/help";
const REVIEWED = "30 August 2026";

export const metadata: Metadata = pageMetadata({
  title: "Help centre",
  description: HELP_DESCRIPTION,
  path: PATH,
  socialTitle: HELP_TITLE,
});

const trail = [
  { name: "Home", path: "/" },
  { name: "Help centre", path: PATH },
];

/**
 * The help index.
 *
 * Every article is rendered into the page as a link before any JavaScript runs;
 * the search box filters what is already there. That keeps the page complete
 * for a reader with scripting off and for a crawler, and it means the search
 * cannot go out of date with the list beside it.
 */
export default function HelpIndexPage() {
  const entries: HelpSearchEntry[] = helpArticles.map((article) => ({
    slug: article.slug,
    title: article.title,
    description: article.description,
    category: article.category,
    keywords: article.keywords,
  }));

  return (
    <HelpChrome>
      <script {...jsonLdScriptProps([breadcrumbJsonLd(trail)])} />

      <section className="relative border-b border-slate-100 pb-12 pt-10 sm:pb-16 sm:pt-14">
        <div className="surface-grid pointer-events-none absolute inset-0" aria-hidden="true" />
        <div className="container relative max-w-3xl">
          <HelpBreadcrumb trail={trail} />
          <Badge variant="outline" className="mb-4 border-indigo-200 text-indigo-700">
            Help centre
          </Badge>
          <h1 className="text-balance text-3xl font-bold tracking-[-0.035em] text-slate-950 sm:text-5xl">
            {HELP_TITLE}
          </h1>
          <p className="mt-5 text-pretty text-lg leading-8 text-slate-600">
            Short, task-shaped guides to running a Garuda agent. Each one answers a single question completely: what to
            click, in what order, and what to do when it does not work.
          </p>
          <p className="mt-6 text-xs font-medium text-slate-500">
            Checked against the running product on {REVIEWED}. Where something is not built yet, the article says so
            rather than describing a screen that does not exist.
          </p>
        </div>
      </section>

      <div className="container max-w-3xl py-12 sm:py-16">
        <HelpSearch categories={helpCategories} entries={entries} />

        <section aria-labelledby="help-elsewhere" className="mt-14 border-t border-slate-100 pt-10">
          <h2 id="help-elsewhere" className="text-xl font-semibold tracking-[-0.02em] text-slate-950">
            Not what you were looking for?
          </h2>
          <p className="mt-3 text-[15px] leading-7 text-slate-600">
            The{" "}
            <Link
              href="/faq"
              className="rounded-sm font-medium text-indigo-700 underline decoration-indigo-300 underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              frequently asked questions
            </Link>{" "}
            cover what Garuda is and what it costs. The{" "}
            <Link
              href="/security"
              className="rounded-sm font-medium text-indigo-700 underline decoration-indigo-300 underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              security and data handling page
            </Link>{" "}
            covers consent, visitor identity and the third parties in the data path. The{" "}
            <Link
              href="/blog"
              className="rounded-sm font-medium text-indigo-700 underline decoration-indigo-300 underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              blog
            </Link>{" "}
            is for the wider questions about website chat rather than for operating this product.
          </p>
        </section>
      </div>

      <HelpContactBlock />
    </HelpChrome>
  );
}
