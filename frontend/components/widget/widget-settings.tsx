"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Check, Clipboard, Code2, Copy, Globe2, Loader2, Palette, ShieldCheck, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { garudaApi } from "@/lib/api";
import { AsyncButton } from "@/components/widget/widget-studio-controls";
import { WidgetStudio } from "@/components/widget/widget-studio";

const defaultSnippet = `<script
  async src="https://api.garuda.ai/widget.js"
  data-agent-key="pub_demo_preview">
</script>`;

export function WidgetSettings() {
  const connected = Boolean(process.env.NEXT_PUBLIC_API_URL);
  const [copied, setCopied] = useState(false);
  const [embedCode, setEmbedCode] = useState(connected ? "Retrieving the published embed code…" : defaultSnippet);
  const [published, setPublished] = useState(!connected);
  const [domains, setDomains] = useState<string[]>(connected ? [] : ["northstarlabs.com"]);
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

  async function copyCode() {
    await navigator.clipboard?.writeText(embedCode);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  return (
    <Tabs defaultValue="install" className="space-y-6">
      <TabsList className="h-10 bg-slate-100"><TabsTrigger value="install"><Code2 className="mr-1.5 h-3.5 w-3.5" /> Install</TabsTrigger><TabsTrigger value="customize"><Palette className="mr-1.5 h-3.5 w-3.5" /> Customize</TabsTrigger></TabsList>
      <TabsContent value="install" className="space-y-6">
        <div className="grid gap-6 xl:grid-cols-[1.12fr_.88fr]">
          <div className="space-y-6">
            <section className="rounded-xl border bg-white p-5 shadow-sm sm:p-6">
              <div className="flex items-start gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-600"><Code2 className="h-5 w-5" /></span><div><h2 className="text-sm font-semibold text-slate-900">Add Garuda to your website</h2><p className="mt-1 text-xs leading-5 text-slate-500">Paste this snippet before the closing <code className="rounded bg-slate-100 px-1 py-0.5 text-[10px] text-slate-700">&lt;/body&gt;</code> tag. It loads asynchronously, so it won’t block your page.</p></div></div>
              <div className="relative mt-5 overflow-hidden rounded-xl bg-slate-950 p-4">
                <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[11px] leading-6 text-slate-300"><code>{embedCode}</code></pre>
                <AsyncButton size="sm" variant="secondary" className="absolute right-3 top-3 h-7 bg-white/10 text-[10px] text-white hover:bg-white/20" onClick={copyCode} disabled={!published} pendingLabel="Copying…" icon={copied ? <Check className="mr-1.5 h-3.5 w-3.5" /> : <Copy className="mr-1.5 h-3.5 w-3.5" />}>
                  {copied ? "Copied" : published ? "Copy" : "Publish first"}
                </AsyncButton>
              </div>
              {loadingEmbed ? <p className="mt-3 flex items-center gap-1.5 text-[10px] text-slate-500"><Loader2 className="h-3 w-3 animate-spin" /> Checking this workspace for a published agent…</p> : null}
              {loadFailed ? (
                <div className="mt-3 flex items-center gap-2 rounded-lg bg-red-50 p-3 text-[10px] text-red-700">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  <span>The embed code could not be loaded.</span>
                  <AsyncButton size="sm" variant="outline" className="ml-auto h-7 border-red-200 bg-white text-[10px] text-red-700" pendingLabel="Retrying…" onClick={loadEmbed}>Try again</AsyncButton>
                </div>
              ) : null}
              <div className="mt-4 flex items-start gap-2 rounded-lg bg-emerald-50 p-3 text-[10px] leading-5 text-emerald-700"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>Your publishable agent key is safe to use in browser code. Server credentials are never exposed.</span></div>
            </section>

            <section className="rounded-xl border bg-white p-5 shadow-sm sm:p-6">
              <div className="flex items-center justify-between"><div><h2 className="text-sm font-semibold text-slate-900">Publishing & domain access</h2><p className="mt-1 text-xs text-slate-500">Only approved domains may start widget sessions</p></div><Badge variant={published ? "success" : "warning"}>{published ? "Agent published" : "Publish first"}</Badge></div>
              <div className="mt-5 divide-y rounded-xl border">{domains.length ? domains.map((domain) => <DomainRow key={domain} domain={domain} />) : <div className="p-4 text-xs text-slate-500">No allowed domain is configured. Add one in the agent’s Appearance settings before publishing.</div>}</div>
            </section>

            <section className="rounded-xl border bg-white p-5 shadow-sm sm:p-6">
              <h2 className="text-sm font-semibold text-slate-900">Platform guides</h2><p className="mt-1 text-xs text-slate-500">Step-by-step instructions for popular website builders</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">{["Webflow", "WordPress", "Shopify", "Framer"].map((platform) => <button key={platform} disabled className="flex cursor-not-allowed items-center rounded-xl border p-3 text-left opacity-70"><span className="grid h-8 w-8 place-items-center rounded-lg bg-slate-100 text-[10px] font-bold text-slate-700">{platform[0]}</span><span className="ml-3 text-xs font-semibold text-slate-700">{platform}</span><span className="ml-auto text-[9px] text-slate-400">Coming soon</span></button>)}</div>
            </section>
          </div>

          <aside className="space-y-6">
            <div className="rounded-xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-violet-50 p-5"><div className="flex items-start gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-indigo-600 text-white"><Sparkles className="h-4 w-4" /></span><div><p className="text-xs font-semibold text-indigo-950">Need a teammate to install it?</p><p className="mt-1 text-[10px] leading-5 text-indigo-700">Copy the secure snippet above and share it with your developer. Email sharing is coming soon.</p><Button size="sm" variant="outline" className="mt-3 border-indigo-200 bg-white text-indigo-700" disabled><Clipboard className="mr-1.5 h-3.5 w-3.5" /> Email sharing · coming soon</Button></div></div></div>
            <div className="rounded-xl border bg-white p-5 shadow-sm"><p className="text-xs font-semibold text-slate-900">Before you publish</p><div className="mt-4 space-y-3">{["Test your opening conversation", "Confirm mobile placement", "Add your allowed domains", "Set human handoff hours"].map((item, index) => <div key={item} className="flex items-center gap-2.5"><span className={cn("grid h-5 w-5 place-items-center rounded-full", index < 2 ? "bg-emerald-50 text-emerald-600" : "border text-slate-300")}>{index < 2 && <Check className="h-3 w-3" />}</span><span className="text-[11px] text-slate-600">{item}</span></div>)}</div></div>
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

function DomainRow({ domain }: { domain: string }) {
  return <div className="flex items-center gap-3 p-4"><span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-50 text-emerald-600"><Globe2 className="h-4 w-4" /></span><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold text-slate-800">{domain}</p><p className="mt-1 text-[9px] text-slate-400">Approved widget origin</p></div><Badge variant="success">Allowed</Badge></div>;
}
