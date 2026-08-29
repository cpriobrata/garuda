"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GoogleAuthButton } from "@/components/auth/google-auth-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, clearAuthSession, garudaApi, storeAuthSession } from "@/lib/api";
import { keepBusyUntilNavigation, useBusyAction } from "@/lib/busy-action";

export function SignInForm() {
  const router = useRouter();
  const demoMode = !process.env.NEXT_PUBLIC_API_URL;
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [resendEmail, setResendEmail] = useState("");
  const [resendMessage, setResendMessage] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);
  const signIn = useBusyAction();
  const resend = useBusyAction();

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = window.setInterval(() => setResendCooldown((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [resendCooldown]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // The form is read before anything awaits, because currentTarget is gone
    // by the time the request settles.
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email"));
    const password = String(data.get("password"));
    await signIn.run(async () => {
      setError("");
      setResendMessage("");
      try {
        clearAuthSession();
        const result = await garudaApi.signIn(email, password);
        storeAuthSession(result);
        const requested = new URLSearchParams(window.location.search).get("next");
        router.push(requested?.startsWith("/app") ? requested : "/app");
        return keepBusyUntilNavigation;
      } catch (reason) {
        if (reason instanceof ApiError && ["email_not_verified", "email_unverified"].includes(reason.code)) {
          setResendEmail(email);
          setError("Verify your email before signing in. You can request a fresh link below.");
        } else {
          setResendEmail("");
          setError(reason instanceof Error ? reason.message : "Could not sign in. Please try again.");
        }
      }
    });
  }

  async function resendVerification() {
    if (!resendEmail || resendCooldown > 0) return;
    await resend.run(async () => {
      setResendMessage("");
      try {
        const result = await garudaApi.resendVerification(resendEmail);
        setResendMessage(result.message);
        setResendCooldown(30);
      } catch (reason) {
        setResendMessage(reason instanceof Error ? reason.message : "Could not resend the verification email.");
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="space-y-2"><Label htmlFor="email">Work email</Label><Input id="email" name="email" type="email" placeholder="you@company.com" autoComplete="email" defaultValue={demoMode ? "demo@garuda.ai" : undefined} required /></div>
      <div className="space-y-2"><div className="flex justify-between"><Label htmlFor="password">Password</Label><Link href="/auth/forgot-password" className="text-xs font-semibold text-indigo-600 hover:text-indigo-700">Forgot password?</Link></div><div className="relative"><Input id="password" name="password" type={showPassword ? "text" : "password"} defaultValue={demoMode ? "demopassword" : undefined} autoComplete="current-password" required className="pr-11" /><button type="button" onClick={() => setShowPassword((shown) => !shown)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700" aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div></div>
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
      {resendEmail && <div className="space-y-2 rounded-xl border border-indigo-200 bg-indigo-50 p-3"><p className="text-xs leading-5 text-indigo-700">Verification email: <span className="font-semibold">{resendEmail}</span></p><Button type="button" variant="outline" className="w-full border-indigo-200 bg-white" disabled={resendCooldown > 0} loading={resend.busy} loadingLabel="Sending the verification email" onClick={resendVerification}>{resendCooldown > 0 ? `Resend available in ${resendCooldown}s` : "Resend verification email"}</Button>{resendMessage && <p role="status" className="text-[10px] leading-4 text-indigo-700">{resendMessage}</p>}</div>}
      <Button type="submit" size="lg" className="w-full" loading={signIn.busy} loadingLabel="Signing you in">Sign in to Garuda <ArrowRight className="ml-2 h-4 w-4" /></Button>
      {process.env.NEXT_PUBLIC_API_URL && <><div className="flex items-center gap-3"><div className="h-px flex-1 bg-slate-200" /><span className="text-[10px] font-semibold uppercase tracking-[.14em] text-slate-400">or</span><div className="h-px flex-1 bg-slate-200" /></div><GoogleAuthButton mode="sign-in" /></>}
      <p className="text-center text-sm text-slate-500">New to Garuda? <Link href="/auth/sign-up" className="font-semibold text-indigo-600 hover:text-indigo-700">Create an account</Link></p>
    </form>
  );
}
