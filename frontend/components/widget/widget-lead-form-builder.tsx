"use client";

// The lead form builder: what the widget draws when the lead form is switched
// on, and what a submitted form turns into on the lead record.
//
// A field's identifier is the key its answers are stored under, so it is shown
// rather than hidden, and it never changes when the label does. Relabelling
// "Email" to "Work email" must not orphan every address collected so far.

import * as React from "react";
import { AlertTriangle, ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { FieldMessage, SectionCard, SwitchRow } from "@/components/widget/widget-studio-controls";
import {
  addLeadFormField,
  leadFieldTypeLabel,
  leadFormWarnings,
  moveLeadFormField,
  removeLeadFormField,
  updateLeadFormField,
  type LeadFormField,
  type StudioDraft,
} from "@/components/widget/widget-studio-state";

type DraftChange = (update: (draft: StudioDraft) => StudioDraft) => void;

function OptionsEditor({ field, index, onChange }: { field: LeadFormField; index: number; onChange: DraftChange }) {
  const [draftOption, setDraftOption] = React.useState("");
  const options = field.options || [];

  function commitOption() {
    const value = draftOption.trim();
    if (!value) return;
    setDraftOption("");
    onChange((current) => ({ ...current, formFields: updateLeadFormField(current.formFields, index, { options: [...options, value] }) }));
  }

  return (
    <div className="mt-3 rounded-lg border bg-white p-3">
      <p className="text-[10px] font-semibold text-slate-700">Dropdown options</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {options.map((option, optionIndex) => (
          <span key={`${option}-${optionIndex}`} className="inline-flex items-center gap-1 rounded-full border bg-slate-50 px-2 py-0.5 text-[10px] text-slate-700">
            {option}
            <button
              type="button"
              aria-label={`Remove option ${option}`}
              onClick={() => onChange((current) => ({ ...current, formFields: updateLeadFormField(current.formFields, index, { options: options.filter((_, position) => position !== optionIndex) }) }))}
              className="text-slate-400 hover:text-red-500"
            >
              ×
            </button>
          </span>
        ))}
        {options.length ? null : <span className="text-[10px] text-slate-400">No options yet. A dropdown needs at least two.</span>}
      </div>
      <div className="mt-2 flex gap-2">
        <Input
          value={draftOption}
          placeholder="Add an option"
          aria-label={`Add an option to ${field.label || field.id}`}
          className="h-9 text-xs"
          onChange={(event) => setDraftOption(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commitOption(); } }}
        />
        <button type="button" onClick={commitOption} disabled={!draftOption.trim()} className="h-9 shrink-0 rounded-lg border px-3 text-[11px] font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-40">
          Add
        </button>
      </div>
    </div>
  );
}

function LeadFieldRow({ field, index, total, fieldTypes, reservedIDs, messages, onChange }: {
  field: LeadFormField;
  index: number;
  total: number;
  fieldTypes: string[];
  reservedIDs: string[];
  messages: Record<string, string>;
  onChange: DraftChange;
}) {
  const prefix = `lead_capture.form_fields.${index}`;
  const reserved = reservedIDs.includes(field.id);
  return (
    <div className="rounded-xl border bg-slate-50/60 p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor={`lead-field-label-${index}`} className="text-[10px] text-slate-500">Label</Label>
          <Input
            id={`lead-field-label-${index}`}
            value={field.label}
            placeholder="Full name"
            className="h-9 bg-white text-xs"
            onChange={(event) => onChange((current) => ({ ...current, formFields: updateLeadFormField(current.formFields, index, { label: event.target.value }) }))}
          />
          <FieldMessage message={messages[`${prefix}.label`]} />
        </div>
        <div className="w-full space-y-1.5 sm:w-40">
          <Label htmlFor={`lead-field-type-${index}`} className="text-[10px] text-slate-500">Type</Label>
          <select
            id={`lead-field-type-${index}`}
            value={field.type}
            onChange={(event) => onChange((current) => ({ ...current, formFields: updateLeadFormField(current.formFields, index, { type: event.target.value }) }))}
            className="h-9 w-full rounded-lg border bg-white px-2 text-xs"
          >
            {fieldTypes.map((type) => <option key={type} value={type}>{leadFieldTypeLabel(type)}</option>)}
          </select>
          <FieldMessage message={messages[`${prefix}.type`]} />
        </div>
        <div className="flex items-center gap-4 sm:pt-6">
          <label className="flex items-center gap-2 text-[10px] font-medium text-slate-600">
            <Switch
              checked={Boolean(field.required)}
              aria-label={`${field.label || field.id} is required`}
              onCheckedChange={(value) => onChange((current) => ({ ...current, formFields: updateLeadFormField(current.formFields, index, { required: value }) }))}
            />
            Required
          </label>
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label={`Move ${field.label || field.id} up`}
              disabled={index === 0}
              onClick={() => onChange((current) => ({ ...current, formFields: moveLeadFormField(current.formFields, index, -1) }))}
              className="grid h-8 w-8 place-items-center rounded-lg border bg-white text-slate-500 transition-colors hover:bg-slate-50 disabled:opacity-30"
            >
              <ArrowUp className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              aria-label={`Move ${field.label || field.id} down`}
              disabled={index === total - 1}
              onClick={() => onChange((current) => ({ ...current, formFields: moveLeadFormField(current.formFields, index, 1) }))}
              className="grid h-8 w-8 place-items-center rounded-lg border bg-white text-slate-500 transition-colors hover:bg-slate-50 disabled:opacity-30"
            >
              <ArrowDown className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              aria-label={`Remove ${field.label || field.id}`}
              onClick={() => onChange((current) => ({ ...current, formFields: removeLeadFormField(current.formFields, index) }))}
              className="grid h-8 w-8 place-items-center rounded-lg border bg-white text-slate-500 transition-colors hover:bg-red-50 hover:text-red-500"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[9px] text-slate-500">{field.id || "no identifier"}</span>
        {reserved ? <Badge variant="secondary" className="text-[9px]">Saved on the lead record</Badge> : <span className="text-[9px] text-slate-400">Saved as a custom answer</span>}
      </div>
      <FieldMessage message={messages[`${prefix}.id`]} />
      {field.type === "select" ? <OptionsEditor field={field} index={index} onChange={onChange} /> : null}
      <FieldMessage message={messages[`${prefix}.options`]} />
      <FieldMessage message={messages[`${prefix}.placeholder`]} />
    </div>
  );
}

export function LeadFormBuilder({ draft, fieldTypes, reservedIDs, messages, onChange }: {
  draft: StudioDraft;
  fieldTypes: string[];
  reservedIDs: string[];
  messages: Record<string, string>;
  onChange: DraftChange;
}) {
  const warnings = leadFormWarnings(draft.formFields, draft.toggles.show_lead_form);
  return (
    <SectionCard
      step={6}
      title="Lead form"
      description="What the widget asks for before the conversation starts, and what lands on the lead."
      action={<Badge variant={draft.toggles.show_lead_form ? "success" : "secondary"}>{draft.toggles.show_lead_form ? "Shown to visitors" : "Hidden"}</Badge>}
    >
      {draft.toggles.show_lead_form ? (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="lead-form-heading">Form heading</Label>
                <span className={cn("text-[10px]", draft.formHeading.length > 120 ? "font-semibold text-red-500" : "text-slate-400")}>{draft.formHeading.length}/120</span>
              </div>
              <Input
                id="lead-form-heading"
                value={draft.formHeading}
                placeholder="Share your contact details"
                onChange={(event) => onChange((current) => ({ ...current, formHeading: event.target.value }))}
              />
              <FieldMessage message={messages["lead_capture.form_heading"]} />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="lead-form-submit">Submit button text</Label>
                <span className={cn("text-[10px]", draft.submitLabel.length > 40 ? "font-semibold text-red-500" : "text-slate-400")}>{draft.submitLabel.length}/40</span>
              </div>
              <Input
                id="lead-form-submit"
                value={draft.submitLabel}
                placeholder="Submit"
                onChange={(event) => onChange((current) => ({ ...current, submitLabel: event.target.value }))}
              />
              <FieldMessage message={messages["lead_capture.submit_label"]} />
            </div>
          </div>

          <SwitchRow
            title="Save submissions as leads"
            description="Store what a visitor submits on the lead record and in the leads table"
            checked={draft.leadCaptureEnabled}
            onCheckedChange={(value) => onChange((current) => ({ ...current, leadCaptureEnabled: value }))}
            note={draft.leadCaptureEnabled ? undefined : "The form is shown but nothing submitted is kept"}
          />

          <div className="space-y-2.5">
            {draft.formFields.map((field, index) => (
              <LeadFieldRow
                key={`${field.id}-${index}`}
                field={field}
                index={index}
                total={draft.formFields.length}
                fieldTypes={fieldTypes}
                reservedIDs={reservedIDs}
                messages={messages}
                onChange={onChange}
              />
            ))}
            {draft.formFields.length ? null : <p className="rounded-xl border border-dashed p-4 text-center text-[11px] text-slate-500">No fields yet. Add at least one email or phone field so a submission can be saved.</p>}
          </div>

          <button
            type="button"
            onClick={() => onChange((current) => ({ ...current, formFields: addLeadFormField(current.formFields) }))}
            disabled={draft.formFields.length >= 20}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed py-2.5 text-[11px] font-semibold text-slate-600 transition-colors hover:border-indigo-300 hover:bg-indigo-50/40 hover:text-indigo-700 disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" /> Add custom field
          </button>

          <FieldMessage message={messages["lead_capture.form_fields"]} />
          {warnings.length ? (
            <div className="space-y-1.5 rounded-xl border border-amber-200 bg-amber-50 p-3">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-800"><AlertTriangle className="h-3.5 w-3.5" /> This form cannot be saved yet</p>
              {warnings.map((warning) => <p key={warning} className="text-[10px] leading-4 text-amber-700">{warning}</p>)}
            </div>
          ) : null}
        </div>
      ) : (
        <p className="rounded-xl border border-dashed bg-slate-50 p-4 text-center text-[11px] leading-5 text-slate-500">
          Turn on <span className="font-semibold text-slate-700">Show lead form</span> above to ask visitors for their details before the conversation starts.
        </p>
      )}
    </SectionCard>
  );
}
