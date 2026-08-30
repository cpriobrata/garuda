"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchConnections } from "@/components/integrations/connected-apps-api";
import { ApiError } from "@/lib/api";

// Appointments read and write the customer's OWN Google Calendar, so the whole
// feature is dead until they have connected one on the Integrations page. This
// asks the same endpoint that page asks, so the builder can say which of those
// two situations the writer is actually in rather than printing an instruction
// at somebody who already followed it.

// Composio's slug for the calendar the booking service uses. The backend runs
// GOOGLECALENDAR_FIND_FREE_SLOTS and GOOGLECALENDAR_CREATE_EVENT, and those only
// resolve against a connection for this toolkit.
const calendarToolkit = "googlecalendar";

// "idle" until something asks; "unknown" once we asked and could not tell, which
// is not the same as knowing there is no calendar and must never read as one.
export type CalendarConnectionState = "idle" | "checking" | "connected" | "pending" | "missing" | "unknown";

export type CalendarConnection = {
  state: CalendarConnectionState;
  detail: string;
  recheck: () => void;
};

// Composio's own status strings reach the browser uppercase and untouched. A
// link is INITIATED from the moment it is created and only becomes ACTIVE once
// the customer has finished signing in at Google, so ACTIVE is the only value
// that may be reported as connected.
function statusOf(status: string) {
  return (status || "").trim().toUpperCase();
}

/**
 * useCalendarConnection reports whether this workspace has a usable Google
 * Calendar. It asks once, the first time `active` is true, so opening the
 * builder does not reach out to the integration provider on every load.
 */
export function useCalendarConnection(active: boolean): CalendarConnection {
  const live = Boolean(process.env.NEXT_PUBLIC_API_URL);
  const [armed, setArmed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<CalendarConnectionState>("idle");
  const [detail, setDetail] = useState("");

  const recheck = useCallback(() => setAttempt((current) => current + 1), []);

  // Latched rather than followed: leaving the Appointments section must not
  // throw the answer away and asking again must not be the price of coming back.
  useEffect(() => {
    if (active) setArmed(true);
  }, [active]);

  useEffect(() => {
    if (!armed) return;
    if (!live) {
      setState("unknown");
      setDetail("This demo workspace runs without the Garuda API, so the calendar connection cannot be checked from here.");
      return;
    }
    let current = true;
    setState("checking");
    setDetail("");
    fetchConnections()
      .then((connections) => {
        if (!current) return;
        const calendars = (connections || []).filter((connection) => (connection.toolkit || "").toLowerCase() === calendarToolkit);
        if (calendars.some((connection) => statusOf(connection.status) === "ACTIVE")) {
          setState("connected");
          return;
        }
        if (calendars.length) {
          setState("pending");
          setDetail("A Google Calendar connection was started but never finished at Google, so it cannot be used yet.");
          return;
        }
        setState("missing");
      })
      .catch((reason) => {
        if (!current) return;
        // A deployment with no Composio credentials answers 503 here, and a
        // request that simply failed is no evidence either way. Both read as
        // "could not tell", because a false all-clear is how somebody publishes
        // a button that does nothing.
        setState("unknown");
        if (reason instanceof ApiError && reason.code === "integrations_not_configured") {
          setDetail("Integrations are not configured for this deployment, so appointments cannot run here yet.");
          return;
        }
        setDetail(reason instanceof ApiError && reason.message ? reason.message : "Your connected accounts could not be checked just now.");
      });
    return () => {
      current = false;
    };
  }, [armed, live, attempt]);

  return { state, detail, recheck };
}
