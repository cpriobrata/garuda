import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";

/**
 * Chrome shared by the two legal documents, /privacy and /terms.
 *
 * These pages are deliberately NOT built on components/site/seo-page-shell.tsx.
 * That shell is shaped for answer pages: a short quotable summary, then a run of
 * question headings. A legal document is a spine of long numbered sections that
 * people need to link into and cite, so the parts it has to get right are
 * different — a table of contents whose entries match the section ids exactly, a
 * visible "last updated" date, and headings that stay in order.
 *
 * The rules this shell owns so a page cannot break them:
 *   - exactly one h1, rendered here from `title`;
 *   - every LegalSection is an h2 with an id, and the contents list is built
 *     from the same ids, so the two cannot drift apart;
 *   - a skip link, and a nav landmark for the contents.
 */

const navLinks = [
  { label: "How it works", href: "/#how-it-works" },
  { label: "Pricing", href: "/#pricing" },
  { label: "FAQ", href: "/faq" },
  { label: "Security", href: "/security" },
];

const footerLinks = [
  { label: "Home", href: "/" },
  { label: "Pricing", href: "/#pricing" },
  { label: "FAQ", href: "/faq" },
  { label: "Security", href: "/security" },
  { label: "Privacy", href: "/privacy" },
  { label: "Terms", href: "/terms" },
];

export type LegalTocEntry = { id: string; label: string };

export type LegalPageProps = {
  eyebrow: string;
  /** The single h1 for the page. */
  title: string;
  /** One paragraph saying what the document is, in plain words. */
  intro: string;
  /** Human-readable date, e.g. "30 August 2026". */
  lastUpdated: string;
  breadcrumb: string;
  /** Section ids and labels, in the order the sections appear. */
  contents: ReadonlyArray<LegalTocEntry>;
  /** Optional block rendered above the contents, for a plain-language summary. */
  summary?: React.ReactNode;
  children: React.ReactNode;
};

export function LegalPage({ eyebrow, title, intro, lastUpdated, breadcrumb, contents, summary, children }: LegalPageProps) {
  return (
    <>
      <a
        href="#main-content"
        className="sr-only rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60]"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-50 border-b border-slate-200/70 bg-white/85 backdrop-blur-xl">
        <div className="container flex h-16 items-center justify-between gap-4">
          <Brand />
          <nav className="hidden items-center gap-6 lg:flex" aria-label="Main navigation">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-sm text-sm font-medium text-slate-600 transition-colors hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                {link.label}
              </Link>
            ))}
          </nav>
          {/* The one header CTA on a phone, so it gets a 44px target there and
              keeps the compact desktop size from sm up. */}
          <Button size="sm" className="h-11 px-4 text-sm sm:h-8 sm:px-3 sm:text-xs" asChild>
            <Link href="/auth/sign-up">Start building</Link>
          </Button>
        </div>
      </header>

      <main id="main-content" className="bg-white">
        <section className="relative border-b border-slate-100 pb-10 pt-10 sm:pb-14 sm:pt-14">
          <div className="surface-grid pointer-events-none absolute inset-0" aria-hidden="true" />
          <div className="container relative max-w-3xl">
            <nav aria-label="Breadcrumb" className="mb-6">
              <ol className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500">
                <li>
                  <Link
                    href="/"
                    className="rounded-sm hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    Home
                  </Link>
                </li>
                <li aria-hidden="true">/</li>
                <li className="text-slate-900" aria-current="page">
                  {breadcrumb}
                </li>
              </ol>
            </nav>
            <Badge variant="outline" className="mb-4 border-indigo-200 text-indigo-700">
              {eyebrow}
            </Badge>
            <h1 className="text-balance text-3xl font-bold tracking-[-0.035em] text-slate-950 sm:text-5xl">{title}</h1>
            <p className="mt-5 text-pretty text-lg leading-8 text-slate-600">{intro}</p>
            <p className="mt-6 text-sm font-semibold text-slate-900">Last updated {lastUpdated}</p>
          </div>
        </section>

        <div className="container max-w-3xl py-10 sm:py-14">
          {summary ? <div className="mb-10">{summary}</div> : null}

          <nav aria-labelledby="contents-heading" className="rounded-2xl border border-slate-200 bg-slate-50/70 p-5 sm:p-6">
            <h2 id="contents-heading" className="text-xs font-bold uppercase tracking-[.16em] text-slate-500">
              Contents
            </h2>
            <ol className="mt-4 grid gap-x-8 gap-y-2 sm:grid-cols-2">
              {contents.map((entry, index) => (
                <li key={entry.id} className="text-sm leading-6">
                  <span className="mr-1.5 tabular-nums text-slate-400">{index + 1}.</span>
                  <Link
                    href={`#${entry.id}`}
                    className="rounded-sm font-medium text-slate-700 underline-offset-4 hover:text-indigo-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    {entry.label}
                  </Link>
                </li>
              ))}
            </ol>
          </nav>

          <div className="mt-4">{children}</div>
        </div>

        <section className="border-t bg-slate-50/70 py-14">
          <div className="container max-w-3xl text-center">
            <h2 className="text-2xl font-bold tracking-[-0.03em] text-slate-950 sm:text-3xl">Questions about this document?</h2>
            <p className="mx-auto mt-4 max-w-xl text-base leading-7 text-slate-600">
              Write to us and a person will answer. If anything on this page does not match what the product actually does, treat
              the product as the truth and tell us, so we can correct the page.
            </p>
            <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
              <Button size="lg" asChild>
                <a href="mailto:info@ravan.ai">Email info@ravan.ai</a>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link href="/security">Read how Garuda handles data</Link>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t bg-white py-10">
        <div className="container flex flex-col items-center justify-between gap-6 md:flex-row">
          <Brand />
          <nav aria-label="Footer" className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
            {footerLinks.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                className="rounded-sm text-xs font-medium text-slate-500 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                {link.label}
              </Link>
            ))}
          </nav>
          <p className="text-xs text-slate-500">© 2026 Ravan AI. Garuda is a Ravan AI product.</p>
        </div>
      </footer>
    </>
  );
}

/** One top-level section. The id is what the contents list links to. */
export function LegalSection({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 border-t border-slate-100 py-9">
      <h2 className="text-pretty text-xl font-semibold tracking-[-0.02em] text-slate-950 sm:text-2xl">{title}</h2>
      <div className="mt-4 space-y-4 text-[15px] leading-7 text-slate-600">{children}</div>
    </section>
  );
}

/** A named subdivision of a section. Always an h3, so the outline stays intact. */
export function LegalSubsection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="pt-2">
      <h3 className="text-base font-semibold text-slate-900">{title}</h3>
      <div className="mt-2 space-y-3">{children}</div>
    </div>
  );
}

/** A plain bulleted list with the spacing the rest of the document uses. */
export function LegalList({ items }: { items: ReadonlyArray<React.ReactNode> }) {
  return (
    <ul className="space-y-2 pl-1">
      {items.map((item, index) => (
        <li key={index} className="flex gap-3">
          <span aria-hidden="true" className="mt-[11px] h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-400" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

/** A two- or three-column fact table. Scrolls on its own rather than the page. */
export function LegalTable({
  caption,
  head,
  rows,
}: {
  caption: string;
  head: ReadonlyArray<string>;
  rows: ReadonlyArray<ReadonlyArray<React.ReactNode>>;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200">
      <table className="w-full min-w-[480px] border-collapse text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="bg-slate-50">
            {head.map((label) => (
              <th key={label} scope="col" className="border-b border-slate-200 px-4 py-3 font-semibold text-slate-900">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="align-top">
              <th scope="row" className="border-b border-slate-100 px-4 py-3 font-medium text-slate-900">
                {row[0]}
              </th>
              {row.slice(1).map((cell, cellIndex) => (
                <td key={cellIndex} className="border-b border-slate-100 px-4 py-3 text-slate-600">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A callout for a limit, a placeholder, or something the product does not have. */
export function LegalNote({
  tone = "neutral",
  title,
  children,
}: {
  tone?: "neutral" | "warning";
  title: string;
  children: React.ReactNode;
}) {
  const palette = tone === "warning" ? "border-amber-200 bg-amber-50/70" : "border-indigo-100 bg-indigo-50/60";
  return (
    <div className={`rounded-xl border p-4 text-sm leading-7 text-slate-700 ${palette}`}>
      <p className="font-semibold text-slate-900">{title}</p>
      <div className="mt-1 space-y-2">{children}</div>
    </div>
  );
}
