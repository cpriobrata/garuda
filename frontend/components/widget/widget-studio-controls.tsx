"use client";

// The controls the studio is built from, with the loading behaviour in one
// place. Every button that performs an async action in this screen goes through
// AsyncButton, so "disabled while it works, and visibly working" is a property
// of the control rather than something each caller has to remember.

import * as React from "react";
import { Check, Loader2 } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

// The double-submit guard, deliberately not a hook so it can be reasoned about
// on its own. The flag is a plain variable rather than React state because two
// clicks in the same tick both read state before it flushes, and that is exactly
// the double submit that reached production.
export type AsyncActionRunner = {
  isPending: () => boolean;
  run: <T>(action: () => Promise<T> | T) => Promise<{ started: boolean; value?: T }>;
};

export function createAsyncActionRunner(notifyPending?: (pending: boolean) => void): AsyncActionRunner {
  let inFlight = false;
  return {
    isPending: () => inFlight,
    run: async <T,>(action: () => Promise<T> | T) => {
      if (inFlight) return { started: false };
      inFlight = true;
      notifyPending?.(true);
      try {
        return { started: true, value: await action() };
      } finally {
        inFlight = false;
        notifyPending?.(false);
      }
    },
  };
}

// useAsyncAction gives a component the same guard plus a render flag. Callers
// that need to disable more than one control while the work runs read pending.
export function useAsyncAction() {
  const [pending, setPending] = React.useState(false);
  const mounted = React.useRef(true);
  React.useEffect(() => () => { mounted.current = false; }, []);
  const runner = React.useRef<AsyncActionRunner | null>(null);
  if (!runner.current) runner.current = createAsyncActionRunner((value) => { if (mounted.current) setPending(value); });
  return { pending, run: runner.current.run };
}

export type AsyncButtonProps = Omit<ButtonProps, "onClick"> & {
  onClick?: () => Promise<unknown> | unknown;
  pending?: boolean;
  pendingLabel?: string;
  icon?: React.ReactNode;
};

// A button whose work is visible. It refuses a second click while the first is
// still running, keeps itself disabled for the whole flight, and says what it is
// doing instead of looking like nothing happened.
export function AsyncButton({ onClick, pending, pendingLabel, icon, children, disabled, ...buttonProps }: AsyncButtonProps) {
  const action = useAsyncAction();
  const busy = action.pending || Boolean(pending);
  return (
    <Button
      {...buttonProps}
      disabled={busy || disabled}
      aria-busy={busy}
      onClick={() => {
        if (!onClick) return;
        // A rejection is the action's own to report: every caller here turns a
        // failure into a message the customer can read.
        void action.run(onClick).catch(() => undefined);
      }}
    >
      {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : icon}
      {busy ? pendingLabel || "Working…" : children}
    </Button>
  );
}

export function FieldMessage({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-1.5 text-[10px] font-medium text-red-500">{message}</p>;
}

export function SectionCard({ step, title, description, action, children }: { step: number; title: string; description: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border bg-white p-5 shadow-sm sm:p-6">
      <div className="flex items-start gap-3">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-indigo-50 text-[11px] font-bold text-indigo-600">{step}</span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
        </div>
        {action}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

// A colour input that shows what the widget will actually paint. The text box
// holds what the customer authored, which may be nothing; the swatch and the
// placeholder show the value the server resolves that to, so an empty field
// reads as "automatic" rather than as a missing colour.
export function ColorField({ id, label, value, resolved, onChange, onClear, message, hint }: {
  id: string;
  label: string;
  value: string;
  resolved: string;
  onChange: (value: string) => void;
  onClear?: () => void;
  message?: string;
  hint?: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label htmlFor={id}>{label}</Label>
        {onClear && value ? <button type="button" onClick={onClear} className="text-[10px] font-semibold text-indigo-600 hover:underline">Use automatic</button> : null}
      </div>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} swatch`}
          value={resolved}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
          className="h-9 w-10 shrink-0 cursor-pointer rounded-lg border bg-white p-1"
        />
        <Input id={id} value={value} placeholder={resolved} onChange={(event) => onChange(event.target.value)} className="h-9 font-mono text-xs uppercase" />
      </div>
      {hint ? <p className="text-[10px] text-slate-400">{hint}</p> : null}
      <FieldMessage message={message} />
    </div>
  );
}

export function SwitchRow({ title, description, checked, onCheckedChange, note, disabled }: {
  title: string;
  description: string;
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
  note?: string;
  disabled?: boolean;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-3 rounded-xl border p-3", checked && "border-indigo-200 bg-indigo-50/40")}>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold text-slate-800">{title}</p>
        <p className="mt-1 text-[9px] leading-4 text-slate-500">{description}</p>
        {note ? <p className="mt-1 text-[9px] font-medium leading-4 text-amber-600">{note}</p> : null}
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} aria-label={title} />
    </div>
  );
}

// One theme card. The label, the description and the palette all come from the
// server's table, so the picker cannot drift from what the widget paints.
export function SelectableCard({ selected, onSelect, title, description, children, ariaLabel }: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  description: string;
  children?: React.ReactNode;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={ariaLabel || title}
      className={cn(
        "relative rounded-xl border p-3 text-left transition-all hover:border-indigo-200 hover:shadow-sm",
        selected ? "border-indigo-400 bg-indigo-50/60 ring-2 ring-indigo-200" : "border-slate-200 bg-white",
      )}
    >
      {selected ? <span className="absolute right-2.5 top-2.5 grid h-4 w-4 place-items-center rounded-full bg-indigo-600 text-white"><Check className="h-2.5 w-2.5" /></span> : null}
      {children}
      <p className={cn("text-[11px] font-semibold", selected ? "text-indigo-900" : "text-slate-800")}>{title}</p>
      <p className="mt-0.5 text-[9px] leading-4 text-slate-500">{description}</p>
    </button>
  );
}
