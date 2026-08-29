import Link from "next/link";
import { ArrowRight, ChevronRight } from "lucide-react";
import { Brand } from "@/components/brand";
import { SiteNav } from "@/components/site/site-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { breadcrumbJsonLd, jsonLdScriptProps, PLAN_PRICE_USD } from "@/lib/seo";

/**
 * One breadcrumb. Every crumb carries its own path, the last one included: the
 * current page is rendered as plain text but still needs a URL in the
 * BreadcrumbList that search engines read.
 */
export type Crumb = { label: string; href: string };

/**
 * Breadcrumbs, as a real ordered list inside a labelled nav. The last crumb is
 * the current page: it is plain text carrying aria-current rather than a link
 * to itself, which is what a screen reader user needs to hear.
 */
export function Breadcrumbs({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="text-sm">
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-slate-500">
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1;
          return (
            <li key={crumb.label} className="flex items-center gap-1.5">
              {index > 0 && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-300" aria-hidden="true" />}
              {last ? (
                <span aria-current="page" className="font-medium text-slate-700">
                  {crumb.label}
                </span>
              ) : (
                <Link href={crumb.href} className="rounded transition-colors hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                  {crumb.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Structured breadcrumbs for search engines, built from the same list. */
function BreadcrumbJsonLd({ crumbs }: { crumbs: Crumb[] }) {
  return <script {...jsonLdScriptProps(breadcrumbJsonLd(crumbs.map((crumb) => ({ name: crumb.label, path: crumb.href }))))} />;
}

export type PageShellProps = {
  crumbs: Crumb[];
  eyebrow: string;
  /** The single h1 for the page. Nothing else on the page may render an h1. */
  title: React.ReactNode;
  lede: string;
  /** Short factual chips under the lede. Keep every one of them checkable. */
  facts?: string[];
  /** The one call to action, repeated verbatim at the foot of the page. */
  cta: { label: string; href: string };
  /** A second, lower-commitment link beside the call to action. */
  secondary?: { label: string; href: string };
  children: React.ReactNode;
};

export function PageShell({ crumbs, eyebrow, title, lede, facts, cta, secondary, children }: PageShellProps) {
  return (
    <div className="bg-white">
      <SiteNav />
      <BreadcrumbJsonLd crumbs={crumbs} />

      <main id="main">
        <header className="relative border-b border-slate-100 pb-14 pt-8 sm:pb-16 sm:pt-10">
          <div className="surface-grid pointer-events-none absolute inset-0" aria-hidden="true" />
          <div className="pointer-events-none absolute left-[8%] top-0 h-64 w-64 rounded-full bg-indigo-100/60 blur-[100px]" aria-hidden="true" />
          <div className="container relative">
            <Breadcrumbs crumbs={crumbs} />
            <div className="mt-8 max-w-3xl">
              <Badge variant="purple" className="mb-5 border-indigo-200 bg-white/80 py-1 pl-2.5 pr-3">
                {eyebrow}
              </Badge>
              <h1 className="text-balance text-[34px] font-bold leading-[1.08] tracking-[-0.04em] text-slate-950 sm:text-5xl">
                {title}
              </h1>
              <p className="mt-5 text-balance text-lg leading-8 text-slate-600">{lede}</p>
              {facts && facts.length > 0 && (
                <ul className="mt-6 flex flex-wrap gap-2">
                  {facts.map((fact) => (
                    <li key={fact} className="rounded-full border border-slate-200 bg-white/80 px-3 py-1 text-xs font-medium text-slate-600">
                      {fact}
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Button size="lg" className="rounded-xl" asChild>
                  <Link href={cta.href}>
                    {cta.label} <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
                  </Link>
                </Button>
                {secondary && (
                  <Button size="lg" variant="outline" className="rounded-xl bg-white/80" asChild>
                    <Link href={secondary.href}>{secondary.label}</Link>
                  </Button>
                )}
              </div>
            </div>
          </div>
        </header>

        {children}

        <section className="py-16 sm:py-20">
          <div className="container">
            <div className="relative overflow-hidden rounded-[28px] bg-slate-950 px-6 py-12 text-center text-white sm:px-12 sm:py-16">
              <div className="pointer-events-none absolute -left-24 -top-24 h-64 w-64 rounded-full bg-indigo-600/45 blur-[90px]" aria-hidden="true" />
              <div className="pointer-events-none absolute -bottom-32 -right-20 h-72 w-72 rounded-full bg-violet-600/35 blur-[100px]" aria-hidden="true" />
              <div className="relative mx-auto max-w-2xl">
                <h2 className="text-balance text-2xl font-bold tracking-[-0.035em] sm:text-4xl">{cta.label}</h2>
                <p className="mx-auto mt-4 max-w-xl text-base leading-7 text-slate-300">
                  Garuda is ${PLAN_PRICE_USD} a month. Answer four questions about your business, edit the agent it drafts,
                  and publish it to the domains you approve when you are happy with what it says.
                </p>
                <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
                  <Button size="lg" className="bg-white text-slate-950 hover:bg-slate-100" asChild>
                    <Link href={cta.href}>
                      {cta.label} <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
                    </Link>
                  </Button>
                  <Button size="lg" variant="ghost" className="text-white hover:bg-white/10 hover:text-white" asChild>
                    <Link href="/pricing">See what the plan includes</Link>
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t bg-white py-10">
        <div className="container flex flex-col items-center justify-between gap-6 sm:flex-row">
          <Brand />
          <p className="text-xs text-slate-500">© 2026 Garuda. Better conversations, better business.</p>
          <div className="flex flex-wrap justify-center gap-5 text-xs font-medium text-slate-500">
            <Link href="/for" className="hover:text-slate-900">By industry</Link>
            <Link href="/use-cases" className="hover:text-slate-900">Use cases</Link>
            <Link href="/pricing" className="hover:text-slate-900">Pricing</Link>
            <Link href="/privacy" className="hover:text-slate-900">Privacy</Link>
            <Link href="/terms" className="hover:text-slate-900">Terms</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
