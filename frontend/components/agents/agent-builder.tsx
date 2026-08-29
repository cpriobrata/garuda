"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Bot, BrainCircuit, Check, ChevronRight, Palette, Play, Save, Settings2, Sparkles, Target, UploadCloud } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, garudaApi, type AgentRecord } from "@/lib/api";
import { cn } from "@/lib/utils";

const sections = [
  { id: "identity", label: "Identity", icon: Bot },
  { id: "goal", label: "Goal & behavior", icon: Target },
  { id: "knowledge", label: "Knowledge", icon: BrainCircuit },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "handoff", label: "Handoff rules", icon: Settings2 },
];

const editableFields = ["name", "description", "greeting", "systemPrompt", "primaryColor", "accent", "launcherText", "widgetPosition", "allowedDomain"] as const;

export type AgentFormField = (typeof editableFields)[number];
export type AgentFormValues = Record<AgentFormField, string>;

// The builder runs one async action at a time and every one of them writes the
// same record, so they share a single slot: the clicked button shows the
// spinner and the others hold still until it is finished.
export type AgentBuilderAction = "" | "save" | "test" | "publish" | "knowledge";

// Server validation keys mapped to the builder section that shows the field, so
// a rejected save can move the writer to something they can actually correct.
// Keys the builder has no input for are deliberately absent and are listed in
// the summary block instead.
const fieldSections: Record<string, string> = {
  name: "identity",
  description: "identity",
  welcome_message: "identity",
  system_prompt: "goal",
  knowledge: "knowledge",
  "branding.colors": "appearance",
  "branding.position": "appearance",
  "branding.allowed_domains": "appearance",
};

export function agentFormValuesFromRecord(agent: AgentRecord, current: AgentFormValues): AgentFormValues {
  return {
    name: agent.name,
    description: agent.description || "A focused AI agent for website conversations.",
    greeting: agent.welcome_message || current.greeting,
    systemPrompt: agent.system_prompt || "Answer accurately from approved knowledge and guide the visitor to a useful next step.",
    primaryColor: agent.branding?.primary_color || "#111827",
    accent: agent.branding?.accent_color || "#635BFF",
    launcherText: agent.branding?.launcher_text || "Ask Garuda",
    widgetPosition: agent.branding?.position || "bottom_right",
    allowedDomain: agent.branding?.allowed_domains?.[0] || "",
  };
}

// A field the writer has already edited keeps what they typed. Everything else
// takes the loaded record, so a slow initial read never discards their work.
export function mergeLoadedAgentValues(loaded: AgentFormValues, current: AgentFormValues, editedFields: ReadonlySet<string>): AgentFormValues {
  const merged = { ...loaded };
  for (const field of editableFields) {
    if (editedFields.has(field)) merged[field] = current[field];
  }
  return merged;
}

// The edited fields and the form values are both read when the response lands,
// never when the request was sent, because the writer types in between.
export async function loadAgentForm(agentId: string, readEditedFields: () => ReadonlySet<string>) {
  const agent = await garudaApi.getAgent(agentId);
  return {
    agent,
    apply: (current: AgentFormValues) => mergeLoadedAgentValues(agentFormValuesFromRecord(agent, current), current, readEditedFields()),
  };
}

// The API reports rejected fields as a field to message map under
// error.details. Anything else is left to the general status line.
export function fieldMessagesFromError(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError) || error.code !== "validation_failed") return {};
  const details = error.details;
  if (!details || typeof details !== "object" || Array.isArray(details)) return {};
  const messages: Record<string, string> = {};
  for (const [field, message] of Object.entries(details as Record<string, unknown>)) {
    if (typeof message === "string" && message.trim()) messages[field] = message.trim();
  }
  return messages;
}

export function sectionForFieldMessages(messages: Record<string, string>): string {
  const rejected = Object.keys(messages);
  for (const item of sections) {
    if (rejected.some((field) => fieldSections[field] === item.id)) return item.id;
  }
  return "";
}

// Messages for fields the builder has no input for still have to reach the
// writer, so they are listed above the section they are looking at.
export function unlistedFieldMessages(messages: Record<string, string>): string[] {
  return Object.entries(messages)
    .filter(([field]) => !fieldSections[field])
    .map(([field, message]) => `${field}: ${message}`);
}

export function AgentBuilder({ existing = false, agentId }: { existing?: boolean; agentId?: string }) {
  const demoMode = !process.env.NEXT_PUBLIC_API_URL;
  const [section, setSection] = useState("identity");
  const [form, setForm] = useState<AgentFormValues>(() => ({
    name: existing ? (demoMode ? "Aria" : "") : "Nova",
    description: "A focused AI agent for website conversations.",
    greeting: existing ? (demoMode ? "Hi! I’m Aria from Northstar Labs. What are you hoping to achieve today?" : "") : "Hi! I’m Nova. What can I help you accomplish today?",
    systemPrompt: "Help visitors understand the business, answer only from approved knowledge, qualify intent, and offer a human follow-up when useful.",
    primaryColor: "#111827",
    accent: "#635BFF",
    launcherText: "Ask Garuda",
    widgetPosition: "bottom_right",
    allowedDomain: existing && demoMode ? "northstarlabs.com" : "",
  }));
  const editedFields = useRef(new Set<AgentFormField>());
  const [published, setPublished] = useState(existing && demoMode);
  const [recordId, setRecordId] = useState(agentId || "");
  const [revision, setRevision] = useState<number>();
  const [knowledge, setKnowledge] = useState<AgentRecord["knowledge"]>([]);
  const [status, setStatus] = useState<"ready" | "saving" | "saved" | "error">("ready");
  const [statusMessage, setStatusMessage] = useState("");
  const [fieldMessages, setFieldMessages] = useState<Record<string, string>>({});
  const [previewReply, setPreviewReply] = useState("");
  const [pendingAction, setPendingAction] = useState<AgentBuilderAction>("");
  // A ref as well as the state above. Two clicks can land in the same tick,
  // before React has re-rendered the button as disabled, and the state read
  // from the first render's closure would still say the builder is idle.
  const runningAction = useRef<AgentBuilderAction>("");

  function beginAction(action: AgentBuilderAction) {
    if (runningAction.current) return false;
    runningAction.current = action;
    setPendingAction(action);
    return true;
  }

  function finishAction() {
    runningAction.current = "";
    setPendingAction("");
  }

  function updateField(field: AgentFormField) {
    return (value: string) => {
      editedFields.current.add(field);
      setForm((current) => ({ ...current, [field]: value }));
    };
  }

  useEffect(() => {
    if (!existing || !agentId) return;
    let active = true;
    loadAgentForm(agentId, () => editedFields.current).then((loaded) => {
      if (!active) return;
      setForm((current) => loaded.apply(current));
      setRecordId(loaded.agent.id);
      setPublished(loaded.agent.status === "published");
      setRevision(loaded.agent.revision);
      setKnowledge(loaded.agent.knowledge || []);
      garudaApi.listKnowledgeSources(agentId).then((sources) => {
        if (!active || !sources.length) return;
        setKnowledge(sources.map((source) => ({ id: source.id, type: source.type, title: source.name || source.title || "Knowledge source", content: source.text || source.content || "", status: source.status })));
      }).catch(() => undefined);
    }).catch(() => {
      if (active) setStatus("error");
    });
    return () => { active = false; };
  }, [agentId, existing]);

  function writePayload() {
    return {
      name: form.name,
      description: form.description,
      system_prompt: form.systemPrompt,
      welcome_message: form.greeting,
      branding: { primary_color: form.primaryColor, accent_color: form.accent, position: form.widgetPosition, launcher_text: form.launcherText, allowed_domains: form.allowedDomain.trim() ? [form.allowedDomain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "")] : [] },
      ...(demoMode ? { knowledge } : {}),
    };
  }

  function reportFailure(error: unknown) {
    const messages = fieldMessagesFromError(error);
    setFieldMessages(messages);
    const rejectedSection = sectionForFieldMessages(messages);
    if (rejectedSection) setSection(rejectedSection);
    setStatusMessage(error instanceof ApiError && error.message ? error.message : "");
    setStatus("error");
  }

  function beginSave() {
    setStatus("saving");
    setStatusMessage("");
    setFieldMessages({});
  }

  // Publishing and testing both save first, so the guard belongs on the
  // entry points rather than on this shared step.
  async function saveDraft() {
    beginSave();
    try {
      const record = recordId ? await garudaApi.updateAgent(recordId, writePayload(), revision) : await garudaApi.createAgent(writePayload());
      setRecordId(record.id);
      setRevision(record.revision);
      setStatus("saved");
      return record.id;
    } catch (error) {
      reportFailure(error);
      return "";
    }
  }

  async function saveDraftAction() {
    if (!beginAction("save")) return;
    try {
      await saveDraft();
    } finally {
      finishAction();
    }
  }

  async function publish() {
    if (!form.allowedDomain.trim()) {
      setSection("appearance");
      setFieldMessages({ "branding.allowed_domains": "Add the website domain where this agent may run." });
      setStatusMessage("Add an allowed domain before publishing");
      setStatus("error");
      return;
    }
    if (!beginAction("publish")) return;
    try {
      const id = await saveDraft();
      if (!id) return;
      const result = await garudaApi.publishAgent(id);
      setRevision(result.published_version);
      setPublished(true);
      setStatus("saved");
    } catch (error) {
      reportFailure(error);
    } finally {
      finishAction();
    }
  }

  async function testAgent() {
    if (!beginAction("test")) return;
    try {
      const id = await saveDraft();
      if (!id) return;
      const result = await garudaApi.previewAgentMessage(id, "What can you help me with?");
      setPreviewReply(result.message.content);
    } catch (error) {
      reportFailure(error);
    } finally {
      finishAction();
    }
  }

  async function addKnowledge(title: string, content: string) {
    if (!beginAction("knowledge")) return;
    const next = [...knowledge, { type: "text", title, content, status: "ready" }];
    if (demoMode) setKnowledge(next);
    beginSave();
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
    } catch (error) {
      if (!demoMode && recordId) {
        try {
          const refreshed = await garudaApi.getAgent(recordId);
          setRevision(refreshed.revision);
          setKnowledge(refreshed.knowledge || []);
        } catch { /* Keep the last confirmed server state. */ }
      }
      reportFailure(error);
    } finally {
      finishAction();
    }
  }

  return (
    <div className="-m-4 min-h-[calc(100vh-4rem)] bg-white sm:-m-6 lg:-m-8">
      <div className="flex h-16 items-center border-b px-4 sm:px-6"><Button variant="ghost" size="icon" asChild><Link href="/app/agents"><ArrowLeft className="h-4 w-4" /></Link></Button><div className="ml-2"><div className="flex items-center gap-2"><h1 className="text-sm font-semibold text-slate-900">{existing ? `Edit ${form.name}` : "Create agent"}</h1><Badge variant={published ? "success" : "secondary"}>{published ? "Live" : "Draft"}</Badge></div><p className={cn("text-[10px]", status === "error" ? "text-red-500" : "text-slate-400")}>{status === "saving" ? "Saving draft…" : status === "saved" ? "Draft saved" : status === "error" ? (statusMessage || "Could not save — try again") : "Review and save your draft"}</p></div><div className="ml-auto flex gap-2"><Button variant="outline" size="sm" onClick={saveDraftAction} loading={pendingAction === "save"} loadingLabel="Saving the draft" disabled={pendingAction !== "" && pendingAction !== "save"} className="hidden sm:inline-flex"><Save className="mr-1.5 h-3.5 w-3.5" /> Save</Button><Button variant="outline" size="sm" onClick={testAgent} loading={pendingAction === "test"} loadingLabel="Saving and testing the agent" disabled={pendingAction !== "" && pendingAction !== "test"}><Play className="mr-1.5 h-3.5 w-3.5" /> Test</Button><Button size="sm" onClick={publish} loading={pendingAction === "publish"} loadingLabel={published ? "Publishing your updates" : "Publishing the agent"} disabled={pendingAction !== "" && pendingAction !== "publish"}><Sparkles className="mr-1.5 h-3.5 w-3.5" /> {published ? "Publish updates" : "Publish agent"}</Button></div></div>
      <div className="grid min-h-[calc(100vh-8rem)] lg:grid-cols-[205px_1fr_390px] xl:grid-cols-[230px_1fr_440px]">
        <aside className="hidden border-r bg-slate-50/60 p-3 lg:block">
          <p className="px-3 py-3 text-[10px] font-bold uppercase tracking-[.16em] text-slate-400">Configure</p>
          <nav className="space-y-1">{sections.map((item, index) => <button key={item.id} onClick={() => setSection(item.id)} className={cn("flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-xs font-medium transition", section === item.id ? "bg-white text-indigo-700 shadow-sm ring-1 ring-slate-200" : "text-slate-600 hover:bg-white")}><item.icon className={cn("h-4 w-4", section === item.id ? "text-indigo-600" : "text-slate-400")} />{item.label}{index < 3 && <Check className="ml-auto h-3.5 w-3.5 text-emerald-500" />}</button>)}</nav>
          <div className="mt-6 rounded-xl border border-indigo-100 bg-indigo-50 p-3"><p className="flex items-center gap-1.5 text-[10px] font-semibold text-indigo-800"><Sparkles className="h-3.5 w-3.5" /> Garuda tip</p><p className="mt-2 text-[10px] leading-4 text-indigo-700">Give each agent one clear outcome. Focused instructions are easier to review, test, and improve.</p></div>
        </aside>

        <section className="overflow-y-auto px-5 py-7 sm:px-8 lg:max-h-[calc(100vh-8rem)] xl:px-12">
          <div className="mx-auto max-w-2xl">
            <div className="mb-6 flex gap-2 overflow-x-auto lg:hidden">{sections.map((item) => <button key={item.id} onClick={() => setSection(item.id)} className={cn("shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium", section === item.id ? "border-indigo-200 bg-indigo-50 text-indigo-700" : "bg-white text-slate-500")}>{item.label}</button>)}</div>
            <UnlistedMessages messages={fieldMessages} />
            {section === "identity" && <IdentitySection name={form.name} setName={updateField("name")} description={form.description} setDescription={updateField("description")} greeting={form.greeting} setGreeting={updateField("greeting")} messages={fieldMessages} />}
            {section === "goal" && <GoalSection systemPrompt={form.systemPrompt} setSystemPrompt={updateField("systemPrompt")} messages={fieldMessages} />}
            {section === "knowledge" && <KnowledgeSection knowledge={knowledge} onAdd={addKnowledge} messages={fieldMessages} saving={pendingAction === "knowledge"} blocked={pendingAction !== "" && pendingAction !== "knowledge"} />}
            {section === "appearance" && <AppearanceSection primaryColor={form.primaryColor} setPrimaryColor={updateField("primaryColor")} accent={form.accent} setAccent={updateField("accent")} launcherText={form.launcherText} setLauncherText={updateField("launcherText")} widgetPosition={form.widgetPosition} setWidgetPosition={updateField("widgetPosition")} allowedDomain={form.allowedDomain} setAllowedDomain={updateField("allowedDomain")} messages={fieldMessages} />}
            {section === "handoff" && <HandoffSection />}
            <div className="mt-8 flex justify-between border-t pt-5"><Button variant="ghost" size="sm" disabled={section === "identity"} onClick={() => setSection(sections[Math.max(0, sections.findIndex((item) => item.id === section) - 1)].id)}>Previous</Button><Button size="sm" onClick={() => { const index = sections.findIndex((item) => item.id === section); if (index < sections.length - 1) setSection(sections[index + 1].id); }}>Next section <ChevronRight className="ml-1.5 h-3.5 w-3.5" /></Button></div>
          </div>
        </section>

        <aside className="hidden border-l bg-[#f7f8fb] p-5 lg:block">
          <div className="mb-3 flex items-center justify-between"><p className="text-xs font-semibold text-slate-700">Live preview</p><div className="flex rounded-lg border bg-white p-0.5"><button className="rounded-md bg-slate-100 px-2 py-1 text-[9px] font-semibold">Desktop</button><button className="px-2 py-1 text-[9px] text-slate-400">Mobile</button></div></div>
          <ChatPreview name={form.name} greeting={form.greeting} accent={form.accent} previewReply={previewReply} />
        </aside>
      </div>
    </div>
  );
}

function FieldMessage({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-[10px] text-red-500">{message}</p>;
}

function UnlistedMessages({ messages }: { messages: Record<string, string> }) {
  const lines = unlistedFieldMessages(messages);
  if (!lines.length) return null;
  return <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4"><p className="text-xs font-semibold text-red-700">The server rejected this draft</p><ul className="mt-2 space-y-1">{lines.map((line) => <li key={line} className="text-[10px] leading-4 text-red-600">{line}</li>)}</ul></div>;
}

function SectionHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <div className="mb-7"><p className="text-[10px] font-bold uppercase tracking-[.16em] text-indigo-600">{eyebrow}</p><h2 className="mt-2 text-2xl font-bold tracking-[-.035em] text-slate-950">{title}</h2><p className="mt-2 text-sm leading-6 text-slate-500">{description}</p></div>;
}

function IdentitySection({ name, setName, description, setDescription, greeting, setGreeting, messages }: { name: string; setName: (value: string) => void; description: string; setDescription: (value: string) => void; greeting: string; setGreeting: (value: string) => void; messages: Record<string, string> }) {
  return <><SectionHeading eyebrow="Identity" title="Make your agent feel like part of the team." description="Give it a recognizable name, clear role, and a warm opening that sounds like your business." /><div className="space-y-6"><div className="space-y-2"><Label htmlFor="agent-name">Agent name</Label><Input id="agent-name" value={name} onChange={(event) => setName(event.target.value)} /><FieldMessage message={messages.name} /><p className="text-[10px] text-slate-400">Short, human names usually feel the most approachable.</p></div><div className="space-y-2"><Label htmlFor="agent-description">Role description</Label><Input id="agent-description" value={description} onChange={(event) => setDescription(event.target.value)} /><FieldMessage message={messages.description} /></div><div className="space-y-2"><Label htmlFor="greeting">Opening greeting</Label><Textarea id="greeting" value={greeting} onChange={(event) => setGreeting(event.target.value)} className="min-h-[110px]" /><FieldMessage message={messages.welcome_message} /><div className="flex justify-between text-[10px] text-slate-400"><span>Be warm, specific and easy to answer.</span><span>{greeting.length}/240</span></div></div></div></>;
}

function GoalSection({ systemPrompt, setSystemPrompt, messages }: { systemPrompt: string; setSystemPrompt: (value: string) => void; messages: Record<string, string> }) {
  const templates = [
    { title: "Sales guide", prompt: "Help visitors understand the offer, answer only from approved knowledge, qualify intent, and offer a human follow-up when useful." },
    { title: "Lead qualification", prompt: "Ask concise questions to understand visitor fit. Use only approved knowledge, request contact details with explicit consent, and explain the next step clearly." },
    { title: "Customer support", prompt: "Answer customer questions accurately using only approved knowledge. Say when information is unavailable and recommend a human follow-up for unresolved issues." },
  ];
  return <><SectionHeading eyebrow="Goal & behavior" title="Give every conversation a clear purpose." description="These instructions are persisted with the agent and used by the private preview and published widget." /><div className="space-y-5"><div><p className="text-xs font-semibold text-slate-800">Start from a template</p><div className="mt-3 grid gap-2 sm:grid-cols-3">{templates.map((template) => <button key={template.title} type="button" onClick={() => setSystemPrompt(template.prompt)} className="rounded-xl border p-3 text-left text-xs font-semibold text-slate-700 transition hover:border-indigo-300 hover:bg-indigo-50">{template.title}</button>)}</div></div><div className="space-y-2"><Label htmlFor="agent-instructions">Agent instructions</Label><Textarea id="agent-instructions" value={systemPrompt} onChange={(event) => setSystemPrompt(event.target.value)} className="min-h-[180px]" /><FieldMessage message={messages.system_prompt} /><p className="text-[10px] text-slate-400">Keep instructions focused. Knowledge sources provide the factual context.</p></div></div></>;
}

function KnowledgeSection({ knowledge, onAdd, messages, saving, blocked }: { knowledge: AgentRecord["knowledge"]; onAdd: (title: string, content: string) => Promise<void>; messages: Record<string, string>; saving: boolean; blocked: boolean }) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  return <><SectionHeading eyebrow="Knowledge" title="Teach your agent what your team already knows." description="Add approved text Garuda can use when it answers. Each source is stored and processed separately." /><div className="space-y-4">{knowledge.map((source, index) => { const sourceStatus = source.status || "ready"; return <div key={source.id || `${source.title}-${index}`} className="flex items-center gap-3 rounded-xl border p-4"><span className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-50 text-indigo-600"><BrainCircuit className="h-5 w-5" /></span><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold text-slate-900">{source.title}</p><p className="mt-1 text-[10px] text-slate-400">Text source · {source.content.length} characters</p></div><Badge variant={sourceStatus === "ready" ? "success" : sourceStatus === "failed" ? "warning" : "secondary"} className="capitalize">{sourceStatus}</Badge></div>; })}<div className="rounded-xl border border-dashed p-4"><p className="flex items-center gap-2 text-xs font-semibold text-slate-800"><UploadCloud className="h-4 w-4 text-indigo-600" /> Add a text knowledge source</p><div className="mt-3 space-y-2"><Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Source title, e.g. Pricing FAQ" /><Textarea value={content} onChange={(event) => setContent(event.target.value)} placeholder="Paste accurate product, service, pricing or policy information…" className="min-h-[110px]" /><FieldMessage message={messages.knowledge} /><Button variant="outline" loading={saving} loadingLabel="Saving the knowledge source" disabled={blocked || !title.trim() || !content.trim()} onClick={async () => { await onAdd(title.trim(), content.trim()); setTitle(""); setContent(""); }}>Add and save source</Button></div></div><div className="space-y-2"><Label htmlFor="knowledge-url">Website ingestion</Label><div className="flex gap-2"><Input id="knowledge-url" placeholder="https://docs.yoursite.com" disabled /><Button variant="outline" disabled>Add URL</Button></div><p className="text-[10px] text-slate-400">URL crawling is unavailable until the ingestion worker is configured.</p></div></div></>;
}

function AppearanceSection({ primaryColor, setPrimaryColor, accent, setAccent, launcherText, setLauncherText, widgetPosition, setWidgetPosition, allowedDomain, setAllowedDomain, messages }: { primaryColor: string; setPrimaryColor: (value: string) => void; accent: string; setAccent: (value: string) => void; launcherText: string; setLauncherText: (value: string) => void; widgetPosition: string; setWidgetPosition: (value: string) => void; allowedDomain: string; setAllowedDomain: (value: string) => void; messages: Record<string, string> }) {
  const colors = ["#635BFF", "#7C3AED", "#0F766E", "#0284C7", "#E11D48", "#0F172A"];
  return <><SectionHeading eyebrow="Appearance" title="Make the widget look at home on your site." description="Match your colors and approve the website where this agent can run." /><div className="space-y-6"><div><Label>Accent color</Label><div className="mt-3 flex flex-wrap gap-3">{colors.map((color) => <button key={color} onClick={() => setAccent(color)} className={cn("grid h-10 w-10 place-items-center rounded-full border-4 border-white shadow-sm ring-offset-2", accent === color && "ring-2 ring-slate-400")} style={{ backgroundColor: color }} aria-label={`Use ${color}`}>{accent === color && <Check className="h-4 w-4 text-white" />}</button>)}</div><FieldMessage message={messages["branding.colors"]} /></div><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="primary-color">Header color</Label><Input id="primary-color" value={primaryColor} onChange={(event) => setPrimaryColor(event.target.value)} /></div><div className="space-y-2"><Label htmlFor="custom-color">Accent color</Label><Input id="custom-color" value={accent} onChange={(event) => setAccent(event.target.value)} /></div><div className="space-y-2"><Label htmlFor="launcher-text">Launcher text</Label><Input id="launcher-text" value={launcherText} onChange={(event) => setLauncherText(event.target.value)} /></div><div className="space-y-2"><Label htmlFor="widget-position">Widget position</Label><select id="widget-position" value={widgetPosition} onChange={(event) => setWidgetPosition(event.target.value)} className="h-11 w-full rounded-lg border bg-white px-3 text-sm"><option value="bottom_right">Bottom right</option><option value="bottom_left">Bottom left</option></select><FieldMessage message={messages["branding.position"]} /></div></div><div className="space-y-2"><Label htmlFor="allowed-domain">Allowed website domain</Label><Input id="allowed-domain" value={allowedDomain} onChange={(event) => setAllowedDomain(event.target.value)} placeholder="yourcompany.com" /><FieldMessage message={messages["branding.allowed_domains"]} /><p className="text-[10px] text-slate-400">Required to publish. Garuda rejects widget sessions from any other domain.</p></div></div></>;
}

function HandoffSection() {
  return <><SectionHeading eyebrow="Handoff rules" title="Human handoff controls are coming soon." description="The current release persists conversations and captured leads. Team notifications and live takeover rules are not enabled yet." /><div className="rounded-xl border border-dashed bg-slate-50 p-6 text-center"><Settings2 className="mx-auto h-6 w-6 text-indigo-500" /><p className="mt-3 text-xs font-semibold text-slate-800">No handoff automation is active</p><p className="mx-auto mt-1 max-w-md text-[10px] leading-5 text-slate-500">Use the agent instructions to recommend a human follow-up. Configurable notifications and assignment rules will appear here in a later release.</p><Badge variant="secondary" className="mt-3">Coming soon</Badge></div></>;
}

function ChatPreview({ name, greeting, accent, previewReply }: { name: string; greeting: string; accent: string; previewReply: string }) {
  return <div className="relative flex min-h-[570px] items-end justify-center overflow-hidden rounded-2xl border bg-white p-5 shadow-sm"><div className="absolute inset-0 bg-[linear-gradient(180deg,#fff,#f3f4f8)]" /><div className="relative w-full overflow-hidden rounded-2xl border bg-white shadow-[0_20px_60px_rgba(15,23,42,.16)]"><div className="flex items-center gap-3 p-4 text-white" style={{ backgroundColor: accent }}><div className="grid h-9 w-9 place-items-center rounded-full bg-white/20 text-xs font-bold">{name[0] || "A"}</div><div><p className="text-xs font-semibold">{name || "Your agent"}</p><p className="mt-0.5 text-[9px] text-white/80">Online now</p></div></div><div className="h-[340px] space-y-3 overflow-y-auto bg-slate-50/50 p-4"><div className="flex justify-start"><div className="max-w-[88%] rounded-2xl rounded-bl-md border bg-white px-3 py-2.5 text-[11px] leading-5 text-slate-700 shadow-sm">{greeting || "Add an opening greeting…"}</div></div>{previewReply ? <><div className="flex justify-end"><div className="max-w-[82%] rounded-2xl rounded-br-md bg-slate-950 px-3 py-2.5 text-[11px] text-white">What can you help me with?</div></div><div className="flex justify-start"><div className="max-w-[88%] rounded-2xl rounded-bl-md border bg-white px-3 py-2.5 text-[11px] leading-5 text-slate-700 shadow-sm">{previewReply}</div></div></> : <div className="flex flex-wrap gap-1.5">{["Learn more", "See pricing", "Book a demo"].map((item) => <span key={item} className="rounded-full border bg-white px-2.5 py-1 text-[9px] font-medium" style={{ color: accent }}>{item}</span>)}</div>}</div><div className="border-t p-3"><div className="flex h-9 items-center rounded-lg border bg-slate-50 px-3 text-[10px] text-slate-400">Type a message…<span className="ml-auto grid h-6 w-6 place-items-center rounded-md text-white" style={{ backgroundColor: accent }}>↑</span></div><p className="mt-2 text-center text-[8px] text-slate-400">Powered by Garuda</p></div></div></div>;
}
