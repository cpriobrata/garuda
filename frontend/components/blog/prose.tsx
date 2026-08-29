import Link from "next/link";
import { ArrowUpRight, Info, Lightbulb, TriangleAlert } from "lucide-react";
import type { Block, CalloutTone, Inline } from "@/content/blog/types";

function InlineRun({ run }: { run: Inline }) {
  if (typeof run === "string") return <>{run}</>;
  if (run.kind === "strong") return <strong className="font-semibold text-slate-900">{run.text}</strong>;
  if (run.kind === "em") return <em className="italic">{run.text}</em>;
  if (run.kind === "code") {
    return (
      // Inline code is often an unbroken identifier or path; without a break it
      // would widen the article past a narrow viewport.
      <code className="break-words rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[.85em] text-slate-800">
        {run.text}
      </code>
    );
  }
  if (run.href.startsWith("/")) {
    return (
      <Link
        href={run.href}
        className="font-medium text-indigo-700 underline decoration-indigo-300 underline-offset-[3px] transition-colors hover:decoration-indigo-600 motion-reduce:transition-none"
      >
        {run.text}
      </Link>
    );
  }
  return (
    <a
      href={run.href}
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium text-indigo-700 underline decoration-indigo-300 underline-offset-[3px] transition-colors hover:decoration-indigo-600 motion-reduce:transition-none"
    >
      {run.text}
      <ArrowUpRight aria-hidden="true" className="ml-0.5 inline h-3.5 w-3.5 align-[-1px]" />
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

export function InlineText({ runs }: { runs: Inline[] }) {
  return (
    <>
      {runs.map((run, index) => (
        <InlineRun key={index} run={run} />
      ))}
    </>
  );
}

const calloutStyles: Record<CalloutTone, { wrap: string; icon: string; label: string }> = {
  note: { wrap: "border-indigo-200 bg-indigo-50/60", icon: "bg-indigo-100 text-indigo-700", label: "Note" },
  caution: { wrap: "border-amber-200 bg-amber-50/70", icon: "bg-amber-100 text-amber-700", label: "Important" },
  tip: { wrap: "border-emerald-200 bg-emerald-50/60", icon: "bg-emerald-100 text-emerald-700", label: "Tip" },
};

const calloutIcons: Record<CalloutTone, typeof Info> = {
  note: Info,
  caution: TriangleAlert,
  tip: Lightbulb,
};

function BlockView({ block }: { block: Block }) {
  switch (block.kind) {
    case "h2":
      return (
        <h2
          id={block.id}
          className="mt-14 scroll-mt-24 text-pretty text-2xl font-bold tracking-[-.03em] text-slate-950 sm:text-[28px]"
        >
          {block.text}
        </h2>
      );

    case "h3":
      return (
        <h3 className="mt-9 text-lg font-semibold tracking-[-.02em] text-slate-900 sm:text-xl">{block.text}</h3>
      );

    case "p":
      return (
        <p className="mt-5 text-[17px] leading-8 text-slate-700">
          <InlineText runs={block.text} />
        </p>
      );

    case "ul":
      return (
        <ul className="mt-5 space-y-3">
          {block.items.map((item, index) => (
            <li key={index} className="relative pl-6 text-[17px] leading-8 text-slate-700">
              <span
                aria-hidden="true"
                className="absolute left-0 top-[14px] h-1.5 w-1.5 rounded-full bg-indigo-400"
              />
              <InlineText runs={item} />
            </li>
          ))}
        </ul>
      );

    case "ol":
      return (
        <ol className="mt-5 space-y-3">
          {block.items.map((item, index) => (
            <li key={index} className="relative pl-9 text-[17px] leading-8 text-slate-700">
              <span
                aria-hidden="true"
                className="absolute left-0 top-1 grid h-6 w-6 place-items-center rounded-full bg-indigo-50 text-[11px] font-bold text-indigo-700"
              >
                {index + 1}
              </span>
              <InlineText runs={item} />
            </li>
          ))}
        </ol>
      );

    case "steps":
      return (
        <ol className="mt-6 space-y-4">
          {block.items.map((item, index) => (
            <li
              key={index}
              className="rounded-xl border border-slate-200/80 bg-white p-5 sm:p-6"
            >
              <div className="flex items-baseline gap-3">
                <span className="text-xs font-bold tabular-nums text-indigo-500">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <h3 className="text-base font-semibold tracking-tight text-slate-950">{item.title}</h3>
              </div>
              <p className="mt-2 pl-8 text-[16px] leading-7 text-slate-700">
                <InlineText runs={item.body} />
              </p>
            </li>
          ))}
        </ol>
      );

    case "callout": {
      const style = calloutStyles[block.tone];
      const Icon = calloutIcons[block.tone];
      return (
        <aside
          aria-label={`${style.label}: ${block.title}`}
          className={`mt-8 rounded-2xl border p-5 sm:p-6 ${style.wrap}`}
        >
          <div className="flex items-center gap-2.5">
            <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg ${style.icon}`}>
              <Icon aria-hidden="true" className="h-4 w-4" />
            </span>
            <p className="text-sm font-semibold tracking-tight text-slate-950">{block.title}</p>
          </div>
          <p className="mt-3 text-[16px] leading-7 text-slate-700">
            <InlineText runs={block.body} />
          </p>
        </aside>
      );
    }

    case "code":
      return (
        <figure className="mt-7 overflow-hidden rounded-xl border border-slate-800 bg-slate-950">
          <figcaption className="border-b border-white/10 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[.16em] text-slate-400">
            {block.label}
          </figcaption>
          <div className="overflow-x-auto">
            <pre className="p-4 text-[13px] leading-6 text-slate-100 sm:p-5">
              <code className="font-mono">{block.code}</code>
            </pre>
          </div>
        </figure>
      );

    case "table":
      return (
        <figure className="mt-8">
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[640px] border-collapse text-left text-sm">
              <caption className="sr-only">{block.caption}</caption>
              <thead>
                <tr className="bg-slate-50">
                  {block.columns.map((column, index) => (
                    <th
                      key={index}
                      scope="col"
                      className="border-b border-slate-200 px-4 py-3 text-[11px] font-bold uppercase tracking-[.13em] text-slate-500"
                    >
                      {column}
                      {index === 0 && column === "" ? <span className="sr-only">Comparison point</span> : null}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, rowIndex) => (
                  <tr key={rowIndex} className="align-top even:bg-slate-50/50">
                    <th
                      scope="row"
                      className="border-b border-slate-100 px-4 py-4 text-sm font-semibold text-slate-900"
                    >
                      {row.header}
                    </th>
                    {row.cells.map((cell, cellIndex) => (
                      <td
                        key={cellIndex}
                        className="border-b border-slate-100 px-4 py-4 leading-6 text-slate-700"
                      >
                        <InlineText runs={cell} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <figcaption className="mt-3 text-xs leading-5 text-slate-500">{block.caption}</figcaption>
        </figure>
      );
  }
}

export function Prose({ blocks }: { blocks: Block[] }) {
  return (
    <div>
      {blocks.map((block, index) => (
        <BlockView key={index} block={block} />
      ))}
    </div>
  );
}
