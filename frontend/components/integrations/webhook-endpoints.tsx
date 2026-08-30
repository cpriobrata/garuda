"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  KeyRound,
  Loader2,
  Plus,
  Send,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createEndpoint,
  deleteEndpoint,
  fetchCatalogue,
  fetchDeliveries,
  fetchEndpoints,
  integrationsAreLive,
  rotateSecret,
  sendTestEvent,
  updateEndpoint,
  type IntegrationCatalogue,
  type WebhookDelivery,
  type WebhookEndpoint,
} from "@/components/integrations/integrations-api";

function messageOf(reason: unknown) {
  if (reason instanceof Error && reason.message) return reason.message;
  return "Something went wrong. Please try again.";
}

function formatMoment(value?: string) {
  if (!value) return "—";
  const moment = new Date(value);
  if (Number.isNaN(moment.getTime())) return "—";
  return moment.toLocaleString();
}

function statusVariant(status: string) {
  if (status === "delivered" || status === "active") return "success" as const;
  if (status === "failed") return "destructive" as const;
  if (status === "suspended" || status === "pending") return "warning" as const;
  return "secondary" as const;
}

export function WebhookEndpoints() {
  const live = integrationsAreLive();
  const [catalogue, setCatalogue] = useState<IntegrationCatalogue | null>(null);
  const [endpoints, setEndpoints] = useState<WebhookEndpoint[] | null>(null);
  const [deliveries, setDeliveries] = useState<Record<string, WebhookDelivery[]>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [issuedSecret, setIssuedSecret] = useState<{ endpointID: string; secret: string } | null>(null);
  const [copied, setCopied] = useState(false);
  // Deleting an endpoint also deletes every delivery recorded against it, and
  // the signing secret was shown once and cannot be recovered. None of that is
  // guessable from a trash icon, and none of it has an undo.
  const [confirmingDelete, setConfirmingDelete] = useState<WebhookEndpoint | null>(null);
  // A failed fetch used to leave "Loading deliveries…" on screen forever, which
  // reads as "still working" rather than "this did not load", so nobody retried.
  const [deliveryErrors, setDeliveryErrors] = useState<Record<string, string>>({});

  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [selectedEvents, setSelectedEvents] = useState<string[]>(["lead.created"]);

  const load = useCallback(async () => {
    try {
      const [loadedCatalogue, loadedEndpoints] = await Promise.all([fetchCatalogue(), fetchEndpoints()]);
      setCatalogue(loadedCatalogue);
      setEndpoints(loadedEndpoints);
    } catch (reason) {
      setError(messageOf(reason));
      setEndpoints([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleEvent = (eventID: string) => {
    setSelectedEvents((current) => (current.includes(eventID) ? current.filter((value) => value !== eventID) : [...current, eventID]));
  };

  const submit = async () => {
    setError(null);
    setNotice(null);
    setPending("create");
    try {
      const created = await createEndpoint({ url: url.trim(), description: description.trim() || undefined, events: selectedEvents });
      setIssuedSecret({ endpointID: created.endpoint.id, secret: created.secret });
      setCopied(false);
      setUrl("");
      setDescription("");
      setEndpoints((current) => [created.endpoint, ...(current || [])]);
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setPending(null);
    }
  };

  const runAction = async (key: string, action: () => Promise<void>) => {
    setError(null);
    setNotice(null);
    setPending(key);
    try {
      await action();
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setPending(null);
    }
  };

  const loadDeliveries = async (endpointID: string) => {
    setDeliveryErrors((current) => {
      const next = { ...current };
      delete next[endpointID];
      return next;
    });
    try {
      const rows = await fetchDeliveries(endpointID);
      setDeliveries((current) => ({ ...current, [endpointID]: rows }));
    } catch (reason) {
      setDeliveryErrors((current) => ({ ...current, [endpointID]: messageOf(reason) }));
    }
  };

  const copySecret = async () => {
    if (!issuedSecret) return;
    try {
      await navigator.clipboard.writeText(issuedSecret.secret);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="space-y-6">
      {!live && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>Demo data. Connect the API to manage real endpoints.</span>
        </div>
      )}
      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <Check className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      <HowItWorks catalogue={catalogue} />

      {issuedSecret && (
        <Card className="border-indigo-200 bg-indigo-50/60">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <KeyRound className="h-4 w-4 text-indigo-600" /> Copy this signing secret now
            </CardTitle>
            <CardDescription>
              It is shown once and never again. Store it wherever you verify the signature; if you lose it, rotate the secret to
              issue a new one.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <code className="flex-1 overflow-x-auto rounded-lg border bg-white px-3 py-2 font-mono text-xs text-slate-800">
              {issuedSecret.secret}
            </code>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={copySecret}>
                {copied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
                {copied ? "Copied" : "Copy"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setIssuedSecret(null)}>
                Done
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base">Add an endpoint</CardTitle>
          <CardDescription>
            Paste the URL your CRM, Zapier, Make, n8n or Pipedream gave you. It must be https on the default port and resolve to a
            public address.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="webhook-url">Endpoint URL</Label>
                <Input
                  id="webhook-url"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="https://hooks.zapier.com/hooks/catch/…"
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="webhook-description">Label (optional)</Label>
                <Input
                  id="webhook-description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Zapier — create a HubSpot contact"
                />
              </div>
            </div>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-slate-900">Send these events</legend>
              <div className="grid gap-2 sm:grid-cols-3">
                {(catalogue?.events || []).map((catalogueEvent) => (
                  <label
                    key={catalogueEvent.id}
                    className="flex cursor-pointer items-start gap-2 rounded-lg border bg-white p-3 text-sm transition-colors hover:border-slate-300"
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 rounded border-slate-300"
                      checked={selectedEvents.includes(catalogueEvent.id)}
                      onChange={() => toggleEvent(catalogueEvent.id)}
                    />
                    <span>
                      <span className="block font-medium text-slate-900">{catalogueEvent.label}</span>
                      <span className="mt-0.5 block text-xs text-slate-500">{catalogueEvent.description}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <Button type="submit" disabled={pending === "create" || !url.trim() || selectedEvents.length === 0}>
              {pending === "create" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              {pending === "create" ? "Adding…" : "Add endpoint"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Your endpoints</h2>
        {endpoints === null && (
          <div className="flex items-center gap-2 rounded-xl border bg-white p-6 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading endpoints…
          </div>
        )}
        {endpoints !== null && endpoints.length === 0 && (
          <div className="rounded-xl border border-dashed bg-white p-8 text-center text-sm text-slate-500">
            No endpoints yet. Add one above and every new lead will arrive in your CRM within seconds.
          </div>
        )}
        {(endpoints || []).map((endpoint) => (
          <Card key={endpoint.id}>
            <CardContent className="space-y-4 p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate font-medium text-slate-900">{endpoint.description || "Webhook endpoint"}</p>
                    <Badge variant={statusVariant(endpoint.status)}>{endpoint.status}</Badge>
                    {endpoint.consecutive_failures > 0 && (
                      <Badge variant="warning">{endpoint.consecutive_failures} failures in a row</Badge>
                    )}
                  </div>
                  <p className="mt-1 break-all font-mono text-xs text-slate-500">{endpoint.url}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {endpoint.events.map((eventID) => (
                      <Badge key={eventID} variant="outline" className="font-mono text-[10px]">
                        {eventID}
                      </Badge>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-slate-400">
                    Last success {formatMoment(endpoint.last_success_at)} · Last failure {formatMoment(endpoint.last_failure_at)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={pending === `test:${endpoint.id}`}
                    onClick={() =>
                      void runAction(`test:${endpoint.id}`, async () => {
                        await sendTestEvent(endpoint.id);
                        setNotice("Test event queued. It is delivered in the background; refresh the deliveries below in a moment.");
                        if (expanded === endpoint.id) await loadDeliveries(endpoint.id);
                      })
                    }
                  >
                    {pending === `test:${endpoint.id}` ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="mr-2 h-4 w-4" />
                    )}
                    {pending === `test:${endpoint.id}` ? "Sending…" : "Send test"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={pending === `toggle:${endpoint.id}`}
                    onClick={() =>
                      void runAction(`toggle:${endpoint.id}`, async () => {
                        const updated = await updateEndpoint(endpoint.id, { enabled: !endpoint.enabled });
                        setEndpoints((current) => (current || []).map((row) => (row.id === updated.id ? updated : row)));
                      })
                    }
                  >
                    {pending === `toggle:${endpoint.id}` && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {endpoint.enabled ? "Disable" : "Enable"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={pending === `rotate:${endpoint.id}`}
                    onClick={() =>
                      void runAction(`rotate:${endpoint.id}`, async () => {
                        const rotated = await rotateSecret(endpoint.id);
                        setIssuedSecret({ endpointID: endpoint.id, secret: rotated.secret });
                        setCopied(false);
                      })
                    }
                  >
                    {pending === `rotate:${endpoint.id}` ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <KeyRound className="mr-2 h-4 w-4" />
                    )}
                    {pending === `rotate:${endpoint.id}` ? "Rotating…" : "Rotate secret"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                    disabled={pending === `delete:${endpoint.id}`}
                    onClick={() => setConfirmingDelete(endpoint)}
                  >
                    {pending === `delete:${endpoint.id}` ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="mr-2 h-4 w-4" />
                    )}
                    Delete
                  </Button>
                </div>
              </div>

              <div className="border-t pt-3">
                <Button
                  type="button"
                  variant="ghost"
                  className="h-8 px-2 text-sm"
                  disabled={pending === `deliveries:${endpoint.id}`}
                  onClick={() => {
                    if (expanded === endpoint.id) {
                      setExpanded(null);
                      return;
                    }
                    setExpanded(endpoint.id);
                    void runAction(`deliveries:${endpoint.id}`, () => loadDeliveries(endpoint.id));
                  }}
                >
                  {pending === `deliveries:${endpoint.id}` ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : expanded === endpoint.id ? (
                    <ChevronDown className="mr-2 h-4 w-4" />
                  ) : (
                    <ChevronRight className="mr-2 h-4 w-4" />
                  )}
                  Recent deliveries
                </Button>
                {expanded === endpoint.id && (
                  <DeliveryTable
                    rows={deliveries[endpoint.id]}
                    error={deliveryErrors[endpoint.id]}
                    onRetry={() => void loadDeliveries(endpoint.id)}
                  />
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <ConfirmDialog
          open={confirmingDelete !== null}
          onOpenChange={(next) => { if (!next) setConfirmingDelete(null); }}
          title="Delete this endpoint?"
          description={<>Garuda will stop sending events to <span className="font-medium text-slate-700">{confirmingDelete?.url}</span>.</>}
          consequences={[
            "Whatever you have built on the other end — a Zap, a Make scenario, your own server — stops receiving leads and conversation events immediately.",
            "The delivery history for this endpoint is deleted with it, so you will not be able to look back at what was sent or whether it arrived.",
            "The signing secret cannot be recovered. Adding the endpoint again issues a new one, and you will have to update it wherever it is verified.",
          ]}
          confirmLabel="Delete endpoint"
          confirmBusyLabel="Deleting the endpoint"
          cancelLabel="Keep it"
          failureMessage="The endpoint could not be deleted just now."
          onConfirm={async () => {
            const endpoint = confirmingDelete;
            if (!endpoint) return;
            await deleteEndpoint(endpoint.id);
            setEndpoints((current) => (current || []).filter((row) => row.id !== endpoint.id));
            if (expanded === endpoint.id) setExpanded(null);
            setConfirmingDelete(null);
          }}
        />
  
    </div>
  );
}

function DeliveryTable({ rows, error, onRetry }: { rows?: WebhookDelivery[]; error?: string; onRetry?: () => void }) {
  if (error) {
    return (
      <div className="flex flex-wrap items-center gap-3 px-2 py-3 text-sm text-slate-600">
        <span className="text-rose-600">{error}</span>
        {onRetry && <Button type="button" variant="outline" size="sm" onClick={onRetry}>Try again</Button>}
      </div>
    );
  }
  if (!rows) {
    return <p className="px-2 py-3 text-sm text-slate-500">Loading deliveries…</p>;
  }
  if (rows.length === 0) {
    return <p className="px-2 py-3 text-sm text-slate-500">No deliveries yet. Send a test event to check the wiring.</p>;
  }
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead>
          <tr className="text-xs uppercase tracking-wide text-slate-400">
            <th className="py-2 pr-4 font-medium">Event</th>
            <th className="py-2 pr-4 font-medium">Status</th>
            <th className="py-2 pr-4 font-medium">Attempts</th>
            <th className="py-2 pr-4 font-medium">Response</th>
            <th className="py-2 pr-4 font-medium">When</th>
            <th className="py-2 font-medium">Last error</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((delivery) => (
            <tr key={delivery.id} className="align-top">
              <td className="py-2 pr-4 font-mono text-xs text-slate-700">{delivery.event}</td>
              <td className="py-2 pr-4">
                <Badge variant={statusVariant(delivery.status)}>{delivery.status}</Badge>
              </td>
              <td className="py-2 pr-4 text-slate-700">{delivery.attempts}</td>
              <td className="py-2 pr-4 text-slate-700">{delivery.response_status || "—"}</td>
              <td className="py-2 pr-4 text-xs text-slate-500">{formatMoment(delivery.updated_at)}</td>
              <td className="py-2 text-xs text-rose-600">{delivery.last_error || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HowItWorks({ catalogue }: { catalogue: IntegrationCatalogue | null }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-4 w-4 text-emerald-600" /> One webhook reaches every CRM
        </CardTitle>
        <CardDescription>
          Garuda posts each event to your URL as JSON. Point it at Zapier, Make, n8n, Pipedream or your CRM&apos;s own inbound
          webhook and you are connected to anything those platforms support — no per-CRM setup here.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm text-slate-600 sm:grid-cols-2">
        <div className="rounded-lg border bg-slate-50 p-3">
          <p className="font-medium text-slate-900">Verifying the signature</p>
          <p className="mt-1">
            Every request carries <code className="font-mono text-xs">{catalogue?.signature.header || "Garuda-Signature"}</code> in
            the form <code className="font-mono text-xs">{catalogue?.signature.format || "t=…,v1=…"}</code>, an{" "}
            {catalogue?.signature.algorithm || "HMAC-SHA256"} over{" "}
            <code className="font-mono text-xs">{catalogue?.signature.signed_value || "<t>.<raw body>"}</code> using your endpoint
            secret. This is the same scheme Stripe uses, so any Stripe verifier works unchanged.
          </p>
        </div>
        <div className="rounded-lg border bg-slate-50 p-3">
          <p className="font-medium text-slate-900">Delivery behaviour</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            <li>{catalogue?.delivery.retries || "5 retries with exponential backoff after the first attempt"}</li>
            <li>{catalogue?.delivery.guarantee || "at least once; de-duplicate on the Garuda-Event-Id header"}</li>
            <li>{catalogue?.delivery.requirements || "https only, on the default port"}</li>
            <li>{catalogue?.delivery.expected_reply || "any 2xx; reply 410 Gone to stop retries"}</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
