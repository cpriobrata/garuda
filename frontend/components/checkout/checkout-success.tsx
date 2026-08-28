"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, PartyPopper, ReceiptText, ShieldCheck, Sparkles } from "lucide-react";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { garudaApi } from "@/lib/api";

export function CheckoutSuccess() {
  const connected = Boolean(process.env.NEXT_PUBLIC_API_URL);
  const [ready, setReady] = useState(!connected);
  const [problem, setProblem] = useState(false);
  const [verificationRun, setVerificationRun] = useState(0);

  useEffect(() => {
    let active = true;
    async function verifyEntitlement() {
      setProblem(false);
      const params = new URLSearchParams(window.location.search);
      if (window.location.search) window.history.replaceState({}, document.title, window.location.pathname);
      if (!connected) {
        if (params.has("demo_checkout")) await garudaApi.completeDemoCheckout();
        if (active) setReady(true);
        return;
      }

      const deadline = Date.now() + 45000;
      let delay = 900;
      while (active && Date.now() < deadline) {
        try {
          const bootstrap = await garudaApi.me();
          if (bootstrap.subscription.entitled) { if (active) setReady(true); return; }
        } catch {
          // Transient API or webhook timing failures are retried until the deadline.
        }
        await new Promise((resolve) => window.setTimeout(resolve, delay));
        delay = Math.min(Math.round(delay * 1.65), 8000);
      }
      if (active) setProblem(true);
    }
    void verifyEntitlement();
    return () => { active = false; };
  }, [connected, verificationRun]);

  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden bg-slate-50">
      <div className="surface-grid pointer-events-none absolute inset-0" />
      <header className="relative z-10 border-b bg-white/80 backdrop-blur-xl"><div className="container flex h-16 items-center justify-between"><Brand /><span className="flex items-center gap-1.5 text-xs font-medium text-slate-500"><ShieldCheck className="h-4 w-4 text-emerald-500" /> Secure checkout confirmation</span></div></header>
      <div className="relative z-10 container flex flex-1 items-center justify-center py-12">
        <div className="w-full max-w-xl rounded-3xl border bg-white p-7 text-center shadow-[0_30px_90px_rgba(41,37,92,.12)] sm:p-11">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-glow">{ready ? <PartyPopper className="h-7 w-7" /> : <ShieldCheck className="h-7 w-7" />}</div>
          <p className="mt-6 text-xs font-bold uppercase tracking-[.17em] text-indigo-600">{ready ? "Welcome to Garuda" : "Checkout confirmation"}</p>
          <h1 className="mt-2 text-balance text-3xl font-bold tracking-[-.04em] text-slate-950 sm:text-4xl">{ready ? "Your AI agent starts here." : problem ? "We’re still confirming your plan." : "Confirming your payment."}</h1>
          <p className="mx-auto mt-4 max-w-md text-sm leading-6 text-slate-600">{ready ? "Next, Garuda will ask four useful questions and create your first agent around your business." : problem ? "Secure server confirmation is taking longer than usual. Check again, or return to checkout if you did not complete payment." : "We’re waiting for Stripe and the Garuda server to confirm access. Keep this page open; this can take up to a minute."}</p>
          <div className="my-7 grid gap-3 rounded-2xl border bg-slate-50 p-4 text-left sm:grid-cols-3">
            {[{ icon: ReceiptText, title: "Selected plan", text: "Launch · $17/mo" }, { icon: Check, title: "Payment", text: ready ? "Confirmed" : "Pending confirmation" }, { icon: Sparkles, title: "Access", text: ready ? "Active" : "Not active yet" }].map((item) => <div key={item.title} className="rounded-xl bg-white p-3"><item.icon className="h-4 w-4 text-indigo-600" /><p className="mt-2 text-[10px] font-medium text-slate-400">{item.title}</p><p className="mt-0.5 text-xs font-semibold text-slate-800">{item.text}</p></div>)}
          </div>
          {problem ? <div className="flex flex-col justify-center gap-2 sm:flex-row"><Button size="lg" onClick={() => setVerificationRun((run) => run + 1)}>Check again</Button><Button size="lg" variant="outline" asChild><Link href="/checkout">Return to checkout</Link></Button></div> : <Button size="lg" className="w-full sm:w-auto" asChild={ready} disabled={!ready}>{ready ? <Link href="/app/onboarding">Meet my Garuda agent <ArrowRight className="ml-2 h-4 w-4" /></Link> : <>Waiting for secure confirmation…</>}</Button>}
          <p className="mt-5 text-[11px] text-slate-400">Payment confirmation and receipts are managed securely by Stripe.</p>
        </div>
      </div>
    </main>
  );
}
