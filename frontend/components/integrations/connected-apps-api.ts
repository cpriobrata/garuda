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
    onMeta: (value) => {
      meta = value as { next_cursor?: string; total_items?: number };
    },
  });
  return { items: items ?? [], nextCursor: meta?.next_cursor, totalItems: meta?.total_items ?? 0 };
}

export function fetchCategories() {
  return apiRequest<Category[]>("/integrations/categories", { method: "GET" });
}

export function fetchConnections() {
  return apiRequest<Connection[]>("/integrations/connections", { method: "GET" });
}

export function connectToolkit(toolkit: string) {
  return apiRequest<Connection>("/integrations/connections", {
    method: "POST",
    body: JSON.stringify({ toolkit }),
  });
}

export function disconnectToolkit(connectionID: string) {
  return apiRequest<{ disconnected: boolean; connection_id: string }>(
    "/integrations/connections/" + encodeURIComponent(connectionID),
    { method: "DELETE" },
  );
}
