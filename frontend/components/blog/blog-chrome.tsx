"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";

// A blog-local copy of the site header. The marketing nav points at in-page
// anchors that only exist on the landing page; these are absolute so they work
// from an article URL.
const links = [
  { label: "How it works", href: "/#how-it-works" },
  { label: "How it works", href: "/#how-it-works" },
  { label: "Pricing", href: "/#pricing" },
  { label: "Blog", href: "/blog" },
];

export function BlogNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 border-b border-slate-200/70 bg-white/80 backdrop-blur-xl">
      <div className="container flex h-16 items-center justify-between">
        <Brand />
        <nav className="hidden items-center gap-7 md:flex" aria-label="Main navigation">
          {links.map((link) => {
            const current = link.href === "/blog" && pathname.startsWith("/blog");
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={current ? "page" : undefined}
                className={
                  current
                    ? "text-sm font-semibold text-slate-950"
                    : "text-sm font-medium text-slate-600 transition hover:text-slate-950 motion-reduce:transition-none"
                }
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
        <div className="hidden items-center gap-2 md:flex">
          <Button variant="ghost" asChild>
            <Link href="/auth/sign-in">Log in</Link>
          </Button>
          <Button asChild>
            <Link href="/auth/sign-up">Start building</Link>
          </Button>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-label="Toggle navigation"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </Button>
      </div>
      {open ? (
        <div className="border-t bg-white px-4 py-4 md:hidden">
          <nav className="flex flex-col gap-1" aria-label="Main navigation">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                aria-current={link.href === "/blog" && pathname.startsWith("/blog") ? "page" : undefined}
                className="rounded-lg px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                {link.label}
              </Link>
            ))}
            <div className="mt-3 grid grid-cols-2 gap-2 border-t pt-4">
              <Button variant="outline" asChild>
                <Link href="/auth/sign-in">Log in</Link>
              </Button>
              <Button asChild>
                <Link href="/auth/sign-up">Get started</Link>
              </Button>
            </div>
          </nav>
        </div>
      ) : null}
    </header>
  );
}

export function BlogFooter() {
  return (
    <footer className="border-t bg-white py-10">
      <div className="container flex flex-col items-center justify-between gap-6 sm:flex-row">
        <Brand />
        <p className="text-xs text-slate-500">© 2026 Garuda. Better conversations, better business.</p>
        <div className="flex gap-5 text-xs font-medium text-slate-500">
          <Link href="/blog" className="hover:text-slate-900">
            Blog
          </Link>
          <Link href="/privacy" className="hover:text-slate-900">
            Privacy
          </Link>
          <Link href="/terms" className="hover:text-slate-900">
            Terms
          </Link>
          <Link href="/#pricing" className="hover:text-slate-900">
            Pricing
          </Link>
        </div>
      </div>
    </footer>
  );
}
