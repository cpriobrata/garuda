import Link from "next/link";
import { ArrowLeft, Compass } from "lucide-react";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-50 p-5"><div className="surface-grid absolute inset-0" /><div className="relative max-w-md text-center"><Brand className="mb-10" /><div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-indigo-50 text-indigo-600"><Compass className="h-7 w-7" /></div><p className="mt-6 text-xs font-bold uppercase tracking-[.18em] text-indigo-600">404 · Lost conversation</p><h1 className="mt-3 text-3xl font-bold tracking-[-.04em] text-slate-950">This page isn’t here.</h1><p className="mt-3 text-sm leading-6 text-slate-500">The link may have changed, or the page belongs to a different workspace.</p><Button className="mt-7" asChild><Link href="/"><ArrowLeft className="mr-2 h-4 w-4" /> Back to Garuda</Link></Button></div></main>;
}
