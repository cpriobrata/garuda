"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";

/**
 * The site header.
 *
 * Section links are written absolutely ("/#pricing", not "#pricing") because
 * this nav is used on pages other than the homepage, where a bare fragment would
 * scroll to nothing. Integrations, Security and the FAQ point at their own
 * pages rather than at the homepage summaries of them.
 */
const links = [
  { label: "How it works", href: "/#how-it-works" },
  { label: "Capabilities", href: "/#capabilities" },
  { label: "Integrations", href: "/integrations" },
  { label: "Security", href: "/security" },
  { label: "Pricing", href: "/#pricing" },
  { label: "FAQ", href: "/faq" },
];

export function SiteNav() {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-50 border-b border-slate-200/70 bg-white/80 backdrop-blur-xl">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-slate-950 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
      >
        Skip to content
      </a>
      <div className="container flex h-16 items-center justify-between">
        <Brand />
        <nav className="hidden items-center gap-6 lg:flex" aria-label="Main">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded text-sm font-medium text-slate-600 transition hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transition-none"
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="hidden items-center gap-2 lg:flex">
          <Button variant="ghost" asChild>
            <Link href="/auth/sign-in">Sign in</Link>
          </Button>
          <Button asChild>
            <Link href="/auth/sign-up">Create your agent</Link>
          </Button>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-11 w-11 lg:hidden"
          onClick={() => setOpen(!open)}
          aria-label={open ? "Close navigation" : "Open navigation"}
          aria-expanded={open}
          aria-controls="site-nav-mobile"
        >
          {open ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}
        </Button>
      </div>
      <div id="site-nav-mobile" hidden={!open} className="border-t bg-white px-4 py-4 lg:hidden">
        <nav className="flex flex-col gap-1" aria-label="Main">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              className="rounded-lg px-3 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              {link.label}
            </Link>
          ))}
          {/* One column below sm: a Button is whitespace-nowrap, and "Create your
              agent" needs ~156px, which two columns cannot give on a 320–375px
              screen without pushing the whole page into horizontal scroll. */}
          <div className="mt-3 grid grid-cols-1 gap-2 border-t pt-4 sm:grid-cols-2">
            <Button variant="outline" asChild>
              <Link href="/auth/sign-in" onClick={() => setOpen(false)}>
                Sign in
              </Link>
            </Button>
            <Button asChild>
              <Link href="/auth/sign-up" onClick={() => setOpen(false)}>
                Create your agent
              </Link>
            </Button>
          </div>
        </nav>
      </div>
    </header>
  );
}
