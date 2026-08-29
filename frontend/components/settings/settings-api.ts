import { apiRequest } from "@/lib/api";

export type ConnectedApp = { id: string; toolkit: string; status: string };

// PATCH /v1/profile decodes with DisallowUnknownFields and declares `name`
// alone, so any other key in this body would come back as a 400.
export function saveDisplayName(name: string) {
  return apiRequest<{ id: string; email: string; name: string }>("/profile", {
    method: "PATCH",
    body: JSON.stringify({ name }),
    mock: () => ({ id: "demo-user", email: "demo@garuda.ai", name }),
  });
}

// A deployment without Composio credentials answers 503 integrations_not_configured
// here. That is a fact about the deployment, not a failure, so the caller reports
// it as "not enabled" instead of as an error.
export function fetchConnectedApps() {
  return apiRequest<ConnectedApp[]>("/integrations/connections", { mock: () => [] });
}
