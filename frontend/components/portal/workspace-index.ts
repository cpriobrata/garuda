"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "@/lib/api";
import { agents as demoAgents, conversations as demoConversations, leads as demoLeads } from "@/lib/demo-data";

export type WorkspaceEntryKind = "agent" | "conversation" | "lead";

export type WorkspaceEntry = {
  key: string;
  kind: WorkspaceEntryKind;
  title: string;
  subtitle: string;
  href: string;
  haystack: string;
  // Epoch milliseconds when the server dated the record. Demo rows have no real
  // clock behind them, so they carry `null` here and show `stamp` verbatim
  // rather than having a recency invented for them.
  at: number | null;
  stamp: string;
};

export type WorkspaceIndexStatus = "idle" | "loading" | "ready" | "error";

export type WorkspaceIndex = {
  status: WorkspaceIndexStatus;
  entries: WorkspaceEntry[];
  load: () => void;
  reload: () => void;
};

// Only the fields these two surfaces read, named exactly as the API returns them:
// GET /v1/agents (agentSummary), GET /v1/conversations (conversationSummary),
// GET /v1/leads (model.Lead).
type AgentRow = { id?: string; name?: string; description?: string; status?: string; updated_at?: string };
type ConversationRow = {
  id?: string;
  page_title?: string;
  page_url?: string;
  origin?: string;
  created_at?: string;
  updated_at?: string;
  last_message?: { content?: string } | null;
  lead?: { name?: string; email?: string; company?: string } | null;
};
type LeadRow = { id?: string; name?: string; email?: string; company?: string; status?: string; source?: string; created_at?: string };

const agentStatusLabel: Record<string, string> = { published: "Published agent", paused: "Paused agent", draft: "Draft agent" };

function haystack(...parts: Array<string | undefined>) {
  return parts.filter(Boolean).join(" ").toLowerCase();
}

function epoch(value?: string) {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isNaN(parsed) ? null : parsed;
}

function rows<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

async function fetchEntries(): Promise<WorkspaceEntry[]> {
  const [agentsResult, conversationsResult, leadsResult] = await Promise.allSettled([
    apiRequest<AgentRow[]>("/agents?page_size=25"),
    apiRequest<ConversationRow[]>("/conversations?page_size=50"),
    apiRequest<LeadRow[]>("/leads?page_size=50"),
  ]);
  // One list failing still leaves a useful index; all three failing is a real
  // failure and has to be shown as one rather than as an empty workspace.
  if (agentsResult.status === "rejected" && conversationsResult.status === "rejected" && leadsResult.status === "rejected") {
    throw agentsResult.reason instanceof Error ? agentsResult.reason : new Error("The workspace could not be searched.");
  }

  const entries: WorkspaceEntry[] = [];
  if (agentsResult.status === "fulfilled") {
    for (const agent of rows<AgentRow>(agentsResult.value)) {
      if (!agent.id) continue;
      const name = agent.name?.trim() || "Untitled agent";
      entries.push({
        key: `agent:${agent.id}`,
        kind: "agent",
        title: name,
        subtitle: agent.description?.trim() || agentStatusLabel[String(agent.status)] || "Agent",
        href: `/app/agents/${encodeURIComponent(agent.id)}`,
        haystack: haystack(name, agent.description, agent.status),
        at: epoch(agent.updated_at),
        stamp: "",
      });
    }
  }
  if (conversationsResult.status === "fulfilled") {
    for (const conversation of rows<ConversationRow>(conversationsResult.value)) {
      if (!conversation.id) continue;
      const visitor = conversation.lead?.name?.trim() || conversation.lead?.email?.trim() || "Anonymous visitor";
      const message = conversation.last_message?.content?.trim() || conversation.page_title?.trim() || conversation.origin || "Conversation from the website widget";
      entries.push({
        key: `conversation:${conversation.id}`,
        kind: "conversation",
        title: visitor,
        subtitle: message,
        href: `/app/conversations?id=${encodeURIComponent(conversation.id)}`,
        haystack: haystack(visitor, message, conversation.lead?.company, conversation.page_title, conversation.page_url, conversation.origin),
        at: epoch(conversation.updated_at) ?? epoch(conversation.created_at),
        stamp: "",
      });
    }
  }
  if (leadsResult.status === "fulfilled") {
    for (const lead of rows<LeadRow>(leadsResult.value)) {
      if (!lead.id) continue;
      const name = lead.name?.trim() || lead.email?.trim() || "Unnamed lead";
      const detail = [lead.email, lead.company].map((part) => part?.trim()).filter(Boolean).join(" · ");
      entries.push({
        key: `lead:${lead.id}`,
        kind: "lead",
        title: name,
        subtitle: detail || lead.source || "Captured lead",
        href: "/app/leads",
        haystack: haystack(name, lead.email, lead.company, lead.status, lead.source),
        at: epoch(lead.created_at),
        stamp: "",
      });
    }
  }
  return entries;
}

function demoEntries(): WorkspaceEntry[] {
  return [
    ...demoConversations.map((conversation) => ({
      key: `conversation:${conversation.id}`,
      kind: "conversation" as const,
      title: conversation.visitor,
      subtitle: conversation.message,
      href: `/app/conversations?id=${encodeURIComponent(conversation.id)}`,
      haystack: haystack(conversation.visitor, conversation.message, conversation.source, conversation.intent),
      at: null,
      stamp: conversation.time,
    })),
    ...demoLeads.map((lead) => ({
      key: `lead:${lead.id}`,
      kind: "lead" as const,
      title: lead.name,
      subtitle: [lead.email, lead.company].filter(Boolean).join(" · "),
      href: "/app/leads",
      haystack: haystack(lead.name, lead.email, lead.company, lead.status, lead.source),
      at: null,
      stamp: lead.captured,
    })),
    ...demoAgents.map((agent) => ({
      key: `agent:${agent.id}`,
      kind: "agent" as const,
      title: agent.name,
      subtitle: agent.description,
      href: `/app/agents/${encodeURIComponent(agent.id)}`,
      haystack: haystack(agent.name, agent.description, agent.type, agent.status),
      at: null,
      stamp: agent.lastActive,
    })),
  ];
}

/**
 * The workspace lists behind the header search and the activity bell.
 *
 * The three requests are made once, on the first focus or the first time the
 * bell is opened, and the result is kept for the life of the portal shell so
 * reopening either surface costs nothing. The cache is deliberately component
 * state and not a module variable: signing out unmounts the shell, which throws
 * the previous account's leads away with it.
 */
export function useWorkspaceIndex(connected: boolean): WorkspaceIndex {
  const [state, setState] = useState<{ status: WorkspaceIndexStatus; entries: WorkspaceEntry[] }>(() =>
    connected ? { status: "idle", entries: [] } : { status: "ready", entries: demoEntries() },
  );
  const mounted = useRef(true);
  const pending = useRef(false);
  const loaded = useRef(!connected);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const start = useCallback((force: boolean) => {
    if (!connected || pending.current || (loaded.current && !force)) return;
    pending.current = true;
    setState((current) => ({ status: "loading", entries: current.entries }));
    fetchEntries()
      .then((entries) => {
        loaded.current = true;
        if (mounted.current) setState({ status: "ready", entries });
      })
      .catch(() => {
        if (mounted.current) setState({ status: "error", entries: [] });
      })
      .finally(() => { pending.current = false; });
  }, [connected]);

  const load = useCallback(() => start(false), [start]);
  const reload = useCallback(() => start(true), [start]);
  return { status: state.status, entries: state.entries, load, reload };
}

export function stampFor(entry: WorkspaceEntry): string {
  if (entry.at === null) return entry.stamp;
  const seconds = Math.max(0, Date.now() - entry.at) / 1000;
  if (seconds < 90) return "just now";
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.round(seconds / 86400)}d ago`;
  return new Date(entry.at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function byNewest(a: WorkspaceEntry, b: WorkspaceEntry) {
  return (b.at ?? 0) - (a.at ?? 0);
}
