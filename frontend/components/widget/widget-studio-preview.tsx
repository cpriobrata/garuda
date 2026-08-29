"use client";

// The preview. It paints from the resolved palette rather than from what the
// customer typed, using the same resolution the server performs, so what is
// drawn here is what the widget draws on their website: an empty colour shows
// its resolved default, and a named theme shows the server's palette.

import * as React from "react";
import { MessageCircleMore, Monitor, Smartphone } from "lucide-react";
import { cn } from "@/lib/utils";
import { resolveDraftColors, type StudioDraft, type ThemePreset } from "@/components/widget/widget-studio-state";

const panelAnchors: Record<string, string> = {
  bottom_right: "bottom-4 right-4 items-end",
  bottom_left: "bottom-4 left-4 items-start",
  middle_right: "right-4 top-1/2 -translate-y-1/2 items-end",
  middle_left: "left-4 top-1/2 -translate-y-1/2 items-start",
  top_right: "right-4 top-4 items-end",
  top_left: "left-4 top-4 items-start",
};

function LeadFormPreview({ draft, colors }: { draft: StudioDraft; colors: ReturnType<typeof resolveDraftColors> }) {
  return (
    <div className="space-y-2">
      <p className="text-[10px] font-semibold" style={{ color: colors.text }}>{draft.formHeading.trim() || "Share your contact details"}</p>
      {draft.formFields.slice(0, 4).map((field, index) => (
        <div key={`${field.id}-${index}`}>
          <p className="text-[8px] font-medium" style={{ color: colors.text, opacity: 0.75 }}>
            {field.label.trim() || field.id || "Untitled field"}{field.required ? " *" : ""}
          </p>
          <div
            className={cn("mt-1 rounded-md border text-[8px]", field.type === "textarea" ? "h-8" : "h-5")}
            style={{ backgroundColor: colors.background, borderColor: `${colors.text}22` }}
          />
        </div>
      ))}
      {draft.formFields.length > 4 ? <p className="text-[8px]" style={{ color: colors.text, opacity: 0.6 }}>+{draft.formFields.length - 4} more</p> : null}
      <div className="mt-1 rounded-md py-1.5 text-center text-[9px] font-semibold" style={{ backgroundColor: colors.accent, color: colors.on_accent }}>
        {draft.submitLabel.trim() || "Submit"}
      </div>
    </div>
  );
}

export function WidgetStudioPreview({ draft, presets, agentName }: { draft: StudioDraft; presets: ThemePreset[]; agentName: string }) {
  const [device, setDevice] = React.useState("desktop");
  const [logoBroken, setLogoBroken] = React.useState(false);
  const colors = resolveDraftColors(draft, presets);
  const displayName = draft.displayName.trim() || agentName || "Website assistant";
  const logo = draft.logoUrl.trim();
  const anchor = panelAnchors[draft.position] || panelAnchors.bottom_right;
  const alignRight = draft.position.endsWith("_right");

  return (
    <div className="relative min-h-[620px] overflow-hidden bg-[#eef1f7] p-5 sm:p-6">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-xs font-semibold text-slate-600">Live preview</p>
        <div className="flex rounded-lg border bg-white p-0.5">
          <button type="button" aria-label="Desktop preview" onClick={() => setDevice("desktop")} className={cn("grid h-7 w-8 place-items-center rounded-md", device === "desktop" && "bg-slate-100 text-slate-900")}><Monitor className="h-3.5 w-3.5" /></button>
          <button type="button" aria-label="Mobile preview" onClick={() => setDevice("mobile")} className={cn("grid h-7 w-8 place-items-center rounded-md", device === "mobile" && "bg-slate-100 text-slate-900")}><Smartphone className="h-3.5 w-3.5" /></button>
        </div>
      </div>
      <div className={cn("relative mx-auto h-[540px] overflow-hidden border bg-white shadow-soft transition-all", device === "mobile" ? "max-w-[300px] rounded-[28px] border-[5px] border-slate-800" : "w-full rounded-xl")}>
        <div className="h-12 border-b bg-white px-4"><div className="flex h-full items-center gap-3"><div className="h-3 w-3 rounded-full bg-slate-200" /><div className="h-2 w-20 rounded bg-slate-100" /><div className="ml-auto h-6 w-14 rounded-md bg-slate-100" /></div></div>
        <div className="p-5"><div className="h-4 w-36 rounded bg-slate-100" /><div className="mt-3 h-2 w-[80%] rounded bg-slate-100" /><div className="mt-2 h-2 w-[64%] rounded bg-slate-100" /><div className="mt-8 grid grid-cols-2 gap-3"><div className="h-24 rounded-xl bg-slate-50" /><div className="h-24 rounded-xl bg-slate-50" /></div></div>

        <div className={cn("absolute flex flex-col gap-2.5", anchor)}>
          <div
            className={cn("w-[228px] overflow-hidden rounded-2xl border shadow-[0_20px_60px_rgba(15,23,42,.18)]", draft.toggles.is_transparent && "backdrop-blur")}
            style={{ backgroundColor: draft.toggles.is_transparent ? `${colors.background}D9` : colors.background, borderColor: `${colors.text}1A` }}
          >
            <div className="flex items-center gap-2 px-3 py-2.5" style={{ backgroundColor: colors.primary, color: colors.on_primary }}>
              <span className="grid h-7 w-7 shrink-0 place-items-center overflow-hidden rounded-full bg-white/20 text-[10px] font-bold">
                {logo && !logoBroken ? (
                  // A customer-supplied logo on any CDN, so it cannot go through
                  // next/image, which needs each host allowlisted first.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logo} alt="" className="h-full w-full object-cover" onError={() => setLogoBroken(true)} onLoad={() => setLogoBroken(false)} />
                ) : displayName.slice(0, 1).toUpperCase()}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[11px] font-semibold leading-4">{displayName}</span>
                {draft.tagline.trim() ? <span className="block truncate text-[9px] leading-3 opacity-80">{draft.tagline.trim()}</span> : null}
              </span>
            </div>
            <div className="space-y-2 p-3" style={{ backgroundColor: colors.background }}>
              {draft.toggles.show_lead_form ? (
                <LeadFormPreview draft={draft} colors={colors} />
              ) : (
                <>
                  <div className="max-w-[85%] rounded-xl rounded-bl-sm px-2.5 py-1.5 text-[9px] leading-4" style={{ backgroundColor: colors.surface, color: colors.text }}>
                    {draft.toggles.autostart ? "Hi! I opened automatically. How can I help?" : "Hi! What can I help you with today?"}
                  </div>
                  <div className="ml-auto max-w-[70%] rounded-xl rounded-br-sm px-2.5 py-1.5 text-[9px]" style={{ backgroundColor: colors.accent, color: colors.on_accent }}>
                    Do you integrate with our stack?
                  </div>
                </>
              )}
              {draft.toggles.chat ? (
                <div className="mt-1 flex items-center gap-2 rounded-lg border px-2 py-1.5 text-[9px]" style={{ backgroundColor: colors.surface, borderColor: `${colors.text}1A`, color: `${colors.text}` }}>
                  <span className="opacity-60">Type a message…</span>
                  <span className="ml-auto grid h-4 w-4 place-items-center rounded" style={{ backgroundColor: colors.accent, color: colors.on_accent }}>↑</span>
                </div>
              ) : (
                <p className="text-center text-[8px]" style={{ color: colors.text, opacity: 0.6 }}>Typing is switched off for this widget</p>
              )}
            </div>
          </div>
          <div className={cn("flex items-center gap-2", alignRight && "flex-row-reverse")}>
            <span
              className={cn("grid h-11 w-11 place-items-center rounded-full shadow-lg", draft.toggles.is_glowing && "ring-4 ring-offset-0")}
              style={{ backgroundColor: colors.primary, color: colors.on_primary, boxShadow: draft.toggles.is_glowing ? `0 0 0 6px ${colors.accent}33, 0 12px 28px ${colors.primary}55` : undefined }}
            >
              <MessageCircleMore className="h-5 w-5" />
            </span>
            {draft.launcherText.trim() ? (
              <span className="rounded-full border bg-white px-2.5 py-1 text-[9px] font-semibold text-slate-700 shadow-sm">{draft.launcherText.trim()}</span>
            ) : null}
          </div>
        </div>
      </div>
      <p className="mt-3 text-center text-[10px] text-slate-500">
        Preview only. Publish the agent for these settings to reach the widget on your website.
      </p>
    </div>
  );
}
