import { Check } from "lucide-react";
import { AuthShell } from "@/components/auth/auth-shell";
import { SignUpForm } from "@/components/auth/sign-up-form";

export default function SignUpPage() {
  return (
    <AuthShell eyebrow="Create your account" title="Build an agent people love talking to." description="Start with a quick setup. You’ll meet your first AI agent in about five minutes.">
      <div className="mb-6 flex flex-wrap gap-2">{["No code needed", "Cancel anytime", "Private by default"].map((item) => <span key={item} className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700"><Check className="h-3 w-3" /> {item}</span>)}</div>
      <SignUpForm />
    </AuthShell>
  );
}
