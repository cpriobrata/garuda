/**
 * The plain-language summary that sits above the formal sections of the privacy
 * policy.
 *
 * It is a summary, not a substitute: every point here is stated again, in full,
 * in the section it links to, and the link is what lets a reader check it. The
 * heading is an h2 so the document outline reads correctly with the sections
 * that follow it.
 */

import Link from "next/link";

export type SummaryPoint = {
  /** The claim, in one short sentence. */
  point: string;
  /** Section id this point is spelled out in. */
  href: string;
  /** Link text naming that section. */
  detail: string;
};

export function PlainSummary({ points }: { points: ReadonlyArray<SummaryPoint> }) {
  return (
    <section aria-labelledby="summary-heading" className="rounded-2xl border border-indigo-100 bg-indigo-50/50 p-6 sm:p-8">
      <h2 id="summary-heading" className="text-xl font-semibold tracking-[-0.02em] text-slate-950">
        The short version
      </h2>
      <p className="mt-2 text-sm leading-7 text-slate-600">
        This part is a summary in plain words. It is not the policy — the numbered sections below are — but nothing here
        contradicts them.
      </p>
      <ul className="mt-5 space-y-4">
        {points.map((entry) => (
          <li key={entry.href} className="flex gap-3">
            <span aria-hidden="true" className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500" />
            <p className="text-[15px] leading-7 text-slate-700">
              {entry.point}{" "}
              <Link
                href={entry.href}
                className="rounded-sm font-medium text-indigo-700 underline decoration-indigo-300 underline-offset-4 hover:decoration-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                {entry.detail}
              </Link>
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
