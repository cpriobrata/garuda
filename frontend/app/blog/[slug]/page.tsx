import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, CalendarDays, Clock3, PenLine, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArticleCard } from "@/components/blog/article-card";
import { ArticleTocInline, ArticleTocSidebar } from "@/components/blog/article-toc";
import { JsonLd } from "@/components/blog/json-ld";
import { Prose } from "@/components/blog/prose";
import { articles, articleUrl, getArticle, relatedArticles, SITE_URL } from "@/content/blog";
import { formatDate, readingMinutes, tableOfContents, wordCount } from "@/content/blog/utils";

type PageProps = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return articles.map((article) => ({ slug: article.slug }));
}

export const dynamicParams = false;

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const article = getArticle(slug);
  if (!article) return { title: "Article not found" };

  const canonical = articleUrl(article.slug);
  const title = article.metaTitle ?? article.title;

  return {
    title,
    description: article.description,
    keywords: article.keywords,
    alternates: { canonical },
    openGraph: {
      type: "article",
      url: canonical,
      title: `${title} · Garuda`,
      description: article.description,
      siteName: "Garuda",
      publishedTime: article.datePublished,
      modifiedTime: article.dateModified,
      authors: [article.author],
    },
    twitter: { card: "summary", title: `${title} · Garuda`, description: article.description },
  };
}

export default async function ArticlePage({ params }: PageProps) {
  const { slug } = await params;
  const article = getArticle(slug);
  if (!article) notFound();

  const canonical = articleUrl(article.slug);
  const entries = tableOfContents(article);
  const minutes = readingMinutes(article);
  const related = relatedArticles(article);
  const publisher = { "@type": "Organization", name: "Garuda", url: SITE_URL };

  return (
    <main>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "Article",
          "@id": canonical,
          mainEntityOfPage: { "@type": "WebPage", "@id": canonical },
          headline: article.title,
          description: article.description,
          url: canonical,
          inLanguage: "en",
          datePublished: article.datePublished,
          dateModified: article.dateModified,
          keywords: article.keywords.join(", "),
          articleSection: article.topic,
          wordCount: wordCount(article),
          timeRequired: `PT${minutes}M`,
          author: publisher,
          publisher,
          isAccessibleForFree: true,
        }}
      />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
            { "@type": "ListItem", position: 2, name: "Blog", item: `${SITE_URL}/blog` },
            { "@type": "ListItem", position: 3, name: article.title, item: canonical },
          ],
        }}
      />

      <div className="border-b border-slate-100 bg-slate-50/60">
        <div className="container max-w-3xl py-8 sm:py-12">
          <nav aria-label="Breadcrumb">
            <Link
              href="/blog"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 transition-colors hover:text-slate-900 motion-reduce:transition-none"
            >
              <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" />
              All articles
            </Link>
          </nav>

          <Badge variant="purple" className="mt-6">
            {article.topic}
          </Badge>

          <h1 className="mt-4 text-balance text-[34px] font-bold leading-[1.1] tracking-[-.042em] text-slate-950 sm:text-5xl">
            {article.title}
          </h1>

          <p className="mt-5 text-lg leading-8 text-slate-600">{article.excerpt}</p>

          <dl className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-slate-500">
            <div className="flex items-center gap-1.5">
              <PenLine aria-hidden="true" className="h-3.5 w-3.5" />
              <dt className="sr-only">Author</dt>
              <dd>{article.author}</dd>
            </div>
            <div className="flex items-center gap-1.5">
              <CalendarDays aria-hidden="true" className="h-3.5 w-3.5" />
              <dt>Published</dt>
              <dd>
                <time dateTime={article.datePublished}>{formatDate(article.datePublished)}</time>
              </dd>
            </div>
            <div className="flex items-center gap-1.5">
              <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />
              <dt>Last updated</dt>
              <dd className="font-medium text-slate-700">
                <time dateTime={article.dateModified}>{formatDate(article.dateModified)}</time>
              </dd>
            </div>
            <div className="flex items-center gap-1.5">
              <Clock3 aria-hidden="true" className="h-3.5 w-3.5" />
              <dt className="sr-only">Reading time</dt>
              <dd>{minutes} min read</dd>
            </div>
          </dl>
        </div>
      </div>

      <div className="container py-12 sm:py-16">
        <div className="mx-auto grid max-w-3xl gap-12 lg:mx-0 lg:max-w-none lg:grid-cols-[minmax(0,720px)_240px] lg:justify-center lg:gap-16">
          <article className="min-w-0">
            <ArticleTocInline entries={entries} />
            <Prose blocks={article.blocks} />

            <div className="mt-14 rounded-2xl border border-slate-200 bg-slate-50/70 p-6 sm:p-8">
              <h2 className="text-lg font-semibold tracking-tight text-slate-950">
                Try it on your own website
              </h2>
              <p className="mt-2 text-[15px] leading-7 text-slate-600">
                Garuda creates a knowledge-grounded chat agent from a short conversation about your
                business. You edit the draft, add the sources it may answer from, test it privately and
                publish it when you are happy. $17 a month.
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                <Button asChild>
                  <Link href="/auth/sign-up">
                    Start building
                    <ArrowRight aria-hidden="true" className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
                <Button variant="outline" asChild>
                  <Link href="/#pricing">See what is included</Link>
                </Button>
              </div>
            </div>
          </article>

          <ArticleTocSidebar entries={entries} />
        </div>
      </div>

      {related.length > 0 ? (
        <section className="border-t border-slate-100 bg-slate-50/60 py-14 sm:py-20">
          <div className="container">
            <h2 className="text-2xl font-bold tracking-[-.03em] text-slate-950">Read next</h2>
            <div className="mt-7 grid gap-5 sm:grid-cols-2">
              {related.map((entry) => (
                <ArticleCard key={entry.slug} article={entry} />
              ))}
            </div>
          </div>
        </section>
      ) : null}
    </main>
  );
}
