import { ConnectedApps } from "@/components/integrations/connected-apps";
import { LeadDestinations } from "@/components/integrations/lead-destinations";
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
            Sign in with the provider once and Garuda keeps the connection for this workspace. Every app says what connecting it
            will actually do before you press anything. Your accounts stay yours; nobody else in Garuda can see or use them.
          </p>
        </div>
        <ConnectedApps />
      </section>

      <section className="space-y-4" aria-labelledby="where-leads-go">
        <div>
          <h2 id="where-leads-go" className="scroll-mt-20 text-lg font-semibold tracking-[-.02em] text-slate-950">
            Where your leads go
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Every lead is saved in Garuda first. Switch on a destination below and each new one is also sent there, from every
            agent in this workspace. Connect the app above before switching it on.
          </p>
        </div>
        <LeadDestinations />
      </section>

      <section className="space-y-4" aria-labelledby="outbound-webhooks">
        <div>
          {/* The cards above link here for every app nothing is wired to, and the
              portal header is sticky, so the heading needs to clear it. */}
          <h2 id="outbound-webhooks" className="scroll-mt-20 text-lg font-semibold tracking-[-.02em] text-slate-950">Outbound webhooks</h2>
          <p className="mt-1 text-sm text-slate-500">
            Push every captured lead and conversation event to your own HTTPS endpoint, signed so you can verify it came from
            Garuda. This is how an app Garuda has nothing wired to — which is most of the catalogue above — still gets your
            leads, through Zapier, Make or n8n.
          </p>
        </div>
        <WebhookEndpoints />
      </section>
    </div>
  );
}
