import { apiRequest } from "@/lib/api";

// The Composio side of integrations: each customer connects THEIR OWN accounts.
// Nothing here sends an account id -- the server takes it from the session, which
// is what stops one workspace reaching another's connections.

export type Toolkit = {
  slug: string;
  name: string;
  description?: string;
  logo?: string;
  categories?: string[];
};

export type ToolkitPage = {
  items: Toolkit[];
  nextCursor?: string;
  totalItems: number;
};

export type Connection = {
  id: string;
  toolkit: string;
  status: string;
  created_at?: string;
  redirect_url?: string;
};

export type Category = { id: string; name: string };

// Every call here is the server relaying one or more calls to Composio, and the
// server's own client allows each of those 20 seconds. apiRequest defaults to 8,
// which aborts requests that were still going to succeed -- and an abort rejects
// with a DOMException rather than an ApiError, so it reaches the screen as
// "signal is aborted without reason" instead of anything a person can act on.
const providerCall = 20000;

function query(params: Record<string, string | number | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const encoded = search.toString();
  return encoded ? "?" + encoded : "";
}

export async function fetchToolkits(input: {
  search?: string;
  category?: string;
  cursor?: string;
  limit?: number;
}): Promise<ToolkitPage> {
  let meta: { next_cursor?: string; total_items?: number } | undefined;
  const items = await apiRequest<Toolkit[]>("/integrations/catalog" + query(input), {
    method: "GET",
    timeoutMs: providerCall,
    onMeta: (value) => {
      meta = value as { next_cursor?: string; total_items?: number };
    },
  });
  return { items: items ?? [], nextCursor: meta?.next_cursor, totalItems: meta?.total_items ?? 0 };
}

export function fetchCategories() {
  return apiRequest<Category[]>("/integrations/categories", { method: "GET", timeoutMs: providerCall });
}

export function fetchConnections() {
  return apiRequest<Connection[]>("/integrations/connections", { method: "GET", timeoutMs: providerCall });
}

// The first connection to a given app costs three sequential provider calls --
// look for an auth config, create one because there is none yet, then create the
// link -- so this is the one call that can honestly run for a minute.
export function connectToolkit(toolkit: string) {
  return apiRequest<Connection>("/integrations/connections", {
    method: "POST",
    body: JSON.stringify({ toolkit }),
    timeoutMs: providerCall * 3,
  });
}

// Two provider calls: the connections are re-listed to prove the caller owns
// this one before anything is deleted.
export function disconnectToolkit(connectionID: string) {
  return apiRequest<{ disconnected: boolean; connection_id: string }>(
    "/integrations/connections/" + encodeURIComponent(connectionID),
    { method: "DELETE", timeoutMs: providerCall * 2 },
  );
}

// ---- What connecting an app will actually do --------------------------------
// Mirrors the table in backend/internal/composio/capability.go, which is the
// single place that answers the question. Only the apps in it have anything
// wired to them; every other toolkit in the catalogue connects, keeps working,
// and is read by nothing -- and the screen has to say so rather than imply a
// promise the code cannot keep.

export type Capability = "calendar" | "leads" | "notify";

export type AppRole = {
  toolkit: string;
  capability: Capability;
  label: string;
  // The sentence a customer reads before connecting. It is the reason this
  // endpoint exists, so it is shown whole and never truncated.
  use_case: string;
  // The one thing this job needs configuring, named before they connect so they
  // know what they will have to hand over. Absent when it needs none.
  setting_label?: string;
  setting_hint?: string;
  // A job the provider only half supports. Calendly's booking finishing on its
  // own page is the case this exists for.
  partial?: boolean;
  partial_note?: string;
};

// Listed separately by the API because choosing a calendar is a different
// decision from connecting one: an agent books into exactly one, and only some
// of them can finish a booking inside the chat.
export type CalendarChoice = { toolkit: string; label: string; setting_label: string; books_in_chat: boolean };

export type IntegrationRoles = { roles: AppRole[]; calendars: CalendarChoice[] };

// Answered from a table compiled into the API rather than relayed to Composio,
// so this one keeps apiRequest's ordinary timeout and still answers on a
// deployment where the catalogue itself is unavailable.
export function fetchRoles() {
  return apiRequest<IntegrationRoles>("/integrations/roles", { method: "GET" });
}
