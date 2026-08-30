import { apiRequest } from "@/lib/api";

// Where captured leads go besides Garuda.
//
// A destination is per WORKSPACE, not per agent: a customer's CRM is their CRM,
// and setting it once is the point. The list of what can receive a lead is short
// and comes from the server, because every entry is a field mapping somebody had
// to get right -- the outbound webhook section below it on the same page is what
// reaches everything else.

export type LeadRoute = {
  toolkit: string;
  setting: string;
  enabled: boolean;
  failure_count: number;
  last_delivered_at?: string;
  last_error?: string;
  // The destination failed enough times that Garuda stopped trying. Saying so is
  // the difference between somebody fixing it and somebody wondering where their
  // leads went.
  paused: boolean;
};

export type LeadDestination = {
  toolkit: string;
  label: string;
  summary: string;
  // The one value this destination needs beyond the connection. Empty when it
  // needs none -- HubSpot knows where its own contacts go.
  setting_label?: string;
  setting_hint?: string;
};

export type LeadRoutesResponse = { routes: LeadRoute[]; available: LeadDestination[] };

export function fetchLeadRoutes() {
  return apiRequest<LeadRoutesResponse>("/integrations/routes", { method: "GET" });
}

export function saveLeadRoute(input: { toolkit: string; setting?: string; enabled: boolean }) {
  return apiRequest<{ toolkit: string; enabled: boolean; setting: string }>("/integrations/routes", {
    method: "PUT",
    body: JSON.stringify({ toolkit: input.toolkit, setting: input.setting ?? "", enabled: input.enabled }),
  });
}

// One sample lead, sent for real. It reaches a third party and waits on their
// response, so it gets the long timeout rather than the default eight seconds.
export function testLeadRoute(toolkit: string) {
  return apiRequest<{ delivered: boolean }>("/integrations/routes/test", {
    method: "POST",
    body: JSON.stringify({ toolkit, enabled: true }),
    timeoutMs: 30000,
  });
}
