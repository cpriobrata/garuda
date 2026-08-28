"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Script from "next/script";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, clearAuthSession, garudaApi, storeAuthSession } from "@/lib/api";

type GoogleCredentialResponse = { credential?: string };
type LinkRequest = { credential: string; email: string };

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (options: { client_id: string; callback: (response: GoogleCredentialResponse) => void; ux_mode?: "popup"; cancel_on_tap_outside?: boolean }) => void;
          renderButton: (element: HTMLElement, options: { type: "standard"; theme: "outline"; size: "large"; shape: "rectangular"; text: "signin_with" | "signup_with"; width: number; logo_alignment: "left" }) => void;
          cancel: () => void;
        };
      };
    };
  }
}

export function GoogleAuthButton({ mode }: { mode: "sign-in" | "sign-up" }) {
  const router = useRouter();
  const connected = Boolean(process.env.NEXT_PUBLIC_API_URL);
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  const containerRef = useRef<HTMLDivElement>(null);
  const [scriptReady, setScriptReady] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [linkRequest, setLinkRequest] = useState<LinkRequest>();
  const [password, setPassword] = useState("");

  const continueToWorkspace = useCallback(async () => {
    const bootstrap = await garudaApi.me();
    if (!bootstrap.subscription.entitled) router.push("/checkout");
    else if (bootstrap.onboarding.status !== "completed") router.push("/app/onboarding");
    else router.push("/app");
  }, [router]);

  const authenticate = useCallback(async (response: GoogleCredentialResponse) => {
    if (!response.credential) {
      setError("Google did not return a credential. Allow the Google popup and try again.");
      return;
    }
    setWorking(true);
    setError("");
    try {
      clearAuthSession();
      const session = await garudaApi.googleAuth(response.credential);
      storeAuthSession(session);
      await continueToWorkspace();
    } catch (reason) {
      if (reason instanceof ApiError && reason.code === "account_link_required") {
        const details = (reason.details || {}) as { email?: string };
        if (details.email) {
          setLinkRequest({ credential: response.credential, email: details.email });
          setError("");
          setWorking(false);
          return;
        }
      }
      setError(reason instanceof Error ? reason.message : "Google sign-in could not be completed.");
      setWorking(false);
    }
  }, [continueToWorkspace]);

  async function linkExistingAccount() {
    if (!linkRequest || !password) return;
    setWorking(true);
    setError("");
    try {
      clearAuthSession();
      const session = await garudaApi.signIn(linkRequest.email, password);
      storeAuthSession(session);
      await garudaApi.linkGoogle(linkRequest.credential);
      setPassword("");
      setLinkRequest(undefined);
      await continueToWorkspace();
    } catch (reason) {
      clearAuthSession();
      setError(reason instanceof Error ? reason.message : "This Google identity could not be linked.");
      setWorking(false);
    }
  }

  useEffect(() => {
    if (!scriptReady || !clientId || !containerRef.current || !window.google) return;
    try {
      const container = containerRef.current;
      container.replaceChildren();
      window.google.accounts.id.initialize({ client_id: clientId, callback: authenticate, ux_mode: "popup", cancel_on_tap_outside: true });
      window.google.accounts.id.renderButton(container, {
        type: "standard",
        theme: "outline",
        size: "large",
        shape: "rectangular",
        text: mode === "sign-up" ? "signup_with" : "signin_with",
        width: Math.min(400, Math.max(260, container.clientWidth || 400)),
        logo_alignment: "left",
      });
    } catch {
      setError("Google sign-in could not be initialized. Refresh the page and try again.");
    }
    return () => window.google?.accounts.id.cancel();
  }, [authenticate, clientId, mode, scriptReady]);

  if (!connected) return null;

  if (!clientId) {
    return <div><Button type="button" variant="outline" size="lg" className="w-full" disabled>Google sign-in unavailable</Button><p role="status" className="mt-2 text-center text-[10px] text-slate-500">Google Identity Services is not configured for this site.</p></div>;
  }

  if (linkRequest) {
    return <div className="space-y-3 rounded-xl border border-indigo-200 bg-indigo-50 p-4">
      <div><p className="text-sm font-semibold text-indigo-950">Link your existing account</p><p className="mt-1 text-xs leading-5 text-indigo-700">Google matches <span className="font-semibold">{linkRequest.email}</span>. Confirm your existing Garuda password once to link it securely.</p></div>
      <div className="space-y-1.5"><Label htmlFor={`google-link-password-${mode}`}>Garuda password</Label><Input id={`google-link-password-${mode}`} type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void linkExistingAccount(); } }} required /></div>
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
      <Button type="button" className="w-full" disabled={working || !password} onClick={() => void linkExistingAccount()}>{working ? "Linking account..." : "Sign in and link Google"}</Button>
      <Button type="button" variant="ghost" className="w-full" disabled={working} onClick={() => { setLinkRequest(undefined); setPassword(""); setError(""); }}>Cancel</Button>
      <p className="text-center text-[10px] text-indigo-600">The Google credential and password stay in this page&apos;s memory only.</p>
    </div>;
  }

  return <div className="space-y-2">
    <Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" onReady={() => setScriptReady(true)} onLoad={() => setScriptReady(true)} onError={() => setError("Google Identity Services could not be loaded. Check your connection and try again.")} />
    <div className="relative min-h-10">
      <div ref={containerRef} aria-label={mode === "sign-up" ? "Sign up with Google" : "Sign in with Google"} className={working ? "pointer-events-none opacity-60" : ""} />
      {!scriptReady && !error && <Button type="button" variant="outline" size="lg" className="w-full" disabled>Preparing Google sign-in…</Button>}
    </div>
    {working && <p role="status" className="text-center text-[10px] text-indigo-600">Completing secure Google sign-in…</p>}
    {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
    <p className="text-center text-[10px] text-slate-400">If your browser blocks the Google window, allow popups and retry.</p>
  </div>;
}
