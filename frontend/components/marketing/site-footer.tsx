import Link from "next/link";
import { Brand } from "@/components/brand";
import { LANDING_PAGES } from "@/components/usecase/catalog";

/**
 * The site footer.
 *
 * Every link resolves to something that exists: the homepage sections, the
 * standalone marketing pages, the two legal pages, the auth entry points and the
 * one published contact address. There is no "About" or "Careers" placeholder —
 * a footer full of dead links is worse than a short one.
 *
 * The industry and use-case column reads from the same catalogue the hub pages
 * and breadcrumbs use, so a page added there appears here without anybody
 * remembering to update a second list.
 */

type FooterLink = { label: string; href: string };
type FooterColumn = { title: string; links: FooterLink[] };

const columns: FooterColumn[] = [
  {
    title: "Product",
    links: [
      { label: "How it works", href: "/#how-it-works" },
      { label: "Capabilities", href: "/#capabilities" },
      { label: "Integrations", href: "/integrations" },
      { label: "Security and privacy", href: "/security" },
      { label: "Pricing", href: "/#pricing" },
    ],
  },
  {
    title: "Industries and uses",
    links: LANDING_PAGES.map((page) => ({ label: page.label, href: page.href })),
  },
  {
    title: "Company",
    links: [
      { label: "Frequently asked questions", href: "/faq" },
      { label: "The Garuda blog", href: "/blog" },
      { label: "Sign in", href: "/auth/sign-in" },
      { label: "Create your agent", href: "/auth/sign-up" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Privacy policy", href: "/privacy" },
      { label: "Terms of service", href: "/terms" },
      { label: "Privacy requests", href: "mailto:privacy@garuda.ai" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="container grid gap-12 py-14 sm:py-16 lg:grid-cols-[1fr_2.2fr] lg:gap-16">
        <div className="max-w-sm">
          <Brand />
          <p className="mt-4 text-sm leading-6 text-slate-600">
            Garuda builds knowledge-grounded AI chat agents for a company website: drafted from your answers, edited and published
            by you, and restricted to the domains you approve.
          </p>
          <p className="mt-4 text-xs leading-5 text-slate-500">
            No customer logos, testimonials or review scores appear on this site, because Garuda has no public customers yet.
            Everything described here is what the product does today.
          </p>
        </div>

        <nav aria-label="Footer" className="grid grid-cols-2 gap-8 sm:grid-cols-4">
          {columns.map((column) => (
            <div key={column.title}>
              <h2 className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">{column.title}</h2>
              <ul className="mt-4 space-y-2.5">
                {column.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="rounded text-sm text-slate-600 underline-offset-4 transition hover:text-slate-950 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transition-none"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>

      <div className="border-t border-slate-100 bg-slate-50/70">
        <div className="container flex flex-col items-center justify-between gap-3 py-6 text-xs text-slate-500 sm:flex-row">
          <p>© {new Date().getFullYear()} Garuda. Knowledge-grounded chat for your website.</p>
          <p>USD $17 per month. Billing and cancellation are handled by Stripe.</p>
        </div>
      </div>
    </footer>
  );
}
