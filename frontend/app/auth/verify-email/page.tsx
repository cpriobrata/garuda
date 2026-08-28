import { AuthShell } from "@/components/auth/auth-shell";
import { VerifyEmailPanel } from "@/components/auth/verify-email-panel";

export default function VerifyEmailPage() {
  return <AuthShell eyebrow="Account security" title="Verify your email." description="We are confirming the one-time link sent to your inbox."><VerifyEmailPanel /></AuthShell>;
}
