// The two calls the studio makes, typed against the agent detail contract.
//
// They go through the shared apiRequest so they inherit the envelope handling,
// the token refresh and the demo fallback the rest of the portal already has.
// The demo record below is what the studio shows when no API is configured: the
// product has to run with zero credentials, and a settings screen that cannot
// draw its own pickers without a server is not a settings screen.

import { apiRequest } from "@/lib/api";
import type { AgentStudioRecord, StudioPayload } from "@/components/widget/widget-studio-state";

// A copy of the server's table, used only when there is no server to ask. The
// studio never reads this in a configured workspace; it renders whatever
// theme_presets the agent response carried, so retuning a preset on the server
// reaches every customer without a web deploy.
const demoThemePresets: AgentStudioRecord["theme_presets"] = [
  { id: "ocean_blue", label: "Ocean blue", description: "Calm and professional", colors: { primary: "#0F4C81", accent: "#2E8BC0", background: "#FFFFFF", surface: "#EEF4FA", text: "#0F1D2B", on_primary: "#FFFFFF", on_accent: "#FFFFFF" } },
  { id: "forest_green", label: "Forest green", description: "Natural and balanced", colors: { primary: "#1B5E3F", accent: "#2E9E63", background: "#FFFFFF", surface: "#EDF6F0", text: "#10231A", on_primary: "#FFFFFF", on_accent: "#FFFFFF" } },
  { id: "sunset_orange", label: "Sunset orange", description: "Warm and energetic", colors: { primary: "#B23A0B", accent: "#F97316", background: "#FFFFFF", surface: "#FFF3EA", text: "#2A1508", on_primary: "#FFFFFF", on_accent: "#111827" } },
  { id: "summer_yellow", label: "Summer yellow", description: "Bright and cheerful", colors: { primary: "#A16207", accent: "#FACC15", background: "#FFFFFF", surface: "#FEF9E7", text: "#2B2205", on_primary: "#FFFFFF", on_accent: "#111827" } },
  { id: "royal_purple", label: "Royal purple", description: "Creative and luxurious", colors: { primary: "#4C1D95", accent: "#7C3AED", background: "#FFFFFF", surface: "#F4EFFE", text: "#1E1235", on_primary: "#FFFFFF", on_accent: "#FFFFFF" } },
  { id: "custom", label: "Custom", description: "Customizable for you", colors: null },
];

function demoAgentRecord(agentId: string): AgentStudioRecord {
  return {
    id: agentId,
    name: "Aria",
    status: "draft",
    revision: 1,
    branding: { primary_color: "#111827", accent_color: "#635BFF", position: "bottom_right", launcher_text: "Ask Garuda", allowed_domains: ["northstarlabs.com"] },
    lead_capture: { enabled: true, prompt: "", after_turns: 3, fields: ["name", "email"] },
    resolved_branding: {
      display_name: "Aria",
      tagline: "",
      logo_url: "",
      avatar_url: "",
      launcher_text: "Ask Garuda",
      privacy_url: "",
      position: "bottom_right",
      theme: "custom",
      colors: { primary: "#111827", accent: "#635BFF", background: "#FFFFFF", surface: "#F3F4F6", text: "#111827", on_primary: "#FFFFFF", on_accent: "#FFFFFF" },
      toggles: { transcription: false, chat: true, autostart: false, mute_on_minimize: false, mute_on_tab_change: false, show_lead_form: false, is_glowing: false, is_transparent: false, agent_mute: false },
    },
    resolved_lead_form: {
      enabled: true,
      prompt: "",
      after_turns: 3,
      heading: "Share your contact details",
      submit_label: "Submit",
      privacy_text: "",
      fields: [
        { id: "name", label: "Name", type: "text" },
        { id: "email", label: "Email", type: "email" },
      ],
    },
    theme_presets: demoThemePresets,
    positions: ["bottom_right", "bottom_left", "middle_right", "middle_left", "top_right", "top_left"],
    lead_form_field_types: ["text", "email", "telephone", "number", "textarea", "select", "checkbox", "date"],
    reserved_lead_field_ids: ["name", "email", "phone", "company"],
    contrast_minimums: { body_text: 4.5, interface: 3 },
  };
}

// The demo workspace keeps what it was given so a save behaves the way it will
// in production: the studio takes its next draft from the response.
let demoRecord: AgentStudioRecord | null = null;

function demoSave(agentId: string, payload: StudioPayload): AgentStudioRecord {
  const record = demoRecord || demoAgentRecord(agentId);
  const colors = record.resolved_branding.colors;
  const preset = demoThemePresets.find((candidate) => candidate.id === payload.branding.theme && candidate.colors);
  demoRecord = {
    ...record,
    revision: record.revision + 1,
    branding: {
      ...record.branding,
      display_name: payload.branding.display_name,
      tagline: payload.branding.tagline,
      logo_url: payload.branding.logo_url,
      theme: payload.branding.theme,
      primary_color: payload.branding.primary_color,
      accent_color: payload.branding.accent_color,
      position: payload.branding.position,
      launcher_text: payload.branding.launcher_text,
      custom_colors: { ...payload.branding.custom_colors },
      toggles: { ...payload.branding.toggles },
    },
    lead_capture: { ...payload.lead_capture },
    resolved_branding: {
      ...record.resolved_branding,
      display_name: payload.branding.display_name || record.name,
      tagline: payload.branding.tagline,
      logo_url: payload.branding.logo_url,
      launcher_text: payload.branding.launcher_text,
      position: payload.branding.position,
      theme: payload.branding.theme || "custom",
      colors: preset && preset.colors ? { ...preset.colors } : {
        ...colors,
        primary: payload.branding.primary_color || colors.primary,
        accent: payload.branding.accent_color || colors.accent,
        background: payload.branding.custom_colors.background || "#FFFFFF",
        surface: payload.branding.custom_colors.surface || "#F3F4F6",
        text: payload.branding.custom_colors.text || "#111827",
      },
      toggles: { ...payload.branding.toggles },
    },
    resolved_lead_form: {
      ...record.resolved_lead_form,
      enabled: payload.lead_capture.enabled,
      heading: payload.lead_capture.form_heading || record.resolved_lead_form.heading,
      submit_label: payload.lead_capture.submit_label || "Submit",
      fields: payload.lead_capture.form_fields.length ? payload.lead_capture.form_fields.map((field) => ({ ...field })) : record.resolved_lead_form.fields,
    },
  };
  return demoRecord;
}

export const widgetStudioApi = {
  loadAgentStudio: (agentId: string) => apiRequest<AgentStudioRecord>(`/agents/${encodeURIComponent(agentId)}`, {
    mock: () => demoRecord || demoAgentRecord(agentId),
  }),
  saveAgentStudio: (agentId: string, payload: StudioPayload, revision?: number) => apiRequest<AgentStudioRecord>(`/agents/${encodeURIComponent(agentId)}`, {
    method: "PATCH",
    headers: revision ? { "If-Match": `"${revision}"` } : undefined,
    body: JSON.stringify(payload),
    timeoutMs: 20000,
    mock: () => demoSave(agentId, payload),
  }),
};
