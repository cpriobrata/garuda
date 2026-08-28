import { AuthShell } from "@/components/auth/auth-shell";
import { ForgotPasswordForm } from "@/components/auth/password-forms";

export default function ForgotPasswordPage() {
  return (
    <AuthShell eyebrow="Account recovery" title="Reset your password." description="Enter the email you use for Garuda and we’ll send a secure reset link.">
      <ForgotPasswordForm />
    </AuthShell>
  );
}
