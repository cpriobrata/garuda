"use client";

import { useEffect, useState } from "react";
import { KeyRound, LockKeyhole, Save, ShieldCheck, Sparkles, Trash2, UserPlus } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button, Spinner } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { garudaApi } from "@/lib/api";

export function SettingsPanel() {
  const connected = Boolean(process.env.NEXT_PUBLIC_API_URL);
  const [profile, setProfile] = useState(connected ? { name: "Account", email: "", organization: "Workspace" } : { name: "Maya Chen", email: "demo@garuda.ai", organization: "Northstar Labs" });
  // Only the connected workspace waits on a request; the demo panel already
  // holds its values and must not flash a loading state it never needed.
  const [loadingProfile, setLoadingProfile] = useState(connected);

  useEffect(() => {
    garudaApi.me().then((value) => setProfile({ name: value.user.name || value.user.email.split("@")[0], email: value.user.email, organization: value.organization.name })).catch(() => undefined).finally(() => setLoadingProfile(false));
  }, []);

  return (
    <Tabs defaultValue="profile" orientation="vertical" className="grid gap-6 lg:grid-cols-[190px_1fr]">
      <TabsList className="flex h-auto flex-row justify-start gap-1 overflow-x-auto bg-transparent p-0 lg:flex-col lg:items-stretch">
        {[{ id: "profile", label: "Profile" }, { id: "workspace", label: "Workspace" }, { id: "team", label: "Team members" }, { id: "notifications", label: "Notifications" }, { id: "integrations", label: "Integrations" }, { id: "security", label: "Security" }].map((item) => <TabsTrigger key={item.id} value={item.id} className="shrink-0 justify-start px-3 py-2 text-xs data-[state=active]:bg-white data-[state=active]:text-indigo-700 data-[state=active]:shadow-sm lg:w-full">{item.label}</TabsTrigger>)}
      </TabsList>
      <div>
        {connected && <div className="mb-4 rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-[10px] leading-5 text-indigo-700">Connected mode is active. Unsupported team, integration, notification, and security controls are disabled and labeled below.</div>}
        <TabsContent value="profile" className="mt-0"><SettingsCard title="Personal profile" description="Your account details from the Garuda API." loading={loadingProfile}><div className="flex flex-col gap-5 sm:flex-row sm:items-center"><Avatar className="h-16 w-16"><AvatarFallback className="bg-slate-950 text-base font-bold text-white">{profile.name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</AvatarFallback></Avatar><div><div className="flex gap-2"><Button variant="outline" size="sm" disabled>Photo upload coming soon</Button></div><p className="mt-2 text-[10px] text-slate-400">Avatar uploads are not enabled in this release.</p></div></div><div className="mt-7 grid gap-5 sm:grid-cols-2"><Field label="Display name" value={profile.name} /><Field label="Email address" value={profile.email} type="email" /><Field label="Workspace" value={profile.organization} /><Field label="Job title" value="Not set" /></div><div className="mt-5"><Label htmlFor="timezone">Time zone</Label><select id="timezone" disabled className="mt-2 h-11 w-full rounded-lg border bg-slate-50 px-3 text-sm text-slate-500"><option>Time-zone editing coming soon</option></select></div><FooterSave /></SettingsCard></TabsContent>

        <TabsContent value="workspace" className="mt-0"><SettingsCard title="Workspace settings" description="General information used across your Garuda account." loading={loadingProfile}><div className="grid gap-5 sm:grid-cols-2"><Field label="Workspace name" value={profile.organization} /><Field label="Company website" value={connected ? "Not set" : "https://northstarlabs.com"} type="url" /></div><div className="mt-5"><Label htmlFor="workspace-description">Business description</Label><Textarea id="workspace-description" className="mt-2" value={connected ? "" : "Northstar Labs helps growth teams turn website traffic into qualified revenue opportunities."} readOnly placeholder="Not set" /></div><FooterSave /></SettingsCard><div className="mt-5 rounded-xl border border-red-200 bg-white p-5"><h3 className="text-sm font-semibold text-red-700">Danger zone</h3><div className="mt-4 flex flex-col justify-between gap-4 border-t pt-4 sm:flex-row sm:items-center"><div><p className="text-xs font-semibold text-slate-800">Delete workspace</p><p className="mt-1 text-[10px] text-slate-500">Workspace deletion is not enabled in this release.</p></div><Button variant="outline" size="sm" className="border-red-200 text-red-600" disabled><Trash2 className="mr-1.5 h-3.5 w-3.5" /> Coming soon</Button></div></div></TabsContent>

        <TabsContent value="team" className="mt-0"><SettingsCard title="Team members" description="Invite teammates and control their access to this workspace." action={<Button size="sm" disabled><UserPlus className="mr-1.5 h-3.5 w-3.5" /> Coming soon</Button>}><ComingSoon title="Team management is coming soon" text="This build supports the workspace owner. Invitations and role management will appear here after the membership API is enabled." /></SettingsCard></TabsContent>

        <TabsContent value="notifications" className="mt-0"><SettingsCard title="Notifications" description="Notification preferences are planned for a future release."><ComingSoon title="Notification controls are coming soon" text="Handoff, qualified-lead, and weekly digest delivery will be configurable here after notification workers are enabled." /></SettingsCard></TabsContent>

        <TabsContent value="integrations" className="mt-0"><SettingsCard title="Integrations" description="Planned connections for your customer workflow."><div className="grid gap-3 sm:grid-cols-2">{[{ name: "HubSpot", text: "Sync leads and conversation activity", letter: "H", color: "bg-orange-100 text-orange-700" }, { name: "Slack", text: "Receive handoff and lead notifications", letter: "S", color: "bg-violet-100 text-violet-700" }, { name: "Google Calendar", text: "Book meetings from conversations", letter: "G", color: "bg-blue-100 text-blue-700" }, { name: "Zapier", text: "Connect thousands of other apps", letter: "Z", color: "bg-amber-100 text-amber-700" }].map((item) => <div key={item.name} className="rounded-xl border p-4"><div className="flex items-start"><span className={`grid h-9 w-9 place-items-center rounded-xl text-xs font-bold ${item.color}`}>{item.letter}</span><Badge variant="secondary" className="ml-auto">Coming soon</Badge></div><p className="mt-4 text-xs font-semibold text-slate-800">{item.name}</p><p className="mt-1 text-[10px] leading-4 text-slate-500">{item.text}</p><Button variant="outline" size="sm" className="mt-4 w-full" disabled>Not available yet</Button></div>)}</div></SettingsCard></TabsContent>

        <TabsContent value="security" className="mt-0"><SettingsCard title="Security" description="Authentication is handled by your configured identity provider."><div className="space-y-3"><SecurityRow icon={LockKeyhole} title="Password recovery" text="Use the secure password-reset flow from the sign-in page" action="Available at sign-in" /><SecurityRow icon={ShieldCheck} title="Two-factor authentication" text="Identity-provider 2FA management is coming soon" action="Coming soon" /><SecurityRow icon={KeyRound} title="Session management" text="Device and session revocation is coming soon" action="Coming soon" /></div></SettingsCard></TabsContent>
      </div>
    </Tabs>
  );
}

function SettingsCard({ title, description, action, loading = false, children }: { title: string; description: string; action?: React.ReactNode; loading?: boolean; children: React.ReactNode }) {
  return <section className="rounded-xl border bg-white shadow-sm" aria-busy={loading || undefined}><div className="flex items-start justify-between border-b p-5 sm:p-6"><div><h2 className="text-sm font-semibold text-slate-900">{title}</h2><p className="mt-1 text-xs text-slate-500">{description}</p></div>{action}</div><div className="p-5 sm:p-6">{loading && <p role="status" className="mb-5 flex items-center gap-2 text-[10px] font-medium text-slate-500"><Spinner className="h-3.5 w-3.5 text-slate-400" /> Loading your account details…</p>}{children}</div></section>;
}

function Field({ label, value, type = "text" }: { label: string; value: string; type?: string }) {
  const id = label.toLowerCase().replaceAll(" ", "-"); return <div><Label htmlFor={id}>{label}</Label><Input id={id} type={type} value={value} readOnly className="mt-2 bg-slate-50" /></div>;
}

function FooterSave() {
  return <div className="mt-7 flex justify-end border-t pt-5"><Button size="sm" disabled><Save className="mr-1.5 h-3.5 w-3.5" /> Editing coming soon</Button></div>;
}

function SecurityRow({ icon: Icon, title, text, action }: { icon: React.ComponentType<{ className?: string }>; title: string; text: string; action: string }) {
  return <div className="flex items-center gap-3 rounded-xl border p-4"><span className="grid h-9 w-9 place-items-center rounded-xl bg-indigo-50 text-indigo-600"><Icon className="h-4 w-4" /></span><div className="flex-1"><p className="text-xs font-semibold text-slate-800">{title}</p><p className="mt-1 text-[10px] text-slate-500">{text}</p></div><Button variant="outline" size="sm" disabled>{action}</Button></div>;
}

function ComingSoon({ title, text }: { title: string; text: string }) {
  return <div className="rounded-xl border border-dashed bg-slate-50 p-6 text-center"><Sparkles className="mx-auto h-6 w-6 text-indigo-500" /><p className="mt-3 text-xs font-semibold text-slate-800">{title}</p><p className="mx-auto mt-1 max-w-md text-[10px] leading-5 text-slate-500">{text}</p><Badge variant="secondary" className="mt-3">Coming soon</Badge></div>;
}
