"use client";

import { useState } from "react";
import { AlertCircle, Check, Download, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, apiRequest, currentAccessToken } from "@/lib/api";

// The workflow vocabulary the API validates against. Sending anything else is
// answered with 422, so the export filter and the form both pick from this list.
export const leadStatuses = ["new", "qualified", "contacted", "converted", "disqualified"] as const;
type LeadStatus = (typeof leadStatuses)[number];

const emptyLead = { name: "", email: "", phone: "", company: "", status: "new" as LeadStatus, notes: "" };

// apiRequest decodes a JSON envelope, so it cannot carry a text/csv download.
// The export is fetched directly instead, against the same base URL and with the
// same bearer token lib/api.ts stores after sign-in.
function apiBaseUrl() {
  const configured = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "";
  return configured.endsWith("/v1") ? configured : `${configured}/v1`;
}

// filenameFromDisposition reads the server's suggested name. The header arrives
// over the network, so a value that is not a plain CSV file name -- a path, a
// traversal, a second extension -- is dropped rather than handed to the browser
// as a download target.
export function filenameFromDisposition(header: string | null) {
  const candidate = header?.match(/filename="([^"]*)"/)?.[1] || "";
  return /^[A-Za-z0-9._-]+\.csv$/.test(candidate) ? candidate : "";
}

// LeadActions holds the two workspace-level lead controls: download the table as
// a spreadsheet, and add somebody by hand. onLeadAdded lets the page refresh the
// table and the counters once a manual lead really has been stored.
export function LeadActions({ connected, onLeadAdded }: { connected: boolean; onLeadAdded: () => void }) {
  const [exportStatus, setExportStatus] = useState<"" | LeadStatus>("");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [exportedName, setExportedName] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState(emptyLead);
  const [saving, setSaving] = useState(false);
  const [addError, setAddError] = useState("");
  const [addedName, setAddedName] = useState("");

  async function exportLeads() {
    if (exporting) return;
    setExporting(true);
    setExportError("");
    setExportedName("");
    let objectUrl = "";
    try {
      const query = exportStatus ? `?status=${encodeURIComponent(exportStatus)}` : "";
      const token = currentAccessToken();
      const response = await fetch(`${apiBaseUrl()}/leads/export${query}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) {
        const envelope = await response.json().catch(() => null);
        throw new Error(envelope?.error?.message || (response.status === 401 ? "Your session has expired. Sign in again to export." : `The export failed (${response.status}).`));
      }
      const name = filenameFromDisposition(response.headers.get("Content-Disposition")) || "garuda-leads.csv";
      objectUrl = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = name;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setExportedName(name);
    } catch (reason) {
      setExportError(reason instanceof Error ? reason.message : "The export could not be downloaded.");
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setExporting(false);
    }
  }

  async function addLead(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setAddError("");
    // The server enforces this too; saying it here saves a round trip and points
    // at the field rather than at the form.
    if (!form.email.trim() && !form.phone.trim()) {
      setAddError("Enter an email address or a phone number.");
      return;
    }
    setSaving(true);
    try {
      const created = await apiRequest<{ id: string; name?: string; email?: string }>("/leads", {
        method: "POST",
        body: JSON.stringify({
          name: form.name.trim(),
          email: form.email.trim(),
          phone: form.phone.trim(),
          company: form.company.trim(),
          status: form.status,
          notes: form.notes.trim(),
        }),
      });
      setAddedName(created.name?.trim() || created.email?.trim() || "The lead");
      setForm(emptyLead);
      setAddOpen(false);
      onLeadAdded();
    } catch (reason) {
      setAddError(reason instanceof ApiError ? reason.message : "The lead could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return <div className="flex flex-col items-stretch gap-2 sm:items-end">
    <div className="flex flex-wrap gap-2">
      <label className="sr-only" htmlFor="export-status">Export scope</label>
      <select
        id="export-status"
        value={exportStatus}
        disabled={!connected || exporting}
        onChange={(event) => setExportStatus(event.target.value as "" | LeadStatus)}
        className="h-10 rounded-lg border border-input bg-background px-3 text-xs font-medium text-slate-700 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <option value="">All statuses</option>
        {leadStatuses.map((status) => <option key={status} value={status}>{status[0].toUpperCase() + status.slice(1)} only</option>)}
      </select>
      <Button variant="outline" onClick={exportLeads} disabled={!connected || exporting}>{exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}{exporting ? "Preparing CSV…" : "Export CSV"}</Button>
      <Button onClick={() => { setAddError(""); setAddOpen(true); }} disabled={!connected}><Plus className="mr-2 h-4 w-4" /> Manual add</Button>
    </div>
    {!connected && <p className="text-[10px] text-slate-400">Connect the Garuda API to export or add leads.</p>}
    {exportError && <p className="flex items-center gap-1.5 text-[10px] font-medium text-rose-600"><AlertCircle className="h-3 w-3" /> {exportError}</p>}
    {exportedName && !exportError && <p className="flex items-center gap-1.5 text-[10px] font-medium text-emerald-600"><Check className="h-3 w-3" /> Downloaded {exportedName}</p>}
    {addedName && <p className="flex items-center gap-1.5 text-[10px] font-medium text-emerald-600"><Check className="h-3 w-3" /> {addedName} was added as a manual lead</p>}

    <Dialog open={addOpen} onOpenChange={(open) => { if (!saving) { setAddOpen(open); if (!open) setAddError(""); } }}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add a lead by hand</DialogTitle>
          <DialogDescription>Stored with the source &ldquo;manual&rdquo; so it is never counted as a consented widget capture. Record consent separately before contacting this person.</DialogDescription>
        </DialogHeader>
        <form onSubmit={addLead} className="space-y-4 text-left">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" id="lead-name"><Input id="lead-name" value={form.name} maxLength={160} disabled={saving} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Dara Okafor" /></Field>
            <Field label="Company" id="lead-company"><Input id="lead-company" value={form.company} maxLength={160} disabled={saving} onChange={(event) => setForm({ ...form, company: event.target.value })} placeholder="Northwind" /></Field>
            <Field label="Email" id="lead-email"><Input id="lead-email" type="email" value={form.email} maxLength={254} disabled={saving} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="dara@example.com" /></Field>
            <Field label="Phone" id="lead-phone"><Input id="lead-phone" type="tel" value={form.phone} maxLength={20} disabled={saving} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="+1 555 010 1234" /></Field>
          </div>
          <p className="text-[10px] text-slate-500">An email address or a phone number is required — the same rule the widget applies.</p>
          <Field label="Status" id="lead-status">
            <select
              id="lead-status"
              value={form.status}
              disabled={saving}
              onChange={(event) => setForm({ ...form, status: event.target.value as LeadStatus })}
              className="flex h-11 w-full rounded-lg border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {leadStatuses.map((status) => <option key={status} value={status}>{status[0].toUpperCase() + status.slice(1)}</option>)}
            </select>
          </Field>
          <Field label="Notes" id="lead-notes"><Textarea id="lead-notes" value={form.notes} maxLength={4000} rows={3} disabled={saving} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Where this contact came from, and what they asked for." /></Field>
          {addError && <p className="flex items-start gap-1.5 rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700"><AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {addError}</p>}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => setAddOpen(false)} disabled={saving}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{saving ? "Saving…" : "Save lead"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </div>;
}

function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label htmlFor={id} className="text-xs text-slate-600">{label}</Label>{children}</div>;
}
