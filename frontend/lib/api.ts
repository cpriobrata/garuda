import {
  agents as demoAgents,
  conversations as demoConversations,
  leads as demoLeads,
  type Agent,
  type Conversation,
  type Lead,
} from "@/lib/demo-data";

type ApiErrorShape = {
  code: string;
  message: string;
  request_id?: string;
  details?: unknown;
};

type ApiEnvelope<T> = { data?: T; error?: ApiErrorShape; meta?: unknown };

export class ApiError extends Error {
  code: string;
  requestId?: string;
  details?: unknown;

  constructor(error: ApiErrorShape) {
    super(error.message);
    this.name = "ApiError";
    this.code = error.code;
    this.requestId = error.request_id;
    this.details = error.details;
  }
}

export type AuthSession = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
};

export type AuthResult = AuthSession & {
  access_token: string;
  user: { id: string; email: string; name?: string };
  verification_required?: boolean;
};

const ACCESS_TOKEN_KEY = "garuda_access_token";
const REFRESH_TOKEN_KEY = "garuda_refresh_token";
const EXPIRES_AT_KEY = "garuda_access_expires_at";
let authGeneration = 0;
let refreshInFlight: Promise<string | null> | null = null;

export function storeAuthSession(session: AuthSession) {
  if (typeof window === "undefined" || !session.access_token) return;
  authGeneration += 1;
  window.sessionStorage.setItem(ACCESS_TOKEN_KEY, session.access_token);
  if (session.refresh_token) window.sessionStorage.setItem(REFRESH_TOKEN_KEY, session.refresh_token);
  else window.sessionStorage.removeItem(REFRESH_TOKEN_KEY);
  if (session.expires_in) window.sessionStorage.setItem(EXPIRES_AT_KEY, String(Date.now() + session.expires_in * 1000));
  else window.sessionStorage.removeItem(EXPIRES_AT_KEY);
}

export function clearAuthSession() {
  if (typeof window === "undefined") return;
  authGeneration += 1;
  refreshInFlight = null;
  window.sessionStorage.removeItem(ACCESS_TOKEN_KEY);
  window.sessionStorage.removeItem(REFRESH_TOKEN_KEY);
  window.sessionStorage.removeItem(EXPIRES_AT_KEY);
  window.sessionStorage.removeItem("garuda_new_agent_id");
  window.sessionStorage.removeItem("garuda_new_agent_name");
  // Remove legacy origin-wide onboarding keys from earlier builds.
  window.localStorage.removeItem("garuda_new_agent_id");
  window.localStorage.removeItem("garuda_new_agent_name");
}

export type AgentRecord = {
  id: string;
  name: string;
  description: string;
  status: string;
  revision: number;
  system_prompt: string;
  welcome_message: string;
  branding: { primary_color: string; accent_color: string; position: string; launcher_text?: string; allowed_domains?: string[] };
  // The owner's own view of the agent, so the WhatsApp number is present here.
  // The widget bootstrap is a different, deliberately thinner payload.
  handoff?: {
    enabled: boolean;
    whatsapp_number?: string;
    button_label?: string;
    message?: string;
    availability?: string;
    trigger_phrases?: string[];
    auto_offer_after?: number;
    notify_email?: string;
  };
  knowledge: Array<{ id?: string; type?: string; title: string; content: string; source_url?: string; status?: string }>;
};

// The visitor journey the API hangs off a conversation: where the visitor came
// from, every page they read before they spoke, and how long they spent on each.
// Mirrors publicJourney in backend/internal/api/journey.go — the keys that carry
// `omitempty` on the Go side are the ones optional here.
export type JourneySource = {
  // One of direct, organic, paid, social, email, referral, campaign. Derived on
  // the server, and empty when a visit was recorded before any source batch
  // arrived, so it is a plain string rather than a union that lies about "".
  channel: string;
  referrer_domain?: string;
  landing_path?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  // The ad platform, never the click id itself.
  click_id_kind?: "google" | "meta";
};

export type JourneyDevice = {
  form?: "mobile" | "tablet" | "desktop";
  language?: string;
  timezone?: string;
  // Derived from the time zone above, never from an IP lookup. Approximate by
  // construction, which is what region_is_approximate marks.
  region?: string;
};

export type JourneyPage = { path: string; title: string; arrived_at: string; seconds: number };

export type VisitorJourney = {
  source: JourneySource;
  device: JourneyDevice;
  region_is_approximate: boolean;
  pages: JourneyPage[];
  // Every page the visitor was seen on, including any the server dropped from
  // `pages` — so page_count can exceed pages.length, which pages_truncated marks.
  page_count: number;
  pages_truncated: boolean;
  engaged_seconds: number;
  first_seen_at: string;
  last_seen_at: string;
};

export type ConversationDetail = {
  conversation: {
    id: string;
    agent_id: string;
    origin?: string;
    page_url?: string;
    page_title?: string;
    referrer?: string;
    locale?: string;
    created_at: string;
    updated_at: string;
    last_seen_at: string;
    // Absent on sessions recorded before tracking existed and on visits the
    // widget could not report — both mean "not known", never "nothing happened".
    journey?: VisitorJourney;
  };
  messages: Array<{ id: string; role: string; content: string; created_at: string }>;
  lead: { id: string; name?: string; email?: string; phone?: string; company?: string; status: string; source: string; notes?: string } | null;
};

type AgentWrite = Partial<Omit<AgentRecord, "id" | "status" | "revision">>;

function apiRoot() {
  const configured = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "http://localhost:8080";
  return configured.endsWith("/v1") ? configured : `${configured}/v1`;
}

function storedAccessToken() {
  if (typeof window === "undefined") return undefined;
  return window.sessionStorage.getItem(ACCESS_TOKEN_KEY) || undefined;
}

function redirectToExpiredSignIn() {
  clearAuthSession();
  if (typeof window === "undefined" || window.location.pathname.startsWith("/auth/sign-in")) return;
  const next = window.location.pathname.startsWith("/app") ? `&next=${encodeURIComponent(`${window.location.pathname}${window.location.search}`)}` : "";
  window.location.assign(`/auth/sign-in?session=expired${next}`);
}

async function refreshAccessToken(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  if (refreshInFlight) return refreshInFlight;
  const refreshToken = window.sessionStorage.getItem(REFRESH_TOKEN_KEY);
  if (!refreshToken) return null;
  const refreshGeneration = authGeneration;

  const refreshPromise = (async () => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(`${apiRoot()}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
        signal: controller.signal,
      });
      const envelope = (await response.json().catch(() => ({}))) as ApiEnvelope<AuthSession>;
      if (authGeneration !== refreshGeneration || window.sessionStorage.getItem(REFRESH_TOKEN_KEY) !== refreshToken) {
        throw new ApiError({ code: "SESSION_CHANGED", message: "Your signed-in account changed. Please retry." });
      }
      if (!response.ok || envelope.error || !envelope.data?.access_token || !envelope.data.refresh_token) return null;
      storeAuthSession(envelope.data);
      return envelope.data.access_token;
    } catch (reason) {
      if (reason instanceof ApiError && reason.code === "SESSION_CHANGED") throw reason;
      if (authGeneration !== refreshGeneration || window.sessionStorage.getItem(REFRESH_TOKEN_KEY) !== refreshToken) {
        throw new ApiError({ code: "SESSION_CHANGED", message: "Your signed-in account changed. Please retry." });
      }
      return null;
    } finally {
      window.clearTimeout(timeout);
    }
  })();
  refreshInFlight = refreshPromise;

  try {
    return await refreshPromise;
  } finally {
    if (refreshInFlight === refreshPromise) refreshInFlight = null;
  }
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit & { token?: string; mock?: () => T | Promise<T>; timeoutMs?: number; auth?: boolean; onMeta?: (meta: unknown) => void } = {},
): Promise<T> {
  const { token, mock, timeoutMs = 8000, auth = true, onMeta, ...requestOptions } = options;
  if (!process.env.NEXT_PUBLIC_API_URL && mock) return await mock();

  async function perform(accessToken?: string) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${apiRoot()}${path.startsWith("/") ? path : `/${path}`}`, {
        ...requestOptions,
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...(requestOptions.headers || {}),
          ...(auth && accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
      });
      const envelope = (await response.json().catch(() => ({}))) as ApiEnvelope<T>;
      return { response, envelope };
    } finally {
      clearTimeout(timeout);
    }
  }

  let accessToken = auth ? (token || storedAccessToken()) : undefined;
  if (auth && !token && accessToken && typeof window !== "undefined") {
    const expiresAt = Number(window.sessionStorage.getItem(EXPIRES_AT_KEY) || 0);
    if (expiresAt && expiresAt <= Date.now() + 30000) {
      const refreshGeneration = authGeneration;
      const renewed = await refreshAccessToken();
      if (renewed) accessToken = renewed;
      else if (authGeneration === refreshGeneration) redirectToExpiredSignIn();
      else throw new ApiError({ code: "SESSION_CHANGED", message: "Your signed-in account changed. Please retry." });
    }
  }

  let result = await perform(accessToken);
  if (auth && accessToken && result.response.status === 401) {
    const refreshGeneration = authGeneration;
    const renewed = await refreshAccessToken();
    if (renewed) result = await perform(renewed);
    else if (authGeneration === refreshGeneration) redirectToExpiredSignIn();
    else throw new ApiError({ code: "SESSION_CHANGED", message: "Your signed-in account changed. Please retry." });
  }
  if (!result.response.ok || result.envelope.error) {
    throw new ApiError(result.envelope.error || { code: "HTTP_ERROR", message: `Request failed (${result.response.status})` });
  }
  if (typeof result.envelope.data === "undefined") throw new ApiError({ code: "INVALID_RESPONSE", message: "The server returned an invalid response." });
  // Paginated endpoints carry their cursor in meta; hand it back when asked so
  // callers do not have to re-implement auth refresh just to read one field.
  if (onMeta) onMeta(result.envelope.meta);
  return result.envelope.data;
}

export const garudaApi = {
  me: () => apiRequest<{
    user: { id: string; email: string; name?: string };
    organization: { id: string; name: string; role: string };
    subscription: { status: string; entitled: boolean; limits: { published_agents: number; monthly_conversations: number } };
    onboarding: { status: string; answered: number; required: number };
  }>("/me", {
    mock: () => ({
      user: { id: "demo-user", email: "demo@garuda.ai", name: "Maya" },
      organization: { id: "demo-org", name: "Northstar Labs", role: "owner" },
      subscription: { status: "active", entitled: true, limits: { published_agents: 10, monthly_conversations: 100 } },
      onboarding: { status: "not_started", answered: 0, required: 4 },
    }),
  }),
  signUp: (name: string, email: string, password: string) => apiRequest<{ access_token?: string; refresh_token?: string; expires_in?: number; user: { id: string; email: string }; verification_required?: boolean }>("/auth/signup", {
    method: "POST",
    body: JSON.stringify({ name, email, password }),
    timeoutMs: 20000,
    auth: false,
    mock: () => ({ access_token: "demo-token", refresh_token: "demo-refresh", expires_in: 3600, user: { id: "demo-user", email }, verification_required: false }),
  }),
  signIn: (email: string, password: string) => apiRequest<{ access_token: string; refresh_token?: string; expires_in?: number; user: { id: string; email: string } }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
    timeoutMs: 20000,
    auth: false,
    mock: () => ({ access_token: "demo-token", refresh_token: "demo-refresh", expires_in: 3600, user: { id: "demo-user", email } }),
  }),
  googleAuth: (credential: string) => apiRequest<AuthResult>("/auth/google", {
    method: "POST",
    body: JSON.stringify({ credential }),
    timeoutMs: 20000,
    auth: false,
  }),
  linkGoogle: (credential: string) => apiRequest<{ linked: true; provider: "google"; user: { id: string; email: string; name?: string } }>("/auth/google/link", {
    method: "POST",
    body: JSON.stringify({ credential }),
    timeoutMs: 20000,
  }),
  verifyEmail: (token: string) => apiRequest<AuthResult>("/auth/verify-email", {
    method: "POST",
    body: JSON.stringify({ token }),
    timeoutMs: 20000,
    auth: false,
  }),
  resendVerification: (email: string) => apiRequest<{ message: string }>("/auth/resend-verification", {
    method: "POST",
    body: JSON.stringify({ email }),
    timeoutMs: 20000,
    auth: false,
  }),
  forgotPassword: (email: string) => apiRequest<{ message: string }>("/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify({ email }),
    timeoutMs: 20000,
    auth: false,
    mock: () => ({ message: "If an account exists, password reset instructions have been sent." }),
  }),
  resetPassword: (password: string, token?: string) => apiRequest<{ message: string }>("/auth/reset-password", {
    method: "POST",
    body: JSON.stringify({ password, token }),
    timeoutMs: 20000,
    auth: false,
    mock: () => ({ message: "Password updated" }),
  }),
  completeOnboarding: async (answers: Record<string, string>) => {
    if (!process.env.NEXT_PUBLIC_API_URL) return { agent_id: "aria-sales", job_id: "demo-job", agent_name: "Aria" };
    await apiRequest("/onboarding", { method: "PUT", body: JSON.stringify({ answers }) });
    const result = await apiRequest<{ agent: { id: string; name: string }; job: { id: string } }>("/onboarding/complete", {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      timeoutMs: 60000,
    });
    return { agent_id: result.agent.id, job_id: result.job.id, agent_name: result.agent.name };
  },
  createCheckout: () => apiRequest<{ session_id: string; url: string; demo?: boolean }>("/billing/checkout", {
    method: "POST",
    headers: { "Idempotency-Key": typeof crypto !== "undefined" ? crypto.randomUUID() : "checkout" },
    timeoutMs: 25000,
    mock: () => ({ session_id: "cs_demo", url: "/checkout/success", demo: true }),
  }),
  completeDemoCheckout: () => apiRequest<{ status?: string }>("/billing/demo/complete", {
    method: "POST",
    mock: () => ({ status: "active" }),
  }),
  billingSubscription: () => apiRequest<{ status: string; current_period_end?: string | null; cancel_at_period_end: boolean; entitled: boolean; price?: { unit_amount: number; currency: string; interval: string }; limits: { published_agents: number; monthly_conversations: number } }>("/billing/subscription", {
    mock: () => ({ status: "active", current_period_end: "2026-09-29T00:00:00Z", cancel_at_period_end: false, entitled: true, price: { unit_amount: 1700, currency: "usd", interval: "month" }, limits: { published_agents: 10, monthly_conversations: 100 } }),
  }),
  createBillingPortal: () => apiRequest<{ url: string; session_id?: string; demo?: boolean }>("/billing/portal", {
    method: "POST",
    timeoutMs: 25000,
    mock: () => ({ url: "/app/billing", demo: true }),
  }),
  listAgents: async (): Promise<Agent[]> => {
    const items = await apiRequest<Array<Record<string, unknown>>>("/agents?page_size=25", { mock: () => demoAgents as unknown as Array<Record<string, unknown>> });
    return items.map((item, index) => {
      if (typeof item.conversionRate === "number") return item as unknown as Agent;
      const status = item.status === "published" ? "live" : item.status === "paused" ? "paused" : "draft";
      return {
        id: String(item.id || `agent-${index}`),
        name: String(item.name || "Garuda agent"),
        description: String(item.description || "A focused AI agent built for better customer conversations."),
        status,
        type: "Sales",
        conversations: Number(item.conversations || 0),
        leads: Number(item.leads || 0),
        conversionRate: Number(item.conversion_rate || 0),
        channels: ["Website"],
        color: ["from-indigo-500 to-violet-600", "from-cyan-500 to-blue-600", "from-rose-400 to-orange-500"][index % 3],
        lastActive: item.updated_at ? new Date(String(item.updated_at)).toLocaleDateString() : "Recently",
      };
    });
  },
  listLeads: async (): Promise<Lead[]> => {
    const items = await apiRequest<Array<Record<string, unknown>>>("/leads?page_size=100", { mock: () => demoLeads as unknown as Array<Record<string, unknown>> });
    return items.map((item, index) => {
      if (typeof item.score === "number") return item as unknown as Lead;
      const statusMap: Record<string, Lead["status"]> = { new: "New", qualified: "Qualified", contacted: "Contacted", converted: "Customer" };
      const metadata = (item.metadata || {}) as Record<string, string>;
      return {
        id: String(item.id || `lead-${index}`),
        name: String(item.name || "Website visitor"),
        email: String(item.email || "Not provided"),
        phone: String(item.phone || "Not provided"),
        company: String(item.company || "Not provided"),
        score: typeof metadata.score === "string" ? Number(metadata.score) : -1,
        status: statusMap[String(item.status)] || "New",
        source: String(item.source || "Website widget"),
        captured: item.created_at ? new Date(String(item.created_at)).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "Recently",
        // Carried through so the visitor journey is one request rather than two:
        // without it the lead panel had to fetch the lead again just to learn
        // which conversation to ask for.
        sessionId: typeof item.session_id === "string" ? item.session_id : undefined,
      };
    });
  },
  listConversations: async (): Promise<Conversation[]> => {
    const items = await apiRequest<Array<Record<string, unknown>>>("/conversations?page_size=100", { mock: () => demoConversations as unknown as Array<Record<string, unknown>> });
    return items.map((item, index) => {
      if (typeof item.visitor === "string") return item as unknown as Conversation;
      const lead = (item.lead || {}) as Record<string, unknown>;
      const message = (item.last_message || {}) as Record<string, unknown>;
      const visitor = String(lead.name || "Anonymous visitor");
      return {
        id: String(item.id || `conversation-${index}`),
        visitor,
        initials: visitor === "Anonymous visitor" ? "AV" : visitor.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase(),
        message: String(message.content || "Conversation started from the website widget."),
        time: item.updated_at ? new Date(String(item.updated_at)).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : "Now",
        unread: 0,
        status: lead.id ? "Lead captured" : "AI active",
        source: String(item.page_title || item.origin || "Unknown page"),
        intent: String(((lead.metadata || {}) as Record<string, string>).intent || ""),
      };
    });
  },
  getConversation: (conversationId: string) => apiRequest<ConversationDetail>(`/conversations/${encodeURIComponent(conversationId)}`, {
    mock: () => {
      const summary = demoConversations.find((item) => item.id === conversationId) || demoConversations[0];
      return {
        conversation: { id: summary.id, agent_id: "aria-sales", origin: "https://northstar.example", page_title: summary.source, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), last_seen_at: new Date().toISOString() },
        messages: [{ id: "demo-message", role: "user", content: summary.message, created_at: new Date().toISOString() }],
        lead: { id: "demo-lead", name: summary.visitor, email: "demo@example.com", company: "Demo workspace", status: "qualified", source: "widget" },
      };
    },
  }),
  dashboard: () => apiRequest<{
    metrics: { agents: number; published_agents: number; conversations: number; messages: number; leads: number; lead_conversion_rate: number };
    activity: Array<{ date: string; conversations: number; leads: number; messages: number }>;
  }>("/dashboard", {
    mock: () => ({
      metrics: { agents: 3, published_agents: 2, conversations: 2131, messages: 8492, leads: 364, lead_conversion_rate: 17.1 },
      activity: [],
    }),
  }),
  getAgent: (agentId: string) => apiRequest<AgentRecord>(`/agents/${encodeURIComponent(agentId)}`, {
    mock: () => ({ id: agentId, name: "Aria", description: "AI sales specialist", status: "draft", revision: 1, system_prompt: "Help visitors understand the offer and find the right next step.", welcome_message: "Hi! What can I help you accomplish today?", branding: { primary_color: "#111827", accent_color: "#635BFF", position: "bottom_right", launcher_text: "Ask Garuda" }, knowledge: [] }),
  }),
  createAgent: (input: AgentWrite) => apiRequest<AgentRecord>("/agents", {
    method: "POST",
    body: JSON.stringify(input),
    mock: () => ({ id: `demo-${Date.now()}`, name: input.name || "Nova", description: input.description || "", status: "draft", revision: 1, system_prompt: input.system_prompt || "", welcome_message: input.welcome_message || "", branding: input.branding || { primary_color: "#111827", accent_color: "#635BFF", position: "bottom_right" }, knowledge: input.knowledge || [] }),
  }),
  updateAgent: (agentId: string, input: AgentWrite, revision?: number) => apiRequest<AgentRecord>(`/agents/${encodeURIComponent(agentId)}`, {
    method: "PATCH",
    headers: revision ? { "If-Match": `"${revision}"` } : undefined,
    body: JSON.stringify(input),
    mock: () => ({ id: agentId, name: input.name || "Aria", description: input.description || "", status: "draft", revision: (revision || 1) + 1, system_prompt: input.system_prompt || "", welcome_message: input.welcome_message || "", branding: input.branding || { primary_color: "#111827", accent_color: "#635BFF", position: "bottom_right" }, knowledge: input.knowledge || [] }),
  }),
  publishAgent: (agentId: string) => apiRequest<{ status: string; published_version: number; agent_key: string; embed_code: string }>(`/agents/${encodeURIComponent(agentId)}/publish`, {
    method: "POST",
    headers: { "Idempotency-Key": typeof crypto !== "undefined" ? crypto.randomUUID() : `publish-${agentId}` },
    mock: () => ({ status: "published", published_version: 2, agent_key: `pub_demo_${agentId}`, embed_code: `<script async src="https://api.garuda.ai/widget.js" data-agent-key="pub_demo_${agentId}"></script>` }),
  }),
  getAgentEmbed: (agentId: string) => apiRequest<{ agent_key: string; embed_code: string; published: boolean }>(`/agents/${encodeURIComponent(agentId)}/embed`, {
    mock: () => ({ agent_key: `pub_demo_${agentId}`, embed_code: `<script async src="https://api.garuda.ai/widget.js" data-agent-key="pub_demo_${agentId}"></script>`, published: true }),
  }),
  previewAgentMessage: (agentId: string, content: string) => apiRequest<{ preview_session_id: string; message: { content: string } }>(`/agents/${encodeURIComponent(agentId)}/preview/messages`, {
    method: "POST",
    body: JSON.stringify({ client_message_id: typeof crypto !== "undefined" ? crypto.randomUUID() : `preview-${Date.now()}`, content, preview_session_id: null }),
    timeoutMs: 60000,
    mock: () => ({ preview_session_id: "preview-demo", message: { content: "I can help visitors understand your offer, answer questions, and guide qualified people to the right next step." } }),
  }),
  listKnowledgeSources: (agentId: string) => apiRequest<Array<{ id: string; type: string; name?: string; title?: string; text?: string; content?: string; status: string }>>(`/agents/${encodeURIComponent(agentId)}/sources`, {
    mock: () => [],
  }),
  addTextKnowledgeSource: (agentId: string, name: string, text: string) => apiRequest<{ id: string; type: string; name?: string; title?: string; text?: string; content?: string; status: string }>(`/agents/${encodeURIComponent(agentId)}/sources`, {
    method: "POST",
    body: JSON.stringify({ type: "text", name, text }),
    timeoutMs: 60000,
    mock: () => ({ id: `source-${Date.now()}`, type: "text", name, text, status: "ready" }),
  }),
};
