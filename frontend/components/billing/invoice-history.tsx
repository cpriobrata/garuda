"use client";

import { Download, ExternalLink, ReceiptText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/button";
import { formatMoney, formatShortDate, formatStatus, invoiceBadgeVariant } from "@/components/billing/billing-format";
import type { BillingInvoice } from "@/lib/api";

type InvoiceHistoryProps = {
  invoices: BillingInvoice[];
  provider: string;
  loading: boolean;
  loadError: string;
};

export function InvoiceHistory({ invoices, provider, loading, loadError }: InvoiceHistoryProps) {
  return (
    <Card className="border-slate-200/80 shadow-none">
      <CardHeader>
        <CardTitle className="text-sm">Billing history</CardTitle>
        <p className="mt-1 text-xs text-slate-500">Every invoice raised for this workspace.</p>
      </CardHeader>
      <CardContent className={invoices.length > 0 && !loading && !loadError ? "px-0 pb-0" : undefined}>
        {loading && <p role="status" className="flex items-center gap-2 text-[10px] font-medium text-slate-500"><Spinner className="h-3.5 w-3.5 text-slate-400" /> Loading your invoices…</p>}
        {!loading && loadError && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">{loadError}</p>}

        {!loading && !loadError && invoices.length === 0 && (
          <div className="flex items-center gap-3 rounded-xl border border-dashed bg-slate-50 p-5">
            <ReceiptText className="h-5 w-5 shrink-0 text-slate-400" />
            <div>
              <p className="text-xs font-semibold text-slate-800">No invoices yet</p>
              <p className="mt-1 text-[10px] leading-4 text-slate-500">{provider === "none" ? "Billing is not configured on this deployment, so no invoices have been raised." : "Your first invoice will appear here as soon as it is issued."}</p>
            </div>
          </div>
        )}

        {!loading && !loadError && invoices.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-left">
              <thead>
                <tr className="border-y bg-slate-50 text-[9px] font-bold uppercase tracking-[.12em] text-slate-400">
                  <th scope="col" className="px-6 py-3">Invoice</th>
                  <th scope="col" className="px-4 py-3">Date</th>
                  <th scope="col" className="px-4 py-3">Amount</th>
                  <th scope="col" className="px-4 py-3">Status</th>
                  <th scope="col" className="px-6 py-3 text-right">Receipt</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {invoices.map((invoice) => {
                  // A settled invoice is described by what was actually taken; an
                  // open or void one by what was asked for.
                  const amount = invoice.status === "paid" ? invoice.amount_paid : invoice.amount_due;
                  return (
                    <tr key={invoice.id}>
                      <td className="px-6 py-4 text-xs font-medium text-slate-700">{invoice.number || invoice.id}</td>
                      <td className="px-4 py-4 text-xs text-slate-500">{formatShortDate(invoice.created)}</td>
                      <td className="px-4 py-4 text-xs font-semibold text-slate-800">{formatMoney(amount, invoice.currency)}</td>
                      <td className="px-4 py-4"><Badge variant={invoiceBadgeVariant(invoice.status)} className="capitalize">{formatStatus(invoice.status)}</Badge></td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-end gap-3">
                          {invoice.hosted_invoice_url && <a className="inline-flex items-center gap-1 text-[10px] font-semibold text-indigo-600 underline-offset-2 hover:underline" href={invoice.hosted_invoice_url} target="_blank" rel="noopener noreferrer">View <ExternalLink className="h-3 w-3" /><span className="sr-only"> invoice {invoice.number || invoice.id}</span></a>}
                          {invoice.invoice_pdf && <a className="inline-flex items-center gap-1 text-[10px] font-semibold text-indigo-600 underline-offset-2 hover:underline" href={invoice.invoice_pdf} target="_blank" rel="noopener noreferrer">PDF <Download className="h-3 w-3" /><span className="sr-only"> for invoice {invoice.number || invoice.id}</span></a>}
                          {/* The API returns both links empty when the provider has no
                              receipt to hand over, and no link is invented in its place. */}
                          {!invoice.hosted_invoice_url && !invoice.invoice_pdf && <span className="text-[10px] text-slate-400">Not available</span>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
