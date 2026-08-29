import { WebhookEndpoints } from "@/components/integrations/webhook-endpoints";

export default function IntegrationsPage() {
  return (
    <div className="mx-auto max-w-[1120px] space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-[-.035em] text-slate-950">Integrations</h1>
        <p className="mt-1.5 text-sm text-slate-500">
          Send leads and conversations straight into your CRM with signed outbound webhooks.
        </p>
      </div>
      <WebhookEndpoints />
    </div>
  );
}
