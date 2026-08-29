import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { LANDING_PAGES, otherLandingPages, type LandingKind } from "@/components/usecase/catalog";

/**
 * The full list of pages of one kind, for a hub page. Each card is a single
 * link whose accessible name is the page it goes to plus what it covers, so it
 * reads correctly out of context in a screen reader's list of links.
 */
export function LandingList({ kind }: { kind: LandingKind }) {
  const pages = LANDING_PAGES.filter((page) => page.kind === kind);
  return (
    <ul className="grid gap-5 md:grid-cols-2">
      {pages.map((page) => (
        <li key={page.href}>
          <Link
            href={page.href}
            className="flex h-full flex-col rounded-2xl border border-slate-200/80 bg-white p-6 transition-colors hover:border-indigo-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <span className="flex items-center gap-2 text-lg font-semibold tracking-tight text-slate-950">
              {page.label}
              <ArrowRight className="h-4 w-4 text-indigo-500" aria-hidden="true" />
            </span>
            <span className="mt-2.5 text-sm leading-6 text-slate-600">{page.summary}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * Cross-links to the rest of the set. Each link text names the page it goes to
 * rather than saying "read more", so the link makes sense read on its own.
 */
export function RelatedPages({ currentHref, title = "Keep reading" }: { currentHref: string; title?: string }) {
  const pages = otherLandingPages(currentHref);
  return (
    <section id="related" className="border-t border-slate-100 bg-slate-50/70 py-16 sm:py-20">
      <div className="container">
        <h2 className="text-xl font-bold tracking-[-0.03em] text-slate-950 sm:text-2xl">{title}</h2>
        <ul className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {pages.map((page) => (
            <li key={page.href}>
              <Link
                href={page.href}
                className="flex h-full flex-col rounded-2xl border border-slate-200/80 bg-white p-5 transition-colors hover:border-indigo-200 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <span className="text-[11px] font-bold uppercase tracking-[.16em] text-indigo-600">
                  {page.kind === "industry" ? "Industry" : "Use case"}
                </span>
                <span className="mt-2 flex items-center gap-1.5 text-base font-semibold tracking-tight text-slate-950">
                  {page.label}
                  <ArrowRight className="h-4 w-4 text-slate-400" aria-hidden="true" />
                </span>
                <span className="mt-2 text-sm leading-6 text-slate-600">{page.summary}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
