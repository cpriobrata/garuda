import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";

/**
 * Chrome shared by the help centre index and every article.
 *
 * It owns the things both pages must get right and neither should re-implement:
 * a keyboard skip link, one header, one footer, and a breadcrumb whose visible
 * trail is built from the same array the page passes to `breadcrumbJsonLd`, so
 * the markup and the structured data cannot disagree.
 *
 * Deliberately separate from components/site/seo-page-shell.tsx: that shell
 * models a one-level marketing answer page, and a help article needs a
 * three-level trail (Home, Help centre, the article) plus its own footer.
 */

const navLinks = [
  { label: "Help centre", href: "/help" },
  { label: "FAQ", href: "/faq" },
  { label: "Integrations", href: "/integrations" },
  { label: "Security", href: "/security" },
  { label: "Pricing", href: "/#pricing" },
];

const footerLinks = [
  { label: "Home", href: "/" },
  { label: "Help centre", href: "/help" },
  { label: "FAQ", href: "/faq" },
  { label: "Pricing", href: "/#pricing" },
  { label: "Privacy", href: "/privacy" },
  { label: "Terms", href: "/terms" },
];

export type Crumb = { name: string; path: string };

/** The visible breadcrumb. The last entry is the current page and is not a link. */
export function HelpBreadcrumb({ trail }: { trail: readonly Crumb[] }) {
  const last = trail.length - 1;
  return (
    <nav aria-label="Breadcrumb" className="mb-6">
      <ol className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-slate-500">
        {trail.map((crumb, index) => (
          <li key={crumb.path} className="flex items-center gap-1.5">
            {index > 0 ? <ChevronRight className="h-3 w-3 text-slate-300" aria-hidden="true" /> : null}
            {index === last ? (
              <span className="text-slate-900" aria-current="page">
                {crumb.name}
              </span>
            ) : (
              <Link
                href={crumb.path}
                className="rounded-sm hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                {crumb.name}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function HelpChrome({ children }: { children: React.ReactNode }) {
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
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="hidden sm:inline-flex" asChild>
              <Link href="/auth/sign-in">Log in</Link>
            </Button>
            {/* The one header CTA on a phone, so it gets a 44px target there and
                keeps the compact desktop size from sm up. */}
            <Button size="sm" className="h-11 px-4 text-sm sm:h-8 sm:px-3 sm:text-xs" asChild>
              <Link href="/auth/sign-up">Start building</Link>
            </Button>
          </div>
        </div>
      </header>

      <main id="main-content" className="bg-white">
        {children}
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

/**
 * The closing block on every help page. It gives a reader who did not find
 * their answer somewhere concrete to go, and it is the same on both routes so
 * the promise never varies.
 */
export function HelpContactBlock() {
  return (
    <section className="border-t bg-slate-50/70 py-14">
      <div className="container max-w-3xl text-center">
        <h2 className="text-2xl font-bold tracking-[-0.03em] text-slate-950 sm:text-3xl">Still stuck?</h2>
        <p className="mx-auto mt-4 max-w-xl text-base leading-7 text-slate-600">
          Every article here is written from the product as it works today. If something on this page does not match what you
          see in your workspace, trust the product and tell us — include the page you were on and what you expected.
        </p>
        <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
          <Button size="lg" asChild>
            <a href="mailto:info@ravan.ai">Email info@ravan.ai</a>
          </Button>
          <Button size="lg" variant="outline" asChild>
            <Link href="/faq">Read the frequently asked questions</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
