"use client";

import { useState } from "react";
import { CreditCard, ExternalLink, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, Spinner } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cardHasExpired, formatCardBrand, formatExpiry } from "@/components/billing/billing-format";
import { useBusyAction, type BusyActionOutcome } from "@/lib/busy-action";
import type { BillingPaymentMethod } from "@/lib/api";

type PaymentMethodsCardProps = {
  methods: BillingPaymentMethod[];
  defaultPaymentMethodId: string;
  provider: string;
  loading: boolean;
  loadError: string;
  onSetDefault: (paymentMethodId: string) => Promise<void>;
  onAddCard: () => Promise<BusyActionOutcome>;
};

export function PaymentMethodsCard({ methods, defaultPaymentMethodId, provider, loading, loadError, onSetDefault, onAddCard }: PaymentMethodsCardProps) {
  const [error, setError] = useState("");
  // Which row is waiting, so only the button that was pressed shows a spinner
  // while the rest simply go inert.
  const [pendingId, setPendingId] = useState("");
  const promote = useBusyAction();
  const addCard = useBusyAction();

  async function makeDefault(paymentMethodId: string) {
    // Checked before pendingId moves, so a click that lands while another row is
    // still saving cannot drag the spinner onto the wrong card.
    if (promote.isRunning()) return;
    setPendingId(paymentMethodId);
    await promote.run(async () => {
      setError("");
      try {
        await onSetDefault(paymentMethodId);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "That card could not be made the default.");
      }
    });
    setPendingId("");
  }

  async function startAddCard() {
    await addCard.run(async () => {
      setError("");
      try {
        return await onAddCard();
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Stripe's card page could not be opened.");
      }
    });
  }

  return (
    <Card className="border-slate-200/80 shadow-none">
      <CardHeader>
        <CardTitle className="text-sm">Payment methods</CardTitle>
        <p className="text-xs text-slate-500">The card your monthly invoice is charged to.</p>
      </CardHeader>
      <CardContent>
        {loading && <p role="status" className="flex items-center gap-2 text-[10px] font-medium text-slate-500"><Spinner className="h-3.5 w-3.5 text-slate-400" /> Loading your saved cards…</p>}
        {!loading && loadError && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">{loadError}</p>}

        {!loading && !loadError && methods.length === 0 && (
          <div className="rounded-xl border border-dashed bg-slate-50 p-5 text-center">
            <CreditCard className="mx-auto h-5 w-5 text-slate-400" />
            <p className="mt-2.5 text-xs font-semibold text-slate-800">No saved card yet</p>
            <p className="mt-1 text-[10px] leading-4 text-slate-500">{provider === "none" ? "Billing is not configured on this deployment, so no card can be stored." : "Add one so your next invoice has something to charge."}</p>
          </div>
        )}

        {!loading && !loadError && methods.length > 0 && (
          <ul className="space-y-2.5">
            {methods.map((method) => {
              const isDefault = method.default || (defaultPaymentMethodId !== "" && method.id === defaultPaymentMethodId);
              const expiry = formatExpiry(method.expiry_month, method.expiry_year);
              const expired = cardHasExpired(method.expiry_month, method.expiry_year);
              return (
                <li key={method.id} className="flex flex-wrap items-center gap-3 rounded-xl border p-3.5 sm:flex-nowrap">
                  <span className="grid h-9 w-12 shrink-0 place-items-center rounded-lg bg-slate-950 text-[8px] font-bold uppercase tracking-wide text-white">{(method.brand || "card").slice(0, 4)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold text-slate-800">{formatCardBrand(method.brand)} ending in {method.last_four || "••••"}</p>
                    <p className="mt-0.5 text-[10px] text-slate-500">{expiry ? (expired ? `Expired ${expiry}` : `Expires ${expiry}`) : "Expiry not reported"}</p>
                  </div>
                  {isDefault
                    ? <Badge variant="success" className="shrink-0">Default</Badge>
                    : <Button variant="outline" size="sm" className="shrink-0" onClick={() => makeDefault(method.id)} disabled={promote.busy && pendingId !== method.id} loading={promote.busy && pendingId === method.id} loadingLabel="Making this card the default">Make default</Button>}
                </li>
              );
            })}
          </ul>
        )}

        {error && <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</p>}

        <Button variant="outline" size="sm" className="mt-4 w-full" onClick={startAddCard} loading={addCard.busy} loadingLabel="Opening Stripe's card page">
          <CreditCard className="mr-1.5 h-3.5 w-3.5" /> Add a card on Stripe <ExternalLink className="ml-1.5 h-3 w-3" />
        </Button>
        <p className="mt-3 flex items-start justify-center gap-1.5 text-center text-[9px] leading-4 text-slate-400">
          <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0 text-emerald-500" />
          Card numbers are typed on Stripe&apos;s own page and never reach Garuda. Removing a saved card happens there too; everything else is managed here.
        </p>
      </CardContent>
    </Card>
  );
}
