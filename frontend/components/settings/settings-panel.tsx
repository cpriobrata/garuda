"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, KeyRound, LockKeyhole, Save, ShieldCheck, Webhook } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button, Spinner } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fetchConnectedApps, saveDisplayName, type ConnectedApp } from "@/components/settings/settings-api";
import { garudaApi } from "@/lib/api";
import { useBusyAction } from "@/lib/busy-action";

type AccountView = { name: string; email: string; workspace: string; workspaceID: string; role: string };

export function SettingsPanel() {
  const [account, setAccount] = useState<AccountView | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [draftName, setDraftName] = useState("");
  const [nameSaved, setNameSaved] = useState(false);
  const [nameError, setNameError] = useState("");
  const [connectedApps, setConnectedApps] = useState<ConnectedApp[] | "unavailable" | null>(null);
  const save = useBusyAction();

  useEffect(() => {
    garudaApi.me().then((value) => { setAccount({ name: value.user.name || "", email: value.user.email, workspace: value.organization.name, workspaceID: value.organization.id, role: value.organization.role }); setDraftName(value.user.name || ""); }).catch((reason) => setLoadError(reason instanceof Error ? reason.message : "Could not load your account details.")).finally(() => setLoading(false));
    fetchConnectedApps().then(setConnectedApps).catch(() => setConnectedApps("unavailable"));
  }, []);

  const storedName = account?.name.trim() || "";
  const email = account?.email || "";
  // The field edits the stored name, empty included; this fallback is only for
  // the places that need something to print before a name has ever been saved.
  const displayName = storedName || (email ? email.split("@")[0] : "Account");
  const role = account?.role || "owner";

  async function submitProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = draftName.trim();
    // Checked before the button goes busy, so the same 1-120 rule the API enforces
    // reads as a correction to make rather than as work that failed.
    if (!next || next.length > 120) { setNameSaved(false); setNameError("A display name of 1 to 120 characters is required."); return; }
    await save.run(async () => {
      setNameError("");
      setNameSaved(false);
      try {
        const user = await saveDisplayName(next);
        setAccount((current) => current && { ...current, name: user.name });
        setDraftName(user.name);
        setNameSaved(true);
      } catch (reason) { setNameError(reason instanceof Error ? reason.message : "Could not save your display name."); }
    });
  }

  return (
    <Tabs defaultValue="profile" orientation="vertical" className="grid gap-6 lg:grid-cols-[190px_1fr]">
      <TabsList className="flex h-auto flex-row justify-start gap-1 overflow-x-auto bg-transparent p-0 lg:flex-col lg:items-stretch">
        {[{ id: "profile", label: "Profile" }, { id: "workspace", label: "Workspace" }, { id: "team", label: "Team members" }, { id: "notifications", label: "Notifications" }, { id: "integrations", label: "Integrations" }, { id: "security", label: "Security" }].map((item) => <TabsTrigger key={item.id} value={item.id} className="shrink-0 justify-start px-3 py-2 text-xs data-[state=active]:bg-white data-[state=active]:text-indigo-700 data-[state=active]:shadow-sm lg:w-full">{item.label}</TabsTrigger>)}
      </TabsList>
      <div>
        {loadError && <p role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">{loadError}</p>}
        <TabsContent value="profile" className="mt-0"><SettingsCard title="Personal profile" description="Your account details from the Garuda API." loading={loading}><form onSubmit={submitProfile}><div className="flex items-center gap-4"><Avatar className="h-16 w-16"><AvatarFallback className="bg-slate-950 text-base font-bold text-white">{initialsOf(displayName)}</AvatarFallback></Avatar><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900">{displayName}</p><p className="mt-0.5 truncate text-xs text-slate-500">{email || "—"}</p></div></div><div className="mt-7 grid gap-5 sm:grid-cols-2"><div><Label htmlFor="display-name">Display name</Label><Input id="display-name" value={draftName} maxLength={120} disabled={loading} placeholder="How your name appears in Garuda" className="mt-2" onChange={(event) => { setDraftName(event.target.value); setNameSaved(false); setNameError(""); }} /><p className="mt-1.5 text-[10px] leading-4 text-slate-500">Shown on your conversations, leads and this panel.</p></div><Field label="Email address" value={email} type="email" hint="Your email identifies the account. Changing it would need a fresh verification round trip, which the API does not implement, so it is fixed here." /></div>{nameError && <p role="alert" className="mt-5 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">{nameError}</p>}{nameSaved && <p role="status" className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700">Display name saved.</p>}<div className="mt-7 flex justify-end border-t pt-5"><Button type="submit" size="sm" disabled={loading || draftName.trim() === storedName} loading={save.busy} loadingLabel="Saving your display name"><Save className="mr-1.5 h-3.5 w-3.5" /> Save changes</Button></div></form></SettingsCard></TabsContent>

        <TabsContent value="workspace" className="mt-0"><SettingsCard title="Workspace" description="How this workspace is identified across your Garuda account." loading={loading}><div className="grid gap-5 sm:grid-cols-2"><Field label="Workspace name" value={account?.workspace || ""} hint="Taken from the account created at sign-up. The API exposes no rename, so this is read-only." /><Field label="Workspace ID" value={account?.workspaceID || ""} hint="Quote this if you contact support about the workspace." /></div></SettingsCard><div className="mt-5 rounded-xl border bg-white p-5 shadow-sm"><h3 className="text-sm font-semibold text-slate-900">Closing this workspace</h3><p className="mt-1.5 text-xs leading-5 text-slate-500">Closing a workspace removes its agents, conversations and leads for good. There is no self-serve delete in this release, so email <a className="font-medium text-indigo-600 underline-offset-2 hover:underline" href="mailto:support@ravan.ai">support@ravan.ai</a> from the owner address and we will close it for you.</p></div></TabsContent>

        <TabsContent value="team" className="mt-0"><SettingsCard title="Team members" description="Who can sign in to this workspace." loading={loading}><div className="flex items-center gap-3 rounded-xl border p-4"><Avatar className="h-10 w-10"><AvatarFallback className="bg-slate-950 text-xs font-bold text-white">{initialsOf(displayName)}</AvatarFallback></Avatar><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold text-slate-800">{displayName}</p><p className="mt-0.5 truncate text-[10px] text-slate-500">{email || "—"}</p></div><Badge variant="secondary">{role.charAt(0).toUpperCase() + role.slice(1)}</Badge></div><p className="mt-4 text-[10px] leading-5 text-slate-500">A Garuda workspace has a single owner today. Extra seats, invitations and per-member roles are not part of the current plan, so this list will always hold one person.</p></SettingsCard></TabsContent>

        <TabsContent value="notifications" className="mt-0"><SettingsCard title="Notifications" description="What Garuda sends today, and where the rest is configured."><p className="text-xs leading-6 text-slate-600">Garuda sends transactional email only: a verification link when you sign up, a welcome message once that address is confirmed, and a reset link whenever you ask to recover your password. There are no digest or alert emails behind a switch, so there is nothing to turn on here.</p><p className="mt-4 text-xs leading-6 text-slate-600">Lead and conversation notifications travel as signed outbound webhooks instead. Register an HTTPS endpoint for <code className="rounded bg-slate-100 px-1 py-0.5 text-[11px] text-slate-700">lead.created</code>, <code className="rounded bg-slate-100 px-1 py-0.5 text-[11px] text-slate-700">conversation.started</code> or <code className="rounded bg-slate-100 px-1 py-0.5 text-[11px] text-slate-700">conversation.ended</code> and point it at Slack, your CRM or an automation tool to hear the moment a lead lands.</p><Button variant="outline" size="sm" className="mt-5" asChild><Link href="/app/integrations">Configure webhooks <ArrowUpRight className="ml-1.5 h-3.5 w-3.5" /></Link></Button></SettingsCard></TabsContent>

        <TabsContent value="integrations" className="mt-0"><SettingsCard title="Integrations" description="Connections that are live on this deployment."><div className="rounded-xl border p-4"><div className="flex items-start gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-600"><Webhook className="h-4 w-4" /></span><div className="min-w-0 flex-1"><p className="text-xs font-semibold text-slate-800">Outbound webhooks</p><p className="mt-1 text-[10px] leading-4 text-slate-500">Push every captured lead and conversation event to your own endpoint, signed with HMAC-SHA256 and retried when a delivery fails.</p></div><Badge variant="success">Available</Badge></div><Button variant="outline" size="sm" className="mt-4 w-full" asChild><Link href="/app/integrations">Open integrations <ArrowUpRight className="ml-1.5 h-3.5 w-3.5" /></Link></Button></div><p className="mt-4 text-[10px] leading-5 text-slate-500">{connectedAppsSummary(connectedApps)}</p></SettingsCard></TabsContent>

        <TabsContent value="security" className="mt-0"><SettingsCard title="Security" description="How access to this account is protected."><div className="space-y-3"><SecurityRow icon={LockKeyhole} title="Password recovery" text="Email yourself a signed reset link from the sign-in flow. The link expires and can only be used once." action={<Button variant="outline" size="sm" asChild><Link href="/auth/forgot-password">Reset password</Link></Button>} /><SecurityRow icon={ShieldCheck} title="Two-factor authentication" text="Second factors belong to the identity provider you sign in with: a Google account carries whatever factor is set on Google. Email-and-password sign-in does not add one." /><SecurityRow icon={KeyRound} title="Devices and sessions" text="Signing out ends the session on this device only; there is no endpoint that revokes another device from here. For a Garuda password account, changing your password is what cuts the others off: it retires every access and refresh token already issued." /></div></SettingsCard></TabsContent>
      </div>
    </Tabs>
  );
}

function initialsOf(name: string) {
  return name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

function connectedAppsSummary(apps: ConnectedApp[] | "unavailable" | null) {
  if (apps === null) return "Checking for connected app accounts…";
  if (apps === "unavailable") return "Connected app accounts are not enabled on this deployment, so outbound webhooks are the only integration path.";
  if (apps.length === 0) return "No third-party app accounts are connected to this workspace yet.";
  return `${apps.length} third-party app account${apps.length === 1 ? " is" : "s are"} connected to this workspace.`;
}

function SettingsCard({ title, description, action, loading = false, children }: { title: string; description: string; action?: React.ReactNode; loading?: boolean; children: React.ReactNode }) {
  return <section className="rounded-xl border bg-white shadow-sm" aria-busy={loading || undefined}><div className="flex items-start justify-between border-b p-5 sm:p-6"><div><h2 className="text-sm font-semibold text-slate-900">{title}</h2><p className="mt-1 text-xs text-slate-500">{description}</p></div>{action}</div><div className="p-5 sm:p-6">{loading && <p role="status" className="mb-5 flex items-center gap-2 text-[10px] font-medium text-slate-500"><Spinner className="h-3.5 w-3.5 text-slate-400" /> Loading your account details…</p>}{children}</div></section>;
}

function Field({ label, value, type = "text", hint }: { label: string; value: string; type?: string; hint?: string }) {
  const id = label.toLowerCase().replaceAll(" ", "-"); return <div><Label htmlFor={id}>{label}</Label><Input id={id} type={type} value={value} readOnly className="mt-2 bg-slate-50" />{hint && <p className="mt-1.5 text-[10px] leading-4 text-slate-500">{hint}</p>}</div>;
}

function SecurityRow({ icon: Icon, title, text, action }: { icon: React.ComponentType<{ className?: string }>; title: string; text: string; action?: React.ReactNode }) {
  return <div className="flex items-center gap-3 rounded-xl border p-4"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-600"><Icon className="h-4 w-4" /></span><div className="flex-1"><p className="text-xs font-semibold text-slate-800">{title}</p><p className="mt-1 text-[10px] leading-4 text-slate-500">{text}</p></div>{action}</div>;
}
