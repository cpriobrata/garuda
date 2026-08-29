import { ChevronDown, List } from "lucide-react";
import type { TocEntry } from "@/content/blog/utils";

function TocLinks({ entries, className }: { entries: TocEntry[]; className?: string }) {
  return (
    <ol className={className}>
      {entries.map((entry, index) => (
        <li key={entry.id}>
          <a
            href={`#${entry.id}`}
            className="flex gap-3 rounded-lg px-2 py-1.5 text-sm leading-6 text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-950 motion-reduce:transition-none"
          >
            <span aria-hidden="true" className="pt-px text-xs font-semibold tabular-nums text-slate-400">
              {String(index + 1).padStart(2, "0")}
            </span>
            <span>{entry.text}</span>
          </a>
        </li>
      ))}
    </ol>
  );
}

/** Native disclosure shown above the article on narrow screens. No JavaScript. */
export function ArticleTocInline({ entries }: { entries: TocEntry[] }) {
  if (entries.length < 3) return null;

  return (
    <details className="group mb-10 rounded-xl border border-slate-200 bg-white lg:hidden">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-slate-900 [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2">
          <List aria-hidden="true" className="h-4 w-4 text-indigo-600" />
          On this page
        </span>
        <ChevronDown
          aria-hidden="true"
          className="h-4 w-4 text-slate-400 transition-transform group-open:rotate-180 motion-reduce:transition-none"
        />
      </summary>
      <div className="border-t border-slate-100 px-2 pb-3 pt-2">
        <TocLinks entries={entries} className="space-y-0.5" />
      </div>
    </details>
  );
}

/** Sticky sidebar contents, from the large breakpoint up. */
export function ArticleTocSidebar({ entries }: { entries: TocEntry[] }) {
  if (entries.length < 3) return null;

  return (
    <nav aria-labelledby="toc-heading" className="hidden lg:block">
      <div className="sticky top-24">
        <h2
          id="toc-heading"
          className="flex items-center gap-2 px-2 text-[11px] font-bold uppercase tracking-[.16em] text-slate-400"
        >
          <List aria-hidden="true" className="h-3.5 w-3.5" />
          On this page
        </h2>
        <TocLinks entries={entries} className="mt-3 space-y-0.5 border-l border-slate-200 pl-2" />
      </div>
    </nav>
  );
}
