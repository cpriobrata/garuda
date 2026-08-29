"use client";

import { useEffect, useState } from "react";
import type { VisitorJourney } from "@/lib/api";

// A sample visit, shown only where the dashboard is already running on demo
// fixtures — that is, when NEXT_PUBLIC_API_URL is unset. It is a fixture and is
// labelled as one at every call site; nothing here is a recording of anybody.

// Exported for surfaces that only ever render in the browser — a dialog body,
// say — where the hydration guard below would buy nothing but a blank first frame.
export function buildDemoJourney(): VisitorJourney {
  const now = Date.now();
  const at = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();
  return {
    source: {
      channel: "paid",
      referrer_domain: "google.com",
      landing_path: "/pricing",
      utm_source: "google",
      utm_medium: "cpc",
      utm_campaign: "q3-conversational-ai",
      click_id_kind: "google",
    },
    device: { form: "desktop", language: "en-GB", timezone: "Europe/London", region: "United Kingdom" },
    region_is_approximate: true,
    pages: [
      { path: "/pricing", title: "Pricing", arrived_at: at(19), seconds: 142 },
      { path: "/case-studies/northwind", title: "How Northwind doubled demo bookings", arrived_at: at(16), seconds: 96 },
      { path: "/pricing", title: "Pricing", arrived_at: at(14), seconds: 71 },
      { path: "/docs/install", title: "Installing the widget", arrived_at: at(13), seconds: 38 },
    ],
    page_count: 4,
    pages_truncated: false,
    engaged_seconds: 347,
    first_seen_at: at(19),
    last_seen_at: at(12),
  };
}

// The panel renders locale-formatted clock times, and the server's time zone is
// not the reader's. Rather than emit HTML the browser immediately disagrees
// with, the fixture is withheld until after hydration — the connected path never
// needs this, because its journey arrives from a fetch that only runs in the
// browser.
export function useDemoJourney(): VisitorJourney | null {
  const [journey] = useState(buildDemoJourney);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return hydrated ? journey : null;
}
