"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";

const links = [{ label: "Product", href: "#product" }, { label: "How it works", href: "#how-it-works" }, { label: "Pricing", href: "#pricing" }];

export function SiteNav() {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-50 border-b border-slate-200/70 bg-white/80 backdrop-blur-xl">
      <div className="container flex h-16 items-center justify-between">
        <Brand />
        <nav className="hidden items-center gap-7 md:flex" aria-label="Main navigation">
          {links.map((link) => <Link key={link.href} href={link.href} className="text-sm font-medium text-slate-600 transition hover:text-slate-950">{link.label}</Link>)}
        </nav>
        <div className="hidden items-center gap-2 md:flex">
          <Button variant="ghost" asChild><Link href="/auth/sign-in">Log in</Link></Button>
          <Button asChild><Link href="/auth/sign-up">Start building <span className="ml-1">→</span></Link></Button>
        </div>
        <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setOpen(!open)} aria-label="Toggle navigation">{open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}</Button>
      </div>
      {open && (
        <div className="animate-enter border-t bg-white px-4 py-4 md:hidden">
          <nav className="flex flex-col gap-1">
            {links.map((link) => <Link key={link.href} href={link.href} onClick={() => setOpen(false)} className="rounded-lg px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50">{link.label}</Link>)}
            <div className="mt-3 grid grid-cols-2 gap-2 border-t pt-4"><Button variant="outline" asChild><Link href="/auth/sign-in">Log in</Link></Button><Button asChild><Link href="/auth/sign-up">Get started</Link></Button></div>
          </nav>
        </div>
      )}
    </header>
  );
}
