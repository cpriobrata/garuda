"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2, LockKeyhole, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { clearAuthSession, garudaApi } from "@/lib/api";
import { keepBusyUntilNavigation, useBusyAction } from "@/lib/busy-action";

export function ForgotPasswordForm() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const send = useBusyAction();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("email"));
    await send.run(async () => {
      setError("");
      try { await garudaApi.forgotPassword(email); setSent(true); }
      catch (reason) { setError(reason instanceof Error ? reason.message : "Could not send reset instructions."); }
    });
  }

  if (sent) return <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5"><div className="flex items-start gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-emerald-600 text-white"><MailCheck className="h-4 w-4" /></span><div><p className="text-sm font-semibold text-emerald-900">Check your inbox</p><p className="mt-1 text-xs leading-5 text-emerald-700">If an account exists for that email, a secure reset link is on its way.</p></div></div><Button variant="outline" className="mt-5 w-full border-emerald-200 bg-white text-emerald-700" asChild><Link href="/auth/sign-in"><ArrowLeft className="mr-2 h-4 w-4" /> Back to sign in</Link></Button></div>;

  return <form className="space-y-5" onSubmit={submit}><div className="space-y-2"><Label htmlFor="reset-email">Work email</Label><div className="relative"><MailCheck className="absolute left-3 top-3.5 h-4 w-4 text-slate-400" /><Input id="reset-email" name="email" type="email" placeholder="you@company.com" className="pl-10" required /></div></div>{error && <p role="alert" className="text-xs text-red-600">{error}</p>}<Button type="submit" size="lg" className="w-full" loading={send.busy} loadingLabel="Sending the reset link">Send reset link</Button><Button variant="ghost" className="w-full" asChild><Link href="/auth/sign-in"><ArrowLeft className="mr-2 h-4 w-4" /> Back to sign in</Link></Button></form>;
}

export function ResetPasswordForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [recoveryToken, setRecoveryToken] = useState<string>();
  const [tokenReady, setTokenReady] = useState(false);
  const save = useBusyAction();

  useEffect(() => {
    clearAuthSession();
    const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const fragmentToken = fragment.get("access_token");
    const queryToken = new URLSearchParams(window.location.search).get("token");
    setRecoveryToken(fragmentToken || queryToken || undefined);
    setTokenReady(true);
    window.history.replaceState({}, document.title, window.location.pathname);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password"));
    const confirm = String(data.get("confirm"));
    // Checked before the button ever goes busy, so a mismatch reads as a
    // correction to make rather than as work that failed.
    if (password !== confirm) { setError("Passwords do not match."); return; }
    await save.run(async () => {
      try {
        await garudaApi.resetPassword(password, recoveryToken);
        clearAuthSession();
        setRecoveryToken(undefined);
        setSaved(true);
        window.setTimeout(() => router.push("/auth/sign-in?password=updated"), 900);
        // The confirmation below says what happened; the button stays busy
        // across the short pause so nothing invites a second save.
        return keepBusyUntilNavigation;
      }
      catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update your password."); }
    });
  }

  return <form className="space-y-5" onSubmit={submit}><div className="space-y-2"><Label htmlFor="new-password">New password</Label><div className="relative"><LockKeyhole className="absolute left-3 top-3.5 h-4 w-4 text-slate-400" /><Input id="new-password" name="password" type="password" placeholder="At least 8 characters" className="pl-10" minLength={8} required /></div></div><div className="space-y-2"><Label htmlFor="confirm-password">Confirm password</Label><Input id="confirm-password" name="confirm" type="password" placeholder="Repeat your new password" minLength={8} required /></div>{error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</p>}{saved && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700">Password updated. Taking you to sign in…</p>}<div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs leading-5 text-emerald-700"><CheckCircle2 className="mr-1 inline h-3.5 w-3.5" /> The reset token stays on this page and is cleared when you leave.</div><Button type="submit" size="lg" className="w-full" disabled={saved || !tokenReady} loading={save.busy} loadingLabel={saved ? "Taking you to sign in" : "Saving your new password"}>{saved ? "Password updated" : tokenReady ? "Save new password" : "Preparing secure reset..."}</Button></form>;
}
