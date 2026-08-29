"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GoogleAuthButton } from "@/components/auth/google-auth-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, clearAuthSession, garudaApi, storeAuthSession } from "@/lib/api";
import { keepBusyUntilNavigation, useBusyAction } from "@/lib/busy-action";

export function SignUpForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pendingEmail, setPendingEmail] = useState("");
  const [resendMessage, setResendMessage] = useState("");
  const signUp = useBusyAction();
  const resendAction = useBusyAction();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Read before anything awaits: currentTarget is gone once the request settles.
    const form = new FormData(event.currentTarget);
    const name = `${form.get("firstName")} ${form.get("lastName")}`.trim();
    const email = String(form.get("email"));
    const password = String(form.get("password"));
    await signUp.run(async () => {
      setError("");
      try {
        clearAuthSession();
        const result = await garudaApi.signUp(name, email, password);
        if (result.verification_required || !result.access_token) {
          setPendingEmail(email);
          return;
        }
        storeAuthSession(result);
        router.push("/checkout");
        return keepBusyUntilNavigation;
      } catch (reason) {
        if (reason instanceof ApiError && reason.code === "verification_email_failed") {
          setPendingEmail(email);
          setError("Your account was created, but the first verification email could not be delivered. Use resend below.");
        } else {
          setError(reason instanceof Error ? reason.message : "Could not create your account.");
        }
      }
    });
  }

  async function resend() {
    await resendAction.run(async () => {
      setError("");
      setResendMessage("");
      try {
        const result = await garudaApi.resendVerification(pendingEmail);
        setResendMessage(result.message);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Could not resend the verification email.");
      }
    });
  }

  if (pendingEmail) {
    return (
      <div className="space-y-5">
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-600 text-white"><MailCheck className="h-5 w-5" /></span>
            <div><p className="text-sm font-semibold text-emerald-950">Verify your email</p><p className="mt-1 break-words text-xs leading-5 text-emerald-800">We sent a secure verification link to <span className="font-semibold">{pendingEmail}</span>. Open it to continue to your plan.</p></div>
          </div>
        </div>
        {resendMessage && <p role="status" className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-700">{resendMessage}</p>}
        {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
        <Button type="button" variant="outline" size="lg" className="w-full" loading={resendAction.busy} loadingLabel="Sending the verification email" onClick={resend}>Resend verification email</Button>
        <Button type="button" variant="ghost" className="w-full" disabled={resendAction.busy} onClick={() => { setPendingEmail(""); setResendMessage(""); }}><ArrowLeft className="mr-2 h-4 w-4" /> Use a different email</Button>
      </div>
    );
  }

  return (
    <form className="space-y-5" onSubmit={submit}>
      <div className="grid grid-cols-2 gap-3"><div className="space-y-2"><Label htmlFor="first-name">First name</Label><Input id="first-name" name="firstName" placeholder="Maya" required /></div><div className="space-y-2"><Label htmlFor="last-name">Last name</Label><Input id="last-name" name="lastName" placeholder="Chen" required /></div></div>
      <div className="space-y-2"><Label htmlFor="signup-email">Work email</Label><Input id="signup-email" name="email" type="email" placeholder="you@company.com" required /></div>
      <div className="space-y-2"><Label htmlFor="signup-password">Create a password</Label><Input id="signup-password" name="password" type="password" minLength={8} placeholder="At least 8 characters" required /></div>
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
      <Button type="submit" size="lg" className="w-full" loading={signUp.busy} loadingLabel="Creating your account">Continue to plan <ArrowRight className="ml-2 h-4 w-4" /></Button>
      {process.env.NEXT_PUBLIC_API_URL && <><div className="flex items-center gap-3"><div className="h-px flex-1 bg-slate-200" /><span className="text-[10px] font-semibold uppercase tracking-[.14em] text-slate-400">or</span><div className="h-px flex-1 bg-slate-200" /></div><GoogleAuthButton mode="sign-up" /></>}
      <p className="text-center text-[11px] leading-5 text-slate-400">By continuing, you agree to Garuda’s <Link href="/terms" className="underline hover:text-slate-600">Terms</Link> and <Link href="/privacy" className="underline hover:text-slate-600">Privacy Policy</Link>.</p>
      <p className="text-center text-sm text-slate-500">Already have an account? <Link href="/auth/sign-in" className="font-semibold text-indigo-600">Sign in</Link></p>
    </form>
  );
}
