// The voice onboarding flow as plain data: which step the owner is on, the
// take they have captured, the transcript they are correcting, and the two
// structured answers that follow it.
//
// The reducer is pure and holds no browser objects other than the recorded
// blob itself, so every transition — including the awkward ones, like a
// transcription response arriving after the owner has already pressed record
// again — can be driven directly.

import { recordingLimit } from "@/components/voice/voice-recording";

export type VoicePhase = "idle" | "recording" | "recorded" | "transcribing" | "review" | "details";

export type VoiceTake = {
  blob: Blob;
  // An object URL for playback. Whoever replaces or drops a take is
  // responsible for revoking it; `releaseTake` below is that one call.
  url: string;
  durationSeconds: number;
  mimeType: string;
};

export type VoiceFlowState = {
  phase: VoicePhase;
  take: VoiceTake | null;
  transcript: string;
  confidence: number | null;
  failure: string;
  agentName: string;
  booksAppointments: boolean | null;
};

export const initialVoiceFlowState: VoiceFlowState = {
  phase: "idle",
  take: null,
  transcript: "",
  confidence: null,
  failure: "",
  agentName: "",
  booksAppointments: null,
};

export type VoiceFlowAction =
  | { type: "start_recording" }
  | { type: "recording_failed" }
  | { type: "recording_captured"; take: VoiceTake }
  | { type: "discard_recording" }
  | { type: "transcription_started" }
  | { type: "transcription_failed"; message: string }
  | { type: "transcription_succeeded"; transcript: string; confidence: number | null }
  | { type: "transcript_edited"; transcript: string }
  | { type: "transcript_confirmed" }
  | { type: "back_to_transcript" }
  | { type: "agent_name_edited"; agentName: string }
  | { type: "booking_chosen"; booksAppointments: boolean }
  | { type: "reset" };

export function voiceFlowReducer(state: VoiceFlowState, action: VoiceFlowAction): VoiceFlowState {
  switch (action.type) {
    case "start_recording":
      return { ...state, phase: "recording", failure: "" };
    case "recording_failed":
      // The microphone never opened, so there is nothing to review. The
      // failure itself is described by the recorder, not by this reducer.
      return { ...state, phase: state.take ? "recorded" : "idle" };
    case "recording_captured":
      // A second take replaces the first outright: keeping a stale transcript
      // beside fresh audio is how someone ends up sending the wrong words.
      return { ...state, phase: "recorded", take: action.take, transcript: "", confidence: null, failure: "" };
    case "discard_recording":
      // The name the owner typed is theirs and survives; everything derived
      // from the discarded audio goes.
      return { ...state, phase: "idle", take: null, transcript: "", confidence: null, failure: "" };
    case "transcription_started":
      if (!state.take) return state;
      return { ...state, phase: "transcribing", failure: "" };
    case "transcription_failed":
      // The recording is deliberately kept. Losing several minutes of someone
      // talking about their business to a failed upload is unforgivable when
      // the bytes are still sitting in memory.
      if (!state.take) return state;
      return { ...state, phase: "recorded", failure: action.message };
    case "transcription_succeeded":
      // A response for a take that has already been discarded is ignored,
      // rather than resurrecting audio the owner has thrown away.
      if (!state.take) return state;
      return { ...state, phase: "review", transcript: action.transcript.trim(), confidence: action.confidence, failure: "" };
    case "transcript_edited":
      return { ...state, transcript: action.transcript, failure: "" };
    case "transcript_confirmed":
      if (!state.transcript.trim()) return state;
      return { ...state, phase: "details", failure: "" };
    case "back_to_transcript":
      return { ...state, phase: "review", failure: "" };
    case "agent_name_edited":
      return { ...state, agentName: action.agentName, failure: "" };
    case "booking_chosen":
      return { ...state, booksAppointments: action.booksAppointments, failure: "" };
    case "reset":
      return initialVoiceFlowState;
    default:
      return state;
  }
}

// Revokes the object URL a take was holding. Called wherever a take is
// replaced, discarded, or left behind by an unmount; the browser does not
// reclaim these on its own and a few of them are a few megabytes each.
export function releaseTake(take: VoiceTake | null | undefined, revokeObjectURL: (url: string) => void): void {
  if (!take || !take.url) return;
  try {
    revokeObjectURL(take.url);
  } catch {
    // A URL revoked twice is not worth an error on the way out of a component.
  }
}

export const agentNameLimit = 40;

export type VoiceSubmissionField = "transcript" | "agent_name" | "booking";
export type VoiceSubmissionIssue = { field: VoiceSubmissionField; message: string };

export type VoiceSubmissionDraft = {
  transcript: string;
  agentName: string;
  booksAppointments: boolean | null;
};

export function voiceSubmissionIssues(draft: VoiceSubmissionDraft): VoiceSubmissionIssue[] {
  const issues: VoiceSubmissionIssue[] = [];
  if (!draft.transcript.trim()) {
    issues.push({ field: "transcript", message: "Add a few words about your business before we draft the agent." });
  }
  const agentName = draft.agentName.trim();
  if (!agentName) {
    issues.push({ field: "agent_name", message: "Give your agent a name. This is the name your visitors see." });
  } else if (agentName.length > agentNameLimit) {
    issues.push({ field: "agent_name", message: `Agent names are limited to ${agentNameLimit} characters.` });
  }
  if (draft.booksAppointments === null) {
    issues.push({ field: "booking", message: "Choose whether this agent should book appointments." });
  }
  return issues;
}

// Advice rather than a blocker. A twelve word transcript produces a thin
// agent, and saying so beats silently building one.
export const shortTranscriptThreshold = 120;

export function transcriptHint(transcript: string): string {
  const length = transcript.trim().length;
  if (!length || length >= shortTranscriptThreshold) return "";
  return "That is quite short. A sentence or two more about what you sell and who you sell it to makes a noticeably better agent.";
}

export type AnnouncementInput = {
  phase: VoicePhase;
  elapsedSeconds: number;
  maximumSeconds: number;
  warnWithinSeconds: number;
};

// What the live region says. It changes at milestones, not on every tick: a
// polite live region whose text changes once a second is read aloud once a
// second, which is unusable. Start, every half minute, and the approaching
// limit are the three things worth interrupting for.
export function recordingAnnouncement(input: AnnouncementInput): string {
  switch (input.phase) {
    case "recording": {
      const limit = recordingLimit(input.elapsedSeconds, input.maximumSeconds, input.warnWithinSeconds);
      if (limit.expired) return "The recording limit was reached and recording stopped.";
      if (limit.warning) return `Recording, ${limit.remainingSeconds} seconds left. Recording stops on its own at the limit.`;
      const milestone = Math.floor(Math.max(0, input.elapsedSeconds) / 30) * 30;
      if (milestone === 0) return "Recording started. Press stop when you are done.";
      return `Recording, ${milestone} seconds so far.`;
    }
    case "recorded":
      return "Recording finished. Play it back, send it for transcription, or record again.";
    case "transcribing":
      return "Uploading and transcribing your recording. This takes a few seconds.";
    case "review":
      return "Transcript ready. Review and correct it before continuing.";
    case "details":
      return "Name your agent and choose whether it books appointments.";
    default:
      return "Ready to record. Press record to describe your business out loud.";
  }
}
