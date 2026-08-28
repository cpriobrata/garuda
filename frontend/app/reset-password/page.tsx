import { redirect } from "next/navigation";

export default function ResetPasswordAlias() {
  redirect("/auth/reset-password");
}
