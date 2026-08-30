"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, Loader2, PauseCircle, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  fetchLeadRoutes,
  saveLeadRoute,
  testLeadRoute,
  type LeadDestination,
  type LeadRoute,
} from "@/components/integrations/lead-routes-api";

function messageOf(reason: unknown) {
  if (reason instanceof Error && reason.message) return reason.message;
  return "Something went wrong. Please try again.";
}

function formatMoment(value?: string) {
  if (!value) return null;
  const moment = new Date(value);
  if (Number.isNaN(moment.getTime())) return null;
  return moment.toLocaleString();
}

export function LeadDestinations() {
  const [available, setAvailable] = useState<LeadDestination[] | null>(null);
  const [routes, setRoutes] = useState<Record<string, LeadRoute>>({});
  // What is in the box right now, which is not what is saved. Keeping them apart
  // is what lets somebody type a channel without every keystroke being a write.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<string | null>(null);
  // Where the switch is DRAWN while a write is in flight. The server's answer is
  // still what wins; without this the control sat still for the whole round trip,
  // which on a slow connection is several seconds of a toggle that looks broken.
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const loaded = await fetchLeadRoutes();
      const byToolkit: Record<string, LeadRoute> = {};
      const typed: Record<string, string> = {};
      for (const route of loaded.routes ?? []) {
        byToolkit[route.toolkit] = route;
        typed[route.toolkit] = route.setting ?? "";
      }
      setRoutes(byToolkit);
      setDrafts((current) => ({ ...typed, ...current }));
      setAvailable(loaded.available ?? []);
    } catch (reason) {
      setError(messageOf(reason));
      setAvailable([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (key: string, action: () => Promise<string | null>) => {
    setError(null);
    setNotice(null);
    setPending(key);
    try {
      const message = await action();
      if (message) setNotice(message);
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setPending(null);
    }
  };

  const persist = async (destination: LeadDestination, enabled: boolean) => {
    setOptimistic((current) => ({ ...current, [destination.toolkit]: enabled }));
    await run(destination.toolkit, async () => {
      const setting = (drafts[destination.toolkit] ?? "").trim();
      const saved = await saveLeadRoute({ toolkit: destination.toolkit, setting, enabled });
      setRoutes((current) => ({
        ...current,
        [destination.toolkit]: {
          toolkit: saved.toolkit,
          setting: saved.setting,
          enabled: saved.enabled,
          // Saving clears the breaker on the server, so the screen must not keep
          // showing a paused destination that is now being tried again.
          failure_count: 0,
          paused: false,
          last_delivered_at: current[destination.toolkit]?.last_delivered_at,
        },
      }));
      return enabled
        ? `New leads will be sent to ${destination.label}.`
        : `${destination.label} will stop receiving leads. Your settings are kept.`;
    });
    // Whatever happened, the switch goes back to reflecting stored state — which
    // after a refused write is where it started, so the failure visibly undoes.
    setOptimistic((current) => {
      const next = { ...current };
      delete next[destination.toolkit];
      return next;
    });
  };

  if (available === null) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Loading destinations…
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error ? (
        <p role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {notice}
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        {available.map((destination) => {
          const route = routes[destination.toolkit];
          const enabled = optimistic[destination.toolkit] ?? route?.enabled ?? false;
          const busy = pending === destination.toolkit;
          const delivered = formatMoment(route?.last_delivered_at);
          const inputID = `lead-route-${destination.toolkit}`;

          return (
            <Card key={destination.toolkit} className="border-slate-200">
              <CardContent className="space-y-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold tracking-[-.01em] text-slate-950">{destination.label}</p>
                    <p className="mt-0.5 text-sm text-slate-500">{destination.summary}</p>
                  </div>
                  <Switch
                    checked={enabled}
                    disabled={busy}
                    onCheckedChange={(next) => void persist(destination, next)}
                    aria-label={`Send leads to ${destination.label}`}
                  />
                </div>

                {destination.setting_label ? (
                  <div className="space-y-1.5">
                    <Label htmlFor={inputID} className="text-xs font-medium text-slate-600">
                      {destination.setting_label}
                    </Label>
                    <Input
                      id={inputID}
                      value={drafts[destination.toolkit] ?? ""}
                      onChange={(event) =>
                        setDrafts((current) => ({ ...current, [destination.toolkit]: event.target.value }))
                      }
                      onBlur={() => {
                        // Only write when it actually changed, so tabbing through
                        // the form is not a row of pointless requests.
                        const typed = (drafts[destination.toolkit] ?? "").trim();
                        if (!route || typed === (route.setting ?? "")) return;
                        void persist(destination, route.enabled);
                      }}
                      placeholder={destination.setting_hint}
                      disabled={busy}
                    />
                    {destination.setting_hint ? (
                      <p className="text-xs text-slate-500">{destination.setting_hint}</p>
                    ) : null}
                  </div>
                ) : null}

                {route?.paused ? (
                  <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
                    <PauseCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                    <span className="min-w-0 break-words">
                      Garuda stopped sending here after {route.failure_count} failures. Fix the settings above and save to start
                      again.
                      {route.last_error ? <span className="mt-1 block break-all font-mono text-[11px]">{route.last_error}</span> : null}
                    </span>
                  </p>
                ) : route?.last_error ? (
                  <p className="break-words text-xs text-amber-800">Last attempt failed: {route.last_error}</p>
                ) : delivered ? (
                  <p className="text-xs text-slate-500">Last delivered {delivered}</p>
                ) : null}

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-slate-400">
                    {!route
                      ? "Switch this on to send leads here"
                      : enabled
                        ? "Receiving new leads"
                        : "Not receiving leads"}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!route || busy}
                    onClick={() =>
                      void run(destination.toolkit, async () => {
                        await testLeadRoute(destination.toolkit);
                        await load();
                        return `A test lead was sent to ${destination.label}.`;
                      })
                    }
                  >
                    {busy ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
                    ) : (
                      <Send className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                    )}
                    Send a test lead
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <p className="text-xs text-slate-500">
        Leads are delivered within about a minute of being captured, and they are always saved in Garuda first — a destination
        being down never loses one.
      </p>
    </div>
  );
}
