"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, CalendarDays, Gauge, Mail, RotateCcw, ShieldCheck, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, Spinner } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { CancelSubscriptionDialog } from "@/components/billing/cancel-subscription-dialog";
import { InvoiceHistory } from "@/components/billing/invoice-history";
import { PaymentMethodsCard } from "@/components/billing/payment-methods-card";
import { formatDate, formatPlanPrice, formatStatus } from "@/components/billing/billing-format";
import { ApiError, garudaApi, type BillingInvoiceList, type BillingPaymentMethodList, type BillingSubscriptionDetail } from "@/lib/api";
import { keepBusyUntilNavigation, useBusyAction } from "@/lib/busy-action";

type Subscription = Awaited<ReturnType<typeof garudaApi.billingSubscription>>;

// The API sells exactly one plan (starter_17), so a larger allowance is a
// conversation with a person rather than a self-serve upgrade.
const SUPPORT_EMAIL = "info@ravan.ai";

// Every in-app billing route shares one gate: owner role, plus either a live
// entitlement or a billing relationship worth repairing. A refusal from the first
// of them tells the screen which of the two failed, so the rest are not attempted.
type ManagementBlock = { kind: "owner" | "inactive" | "error"; message: string };

function describe(reason: unknown, fallback: string) {
  return reason instanceof Error && reason.message ? reason.message : fallback;
}

function managementBlockFrom(reason: unknown): ManagementBlock {
  if (reason instanceof ApiError && reason.code === "owner_required") return { kind: "owner", message: reason.message };
  if (reason instanceof ApiError && reason.code === "subscription_required") return { kind: "inactive", message: reason.message };
  return { kind: "error", message: describe(reason, "Your subscription could not be retrieved.") };
}

export default function BillingPage() {
  const connected = Boolean(process.env.NEXT_PUBLIC_API_URL);

  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [subscriptionError, setSubscriptionError] = useState("");
  const [detail, setDetail] = useState<BillingSubscriptionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(true);
  const [management, setManagement] = useState<ManagementBlock | null>(null);
  const [invoices, setInvoices] = useState<BillingInvoiceList>({ invoices: [], provider: "" });
  const [invoiceLoading, setInvoiceLoading] = useState(true);
  const [invoiceError, setInvoiceError] = useState("");
  const [methods, setMethods] = useState<BillingPaymentMethodList>({ methods: [], provider: "", defaultPaymentMethodId: "" });
  const [methodLoading, setMethodLoading] = useState(true);
  const [methodError, setMethodError] = useState("");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [resumeError, setResumeError] = useState("");
  const resume = useBusyAction();

  useEffect(() => {
    let active = true;

    // Ungated, and the only source of the plan's allowances, so it is asked for
    // even when everything below is refused.
    garudaApi.billingSubscription()
      .then((value) => { if (active) setSubscription(value); })
      .catch((reason) => { if (active) setSubscriptionError(describe(reason, "Billing details could not be retrieved.")); });

    (async () => {
      let current: BillingSubscriptionDetail;
      try {
        current = await garudaApi.billingSubscriptionDetail();
      } catch (reason) {
        if (!active) return;
        setManagement(managementBlockFrom(reason));
        setDetailLoading(false);
        setInvoiceLoading(false);
        setMethodLoading(false);
        return;
      }
      if (!active) return;
      setDetail(current);
      setDetailLoading(false);

      garudaApi.listBillingInvoices()
        .then((value) => { if (active) setInvoices(value); })
        .catch((reason) => { if (active) setInvoiceError(describe(reason, "Your invoices could not be retrieved.")); })
        .finally(() => { if (active) setInvoiceLoading(false); });

      garudaApi.listBillingPaymentMethods()
        .then((value) => { if (active) setMethods(value); })
        .catch((reason) => { if (active) setMethodError(describe(reason, "Your saved cards could not be retrieved.")); })
        .finally(() => { if (active) setMethodLoading(false); });
    })();

    return () => { active = false; };
  }, []);

  async function confirmCancel() {
    const updated = await garudaApi.cancelBillingSubscription();
    setDetail(updated);
    setResumeError("");
    setNotice(updated.current_period_end
      ? `Your plan is scheduled to end on ${formatDate(updated.current_period_end)}. Nothing has been deleted, and you can resume before then.`
      : "Your plan is scheduled to end when the current billing period does. Nothing has been deleted, and you can resume before then.");
  }

  async function resumePlan() {
    await resume.run(async () => {
      setResumeError("");
      setNotice("");
      try {
        const updated = await garudaApi.resumeBillingSubscription();
        setDetail(updated);
        setNotice("Your plan is active again. The scheduled cancellation has been removed.");
      } catch (reason) {
        setResumeError(describe(reason, "Your plan could not be resumed just now."));
      }
    });
  }

  async function setDefaultCard(paymentMethodId: string) {
    const updated = await garudaApi.setDefaultBillingPaymentMethod(paymentMethodId);
    setMethods((current) => ({
      ...current,
      defaultPaymentMethodId: updated.id,
      methods: current.methods.map((method) => (method.id === updated.id ? { ...method, ...updated, default: true } : { ...method, default: false })),
    }));
    setDetail((current) => (current ? { ...current, payment_method: updated } : current));
    setNotice(`Future invoices will be charged to the card ending in ${updated.last_four || paymentMethodId}.`);
  }

  // Card entry is the one step that cannot happen here: collecting a card needs
  // Stripe.js, which this app does not load, and a card field posting to the Garuda
  // API would be the wrong answer. Stripe's own page takes the number; the saved
  // card comes back to this screen to be made default.
  async function addCardOnStripe() {
    setNotice("");
    const session = await garudaApi.createBillingPortal();
    if (session.demo) {
      setNotice("Stripe is not configured on this deployment, so there is no card page to open.");
      return;
    }
    window.location.assign(session.url);
    return keepBusyUntilNavigation;
  }

  const status = detail?.status || subscription?.status || "";
  const entitled = detail?.entitled ?? subscription?.entitled ?? false;
  const periodEnd = detail?.current_period_end ?? subscription?.current_period_end ?? null;
  const cancelScheduled = detail?.cancel_at_period_end ?? subscription?.cancel_at_period_end ?? false;
  const plan = detail?.plan ?? (subscription?.price ? { code: "starter_17", ...subscription.price } : null);
  const limits = subscription?.limits ?? null;
  const monthlyPrice = plan ? formatPlanPrice(plan.unit_amount, plan.currency) : null;
  const renewal = formatDate(periodEnd);
  // The period end can be absent -- a local payload written before any webhook
  // landed has none -- and a sentence naming a date has to survive that.
  const endsPhrase = periodEnd ? `on ${formatDate(periodEnd)}` : "when the current billing period does";
  const canManage = Boolean(detail) && !management;

  return (
    <div className="mx-auto max-w-[1120px] space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-[-.035em] text-slate-950">Billing &amp; usage</h1>
        <p className="mt-1.5 text-sm text-slate-500">Your plan, invoices, saved cards and cancellation — all handled here.</p>
      </div>

      {notice && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-xs text-emerald-800">{notice}</p>}

      {!subscription && !detail && (
        <Card className="border-slate-200 shadow-none">
          <CardContent className="flex items-center gap-3 p-5">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-500">{subscriptionError ? <AlertCircle className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}</span>
            <div>
              <p className="text-sm font-semibold text-slate-800">{subscriptionError ? "Billing status unavailable" : "Confirming your subscription"}</p>
              {/* Two elements rather than one whose role flips: an alert is only
                  announced when it enters the DOM already carrying its message. */}
              {subscriptionError
                ? <p role="alert" className="mt-1 text-xs text-red-600">{subscriptionError}</p>
                : <p className="mt-1 text-xs text-slate-500">Garuda is retrieving the latest status from the billing server.</p>}
            </div>
          </CardContent>
        </Card>
      )}

      {(subscription || detail) && (
        <Card className="overflow-hidden border-indigo-200 shadow-none">
          <div className="bg-gradient-to-r from-indigo-600 via-indigo-600 to-violet-600 px-5 py-2.5 text-xs font-semibold text-white">
            <div className="mx-auto flex max-w-5xl items-center gap-2"><Sparkles className="h-3.5 w-3.5 shrink-0" /> {entitled ? "Your Garuda Launch plan is active" : `Launch plan status: ${formatStatus(status).toLowerCase()}`}</div>
          </div>
          <CardContent className="p-5 sm:p-7">
            <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-xl font-bold text-slate-950">Launch plan</h2>
                  <Badge variant={entitled ? "success" : "warning"}>{formatStatus(status)}</Badge>
                  {cancelScheduled && <Badge variant="warning">{periodEnd ? `Ends ${renewal}` : "Cancellation scheduled"}</Badge>}
                </div>
                {limits && <p className="mt-2 text-sm text-slate-500">Up to {limits.published_agents} AI agents · {limits.monthly_conversations} conversations each month</p>}
                {plan
                  ? <div className="mt-5 flex flex-wrap items-baseline"><span className="text-4xl font-bold tracking-[-.04em] text-slate-950">{monthlyPrice}</span><span className="ml-1 text-sm text-slate-500">{plan.currency.toUpperCase()} / {plan.interval}</span></div>
                  : <p className="mt-5 text-xs text-slate-500">The price on this subscription was not reported by the billing server.</p>}
              </div>

              <div className="rounded-xl border bg-slate-50 p-4 sm:min-w-[280px]">
                <div className="flex items-center gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white text-indigo-600 shadow-sm"><CalendarDays className="h-4 w-4" /></span>
                  <div className="min-w-0">
                    <p className="text-[10px] text-slate-400">{cancelScheduled ? "Access ends" : periodEnd ? "Renews on" : "Billing schedule"}</p>
                    <p className="mt-0.5 text-xs font-semibold text-slate-800">{renewal}{!cancelScheduled && monthlyPrice ? ` · ${monthlyPrice}` : ""}</p>
                  </div>
                </div>

                {detailLoading && <p role="status" className="mt-4 flex items-center gap-2 text-[10px] font-medium text-slate-500"><Spinner className="h-3.5 w-3.5 text-slate-400" /> Checking your subscription…</p>}

                {canManage && (cancelScheduled
                  ? <Button size="sm" className="mt-4 w-full" onClick={resumePlan} loading={resume.busy} loadingLabel="Resuming your plan"><RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Resume plan</Button>
                  : <Button variant="outline" size="sm" className="mt-4 w-full text-red-600 hover:bg-red-50 hover:text-red-700" onClick={() => setCancelOpen(true)}>Cancel plan</Button>)}

                {resumeError && <p role="alert" className="mt-2 text-[10px] leading-4 text-red-600">{resumeError}</p>}
              </div>
            </div>

            {cancelScheduled && (
              <p className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-xs leading-5 text-amber-800">
                This plan is scheduled to end {endsPhrase}. Your agents keep replying until then, and nothing in this workspace is deleted. Resume before then to keep the plan running.
              </p>
            )}

            {management && (
              <div className="mt-5 rounded-xl border bg-slate-50 p-4">
                <p className="text-xs font-semibold text-slate-800">
                  {management.kind === "owner" ? "Only the workspace owner can manage billing" : management.kind === "inactive" ? "This workspace has no subscription to manage" : "Billing management is unavailable right now"}
                </p>
                <p role={management.kind === "error" ? "alert" : undefined} className="mt-1 text-[11px] leading-5 text-slate-500">{management.message}</p>
                {management.kind === "inactive" && <Button variant="outline" size="sm" className="mt-3" asChild><Link href="/checkout">Start a subscription</Link></Button>}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Invoices and saved cards sit behind the same gate the detail route just
          refused, so they are left out entirely rather than shown as empty. */}
      <div className={management ? "grid gap-6" : "grid gap-6 lg:grid-cols-[1.15fr_.85fr]"}>
        <Card className="border-slate-200/80 shadow-none">
          <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
            <div><CardTitle className="text-sm">Monthly usage</CardTitle><p className="mt-1 text-xs text-slate-500">{connected ? "Usage is metered by the API" : "Demo period ending September 29, 2026"}</p></div>
            <Badge variant="secondary" className="shrink-0">{connected ? "Server metered" : "Demo preview"}</Badge>
          </CardHeader>
          <CardContent>
            {connected
              ? <div className="rounded-xl border border-dashed bg-slate-50 p-6 text-center"><Gauge className="mx-auto h-6 w-6 text-indigo-500" /><p className="mt-3 text-xs font-semibold text-slate-800">Usage totals are not available in this view yet</p><p className="mt-1 text-[10px] leading-5 text-slate-500">Conversations are metered server-side. No estimated totals are shown here.</p></div>
              : <><div className="flex items-end justify-between"><div><p className="text-3xl font-bold tracking-tight text-slate-950">42</p><p className="mt-1 text-[10px] text-slate-500">demo conversations used</p></div><p className="text-xs font-medium text-slate-500">58 remaining</p></div><Progress value={42} className="mt-4 h-2.5" /><div className="mt-5 grid grid-cols-2 gap-3"><div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] text-slate-400">Avg. per day</p><p className="mt-1 text-sm font-bold text-slate-800">1.4 chats</p></div><div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] text-slate-400">Projected total</p><p className="mt-1 text-sm font-bold text-slate-800">68 chats</p></div></div></>}
          </CardContent>
        </Card>

        {!management && (
          <PaymentMethodsCard
            methods={methods.methods}
            defaultPaymentMethodId={methods.defaultPaymentMethodId}
            provider={methods.provider}
            loading={methodLoading}
            loadError={methodError}
            onSetDefault={setDefaultCard}
            onAddCard={addCardOnStripe}
          />
        )}
      </div>

      {!management && <InvoiceHistory invoices={invoices.invoices} provider={invoices.provider} loading={invoiceLoading} loadError={invoiceError} />}

      <div className="flex flex-col justify-between gap-4 rounded-xl border bg-white p-5 sm:flex-row sm:items-center">
        <div>
          <p className="text-xs font-semibold text-slate-800">Need a larger allowance?</p>
          <p className="mt-1 text-[10px] text-slate-500">Launch is the only plan Garuda sells today. Tell us the volume you expect and we will size one with you.</p>
        </div>
        <Button variant="outline" asChild>
          <a href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("Garuda: larger conversation allowance")}`}><Mail className="mr-1.5 h-3.5 w-3.5" /> Email {SUPPORT_EMAIL}</a>
        </Button>
      </div>

      <CancelSubscriptionDialog open={cancelOpen} onOpenChange={setCancelOpen} currentPeriodEnd={periodEnd} onConfirm={confirmCancel} />
    </div>
  );
}
