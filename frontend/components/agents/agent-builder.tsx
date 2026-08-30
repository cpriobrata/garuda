"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, Bot, BrainCircuit, CalendarCheck, CalendarClock, Check, ChevronRight, ExternalLink, Palette, Play, RefreshCw, Save, Settings2, Sparkles, Target, UploadCloud } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, garudaApi, type AgentRecord } from "@/lib/api";
import { WebsiteImport } from "@/components/agents/website-import";
import { calendarLabelFor, calendarOptionFor, defaultCalendarToolkit, normalizeCalendar, useCalendarConnection, useCalendarOptions, type CalendarConnection, type CalendarOption, type CalendarOptions } from "@/components/agents/calendar-connection";
import { cn } from "@/lib/utils";

const sections = [
  { id: "identity", label: "Identity", icon: Bot },
  { id: "goal", label: "Goal & behavior", icon: Target },
  { id: "knowledge", label: "Knowledge", icon: BrainCircuit },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "handoff", label: "Handoff rules", icon: Settings2 },
  { id: "appointments", label: "Appointments", icon: CalendarClock },
];

const editableFields = ["name", "description", "greeting", "systemPrompt", "primaryColor", "accent", "launcherText", "widgetPosition", "allowedDomain", "handoffEnabled", "handoffNumber", "handoffLabel", "handoffMessage", "handoffAvailability", "handoffTriggers", "handoffAutoOffer", "handoffNotifyEmail", "bookingEnabled", "bookingCalendar", "bookingCalendarSetting", "bookingLabel", "bookingTitle", "bookingTimezone", "bookingDuration", "bookingStartHour", "bookingEndHour", "bookingWeekdays", "bookingLeadDays", "bookingNoticeHours"] as const;

// Every builder value is a string, including the two that are not text. The
// form is one flat record so that "which fields did the writer touch" stays a
// single set, and a boolean stored as "true"/"false" costs one parse at the
// edges instead of a second shape running through the whole component.
const handoffTriggerDefaults = "human, agent, real person, speak to someone, talk to a person";

// The hours the booking service falls back to when a stored working day does not
// describe a real window (backend/internal/composio/booking.go, slotsFromBusy).
// The builder shows those same hours, so the form never claims a day the server
// would not actually offer.
const defaultStartHour = 9;
const defaultEndHour = 18;
const defaultWeekdays = "1,2,3,4,5";

export type AgentFormField = (typeof editableFields)[number];
export type AgentFormValues = Record<AgentFormField, string>;

// model.BookingConfig as it comes back on the agent record. Every field is
// optional on the wire, and the client type in lib/api.ts predates the feature,
// so the shape is named here and read through a cast at the one place that
// touches it.
export type AgentBookingRecord = {
  enabled?: boolean;
  // The toolkit slug of the calendar this agent books into, and the one value
  // that calendar needs beyond the connection. Both absent on every agent saved
  // before an owner could choose.
  calendar?: string;
  calendar_setting?: string;
  button_label?: string;
  title?: string;
  duration_minutes?: number;
  timezone?: string;
  start_hour?: number;
  end_hour?: number;
  weekdays?: number[];
  lead_days_ahead?: number;
  notice_hours?: number;
};

// The builder runs one async action at a time and every one of them writes the
// same record, so they share a single slot: the clicked button shows the
// spinner and the others hold still until it is finished.
export type AgentBuilderAction = "" | "save" | "test" | "publish" | "knowledge";

// Server validation keys mapped to the builder section that shows the field, so
// a rejected save can move the writer to something they can actually correct.
// Keys the builder has no input for are deliberately absent and are listed in
// the summary block instead.
const fieldSections: Record<string, string> = {
  name: "identity",
  description: "identity",
  welcome_message: "identity",
  system_prompt: "goal",
  knowledge: "knowledge",
  "branding.colors": "appearance",
  "branding.position": "appearance",
  "branding.allowed_domains": "appearance",
  "handoff.whatsapp_number": "handoff",
  "handoff.button_label": "handoff",
  "handoff.message": "handoff",
  "handoff.availability": "handoff",
  "handoff.auto_offer_after": "handoff",
  "handoff.notify_email": "handoff",
  // booking.hours is one key for both ends of the working day, which is how
  // validateBooking reports them: the rule is about the pair, not either field.
  "booking.timezone": "appointments",
  "booking.calendar": "appointments",
  "booking.calendar_setting": "appointments",
  "booking.hours": "appointments",
  "booking.duration_minutes": "appointments",
  "booking.lead_days_ahead": "appointments",
  "booking.notice_hours": "appointments",
  "booking.button_label": "appointments",
  "booking.title": "appointments",
};

export function agentFormValuesFromRecord(agent: AgentRecord, current: AgentFormValues): AgentFormValues {
  const booking = (agent as AgentRecord & { booking?: AgentBookingRecord }).booking;
  // Zero is a real answer for these two — midnight, and no minimum notice — so
  // they are read by presence rather than by truthiness.
  const startHour = typeof booking?.start_hour === "number" ? booking.start_hour : 0;
  const endHour = typeof booking?.end_hour === "number" ? booking.end_hour : 0;
  const realWorkingDay = endHour > startHour;
  return {
    name: agent.name,
    description: agent.description || "A focused AI agent for website conversations.",
    greeting: agent.welcome_message || current.greeting,
    systemPrompt: agent.system_prompt || "Answer accurately from approved knowledge and guide the visitor to a useful next step.",
    primaryColor: agent.branding?.primary_color || "#111827",
    accent: agent.branding?.accent_color || "#635BFF",
    launcherText: agent.branding?.launcher_text || "Ask Garuda",
    widgetPosition: agent.branding?.position || "bottom_right",
    allowedDomain: agent.branding?.allowed_domains?.[0] || "",
    handoffEnabled: agent.handoff?.enabled ? "true" : "false",
    handoffNumber: agent.handoff?.whatsapp_number || "",
    handoffLabel: agent.handoff?.button_label || "",
    handoffMessage: agent.handoff?.message || "",
    handoffAvailability: agent.handoff?.availability || "",
    handoffTriggers: (agent.handoff?.trigger_phrases || []).join(", "),
    handoffAutoOffer: agent.handoff?.auto_offer_after ? String(agent.handoff.auto_offer_after) : "0",
    handoffNotifyEmail: agent.handoff?.notify_email || "",
    bookingEnabled: booking?.enabled ? "true" : "false",
    // A blank calendar is not "nothing chosen": the server reads it as Google
    // Calendar, which is the diary this agent's visitors have been booking into
    // all along. Showing it as unchosen invites somebody to "fix" it into a
    // different one.
    bookingCalendar: booking?.calendar || defaultCalendarToolkit,
    bookingCalendarSetting: booking?.calendar_setting || "",
    bookingLabel: booking?.button_label || "",
    bookingTitle: booking?.title || "",
    // Never blanked by a load: the browser's own zone has usually been filled in
    // by the time the record lands, and it is a better answer than nothing.
    bookingTimezone: booking?.timezone || current.bookingTimezone,
    bookingDuration: booking?.duration_minutes ? String(booking.duration_minutes) : "30",
    bookingStartHour: realWorkingDay ? String(startHour) : String(defaultStartHour),
    bookingEndHour: realWorkingDay ? String(endHour) : String(defaultEndHour),
    bookingWeekdays: booking?.weekdays?.length ? booking.weekdays.join(",") : defaultWeekdays,
    bookingLeadDays: booking?.lead_days_ahead ? String(booking.lead_days_ahead) : "14",
    bookingNoticeHours: typeof booking?.notice_hours === "number" ? String(booking.notice_hours) : "4",
  };
}

// The number is stored as E.164 digits because that is the only form the wa.me
// link accepts. Doing it here as well as on the server means the writer sees
// the same value the widget will use, rather than discovering on their next
// load that their spacing was thrown away.
export function handoffPayloadFrom(form: AgentFormValues) {
  const autoOffer = Number.parseInt(form.handoffAutoOffer, 10);
  return {
    enabled: form.handoffEnabled === "true",
    whatsapp_number: form.handoffNumber.replace(/\D+/g, ""),
    button_label: form.handoffLabel.trim(),
    message: form.handoffMessage.trim(),
    availability: form.handoffAvailability.trim(),
    trigger_phrases: form.handoffTriggers.split(",").map((phrase) => phrase.trim()).filter(Boolean).slice(0, 12),
    auto_offer_after: Number.isFinite(autoOffer) && autoOffer > 0 ? autoOffer : 0,
    notify_email: form.handoffNotifyEmail.trim(),
  };
}

// A form value that will not parse is sent as the documented default rather than
// as NaN, which does not survive JSON and would reach the server as null.
function wholeNumber(value: string, fallback: number) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// The weekday set travels as one comma-separated string like every other form
// value. Sorted and deduplicated here so the preview reads in week order and the
// server is never asked to search the same day twice.
export function weekdaysFrom(value: string): number[] {
  const days = new Set<number>();
  for (const part of value.split(",")) {
    const day = Number.parseInt(part, 10);
    if (Number.isInteger(day) && day >= 0 && day <= 6) days.add(day);
  }
  return [...days].sort((first, second) => first - second);
}

// Every key here is a json name on model.BookingConfig. The agent PATCH decodes
// with DisallowUnknownFields, so one extra key is a 400 for the whole save.
export function bookingPayloadFrom(form: AgentFormValues) {
  return {
    enabled: form.bookingEnabled === "true",
    calendar: normalizeCalendar(form.bookingCalendar),
    // Sent as the owner left it, even where the chosen calendar asks for
    // nothing. Whether a setting applies is a fact about the provider, and on a
    // load that could not list the providers the only thing dropping it would
    // achieve is losing an event type id somebody typed last week.
    calendar_setting: form.bookingCalendarSetting.trim(),
    button_label: form.bookingLabel.trim(),
    title: form.bookingTitle.trim(),
    duration_minutes: wholeNumber(form.bookingDuration, 30),
    timezone: form.bookingTimezone.trim(),
    start_hour: wholeNumber(form.bookingStartHour, defaultStartHour),
    end_hour: wholeNumber(form.bookingEndHour, defaultEndHour),
    weekdays: weekdaysFrom(form.bookingWeekdays),
    lead_days_ahead: wholeNumber(form.bookingLeadDays, 14),
    notice_hours: wholeNumber(form.bookingNoticeHours, 4),
  };
}

const weekdayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function hourLabel(hour: number) {
  // 24 is a real end of the working day — validateBooking allows it and the slot
  // search reads it as "up to but not including" — but "24:00" is not a clock.
  if (hour >= 24) return "midnight";
  return `${String(hour).padStart(2, "0")}:00`;
}

function weekdayPhrase(days: number[]) {
  // No days selected is the server's "Monday to Friday", not "never": empty
  // weekdays fall through to the weekday default in composio.WorkingDay.
  if (!days.length || (days.length === 5 && days.every((day) => day >= 1 && day <= 5))) return "Monday to Friday";
  if (days.length === 7) return "any day";
  const names = days.map((day) => weekdayNames[day]);
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function noticePhrase(hours: number) {
  if (hours <= 0) return "starting immediately";
  if (hours % 24 === 0) return `no sooner than ${hours / 24} day${hours === 24 ? "" : "s"} from now`;
  return `no sooner than ${hours} hour${hours === 1 ? "" : "s"} from now`;
}

// One sentence describing what a visitor is actually offered, so the writer can
// check the settings without publishing them at somebody's real customers.
export function bookingPreviewSentence(form: AgentFormValues, agentName: string, calendars: CalendarOption[]): string {
  const booking = bookingPayloadFrom(form);
  // Both defaults are the server's own: resolveBooking names the button and
  // createBooking names the calendar event when the owner leaves them blank.
  const label = booking.button_label || "Book an appointment";
  const title = booking.title || `Appointment via ${agentName.trim() || "your agent"}`;
  const zone = booking.timezone ? `in ${booking.timezone}` : "in a time zone you have not chosen yet";
  const offer = `Visitors tap “${label}” and are offered ${booking.duration_minutes}-minute appointments ${weekdayPhrase(booking.weekdays)}, ${hourLabel(booking.start_hour)} to ${hourLabel(booking.end_hour)} ${zone}, ${noticePhrase(booking.notice_hours)} and up to ${booking.lead_days_ahead} days ahead.`;
  const chosen = calendarOptionFor(calendars, booking.calendar);
  const name = calendarLabelFor(calendars, booking.calendar);
  // Only a provider we could look up may be described as finishing elsewhere,
  // and only one that books in the chat may be promised an event. An unlisted
  // calendar gets the sentence that is true either way.
  if (chosen && !chosen.booksInChat) return `${offer} The time they pick is finished on ${name}, not here, so no event is written for them.`;
  if (!chosen) return `${offer} Each one goes to ${name}.`;
  return `${offer} Each one is written into your ${name} as “${title}”.`;
}

// A field the writer has already edited keeps what they typed. Everything else
// takes the loaded record, so a slow initial read never discards their work.
export function mergeLoadedAgentValues(loaded: AgentFormValues, current: AgentFormValues, editedFields: ReadonlySet<string>): AgentFormValues {
  const merged = { ...loaded };
  for (const field of editableFields) {
    if (editedFields.has(field)) merged[field] = current[field];
  }
  return merged;
}

// The edited fields and the form values are both read when the response lands,
// never when the request was sent, because the writer types in between.
export async function loadAgentForm(agentId: string, readEditedFields: () => ReadonlySet<string>) {
  const agent = await garudaApi.getAgent(agentId);
  return {
    agent,
    apply: (current: AgentFormValues) => mergeLoadedAgentValues(agentFormValuesFromRecord(agent, current), current, readEditedFields()),
  };
}

// The API reports rejected fields as a field to message map under
// error.details. Anything else is left to the general status line.
export function fieldMessagesFromError(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError) || error.code !== "validation_failed") return {};
  const details = error.details;
  if (!details || typeof details !== "object" || Array.isArray(details)) return {};
  const messages: Record<string, string> = {};
  for (const [field, message] of Object.entries(details as Record<string, unknown>)) {
    if (typeof message === "string" && message.trim()) messages[field] = message.trim();
  }
  return messages;
}

export function sectionForFieldMessages(messages: Record<string, string>): string {
  const rejected = Object.keys(messages);
  for (const item of sections) {
    if (rejected.some((field) => fieldSections[field] === item.id)) return item.id;
  }
  return "";
}

// Messages for fields the builder has no input for still have to reach the
// writer, so they are listed above the section they are looking at.
export function unlistedFieldMessages(messages: Record<string, string>): string[] {
  return Object.entries(messages)
    .filter(([field]) => !fieldSections[field])
    .map(([field, message]) => `${field}: ${message}`);
}

export function AgentBuilder({ existing = false, agentId }: { existing?: boolean; agentId?: string }) {
  const demoMode = !process.env.NEXT_PUBLIC_API_URL;
  const router = useRouter();
  const searchParams = useSearchParams();
  // Read once, on mount. Validated against the real list so an unknown or
  // hand-edited value falls back to Identity rather than rendering a blank
  // column, and not kept in sync afterwards -- clicking through the sub-nav
  // should not rewrite the address bar under the reader.
  const [section, setSection] = useState(() => {
    const requested = searchParams.get("section");
    return requested && sections.some((item) => item.id === requested) ? requested : "identity";
  });
  const [previewDevice, setPreviewDevice] = useState<"desktop" | "mobile">("desktop");
  const [form, setForm] = useState<AgentFormValues>(() => ({
    name: existing ? (demoMode ? "Aria" : "") : "Nova",
    description: "A focused AI agent for website conversations.",
    greeting: existing ? (demoMode ? "Hi! I’m Aria from Northstar Labs. What are you hoping to achieve today?" : "") : "Hi! I’m Nova. What can I help you accomplish today?",
    systemPrompt: "Help visitors understand the business, answer only from approved knowledge, qualify intent, and offer a human follow-up when useful.",
    primaryColor: "#111827",
    accent: "#635BFF",
    launcherText: "Ask Garuda",
    widgetPosition: "bottom_right",
    allowedDomain: existing && demoMode ? "northstarlabs.com" : "",
    handoffEnabled: "false",
    handoffNumber: "",
    handoffLabel: "",
    handoffMessage: "",
    handoffAvailability: "",
    handoffTriggers: handoffTriggerDefaults,
    handoffAutoOffer: "0",
    handoffNotifyEmail: "",
    bookingEnabled: "false",
    bookingCalendar: defaultCalendarToolkit,
    bookingCalendarSetting: "",
    bookingLabel: "",
    bookingTitle: "",
    // Filled from the browser after mount, never during render.
    bookingTimezone: "",
    bookingDuration: "30",
    bookingStartHour: String(defaultStartHour),
    bookingEndHour: String(defaultEndHour),
    bookingWeekdays: defaultWeekdays,
    bookingLeadDays: "14",
    bookingNoticeHours: "4",
  }));
  const editedFields = useRef(new Set<AgentFormField>());
  const [published, setPublished] = useState(existing && demoMode);
  const [recordId, setRecordId] = useState(agentId || "");
  const [revision, setRevision] = useState<number>();
  const [knowledge, setKnowledge] = useState<AgentRecord["knowledge"]>([]);
  // Held here rather than inside KnowledgeSection, which is a conditional render
  // and is unmounted by any sub-nav click. Somebody who pastes a page of pricing
  // and then goes to check a setting should come back to it.
  const [knowledgeDraft, setKnowledgeDraft] = useState({ title: "", content: "" });
  const [status, setStatus] = useState<"ready" | "saving" | "saved" | "error">("ready");
  const [statusMessage, setStatusMessage] = useState("");
  const [fieldMessages, setFieldMessages] = useState<Record<string, string>>({});
  const [previewReply, setPreviewReply] = useState("");
  const [pendingAction, setPendingAction] = useState<AgentBuilderAction>("");
  // A ref as well as the state above. Two clicks can land in the same tick,
  // before React has re-rendered the button as disabled, and the state read
  // from the first render's closure would still say the builder is idle.
  const runningAction = useRef<AgentBuilderAction>("");
  // The middle column scrolls independently of the page. Anything that has to be
  // READ -- a rejected field, a refusal to publish, a different section -- has to
  // be scrolled to, or it is written hundreds of pixels above the reader and the
  // action looks like it did nothing at all.
  const formColumn = useRef<HTMLElement>(null);

  function beginAction(action: AgentBuilderAction) {
    if (runningAction.current) return false;
    runningAction.current = action;
    setPendingAction(action);
    return true;
  }

  function finishAction() {
    runningAction.current = "";
    setPendingAction("");
  }

  function updateField(field: AgentFormField) {
    return (value: string) => {
      editedFields.current.add(field);
      setForm((current) => ({ ...current, [field]: value }));
    };
  }

  // Both are asked about once, and only once the writer is somewhere the answer
  // matters: the Appointments section, or any agent that already has booking
  // switched on and could be published from any section.
  const appointmentsInPlay = section === "appointments" || form.bookingEnabled === "true";
  const calendars = useCalendarOptions(appointmentsInPlay);
  // The connection question is about the calendar THIS agent books into, so
  // switching the chooser asks it again about the new one.
  const calendar = useCalendarConnection(appointmentsInPlay, form.bookingCalendar);
  const calendarName = calendarLabelFor(calendars.options, form.bookingCalendar);

  // What the marks beside each section in the sub-nav mean.
  //
  // They used to be `index < 3 && <Check/>` — the first three sections always
  // showed a green tick, on a brand new agent with every field empty, and the
  // last three never showed one however carefully they were filled in. A tick
  // that is always there is not a signal, and somebody reading it as one is
  // being told their agent is further along than it is.
  //
  // "done" is now: this section has nothing left to do. For the two OPTIONAL
  // features that means switched off as much as it means finished — there is
  // genuinely nothing outstanding either way. "attention" is the state worth
  // shouting about: switched ON and missing something it needs, which is the
  // half-configured case that produces a button failing in front of a visitor.
  // Everything else gets no mark, so a new agent is not a wall of warnings.
  const bookingSettingLabel = calendarOptionFor(calendars.options, form.bookingCalendar)?.settingLabel;
  // Same rule as the section's own green box: a provider list that could not be
  // read is "we do not know", which is not a tick.
  const bookingReady = calendars.state === "ready"
    && Boolean(form.bookingTimezone.trim())
    && (!bookingSettingLabel || Boolean(form.bookingCalendarSetting.trim()))
    && calendar.state === "connected";
  // The amber marks and the things publish() refuses have to be the SAME set,
  // or the marks are not worth reading. publish() hard-refuses on a blank
  // allowed domain, and the server refuses a blank name — so both of those are
  // "attention", not merely unmarked. Anything the marks stay quiet about is
  // something that genuinely does not stop you.
  const sectionStates: Record<string, "done" | "attention" | undefined> = {
    identity: form.name.trim() ? "done" : "attention",
    goal: form.systemPrompt.trim() ? "done" : undefined,
    knowledge: knowledge.length ? "done" : undefined,
    appearance: form.allowedDomain.trim() ? "done" : "attention",
    handoff: form.handoffEnabled !== "true" ? "done" : form.handoffNumber.trim() ? "done" : "attention",
    appointments: form.bookingEnabled !== "true" ? "done" : bookingReady ? "done" : "attention",
  };

  // The owner's own zone is right for nearly all of them, but reading it during
  // render would make the server's HTML disagree with the browser's. It is read
  // after mount instead, and never over a zone already chosen or loaded.
  useEffect(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!zone) return;
    setForm((current) => (current.bookingTimezone ? current : { ...current, bookingTimezone: zone }));
  }, []);

  useEffect(() => {
    if (!existing || !agentId) return;
    let active = true;
    loadAgentForm(agentId, () => editedFields.current).then((loaded) => {
      if (!active) return;
      setForm((current) => loaded.apply(current));
      setRecordId(loaded.agent.id);
      setPublished(loaded.agent.status === "published");
      setRevision(loaded.agent.revision);
      setKnowledge(loaded.agent.knowledge || []);
      garudaApi.listKnowledgeSources(agentId).then((sources) => {
        if (!active || !sources.length) return;
        setKnowledge(sources.map((source) => ({ id: source.id, type: source.type, title: source.name || source.title || "Knowledge source", content: source.text || source.content || "", status: source.status })));
      }).catch(() => undefined);
    }).catch(() => {
      if (active) setStatus("error");
    });
    return () => { active = false; };
  }, [agentId, existing]);

  function writePayload() {
    return {
      name: form.name,
      description: form.description,
      system_prompt: form.systemPrompt,
      welcome_message: form.greeting,
      branding: { primary_color: form.primaryColor, accent_color: form.accent, position: form.widgetPosition, launcher_text: form.launcherText, allowed_domains: form.allowedDomain.trim() ? [form.allowedDomain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "")] : [] },
      handoff: handoffPayloadFrom(form),
      booking: bookingPayloadFrom(form),
      ...(demoMode ? { knowledge } : {}),
    };
  }

  function reportFailure(error: unknown) {
    const messages = fieldMessagesFromError(error);
    setFieldMessages(messages);
    const rejectedSection = sectionForFieldMessages(messages);
    if (rejectedSection) setSection(rejectedSection);
    setStatusMessage(error instanceof ApiError && error.message ? error.message : "");
    setStatus("error");
    // Unconditionally, not only when the section changed. Every booking.* key
    // maps to "appointments", so a booking rejection while ON appointments left
    // setSection a no-op and the reader looking at the same unchanged screen.
    showTopOfSection();
  }

  // Puts the top of the form column in front of the reader. Called whenever
  // something has been written there for them to read.
  function showTopOfSection() {
    const column = formColumn.current;
    if (!column) return;
    try {
      column.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      // Older browsers take a number rather than options.
      column.scrollTop = 0;
    }
  }

  function beginSave() {
    setStatus("saving");
    setStatusMessage("");
    setFieldMessages({});
  }

  // Publishing and testing both save first, so the guard belongs on the
  // entry points rather than on this shared step.
  async function saveDraft() {
    beginSave();
    try {
      const creating = !recordId;
      const record = creating ? await garudaApi.createAgent(writePayload()) : await garudaApi.updateAgent(recordId, writePayload(), revision);
      setRecordId(record.id);
      setRevision(record.revision);
      setStatus("saved");
      // The address bar still said /app/agents/new, so a reload — or a browser
      // restoring the tab — started a SECOND agent from the same form and saved
      // that too. replace rather than push, so Back still leaves the builder
      // instead of returning to a "new agent" page for an agent that exists.
      if (creating && record.id) {
        router.replace(`/app/agents/${encodeURIComponent(record.id)}/edit?section=${encodeURIComponent(section)}`);
      }
      return record.id;
    } catch (error) {
      reportFailure(error);
      return "";
    }
  }

  async function saveDraftAction() {
    if (!beginAction("save")) return;
    try {
      await saveDraft();
    } finally {
      finishAction();
    }
  }

  async function publish() {
    if (!form.allowedDomain.trim()) {
      setSection("appearance");
      setFieldMessages({ "branding.allowed_domains": "Add the website domain where this agent may run." });
      setStatusMessage("Add an allowed domain before publishing");
      setStatus("error");
      showTopOfSection();
      return;
    }
    // Publishing appointments with no calendar behind them ships a button that
    // fails in front of a real visitor, and the owner would hear about it from
    // them. Only a definite answer blocks: a check that could not be made is not
    // evidence, so "unknown" and "checking" go through.
    if (form.bookingEnabled === "true" && (calendar.state === "missing" || calendar.state === "pending")) {
      setSection("appointments");
      setFieldMessages({
        "booking.calendar": calendar.state === "pending"
          ? `The ${calendarName} connection was started but never finished. Finish it on the Integrations page, or switch appointments off to publish without them.`
          : `Connect ${calendarName} on the Integrations page before publishing appointments, or switch appointments off.`,
      });
      setStatusMessage(`Connect ${calendarName} before publishing appointments`);
      setStatus("error");
      showTopOfSection();
      return;
    }
    if (!beginAction("publish")) return;
    try {
      const id = await saveDraft();
      if (!id) return;
      const result = await garudaApi.publishAgent(id);
      setRevision(result.published_version);
      setPublished(true);
      setStatus("saved");
    } catch (error) {
      reportFailure(error);
    } finally {
      finishAction();
    }
  }

  async function testAgent() {
    if (!beginAction("test")) return;
    try {
      const id = await saveDraft();
      if (!id) return;
      const result = await garudaApi.previewAgentMessage(id, "What can you help me with?");
      setPreviewReply(result.message.content);
    } catch (error) {
      reportFailure(error);
    } finally {
      finishAction();
    }
  }

  async function addKnowledge(title: string, content: string): Promise<boolean> {
    if (!beginAction("knowledge")) return false;
    const next = [...knowledge, { type: "text", title, content, status: "ready" }];
    if (demoMode) setKnowledge(next);
    beginSave();
    try {
      let id = recordId;
      let currentRevision = revision;
      if (!id) {
        const created = await garudaApi.createAgent(demoMode ? { ...writePayload(), knowledge: next } : writePayload());
        id = created.id;
        currentRevision = created.revision;
        setRecordId(created.id);
        setRevision(created.revision);
      }
      if (process.env.NEXT_PUBLIC_API_URL) {
        await garudaApi.addTextKnowledgeSource(id, title, content);
        const refreshed = await garudaApi.getAgent(id);
        setRevision(refreshed.revision);
        setKnowledge(refreshed.knowledge || []);
      } else {
        const saved = await garudaApi.updateAgent(id, { knowledge: next }, currentRevision);
        setRevision(saved.revision);
      }
      setStatus("saved");
      return true;
    } catch (error) {
      if (!demoMode && recordId) {
        try {
          const refreshed = await garudaApi.getAgent(recordId);
          setRevision(refreshed.revision);
          setKnowledge(refreshed.knowledge || []);
        } catch { /* Keep the last confirmed server state. */ }
      }
      reportFailure(error);
      return false;
    } finally {
      finishAction();
    }
  }

  return (
    <div className="-m-4 flex h-[calc(100vh-4rem)] flex-col overflow-hidden bg-white supports-[height:100dvh]:h-[calc(100dvh-4rem)] sm:-m-6 lg:-m-8">
      <div className="flex min-h-[4rem] shrink-0 flex-wrap items-center gap-y-2 border-b px-4 py-2 sm:h-16 sm:flex-nowrap sm:px-6 sm:py-0"><Button variant="ghost" size="icon" asChild><Link href="/app/agents"><ArrowLeft className="h-4 w-4" /></Link></Button><div className="ml-2 min-w-0 flex-1"><div className="flex min-w-0 items-center gap-2"><h1 className="truncate text-sm font-semibold text-slate-900">{existing ? `Edit ${form.name}` : "Create agent"}</h1><Badge variant={published ? "success" : "secondary"}>{published ? "Live" : "Draft"}</Badge></div><p className={cn("text-[10px]", status === "error" ? "text-red-500" : "text-slate-400")}>{status === "saving" ? "Saving draft…" : status === "saved" ? "Draft saved" : status === "error" ? (statusMessage || "Could not save — try again") : "Review and save your draft"}</p></div><div className="ml-auto flex shrink-0 basis-full justify-end gap-2 sm:basis-auto"><Button variant="outline" size="sm" onClick={saveDraftAction} loading={pendingAction === "save"} loadingLabel="Saving the draft" disabled={pendingAction !== "" && pendingAction !== "save"}><Save className="mr-1.5 h-3.5 w-3.5" /> Save</Button><Button variant="outline" size="sm" onClick={testAgent} loading={pendingAction === "test"} loadingLabel="Saving and testing the agent" disabled={pendingAction !== "" && pendingAction !== "test"}><Play className="mr-1.5 h-3.5 w-3.5" /> Test</Button><Button size="sm" onClick={publish} loading={pendingAction === "publish"} loadingLabel={published ? "Publishing your updates" : "Publishing the agent"} disabled={pendingAction !== "" && pendingAction !== "publish"}><Sparkles className="mr-1.5 h-3.5 w-3.5" /> <span className="hidden sm:inline">{published ? "Publish updates" : "Publish agent"}</span><span className="sm:hidden">Publish</span></Button></div></div>
      <div className="grid min-h-0 flex-1 lg:grid-cols-[205px_1fr] xl:grid-cols-[205px_1fr_330px] 2xl:grid-cols-[230px_1fr_440px]">
        <aside className="hidden min-h-0 overflow-y-auto border-r bg-slate-50/60 p-3 lg:block">
          <p className="px-3 py-3 text-[10px] font-bold uppercase tracking-[.16em] text-slate-400">Configure</p>
          <nav className="space-y-1">{sections.map((item) => <button key={item.id} onClick={() => { setSection(item.id); showTopOfSection(); }} className={cn("flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-xs font-medium transition", section === item.id ? "bg-white text-indigo-700 shadow-sm ring-1 ring-slate-200" : "text-slate-600 hover:bg-white")}><item.icon className={cn("h-4 w-4 shrink-0", section === item.id ? "text-indigo-600" : "text-slate-400")} /><span className="min-w-0 flex-1 truncate">{item.label}</span>{sectionStates[item.id] === "done" ? <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" aria-label="Nothing left to do here" /> : sectionStates[item.id] === "attention" ? <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-label="Switched on but not finished" /> : null}</button>)}</nav>
          <div className="mt-6 rounded-xl border border-indigo-100 bg-indigo-50 p-3"><p className="flex items-center gap-1.5 text-[10px] font-semibold text-indigo-800"><Sparkles className="h-3.5 w-3.5" /> Garuda tip</p><p className="mt-2 text-[10px] leading-4 text-indigo-700">Give each agent one clear outcome. Focused instructions are easier to review, test, and improve.</p></div>
        </aside>

        <section ref={formColumn} className="min-h-0 overflow-y-auto px-5 py-7 sm:px-8 xl:px-12">
          <div className="mx-auto max-w-2xl">
            <div className="mb-6 flex gap-2 overflow-x-auto lg:hidden">{sections.map((item) => <button key={item.id} onClick={() => { setSection(item.id); showTopOfSection(); }} className={cn("shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium", section === item.id ? "border-indigo-200 bg-indigo-50 text-indigo-700" : "bg-white text-slate-500")}>{item.label}</button>)}</div>
            <UnlistedMessages messages={fieldMessages} />
            {section === "identity" && <IdentitySection name={form.name} setName={updateField("name")} description={form.description} setDescription={updateField("description")} greeting={form.greeting} setGreeting={updateField("greeting")} messages={fieldMessages} />}
            {section === "goal" && <GoalSection systemPrompt={form.systemPrompt} setSystemPrompt={updateField("systemPrompt")} messages={fieldMessages} />}
            {section === "knowledge" && <KnowledgeSection knowledge={knowledge} draft={knowledgeDraft} setDraft={setKnowledgeDraft} onAdd={addKnowledge} messages={fieldMessages} saving={pendingAction === "knowledge"} blocked={pendingAction !== "" && pendingAction !== "knowledge"} agentId={recordId} />}
            {section === "appearance" && <AppearanceSection primaryColor={form.primaryColor} setPrimaryColor={updateField("primaryColor")} accent={form.accent} setAccent={updateField("accent")} launcherText={form.launcherText} setLauncherText={updateField("launcherText")} widgetPosition={form.widgetPosition} setWidgetPosition={updateField("widgetPosition")} allowedDomain={form.allowedDomain} setAllowedDomain={updateField("allowedDomain")} messages={fieldMessages} />}
            {section === "handoff" && <HandoffSection enabled={form.handoffEnabled === "true"} setEnabled={(next) => updateField("handoffEnabled")(next ? "true" : "false")} number={form.handoffNumber} setNumber={updateField("handoffNumber")} label={form.handoffLabel} setLabel={updateField("handoffLabel")} message={form.handoffMessage} setMessage={updateField("handoffMessage")} availability={form.handoffAvailability} setAvailability={updateField("handoffAvailability")} triggers={form.handoffTriggers} setTriggers={updateField("handoffTriggers")} autoOffer={form.handoffAutoOffer} setAutoOffer={updateField("handoffAutoOffer")} notifyEmail={form.handoffNotifyEmail} setNotifyEmail={updateField("handoffNotifyEmail")} messages={fieldMessages} />}
            {section === "appointments" && <BookingSection live={published} enabled={form.bookingEnabled === "true"} setEnabled={(next) => updateField("bookingEnabled")(next ? "true" : "false")} calendars={calendars} calendarToolkit={form.bookingCalendar} setCalendarToolkit={updateField("bookingCalendar")} calendarSetting={form.bookingCalendarSetting} setCalendarSetting={updateField("bookingCalendarSetting")} timezone={form.bookingTimezone} setTimezone={updateField("bookingTimezone")} duration={form.bookingDuration} setDuration={updateField("bookingDuration")} startHour={form.bookingStartHour} setStartHour={updateField("bookingStartHour")} endHour={form.bookingEndHour} setEndHour={updateField("bookingEndHour")} weekdays={form.bookingWeekdays} setWeekdays={updateField("bookingWeekdays")} leadDays={form.bookingLeadDays} setLeadDays={updateField("bookingLeadDays")} noticeHours={form.bookingNoticeHours} setNoticeHours={updateField("bookingNoticeHours")} label={form.bookingLabel} setLabel={updateField("bookingLabel")} title={form.bookingTitle} setTitle={updateField("bookingTitle")} preview={bookingPreviewSentence(form, form.name, calendars.options)} calendar={calendar} messages={fieldMessages} />}
            <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t pt-5">
              <Button variant="ghost" size="sm" disabled={section === "identity"} onClick={() => { setSection(sections[Math.max(0, sections.findIndex((item) => item.id === section) - 1)].id); showTopOfSection(); }}>Previous</Button>
              {section === sections[sections.length - 1].id ? (
                <Button size="sm" onClick={publish} loading={pendingAction === "publish"} loadingLabel={published ? "Publishing your updates" : "Publishing the agent"} disabled={pendingAction !== "" && pendingAction !== "publish"}>
                  <Sparkles className="mr-1.5 h-3.5 w-3.5" /> {published ? "Publish updates" : "Publish agent"}
                </Button>
              ) : (
                <Button size="sm" onClick={() => { const index = sections.findIndex((item) => item.id === section); setSection(sections[index + 1].id); showTopOfSection(); }}>
                  Next section <ChevronRight className="ml-1.5 h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </div>
        </section>

        <aside className="hidden min-h-0 overflow-y-auto border-l bg-[#f7f8fb] p-5 xl:block">
          <div className="mb-3 flex items-center justify-between"><p className="text-xs font-semibold text-slate-700">Live preview</p><div className="flex rounded-lg border bg-white p-0.5">{(["desktop", "mobile"] as const).map((device) => <button key={device} type="button" onClick={() => setPreviewDevice(device)} aria-pressed={previewDevice === device} className={cn("rounded-md px-2 py-1 text-[9px] capitalize", previewDevice === device ? "bg-slate-100 font-semibold text-slate-900" : "text-slate-400")}>{device}</button>)}</div></div>
          <ChatPreview name={form.name} greeting={form.greeting} accent={form.accent} previewReply={previewReply} device={previewDevice} />
        </aside>
      </div>
    </div>
  );
}

function FieldMessage({ message }: { message?: string }) {
  if (!message) return null;
  // role="alert" so a rejected save is announced where it happened, rather than
  // only appearing beside a field the writer may not be looking at.
  return <p role="alert" className="text-[10px] text-red-500">{message}</p>;
}

function UnlistedMessages({ messages }: { messages: Record<string, string> }) {
  const lines = unlistedFieldMessages(messages);
  if (!lines.length) return null;
  return <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4"><p className="text-xs font-semibold text-red-700">The server rejected this draft</p><ul className="mt-2 space-y-1">{lines.map((line) => <li key={line} className="text-[10px] leading-4 text-red-600">{line}</li>)}</ul></div>;
}

function SectionHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <div className="mb-7"><p className="text-[10px] font-bold uppercase tracking-[.16em] text-indigo-600">{eyebrow}</p><h2 className="mt-2 text-2xl font-bold tracking-[-.035em] text-slate-950">{title}</h2><p className="mt-2 text-sm leading-6 text-slate-500">{description}</p></div>;
}

function IdentitySection({ name, setName, description, setDescription, greeting, setGreeting, messages }: { name: string; setName: (value: string) => void; description: string; setDescription: (value: string) => void; greeting: string; setGreeting: (value: string) => void; messages: Record<string, string> }) {
  return <><SectionHeading eyebrow="Identity" title="Make your agent feel like part of the team." description="Give it a recognizable name, clear role, and a warm opening that sounds like your business." /><div className="space-y-6"><div className="space-y-2"><Label htmlFor="agent-name">Agent name</Label><Input id="agent-name" value={name} onChange={(event) => setName(event.target.value)} /><FieldMessage message={messages.name} /><p className="text-[10px] text-slate-400">Short, human names usually feel the most approachable.</p></div><div className="space-y-2"><Label htmlFor="agent-description">Role description</Label><Input id="agent-description" value={description} onChange={(event) => setDescription(event.target.value)} /><FieldMessage message={messages.description} /></div><div className="space-y-2"><Label htmlFor="greeting">Opening greeting</Label><Textarea id="greeting" value={greeting} onChange={(event) => setGreeting(event.target.value)} className="min-h-[110px]" /><FieldMessage message={messages.welcome_message} /><div className="flex justify-between text-[10px] text-slate-400"><span>Be warm, specific and easy to answer.</span><span>{greeting.length}/240</span></div></div></div></>;
}

function GoalSection({ systemPrompt, setSystemPrompt, messages }: { systemPrompt: string; setSystemPrompt: (value: string) => void; messages: Record<string, string> }) {
  const templates = [
    { title: "Sales guide", prompt: "Help visitors understand the offer, answer only from approved knowledge, qualify intent, and offer a human follow-up when useful." },
    { title: "Lead qualification", prompt: "Ask concise questions to understand visitor fit. Use only approved knowledge, request contact details with explicit consent, and explain the next step clearly." },
    { title: "Customer support", prompt: "Answer customer questions accurately using only approved knowledge. Say when information is unavailable and recommend a human follow-up for unresolved issues." },
  ];
  return <><SectionHeading eyebrow="Goal & behavior" title="Give every conversation a clear purpose." description="These instructions are persisted with the agent and used by the private preview and published widget." /><div className="space-y-5"><div><p className="text-xs font-semibold text-slate-800">Start from a template</p><div className="mt-3 grid gap-2 sm:grid-cols-3">{templates.map((template) => <button key={template.title} type="button" onClick={() => setSystemPrompt(template.prompt)} className="rounded-xl border p-3 text-left text-xs font-semibold text-slate-700 transition hover:border-indigo-300 hover:bg-indigo-50">{template.title}</button>)}</div></div><div className="space-y-2"><Label htmlFor="agent-instructions">Agent instructions</Label><Textarea id="agent-instructions" value={systemPrompt} onChange={(event) => setSystemPrompt(event.target.value)} className="min-h-[180px]" /><FieldMessage message={messages.system_prompt} /><p className="text-[10px] text-slate-400">Keep instructions focused. Knowledge sources provide the factual context.</p></div></div></>;
}

function KnowledgeSection({ knowledge, draft, setDraft, onAdd, messages, saving, blocked, agentId }: { knowledge: AgentRecord["knowledge"]; draft: { title: string; content: string }; setDraft: (next: { title: string; content: string }) => void; onAdd: (title: string, content: string) => Promise<boolean>; messages: Record<string, string>; saving: boolean; blocked: boolean; agentId: string }) {
  const { title, content } = draft;
  const setTitle = (next: string) => setDraft({ title: next, content });
  const setContent = (next: string) => setDraft({ title, content: next });
  return <><SectionHeading eyebrow="Knowledge" title="Teach your agent what your team already knows." description="Add approved text Garuda can use when it answers. Each source is stored and processed separately." /><div className="space-y-4">{knowledge.map((source, index) => { const sourceStatus = source.status || "ready"; return <div key={source.id || `${source.title}-${index}`} className="flex items-center gap-3 rounded-xl border p-4"><span className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-50 text-indigo-600"><BrainCircuit className="h-5 w-5" /></span><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold text-slate-900">{source.title}</p><p className="mt-1 text-[10px] text-slate-400">Text source · {source.content.length} characters</p></div><Badge variant={sourceStatus === "ready" ? "success" : sourceStatus === "failed" ? "warning" : "secondary"} className="capitalize">{sourceStatus}</Badge></div>; })}<div className="rounded-xl border border-dashed p-4"><p className="flex items-center gap-2 text-xs font-semibold text-slate-800"><UploadCloud className="h-4 w-4 text-indigo-600" /> Add a text knowledge source</p><div className="mt-3 space-y-2"><Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Source title, e.g. Pricing FAQ" /><Textarea value={content} onChange={(event) => setContent(event.target.value)} placeholder="Paste accurate product, service, pricing or policy information…" className="min-h-[110px]" /><FieldMessage message={messages.knowledge} /><Button variant="outline" loading={saving} loadingLabel="Saving the knowledge source" disabled={blocked || !title.trim() || !content.trim()} onClick={async () => { if (await onAdd(title.trim(), content.trim())) setDraft({ title: "", content: "" }); }}>Add and save source</Button></div></div><WebsiteImport agentId={agentId} onSave={onAdd} blocked={blocked} /></div></>;
}

function AppearanceSection({ primaryColor, setPrimaryColor, accent, setAccent, launcherText, setLauncherText, widgetPosition, setWidgetPosition, allowedDomain, setAllowedDomain, messages }: { primaryColor: string; setPrimaryColor: (value: string) => void; accent: string; setAccent: (value: string) => void; launcherText: string; setLauncherText: (value: string) => void; widgetPosition: string; setWidgetPosition: (value: string) => void; allowedDomain: string; setAllowedDomain: (value: string) => void; messages: Record<string, string> }) {
  const colors = ["#635BFF", "#7C3AED", "#0F766E", "#0284C7", "#E11D48", "#0F172A"];
  return <><SectionHeading eyebrow="Appearance" title="Make the widget look at home on your site." description="Match your colors and approve the website where this agent can run." /><div className="space-y-6"><div><Label>Accent color</Label><div className="mt-3 flex flex-wrap gap-3">{colors.map((color) => <button key={color} onClick={() => setAccent(color)} className={cn("grid h-10 w-10 place-items-center rounded-full border-4 border-white shadow-sm ring-offset-2", accent === color && "ring-2 ring-slate-400")} style={{ backgroundColor: color }} aria-label={`Use ${color}`}>{accent === color && <Check className="h-4 w-4 text-white" />}</button>)}</div><FieldMessage message={messages["branding.colors"]} /></div><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="primary-color">Header color</Label><Input id="primary-color" value={primaryColor} onChange={(event) => setPrimaryColor(event.target.value)} /></div><div className="space-y-2"><Label htmlFor="custom-color">Accent color</Label><Input id="custom-color" value={accent} onChange={(event) => setAccent(event.target.value)} /></div><div className="space-y-2"><Label htmlFor="launcher-text">Launcher text</Label><Input id="launcher-text" value={launcherText} onChange={(event) => setLauncherText(event.target.value)} /></div><div className="space-y-2"><Label htmlFor="widget-position">Widget position</Label><select id="widget-position" value={widgetPosition} onChange={(event) => setWidgetPosition(event.target.value)} className="h-11 w-full rounded-lg border bg-white px-3 text-sm"><option value="bottom_right">Bottom right</option><option value="bottom_left">Bottom left</option></select><FieldMessage message={messages["branding.position"]} /></div></div><div className="space-y-2"><Label htmlFor="allowed-domain">Allowed website domain</Label><Input id="allowed-domain" value={allowedDomain} onChange={(event) => setAllowedDomain(event.target.value)} placeholder="yourcompany.com" /><FieldMessage message={messages["branding.allowed_domains"]} /><p className="text-[10px] text-slate-400">Required to publish. Garuda rejects widget sessions from any other domain.</p></div></div></>;
}

type HandoffSectionProps = {
  enabled: boolean;
  setEnabled: (value: boolean) => void;
  number: string;
  setNumber: (value: string) => void;
  label: string;
  setLabel: (value: string) => void;
  message: string;
  setMessage: (value: string) => void;
  availability: string;
  setAvailability: (value: string) => void;
  triggers: string;
  setTriggers: (value: string) => void;
  autoOffer: string;
  setAutoOffer: (value: string) => void;
  notifyEmail: string;
  setNotifyEmail: (value: string) => void;
  messages: Record<string, string>;
};

function HandoffSection({ enabled, setEnabled, number, setNumber, label, setLabel, message, setMessage, availability, setAvailability, triggers, setTriggers, autoOffer, setAutoOffer, notifyEmail, setNotifyEmail, messages }: HandoffSectionProps) {
  // The digits are what the wa.me link is built from, so the preview shows the
  // exact link a visitor will open rather than a prettier approximation of it.
  const digits = number.replace(/\D+/g, "");
  const previewMessage = message.trim() || "Hi, I was chatting on your website and would like to speak with someone.";
  return <><SectionHeading eyebrow="Handoff rules" title="Hand the conversation to a person on WhatsApp." description="When the assistant cannot help, the visitor taps one button and lands in a WhatsApp chat with you. Nothing to install, on either side." />
    <div className="space-y-6">
      <label htmlFor="handoff-enabled" className="flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition hover:border-indigo-200">
        <input id="handoff-enabled" type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-indigo-600" />
        <span><span className="block text-xs font-semibold text-slate-900">Offer a WhatsApp handoff</span><span className="mt-1 block text-[10px] leading-4 text-slate-500">A &ldquo;talk to a person&rdquo; button appears in the widget once this is published.</span></span>
      </label>

      <div className="space-y-2">
        <Label htmlFor="handoff-number">Your WhatsApp number</Label>
        <Input id="handoff-number" value={number} onChange={(event) => setNumber(event.target.value)} placeholder="+91 98765 43210" inputMode="tel" autoComplete="tel" aria-describedby="handoff-number-hint" />
        <FieldMessage message={messages["handoff.whatsapp_number"]} />
        <p id="handoff-number-hint" className="text-[10px] text-slate-400">Include the country code. Spaces, dashes and brackets are fine — Garuda stores {digits ? `+${digits}` : "the digits"}. Your number is never shown on your website; visitors only see the button.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="handoff-label">Button label</Label>
          <Input id="handoff-label" value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Talk to a person on WhatsApp" />
          <FieldMessage message={messages["handoff.button_label"]} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="handoff-availability">When you reply</Label>
          <Input id="handoff-availability" value={availability} onChange={(event) => setAvailability(event.target.value)} placeholder="Mon–Fri, 9am–6pm IST" />
          <FieldMessage message={messages["handoff.availability"]} />
          <p className="text-[10px] text-slate-400">Shown under the button, so nobody reads a night-time silence as being ignored.</p>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="handoff-message">Message we type for them</Label>
        <Textarea id="handoff-message" value={message} onChange={(event) => setMessage(event.target.value)} className="min-h-[80px]" placeholder="Hi, I was chatting on your website and would like to speak with someone." />
        <FieldMessage message={messages["handoff.message"]} />
        <p className="text-[10px] text-slate-400">WhatsApp opens with this in the box and the page they were on beneath it. The visitor still presses send.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="handoff-auto-offer">Offer it automatically after</Label>
          <select id="handoff-auto-offer" value={autoOffer} onChange={(event) => setAutoOffer(event.target.value)} className="h-11 w-full rounded-lg border bg-white px-3 text-sm">
            <option value="0">Only when they ask</option>
            <option value="3">3 messages</option>
            <option value="5">5 messages</option>
            <option value="8">8 messages</option>
          </select>
          <FieldMessage message={messages["handoff.auto_offer_after"]} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="handoff-notify">Email me when this happens</Label>
          <Input id="handoff-notify" value={notifyEmail} onChange={(event) => setNotifyEmail(event.target.value)} placeholder="you@yourcompany.com" type="email" autoComplete="email" />
          <FieldMessage message={messages["handoff.notify_email"]} />
          <p className="text-[10px] text-slate-400">Optional. One email per conversation, so a missed WhatsApp message is a choice rather than an accident.</p>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="handoff-triggers">Phrases that offer it straight away</Label>
        <Input id="handoff-triggers" value={triggers} onChange={(event) => setTriggers(event.target.value)} placeholder="human, real person, speak to someone" />
        <p className="text-[10px] text-slate-400">Comma separated, up to twelve. Matching is case-insensitive and looks anywhere in what the visitor typed.</p>
      </div>

      {enabled && digits.length >= 8 ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="flex items-center gap-1.5 text-[10px] font-semibold text-emerald-800"><Check className="h-3.5 w-3.5" /> Ready after you publish</p>
          <p className="mt-2 break-all text-[10px] leading-4 text-emerald-700">Visitors will open <span className="font-mono">https://wa.me/{digits}</span> with &ldquo;{previewMessage}&rdquo; already typed.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed bg-slate-50 p-4">
          <p className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-700"><Settings2 className="h-3.5 w-3.5 text-indigo-500" /> Not active yet</p>
          <p className="mt-2 text-[10px] leading-4 text-slate-500">{enabled ? "Add a WhatsApp number with its country code to switch the button on." : "Tick the box above, add your WhatsApp number, then publish."}</p>
        </div>
      )}
    </div></>;
}

type BookingSectionProps = {
  live: boolean;
  enabled: boolean;
  setEnabled: (value: boolean) => void;
  calendars: CalendarOptions;
  calendarToolkit: string;
  setCalendarToolkit: (value: string) => void;
  calendarSetting: string;
  setCalendarSetting: (value: string) => void;
  timezone: string;
  setTimezone: (value: string) => void;
  duration: string;
  setDuration: (value: string) => void;
  startHour: string;
  setStartHour: (value: string) => void;
  endHour: string;
  setEndHour: (value: string) => void;
  weekdays: string;
  setWeekdays: (value: string) => void;
  leadDays: string;
  setLeadDays: (value: string) => void;
  noticeHours: string;
  setNoticeHours: (value: string) => void;
  label: string;
  setLabel: (value: string) => void;
  title: string;
  setTitle: (value: string) => void;
  preview: string;
  calendar: CalendarConnection;
  messages: Record<string, string>;
};

// Bounded by validateBooking: four hours per appointment, sixty days ahead, a
// week of notice at most. Offering a value the server rejects is a round trip
// spent telling somebody they may not have what the form let them pick.
const durationChoices = [15, 20, 30, 45, 60, 90, 120, 180, 240];
const leadDayChoices = [7, 14, 30, 60];
const noticeChoices = [0, 1, 2, 4, 12, 24, 48, 168];
// Monday first. A working week drawn from Sunday reads as a mistake to nearly
// everyone who sits down to configure one.
const weekdayOrder = [1, 2, 3, 4, 5, 6, 0];

// A stored value none of the choices lists — set through the API, or by a later
// version of this form — is added to the picker. Without this the select would
// paint its first option while the form still held the stored number, and the
// writer would save a value they never saw.
function withCurrent(choices: number[], value: string) {
  const current = Number.parseInt(value, 10);
  if (!Number.isInteger(current) || choices.includes(current)) return choices;
  return [...choices, current].sort((first, second) => first - second);
}

function noticeChoiceLabel(hours: number) {
  if (hours <= 0) return "No minimum";
  if (hours % 24 === 0) return `${hours / 24} day${hours === 24 ? "" : "s"}`;
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

// WHICH calendar this agent books into. One per agent, deliberately: "when are
// you free" has to have a single answer, so this is a choice and not a set of
// switches.
//
// Everything shown here is the server's own answer. The list decides what may be
// chosen, the provider's own words label the one field it asks for, and a
// calendar that finishes the booking on its own page says so before the owner
// picks it rather than after their visitor has been sent somewhere unexpected.
function CalendarChooser({ calendars, toolkit, setToolkit, setting, setSetting, messages }: { calendars: CalendarOptions; toolkit: string; setToolkit: (value: string) => void; setting: string; setSetting: (value: string) => void; messages: Record<string, string> }) {
  const chosen = normalizeCalendar(toolkit);
  const option = calendarOptionFor(calendars.options, chosen);
  // The chosen calendar is always among the options, even when the list could
  // not be loaded. Same reason as withCurrent above: a select painting its first
  // option while the form still holds another is how somebody saves a diary they
  // never picked.
  const choices = calendars.options.map((entry) => ({ toolkit: entry.toolkit, label: entry.label }));
  if (!choices.some((entry) => entry.toolkit === chosen)) choices.push({ toolkit: chosen, label: calendarLabelFor(calendars.options, chosen) });

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="booking-calendar">Calendar to book into</Label>
        <select id="booking-calendar" value={chosen} onChange={(event) => setToolkit(event.target.value)} disabled={calendars.state !== "ready"} aria-describedby="booking-calendar-state" className="h-11 w-full rounded-lg border bg-white px-3 text-sm disabled:bg-slate-50 disabled:text-slate-500">
          {choices.map((entry) => <option key={entry.toolkit} value={entry.toolkit}>{entry.label}</option>)}
        </select>
        {calendars.state !== "ready" && (
          <p id="booking-calendar-state" className="flex items-center gap-1.5 text-[10px] text-slate-500">
            {calendars.state === "loading" ? <><RefreshCw className="h-3 w-3 animate-spin" aria-hidden /> Loading the calendars you can choose from…</> : "You cannot change calendar until the list below loads. This agent keeps the one it already has."}
          </p>
        )}
        <FieldMessage message={messages["booking.calendar"]} />
        <p className="text-[10px] leading-4 text-slate-400">{option?.useCase || "One agent books into one calendar, so every answer it gives about your free time comes from the same place."}</p>
      </div>

      {calendars.state === "unavailable" && (
        <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4">
          <p className="flex items-center gap-1.5 text-[10px] font-semibold text-amber-900"><AlertTriangle className="h-3.5 w-3.5 shrink-0" /> The calendars you can choose from could not be listed</p>
          <p className="mt-2 text-[10px] leading-4 text-amber-800">{calendars.detail} This agent keeps the calendar it already has, and anything that calendar needs configuring cannot be shown until the list loads.</p>
          <Button variant="ghost" size="sm" className="mt-2" onClick={calendars.reload}><RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Try again</Button>
        </div>
      )}

      {(option?.settingLabel || (calendars.state !== "ready" && setting.trim())) && (
        <div className="space-y-2">
          <Label htmlFor="booking-calendar-setting">{option?.settingLabel || "What this calendar needs"}</Label>
          <Input id="booking-calendar-setting" value={setting} onChange={(event) => setSetting(event.target.value)} autoComplete="off" spellCheck={false} aria-describedby="booking-calendar-setting-hint" />
          <FieldMessage message={messages["booking.calendar_setting"]} />
          <p id="booking-calendar-setting-hint" className="text-[10px] leading-4 text-slate-400">{option ? `${option.settingHint} ${option.label} cannot offer a time without it, and this draft will not save while it is empty.` : "The list of calendars could not be loaded, so this is shown as it was saved. It is the one value your calendar needs beyond the connection itself."}</p>
        </div>
      )}

      {option && !option.booksInChat && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
          <p className="flex items-center gap-1.5 text-[10px] font-semibold text-amber-900"><ExternalLink className="h-3.5 w-3.5 shrink-0" /> {option.label} finishes the booking on its own page</p>
          <p className="mt-2 text-[10px] leading-4 text-amber-800">{option.note || `${option.label} completes the booking on its own page, so the visitor finishes there rather than in the chat.`}</p>
          <p className="mt-2 text-[10px] leading-4 text-amber-800">Garuda never writes the event, so nothing is booked until the visitor finishes on that page — and an appointment made there does not appear in your Appointments list, which only holds what Garuda booked.</p>
        </div>
      )}
    </div>
  );
}

// The one thing that decides whether any of this works. Appointments run against
// the calendar chosen above, so a workspace that has connected a DIFFERENT one
// is still a button that fails in front of a visitor.
function CalendarPrerequisite({ calendar, label, option }: { calendar: CalendarConnection; label: string; option?: CalendarOption }) {
  const connected = calendar.state === "connected";
  const blocked = calendar.state === "missing" || calendar.state === "pending";
  // Only a provider the list described may be promised an event: an unlisted one
  // gets the half of the sentence that is true of all of them.
  const connectedBody = !option ? `Garuda reads free time from this calendar to offer the visitor a slot.`
    : option.booksInChat ? "Garuda reads free time from this calendar and writes each appointment into it."
    : `Garuda reads your availability from ${label}; the visitor finishes the booking on its own page.`;
  const heading = connected ? `${label} is connected`
    : calendar.state === "checking" ? `Checking your ${label} connection…`
    : calendar.state === "missing" ? `Connect ${label} before you switch this on`
    : calendar.state === "pending" ? `Finish connecting ${label}`
    : `Appointments need a connected ${label}`;
  const body = connected ? connectedBody
    : calendar.state === "checking" ? "Reading your connected accounts."
    : calendar.state === "missing" ? `This workspace has no ${label} connection, so nothing on this page can be offered to a visitor yet. Connecting a different calendar does not help: this agent books into ${label} and nowhere else.`
    : calendar.state === "pending" ? `The ${label} connection was started but never finished signing in, so it cannot be used yet.`
    : calendar.detail || `Connect ${label} on the Integrations page. Until then a visitor who taps the button gets an apology instead of an appointment.`;
  return (
    <div role={blocked ? "alert" : undefined} className={cn("rounded-xl border p-4", connected ? "border-emerald-200 bg-emerald-50" : blocked ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-slate-50")}>
      <p className={cn("flex items-center gap-1.5 text-[10px] font-semibold", connected ? "text-emerald-800" : blocked ? "text-amber-900" : "text-slate-700")}>
        {connected ? <CalendarCheck className="h-3.5 w-3.5 shrink-0" /> : blocked ? <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> : <CalendarClock className="h-3.5 w-3.5 shrink-0" />}
        {heading}
      </p>
      <p className={cn("mt-2 text-[10px] leading-4", connected ? "text-emerald-700" : blocked ? "text-amber-800" : "text-slate-500")}>{body}</p>
      {!connected && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" asChild><Link href="/app/integrations">Open Integrations <ExternalLink className="ml-1.5 h-3.5 w-3.5" /></Link></Button>
          <Button variant="ghost" size="sm" onClick={calendar.recheck} disabled={calendar.state === "checking"}><RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", calendar.state === "checking" && "animate-spin")} /> Check again</Button>
        </div>
      )}
    </div>
  );
}

function BookingSection({ live, enabled, setEnabled, calendars, calendarToolkit, setCalendarToolkit, calendarSetting, setCalendarSetting, timezone, setTimezone, duration, setDuration, startHour, setStartHour, endHour, setEndHour, weekdays, setWeekdays, leadDays, setLeadDays, noticeHours, setNoticeHours, label, setLabel, title, setTitle, preview, calendar, messages }: BookingSectionProps) {
  const [zoneChoices, setZoneChoices] = useState<string[]>([]);
  const selectedDays = weekdaysFrom(weekdays);

  // The zone list is a browser capability and an old browser has none, so it is
  // read after mount inside a guard rather than during render.
  useEffect(() => {
    try {
      setZoneChoices(Intl.supportedValuesOf("timeZone"));
    } catch {
      setZoneChoices([]);
    }
  }, []);

  function toggleDay(day: number) {
    const next = selectedDays.includes(day) ? selectedDays.filter((value) => value !== day) : [...selectedDays, day].sort((first, second) => first - second);
    setWeekdays(next.join(","));
  }

  const chosen = calendarOptionFor(calendars.options, calendarToolkit);
  const calendarName = calendarLabelFor(calendars.options, calendarToolkit);
  // A setting the chosen calendar asks for and has not been given is refused by
  // the server on save, so it is one of the things standing between this draft
  // and a working button.
  const settingMissing = Boolean(chosen?.settingLabel) && !calendarSetting.trim();
  // calendars.state must be "ready" too. Without the provider list nothing here
  // knows what the chosen calendar requires, so a green tick would be asserting
  // something this screen cannot actually check.
  const ready = enabled && calendars.state === "ready" && Boolean(timezone.trim()) && !settingMissing && calendar.state === "connected";
  const blockedReason = !enabled ? (live ? "Switch appointments on and save, and visitors can book straight away." : "Switch appointments on, then publish.")
    : calendars.state !== "ready" ? "The list of calendars could not be loaded, so this page cannot confirm your settings are complete. Your saved configuration is untouched."
    : !timezone.trim() ? "Choose the time zone your working hours are in — without it the widget will not offer appointments at all."
    : settingMissing ? `${calendarName} needs its ${(chosen?.settingLabel || "").toLowerCase()} before it can offer a single time.`
    : calendar.state === "connected" ? ""
    : calendar.state === "checking" ? `Waiting on the ${calendarName} check.`
    : `Connect ${calendarName} on the Integrations page. ${live ? "Saving without it leaves visitors a button that cannot book anything." : "Publishing without it gives visitors a button that cannot book anything."}`;

  return <><SectionHeading eyebrow="Appointments" title="Let visitors book a real slot in your calendar." description="The assistant offers times that are genuinely free in the calendar you choose below, and the visitor picks one before they close the tab." />
    <div className="space-y-6">
      <CalendarChooser calendars={calendars} toolkit={calendarToolkit} setToolkit={setCalendarToolkit} setting={calendarSetting} setSetting={setCalendarSetting} messages={messages} />

      <CalendarPrerequisite calendar={calendar} label={calendarName} option={chosen} />

      <label htmlFor="booking-enabled" className="flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition hover:border-indigo-200">
        <input id="booking-enabled" type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-indigo-600" />
        <span><span className="block text-xs font-semibold text-slate-900">Let visitors book appointments</span><span className="mt-1 block text-[10px] leading-4 text-slate-500">{chosen && !chosen.booksInChat ? `Visitors are offered your real availability and finish the booking on ${calendarName}'s own page rather than in the chat, so nothing is written into a diary from here.` : `Each booking becomes a real event in ${calendarName} — the same diary you and your team work from. Garuda only ever creates an event a visitor explicitly chose, but there is no undo from here.`}</span></span>
      </label>

      <div className="space-y-2">
        <Label htmlFor="booking-timezone">Your time zone</Label>
        <Input id="booking-timezone" value={timezone} onChange={(event) => setTimezone(event.target.value)} list="booking-timezones" placeholder="Asia/Kolkata" autoComplete="off" spellCheck={false} aria-describedby="booking-timezone-hint" />
        <datalist id="booking-timezones">{zoneChoices.map((zone) => <option key={zone} value={zone} />)}</datalist>
        <FieldMessage message={messages["booking.timezone"]} />
        <p id="booking-timezone-hint" className="text-[10px] text-slate-400">Filled in from this browser. It has to be a zone name such as Asia/Kolkata or Europe/London — an abbreviation like IST is rejected, because it means two different hours in two different countries.</p>
      </div>

      <div role="group" aria-labelledby="booking-hours-label">
        <p id="booking-hours-label" className="text-sm font-medium leading-none text-slate-900">Working hours</p>
        <div className="mt-2 grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="booking-start-hour" className="text-[10px] font-normal text-slate-500">Day starts</Label>
            <select id="booking-start-hour" value={startHour} onChange={(event) => setStartHour(event.target.value)} className="h-11 w-full rounded-lg border bg-white px-3 text-sm">{Array.from({ length: 24 }, (unused, hour) => <option key={hour} value={hour}>{hourLabel(hour)}</option>)}</select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="booking-end-hour" className="text-[10px] font-normal text-slate-500">Day ends</Label>
            <select id="booking-end-hour" value={endHour} onChange={(event) => setEndHour(event.target.value)} className="h-11 w-full rounded-lg border bg-white px-3 text-sm">{Array.from({ length: 24 }, (unused, index) => index + 1).map((hour) => <option key={hour} value={hour}>{hour === 24 ? "Midnight" : hourLabel(hour)}</option>)}</select>
          </div>
        </div>
        <div className="mt-2"><FieldMessage message={messages["booking.hours"]} /></div>
        <p className="mt-2 text-[10px] text-slate-400">In your time zone. Nothing outside these hours is ever offered, so a visitor cannot take 3am because the calendar happened to be free.</p>
      </div>

      <div>
        <p id="booking-weekdays-label" className="text-sm font-medium leading-none text-slate-900">Days you take appointments</p>
        <div role="group" aria-labelledby="booking-weekdays-label" className="mt-2 flex flex-wrap gap-2">
          {weekdayOrder.map((day) => {
            const on = selectedDays.includes(day);
            return <button key={day} type="button" aria-pressed={on} aria-label={weekdayNames[day]} onClick={() => toggleDay(day)} className={cn("h-10 min-w-[3.25rem] flex-1 rounded-lg border px-2 text-xs font-semibold transition sm:flex-none", on ? "border-indigo-300 bg-indigo-50 text-indigo-700" : "bg-white text-slate-500 hover:border-indigo-200")}>{weekdayNames[day].slice(0, 3)}</button>;
          })}
        </div>
        <p className="mt-2 text-[10px] text-slate-400">{selectedDays.length ? "Tap a day to add or remove it." : "No days chosen, so Garuda falls back to Monday to Friday. Pick the days yourself if that is not your week."}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="booking-duration">Appointment length</Label>
          <select id="booking-duration" value={duration} onChange={(event) => setDuration(event.target.value)} className="h-11 w-full rounded-lg border bg-white px-3 text-sm">{withCurrent(durationChoices, duration).map((minutes) => <option key={minutes} value={minutes}>{minutes} minutes</option>)}</select>
          <FieldMessage message={messages["booking.duration_minutes"]} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="booking-lead-days">Offer times up to</Label>
          <select id="booking-lead-days" value={leadDays} onChange={(event) => setLeadDays(event.target.value)} className="h-11 w-full rounded-lg border bg-white px-3 text-sm">{withCurrent(leadDayChoices, leadDays).map((days) => <option key={days} value={days}>{days} days ahead</option>)}</select>
          <FieldMessage message={messages["booking.lead_days_ahead"]} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="booking-notice">Minimum notice</Label>
          <select id="booking-notice" value={noticeHours} onChange={(event) => setNoticeHours(event.target.value)} className="h-11 w-full rounded-lg border bg-white px-3 text-sm">{withCurrent(noticeChoices, noticeHours).map((hours) => <option key={hours} value={hours}>{noticeChoiceLabel(hours)}</option>)}</select>
          <FieldMessage message={messages["booking.notice_hours"]} />
          <p className="text-[10px] text-slate-400">How little warning you will accept. A slot eight minutes away is a meeting nobody attends.</p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="booking-label">Button label</Label>
          <Input id="booking-label" value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Book an appointment" maxLength={60} />
          <FieldMessage message={messages["booking.button_label"]} />
          <p className="text-[10px] text-slate-400">What the visitor taps, up to 60 characters.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="booking-title">Calendar event title</Label>
          <Input id="booking-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Consultation" maxLength={120} />
          <FieldMessage message={messages["booking.title"]} />
          <p className="text-[10px] text-slate-400">What you will see in your own diary. The visitor&rsquo;s name is added after it.</p>
        </div>
      </div>

      <div className={cn("rounded-xl border p-4", ready ? "border-emerald-200 bg-emerald-50" : "border-dashed bg-slate-50")}>
        <p className={cn("flex items-center gap-1.5 text-[10px] font-semibold", ready ? "text-emerald-800" : "text-slate-700")}>
          {ready ? <CalendarCheck className="h-3.5 w-3.5 shrink-0" /> : <CalendarClock className="h-3.5 w-3.5 shrink-0 text-indigo-500" />}
          {ready ? (live ? "Live for visitors as soon as you save" : "Ready after you publish") : "Not active yet"}
        </p>
        <p className={cn("mt-2 text-[10px] leading-4", ready ? "text-emerald-700" : "text-slate-500")}>{preview}</p>
        {blockedReason && <p className="mt-2 text-[10px] leading-4 text-slate-500">{blockedReason}</p>}
      </div>
    </div></>;
}

function ChatPreview({ name, greeting, accent, previewReply, device = "desktop" }: { name: string; greeting: string; accent: string; previewReply: string; device?: "desktop" | "mobile" }) {
  return <div className="relative flex min-h-[570px] items-end justify-center overflow-hidden rounded-2xl border bg-white p-5 shadow-sm"><div className="absolute inset-0 bg-[linear-gradient(180deg,#fff,#f3f4f8)]" /><div className={cn("relative w-full overflow-hidden rounded-2xl border bg-white shadow-[0_20px_60px_rgba(15,23,42,.16)]", device === "mobile" && "max-w-[280px]")}><div className="flex items-center gap-3 p-4 text-white" style={{ backgroundColor: accent }}><div className="grid h-9 w-9 place-items-center rounded-full bg-white/20 text-xs font-bold">{name[0] || "A"}</div><div><p className="text-xs font-semibold">{name || "Your agent"}</p><p className="mt-0.5 text-[9px] text-white/80">Online now</p></div></div><div className="h-[340px] space-y-3 overflow-y-auto bg-slate-50/50 p-4"><div className="flex justify-start"><div className="max-w-[88%] rounded-2xl rounded-bl-md border bg-white px-3 py-2.5 text-[11px] leading-5 text-slate-700 shadow-sm">{greeting || "Add an opening greeting…"}</div></div>{previewReply ? <><div className="flex justify-end"><div className="max-w-[82%] rounded-2xl rounded-br-md bg-slate-950 px-3 py-2.5 text-[11px] text-white">What can you help me with?</div></div><div className="flex justify-start"><div className="max-w-[88%] rounded-2xl rounded-bl-md border bg-white px-3 py-2.5 text-[11px] leading-5 text-slate-700 shadow-sm">{previewReply}</div></div></> : <div className="flex flex-wrap gap-1.5">{["Learn more", "See pricing", "Book a demo"].map((item) => <span key={item} className="rounded-full border bg-white px-2.5 py-1 text-[9px] font-medium" style={{ color: accent }}>{item}</span>)}</div>}</div><div className="border-t p-3"><div className="flex h-9 items-center rounded-lg border bg-slate-50 px-3 text-[10px] text-slate-400">Type a message…<span className="ml-auto grid h-6 w-6 place-items-center rounded-md text-white" style={{ backgroundColor: accent }}>↑</span></div><p className="mt-2 text-center text-[8px] text-slate-400">Powered by Garuda</p></div></div></div>;
}
