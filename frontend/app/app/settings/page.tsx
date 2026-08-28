import { SettingsPanel } from "@/components/settings/settings-panel";

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-[1120px] space-y-6">
      <div><h1 className="text-2xl font-bold tracking-[-.035em] text-slate-950">Settings</h1><p className="mt-1.5 text-sm text-slate-500">Manage your workspace, team, integrations and security.</p></div>
      <SettingsPanel />
    </div>
  );
}
