"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Bot, BrainCircuit, Check, ChevronRight, Palette, Play, Save, Settings2, Sparkles, Target, UploadCloud } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { garudaApi, type AgentRecord } from "@/lib/api";
import { cn } from "@/lib/utils";

const sections = [
  { id: "identity", label: "Identity", icon: Bot },
  { id: "goal", label: "Goal & behavior", icon: Target },
  { id: "knowledge", label: "Knowledge", icon: BrainCircuit },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "handoff", label: "Handoff rules", icon: Settings2 },
];

export function AgentBuilder({ existing = false, agentId }: { existing?: boolean; agentId?: string }) {
  const demoMode = !process.env.NEXT_PUBLIC_API_URL;
  const [section, setSection] = useState("identity");
  const [name, setName] = useState(existing ? (demoMode ? "Aria" : "") : "Nova");
  const [description, setDescription] = useState("A focused AI agent for website conversations.");
  const [greeting, setGreeting] = useState(existing ? (demoMode ? "Hi! I’m Aria from Northstar Labs. What are you hoping to achieve today?" : "") : "Hi! I’m Nova. What can I help you accomplish today?");
  const [systemPrompt, setSystemPrompt] = useState("Help visitors understand the business, answer only from approved knowledge, qualify intent, and offer a human follow-up when useful.");
  const [primaryColor, setPrimaryColor] = useState("#111827");
  const [accent, setAccent] = useState("#635BFF");
  const [launcherText, setLauncherText] = useState("Ask Garuda");
  const [widgetPosition, setWidgetPosition] = useState("bottom_right");
  const [allowedDomain, setAllowedDomain] = useState(existing && demoMode ? "northstarlabs.com" : "");
  const [published, setPublished] = useState(existing && demoMode);
  const [recordId, setRecordId] = useState(agentId || "");
  const [revision, setRevision] = useState<number>();
  const [knowledge, setKnowledge] = useState<AgentRecord["knowledge"]>([]);
  const [status, setStatus] = useState<"ready" | "saving" | "saved" | "error">("ready");
  const [previewReply, setPreviewReply] = useState("");

  useEffect(() => {
    if (!existing || !agentId) return;
    garudaApi.getAgent(agentId).then((agent) => {
      setRecordId(agent.id);
      setName(agent.name);
      setDescription(agent.description || "A focused AI agent for website conversations.");
      setGreeting(agent.welcome_message || greeting);
      setSystemPrompt(agent.system_prompt || "Answer accurately from approved knowledge and guide the visitor to a useful next step.");
      setPrimaryColor(agent.branding?.primary_color || "#111827");
      setAccent(agent.branding?.accent_color || "#635BFF");
      setLauncherText(agent.branding?.launcher_text || "Ask Garuda");
      setWidgetPosition(agent.branding?.position || "bottom_right");
      setAllowedDomain(agent.branding?.allowed_domains?.[0] || "");
      setPublished(agent.status === "published");
      setRevision(agent.revision);
      setKnowledge(agent.knowledge || []);
      garudaApi.listKnowledgeSources(agentId).then((sources) => {
        if (sources.length) setKnowledge(sources.map((source) => ({ id: source.id, type: source.type, title: source.name || source.title || "Knowledge source", content: source.text || source.content || "", status: source.status })));
      }).catch(() => undefined);
    }).catch(() => setStatus("error"));
  // Greeting is only a local fallback for incomplete legacy records.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, existing]);

  function writePayload() {
    return {
      name,
      description,
      system_prompt: systemPrompt,
      welcome_message: greeting,
      branding: { primary_color: primaryColor, accent_color: accent, position: widgetPosition, launcher_text: launcherText, allowed_domains: allowedDomain.trim() ? [allowedDomain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "")] : [] },
      ...(demoMode ? { knowledge } : {}),
    };
  }

  async function saveDraft() {
    setStatus("saving");
    try {
      const record = recordId ? await garudaApi.updateAgent(recordId, writePayload(), revision) : await garudaApi.createAgent(writePayload());
      setRecordId(record.id);
      setRevision(record.revision);
      setStatus("saved");
      return record.id;
    } catch {
      setStatus("error");
      return "";
    }
  }

  async function publish() {
    if (!allowedDomain.trim()) {
      setSection("appearance");
      setStatus("error");
      return;
    }
    const id = await saveDraft();
    if (!id) return;
    try {
      const result = await garudaApi.publishAgent(id);
      setRevision(result.published_version);
      setPublished(true);
      setStatus("saved");
    } catch {
      setStatus("error");
    }
  }

  async function testAgent() {
    const id = await saveDraft();
    if (!id) return;
    try {
      const result = await garudaApi.previewAgentMessage(id, "What can you help me with?");
      setPreviewReply(result.message.content);
    } catch {
      setStatus("error");
    }
  }

  async function addKnowledge(title: string, content: string) {
    const next = [...knowledge, { type: "text", title, content, status: "ready" }];
    if (demoMode) setKnowledge(next);
    setStatus("saving");
    try {
      let id = recordId;
      let currentRevision = revision;
      if (!id) {
        const created = await garudaApi.createAgent(demoMode ? { ...writePayload(), knowledge: next } : writePayload());
        id = created.id;
        currentRevision = created.revision;
        setRecordId(created.id);
        setRevision(created.revision);
      }
      if (process.env.NEXT_PUBLIC_API_URL) {
        await garudaApi.addTextKnowledgeSource(id, title, content);
        const refreshed = await garudaApi.getAgent(id);
        setRevision(refreshed.revision);
        setKnowledge(refreshed.knowledge || []);
      } else {
        const saved = await garudaApi.updateAgent(id, { knowledge: next }, currentRevision);
        setRevision(saved.revision);
      }
      setStatus("saved");
    } catch {
      if (!demoMode && recordId) {
        try {
          const refreshed = await garudaApi.getAgent(recordId);
          setRevision(refreshed.revision);
          setKnowledge(refreshed.knowledge || []);
        } catch { /* Keep the last confirmed server state. */ }
      }
      setStatus("error");
    }
  }

  return (
    <div className="-m-4 min-h-[calc(100vh-4rem)] bg-white sm:-m-6 lg:-m-8">
      <div className="flex h-16 items-center border-b px-4 sm:px-6"><Button variant="ghost" size="icon" asChild><Link href="/app/agents"><ArrowLeft className="h-4 w-4" /></Link></Button><div className="ml-2"><div className="flex items-center gap-2"><h1 className="text-sm font-semibold text-slate-900">{existing ? `Edit ${name}` : "Create agent"}</h1><Badge variant={published ? "success" : "secondary"}>{published ? "Live" : "Draft"}</Badge></div><p className={cn("text-[10px]", status === "error" ? "text-red-500" : "text-slate-400")}>{status === "saving" ? "Saving draft…" : status === "saved" ? "Draft saved" : status === "error" ? (!allowedDomain.trim() && section === "appearance" ? "Add an allowed domain before publishing" : "Could not save — try again") : "Review and save your draft"}</p></div><div className="ml-auto flex gap-2"><Button variant="outline" size="sm" onClick={saveDraft} className="hidden sm:inline-flex"><Save className="mr-1.5 h-3.5 w-3.5" /> Save</Button><Button variant="outline" size="sm" onClick={testAgent}><Play className="mr-1.5 h-3.5 w-3.5" /> Test</Button><Button size="sm" onClick={publish}><Sparkles className="mr-1.5 h-3.5 w-3.5" /> {published ? "Publish updates" : "Publish agent"}</Button></div></div>
      <div className="grid min-h-[calc(100vh-8rem)] lg:grid-cols-[205px_1fr_390px] xl:grid-cols-[230px_1fr_440px]">
        <aside className="hidden border-r bg-slate-50/60 p-3 lg:block">
          <p className="px-3 py-3 text-[10px] font-bold uppercase tracking-[.16em] text-slate-400">Configure</p>
          <nav className="space-y-1">{sections.map((item, index) => <button key={item.id} onClick={() => setSection(item.id)} className={cn("flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-xs font-medium transition", section === item.id ? "bg-white text-indigo-700 shadow-sm ring-1 ring-slate-200" : "text-slate-600 hover:bg-white")}><item.icon className={cn("h-4 w-4", section === item.id ? "text-indigo-600" : "text-slate-400")} />{item.label}{index < 3 && <Check className="ml-auto h-3.5 w-3.5 text-emerald-500" />}</button>)}</nav>
          <div className="mt-6 rounded-xl border border-indigo-100 bg-indigo-50 p-3"><p className="flex items-center gap-1.5 text-[10px] font-semibold text-indigo-800"><Sparkles className="h-3.5 w-3.5" /> Garuda tip</p><p className="mt-2 text-[10px] leading-4 text-indigo-700">Give each agent one clear outcome. Focused instructions are easier to review, test, and improve.</p></div>
        </aside>

        <section className="overflow-y-auto px-5 py-7 sm:px-8 lg:max-h-[calc(100vh-8rem)] xl:px-12">
          <div className="mx-auto max-w-2xl">
            <div className="mb-6 flex gap-2 overflow-x-auto lg:hidden">{sections.map((item) => <button key={item.id} onClick={() => setSection(item.id)} className={cn("shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium", section === item.id ? "border-indigo-200 bg-indigo-50 text-indigo-700" : "bg-white text-slate-500")}>{item.label}</button>)}</div>
            {section === "identity" && <IdentitySection name={name} setName={setName} description={description} setDescription={setDescription} greeting={greeting} setGreeting={setGreeting} />}
            {section === "goal" && <GoalSection systemPrompt={systemPrompt} setSystemPrompt={setSystemPrompt} />}
            {section === "knowledge" && <KnowledgeSection knowledge={knowledge} onAdd={addKnowledge} />}
            {section === "appearance" && <AppearanceSection primaryColor={primaryColor} setPrimaryColor={setPrimaryColor} accent={accent} setAccent={setAccent} launcherText={launcherText} setLauncherText={setLauncherText} widgetPosition={widgetPosition} setWidgetPosition={setWidgetPosition} allowedDomain={allowedDomain} setAllowedDomain={setAllowedDomain} />}
            {section === "handoff" && <HandoffSection />}
            <div className="mt-8 flex justify-between border-t pt-5"><Button variant="ghost" size="sm" disabled={section === "identity"} onClick={() => setSection(sections[Math.max(0, sections.findIndex((item) => item.id === section) - 1)].id)}>Previous</Button><Button size="sm" onClick={() => { const index = sections.findIndex((item) => item.id === section); if (index < sections.length - 1) setSection(sections[index + 1].id); }}>Next section <ChevronRight className="ml-1.5 h-3.5 w-3.5" /></Button></div>
          </div>
        </section>

        <aside className="hidden border-l bg-[#f7f8fb] p-5 lg:block">
          <div className="mb-3 flex items-center justify-between"><p className="text-xs font-semibold text-slate-700">Live preview</p><div className="flex rounded-lg border bg-white p-0.5"><button className="rounded-md bg-slate-100 px-2 py-1 text-[9px] font-semibold">Desktop</button><button className="px-2 py-1 text-[9px] text-slate-400">Mobile</button></div></div>
          <ChatPreview name={name} greeting={greeting} accent={accent} previewReply={previewReply} />
        </aside>
      </div>
    </div>
  );
}

function SectionHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <div className="mb-7"><p className="text-[10px] font-bold uppercase tracking-[.16em] text-indigo-600">{eyebrow}</p><h2 className="mt-2 text-2xl font-bold tracking-[-.035em] text-slate-950">{title}</h2><p className="mt-2 text-sm leading-6 text-slate-500">{description}</p></div>;
}

function IdentitySection({ name, setName, description, setDescription, greeting, setGreeting }: { name: string; setName: (value: string) => void; description: string; setDescription: (value: string) => void; greeting: string; setGreeting: (value: string) => void }) {
  return <><SectionHeading eyebrow="Identity" title="Make your agent feel like part of the team." description="Give it a recognizable name, clear role, and a warm opening that sounds like your business." /><div className="space-y-6"><div className="space-y-2"><Label htmlFor="agent-name">Agent name</Label><Input id="agent-name" value={name} onChange={(event) => setName(event.target.value)} /><p className="text-[10px] text-slate-400">Short, human names usually feel the most approachable.</p></div><div className="space-y-2"><Label htmlFor="agent-description">Role description</Label><Input id="agent-description" value={description} onChange={(event) => setDescription(event.target.value)} /></div><div className="space-y-2"><Label htmlFor="greeting">Opening greeting</Label><Textarea id="greeting" value={greeting} onChange={(event) => setGreeting(event.target.value)} className="min-h-[110px]" /><div className="flex justify-between text-[10px] text-slate-400"><span>Be warm, specific and easy to answer.</span><span>{greeting.length}/240</span></div></div></div></>;
}

function GoalSection({ systemPrompt, setSystemPrompt }: { systemPrompt: string; setSystemPrompt: (value: string) => void }) {
  const templates = [
    { title: "Sales guide", prompt: "Help visitors understand the offer, answer only from approved knowledge, qualify intent, and offer a human follow-up when useful." },
    { title: "Lead qualification", prompt: "Ask concise questions to understand visitor fit. Use only approved knowledge, request contact details with explicit consent, and explain the next step clearly." },
    { title: "Customer support", prompt: "Answer customer questions accurately using only approved knowledge. Say when information is unavailable and recommend a human follow-up for unresolved issues." },
  ];
  return <><SectionHeading eyebrow="Goal & behavior" title="Give every conversation a clear purpose." description="These instructions are persisted with the agent and used by the private preview and published widget." /><div className="space-y-5"><div><p className="text-xs font-semibold text-slate-800">Start from a template</p><div className="mt-3 grid gap-2 sm:grid-cols-3">{templates.map((template) => <button key={template.title} type="button" onClick={() => setSystemPrompt(template.prompt)} className="rounded-xl border p-3 text-left text-xs font-semibold text-slate-700 transition hover:border-indigo-300 hover:bg-indigo-50">{template.title}</button>)}</div></div><div className="space-y-2"><Label htmlFor="agent-instructions">Agent instructions</Label><Textarea id="agent-instructions" value={systemPrompt} onChange={(event) => setSystemPrompt(event.target.value)} className="min-h-[180px]" /><p className="text-[10px] text-slate-400">Keep instructions focused. Knowledge sources provide the factual context.</p></div></div></>;
}

function KnowledgeSection({ knowledge, onAdd }: { knowledge: AgentRecord["knowledge"]; onAdd: (title: string, content: string) => Promise<void> }) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  return <><SectionHeading eyebrow="Knowledge" title="Teach your agent what your team already knows." description="Add approved text Garuda can use when it answers. Each source is stored and processed separately." /><div className="space-y-4">{knowledge.map((source, index) => { const sourceStatus = source.status || "ready"; return <div key={source.id || `${source.title}-${index}`} className="flex items-center gap-3 rounded-xl border p-4"><span className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-50 text-indigo-600"><BrainCircuit className="h-5 w-5" /></span><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold text-slate-900">{source.title}</p><p className="mt-1 text-[10px] text-slate-400">Text source · {source.content.length} characters</p></div><Badge variant={sourceStatus === "ready" ? "success" : sourceStatus === "failed" ? "warning" : "secondary"} className="capitalize">{sourceStatus}</Badge></div>; })}<div className="rounded-xl border border-dashed p-4"><p className="flex items-center gap-2 text-xs font-semibold text-slate-800"><UploadCloud className="h-4 w-4 text-indigo-600" /> Add a text knowledge source</p><div className="mt-3 space-y-2"><Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Source title, e.g. Pricing FAQ" /><Textarea value={content} onChange={(event) => setContent(event.target.value)} placeholder="Paste accurate product, service, pricing or policy information…" className="min-h-[110px]" /><Button variant="outline" disabled={!title.trim() || !content.trim()} onClick={async () => { await onAdd(title.trim(), content.trim()); setTitle(""); setContent(""); }}>Add and save source</Button></div></div><div className="space-y-2"><Label htmlFor="knowledge-url">Website ingestion</Label><div className="flex gap-2"><Input id="knowledge-url" placeholder="https://docs.yoursite.com" disabled /><Button variant="outline" disabled>Add URL</Button></div><p className="text-[10px] text-slate-400">URL crawling is unavailable until the ingestion worker is configured.</p></div></div></>;
}

function AppearanceSection({ primaryColor, setPrimaryColor, accent, setAccent, launcherText, setLauncherText, widgetPosition, setWidgetPosition, allowedDomain, setAllowedDomain }: { primaryColor: string; setPrimaryColor: (value: string) => void; accent: string; setAccent: (value: string) => void; launcherText: string; setLauncherText: (value: string) => void; widgetPosition: string; setWidgetPosition: (value: string) => void; allowedDomain: string; setAllowedDomain: (value: string) => void }) {
  const colors = ["#635BFF", "#7C3AED", "#0F766E", "#0284C7", "#E11D48", "#0F172A"];
  return <><SectionHeading eyebrow="Appearance" title="Make the widget look at home on your site." description="Match your colors and approve the website where this agent can run." /><div className="space-y-6"><div><Label>Accent color</Label><div className="mt-3 flex flex-wrap gap-3">{colors.map((color) => <button key={color} onClick={() => setAccent(color)} className={cn("grid h-10 w-10 place-items-center rounded-full border-4 border-white shadow-sm ring-offset-2", accent === color && "ring-2 ring-slate-400")} style={{ backgroundColor: color }} aria-label={`Use ${color}`}>{accent === color && <Check className="h-4 w-4 text-white" />}</button>)}</div></div><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="primary-color">Header color</Label><Input id="primary-color" value={primaryColor} onChange={(event) => setPrimaryColor(event.target.value)} /></div><div className="space-y-2"><Label htmlFor="custom-color">Accent color</Label><Input id="custom-color" value={accent} onChange={(event) => setAccent(event.target.value)} /></div><div className="space-y-2"><Label htmlFor="launcher-text">Launcher text</Label><Input id="launcher-text" value={launcherText} onChange={(event) => setLauncherText(event.target.value)} /></div><div className="space-y-2"><Label htmlFor="widget-position">Widget position</Label><select id="widget-position" value={widgetPosition} onChange={(event) => setWidgetPosition(event.target.value)} className="h-11 w-full rounded-lg border bg-white px-3 text-sm"><option value="bottom_right">Bottom right</option><option value="bottom_left">Bottom left</option></select></div></div><div className="space-y-2"><Label htmlFor="allowed-domain">Allowed website domain</Label><Input id="allowed-domain" value={allowedDomain} onChange={(event) => setAllowedDomain(event.target.value)} placeholder="yourcompany.com" /><p className="text-[10px] text-slate-400">Required to publish. Garuda rejects widget sessions from any other domain.</p></div></div></>;
}

function HandoffSection() {
  return <><SectionHeading eyebrow="Handoff rules" title="Human handoff controls are coming soon." description="The current release persists conversations and captured leads. Team notifications and live takeover rules are not enabled yet." /><div className="rounded-xl border border-dashed bg-slate-50 p-6 text-center"><Settings2 className="mx-auto h-6 w-6 text-indigo-500" /><p className="mt-3 text-xs font-semibold text-slate-800">No handoff automation is active</p><p className="mx-auto mt-1 max-w-md text-[10px] leading-5 text-slate-500">Use the agent instructions to recommend a human follow-up. Configurable notifications and assignment rules will appear here in a later release.</p><Badge variant="secondary" className="mt-3">Coming soon</Badge></div></>;
}

function ChatPreview({ name, greeting, accent, previewReply }: { name: string; greeting: string; accent: string; previewReply: string }) {
  return <div className="relative flex min-h-[570px] items-end justify-center overflow-hidden rounded-2xl border bg-white p-5 shadow-sm"><div className="absolute inset-0 bg-[linear-gradient(180deg,#fff,#f3f4f8)]" /><div className="relative w-full overflow-hidden rounded-2xl border bg-white shadow-[0_20px_60px_rgba(15,23,42,.16)]"><div className="flex items-center gap-3 p-4 text-white" style={{ backgroundColor: accent }}><div className="grid h-9 w-9 place-items-center rounded-full bg-white/20 text-xs font-bold">{name[0] || "A"}</div><div><p className="text-xs font-semibold">{name || "Your agent"}</p><p className="mt-0.5 text-[9px] text-white/80">Online now</p></div></div><div className="h-[340px] space-y-3 overflow-y-auto bg-slate-50/50 p-4"><div className="flex justify-start"><div className="max-w-[88%] rounded-2xl rounded-bl-md border bg-white px-3 py-2.5 text-[11px] leading-5 text-slate-700 shadow-sm">{greeting || "Add an opening greeting…"}</div></div>{previewReply ? <><div className="flex justify-end"><div className="max-w-[82%] rounded-2xl rounded-br-md bg-slate-950 px-3 py-2.5 text-[11px] text-white">What can you help me with?</div></div><div className="flex justify-start"><div className="max-w-[88%] rounded-2xl rounded-bl-md border bg-white px-3 py-2.5 text-[11px] leading-5 text-slate-700 shadow-sm">{previewReply}</div></div></> : <div className="flex flex-wrap gap-1.5">{["Learn more", "See pricing", "Book a demo"].map((item) => <span key={item} className="rounded-full border bg-white px-2.5 py-1 text-[9px] font-medium" style={{ color: accent }}>{item}</span>)}</div>}</div><div className="border-t p-3"><div className="flex h-9 items-center rounded-lg border bg-slate-50 px-3 text-[10px] text-slate-400">Type a message…<span className="ml-auto grid h-6 w-6 place-items-center rounded-md text-white" style={{ backgroundColor: accent }}>↑</span></div><p className="mt-2 text-center text-[8px] text-slate-400">Powered by Garuda</p></div></div></div>;
}
