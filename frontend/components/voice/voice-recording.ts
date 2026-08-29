// What the browser will and will not let us record, and the arithmetic the
// recorder needs, kept away from React and away from globals.
//
// Nothing in this file touches `window` except `readRecordingEnvironment`,
// which is the single place the real browser is read. Everything else takes
// what it needs as an argument, so the awkward cases — a page served over
// plain http, a browser that advertises a codec it cannot actually record, a
// microphone track whose stop throws — are all reachable in a test.

// The types the recorder asks the browser for, most preferred first. Chrome
// and Firefox record webm/opus; Safari records mp4 and nothing above it on
// this list, which is exactly why the list is walked instead of assumed.
export const recordingMimeTypeCandidates = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/ogg",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
] as const;

export type RecordingSupportCode = "supported" | "insecure_context" | "no_media_recorder" | "no_media_devices";

export type RecordingSupport = {
  supported: boolean;
  code: RecordingSupportCode;
  title: string;
  message: string;
};

export type RecordingEnvironment = {
  secureContext: boolean;
  hostname: string;
  hasMediaRecorder: boolean;
  hasGetUserMedia: boolean;
};

// Browsers treat these as trustworthy origins even over plain http, so a
// developer running the app locally is not sent off to find a certificate.
const loopbackHostnames = ["localhost", "127.0.0.1", "[::1]", "::1"];

export function detectRecordingSupport(environment: RecordingEnvironment): RecordingSupport {
  const secure = environment.secureContext || loopbackHostnames.includes(environment.hostname);
  // The insecure origin is checked first on purpose. On an insecure origin the
  // browser does not merely refuse the microphone, it removes
  // navigator.mediaDevices altogether, so checking for the API first would
  // tell someone on http that their browser cannot record — untrue, and
  // nothing they can act on.
  if (!secure) {
    return {
      supported: false,
      code: "insecure_context",
      title: "This page is not on a secure connection",
      message: "Browsers only allow microphone access over https, or on localhost. Open this page over https to record your answers, or type them instead.",
    };
  }
  if (!environment.hasMediaRecorder) {
    return {
      supported: false,
      code: "no_media_recorder",
      title: "This browser cannot record audio",
      message: "Recording needs a newer browser — current Chrome, Edge, Firefox and Safari all work. You can type your answers instead.",
    };
  }
  if (!environment.hasGetUserMedia) {
    return {
      supported: false,
      code: "no_media_devices",
      title: "This browser cannot reach your microphone",
      message: "Microphone access is unavailable here, which is usually a browser extension or a device policy. You can type your answers instead.",
    };
  }
  return { supported: true, code: "supported", title: "", message: "" };
}

// The one place the real browser is read. On the server every capability reads
// false, so nothing renders a live microphone until the component has mounted.
export function readRecordingEnvironment(): RecordingEnvironment {
  if (typeof window === "undefined") {
    return { secureContext: false, hostname: "", hasMediaRecorder: false, hasGetUserMedia: false };
  }
  const mediaDevices = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
  return {
    secureContext: window.isSecureContext === true,
    hostname: window.location.hostname,
    hasMediaRecorder: typeof window.MediaRecorder !== "undefined",
    hasGetUserMedia: Boolean(mediaDevices) && typeof mediaDevices?.getUserMedia === "function",
  };
}

export type MicrophoneFailureCode =
  | "permission_blocked"
  | "permission_denied"
  | "no_microphone"
  | "microphone_busy"
  | "microphone_unavailable"
  | "insecure_context"
  | "recorder_failed";

export type MicrophoneFailure = { code: MicrophoneFailureCode; title: string; message: string };

function failureName(reason: unknown): string {
  if (reason && typeof reason === "object" && "name" in reason) {
    const name = (reason as { name?: unknown }).name;
    if (typeof name === "string") return name;
  }
  return "";
}

// `permissionState` is what navigator.permissions reports for the microphone,
// on the browsers that answer that query at all. It is the whole difference
// between a prompt the person dismissed and a decision the browser has
// remembered, and those two need completely different advice: the remembered
// one never shows a prompt again, so "press record and choose Allow" would
// send the owner round a loop that cannot end.
export function describeMicrophoneFailure(reason: unknown, permissionState?: string): MicrophoneFailure {
  const name = failureName(reason);
  if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "PermissionDismissedError") {
    if (permissionState === "denied") {
      return {
        code: "permission_blocked",
        title: "Your browser is blocking the microphone for this site",
        message: "Because the microphone was blocked here before, your browser will not ask again. Open the site settings from the icon at the left of the address bar, set Microphone to Allow, then reload this page.",
      };
    }
    return {
      code: "permission_denied",
      title: "Microphone permission was not granted",
      message: "Press record again and choose Allow when your browser asks. Nothing is recorded or sent until you do.",
    };
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return {
      code: "no_microphone",
      title: "No microphone found",
      message: "Connect a microphone or a headset, then press record again. You can also simply type your answers.",
    };
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return {
      code: "microphone_busy",
      title: "Your microphone is in use",
      message: "Another app — a call or a meeting, usually — is holding the microphone. Close it, then press record again.",
    };
  }
  if (name === "OverconstrainedError" || name === "ConstraintNotSatisfiedError") {
    return {
      code: "microphone_unavailable",
      title: "Your microphone could not be started",
      message: "The connected microphone did not accept the recording settings. Try another input device, or type your answers instead.",
    };
  }
  if (name === "SecurityError") {
    return {
      code: "insecure_context",
      title: "This page is not on a secure connection",
      message: "Browsers only allow microphone access over https, or on localhost. Open this page over https to record your answers, or type them instead.",
    };
  }
  return {
    code: "recorder_failed",
    title: "Recording could not start",
    message: "Something went wrong reaching your microphone. Press record to try again, or type your answers instead.",
  };
}

// Walks the candidate list and returns the first type the browser will record.
// An empty string means "let the browser choose", which is a working recorder
// and not a failure: the type that actually came out is read back off the blob.
export function chooseRecordingMimeType(
  candidates: readonly string[],
  isTypeSupported?: (mimeType: string) => boolean,
): string {
  if (typeof isTypeSupported !== "function") return "";
  for (const candidate of candidates) {
    try {
      if (isTypeSupported(candidate)) return candidate;
    } catch {
      // A browser that throws on a type it has never heard of has answered the
      // question. Keep looking.
    }
  }
  return "";
}

// Some browsers report a type as supported and then refuse it at construction.
// Losing the recording to that is unnecessary: the browser's own default works
// everywhere its MediaRecorder does.
export function createRecorder<Recorder>(
  construct: (options: { mimeType?: string }) => Recorder,
  mimeType: string,
): { recorder: Recorder; mimeType: string } {
  if (mimeType) {
    try {
      return { recorder: construct({ mimeType }), mimeType };
    } catch {
      // Fall through to the browser default rather than failing the recording.
    }
  }
  return { recorder: construct({}), mimeType: "" };
}

export type StoppableTrack = { stop: () => void };
export type ReleasableStream = { getTracks: () => StoppableTrack[] };

// Every track, not only the first, and one failing track never prevents the
// rest being released. A microphone left live after the person has moved on is
// the single worst thing this component could do.
export function releaseMicrophoneStream(stream: ReleasableStream | null | undefined): void {
  if (!stream || typeof stream.getTracks !== "function") return;
  let tracks: StoppableTrack[] = [];
  try {
    tracks = stream.getTracks() || [];
  } catch {
    return;
  }
  for (const track of tracks) {
    try {
      track.stop();
    } catch {
      // A track that has already ended throws on some browsers, and the
      // remaining tracks still have to be stopped.
    }
  }
}

export function formatElapsed(totalSeconds: number): string {
  const safeSeconds = Number.isFinite(totalSeconds) && totalSeconds > 0 ? Math.floor(totalSeconds) : 0;
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export type RecordingLimit = { remainingSeconds: number; warning: boolean; expired: boolean };

// Enforced while recording rather than after uploading. Someone who talks for
// four minutes should be warned at three, not told after the upload that all
// four were wasted.
export function recordingLimit(
  elapsedSeconds: number,
  maximumSeconds: number,
  warnWithinSeconds: number,
): RecordingLimit {
  const remainingSeconds = Math.max(0, Math.ceil(maximumSeconds - elapsedSeconds));
  return {
    remainingSeconds,
    warning: remainingSeconds > 0 && remainingSeconds <= warnWithinSeconds,
    expired: elapsedSeconds >= maximumSeconds,
  };
}

// Root mean square of the waveform the analyser hands back, scaled so ordinary
// speech fills a useful part of the meter instead of twitching at the bottom.
export function computeLevelFromWaveform(samples: ArrayLike<number>): number {
  if (!samples || samples.length === 0) return 0;
  let total = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const deviation = (samples[index] - 128) / 128;
    total += deviation * deviation;
  }
  return Math.min(1, Math.sqrt(total / samples.length) * 3.2);
}

// Under prefers-reduced-motion the meter is quantised into four steps, so it
// still reports that the microphone is hearing something without being a
// continuously moving object on the page.
export function meterLevel(rawLevel: number, reducedMotion: boolean): number {
  if (!Number.isFinite(rawLevel) || rawLevel <= 0) return 0;
  const clamped = Math.min(1, rawLevel);
  return reducedMotion ? Math.round(clamped * 4) / 4 : clamped;
}

// Bar heights as percentages. At silence every bar still has height, so the
// meter reads as a present-but-quiet instrument rather than as a broken one.
export function levelBarHeights(level: number, barCount: number): number[] {
  const safeLevel = meterLevel(level, false);
  const heights: number[] = [];
  for (let index = 0; index < barCount; index += 1) {
    const shape = 0.4 + 0.6 * Math.sin((Math.PI * (index + 0.5)) / barCount);
    const height = 10 + safeLevel * shape * 90;
    heights.push(Math.round(Math.min(100, Math.max(10, height))));
  }
  return heights;
}

// "2 minutes" reads better than "0:120" in a sentence about how long someone
// may talk for, and a limit that is not a whole number of minutes still has to
// be stated honestly.
export function formatAllowance(totalSeconds: number): string {
  const safeSeconds = Number.isFinite(totalSeconds) && totalSeconds > 0 ? Math.floor(totalSeconds) : 0;
  if (safeSeconds < 60 || safeSeconds % 60 !== 0) return `${safeSeconds} seconds`;
  const minutes = safeSeconds / 60;
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}
