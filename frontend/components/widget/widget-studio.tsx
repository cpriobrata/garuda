"use client";

// The widget studio: everything the customer can change about how their widget
// looks and behaves, in the order the owner sketched it.
//
// The screen edits the raw branding and lead_capture objects and paints from the
// resolved ones the server sends beside them. A save replaces custom_colors,
// toggles and lead_capture whole, which is why the draft carries every value in
// those objects even the ones this screen has no input for.

import * as React from "react";
import { AlertCircle, Check, Loader2, RotateCcw, Save } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { AsyncButton, useAsyncAction } from "@/components/widget/widget-studio-controls";
import { widgetStudioApi } from "@/components/widget/widget-studio-api";
import { LeadFormBuilder } from "@/components/widget/widget-lead-form-builder";
import { WidgetStudioPreview } from "@/components/widget/widget-studio-preview";
import {
  IdentitySection,
  LogoSection,
  PositionSection,
  ThemeSection,
  TogglesSection,
} from "@/components/widget/widget-studio-sections";
import {
  hasUnsavedStudioChanges,
  isStaleRevision,
  setStudioToggle,
  studioDraftFromAgent,
  studioFieldMessages,
  studioMessageSummary,
  studioPayloadFromDraft,
  type AgentStudioRecord,
  type StudioDraft,
  type WidgetToggleKey,
} from "@/components/widget/widget-studio-state";

export function WidgetStudio({ agentId }: { agentId: string }) {
  const [record, setRecord] = React.useState<AgentStudioRecord | null>(null);
  const [draft, setDraft] = React.useState<StudioDraft | null>(null);
  const [savedDraft, setSavedDraft] = React.useState<StudioDraft | null>(null);
  const [messages, setMessages] = React.useState<Record<string, string>>({});
  const [statusMessage, setStatusMessage] = React.useState("");
  const [state, setState] = React.useState<"loading" | "ready" | "saved" | "error">("loading");
  const [outOfDate, setOutOfDate] = React.useState(false);
  const saveAction = useAsyncAction();

  const applyRecord = React.useCallback((agent: AgentStudioRecord) => {
    const next = studioDraftFromAgent(agent);
    setRecord(agent);
    setDraft(next);
    setSavedDraft(next);
  }, []);

  const loadAgent = React.useCallback(async (identifier: string) => {
    try {
      const agent = await widgetStudioApi.loadAgentStudio(identifier);
      applyRecord(agent);
      setMessages({});
      setStatusMessage("");
      setOutOfDate(false);
      setState("ready");
      return true;
    } catch (error) {
      setStatusMessage(error instanceof ApiError ? error.message : "The agent's settings could not be loaded.");
      setState("error");
      return false;
    }
  }, [applyRecord]);

  React.useEffect(() => {
    if (!agentId) return;
    let active = true;
    setState("loading");
    widgetStudioApi.loadAgentStudio(agentId).then((agent) => {
      if (!active) return;
      applyRecord(agent);
      setState("ready");
    }).catch((error) => {
      if (!active) return;
      setStatusMessage(error instanceof ApiError ? error.message : "The agent's settings could not be loaded.");
      setState("error");
    });
    return () => { active = false; };
  }, [agentId, applyRecord]);

  const dirty = hasUnsavedStudioChanges(draft, savedDraft);

  // Edits are worth more than a stray click on the back button, so the browser
  // asks before a page with unsaved work is thrown away.
  React.useEffect(() => {
    if (!dirty || typeof window === "undefined") return;
    function warnBeforeLeaving(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [dirty]);

  function changeDraft(update: (current: StudioDraft) => StudioDraft) {
    setDraft((current) => (current ? update(current) : current));
    setState((current) => (current === "saved" ? "ready" : current));
  }

  function toggleSwitch(key: WidgetToggleKey, value: boolean) {
    changeDraft((current) => setStudioToggle(current, key, value));
  }

  async function saveStudio() {
    if (!draft || !record) return;
    setMessages({});
    setStatusMessage("");
    setOutOfDate(false);
    try {
      const updated = await widgetStudioApi.saveAgentStudio(record.id, studioPayloadFromDraft(draft), record.revision);
      applyRecord(updated);
      setState("saved");
    } catch (error) {
      const rejected = studioFieldMessages(error);
      setMessages(rejected);
      setOutOfDate(isStaleRevision(error));
      setStatusMessage(error instanceof ApiError && error.message ? error.message : "These settings could not be saved. Check your connection and try again.");
      setState("error");
    }
  }

  // An account with no agent is not a screen that is still loading, and it is
  // known from the props alone, so it is decided while rendering rather than in
  // an effect that has not run yet on the first paint.
  if (!agentId) {
    return (
      <div className="rounded-xl border border-dashed bg-white p-10 text-center shadow-sm">
        <p className="text-sm font-semibold text-slate-900">No agent to customize yet</p>
        <p className="mx-auto mt-1.5 max-w-sm text-xs leading-5 text-slate-500">Create an agent first. Its name, colours, placement and lead form are all configured here.</p>
      </div>
    );
  }

  if (!draft || !record) {
    return (
      <div className="rounded-xl border bg-white p-10 text-center shadow-sm">
        {state === "error" ? (
          <>
            <AlertCircle className="mx-auto h-5 w-5 text-red-500" />
            <p className="mt-3 text-sm font-semibold text-slate-900">These settings could not be loaded</p>
            <p className="mx-auto mt-1.5 max-w-sm text-xs leading-5 text-slate-500">{statusMessage}</p>
            <AsyncButton className="mt-4" variant="outline" size="sm" pendingLabel="Retrying…" onClick={() => loadAgent(agentId)}>Try again</AsyncButton>
          </>
        ) : (
          <>
            <Loader2 className="mx-auto h-5 w-5 animate-spin text-indigo-500" />
            <p className="mt-3 text-xs text-slate-500">Loading this agent&rsquo;s widget settings…</p>
          </>
        )}
      </div>
    );
  }

  const summary = studioMessageSummary(messages);

  return (
    <div className="space-y-5">
      <div className="sticky top-0 z-20 -mx-1 flex flex-wrap items-center gap-3 rounded-xl border bg-white/90 px-4 py-3 shadow-sm backdrop-blur">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-slate-900">{record.name}</p>
          <p className="mt-0.5 text-[10px] text-slate-500">Revision {record.revision}{record.status === "published" ? " · published" : " · draft"}</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {state === "saved" && !dirty ? <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-600"><Check className="h-3.5 w-3.5" /> Saved</span> : null}
          {dirty ? <Badge variant="warning">Unsaved changes</Badge> : null}
          <Button
            variant="outline"
            size="sm"
            disabled={!dirty || saveAction.pending}
            // Discarding after a conflict must not hide the reload: the stored
            // record is still newer than this one, so the next save would fail
            // the same way.
            onClick={() => { if (savedDraft) { setDraft(savedDraft); if (!outOfDate) { setMessages({}); setStatusMessage(""); setState("ready"); } } }}
          >
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Discard
          </Button>
          <AsyncButton
            size="sm"
            icon={<Save className="mr-2 h-4 w-4" />}
            pending={saveAction.pending}
            pendingLabel="Saving…"
            disabled={!dirty}
            onClick={() => saveAction.run(saveStudio)}
          >
            Save changes
          </AsyncButton>
        </div>
      </div>

      {state === "error" && statusMessage ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-red-700"><AlertCircle className="h-3.5 w-3.5" /> {statusMessage}</p>
          {summary.length ? (
            <ul className="mt-2 space-y-1">
              {summary.map((entry) => (
                <li key={entry.key} className="text-[11px] leading-4 text-red-600"><span className="font-semibold">{entry.label}:</span> {entry.message}</li>
              ))}
            </ul>
          ) : null}
          {outOfDate ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <p className="text-[11px] text-red-600">This agent was changed somewhere else. Reloading takes the newer version and discards what is on this screen.</p>
              <AsyncButton size="sm" variant="outline" className="border-red-200 bg-white text-red-700" pendingLabel="Reloading…" onClick={() => loadAgent(agentId)}>Reload the agent</AsyncButton>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[1.05fr_.95fr]">
        <div className="space-y-5">
          <IdentitySection draft={draft} agentName={record.name} messages={messages} onChange={changeDraft} />
          <ThemeSection draft={draft} presets={record.theme_presets} minimums={record.contrast_minimums} messages={messages} onChange={changeDraft} />
          <LogoSection draft={draft} messages={messages} onChange={changeDraft} />
          <PositionSection draft={draft} positions={record.positions} messages={messages} onChange={changeDraft} />
          <TogglesSection draft={draft} messages={messages} onToggle={toggleSwitch} />
          <LeadFormBuilder draft={draft} fieldTypes={record.lead_form_field_types} reservedIDs={record.reserved_lead_field_ids} messages={messages} onChange={changeDraft} />
        </div>
        <aside className="xl:sticky xl:top-20 h-fit overflow-hidden rounded-xl border bg-white shadow-sm">
          <WidgetStudioPreview draft={draft} presets={record.theme_presets} agentName={record.name} />
        </aside>
      </div>

      <div className="flex items-center justify-end gap-2 rounded-xl border bg-white p-4 shadow-sm">
        {dirty ? <p className="mr-auto text-[11px] text-slate-500">These changes are not saved yet.</p> : <p className="mr-auto text-[11px] text-slate-500">Everything here is saved.</p>}
        <AsyncButton
          icon={<Save className="mr-2 h-4 w-4" />}
          pending={saveAction.pending}
          pendingLabel="Saving…"
          disabled={!dirty}
          onClick={() => saveAction.run(saveStudio)}
        >
          Save changes
        </AsyncButton>
      </div>
    </div>
  );
}
