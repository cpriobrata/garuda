"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { HelpCategory } from "@/content/help/types";

/**
 * The index list, with title search.
 *
 * The whole catalogue is a dozen articles, so filtering happens in the browser
 * against a list rendered into the page: no request, no spinner, and the page
 * is complete and indexable before the JavaScript runs. Search widens from the
 * title to the summary and keywords, because a customer types the symptom
 * ("launcher missing") far more often than the title.
 */

export type HelpSearchEntry = {
  slug: string;
  title: string;
  description: string;
  category: HelpCategory["id"];
  keywords: string[];
};

function matches(entry: HelpSearchEntry, query: string): boolean {
  if (!query) return true;
  if (entry.title.toLowerCase().includes(query)) return true;
  if (entry.description.toLowerCase().includes(query)) return true;
  return entry.keywords.some((keyword) => keyword.toLowerCase().includes(query));
}

export function HelpSearch({
  categories,
  entries,
}: {
  categories: readonly HelpCategory[];
  entries: readonly HelpSearchEntry[];
}) {
  const [query, setQuery] = useState("");
  const trimmed = query.trim().toLowerCase();

  const grouped = useMemo(() => {
    const found = entries.filter((entry) => matches(entry, trimmed));
    return {
      total: found.length,
      sections: categories
        .map((category) => ({ category, items: found.filter((entry) => entry.category === category.id) }))
        .filter((section) => section.items.length > 0),
    };
  }, [categories, entries, trimmed]);

  return (
    <div>
      <div className="relative">
        <label htmlFor="help-search" className="sr-only">
          Search the help centre by article title
        </label>
        <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
        <Input
          id="help-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by title, for example: widget, leads, domain"
          autoComplete="off"
          className="h-12 pl-11 pr-11 text-sm"
        />
        {query ? (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Clear the search"
            className="absolute right-2 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      <p role="status" className="mt-3 min-h-5 text-xs text-slate-500">
        {trimmed
          ? `${grouped.total} article${grouped.total === 1 ? "" : "s"} match “${query.trim()}”.`
          : `${entries.length} articles, grouped into ${categories.length} sections.`}
      </p>

      {grouped.sections.length ? (
        <div className="mt-8 space-y-12">
          {grouped.sections.map((section) => (
            <section key={section.category.id} aria-labelledby={`help-${section.category.id}`}>
              <h2
                id={`help-${section.category.id}`}
                className="text-xl font-semibold tracking-[-0.02em] text-slate-950"
              >
                {section.category.label}
              </h2>
              <p className="mt-1.5 text-sm leading-6 text-slate-500">{section.category.blurb}</p>
              <ul className="mt-5 space-y-3">
                {section.items.map((entry) => (
                  <li key={entry.slug}>
                    <Link
                      href={`/help/${entry.slug}`}
                      className={cn(
                        "group flex items-start gap-4 rounded-xl border border-slate-200 bg-white p-5 transition-colors",
                        "hover:border-indigo-200 hover:bg-indigo-50/30",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-[15px] font-semibold text-slate-950">{entry.title}</span>
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
            </section>
          ))}
        </div>
      ) : (
        <div className="mt-8 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center">
          <p className="text-sm font-semibold text-slate-900">Nothing matches that yet</p>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-slate-500">
            Try a shorter word, or clear the search to see all {entries.length} articles. If the answer is genuinely not
            here, email{" "}
            <a
              href="mailto:info@ravan.ai"
              className="rounded-sm font-medium text-indigo-700 underline decoration-indigo-300 underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              info@ravan.ai
            </a>
            .
          </p>
        </div>
      )}
    </div>
  );
}
