"use client";

import { useEffect, useState } from "react";
import { Check, Clipboard, Code2, Copy, Globe2, MessageCircleMore, Monitor, Palette, ShieldCheck, Smartphone, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { garudaApi } from "@/lib/api";

const defaultSnippet = `<script
  async src="https://api.garuda.ai/widget.js"
  data-agent-key="pub_demo_preview">
</script>`;

export function WidgetSettings() {
  const connected = Boolean(process.env.NEXT_PUBLIC_API_URL);
  const [copied, setCopied] = useState(false);
  const [color, setColor] = useState("#635BFF");
  const [position, setPosition] = useState("right");
  const [device, setDevice] = useState("desktop");
  const [greeting, setGreeting] = useState("Hi! What can we help you accomplish today?");
  const [embedCode, setEmbedCode] = useState(connected ? "Retrieving the published embed code…" : defaultSnippet);
  const [published, setPublished] = useState(!connected);
  const [domains, setDomains] = useState<string[]>(connected ? [] : ["northstarlabs.com"]);

  useEffect(() => {
    async function loadEmbed() {
      try {
        const items = await garudaApi.listAgents();
        const active = items.find((item) => item.status === "live") || items[0];
        if (!active) { setPublished(false); setEmbedCode("Publish an agent to generate its secure embed code."); return; }
        const [embed, record] = await Promise.all([garudaApi.getAgentEmbed(active.id), garudaApi.getAgent(active.id)]);
        setPublished(embed.published);
        setEmbedCode(embed.published ? embed.embed_code : "Publish this agent to generate its secure embed code.");
        setDomains(record.branding?.allowed_domains || []);
      } catch {
        if (connected) { setPublished(false); setEmbedCode("Could not load an embed code. Check the API connection and publish an agent first."); }
      }
    }
    loadEmbed();
  }, [connected]);

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
              <div className="relative mt-5 overflow-hidden rounded-xl bg-slate-950 p-4"><pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[11px] leading-6 text-slate-300"><code>{embedCode}</code></pre><Button size="sm" variant="secondary" className="absolute right-3 top-3 h-7 bg-white/10 text-[10px] text-white hover:bg-white/20" onClick={copyCode} disabled={!published}>{copied ? <Check className="mr-1.5 h-3.5 w-3.5" /> : <Copy className="mr-1.5 h-3.5 w-3.5" />}{copied ? "Copied" : published ? "Copy" : "Publish first"}</Button></div>
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
        <div className="grid overflow-hidden rounded-xl border bg-white shadow-sm lg:grid-cols-[minmax(380px,.78fr)_1.22fr]">
          <section className="border-b p-5 lg:border-b-0 lg:border-r sm:p-6">
            <div><h2 className="text-sm font-semibold text-slate-900">Widget appearance preview</h2><p className="mt-1 text-xs text-slate-500">Try visual options locally. Persisted customization is {connected ? "coming soon" : "shown as demo data"}.</p></div>
            <div className="my-5 h-px bg-slate-100" />
            <div className="space-y-6">
              <div><Label>Brand color</Label><div className="mt-3 flex flex-wrap gap-2">{["#635BFF", "#7C3AED", "#0F766E", "#0284C7", "#E11D48", "#0F172A"].map((item) => <button key={item} onClick={() => setColor(item)} className={cn("grid h-9 w-9 place-items-center rounded-full border-[3px] border-white shadow ring-offset-2", color === item && "ring-2 ring-slate-400")} style={{ backgroundColor: item }}>{color === item && <Check className="h-3.5 w-3.5 text-white" />}</button>)}</div><Input value={color} onChange={(event) => setColor(event.target.value)} className="mt-3 h-9 max-w-[180px] font-mono text-xs" /></div>
              <div><Label htmlFor="widget-greeting">Proactive greeting</Label><Input id="widget-greeting" value={greeting} onChange={(event) => setGreeting(event.target.value)} className="mt-2" /><p className="mt-1.5 text-[10px] text-slate-400">Appears above the launcher after 8 seconds.</p></div>
              <div><Label>Launcher position</Label><div className="mt-2 grid grid-cols-2 gap-2"><button onClick={() => setPosition("left")} className={cn("rounded-xl border p-3 text-xs font-medium", position === "left" ? "border-indigo-300 bg-indigo-50 text-indigo-700" : "text-slate-500")}>Bottom left</button><button onClick={() => setPosition("right")} className={cn("rounded-xl border p-3 text-xs font-medium", position === "right" ? "border-indigo-300 bg-indigo-50 text-indigo-700" : "text-slate-500")}>Bottom right</button></div></div>
              <div className="space-y-3">{[{ title: "Show agent avatar", text: "Use the agent icon in the header", checked: true }, { title: "Show powered by Garuda", text: "Display a subtle attribution", checked: true }, { title: "Sound notifications", text: "Play a soft sound for new replies", checked: false }].map((setting) => <div key={setting.title} className="flex items-center justify-between rounded-xl border p-3"><div><p className="text-[11px] font-semibold text-slate-800">{setting.title}</p><p className="mt-1 text-[9px] text-slate-400">{setting.text}</p></div><Switch defaultChecked={setting.checked} disabled={connected} /></div>)}</div>
              <Button className="w-full" disabled>{connected ? "Saving customization · coming soon" : "Demo preview only"}</Button>
            </div>
          </section>
          <section className="relative min-h-[620px] overflow-hidden bg-[#eef1f7] p-5 sm:p-8">
            <div className="mb-4 flex items-center justify-between"><p className="text-xs font-semibold text-slate-600">Preview</p><div className="flex rounded-lg border bg-white p-0.5"><button onClick={() => setDevice("desktop")} className={cn("grid h-7 w-8 place-items-center rounded-md", device === "desktop" && "bg-slate-100 text-slate-900")}><Monitor className="h-3.5 w-3.5" /></button><button onClick={() => setDevice("mobile")} className={cn("grid h-7 w-8 place-items-center rounded-md", device === "mobile" && "bg-slate-100 text-slate-900")}><Smartphone className="h-3.5 w-3.5" /></button></div></div>
            <div className={cn("relative mx-auto h-[530px] overflow-hidden border bg-white shadow-soft transition-all", device === "mobile" ? "max-w-[280px] rounded-[28px] border-[5px] border-slate-800" : "w-full rounded-xl")}>
              <div className="h-12 border-b bg-white px-4"><div className="flex h-full items-center gap-3"><div className="h-3 w-3 rounded-full bg-slate-200" /><div className="h-2 w-20 rounded bg-slate-100" /><div className="ml-auto h-6 w-14 rounded-md bg-slate-100" /></div></div>
              <div className="p-5"><div className="h-4 w-36 rounded bg-slate-100" /><div className="mt-3 h-2 w-[80%] rounded bg-slate-100" /><div className="mt-2 h-2 w-[64%] rounded bg-slate-100" /><div className="mt-8 grid grid-cols-2 gap-3"><div className="h-28 rounded-xl bg-slate-50" /><div className="h-28 rounded-xl bg-slate-50" /></div></div>
              <div className={cn("absolute bottom-5", position === "right" ? "right-5" : "left-5")}><div className="mb-3 max-w-[230px] rounded-xl border bg-white p-3 text-[10px] leading-4 text-slate-600 shadow-lg">{greeting}</div><button className={cn("grid h-12 w-12 place-items-center rounded-full text-white shadow-lg", position === "right" && "ml-auto")} style={{ backgroundColor: color }}><MessageCircleMore className="h-5 w-5" /></button></div>
            </div>
          </section>
        </div>
      </TabsContent>
    </Tabs>
  );
}

function DomainRow({ domain }: { domain: string }) {
  return <div className="flex items-center gap-3 p-4"><span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-50 text-emerald-600"><Globe2 className="h-4 w-4" /></span><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold text-slate-800">{domain}</p><p className="mt-1 text-[9px] text-slate-400">Approved widget origin</p></div><Badge variant="success">Allowed</Badge></div>;
}
