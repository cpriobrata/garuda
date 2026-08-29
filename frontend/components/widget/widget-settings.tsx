"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Check, Code2, Globe2, Loader2, Palette, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { garudaApi } from "@/lib/api";
import { AsyncButton } from "@/components/widget/widget-studio-controls";
import { PlatformGuides, ShareInstallPanel, SnippetBlock } from "@/components/widget/widget-install-guides";
import { WidgetStudio } from "@/components/widget/widget-studio";

const defaultSnippet = `<script
  async src="https://api.garuda.ai/widget.js"
  data-agent-key="pub_demo_preview">
</script>`;

export function WidgetSettings() {
  const connected = Boolean(process.env.NEXT_PUBLIC_API_URL);
  const [embedCode, setEmbedCode] = useState(connected ? "Retrieving the published embed code…" : defaultSnippet);
  const [published, setPublished] = useState(!connected);
  const [domains, setDomains] = useState<string[]>(connected ? [] : ["northstarlabs.com"]);
  const [welcomeMessage, setWelcomeMessage] = useState("");
  const [leadCapture, setLeadCapture] = useState(false);
  const [agentId, setAgentId] = useState("");
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadingEmbed, setLoadingEmbed] = useState(true);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // One loader for both the first render and the retry button, so a failed load
  // is recoverable without a page refresh.
  const loadEmbed = useCallback(async () => {
    setLoadingEmbed(true);
    setLoadFailed(false);
    try {
      const items = await garudaApi.listAgents();
      if (!mounted.current) return;
      const current = items.find((item) => item.status === "live") || items[0];
      if (!current) { setPublished(false); setAgentId(""); setEmbedCode("Publish an agent to generate its secure embed code."); return; }
      setAgentId(current.id);
      const [embed, record] = await Promise.all([garudaApi.getAgentEmbed(current.id), garudaApi.getAgent(current.id)]);
      if (!mounted.current) return;
      setPublished(embed.published);
      setEmbedCode(embed.published ? embed.embed_code : "Publish this agent to generate its secure embed code.");
      setDomains(record.branding?.allowed_domains || []);
      setWelcomeMessage(record.welcome_message || "");
      // The agent detail endpoint returns lead_capture, which the shared
      // AgentRecord type does not name yet. Read it narrowly here rather than
      // widen a type this screen does not own; an absent key reads as off,
      // which is what the checklist should then show.
      setLeadCapture(Boolean((record as { lead_capture?: { enabled?: boolean } }).lead_capture?.enabled));
    } catch {
      if (!mounted.current || !connected) return;
      setPublished(false);
      setLoadFailed(true);
      setEmbedCode("Could not load an embed code. Check the API connection and publish an agent first.");
    } finally {
      if (mounted.current) setLoadingEmbed(false);
    }
  }, [connected]);

  useEffect(() => { loadEmbed(); }, [loadEmbed]);

  return (
    <Tabs defaultValue="install" className="space-y-6">
      <TabsList className="h-10 bg-slate-100"><TabsTrigger value="install"><Code2 className="mr-1.5 h-3.5 w-3.5" /> Install</TabsTrigger><TabsTrigger value="customize"><Palette className="mr-1.5 h-3.5 w-3.5" /> Customize</TabsTrigger></TabsList>
      <TabsContent value="install" className="space-y-6">
        <div className="grid gap-6 xl:grid-cols-[1.12fr_.88fr]">
          <div className="space-y-6">
            <section className="rounded-xl border bg-white p-5 shadow-sm sm:p-6">
              <div className="flex items-start gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-600"><Code2 className="h-5 w-5" /></span><div><h2 className="text-sm font-semibold text-slate-900">Add Garuda to your website</h2><p className="mt-1 text-xs leading-5 text-slate-500">Paste this snippet before the closing <code className="rounded bg-slate-100 px-1 py-0.5 text-[10px] text-slate-700">&lt;/body&gt;</code> tag. It loads asynchronously, so it won’t block your page.</p></div></div>
              <div className="mt-5"><SnippetBlock code={embedCode} blocked={!published} blockedLabel="Publish first" /></div>
              {loadingEmbed ? <p className="mt-3 flex items-center gap-1.5 text-[10px] text-slate-500"><Loader2 className="h-3 w-3 animate-spin" /> Checking this workspace for a published agent…</p> : null}
              {loadFailed ? (
                <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-red-50 p-3 text-[10px] text-red-700">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  <span>The embed code could not be loaded.</span>
                  <AsyncButton size="sm" variant="outline" className="ml-auto h-7 border-red-200 bg-white text-[10px] text-red-700" pendingLabel="Retrying…" onClick={loadEmbed}>Try again</AsyncButton>
                </div>
              ) : null}
              <div className="mt-4 flex items-start gap-2 rounded-lg bg-emerald-50 p-3 text-[10px] leading-5 text-emerald-700"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>Your publishable agent key is safe to use in browser code. Server credentials are never exposed.</span></div>
            </section>

            <section className="rounded-xl border bg-white p-5 shadow-sm sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h2 className="text-sm font-semibold text-slate-900">Publishing & domain access</h2><p className="mt-1 text-xs text-slate-500">Only approved domains may start widget sessions</p></div><Badge variant={published ? "success" : "warning"}>{published ? "Agent published" : "Publish first"}</Badge></div>
              <div className="mt-5 divide-y rounded-xl border">{domains.length ? domains.map((domain) => <DomainRow key={domain} domain={domain} />) : <div className="p-4 text-xs text-slate-500">No allowed domain is configured. Add one in the agent’s Appearance settings before publishing.</div>}</div>
            </section>

            <section className="rounded-xl border bg-white p-5 shadow-sm sm:p-6">
              <h2 className="text-sm font-semibold text-slate-900">Platform guides</h2><p className="mt-1 text-xs text-slate-500">Where the snippet goes on the popular builders, with your own code ready to copy</p>
              <PlatformGuides embedCode={embedCode} published={published} domains={domains} />
            </section>
          </div>

          <aside className="space-y-6">
            <ShareInstallPanel embedCode={embedCode} published={published} domains={domains} />
            <PublishChecklist loading={loadingEmbed} failed={loadFailed} published={published} domains={domains} welcomeMessage={welcomeMessage} leadCapture={leadCapture} />
          </aside>
        </div>
      </TabsContent>

      <TabsContent value="customize">
        {loadingEmbed ? (
          <div className="rounded-xl border bg-white p-10 text-center shadow-sm">
            <Loader2 className="mx-auto h-5 w-5 animate-spin text-indigo-500" />
            <p className="mt-3 text-xs text-slate-500">Finding this workspace&rsquo;s agent…</p>
          </div>
        ) : (
          <WidgetStudio agentId={agentId} />
        )}
      </TabsContent>
    </Tabs>
  );
}

// Every row is read off the agent this screen already loaded. A step whose state
// is not on that record is not listed at all, because a tick nobody computed is
// worse than a shorter list.
function PublishChecklist({ loading, failed, published, domains, welcomeMessage, leadCapture }: { loading: boolean; failed: boolean; published: boolean; domains: string[]; welcomeMessage: string; leadCapture: boolean }) {
  const greeting = welcomeMessage.trim();
  const items = [
    { label: "Welcome message written", detail: greeting ? `“${greeting.length > 88 ? `${greeting.slice(0, 88)}…` : greeting}”` : "The widget opens with nothing to say until you write one", done: greeting.length > 0 },
    { label: "Allowed domain added", detail: domains.length ? domains.join(", ") : "Without one the widget refuses to load on any site", done: domains.length > 0 },
    { label: "Lead capture turned on", detail: leadCapture ? "Visitors are asked for contact details" : "Nobody is asked for contact details in the conversation", done: leadCapture },
    { label: "Agent published", detail: published ? "The embed snippet serves a live widget" : "An unpublished agent has no widget to serve", done: published },
  ];
  const ready = items.filter((item) => item.done).length;
  return (
    <div className="rounded-xl border bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between"><p className="text-xs font-semibold text-slate-900">Before you publish</p>{!loading && !failed ? <span className="text-[10px] font-medium text-slate-400">{ready} of {items.length} ready</span> : null}</div>
      {loading ? (
        <p role="status" className="mt-4 flex items-center gap-1.5 text-[10px] text-slate-500"><Loader2 className="h-3 w-3 animate-spin" /> Reading this agent&rsquo;s settings…</p>
      ) : failed ? (
        <p className="mt-4 text-[10px] leading-5 text-slate-500">This agent&rsquo;s settings could not be read, so none of these can be checked honestly. Retry the embed code above.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {items.map((item) => (
            <li key={item.label} className="flex items-start gap-2.5">
              <span className={cn("mt-px grid h-5 w-5 shrink-0 place-items-center rounded-full", item.done ? "bg-emerald-50 text-emerald-600" : "border text-slate-300")}>{item.done ? <Check className="h-3 w-3" aria-hidden="true" /> : null}</span>
              <span className="min-w-0"><span className="block text-[11px] text-slate-600">{item.label}<span className="sr-only">: {item.done ? "done" : "not done yet"}</span></span><span className="mt-0.5 block break-words text-[9px] leading-4 text-slate-400">{item.detail}</span></span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DomainRow({ domain }: { domain: string }) {
  return <div className="flex items-center gap-3 p-4"><span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-50 text-emerald-600"><Globe2 className="h-4 w-4" /></span><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold text-slate-800">{domain}</p><p className="mt-1 text-[9px] text-slate-400">Approved widget origin</p></div><Badge variant="success">Allowed</Badge></div>;
}
