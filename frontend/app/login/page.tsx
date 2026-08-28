import { redirect } from "next/navigation";

export default function LoginAlias() {
  redirect("/auth/sign-in");
}
