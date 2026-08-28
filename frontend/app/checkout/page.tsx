import Link from "next/link";
import { Check, ChevronLeft, MessageCircleMore, ShieldCheck } from "lucide-react";
import { Brand } from "@/components/brand";
import { CheckoutForm } from "@/components/checkout/checkout-form";
import { Badge } from "@/components/ui/badge";

export default function CheckoutPage() {
  return (
    <main className="min-h-screen bg-slate-50/70">
      <header className="border-b bg-white"><div className="container flex h-16 items-center justify-between"><Brand /><div className="flex items-center gap-2 text-xs font-medium text-slate-500"><ShieldCheck className="h-4 w-4 text-emerald-500" /> Secure checkout</div></div></header>
      <div className="container max-w-5xl py-8 sm:py-14">
        <Link href="/auth/sign-up" className="mb-7 inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-900"><ChevronLeft className="h-4 w-4" /> Back</Link>
        <div className="grid gap-8 lg:grid-cols-[1.06fr_.94fr] lg:gap-12">
          <section>
            <Badge variant="purple" className="mb-4">One simple plan</Badge>
            <h1 className="text-3xl font-bold tracking-[-.035em] text-slate-950 sm:text-4xl">Give every visitor a great conversation.</h1>
            <p className="mt-4 max-w-xl text-sm leading-6 text-slate-600">Create a business-configured agent, test its private draft, and publish it when you are ready.</p>
            <div className="mt-8 overflow-hidden rounded-2xl border border-indigo-200 bg-white shadow-sm">
              <div className="flex items-start justify-between bg-gradient-to-r from-indigo-600 to-violet-600 p-5 text-white"><div><p className="text-sm font-semibold">Garuda Launch</p><p className="mt-1 text-xs text-indigo-100">Monthly subscription</p></div><div className="text-right"><span className="text-3xl font-bold tracking-tight">$17</span><span className="text-xs text-indigo-100"> / month</span></div></div>
              <div className="p-5 sm:p-6"><p className="text-xs font-bold uppercase tracking-[.15em] text-slate-400">Included from day one</p><div className="mt-5 grid gap-3 sm:grid-cols-2">{["Up to 10 custom agents", "100 conversations/month", "Consent-based lead capture", "Conversation inbox", "Text knowledge sources", "Dashboard totals", "Private agent previews", "Allowed-domain controls"].map((item) => <div key={item} className="flex items-center gap-2 text-sm text-slate-700"><span className="grid h-5 w-5 place-items-center rounded-full bg-emerald-50"><Check className="h-3 w-3 text-emerald-600" /></span>{item}</div>)}</div></div>
              <div className="flex items-center justify-between border-t bg-slate-50 px-5 py-4 text-sm"><span className="font-medium text-slate-500">Due today</span><span className="text-lg font-bold text-slate-950">$17.00 USD</span></div>
            </div>
            <div className="mt-6 flex items-start gap-3 rounded-xl border bg-white p-4"><MessageCircleMore className="mt-0.5 h-5 w-5 text-indigo-600" /><div><p className="text-sm font-semibold text-slate-900">A guided setup follows checkout</p><p className="mt-1 text-xs leading-5 text-slate-500">Answer four business questions, review the generated draft, then choose an allowed domain before publishing.</p></div></div>
          </section>
          <aside><CheckoutForm /></aside>
        </div>
      </div>
    </main>
  );
}
