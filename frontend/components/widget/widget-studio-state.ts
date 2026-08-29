// The widget studio's state, kept apart from its rendering.
//
// Three rules shape everything in this file.
//
// The customer edits the raw branding and lead_capture objects, but the studio
// paints from the resolved objects the server sends beside them. A field the
// customer never set is absent in the raw object and concrete in the resolved
// one, so the preview and the widget always agree about what a visitor sees.
//
// The theme table, the placements, the field types and the contrast floors all
// arrive on the agent response. Nothing in this file invents one, because a
// second copy of the theme table is a second answer to "what colour is ocean
// blue" and the widgets already deployed on customer websites read the server's.
//
// The two object-valued patch keys, custom_colors and toggles, replace their
// stored value whole, so a save always sends all five colours and all nine
// switches together. Sending one switch would reset the other eight.

import { ApiError } from "@/lib/api";

export type ThemeColors = {
  primary: string;
  accent: string;
  background: string;
  surface: string;
  text: string;
  on_primary: string;
  on_accent: string;
};

export type ThemePreset = {
  id: string;
  label: string;
  description: string;
  colors: ThemeColors | null;
};

export type LeadFormField = {
  id: string;
  label: string;
  type: string;
  required?: boolean;
  options?: string[];
  placeholder?: string;
};

export const widgetToggleKeys = [
  "transcription",
  "chat",
  "autostart",
  "mute_on_minimize",
  "mute_on_tab_change",
  "show_lead_form",
  "is_glowing",
  "is_transparent",
  "agent_mute",
] as const;

export type WidgetToggleKey = (typeof widgetToggleKeys)[number];
export type ResolvedToggles = Record<WidgetToggleKey, boolean>;

export const customColorKeys = ["background", "surface", "text", "on_primary", "on_accent"] as const;
export type CustomColorKey = (typeof customColorKeys)[number];
export type CustomColors = Partial<Record<CustomColorKey, string>>;

export type StoredBranding = {
  primary_color?: string;
  accent_color?: string;
  position?: string;
  avatar_url?: string;
  launcher_text?: string;
  privacy_url?: string;
  allowed_domains?: string[];
  display_name?: string;
  tagline?: string;
  logo_url?: string;
  theme?: string;
  custom_colors?: CustomColors | null;
  toggles?: Partial<Record<WidgetToggleKey, boolean | null>> | null;
};

export type StoredLeadCapture = {
  enabled: boolean;
  prompt: string;
  after_turns: number;
  fields: string[];
  privacy_text?: string;
  form_heading?: string;
  submit_label?: string;
  form_fields?: LeadFormField[];
};

export type ResolvedBranding = {
  display_name: string;
  tagline: string;
  logo_url: string;
  avatar_url: string;
  launcher_text: string;
  privacy_url: string;
  position: string;
  theme: string;
  colors: ThemeColors;
  toggles: ResolvedToggles;
};

export type ResolvedLeadForm = {
  enabled: boolean;
  prompt: string;
  after_turns: number;
  heading: string;
  submit_label: string;
  privacy_text: string;
  fields: LeadFormField[];
};

// The agent detail response: the stored agent, the server's resolution of it,
// and the catalogs a settings screen needs to draw its pickers.
export type AgentStudioRecord = {
  id: string;
  name: string;
  status: string;
  revision: number;
  branding: StoredBranding;
  lead_capture: StoredLeadCapture;
  resolved_branding: ResolvedBranding;
  resolved_lead_form: ResolvedLeadForm;
  theme_presets: ThemePreset[];
  positions: string[];
  lead_form_field_types: string[];
  reserved_lead_field_ids: string[];
  contrast_minimums: Record<string, number>;
};

// What the customer is editing. Everything the studio does not offer an input
// for is carried through untouched, because lead_capture is replaced whole by a
// save and dropping a key would erase it.
export type StudioDraft = {
  displayName: string;
  tagline: string;
  logoUrl: string;
  theme: string;
  primaryColor: string;
  accentColor: string;
  customColors: Record<CustomColorKey, string>;
  position: string;
  launcherText: string;
  toggles: ResolvedToggles;
  leadCaptureEnabled: boolean;
  formHeading: string;
  submitLabel: string;
  formFields: LeadFormField[];
  carriedLeadPrompt: string;
  carriedAfterTurns: number;
  carriedLegacyFields: string[];
  carriedPrivacyText: string;
};

// The colours the server falls back to, repeated here only so an input has
// something to show before the customer picks. They are also what the server
// resolves an empty value to, so the preview cannot disagree with the widget.
export const defaultPrimaryColor = "#111827";
export const defaultAccentColor = "#F97316";
export const defaultBackgroundColor = "#FFFFFF";
export const defaultSurfaceColor = "#F3F4F6";
export const defaultTextColor = "#111827";
const lightForegroundColor = "#FFFFFF";
const darkForegroundColor = "#111827";

export const customThemeID = "custom";
export const leadFieldIDLimit = 64;

// The human sentence for each key the server can reject, so a customer reads
// "Body text on the widget background" rather than a dotted path. A key with no
// entry is shown as it arrived rather than swallowed.
export const studioFieldLabels: Record<string, string> = {
  "branding.display_name": "Bot display name",
  "branding.tagline": "Tagline",
  "branding.logo_url": "Chat logo URL",
  "branding.theme": "Theme",
  "branding.position": "Widget position",
  "branding.colors": "Primary and accent color",
  "branding.toggles": "Toggle options",
  "branding.custom_colors.background": "Background color",
  "branding.custom_colors.surface": "Message bubble color",
  "branding.custom_colors.text": "Text color",
  "branding.custom_colors.on_primary": "Text on the primary color",
  "branding.custom_colors.on_accent": "Text on the accent color",
  "branding.contrast.text_on_background": "Text on the widget background",
  "branding.contrast.text_on_surface": "Text on a message bubble",
  "branding.contrast.on_primary_over_primary": "Header text on the primary color",
  "branding.contrast.on_accent_over_accent": "Button text on the accent color",
  "lead_capture.form_heading": "Lead form heading",
  "lead_capture.submit_label": "Submit button text",
  "lead_capture.form_fields": "Lead form fields",
};

// The four pairings the server measures, in the order it reports them, with the
// floor each one answers to. minimums arrives on the agent response so the
// studio warns against the same numbers the server enforces.
export type ContrastPair = {
  key: string;
  label: string;
  foreground: string;
  background: string;
  minimum: number;
  ratio: number;
  passes: boolean;
};

export function isHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value.trim());
}

function firstValidColor(...values: Array<string | undefined>): string {
  for (const value of values) {
    const trimmed = (value || "").trim();
    if (isHexColor(trimmed)) return trimmed;
  }
  return "";
}

// WCAG 2.1 relative luminance, the same definition the server implements, so a
// warning shown here is a rejection avoided there.
export function relativeLuminance(color: string): number {
  const channel = (offset: number) => {
    const component = parseInt(color.slice(offset, offset + 2), 16) / 255;
    return component <= 0.03928 ? component / 12.92 : Math.pow((component + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

export function contrastRatio(foreground: string, background: string): number {
  if (!isHexColor(foreground) || !isHexColor(background)) return 0;
  const first = relativeLuminance(foreground.trim());
  const second = relativeLuminance(background.trim());
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

// The foreground a customer would have picked for a fill they left alone.
export function readableForeground(background: string): string {
  if (!isHexColor(background)) return darkForegroundColor;
  return contrastRatio(lightForegroundColor, background) >= contrastRatio(darkForegroundColor, background)
    ? lightForegroundColor
    : darkForegroundColor;
}

// The concrete palette for a draft, resolved exactly the way the server does it:
// a named preset wins outright and the stored primary and accent are left alone
// underneath it, so switching back to custom restores what the customer had.
export function resolveDraftColors(draft: StudioDraft, presets: ThemePreset[]): ThemeColors {
  const preset = presets.find((candidate) => candidate.id === draft.theme && candidate.colors);
  if (preset && preset.colors) return { ...preset.colors };
  const colors: ThemeColors = {
    primary: firstValidColor(draft.primaryColor, defaultPrimaryColor),
    accent: firstValidColor(draft.accentColor, defaultAccentColor),
    background: firstValidColor(draft.customColors.background, defaultBackgroundColor),
    surface: firstValidColor(draft.customColors.surface, defaultSurfaceColor),
    text: firstValidColor(draft.customColors.text, defaultTextColor),
    on_primary: "",
    on_accent: "",
  };
  colors.on_primary = firstValidColor(draft.customColors.on_primary, readableForeground(colors.primary));
  colors.on_accent = firstValidColor(draft.customColors.on_accent, readableForeground(colors.accent));
  return colors;
}

export function contrastReport(colors: ThemeColors, minimums: Record<string, number>): ContrastPair[] {
  const bodyText = typeof minimums.body_text === "number" ? minimums.body_text : 4.5;
  const interfaceText = typeof minimums.interface === "number" ? minimums.interface : 3;
  const pairs = [
    { key: "branding.contrast.text_on_background", foreground: colors.text, background: colors.background, minimum: bodyText },
    { key: "branding.contrast.text_on_surface", foreground: colors.text, background: colors.surface, minimum: bodyText },
    { key: "branding.contrast.on_primary_over_primary", foreground: colors.on_primary, background: colors.primary, minimum: interfaceText },
    { key: "branding.contrast.on_accent_over_accent", foreground: colors.on_accent, background: colors.accent, minimum: interfaceText },
  ];
  return pairs.map((pair) => {
    const ratio = contrastRatio(pair.foreground, pair.background);
    // A pair that is not valid hex yet is left to the hex rule to report, the
    // same way the server skips it, rather than shown as a failed ratio.
    const measurable = isHexColor(pair.foreground) && isHexColor(pair.background);
    return {
      ...pair,
      label: studioFieldLabels[pair.key] || pair.key,
      ratio,
      passes: !measurable || ratio >= pair.minimum,
    };
  });
}

export function emptyCustomColors(): Record<CustomColorKey, string> {
  return { background: "", surface: "", text: "", on_primary: "", on_accent: "" };
}

function toggleStateFrom(resolved: ResolvedToggles): ResolvedToggles {
  const toggles = {} as ResolvedToggles;
  for (const key of widgetToggleKeys) toggles[key] = Boolean(resolved?.[key]);
  return toggles;
}

function cloneLeadField(field: LeadFormField): LeadFormField {
  return {
    id: field.id || "",
    label: field.label || "",
    type: field.type || "text",
    required: Boolean(field.required),
    options: Array.isArray(field.options) ? [...field.options] : [],
    placeholder: field.placeholder || "",
  };
}

// The draft the studio opens with. The fields the customer authored win; where
// they authored nothing the resolved answer fills in, so an agent that predates
// the builder opens showing the form its widget already draws instead of an
// empty list the customer would have to rebuild from memory.
export function studioDraftFromAgent(agent: AgentStudioRecord): StudioDraft {
  const branding = agent.branding || {};
  const capture = agent.lead_capture || { enabled: false, prompt: "", after_turns: 3, fields: [] };
  const custom = branding.custom_colors || {};
  const authored = Array.isArray(capture.form_fields) ? capture.form_fields : [];
  const fields = authored.length ? authored : agent.resolved_lead_form.fields || [];
  return {
    displayName: branding.display_name || "",
    tagline: branding.tagline || "",
    logoUrl: branding.logo_url || "",
    theme: agent.resolved_branding.theme || customThemeID,
    primaryColor: firstValidColor(branding.primary_color, defaultPrimaryColor),
    accentColor: firstValidColor(branding.accent_color, defaultAccentColor),
    customColors: {
      background: custom.background || "",
      surface: custom.surface || "",
      text: custom.text || "",
      on_primary: custom.on_primary || "",
      on_accent: custom.on_accent || "",
    },
    position: agent.resolved_branding.position,
    launcherText: branding.launcher_text || "",
    toggles: toggleStateFrom(agent.resolved_branding.toggles),
    leadCaptureEnabled: Boolean(capture.enabled),
    formHeading: capture.form_heading || "",
    submitLabel: capture.submit_label || "",
    formFields: fields.map(cloneLeadField),
    carriedLeadPrompt: capture.prompt || "",
    carriedAfterTurns: typeof capture.after_turns === "number" ? capture.after_turns : 3,
    carriedLegacyFields: Array.isArray(capture.fields) ? [...capture.fields] : [],
    carriedPrivacyText: capture.privacy_text || "",
  };
}

// Autostart opens the conversation immediately and the lead form gates it behind
// a form, so the two cannot both be on. The server refuses a request carrying
// both; the studio clears the other switch the moment one is turned on, so the
// customer never has to be told about a state they did not intend to ask for.
export function setStudioToggle(draft: StudioDraft, key: WidgetToggleKey, value: boolean): StudioDraft {
  const toggles = { ...draft.toggles, [key]: value };
  if (value && key === "autostart") toggles.show_lead_form = false;
  if (value && key === "show_lead_form") toggles.autostart = false;
  return { ...draft, toggles };
}

export const mutuallyExclusiveToggles: WidgetToggleKey[] = ["autostart", "show_lead_form"];

// slugifyLeadFieldID matches the server's rule character for character, so the
// identifier shown in the builder is the identifier answers are stored under.
export function slugifyLeadFieldID(value: string): string {
  let slug = "";
  let previousUnderscore = false;
  for (const character of value.trim().toLowerCase()) {
    if ((character >= "a" && character <= "z") || (character >= "0" && character <= "9") || character === "-") {
      slug += character;
      previousUnderscore = false;
    } else if (!previousUnderscore && slug.length > 0) {
      slug += "_";
      previousUnderscore = true;
    }
    if (slug.length >= leadFieldIDLimit) break;
  }
  return slug.replace(/^[_-]+/, "").replace(/[_-]+$/, "");
}

export function uniqueLeadFieldID(candidate: string, fields: LeadFormField[], ignoreIndex = -1): string {
  const taken = new Set(fields.filter((_, index) => index !== ignoreIndex).map((field) => field.id));
  const base = slugifyLeadFieldID(candidate) || "field";
  if (!taken.has(base)) return base;
  for (let suffix = 2; suffix < 100; suffix += 1) {
    const next = `${base.slice(0, leadFieldIDLimit - 3)}_${suffix}`;
    if (!taken.has(next)) return next;
  }
  return `${base.slice(0, leadFieldIDLimit - 6)}_${Date.now().toString(36).slice(-4)}`;
}

export function addLeadFormField(fields: LeadFormField[], label = "Custom field"): LeadFormField[] {
  return [...fields, { id: uniqueLeadFieldID(label, fields), label, type: "text", required: false, options: [], placeholder: "" }];
}

// A relabelled field keeps the identifier it already has. The identifier is the
// key every answer captured so far is stored under, so re-deriving it from the
// new label would orphan every lead the field has already collected.
export function updateLeadFormField(fields: LeadFormField[], index: number, patch: Partial<LeadFormField>): LeadFormField[] {
  return fields.map((field, position) => {
    if (position !== index) return field;
    const updated = { ...field, ...patch };
    if (updated.type !== "select") updated.options = [];
    return updated;
  });
}

export function removeLeadFormField(fields: LeadFormField[], index: number): LeadFormField[] {
  return fields.filter((_, position) => position !== index);
}

export function moveLeadFormField(fields: LeadFormField[], index: number, offset: number): LeadFormField[] {
  const target = index + offset;
  if (index < 0 || index >= fields.length || target < 0 || target >= fields.length) return fields;
  const reordered = [...fields];
  const [moved] = reordered.splice(index, 1);
  reordered.splice(target, 0, moved);
  return reordered;
}

export type StudioPayload = {
  branding: {
    display_name: string;
    tagline: string;
    logo_url: string;
    theme: string;
    primary_color: string;
    accent_color: string;
    position: string;
    launcher_text: string;
    custom_colors: Record<CustomColorKey, string>;
    toggles: ResolvedToggles;
  };
  lead_capture: {
    enabled: boolean;
    prompt: string;
    after_turns: number;
    fields: string[];
    privacy_text: string;
    form_heading: string;
    submit_label: string;
    form_fields: LeadFormField[];
  };
};

// The save body. Two shapes matter here and neither is a style choice.
//
// custom_colors and toggles replace their stored value whole, so all five
// colours and all nine switches go together or the ones left out are reset.
//
// lead_capture is replaced whole too, which is why the prompt, the turn count,
// the legacy field list and the privacy text ride along untouched. The studio
// does not offer an input for them; dropping them from the body would delete
// them from the agent.
export function studioPayloadFromDraft(draft: StudioDraft): StudioPayload {
  return {
    branding: {
      display_name: draft.displayName.trim(),
      tagline: draft.tagline.trim(),
      logo_url: draft.logoUrl.trim(),
      theme: draft.theme,
      primary_color: draft.primaryColor.trim(),
      accent_color: draft.accentColor.trim(),
      position: draft.position,
      launcher_text: draft.launcherText.trim(),
      custom_colors: {
        background: draft.customColors.background.trim(),
        surface: draft.customColors.surface.trim(),
        text: draft.customColors.text.trim(),
        on_primary: draft.customColors.on_primary.trim(),
        on_accent: draft.customColors.on_accent.trim(),
      },
      toggles: { ...draft.toggles },
    },
    lead_capture: {
      enabled: draft.leadCaptureEnabled,
      prompt: draft.carriedLeadPrompt,
      after_turns: draft.carriedAfterTurns,
      fields: [...draft.carriedLegacyFields],
      privacy_text: draft.carriedPrivacyText,
      form_heading: draft.formHeading.trim(),
      submit_label: draft.submitLabel.trim(),
      // Options belong to a select and the server refuses them anywhere else, so
      // a field that was a select and is now a text field sheds them here rather
      // than failing the save the customer is watching.
      form_fields: draft.formFields.map((field) => ({
        id: field.id,
        label: field.label.trim(),
        type: field.type,
        required: Boolean(field.required),
        options: field.type === "select" ? (field.options || []).map((option) => option.trim()).filter(Boolean) : [],
        placeholder: (field.placeholder || "").trim(),
      })),
    },
  };
}

export function hasUnsavedStudioChanges(draft: StudioDraft | null, saved: StudioDraft | null): boolean {
  if (!draft || !saved) return false;
  return JSON.stringify(draft) !== JSON.stringify(saved);
}

// The server reports rejected fields as a field to message map under
// error.details. Anything else is left to the status line, because inventing a
// field for it would point the customer at the wrong input.
export function studioFieldMessages(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError) || error.code !== "validation_failed") return {};
  const details = error.details;
  if (!details || typeof details !== "object" || Array.isArray(details)) return {};
  const messages: Record<string, string> = {};
  for (const [field, message] of Object.entries(details as Record<string, unknown>)) {
    if (typeof message === "string" && message.trim()) messages[field] = message.trim();
  }
  return messages;
}

// A save carries the revision it was based on, so the server refuses one that
// would overwrite an edit made somewhere else. That refusal is not a validation
// failure and cannot be fixed by correcting a field: the only way forward is to
// take the newer record, so the screen has to recognise it and say so.
export function isStaleRevision(error: unknown): boolean {
  return error instanceof ApiError && error.code === "stale_revision";
}

// Every rejected field named in one sentence the customer can read, so a
// contrast pair the studio has no single input for still reaches them.
export function studioMessageSummary(messages: Record<string, string>): Array<{ key: string; label: string; message: string }> {
  return Object.entries(messages).map(([key, message]) => ({ key, label: studioFieldLabels[key] || key, message }));
}

// The checks the studio can make before it submits. They are the server's rules,
// applied early so the customer is told while they are still looking at the row
// that is wrong.
export function leadFormWarnings(fields: LeadFormField[], showLeadForm: boolean): string[] {
  if (!showLeadForm || !fields.length) return [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  let reachable = false;
  for (const field of fields) {
    if (!field.label.trim()) warnings.push("Every field needs a label.");
    if (!field.id) warnings.push("Every field needs an identifier of letters, digits, dashes or underscores.");
    else if (seen.has(field.id)) warnings.push(`Two fields share the identifier "${field.id}". Identifiers must be unique.`);
    seen.add(field.id);
    if (field.type === "select" && (field.options || []).filter((option) => option.trim()).length < 2) {
      warnings.push(`"${field.label.trim() || field.id}" is a dropdown, so it needs at least two options.`);
    }
    if (field.type === "email" || field.type === "telephone") reachable = true;
  }
  if (!reachable) warnings.push("Add an email or phone field, otherwise a submitted form cannot be saved as a lead.");
  return Array.from(new Set(warnings));
}

export function leadFieldTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    text: "Text",
    email: "Email",
    telephone: "Phone",
    number: "Number",
    textarea: "Long text",
    select: "Dropdown",
    checkbox: "Checkbox",
    date: "Date",
  };
  return labels[type] || type;
}

export function positionLabel(position: string): string {
  const labels: Record<string, string> = {
    bottom_right: "Bottom right",
    bottom_left: "Bottom left",
    middle_right: "Middle right",
    middle_left: "Middle left",
    top_right: "Top right",
    top_left: "Top left",
  };
  return labels[position] || position.replace(/_/g, " ");
}

export const toggleDescriptions: Record<WidgetToggleKey, { title: string; description: string }> = {
  transcription: { title: "Transcription", description: "Keep a written transcript of spoken turns" },
  chat: { title: "Chat", description: "Let visitors type to the agent" },
  autostart: { title: "Autostart", description: "Open the conversation as soon as the page loads" },
  mute_on_minimize: { title: "Mute on minimize", description: "Silence audio while the widget is closed" },
  mute_on_tab_change: { title: "Mute on tab change", description: "Silence audio when the visitor leaves the tab" },
  show_lead_form: { title: "Show lead form", description: "Ask for contact details before the conversation" },
  is_glowing: { title: "Glowing launcher", description: "Add a soft glow around the launcher button" },
  is_transparent: { title: "Transparent panel", description: "Let the page show through the widget panel" },
  agent_mute: { title: "Agent mute", description: "Start with the agent's voice muted" },
};
