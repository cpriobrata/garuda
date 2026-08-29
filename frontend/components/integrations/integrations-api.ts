import { apiRequest } from "@/lib/api";

export type WebhookEndpoint = {
  id: string;
  url: string;
  description?: string;
  events: string[];
  enabled: boolean;
  status: string;
  suspended_until?: string;
  consecutive_failures: number;
  last_success_at?: string;
  last_failure_at?: string;
  created_at: string;
  updated_at: string;
};

export type WebhookDelivery = {
  id: string;
  endpoint_id: string;
  event: string;
  event_id: string;
  status: string;
  attempts: number;
  response_status?: number;
  last_error?: string;
  next_attempt_at?: string;
  delivered_at?: string;
  created_at: string;
  updated_at: string;
};

export type IntegrationCatalogue = {
  events: Array<{ id: string; label: string; description: string }>;
  signature: {
    header: string;
    format: string;
    signed_value: string;
    algorithm: string;
    tolerance_seconds: number;
    notes: string;
  };
  delivery: {
    method: string;
    content_type: string;
    retries: string;
    guarantee: string;
    requirements: string;
    expected_reply: string;
  };
};

export type CreateEndpointInput = { url: string; description?: string; events: string[] };

const connected = () => Boolean(process.env.NEXT_PUBLIC_API_URL);

// The demo store is what the marketing build and a local `next dev` without an
// API render. It is deliberately mutable so the page behaves like the real one --
// adding an endpoint, sending a test, reading the delivery log -- rather than
// showing a frozen screenshot.
const demoCatalogue: IntegrationCatalogue = {
  events: [
    { id: "lead.created", label: "Lead captured", description: "A visitor completed the lead form on one of your agents." },
    { id: "conversation.started", label: "Conversation started", description: "A visitor sent their first message to one of your agents." },
    { id: "conversation.ended", label: "Conversation ended", description: "A conversation went quiet and is considered finished." },
  ],
  signature: {
    header: "Garuda-Signature",
    format: "t=<unix seconds>,v1=<hex HMAC-SHA256>",
    signed_value: "<t>.<raw request body>",
    algorithm: "HMAC-SHA256",
    tolerance_seconds: 300,
    notes:
      "Identical to the Stripe webhook signature scheme, so any Stripe verifier works unchanged. Verify against the raw body bytes, not a re-encoding of the parsed JSON, and reject a timestamp further than the tolerance from your clock.",
  },
  delivery: {
    method: "POST",
    content_type: "application/json",
    retries: "5 retries with exponential backoff after the first attempt",
    guarantee: "at least once; de-duplicate on the Garuda-Event-Id header",
    requirements: "https only, on the default port; the URL must resolve to a public address",
    expected_reply: "any 2xx; reply 410 Gone to have Garuda stop retrying immediately",
  },
};

const demoEndpoints: WebhookEndpoint[] = [
  {
    id: "whep_demo_zapier",
    url: "https://hooks.zapier.com/hooks/catch/8412990/2f1c9ab/",
    description: "Zapier — create a HubSpot contact",
    events: ["lead.created"],
    enabled: true,
    status: "active",
    consecutive_failures: 0,
    last_success_at: new Date(Date.now() - 1000 * 60 * 12).toISOString(),
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 72).toISOString(),
    updated_at: new Date(Date.now() - 1000 * 60 * 12).toISOString(),
  },
];

const demoDeliveries: WebhookDelivery[] = [
  {
    id: "whdl_demo_1",
    endpoint_id: "whep_demo_zapier",
    event: "lead.created",
    event_id: "evt_demo_1",
    status: "delivered",
    attempts: 1,
    response_status: 200,
    delivered_at: new Date(Date.now() - 1000 * 60 * 12).toISOString(),
    created_at: new Date(Date.now() - 1000 * 60 * 12).toISOString(),
    updated_at: new Date(Date.now() - 1000 * 60 * 12).toISOString(),
  },
  {
    id: "whdl_demo_2",
    endpoint_id: "whep_demo_zapier",
    event: "conversation.started",
    event_id: "evt_demo_2",
    status: "failed",
    attempts: 6,
    response_status: 502,
    last_error: "endpoint responded with status 502",
    created_at: new Date(Date.now() - 1000 * 60 * 90).toISOString(),
    updated_at: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
  },
];

function demoIdentifier(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function fetchCatalogue() {
  return apiRequest<IntegrationCatalogue>("/integrations/events", { mock: () => demoCatalogue });
}

export function fetchEndpoints() {
  return apiRequest<WebhookEndpoint[]>("/integrations/webhooks", { mock: () => [...demoEndpoints] });
}

export function createEndpoint(input: CreateEndpointInput) {
  return apiRequest<{ endpoint: WebhookEndpoint; secret: string }>("/integrations/webhooks", {
    method: "POST",
    body: JSON.stringify(input),
    timeoutMs: 15000,
    mock: () => {
      const endpoint: WebhookEndpoint = {
        id: demoIdentifier("whep"),
        url: input.url,
        description: input.description,
        events: input.events,
        enabled: true,
        status: "active",
        consecutive_failures: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      demoEndpoints.unshift(endpoint);
      return { endpoint, secret: `whsec_${demoIdentifier("demo")}` };
    },
  });
}

export function updateEndpoint(endpointID: string, patch: { enabled?: boolean; events?: string[]; url?: string; description?: string }) {
  return apiRequest<WebhookEndpoint>(`/integrations/webhooks/${encodeURIComponent(endpointID)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
    mock: () => {
      const endpoint = demoEndpoints.find((candidate) => candidate.id === endpointID);
      if (!endpoint) throw new Error("not found");
      Object.assign(endpoint, patch, { status: patch.enabled === false ? "disabled" : "active", updated_at: new Date().toISOString() });
      return { ...endpoint };
    },
  });
}

export function deleteEndpoint(endpointID: string) {
  return apiRequest<{ deleted: boolean }>(`/integrations/webhooks/${encodeURIComponent(endpointID)}`, {
    method: "DELETE",
    mock: () => {
      const index = demoEndpoints.findIndex((candidate) => candidate.id === endpointID);
      if (index >= 0) demoEndpoints.splice(index, 1);
      return { deleted: true };
    },
  });
}

export function rotateSecret(endpointID: string) {
  return apiRequest<{ secret: string }>(`/integrations/webhooks/${encodeURIComponent(endpointID)}/secret`, {
    method: "POST",
    mock: () => ({ secret: `whsec_${demoIdentifier("demo")}` }),
  });
}

export function sendTestEvent(endpointID: string) {
  return apiRequest<WebhookDelivery>(`/integrations/webhooks/${encodeURIComponent(endpointID)}/test`, {
    method: "POST",
    mock: () => {
      const delivery: WebhookDelivery = {
        id: demoIdentifier("whdl"),
        endpoint_id: endpointID,
        event: "webhook.test",
        event_id: demoIdentifier("evt"),
        status: "delivered",
        attempts: 1,
        response_status: 200,
        delivered_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      demoDeliveries.unshift(delivery);
      return delivery;
    },
  });
}

export function fetchDeliveries(endpointID: string) {
  return apiRequest<WebhookDelivery[]>(`/integrations/webhooks/${encodeURIComponent(endpointID)}/deliveries`, {
    mock: () => demoDeliveries.filter((delivery) => delivery.endpoint_id === endpointID || demoEndpoints.length > 0).slice(0, 10),
  });
}

export const integrationsAreLive = connected;
