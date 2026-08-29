import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArticleCard } from "@/components/blog/article-card";
import { JsonLd } from "@/components/blog/json-ld";
import { articles, articleUrl, BLOG_DESCRIPTION, BLOG_TITLE, SITE_URL } from "@/content/blog";

const canonical = `${SITE_URL}/blog`;

export const metadata: Metadata = {
  title: BLOG_TITLE,
  description: BLOG_DESCRIPTION,
  alternates: { canonical },
  openGraph: {
    type: "website",
    url: canonical,
    title: `${BLOG_TITLE} · Garuda`,
    description: BLOG_DESCRIPTION,
    siteName: "Garuda",
  },
  twitter: { card: "summary", title: `${BLOG_TITLE} · Garuda`, description: BLOG_DESCRIPTION },
};

export default function BlogIndexPage() {
  const [featured, ...rest] = articles;

  return (
    <main>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "Blog",
          "@id": canonical,
          name: BLOG_TITLE,
          description: BLOG_DESCRIPTION,
          url: canonical,
          inLanguage: "en",
          publisher: { "@type": "Organization", name: "Garuda", url: SITE_URL },
          blogPost: articles.map((article) => ({
            "@type": "BlogPosting",
            headline: article.title,
            description: article.description,
            datePublished: article.datePublished,
            dateModified: article.dateModified,
            url: articleUrl(article.slug),
            author: { "@type": "Organization", name: "Garuda", url: SITE_URL },
          })),
        }}
      />

      <section className="relative overflow-hidden border-b border-slate-100 pb-14 pt-14 sm:pt-20">
        <div className="surface-grid pointer-events-none absolute inset-0" aria-hidden="true" />
        <div
          className="pointer-events-none absolute left-[10%] top-4 h-64 w-64 rounded-full bg-indigo-100/70 blur-[100px]"
          aria-hidden="true"
        />
        <div className="container relative max-w-3xl">
          <Badge variant="outline" className="mb-5 border-indigo-200 text-indigo-700">
            Writing
          </Badge>
          <h1 className="text-balance text-4xl font-bold leading-[1.08] tracking-[-.045em] text-slate-950 sm:text-6xl">
            Notes on doing website chat <span className="gradient-text">properly.</span>
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">
            {BLOG_DESCRIPTION} No growth-hacking, no invented statistics, and a straight answer when the
            honest one is that you should not build the thing at all.
          </p>
        </div>
      </section>

      <section className="py-14 sm:py-20">
        <div className="container">
          <h2 className="sr-only">Articles</h2>
          <div className="grid gap-5 sm:grid-cols-2">
            <ArticleCard article={featured} featured />
            {rest.map((article) => (
              <ArticleCard key={article.slug} article={article} />
            ))}
          </div>
        </div>
      </section>

      <section className="pb-20 sm:pb-28">
        <div className="container">
          <div className="relative overflow-hidden rounded-[28px] bg-slate-950 px-6 py-12 text-center text-white sm:px-12 sm:py-16">
            <div
              className="pointer-events-none absolute -left-24 -top-24 h-64 w-64 rounded-full bg-indigo-600/45 blur-[90px]"
              aria-hidden="true"
            />
            <div
              className="pointer-events-none absolute -bottom-32 -right-20 h-72 w-72 rounded-full bg-violet-600/35 blur-[100px]"
              aria-hidden="true"
            />
            <div className="relative mx-auto max-w-2xl">
              <h2 className="text-balance text-3xl font-bold tracking-[-.04em] sm:text-4xl">
                Ready to try the thing we keep writing about?
              </h2>
              <p className="mx-auto mt-4 max-w-xl text-base leading-7 text-slate-300">
                Garuda builds a knowledge-grounded chat agent for your website from a short conversation
                about your business. You edit it, test it, and publish it when you are happy.
              </p>
              <Button size="lg" className="mt-7 bg-white text-slate-950 hover:bg-slate-100" asChild>
                <Link href="/auth/sign-up">
                  Create my Garuda agent
                  <ArrowRight aria-hidden="true" className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
