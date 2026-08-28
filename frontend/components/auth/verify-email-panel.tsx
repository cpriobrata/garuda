"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, MailCheck, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { clearAuthSession, garudaApi, storeAuthSession } from "@/lib/api";

type VerificationState = "working" | "verified" | "error";

export function VerifyEmailPanel() {
  const started = useRef(false);
  const [state, setState] = useState<VerificationState>("working");
  const [message, setMessage] = useState("Confirming your secure verification link...");

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = new URLSearchParams(window.location.search).get("token");
    clearAuthSession();
    window.history.replaceState({}, document.title, window.location.pathname);

    if (!token) {
      setState("error");
      setMessage("This verification link is missing its token. Request a new email and try again.");
      return;
    }

    void garudaApi.verifyEmail(token).then((session) => {
      storeAuthSession(session);
      setState("verified");
      setMessage("Your email is verified and your Garuda account is ready.");
    }).catch((reason) => {
      clearAuthSession();
      setState("error");
      setMessage(reason instanceof Error ? reason.message : "This verification link could not be confirmed.");
    });
  }, []);

  if (state === "working") {
    return <div role="status" className="rounded-2xl border border-indigo-200 bg-indigo-50 p-5"><div className="flex items-start gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-indigo-600 text-white"><MailCheck className="h-5 w-5" /></span><div><p className="text-sm font-semibold text-indigo-950">Verifying email</p><p className="mt-1 text-xs leading-5 text-indigo-700">{message}</p></div></div></div>;
  }

  if (state === "verified") {
    return <div className="space-y-5"><div role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5"><div className="flex items-start gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-600 text-white"><CheckCircle2 className="h-5 w-5" /></span><div><p className="text-sm font-semibold text-emerald-950">Email verified</p><p className="mt-1 text-xs leading-5 text-emerald-700">{message}</p></div></div></div><Button size="lg" className="w-full" asChild><Link href="/checkout">Continue to plan <ArrowRight className="ml-2 h-4 w-4" /></Link></Button></div>;
  }

  return <div className="space-y-5"><div role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-5"><div className="flex items-start gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-500 text-white"><ShieldAlert className="h-5 w-5" /></span><div><p className="text-sm font-semibold text-amber-950">Link could not be verified</p><p className="mt-1 text-xs leading-5 text-amber-800">{message}</p></div></div></div><Button variant="outline" size="lg" className="w-full" asChild><Link href="/auth/sign-up">Return to sign up</Link></Button><p className="text-center text-xs text-slate-500">Already verified? <Link href="/auth/sign-in" className="font-semibold text-indigo-600">Sign in</Link></p></div>;
}
