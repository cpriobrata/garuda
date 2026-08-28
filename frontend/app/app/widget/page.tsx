import { WidgetSettings } from "@/components/widget/widget-settings";

export default function WidgetPage() {
  return (
    <div className="mx-auto max-w-[1280px] space-y-6">
      <div><h1 className="text-2xl font-bold tracking-[-.035em] text-slate-950">Website widget</h1><p className="mt-1.5 text-sm text-slate-500">Install Aria on your site and make every detail feel native to your brand.</p></div>
      <WidgetSettings />
    </div>
  );
}
