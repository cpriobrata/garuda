import Link from "next/link";
import { AlertTriangle, Info, Lightbulb } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Block, Inline, NoteTone } from "@/content/help/types";

/**
 * The renderer for help-article content.
 *
 * The content modules are data, not markup, so this file is the only place that
 * decides what a paragraph, a table or a callout looks like. A block kind added
 * to content/help/types.ts fails to compile here until it is drawn, which is the
 * point of keeping the source typed.
 */

function InlineRun({ run }: { run: Inline }) {
  if (typeof run === "string") return <>{run}</>;
  if (run.kind === "strong") return <strong className="font-semibold text-slate-900">{run.text}</strong>;
  if (run.kind === "code") {
    return (
      <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[.85em] text-slate-800">{run.text}</code>
    );
  }
  // An in-app path or an external address is written as a plain anchor; an
  // internal route goes through next/link so it prefetches like the rest of the
  // site.
  const external = run.href.startsWith("http") || run.href.startsWith("mailto:");
  const className =
    "rounded-sm font-medium text-indigo-700 underline decoration-indigo-300 underline-offset-2 hover:decoration-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";
  if (external) {
    return (
      <a href={run.href} className={className}>
        {run.text}
      </a>
    );
  }
  return (
    <Link href={run.href} className={className}>
      {run.text}
    </Link>
  );
}

export function InlineText({ runs }: { runs: readonly Inline[] }) {
  return (
    <>
      {runs.map((run, index) => (
        <InlineRun key={index} run={run} />
      ))}
    </>
  );
}

const noteStyles: Record<NoteTone, { wrapper: string; title: string; icon: typeof Info }> = {
  note: { wrapper: "border-slate-200 bg-slate-50", title: "text-slate-900", icon: Info },
  caution: { wrapper: "border-amber-200 bg-amber-50", title: "text-amber-900", icon: AlertTriangle },
  tip: { wrapper: "border-indigo-200 bg-indigo-50/70", title: "text-indigo-900", icon: Lightbulb },
};

function Note({ tone, title, body }: { tone: NoteTone; title: string; body: readonly Inline[] }) {
  const style = noteStyles[tone];
  const Icon = style.icon;
  return (
    <div className={cn("rounded-xl border p-4", style.wrapper)}>
      <p className={cn("flex items-center gap-2 text-sm font-semibold", style.title)}>
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        {title}
      </p>
      <p className="mt-2 text-[15px] leading-7 text-slate-600">
        <InlineText runs={body} />
      </p>
    </div>
  );
}

function BlockNode({ block }: { block: Block }) {
  switch (block.kind) {
    case "p":
      return (
        <p className="text-[15px] leading-7 text-slate-600">
          <InlineText runs={block.text} />
        </p>
      );
    case "ul":
      return (
        <ul className="space-y-2 pl-5 text-[15px] leading-7 text-slate-600 [&>li]:list-disc">
          {block.items.map((item, index) => (
            <li key={index}>
              <InlineText runs={item} />
            </li>
          ))}
        </ul>
      );
    case "ol":
      return (
        <ol className="space-y-2 pl-5 text-[15px] leading-7 text-slate-600 [&>li]:list-decimal">
          {block.items.map((item, index) => (
            <li key={index}>
              <InlineText runs={item} />
            </li>
          ))}
        </ol>
      );
    case "note":
      return <Note tone={block.tone} title={block.title} body={block.body} />;
    case "code":
      return (
        <figure>
          <figcaption className="mb-2 text-[11px] font-semibold uppercase tracking-[.14em] text-slate-400">
            {block.label}
          </figcaption>
          <pre className="overflow-x-auto rounded-xl bg-slate-950 p-4 text-[12.5px] leading-6 text-slate-200">
            <code>{block.code}</code>
          </pre>
        </figure>
      );
    case "table":
      return (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full min-w-[420px] border-collapse text-left text-sm">
            <caption className="sr-only">{block.caption}</caption>
            <thead>
              <tr className="bg-slate-50">
                {block.columns.map((label) => (
                  <th key={label} scope="col" className="border-b border-slate-200 px-4 py-3 font-semibold text-slate-900">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row) => (
                <tr key={row.header} className="align-top">
                  <th scope="row" className="border-b border-slate-100 px-4 py-3 font-medium text-slate-900">
                    {row.header}
                  </th>
                  {row.cells.map((cell, cellIndex) => (
                    <td key={cellIndex} className="border-b border-slate-100 px-4 py-3 leading-6 text-slate-600">
                      <InlineText runs={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

export function Blocks({ blocks, className }: { blocks: readonly Block[]; className?: string }) {
  if (!blocks.length) return null;
  return (
    <div className={cn("space-y-4", className)}>
      {blocks.map((block, index) => (
        <BlockNode key={index} block={block} />
      ))}
    </div>
  );
}
