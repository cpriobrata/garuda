"use client";

import { useState } from "react";
import { AlertCircle, Route } from "lucide-react";
import { buildDemoJourney } from "@/components/journey/demo-journey";
import { VisitorJourney } from "@/components/journey/visitor-journey";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiRequest, garudaApi, type VisitorJourney as JourneyData } from "@/lib/api";
import { useBusyAction } from "@/lib/busy-action";

// The journey belongs to the session the lead was captured in, and the lead row
// the table renders does not carry that id. It is read on demand — one request
// for the lead, one for its conversation — rather than on every dialog open, so
// browsing the table costs nothing extra.
type Loaded = { journey?: JourneyData; startedAt?: string; manual?: boolean };

export function LeadJourney({ leadId, connected }: { leadId: string; connected: boolean }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState("");
  const load = useBusyAction();
  // The dialog body this lives in is never part of the server render, so the
  // sample can be built outright rather than held back until after hydration.
  const [demo] = useState(buildDemoJourney);

  async function show() {
    await load.run(async () => {
      setError("");
      try {
        const lead = await apiRequest<{ session_id?: string }>(`/leads/${encodeURIComponent(leadId)}`);
        const sessionId = lead.session_id?.trim();
        // A lead added by hand was never a visit, so there is nothing to fetch and
        // nothing went wrong. Saying which of the two it is matters to the reader.
        if (!sessionId) {
          setLoaded({ manual: true });
          return;
        }
        const detail = await garudaApi.getConversation(sessionId);
        setLoaded({ journey: detail.conversation.journey, startedAt: detail.conversation.created_at });
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "The visitor journey could not be loaded.");
      }
    });
  }

  if (!connected) {
    return <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2"><Badge variant="purple" className="text-[9px]">Demo preview</Badge><p className="text-[10px] text-slate-400">A sample visit — connect the API to see real ones.</p></div>
      <VisitorJourney journey={demo} />
    </div>;
  }

  if (loaded?.manual) {
    return <div className="rounded-xl border border-dashed bg-slate-50/70 p-4">
      <p className="text-xs font-semibold text-slate-800">Added by hand</p>
      <p className="mt-1 text-[10px] leading-4 text-slate-500">This lead was typed into the workspace rather than captured from a website visit, so there is no journey to show.</p>
    </div>;
  }

  if (loaded) return <VisitorJourney journey={loaded.journey} startedAt={loaded.startedAt} />;

  return <div className="rounded-xl border border-dashed bg-slate-50/70 p-4">
    <div className="flex flex-wrap items-start gap-3">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white text-slate-400 shadow-sm"><Route className="h-3.5 w-3.5" /></span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-slate-800">Visitor journey</p>
        <p className="mt-1 text-[10px] leading-4 text-slate-500">Where this person came from, every page they read before they wrote in, and how long they spent on each.</p>
      </div>
    </div>
    {error && <p role="alert" className="mt-3 flex items-start gap-1.5 rounded-lg bg-rose-50 px-3 py-2 text-[10px] leading-4 text-rose-700"><AlertCircle className="mt-0.5 h-3 w-3 shrink-0" /> {error}</p>}
    <Button size="sm" variant="outline" className="mt-3 w-full text-[10px] sm:w-auto" onClick={show} loading={load.busy} loadingLabel="Loading the visitor journey">
      {error ? "Try again" : "Show the journey"}
    </Button>
  </div>;
}
