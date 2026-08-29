"use client";

// The studio's first five sections. Each one takes the draft and a change
// handler rather than reaching for shared state, so a section can be rendered,
// read and tested on its own.

import * as React from "react";
import { AlertTriangle, ImageOff, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { ColorField, FieldMessage, SectionCard, SelectableCard, SwitchRow } from "@/components/widget/widget-studio-controls";
import {
  contrastReport,
  customColorKeys,
  customThemeID,
  defaultAccentColor,
  defaultPrimaryColor,
  positionLabel,
  resolveDraftColors,
  toggleDescriptions,
  widgetToggleKeys,
  type CustomColorKey,
  type StudioDraft,
  type ThemeColors,
  type ThemePreset,
  type WidgetToggleKey,
} from "@/components/widget/widget-studio-state";

type DraftChange = (update: (draft: StudioDraft) => StudioDraft) => void;
type Messages = Record<string, string>;

export function IdentitySection({ draft, agentName, messages, onChange }: { draft: StudioDraft; agentName: string; messages: Messages; onChange: DraftChange }) {
  return (
    <SectionCard step={1} title="Bot identity" description="The name and one-line tagline the widget header shows a visitor.">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="widget-display-name">Bot display name</Label>
            <span className={cn("text-[10px]", draft.displayName.length > 60 ? "font-semibold text-red-500" : "text-slate-400")}>{draft.displayName.length}/60</span>
          </div>
          <Input
            id="widget-display-name"
            value={draft.displayName}
            placeholder={agentName || "Website assistant"}
            onChange={(event) => onChange((current) => ({ ...current, displayName: event.target.value }))}
          />
          <p className="text-[10px] text-slate-400">Leave this empty to keep using the agent&rsquo;s own name.</p>
          <FieldMessage message={messages["branding.display_name"]} />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="widget-tagline">Tagline</Label>
            <span className={cn("text-[10px]", draft.tagline.length > 140 ? "font-semibold text-red-500" : "text-slate-400")}>{draft.tagline.length}/140</span>
          </div>
          <Input
            id="widget-tagline"
            value={draft.tagline}
            placeholder="Answers in seconds"
            onChange={(event) => onChange((current) => ({ ...current, tagline: event.target.value }))}
          />
          <p className="text-[10px] text-slate-400">Sits under the name in the widget header.</p>
          <FieldMessage message={messages["branding.tagline"]} />
        </div>
      </div>
    </SectionCard>
  );
}

function ThemeSwatches({ colors }: { colors: ThemeColors | null }) {
  if (!colors) {
    return (
      <div className="mb-2.5 flex h-7 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-[9px] font-medium text-slate-500">
        Your own colors
      </div>
    );
  }
  return (
    <div className="mb-2.5 flex h-7 overflow-hidden rounded-lg border">
      <span className="flex-1" style={{ backgroundColor: colors.primary }} />
      <span className="flex-1" style={{ backgroundColor: colors.accent }} />
      <span className="flex-1" style={{ backgroundColor: colors.surface }} />
      <span className="grid w-8 place-items-center text-[9px] font-bold" style={{ backgroundColor: colors.background, color: colors.text }}>Aa</span>
    </div>
  );
}

// The theme picker. Every label, description and palette on this screen comes
// from theme_presets on the agent response, so a preset retuned on the server
// shows up here without a web deploy and can never disagree with the widget.
export function ThemeSection({ draft, presets, minimums, messages, onChange }: { draft: StudioDraft; presets: ThemePreset[]; minimums: Record<string, number>; messages: Messages; onChange: DraftChange }) {
  const isCustom = draft.theme === customThemeID;
  const resolved = resolveDraftColors(draft, presets);
  const customHints: Record<CustomColorKey, string> = {
    background: "The widget panel behind the conversation",
    surface: "Message bubbles and input rows",
    text: "Every line of body text",
    on_primary: "Chosen automatically when left empty",
    on_accent: "Chosen automatically when left empty",
  };
  const customLabels: Record<CustomColorKey, string> = {
    background: "Background",
    surface: "Message bubble",
    text: "Text",
    on_primary: "Text on primary",
    on_accent: "Text on accent",
  };
  return (
    <SectionCard step={2} title="Theme" description="Pick a colour scheme, or choose Custom to set each colour yourself.">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {presets.map((preset) => (
          <SelectableCard
            key={preset.id}
            selected={draft.theme === preset.id}
            onSelect={() => onChange((current) => ({ ...current, theme: preset.id }))}
            title={preset.label}
            description={preset.description}
            ariaLabel={`${preset.label} theme`}
          >
            <ThemeSwatches colors={preset.colors} />
          </SelectableCard>
        ))}
      </div>
      <FieldMessage message={messages["branding.theme"]} />
      {isCustom ? (
        <div className="mt-5 rounded-xl border bg-slate-50/70 p-4">
          <p className="text-[11px] font-semibold text-slate-800">Custom colors</p>
          <p className="mt-1 text-[10px] text-slate-500">Primary paints the header and launcher; accent paints the send button and highlights.</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <ColorField
              id="widget-primary-color"
              label="Primary"
              value={draft.primaryColor}
              resolved={resolved.primary || defaultPrimaryColor}
              hint="Header and launcher fill"
              onChange={(value) => onChange((current) => ({ ...current, primaryColor: value }))}
              message={messages["branding.colors"]}
            />
            <ColorField
              id="widget-accent-color"
              label="Accent"
              value={draft.accentColor}
              resolved={resolved.accent || defaultAccentColor}
              hint="Send button and highlights"
              onChange={(value) => onChange((current) => ({ ...current, accentColor: value }))}
            />
            {customColorKeys.map((key) => (
              <ColorField
                key={key}
                id={`widget-color-${key}`}
                label={customLabels[key]}
                value={draft.customColors[key]}
                resolved={resolved[key]}
                hint={customHints[key]}
                onChange={(value) => onChange((current) => ({ ...current, customColors: { ...current.customColors, [key]: value } }))}
                onClear={() => onChange((current) => ({ ...current, customColors: { ...current.customColors, [key]: "" } }))}
                message={messages[`branding.custom_colors.${key}`]}
              />
            ))}
          </div>
        </div>
      ) : null}
      <ContrastNotice draft={draft} presets={presets} minimums={minimums} messages={messages} />
    </SectionCard>
  );
}

// Readability is checked here with the same maths and the same floors the server
// enforces, so the customer is warned while they are still looking at the colour
// rather than after a rejected save. The server stays the authority: its message
// replaces this one the moment it disagrees.
export function ContrastNotice({ draft, presets, minimums, messages }: { draft: StudioDraft; presets: ThemePreset[]; minimums: Record<string, number>; messages: Messages }) {
  const pairs = contrastReport(resolveDraftColors(draft, presets), minimums);
  const failing = pairs.filter((pair) => !pair.passes);
  const rejected = pairs.filter((pair) => messages[pair.key]);
  if (!failing.length && !rejected.length) return null;
  return (
    <div className="mt-4 space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-800"><AlertTriangle className="h-3.5 w-3.5" /> Some text would be hard to read</p>
      {(rejected.length ? rejected : failing).map((pair) => (
        <p key={pair.key} className="text-[10px] leading-4 text-amber-700">
          <span className="font-semibold">{pair.label}:</span>{" "}
          {messages[pair.key] || `${pair.foreground} on ${pair.background} has a contrast ratio of ${pair.ratio.toFixed(2)}:1, below the ${pair.minimum.toFixed(1)}:1 minimum`}
        </p>
      ))}
      <p className="text-[10px] text-amber-700">Garuda refuses to publish colours a visitor could not read.</p>
    </div>
  );
}

export function LogoSection({ draft, messages, onChange }: { draft: StudioDraft; messages: Messages; onChange: DraftChange }) {
  const [broken, setBroken] = React.useState(false);
  const monogram = (draft.displayName.trim() || "A").slice(0, 1).toUpperCase();
  const showImage = Boolean(draft.logoUrl.trim()) && !broken;
  return (
    <SectionCard step={3} title="Chat logo" description="An HTTPS image URL for the widget header. The monogram is used whenever there is no logo.">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="flex flex-col items-center gap-1.5">
          <div className="grid h-16 w-16 place-items-center overflow-hidden rounded-2xl border bg-slate-50">
            {showImage ? (
              // A customer-supplied URL on any CDN, so the image cannot go
              // through next/image, which needs each host allowlisted first.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={draft.logoUrl.trim()} alt="Chat logo preview" className="h-full w-full object-contain" onError={() => setBroken(true)} onLoad={() => setBroken(false)} />
            ) : (
              <span className="text-lg font-bold text-slate-500">{monogram}</span>
            )}
          </div>
          <span className="text-[9px] text-slate-400">{showImage ? "Logo" : "Monogram"}</span>
        </div>
        <div className="flex-1 space-y-2">
          <Label htmlFor="widget-logo-url">Logo image URL</Label>
          <div className="flex gap-2">
            <Input
              id="widget-logo-url"
              value={draft.logoUrl}
              placeholder="https://cdn.example.com/logo.png"
              onChange={(event) => { setBroken(false); onChange((current) => ({ ...current, logoUrl: event.target.value })); }}
            />
            <button
              type="button"
              onClick={() => { setBroken(false); onChange((current) => ({ ...current, logoUrl: "" })); }}
              disabled={!draft.logoUrl}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border text-slate-500 transition-colors hover:bg-slate-50 disabled:opacity-40"
              aria-label="Remove the chat logo"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
          <p className="text-[10px] text-slate-400">Must be an absolute HTTPS URL. There is no upload here yet, so host the file yourself.</p>
          {broken && draft.logoUrl.trim() ? (
            <p className="flex items-center gap-1.5 text-[10px] font-medium text-amber-600"><ImageOff className="h-3 w-3" /> That image could not be loaded. The monogram will be shown instead.</p>
          ) : null}
          <FieldMessage message={messages["branding.logo_url"]} />
        </div>
      </div>
    </SectionCard>
  );
}

const positionDotClasses: Record<string, string> = {
  bottom_right: "bottom-1.5 right-1.5",
  bottom_left: "bottom-1.5 left-1.5",
  middle_right: "right-1.5 top-1/2 -translate-y-1/2",
  middle_left: "left-1.5 top-1/2 -translate-y-1/2",
  top_right: "right-1.5 top-1.5",
  top_left: "left-1.5 top-1.5",
};

// Six placements drawn as the page they land on, because "middle left" reads as
// a location and not as a word in a dropdown.
export function PositionSection({ draft, positions, messages, onChange }: { draft: StudioDraft; positions: string[]; messages: Messages; onChange: DraftChange }) {
  return (
    <SectionCard step={4} title="Widget position" description="Where the launcher sits on the visitor's page.">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {positions.map((position) => {
          const selected = draft.position === position;
          return (
            <button
              key={position}
              type="button"
              onClick={() => onChange((current) => ({ ...current, position }))}
              aria-pressed={selected}
              aria-label={positionLabel(position)}
              className={cn(
                "rounded-xl border p-2.5 text-left transition-all hover:border-indigo-200",
                selected ? "border-indigo-400 bg-indigo-50/60 ring-2 ring-indigo-200" : "border-slate-200 bg-white",
              )}
            >
              <span className="relative block h-14 w-full overflow-hidden rounded-lg border bg-slate-50">
                <span className="absolute left-1.5 right-1.5 top-1.5 block h-1 rounded bg-slate-200" />
                <span className="absolute left-1.5 top-4 block h-1 w-8 rounded bg-slate-200" />
                <span className={cn("absolute h-3.5 w-3.5 rounded-full", positionDotClasses[position] || positionDotClasses.bottom_right, selected ? "bg-indigo-600" : "bg-slate-400")} />
              </span>
              <span className={cn("mt-2 block text-[10px] font-semibold", selected ? "text-indigo-900" : "text-slate-700")}>{positionLabel(position)}</span>
            </button>
          );
        })}
      </div>
      <FieldMessage message={messages["branding.position"]} />
      <LauncherTextField draft={draft} onChange={onChange} />
    </SectionCard>
  );
}

// The nine switches. Autostart and the lead form cannot both be on: the studio
// clears the other the moment one is enabled, and says so on both rows, because
// a customer who is not told will read the change as the screen losing their
// click.
export function TogglesSection({ draft, messages, onToggle }: { draft: StudioDraft; messages: Messages; onToggle: (key: WidgetToggleKey, value: boolean) => void }) {
  return (
    <SectionCard step={5} title="Toggle options" description="Every switch applies to this agent's widget the next time it loads.">
      <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
        {widgetToggleKeys.map((key) => {
          const exclusive = key === "autostart" || key === "show_lead_form";
          const partner = key === "autostart" ? "show_lead_form" : "autostart";
          return (
            <SwitchRow
              key={key}
              title={toggleDescriptions[key].title}
              description={toggleDescriptions[key].description}
              checked={draft.toggles[key]}
              onCheckedChange={(value) => onToggle(key, value)}
              note={exclusive ? (draft.toggles[key] ? `${toggleDescriptions[partner].title} is off while this is on` : `Turning this on turns off ${toggleDescriptions[partner].title}`) : undefined}
            />
          );
        })}
      </div>
      <p className="mt-3 text-[10px] text-slate-500">Autostart and Show lead form are mutually exclusive: one opens the conversation immediately, the other gates it behind a form.</p>
      <FieldMessage message={messages["branding.toggles"]} />
    </SectionCard>
  );
}

// The launcher label lives beside the placement because they are the same
// decision: what the visitor sees before they open anything.
export function LauncherTextField({ draft, onChange }: { draft: StudioDraft; onChange: DraftChange }) {
  return (
    <div className="mt-4 space-y-2">
      <Label htmlFor="widget-launcher-text">Launcher label</Label>
      <Input
        id="widget-launcher-text"
        value={draft.launcherText}
        placeholder="Ask us"
        onChange={(event) => onChange((current) => ({ ...current, launcherText: event.target.value }))}
      />
      <p className="text-[10px] text-slate-400">Shown beside the launcher button. Leave empty for the icon on its own.</p>
    </div>
  );
}
