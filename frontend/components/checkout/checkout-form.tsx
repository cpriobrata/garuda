"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, CreditCard, LockKeyhole, ShieldCheck, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { garudaApi } from "@/lib/api";
import { keepBusyUntilNavigation, useBusyAction } from "@/lib/busy-action";

export function CheckoutForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const checkoutAction = useBusyAction();

  async function checkout() {
    await checkoutAction.run(async () => {
      setError("");
      try {
        const { url } = await garudaApi.createCheckout();
        if (url.startsWith("/")) router.push(url);
        else window.location.assign(url);
        // Stripe is being opened; the button stays busy until the page leaves.
        return keepBusyUntilNavigation;
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Checkout could not be started.");
      }
    });
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-soft sm:p-8">
      <div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-50 text-indigo-600"><CreditCard className="h-5 w-5" /></div><div><h2 className="font-semibold text-slate-950">Secure checkout</h2><p className="text-xs text-slate-500">Payment is processed by Stripe</p></div></div>
      <div className="my-6 h-px bg-slate-100" />
      <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-4">
        <div className="flex items-start gap-3"><Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600" /><div><p className="text-sm font-semibold text-indigo-950">Your account is ready</p><p className="mt-1 text-xs leading-5 text-indigo-700">After checkout, a short AI-guided setup will create your first agent around your business.</p></div></div>
      </div>
      <ul className="my-6 space-y-3 text-sm text-slate-600">{["Encrypted payment details", "Instant portal access", "Cancel from settings any time"].map((item) => <li key={item} className="flex items-center gap-2"><Check className="h-4 w-4 text-emerald-500" /> {item}</li>)}</ul>
      {error && <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</p>}
      <Button size="lg" className="w-full" onClick={checkout} loading={checkoutAction.busy} loadingLabel="Opening secure checkout">Continue with Stripe<ArrowRight className="ml-2 h-4 w-4" /></Button>
      <p className="mt-4 flex items-center justify-center gap-1.5 text-[10px] text-slate-400"><LockKeyhole className="h-3 w-3" /> PCI-compliant checkout · SSL encrypted</p>
      <div className="mt-5 flex items-center justify-center gap-2 border-t pt-5 text-xs font-semibold text-slate-500"><ShieldCheck className="h-4 w-4 text-emerald-500" /> Subscription managed securely in Stripe</div>
    </div>
  );
}
