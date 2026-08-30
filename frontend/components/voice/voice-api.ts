// The two calls the voice recorder makes.
//
// They go through the shared apiRequest so they inherit the envelope handling,
// the access token refresh and the demo fallback the rest of the portal has.
// The audio deliberately does not travel as JSON: the JSON path rejects
// unknown fields and caps a body at a megabyte, and a voice note is neither.
// The recording is the entire request body, with its own content type.

import { ApiError, apiRequest } from "@/lib/api";

export type VoiceCapability = {
  enabled: boolean;
  maximumSeconds: number;
  warnWithinSeconds: number;
  maximumBytes: number;
  minimumBytes: number;
};

// Used until the server says otherwise, and used as the floor if the server
// sends something nonsensical. Two minutes is long enough for a business
// owner to describe what they do and short enough to upload on a phone.
export const voiceRecordingDefaults: VoiceCapability = {
  enabled: false,
  maximumSeconds: 120,
  warnWithinSeconds: 20,
  maximumBytes: 4 * 1024 * 1024,
  minimumBytes: 2 * 1024,
};

type VoiceCapabilityPayload = {
  enabled?: boolean;
  max_duration_seconds?: number;
  max_bytes?: number;
  min_bytes?: number;
};

function positiveNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

export function readVoiceCapability(payload: VoiceCapabilityPayload | null | undefined): VoiceCapability {
  const maximumSeconds = positiveNumber(payload?.max_duration_seconds, voiceRecordingDefaults.maximumSeconds);
  return {
    enabled: payload?.enabled === true,
    maximumSeconds,
    // Warn for the last sixth of the allowance, but never so early that the
    // warning is on screen for most of the recording.
    warnWithinSeconds: Math.max(5, Math.min(voiceRecordingDefaults.warnWithinSeconds, Math.floor(maximumSeconds / 6))),
    maximumBytes: positiveNumber(payload?.max_bytes, voiceRecordingDefaults.maximumBytes),
    minimumBytes: positiveNumber(payload?.min_bytes, voiceRecordingDefaults.minimumBytes),
  };
}

// A workspace with no transcription provider configured is not a broken
// workspace: voice simply is not offered and the typed questions are.
export async function loadVoiceCapability(): Promise<VoiceCapability> {
  try {
    const payload = await apiRequest<VoiceCapabilityPayload>("/onboarding/voice", {
      timeoutMs: 8000,
      mock: () => ({ enabled: false }),
    });
    return readVoiceCapability(payload);
  } catch {
    return readVoiceCapability(null);
  }
}

export type TranscriptionRequest = {
  path: string;
  method: string;
  headers: Record<string, string>;
  timeoutMs: number;
};

// Built separately from the call so the exact request the server has to accept
// is one readable object, and so it can be asserted on without a network.
export function buildTranscriptionRequest(recording: { type: string }, durationSeconds: number): TranscriptionRequest {
  return {
    path: "/onboarding/voice/transcribe",
    method: "POST",
    headers: {
      // Whatever the browser actually recorded, read off the blob rather than
      // assumed: Safari sends mp4 here where Chrome sends webm.
      "Content-Type": recording.type || "application/octet-stream",
      // A number, so it is safe to send and safe to log. The audio and the
      // transcript never appear in a header or a query string.
      "X-Recording-Duration-Seconds": String(Math.max(0, Math.round(durationSeconds))),
    },
    // Transcription is a round trip through a speech provider. The portal's
    // eight second default would abandon almost every recording.
    timeoutMs: 120000,
  };
}

export type VoiceTranscription = { transcript: string; confidence: number | null };

export async function transcribeRecording(recording: Blob, durationSeconds: number): Promise<VoiceTranscription> {
  const request = buildTranscriptionRequest(recording, durationSeconds);
  const payload = await apiRequest<{ transcript?: string; confidence?: number }>(request.path, {
    method: request.method,
    headers: request.headers,
    body: recording,
    timeoutMs: request.timeoutMs,
  });
  return {
    transcript: typeof payload.transcript === "string" ? payload.transcript : "",
    confidence: typeof payload.confidence === "number" ? payload.confidence : null,
  };
}

export type VoiceDetails = { agentDisplayName: string; offerBooking: boolean };

// The agent's display name and the appointments answer, saved together.
//
// This endpoint is the only route that accepts them. PUT /v1/onboarding keeps
// the four onboarding question ids and silently drops every other key, so a
// name posted in that answers map would vanish without an error — which is why
// the typed questions send them here too, not only the spoken ones.
export async function saveVoiceDetails(details: VoiceDetails): Promise<void> {
  await apiRequest<Record<string, unknown>>("/onboarding/voice/details", {
    method: "PUT",
    body: JSON.stringify({ agent_display_name: details.agentDisplayName, offer_booking: details.offerBooking }),
    timeoutMs: 15000,
    mock: () => ({ details: { agent_display_name: details.agentDisplayName, offer_booking: details.offerBooking } }),
  });
}

export function voiceDetailsFailureMessage(reason: unknown): string {
  const code = reason instanceof ApiError ? reason.code : "";
  if (code === "validation_failed") {
    return "That name was not accepted — use between 2 and 120 characters.";
  }
  if (reason instanceof Error && reason.name === "AbortError") {
    return "Saving your agent’s name timed out. Please try again.";
  }
  return "We could not save your agent’s name and booking answer. Please try again.";
}

// Every failure says the recording is kept, because it is: the blob stays in
// state and the retry button sends the same bytes again. Someone who has just
// spoken for two minutes needs to be told that before anything else.
export const recordingKeptSentence = "Your recording is still here, so you can try again.";

// The codes the transcription endpoint answers with. Kept as one list so the
// mapping below is obviously exhaustive against the server rather than a pile
// of string comparisons nobody can check.
export const transcriptionFailureCodes = {
  tooLarge: "audio_too_large",
  tooShort: "audio_too_short",
  noSpeech: "no_speech_detected",
  unsupportedType: "unsupported_media_type",
  unavailable: "voice_unavailable",
  providerFailed: "transcription_unavailable",
  quotaExceeded: "voice_quota_exceeded",
  subscriptionRequired: "subscription_required",
} as const;

export function transcriptionFailureMessage(reason: unknown): string {
  const code = reason instanceof ApiError ? reason.code : "";
  if (code === transcriptionFailureCodes.tooLarge) {
    return `That recording is longer than we can send. Record a shorter note — a minute is usually plenty. ${recordingKeptSentence}`;
  }
  if (code === transcriptionFailureCodes.tooShort) {
    return `That recording is too short to make out. Hold record and speak for a few seconds. ${recordingKeptSentence}`;
  }
  if (code === transcriptionFailureCodes.noSpeech) {
    return `Nothing could be heard in that recording. Try somewhere quieter, or closer to the microphone. ${recordingKeptSentence}`;
  }
  if (code === transcriptionFailureCodes.unsupportedType) {
    return `This browser recorded in a format we cannot transcribe. Try another browser, or type your answers instead. ${recordingKeptSentence}`;
  }
  if (code === transcriptionFailureCodes.unavailable || code === transcriptionFailureCodes.providerFailed || code === "not_found") {
    return `Voice transcription is unavailable right now. You can type your answers instead. ${recordingKeptSentence}`;
  }
  if (code === transcriptionFailureCodes.quotaExceeded) {
    return `This account has transcribed as much audio as an hour allows. Wait a little, or type your answers instead. ${recordingKeptSentence}`;
  }
  // Written by the rate limiter in front of the route rather than by the handler,
  // which is why it is not in the list above. It is the one an owner who has been
  // re-recording hits first, so it cannot be allowed to fall through to "we could
  // not transcribe that", which sounds like the recording was at fault.
  if (code === "rate_limited") {
    return `You have sent a lot of recordings in the last hour, so transcription is paused for a short while. Type this answer instead, or come back to it shortly. ${recordingKeptSentence}`;
  }
  if (code === transcriptionFailureCodes.subscriptionRequired) {
    return `An active subscription is needed to transcribe a recording. You can type your answers instead. ${recordingKeptSentence}`;
  }
  if (reason instanceof Error && reason.name === "AbortError") {
    return `The upload timed out. ${recordingKeptSentence}`;
  }
  return `We could not transcribe that recording. ${recordingKeptSentence}`;
}

// Checked against the take before a byte leaves the device. A phone uploading
// three minutes of audio only to be told it was one minute too long has spent
// the owner's data and their patience for nothing.
export function preUploadRejection(sizeBytes: number, capability: VoiceCapability): string {
  if (sizeBytes >= capability.maximumBytes) {
    return `That recording is larger than we can send. Record a shorter note — a minute is usually plenty. ${recordingKeptSentence}`;
  }
  if (sizeBytes < capability.minimumBytes) {
    return `That recording is too short to make out. Hold record and speak for a few seconds. ${recordingKeptSentence}`;
  }
  return "";
}
