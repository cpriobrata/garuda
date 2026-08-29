import Link from "next/link";
import { Brand } from "@/components/brand";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { breadcrumbJsonLd, jsonLdScriptProps, type JsonLd } from "@/lib/seo";

/**
 * Chrome shared by the answer-shaped marketing pages (/faq, /integrations,
 * /security).
 *
 * It owns the parts those pages must not get wrong: exactly one h1, a visible
 * breadcrumb that matches the BreadcrumbList JSON-LD beside it, and a keyboard
 * skip link. Organization and SoftwareApplication are emitted once site-wide by
 * app/layout.tsx, so nothing here repeats them; a page passes in only the
 * structured data that is genuinely its own.
 */

const navLinks = [
  { label: "How it works", href: "/#how-it-works" },
  { label: "Pricing", href: "/#pricing" },
  { label: "FAQ", href: "/faq" },
  { label: "Integrations", href: "/integrations" },
  { label: "Security", href: "/security" },
];

const footerLinks = [
  { label: "Home", href: "/" },
  { label: "Pricing", href: "/#pricing" },
  { label: "FAQ", href: "/faq" },
  { label: "Integrations", href: "/integrations" },
  { label: "Security", href: "/security" },
  { label: "Privacy", href: "/privacy" },
  { label: "Terms", href: "/terms" },
];

export type SeoPageShellProps = {
  eyebrow: string;
  /** The single h1 for the page. */
  title: string;
  /** The direct, quotable answer to what this page is. Kept short on purpose. */
  summary: string;
  breadcrumb: { name: string; path: string };
  /** When the facts on the page were last checked against the running product. */
  reviewed: string;
  structuredData?: JsonLd[];
  children: React.ReactNode;
};

export function SeoPageShell({ eyebrow, title, summary, breadcrumb, reviewed, structuredData = [], children }: SeoPageShellProps) {
  const trail = [{ name: "Home", path: "/" }, breadcrumb];
  return (
    <>
      <script {...jsonLdScriptProps([breadcrumbJsonLd(trail), ...structuredData])} />

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
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="hidden sm:inline-flex" asChild>
              <Link href="/auth/sign-in">Log in</Link>
            </Button>
            <Button size="sm" asChild>
              <Link href="/auth/sign-up">Start building</Link>
            </Button>
          </div>
        </div>
      </header>

      <main id="main-content" className="bg-white">
        <section className="relative border-b border-slate-100 pb-12 pt-10 sm:pb-16 sm:pt-14">
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
                  {breadcrumb.name}
                </li>
              </ol>
            </nav>
            <Badge variant="outline" className="mb-4 border-indigo-200 text-indigo-700">
              {eyebrow}
            </Badge>
            <h1 className="text-balance text-3xl font-bold tracking-[-0.035em] text-slate-950 sm:text-5xl">{title}</h1>
            <p className="mt-5 text-pretty text-lg leading-8 text-slate-600">{summary}</p>
            <p className="mt-6 text-xs font-medium text-slate-500">
              Checked against the running product on {reviewed}. Everything here describes what Garuda does today.
            </p>
          </div>
        </section>

        <div className="container max-w-3xl py-12 sm:py-16">{children}</div>

        <section className="border-t bg-slate-50/70 py-14">
          <div className="container max-w-3xl text-center">
            <h2 className="text-2xl font-bold tracking-[-0.03em] text-slate-950 sm:text-3xl">Still have a question?</h2>
            <p className="mx-auto mt-4 max-w-xl text-base leading-7 text-slate-600">
              Every answer on this site is written from the product as it works today. If something here does not match what you
              see, treat the product as the truth and tell us.
            </p>
            <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
              <Button size="lg" asChild>
                <Link href="/auth/sign-up">Create a Garuda account</Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link href="/#pricing">See what $17 a month includes</Link>
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
          <p className="text-xs text-slate-500">© 2026 Garuda. Better conversations, better business.</p>
        </div>
      </footer>
    </>
  );
}

/** A section that leads with a question heading and a direct, quotable answer. */
export function AnswerSection({
  id,
  question,
  answer,
  children,
}: {
  id: string;
  question: string;
  answer: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 border-t border-slate-100 py-9 first:border-t-0 first:pt-0">
      <h2 className="text-pretty text-xl font-semibold tracking-[-0.02em] text-slate-950 sm:text-2xl">{question}</h2>
      <p className="mt-3 text-base font-medium leading-7 text-slate-900">{answer}</p>
      {children ? <div className="mt-4 space-y-4 text-[15px] leading-7 text-slate-600">{children}</div> : null}
    </section>
  );
}

/** A plain, extractable table. Answer engines lift these cleanly; so do people. */
export function FactTable({
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
      <table className="w-full min-w-[420px] border-collapse text-left text-sm">
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
