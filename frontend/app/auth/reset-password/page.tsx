import { AuthShell } from "@/components/auth/auth-shell";
import { ResetPasswordForm } from "@/components/auth/password-forms";

export default function ResetPasswordPage() {
  return (
    <AuthShell eyebrow="Choose a new password" title="You’re almost back in." description="Make your new password unique and at least eight characters long.">
      <ResetPasswordForm />
    </AuthShell>
  );
}
