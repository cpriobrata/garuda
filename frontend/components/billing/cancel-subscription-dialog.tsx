"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatDate } from "@/components/billing/billing-format";
import { useBusyAction } from "@/lib/busy-action";

type CancelSubscriptionDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentPeriodEnd?: string | null;
  onConfirm: () => Promise<void>;
};

export function CancelSubscriptionDialog({ open, onOpenChange, currentPeriodEnd, onConfirm }: CancelSubscriptionDialogProps) {
  const [error, setError] = useState("");
  const cancel = useBusyAction();

  // POST /v1/billing/subscription/cancel schedules the cancellation for the end of
  // the period unless the body asks for `immediate`, which this screen never sends.
  // Every sentence below describes that path and only that path.
  const endsOn = currentPeriodEnd ? formatDate(currentPeriodEnd, "") : "";
  const endsPhrase = endsOn || "the end of your current billing period";

  function handleOpenChange(next: boolean) {
    // A close request that lands mid-request is ignored rather than racing the
    // response, so the confirmation cannot be dismissed into an unknown outcome.
    if (!next && cancel.isRunning()) return;
    if (!next) setError("");
    onOpenChange(next);
  }

  async function confirm() {
    await cancel.run(async () => {
      setError("");
      try {
        await onConfirm();
        onOpenChange(false);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Your plan could not be cancelled just now.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <span className="mx-auto grid h-10 w-10 place-items-center rounded-xl bg-amber-50 text-amber-600 sm:mx-0"><AlertTriangle className="h-5 w-5" /></span>
          <DialogTitle className="pt-2">Cancel your Launch plan?</DialogTitle>
          <DialogDescription>
            Your plan stays active until {endsPhrase}. Nothing changes today and you will not be charged again.
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-2.5 text-xs leading-5 text-slate-600">
          <li className="flex gap-2"><span aria-hidden="true" className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-slate-400" /><span>After {endsPhrase}, your published agents stop replying to visitors on your website.</span></li>
          <li className="flex gap-2"><span aria-hidden="true" className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-slate-400" /><span><span className="font-semibold text-slate-800">Nothing is deleted.</span> Your agents, their knowledge, your conversations and every lead you have captured stay in this workspace, and you can still sign in and read them.</span></li>
          <li className="flex gap-2"><span aria-hidden="true" className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-slate-400" /><span>You can undo this at any time before {endsPhrase} with <span className="font-semibold text-slate-800">Resume plan</span>, and your agents never go quiet.</span></li>
        </ul>

        {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</p>}

        <DialogFooter className="gap-2">
          <DialogClose asChild><Button variant="outline" size="sm" disabled={cancel.busy}>Keep my plan</Button></DialogClose>
          <Button variant="destructive" size="sm" onClick={confirm} loading={cancel.busy} loadingLabel="Scheduling your cancellation">
            {endsOn ? `Cancel on ${endsOn}` : "Cancel at period end"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
