"use client";

import { ReactNode, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useBusyAction } from "@/lib/busy-action";

// One confirmation for anything that cannot be undone.
//
// The rule this encodes: an action whose consequence is invisible from the
// button gets a sentence naming the consequence in the product's own terms
// before it runs. Deleting a webhook endpoint also deletes every delivery the
// customer would use to prove what was sent, and disconnecting a calendar stops
// published agents offering appointments to visitors — neither is guessable from
// a trash icon, and neither has an undo.
//
// It is a component rather than a copied block because the shape has now been
// wanted four times, and a confirmation that is easy to add is one that actually
// gets added.

type ConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** One sentence naming what is about to happen. */
  description: ReactNode;
  /** What the person loses or breaks. Shown as bullets; keep each one concrete. */
  consequences?: ReactNode[];
  confirmLabel: string;
  /** Announced while the request is in flight. */
  confirmBusyLabel: string;
  cancelLabel?: string;
  /** Shown if the action fails, in place of closing. */
  failureMessage?: string;
  onConfirm: () => Promise<void>;
};

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  consequences = [],
  confirmLabel,
  confirmBusyLabel,
  cancelLabel = "Keep it",
  failureMessage = "That could not be done just now. Please try again.",
  onConfirm,
}: ConfirmDialogProps) {
  const [error, setError] = useState("");
  const confirm = useBusyAction();

  function handleOpenChange(next: boolean) {
    // A close request landing mid-request is ignored rather than racing the
    // response, so the dialog cannot be dismissed into an unknown outcome.
    if (!next && confirm.isRunning()) return;
    if (!next) setError("");
    onOpenChange(next);
  }

  async function run() {
    await confirm.run(async () => {
      setError("");
      try {
        await onConfirm();
        onOpenChange(false);
      } catch (reason) {
        setError(reason instanceof Error && reason.message ? reason.message : failureMessage);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <span className="mx-auto grid h-10 w-10 place-items-center rounded-xl bg-amber-50 text-amber-600 sm:mx-0"><AlertTriangle className="h-5 w-5" /></span>
          <DialogTitle className="pt-2">{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {consequences.length > 0 && (
          <ul className="space-y-2.5 text-xs leading-5 text-slate-600">
            {consequences.map((consequence, index) => (
              <li key={index} className="flex gap-2">
                <span aria-hidden="true" className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-slate-400" />
                <span>{consequence}</span>
              </li>
            ))}
          </ul>
        )}

        {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</p>}

        <DialogFooter className="gap-2">
          <DialogClose asChild><Button variant="outline" size="sm" disabled={confirm.busy}>{cancelLabel}</Button></DialogClose>
          <Button variant="destructive" size="sm" onClick={run} loading={confirm.busy} loadingLabel={confirmBusyLabel}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
