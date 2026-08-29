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
};

// Used until the server says otherwise, and used as the floor if the server
// sends something nonsensical. Two minutes is long enough for a business
// owner to describe what they do and short enough to upload on a phone.
export const voiceRecordingDefaults: VoiceCapability = {
  enabled: false,
  maximumSeconds: 120,
  warnWithinSeconds: 20,
  maximumBytes: 8 * 1024 * 1024,
};

type VoiceCapabilityPayload = {
  enabled?: boolean;
  max_duration_seconds?: number;
  max_bytes?: number;
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

// Every failure says the recording is kept, because it is: the blob stays in
// state and the retry button sends the same bytes again. Someone who has just
// spoken for two minutes needs to be told that before anything else.
export const recordingKeptSentence = "Your recording is still here, so you can try again.";

export function transcriptionFailureMessage(reason: unknown): string {
  const code = reason instanceof ApiError ? reason.code : "";
  if (code === "PAYLOAD_TOO_LARGE" || code === "AUDIO_TOO_LARGE" || code === "RECORDING_TOO_LONG") {
    return `That recording is longer than we can send. Record a shorter note — a minute is usually plenty. ${recordingKeptSentence}`;
  }
  if (code === "UNSUPPORTED_MEDIA_TYPE") {
    return `This browser recorded in a format we cannot transcribe. Try another browser, or type your answers instead. ${recordingKeptSentence}`;
  }
  if (code === "TRANSCRIPTION_UNAVAILABLE" || code === "VOICE_DISABLED" || code === "NOT_FOUND") {
    return `Voice transcription is unavailable right now. You can type your answers instead. ${recordingKeptSentence}`;
  }
  if (code === "RATE_LIMITED" || code === "TOO_MANY_REQUESTS") {
    return `That is a lot of attempts in a short time. Wait a moment before retrying. ${recordingKeptSentence}`;
  }
  if (reason instanceof Error && reason.name === "AbortError") {
    return `The upload timed out. ${recordingKeptSentence}`;
  }
  return `We could not transcribe that recording. ${recordingKeptSentence}`;
}
