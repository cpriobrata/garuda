"use client";

import { useEffect, useMemo, useState } from "react";
import { Mail, Phone, Search, Sparkles, UserRound } from "lucide-react";
import { LeadJourney } from "@/components/journey/lead-journey";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { garudaApi } from "@/lib/api";
import { leads as demoLeads, type Lead } from "@/lib/demo-data";
import { cn } from "@/lib/utils";

export function LeadsTable() {
  const connected = Boolean(process.env.NEXT_PUBLIC_API_URL);
  const [items, setItems] = useState<Lead[]>(connected ? [] : demoLeads);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("All");
  const [selected, setSelected] = useState<Lead | null>(null);
  // Only the connected workspace waits on a request; the demo table already
  // holds its rows, so it must not flash a loading state it never needed.
  const [loading, setLoading] = useState(connected);
  const statuses = connected ? ["All", "New", "Qualified", "Contacted", "Customer"] : ["All", "New", "Qualified", "Meeting booked", "Customer"];
  const filtered = useMemo(() => items.filter((lead) => (status === "All" || lead.status === status) && `${lead.name} ${lead.email} ${lead.company}`.toLowerCase().includes(query.toLowerCase())), [items, query, status]);

  useEffect(() => {
    garudaApi.listLeads().then(setItems).catch(() => undefined).finally(() => setLoading(false));
  }, []);

  return <>
    <div className="rounded-xl border border-slate-200/80 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center">
        <div className="relative max-w-sm flex-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, email or company…" className="h-9 bg-slate-50 pl-9 text-xs shadow-none" /></div>
        <div className="flex gap-1 overflow-x-auto rounded-lg border bg-slate-50 p-0.5">{statuses.map((item) => <button key={item} onClick={() => setStatus(item)} className={cn("shrink-0 rounded-md px-2.5 py-1.5 text-[10px] font-medium transition", status === item ? "bg-white text-slate-900 shadow-sm" : "text-slate-500")}>{item}</button>)}</div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[780px] border-collapse text-left">
          <thead><tr className="border-b bg-slate-50/70 text-[9px] font-bold uppercase tracking-[.12em] text-slate-400"><th className="px-5 py-3">Lead</th>{!connected && <th className="px-3 py-3">Demo score</th>}<th className="px-3 py-3">Status</th><th className="px-3 py-3">Source</th><th className="px-5 py-3">Captured</th></tr></thead>
          <tbody className="divide-y">{filtered.map((lead, index) => <tr key={lead.id} onClick={() => setSelected(lead)} className="cursor-pointer transition hover:bg-slate-50/80"><td className="px-5 py-3.5"><div className="flex items-center gap-3"><Avatar className="h-9 w-9"><AvatarFallback className={cn("text-[10px]", index % 2 ? "bg-cyan-100 text-cyan-700" : "bg-indigo-100 text-indigo-700")}>{initials(lead.name)}</AvatarFallback></Avatar><div><p className="text-xs font-semibold text-slate-900">{lead.name}</p><p className="mt-1 text-[10px] text-slate-500">{lead.email}{lead.company && lead.company !== "Not provided" ? ` · ${lead.company}` : ""}</p></div></div></td>{!connected && <td className="px-3 py-3.5"><Score score={lead.score} /></td>}<td className="px-3 py-3.5"><LeadStatus status={lead.status} /></td><td className="px-3 py-3.5 text-[10px] font-medium text-slate-600">{lead.source}</td><td className="px-5 py-3.5 text-[10px] text-slate-500">{lead.captured}</td></tr>)}</tbody>
        </table>
        {!filtered.length && (loading
          ? <div role="status" aria-busy="true" className="p-10 text-center"><Spinner className="mx-auto h-6 w-6 text-slate-300" /><p className="mt-3 text-xs font-semibold text-slate-700">Loading leads…</p><p className="mt-1 text-[10px] text-slate-400">Reading the captured leads for this workspace.</p></div>
          : <div className="p-10 text-center"><UserRound className="mx-auto h-6 w-6 text-slate-300" /><p className="mt-3 text-xs font-semibold text-slate-700">No leads found</p><p className="mt-1 text-[10px] text-slate-400">Consented widget leads will appear here.</p></div>)}
      </div>
      <div className="flex items-center justify-between border-t px-4 py-3"><p className="text-[10px] text-slate-500">{loading ? "Loading leads…" : <>Showing {filtered.length} lead{filtered.length === 1 ? "" : "s"}{connected ? " from the API" : " · demo data"}</>}</p><Badge variant="secondary">{connected ? "Read-only" : "Demo preview"}</Badge></div>
    </div>

    <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
      <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto p-0">
        {selected && <><DialogHeader className="border-b p-5 pr-12"><div className="flex items-center gap-3"><Avatar className="h-11 w-11"><AvatarFallback className="bg-indigo-100 text-xs font-bold text-indigo-700">{initials(selected.name)}</AvatarFallback></Avatar><div><DialogTitle>{selected.name}</DialogTitle><DialogDescription className="mt-1">Captured {selected.captured.toLowerCase()}</DialogDescription></div>{!connected && <Score score={selected.score} />}</div></DialogHeader><div className="p-5"><div className="grid gap-3 sm:grid-cols-2"><Info icon={Mail} label="Email" value={selected.email} /><Info icon={Phone} label="Phone" value={selected.phone} /><Info icon={UserRound} label="Company" value={selected.company} /><Info icon={Sparkles} label="Source" value={selected.source} /></div><div className="my-5 h-px bg-slate-100" />{connected ? <div className="rounded-xl border border-dashed bg-slate-50 p-4"><p className="text-xs font-semibold text-slate-800">Server lead record</p><p className="mt-1 text-[10px] leading-5 text-slate-500">Only captured fields and the workflow status are shown. Qualification scores, summaries, email, and scheduling actions are not generated by this interface.</p></div> : <><p className="text-[10px] font-bold uppercase tracking-[.13em] text-slate-400">Demo qualification summary</p><p className="mt-3 text-xs leading-6 text-slate-600">A sample growth leader evaluating Garuda for an active website conversion project. This summary and its score are preview fixtures.</p><div className="mt-4 flex flex-wrap gap-2"><Badge variant="purple">Demo high intent</Badge><Badge variant="secondary">Preview only</Badge></div></>}<div className="my-5 h-px bg-slate-100" /><LeadJourney key={selected.id} leadId={selected.id} connected={connected} /></div></>}
      </DialogContent>
    </Dialog>
  </>;
}

function initials(name: string) {
  return name.split(" ").filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "L";
}

function Score({ score }: { score: number }) {
  return <div className="flex items-center gap-2"><span className={cn("grid h-8 w-8 place-items-center rounded-full text-[10px] font-bold", score >= 85 ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200" : score >= 70 ? "bg-amber-50 text-amber-700 ring-1 ring-amber-200" : "bg-slate-100 text-slate-600")}>{score}</span><span className="hidden text-[9px] text-slate-400 lg:inline">Demo</span></div>;
}

function LeadStatus({ status }: { status: Lead["status"] }) {
  const variant = status === "Customer" ? "success" : status === "Meeting booked" ? "purple" : status === "Qualified" || status === "Contacted" ? "warning" : "secondary";
  return <Badge variant={variant} className="whitespace-nowrap text-[9px]">{status}</Badge>;
}

function Info({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string }) {
  return <div className="flex items-center gap-3 rounded-xl border bg-slate-50/50 p-3"><span className="grid h-8 w-8 place-items-center rounded-lg bg-white text-slate-400 shadow-sm"><Icon className="h-3.5 w-3.5" /></span><div className="min-w-0"><p className="text-[9px] text-slate-400">{label}</p><p className="truncate text-[10px] font-medium text-slate-700">{value || "Not provided"}</p></div></div>;
}
