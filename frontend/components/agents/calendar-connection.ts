"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchConnections, fetchRoles, type IntegrationRoles } from "@/components/integrations/connected-apps-api";
import { ApiError } from "@/lib/api";

// An agent books into exactly ONE calendar and the owner chooses which one, so
// two questions have to be answered before the Appointments step can say
// anything true. Both are answered here.
//
// WHAT MAY BE CHOSEN comes from the server and nowhere else. The two facts that
// decide what this screen is allowed to show -- the single setting a provider
// needs beyond the connection, and whether it finishes the booking in the chat
// at all -- belong to backend/internal/composio, and a screen that guessed
// either would be promising a booking the code cannot make.
//
// WHETHER IT IS CONNECTED is per workspace, and it is asked about the CHOSEN
// calendar rather than about Google. An owner who picks Outlook and has
// connected Google has not connected a calendar this agent can use, and telling
// them otherwise publishes a button that fails in front of a visitor.

// Empty on a stored agent means Google Calendar: bookingCalendar() in
// backend/internal/api/booking.go resolves a blank that way, because every agent
// configured before there was a choice was booking into it.
export const defaultCalendarToolkit = "googlecalendar";

export function normalizeCalendar(toolkit: string) {
  return (toolkit || "").trim().toLowerCase() || defaultCalendarToolkit;
}

// One calendar an agent can book into, as the server describes it: the row from
// the `calendars` list joined to its row in the capability table, because the
// list says which providers exist and the table says how to word the one field
// they ask for.
export type CalendarOption = {
  toolkit: string;
  label: string;
  // The one value this provider needs beyond the connection itself -- a Cal.com
  // event type id, a Calendly event URL -- in the provider's own words. Empty
  // for the calendars that need nothing, and that emptiness is the whole test
  // for whether the field is shown.
  settingLabel: string;
  settingHint: string;
  // False when the provider completes the booking on its own page. The owner is
  // told before they choose it, not after a visitor has been sent somewhere
  // they did not expect.
  booksInChat: boolean;
  useCase: string;
  // What the provider only half does, in the server's words rather than ours.
  note: string;
};

function calendarOptionsFrom(payload: IntegrationRoles): CalendarOption[] {
  const roles = payload.roles || [];
  return (payload.calendars || [])
    .filter((calendar) => calendar && calendar.toolkit)
    .map((calendar) => {
      // The hint is on the capability row rather than in the calendar list, so
      // the field an owner fills in is labelled and explained by the provider's
      // own entry instead of by a sentence invented in the browser.
      const role = roles.find((entry) => entry.toolkit === calendar.toolkit && entry.capability === "calendar");
      return {
        toolkit: calendar.toolkit,
        label: calendar.label || calendar.toolkit,
        settingLabel: calendar.setting_label || "",
        settingHint: role?.setting_hint || "",
        booksInChat: calendar.books_in_chat === true,
        useCase: role?.use_case || "",
        note: role?.partial_note || "",
      };
    });
}

// Display names for the calendars the server ships today, used ONLY so that a
// workspace whose list could not be loaded reads "Google Calendar" instead of
// "googlecalendar". Nothing is ever chosen from this map: what an agent may be
// pointed at is the server's answer, and a name is the one thing here that
// cannot mislead anybody about what the code will do.
const calendarNames: Record<string, string> = {
  googlecalendar: "Google Calendar",
  outlook: "Outlook Calendar",
  cal: "Cal.com",
  calendly: "Calendly",
};

// The chosen calendar as the server describes it, or undefined while the list is
// not there to describe it with. Undefined is not "needs nothing and books in
// the chat" and must never be rendered as though it were.
export function calendarOptionFor(options: CalendarOption[], toolkit: string) {
  const slug = normalizeCalendar(toolkit);
  return options.find((option) => option.toolkit === slug);
}

export function calendarLabelFor(options: CalendarOption[], toolkit: string) {
  const slug = normalizeCalendar(toolkit);
  return calendarOptionFor(options, slug)?.label || calendarNames[slug] || slug;
}

export type CalendarOptionsState = "idle" | "loading" | "ready" | "unavailable";

export type CalendarOptions = {
  state: CalendarOptionsState;
  options: CalendarOption[];
  detail: string;
  reload: () => void;
};

/**
 * useCalendarOptions lists the calendars an agent can book into. The roles
 * endpoint is a table the API holds in memory rather than a call to the
 * integration provider, so it answers even where Composio is unconfigured --
 * but it is still asked once, the first time `active` is true.
 */
export function useCalendarOptions(active: boolean): CalendarOptions {
  const live = Boolean(process.env.NEXT_PUBLIC_API_URL);
  const [armed, setArmed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [answer, setAnswer] = useState<Omit<CalendarOptions, "reload">>({ state: "idle", options: [], detail: "" });

  const reload = useCallback(() => setAttempt((current) => current + 1), []);

  useEffect(() => {
    if (active) setArmed(true);
  }, [active]);

  useEffect(() => {
    if (!armed) return;
    if (!live) {
      setAnswer({ state: "unavailable", options: [], detail: "This demo workspace runs without the Garuda API, so the calendars an agent can book into cannot be listed here." });
      return;
    }
    let current = true;
    setAnswer((previous) => ({ ...previous, state: "loading" }));
    fetchRoles()
      .then((payload) => {
        if (!current) return;
        const options = calendarOptionsFrom(payload);
        if (!options.length) {
          setAnswer({ state: "unavailable", options: [], detail: "This deployment lists no calendars an agent can book into." });
          return;
        }
        setAnswer({ state: "ready", options, detail: "" });
      })
      .catch((reason) => {
        // No list means no chooser. The alternative -- falling back to a list
        // written here -- would offer providers this deployment may not drive,
        // and the owner would find that out in front of a visitor.
        if (!current) return;
        setAnswer({ state: "unavailable", options: [], detail: reason instanceof ApiError && reason.message ? reason.message : "The calendars you can book into could not be listed just now." });
      });
    return () => {
      current = false;
    };
  }, [armed, live, attempt]);

  return { ...answer, reload };
}

// "idle" until something asks; "unknown" once we asked and could not tell, which
// is not the same as knowing there is no calendar and must never read as one.
export type CalendarConnectionState = "idle" | "checking" | "connected" | "pending" | "missing" | "unknown";

export type CalendarConnection = {
  state: CalendarConnectionState;
  detail: string;
  recheck: () => void;
};

// The answer, and the calendar it is an answer ABOUT. Switching the chooser to
// Outlook must not leave a green "connected" from the Google check on screen
// while the new one is still in flight.
type CalendarAnswer = { toolkit: string; state: CalendarConnectionState; detail: string };

// Composio's own status strings reach the browser uppercase and untouched. A
// link is INITIATED from the moment it is created and only becomes ACTIVE once
// the customer has finished signing in at the provider, so ACTIVE is the only
// value that may be reported as connected.
function statusOf(status: string) {
  return (status || "").trim().toUpperCase();
}

/**
 * useCalendarConnection reports whether this workspace has a usable connection
 * to the calendar this agent is pointed at. It asks once, the first time
 * `active` is true, and again whenever the chosen calendar changes.
 */
export function useCalendarConnection(active: boolean, toolkit: string): CalendarConnection {
  const live = Boolean(process.env.NEXT_PUBLIC_API_URL);
  const wanted = normalizeCalendar(toolkit);
  const [armed, setArmed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [answer, setAnswer] = useState<CalendarAnswer>({ toolkit: "", state: "idle", detail: "" });

  const recheck = useCallback(() => setAttempt((current) => current + 1), []);

  // Latched rather than followed: leaving the Appointments section must not
  // throw the answer away and asking again must not be the price of coming back.
  useEffect(() => {
    if (active) setArmed(true);
  }, [active]);

  useEffect(() => {
    if (!armed) return;
    if (!live) {
      setAnswer({ toolkit: wanted, state: "unknown", detail: "This demo workspace runs without the Garuda API, so the calendar connection cannot be checked from here." });
      return;
    }
    let current = true;
    fetchConnections()
      .then((connections) => {
        if (!current) return;
        const matching = (connections || []).filter((connection) => (connection.toolkit || "").trim().toLowerCase() === wanted);
        if (matching.some((connection) => statusOf(connection.status) === "ACTIVE")) {
          setAnswer({ toolkit: wanted, state: "connected", detail: "" });
          return;
        }
        // The wording for these two belongs to the caller, which knows what the
        // chosen calendar is called; naming it here would mean re-asking the
        // provider every time a label arrived.
        setAnswer({ toolkit: wanted, state: matching.length ? "pending" : "missing", detail: "" });
      })
      .catch((reason) => {
        if (!current) return;
        // A deployment with no Composio credentials answers 503 here, and a
        // request that simply failed is no evidence either way. Both read as
        // "could not tell", because a false all-clear is how somebody publishes
        // a button that does nothing.
        if (reason instanceof ApiError && reason.code === "integrations_not_configured") {
          setAnswer({ toolkit: wanted, state: "unknown", detail: "Integrations are not configured for this deployment, so appointments cannot run here yet." });
          return;
        }
        setAnswer({ toolkit: wanted, state: "unknown", detail: reason instanceof ApiError && reason.message ? reason.message : "Your connected accounts could not be checked just now." });
      });
    return () => {
      current = false;
    };
  }, [armed, live, wanted, attempt]);

  // An answer about a different calendar is not an answer about this one. It
  // reads as still checking, which is what it is.
  const state: CalendarConnectionState = !armed ? "idle" : answer.toolkit === wanted ? answer.state : "checking";
  return { state, detail: answer.toolkit === wanted ? answer.detail : "", recheck };
}
