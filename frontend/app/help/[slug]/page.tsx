import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, LifeBuoy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { HelpBreadcrumb, HelpChrome, HelpContactBlock } from "@/components/help/help-chrome";
import { Blocks } from "@/components/help/help-prose";
import {
  categoryLabel,
  getHelpArticle,
  helpArticles,
  helpArticlePath,
  relatedHelpArticles,
} from "@/content/help";
import { absoluteUrl, breadcrumbJsonLd, jsonLdScriptProps, pageMetadata, SITE_NAME } from "@/lib/seo";

type PageProps = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return helpArticles.map((article) => ({ slug: article.slug }));
}

/** The catalogue is a fixed list, so an unknown slug is a 404 and not a render. */
export const dynamicParams = false;

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const article = getHelpArticle(slug);
  if (!article) return { title: "Article not found" };
  return {
    ...pageMetadata({
      title: article.metaTitle ?? article.title,
      description: article.description,
      path: helpArticlePath(article.slug),
      socialTitle: `${article.title} · ${SITE_NAME} help`,
    }),
    keywords: article.keywords,
  };
}

export default async function HelpArticlePage({ params }: PageProps) {
  const { slug } = await params;
  const article = getHelpArticle(slug);
  if (!article) notFound();

  const path = helpArticlePath(article.slug);
  const url = absoluteUrl(path);
  const label = categoryLabel(article.category);
  const related = relatedHelpArticles(article);
  const trail = [
    { name: "Home", path: "/" },
    { name: "Help centre", path: "/help" },
    { name: article.title, path },
  ];
  const publisher = { "@type": "Organization", name: SITE_NAME, url: absoluteUrl("/") };

  return (
    <HelpChrome>
      <script
        {...jsonLdScriptProps([
          breadcrumbJsonLd(trail),
          {
            "@context": "https://schema.org",
            "@type": "TechArticle",
            "@id": url,
            mainEntityOfPage: { "@type": "WebPage", "@id": url },
            headline: article.title,
            description: article.description,
            url,
            inLanguage: "en",
            dateModified: article.updated,
            articleSection: label,
            keywords: article.keywords.join(", "),
            author: publisher,
            publisher,
            isAccessibleForFree: true,
          },
        ])}
      />

      <article>
        <header className="relative border-b border-slate-100 pb-10 pt-10 sm:pb-12 sm:pt-14">
          <div className="surface-grid pointer-events-none absolute inset-0" aria-hidden="true" />
          <div className="container relative max-w-3xl">
            <HelpBreadcrumb trail={trail} />
            <Badge variant="outline" className="mb-4 border-indigo-200 text-indigo-700">
              {label}
            </Badge>
            <h1 className="text-balance text-3xl font-bold tracking-[-0.035em] text-slate-950 sm:text-4xl">
              {article.title}
            </h1>
            <p className="mt-5 rounded-xl border border-indigo-100 bg-indigo-50/60 p-4 text-pretty text-base font-medium leading-7 text-indigo-950">
              {article.answer}
            </p>
            <p className="mt-5 text-xs font-medium text-slate-500">
              Last checked against the running product on{" "}
              {new Date(article.updated).toLocaleDateString("en-GB", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
              .
            </p>
          </div>
        </header>

        <div className="container max-w-3xl py-10 sm:py-14">
          {article.intro?.length ? <Blocks blocks={article.intro} className="mb-10" /> : null}

          <ol className="space-y-10">
            {article.steps.map((step, index) => (
              <li key={step.title} className="relative pl-11">
                <span
                  aria-hidden="true"
                  className="absolute left-0 top-0 grid h-8 w-8 place-items-center rounded-full bg-slate-950 text-xs font-bold text-white"
                >
                  {index + 1}
                </span>
                <h2 className="pt-1 text-lg font-semibold tracking-[-0.015em] text-slate-950">{step.title}</h2>
                <Blocks blocks={step.body} className="mt-3" />
              </li>
            ))}
          </ol>

          {article.after?.length ? <Blocks blocks={article.after} className="mt-12" /> : null}

          <section aria-labelledby="still-stuck" className="mt-14 rounded-2xl border border-slate-200 bg-slate-50/70 p-6 sm:p-8">
            <h2
              id="still-stuck"
              className="flex items-center gap-2.5 text-xl font-semibold tracking-[-0.02em] text-slate-950"
            >
              <LifeBuoy className="h-5 w-5 text-indigo-600" aria-hidden="true" />
              If it still does not work
            </h2>
            <div className="mt-6 space-y-7">
              {article.stuck.map((remedy) => (
                <div key={remedy.problem}>
                  <h3 className="text-[15px] font-semibold text-slate-900">{remedy.problem}</h3>
                  <Blocks blocks={remedy.body} className="mt-2" />
                </div>
              ))}
            </div>
          </section>

          {related.length ? (
            <section aria-labelledby="related-articles" className="mt-14 border-t border-slate-100 pt-10">
              <h2 id="related-articles" className="text-xl font-semibold tracking-[-0.02em] text-slate-950">
                Related articles
              </h2>
              <ul className="mt-5 space-y-3">
                {related.map((entry) => (
                  <li key={entry.slug}>
                    <Link
                      href={helpArticlePath(entry.slug)}
                      className="group flex items-start gap-4 rounded-xl border border-slate-200 bg-white p-5 transition-colors hover:border-indigo-200 hover:bg-indigo-50/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-[11px] font-semibold uppercase tracking-[.13em] text-slate-400">
                          {categoryLabel(entry.category)}
                        </span>
                        <span className="mt-1.5 block text-[15px] font-semibold text-slate-950">{entry.title}</span>
                        <span className="mt-1.5 block text-sm leading-6 text-slate-600">{entry.description}</span>
                      </span>
                      <ArrowRight
                        className="mt-1 h-4 w-4 shrink-0 text-slate-300 transition-colors group-hover:text-indigo-600"
                        aria-hidden="true"
                      />
                    </Link>
                  </li>
                ))}
              </ul>
              <p className="mt-6 text-sm text-slate-500">
                <Link
                  href="/help"
                  className="rounded-sm font-medium text-indigo-700 underline decoration-indigo-300 underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  Back to all help articles
                </Link>
              </p>
            </section>
          ) : null}
        </div>
      </article>

      <HelpContactBlock />
    </HelpChrome>
  );
}
