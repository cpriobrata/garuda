import { ConnectedApps } from "@/components/integrations/connected-apps";
import { WebhookEndpoints } from "@/components/integrations/webhook-endpoints";

export default function IntegrationsPage() {
  return (
    <div className="mx-auto max-w-[1120px] space-y-10">
      <div>
        <h1 className="text-2xl font-bold tracking-[-.035em] text-slate-950">Integrations</h1>
        <p className="mt-1.5 text-sm text-slate-500">
          Connect the apps your team already works in, and send leads and conversations straight into your CRM with signed
          outbound webhooks.
        </p>
      </div>

      <section className="space-y-4" aria-labelledby="connect-your-apps">
        <div>
          <h2 id="connect-your-apps" className="text-lg font-semibold tracking-[-.02em] text-slate-950">Connect your apps</h2>
          <p className="mt-1 text-sm text-slate-500">
            Sign in with the provider once and Garuda keeps the connection for this workspace. Your accounts stay yours; nobody
            else in Garuda can see or use them.
          </p>
        </div>
        <ConnectedApps />
      </section>

      <section className="space-y-4" aria-labelledby="outbound-webhooks">
        <div>
          <h2 id="outbound-webhooks" className="text-lg font-semibold tracking-[-.02em] text-slate-950">Outbound webhooks</h2>
          <p className="mt-1 text-sm text-slate-500">
            Push every captured lead and conversation event to your own HTTPS endpoint, signed so you can verify it came from
            Garuda.
          </p>
        </div>
        <WebhookEndpoints />
      </section>
    </div>
  );
}
