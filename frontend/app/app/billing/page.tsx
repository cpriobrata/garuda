"use client";

import { useEffect, useState } from "react";
import { AlertCircle, CalendarDays, CreditCard, Gauge, Mail, ReceiptText, ShieldCheck, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { garudaApi } from "@/lib/api";

type Subscription = Awaited<ReturnType<typeof garudaApi.billingSubscription>>;

// The API sells exactly one plan (starter_17), so a larger allowance is a
// conversation with a person rather than a self-serve upgrade.
const SUPPORT_EMAIL = "info@ravan.ai";

const demoSubscription: Subscription = {
  status: "active",
  current_period_end: "2026-09-29T00:00:00Z",
  cancel_at_period_end: false,
  entitled: true,
  limits: { published_agents: 10, monthly_conversations: 100 },
  price: { unit_amount: 1700, currency: "usd", interval: "month" },
};

export default function BillingPage() {
  const connected = Boolean(process.env.NEXT_PUBLIC_API_URL);
  const [subscription, setSubscription] = useState<Subscription | null>(connected ? null : demoSubscription);
  const [billingError, setBillingError] = useState("");
  const [portalError, setPortalError] = useState("");

  useEffect(() => {
    if (!connected) return;
    let active = true;
    garudaApi.billingSubscription()
      .then((value) => { if (active) setSubscription(value); })
      .catch((reason) => { if (active) setBillingError(reason instanceof Error ? reason.message : "Billing details could not be retrieved."); });
    return () => { active = false; };
  }, [connected]);

  async function openPortal() {
    setPortalError("");
    try {
      const { url } = await garudaApi.createBillingPortal();
      window.location.assign(url);
    } catch (reason) {
      setPortalError(reason instanceof Error ? reason.message : "Could not open Stripe billing.");
    }
  }

  const renewal = subscription?.current_period_end
    ? new Date(subscription.current_period_end).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })
    : "Not scheduled";
  const monthlyPrice = subscription?.price
    ? new Intl.NumberFormat("en-US", { style: "currency", currency: subscription.price.currency.toUpperCase(), maximumFractionDigits: 0 }).format(subscription.price.unit_amount / 100)
    : null;

  return (
    <div className="mx-auto max-w-[1120px] space-y-6">
      <div><h1 className="text-2xl font-bold tracking-[-.035em] text-slate-950">Billing & usage</h1><p className="mt-1.5 text-sm text-slate-500">Manage your subscription, payment method and monthly conversation allowance.</p></div>

      {!subscription && (
        <Card className="border-slate-200 shadow-none"><CardContent className="flex items-center gap-3 p-5"><span className="grid h-10 w-10 place-items-center rounded-xl bg-slate-100 text-slate-500">{billingError ? <AlertCircle className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}</span><div><p className="text-sm font-semibold text-slate-800">{billingError ? "Billing status unavailable" : "Confirming your subscription"}</p><p className="mt-1 text-xs text-slate-500">{billingError || "Garuda is retrieving the latest status from the billing server."}</p></div></CardContent></Card>
      )}

      {subscription && (
        <Card className="overflow-hidden border-indigo-200 shadow-none">
          <div className="bg-gradient-to-r from-indigo-600 via-indigo-600 to-violet-600 px-5 py-2.5 text-xs font-semibold text-white"><div className="mx-auto flex max-w-5xl items-center gap-2"><Sparkles className="h-3.5 w-3.5" /> {subscription.entitled ? "Your Garuda Launch plan is active" : `Launch plan status: ${subscription.status.replaceAll("_", " ")}`}</div></div>
          <CardContent className="p-5 sm:p-7">
            <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
              <div><div className="flex items-center gap-2"><h2 className="text-xl font-bold text-slate-950">Launch plan</h2><Badge variant={subscription.entitled ? "success" : "warning"} className="capitalize">{subscription.status.replaceAll("_", " ")}</Badge></div><p className="mt-2 text-sm text-slate-500">Up to {subscription.limits.published_agents} AI agents · {subscription.limits.monthly_conversations} conversations each month</p>{subscription.price ? <div className="mt-5 flex items-baseline"><span className="text-4xl font-bold tracking-[-.04em] text-slate-950">{monthlyPrice}</span><span className="ml-1 text-sm text-slate-500">{subscription.price.currency.toUpperCase()} / {subscription.price.interval}</span></div> : <p className="mt-5 text-xs text-slate-500">Price details are available in the Stripe billing portal.</p>}</div>
              <div className="rounded-xl border bg-slate-50 p-4 sm:min-w-[280px]"><div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-xl bg-white text-indigo-600 shadow-sm"><CalendarDays className="h-4 w-4" /></span><div><p className="text-[10px] text-slate-400">{subscription.current_period_end ? "Current period ends" : "Billing schedule"}</p><p className="mt-0.5 text-xs font-semibold text-slate-800">{renewal}{monthlyPrice ? ` · ${monthlyPrice}` : ""}</p></div></div><Button variant="outline" size="sm" className="mt-4 w-full" onClick={openPortal}>Manage in Stripe</Button>{portalError && <p className="mt-2 text-[10px] text-red-600">{portalError}</p>}</div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.15fr_.85fr]">
        <Card className="border-slate-200/80 shadow-none"><CardHeader className="flex-row items-center justify-between gap-3 space-y-0"><div><CardTitle className="text-sm">Monthly usage</CardTitle><p className="mt-1 text-xs text-slate-500">{connected ? "Usage is metered by the API" : "Demo period ending September 29, 2026"}</p></div><Badge variant="secondary">{connected ? "Server metered" : "Demo preview"}</Badge></CardHeader><CardContent>{connected ? <div className="rounded-xl border border-dashed bg-slate-50 p-6 text-center"><Gauge className="mx-auto h-6 w-6 text-indigo-500" /><p className="mt-3 text-xs font-semibold text-slate-800">Usage totals are not available in this view yet</p><p className="mt-1 text-[10px] leading-5 text-slate-500">Conversations are metered server-side. No estimated totals are shown here.</p></div> : <><div className="flex items-end justify-between"><div><p className="text-3xl font-bold tracking-tight text-slate-950">42</p><p className="mt-1 text-[10px] text-slate-500">demo conversations used</p></div><p className="text-xs font-medium text-slate-500">58 remaining</p></div><Progress value={42} className="mt-4 h-2.5" /><div className="mt-5 grid grid-cols-2 gap-3"><div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] text-slate-400">Avg. per day</p><p className="mt-1 text-sm font-bold text-slate-800">1.4 chats</p></div><div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] text-slate-400">Projected total</p><p className="mt-1 text-sm font-bold text-slate-800">68 chats</p></div></div></>}</CardContent></Card>

        <Card className="border-slate-200/80 shadow-none"><CardHeader><CardTitle className="text-sm">Payment method</CardTitle><p className="text-xs text-slate-500">Managed securely by Stripe</p></CardHeader><CardContent>{connected ? <div className="rounded-xl border bg-slate-50 p-4"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-white text-indigo-600 shadow-sm"><CreditCard className="h-4 w-4" /></span><div><p className="text-xs font-semibold text-slate-800">Private payment details</p><p className="mt-1 text-[10px] text-slate-500">Garuda never receives your full card number.</p></div></div></div> : <div className="flex items-center gap-3 rounded-xl border p-4"><span className="grid h-10 w-12 place-items-center rounded-lg bg-slate-950 text-[9px] font-bold italic text-white">VISA</span><div className="flex-1"><p className="text-xs font-semibold text-slate-800">Demo card ending in 4242</p><p className="mt-1 text-[10px] text-slate-400">Preview data only</p></div><Badge variant="secondary">Demo</Badge></div>}<Button variant="outline" size="sm" className="mt-4 w-full" onClick={openPortal}><CreditCard className="mr-1.5 h-3.5 w-3.5" /> Manage payment in Stripe</Button><p className="mt-4 flex items-center justify-center gap-1.5 text-[9px] text-slate-400"><ShieldCheck className="h-3.5 w-3.5 text-emerald-500" /> Secured and processed by Stripe</p></CardContent></Card>
      </div>

      <Card className="border-slate-200/80 shadow-none"><CardHeader className="flex-row items-center justify-between gap-3 space-y-0"><div><CardTitle className="text-sm">Billing history</CardTitle><p className="mt-1 text-xs text-slate-500">Receipts and invoices for your workspace</p></div><Button variant="outline" size="sm" onClick={openPortal}>Open Stripe billing</Button></CardHeader><CardContent className={connected ? "" : "px-0 pb-0"}>{connected ? <div className="flex items-center gap-3 rounded-xl border border-dashed bg-slate-50 p-5"><ReceiptText className="h-5 w-5 text-indigo-600" /><div><p className="text-xs font-semibold text-slate-800">Invoices live in your Stripe portal</p><p className="mt-1 text-[10px] text-slate-500">Open the secure portal to download receipts or update billing information.</p></div></div> : <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left"><thead><tr className="border-y bg-slate-50 text-[9px] font-bold uppercase tracking-[.12em] text-slate-400"><th className="px-6 py-3">Invoice</th><th className="px-4 py-3">Date</th><th className="px-4 py-3">Amount</th><th className="px-4 py-3">Status</th><th className="px-6 py-3 text-right">Receipt</th></tr></thead><tbody className="divide-y"><tr><td className="px-6 py-4 text-xs font-medium text-slate-700">GAR-DEMO-00829</td><td className="px-4 py-4 text-xs text-slate-500">Aug 29, 2026</td><td className="px-4 py-4 text-xs font-semibold text-slate-800">$17.00</td><td className="px-4 py-4"><Badge variant="secondary">Demo</Badge></td><td className="px-6 py-4 text-right"><span className="text-[10px] text-slate-400">Preview only</span></td></tr></tbody></table></div>}</CardContent></Card>

      <div className="flex flex-col justify-between gap-4 rounded-xl border bg-white p-5 sm:flex-row sm:items-center"><div><p className="text-xs font-semibold text-slate-800">Need a larger allowance?</p><p className="mt-1 text-[10px] text-slate-500">Launch is the only plan Garuda sells today. Tell us the volume you expect and we will size one with you.</p></div><Button variant="outline" asChild><a href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("Garuda: larger conversation allowance")}`}><Mail className="mr-1.5 h-3.5 w-3.5" /> Email {SUPPORT_EMAIL}</a></Button></div>
    </div>
  );
}
