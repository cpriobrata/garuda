import { AuthShell } from "@/components/auth/auth-shell";
import { SignInForm } from "@/components/auth/sign-in-form";

export default function SignInPage() {
  return <AuthShell eyebrow="Welcome back" title="Continue where you left off." description="Sign in to manage your agents, conversations and leads."><SignInForm /></AuthShell>;
}
