// Regression tests for the voice onboarding lane.
//
// Run from the frontend directory with:  node --test tests/*.test.cjs
//
// The web app has no test runner of its own, so this file uses the Node test
// runner and the TypeScript compiler Next already depends on. Nothing new is
// installed. The recorder's decisions are pure functions and are driven
// directly; the panel is a function of its props and is rendered with the
// React server renderer, which is enough to prove what a business owner is
// actually shown in each of the states that matter — including the four
// failure states people really do hit.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

const frontendRoot = path.resolve(__dirname, "..");

function compileTypeScript(module, filename) {
  const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    fileName: filename,
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  });
  module._compile(compiled.outputText, filename);
}

require.extensions[".ts"] = compileTypeScript;
require.extensions[".tsx"] = compileTypeScript;

// The app resolves "@/..." against the frontend root.
const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request.startsWith("@/")) return resolveFilename.call(this, path.join(frontendRoot, request.slice(2)), parent, ...rest);
  return resolveFilename.call(this, request, parent, ...rest);
};

function requireFrontend(relativePath) {
  return require(path.join(frontendRoot, relativePath));
}

const recording = requireFrontend("components/voice/voice-recording.ts");
const flow = requireFrontend("components/voice/voice-flow-state.ts");
const voiceApi = requireFrontend("components/voice/voice-api.ts");
const { VoiceOnboardingPanel } = requireFrontend("components/voice/voice-onboarding-panel.tsx");
const { VoiceOnboarding } = requireFrontend("components/voice/voice-onboarding.tsx");
const { ApiError } = requireFrontend("lib/api.ts");

// ---------------------------------------------------------------------------
// What the browser can and cannot do
// ---------------------------------------------------------------------------

function environment(overrides) {
  return { secureContext: true, hostname: "app.garuda.ai", hasMediaRecorder: true, hasGetUserMedia: true, ...overrides };
}

test("a page served over plain http is told about https, not told its browser is too old", () => {
  // This is the real shape of the bug. On an insecure origin the browser does
  // not merely refuse the microphone, it deletes navigator.mediaDevices, so
  // whichever check runs first decides what the owner is told.
  const support = recording.detectRecordingSupport(
    environment({ secureContext: false, hostname: "192.168.1.24", hasGetUserMedia: false }),
  );
  assert.equal(support.supported, false);
  assert.equal(support.code, "insecure_context");
  assert.match(support.message, /https/);
});

test("http on localhost can still record, so local development is not blocked", () => {
  for (const hostname of ["localhost", "127.0.0.1", "::1"]) {
    const support = recording.detectRecordingSupport(environment({ secureContext: false, hostname }));
    assert.equal(support.supported, true, `${hostname} should be treated as a secure origin`);
  }
});

test("a missing MediaRecorder and a missing getUserMedia are reported as different problems", () => {
  assert.equal(recording.detectRecordingSupport(environment({ hasMediaRecorder: false })).code, "no_media_recorder");
  assert.equal(recording.detectRecordingSupport(environment({ hasGetUserMedia: false })).code, "no_media_devices");
  assert.equal(recording.detectRecordingSupport(environment()).supported, true);
});

test("a Safari-shaped browser gets audio/mp4 rather than being told it cannot record", () => {
  // Safari supports none of the webm or ogg candidates. Assuming webm/opus is
  // exactly how this feature silently dies on every iPhone.
  const safari = (mimeType) => mimeType === "audio/mp4";
  assert.equal(recording.chooseRecordingMimeType(recording.recordingMimeTypeCandidates, safari), "audio/mp4");

  const chrome = (mimeType) => mimeType.startsWith("audio/webm");
  assert.equal(recording.chooseRecordingMimeType(recording.recordingMimeTypeCandidates, chrome), "audio/webm;codecs=opus");
});

test("a browser with no isTypeSupported, or that rejects everything, falls back to its own default", () => {
  assert.equal(recording.chooseRecordingMimeType(recording.recordingMimeTypeCandidates, undefined), "");
  assert.equal(recording.chooseRecordingMimeType(recording.recordingMimeTypeCandidates, () => false), "");
  // A browser that throws on a type it has never heard of must not abort the walk.
  const throwsOnWebm = (mimeType) => {
    if (mimeType.startsWith("audio/webm")) throw new TypeError("unknown type");
    return mimeType === "audio/ogg";
  };
  assert.equal(recording.chooseRecordingMimeType(recording.recordingMimeTypeCandidates, throwsOnWebm), "audio/ogg");
});

test("a mime type the browser advertises but refuses to construct falls back instead of losing the recording", () => {
  const attempts = [];
  const construct = (options) => {
    attempts.push(options.mimeType);
    if (options.mimeType) throw new DOMException("not supported", "NotSupportedError");
    return { id: "browser-default" };
  };
  const created = recording.createRecorder(construct, "audio/webm;codecs=opus");
  assert.deepEqual(attempts, ["audio/webm;codecs=opus", undefined]);
  assert.equal(created.recorder.id, "browser-default");
  assert.equal(created.mimeType, "");
});

// ---------------------------------------------------------------------------
// Microphone failures
// ---------------------------------------------------------------------------

test("a permission the browser has remembered is not confused with a prompt that was dismissed", () => {
  const dismissed = recording.describeMicrophoneFailure({ name: "NotAllowedError" }, "prompt");
  assert.equal(dismissed.code, "permission_denied");
  assert.match(dismissed.message, /Press record again/);

  // The prompt will never appear again, so "press record again" would send the
  // owner round a loop with no exit. The message has to say where the setting is.
  const blocked = recording.describeMicrophoneFailure({ name: "NotAllowedError" }, "denied");
  assert.equal(blocked.code, "permission_blocked");
  assert.match(blocked.message, /will not ask again/);
  assert.match(blocked.message, /address bar/);
  assert.doesNotMatch(blocked.message, /Press record again/);
});

test("no microphone, a busy microphone and an insecure page each get their own advice", () => {
  assert.equal(recording.describeMicrophoneFailure({ name: "NotFoundError" }).code, "no_microphone");
  assert.equal(recording.describeMicrophoneFailure({ name: "NotReadableError" }).code, "microphone_busy");
  assert.equal(recording.describeMicrophoneFailure({ name: "OverconstrainedError" }).code, "microphone_unavailable");
  assert.equal(recording.describeMicrophoneFailure({ name: "SecurityError" }).code, "insecure_context");
  assert.equal(recording.describeMicrophoneFailure(new Error("boom")).code, "recorder_failed");
  for (const failure of [
    recording.describeMicrophoneFailure({ name: "NotFoundError" }),
    recording.describeMicrophoneFailure({ name: "NotReadableError" }),
    recording.describeMicrophoneFailure(new Error("boom")),
  ]) {
    assert.ok(failure.title.length > 0 && failure.message.length > 0, "every failure needs something the owner can act on");
  }
});

// ---------------------------------------------------------------------------
// Releasing the microphone
// ---------------------------------------------------------------------------

test("every microphone track is stopped, even when one of them throws on the way out", () => {
  // A live microphone left behind after the owner has moved on is the single
  // worst thing this component could do, so one bad track must not shield the
  // rest.
  const stopped = [];
  const stream = {
    getTracks: () => [
      { stop: () => { stopped.push("first"); throw new Error("already ended"); } },
      { stop: () => stopped.push("second") },
      { stop: () => stopped.push("third") },
    ],
  };
  recording.releaseMicrophoneStream(stream);
  assert.deepEqual(stopped, ["first", "second", "third"]);

  // And nothing at all is a no-op rather than a crash on an unmount path.
  assert.doesNotThrow(() => recording.releaseMicrophoneStream(null));
  assert.doesNotThrow(() => recording.releaseMicrophoneStream({}));
});

// ---------------------------------------------------------------------------
// The duration cap and the clock
// ---------------------------------------------------------------------------

test("the recording limit warns before the end and stops at it, rather than failing after upload", () => {
  const early = recording.recordingLimit(30, 120, 20);
  assert.equal(early.warning, false);
  assert.equal(early.expired, false);
  assert.equal(early.remainingSeconds, 90);

  const nearly = recording.recordingLimit(105, 120, 20);
  assert.equal(nearly.warning, true, "the owner has to be warned while they can still act on it");
  assert.equal(nearly.remainingSeconds, 15);
  assert.equal(nearly.expired, false);

  const done = recording.recordingLimit(120, 120, 20);
  assert.equal(done.expired, true);
  assert.equal(done.remainingSeconds, 0);
});

test("elapsed time and the stated allowance are both readable", () => {
  assert.equal(recording.formatElapsed(0), "0:00");
  assert.equal(recording.formatElapsed(7), "0:07");
  assert.equal(recording.formatElapsed(95.9), "1:35");
  assert.equal(recording.formatElapsed(-4), "0:00");
  assert.equal(recording.formatElapsed(Number.NaN), "0:00");

  assert.equal(recording.formatAllowance(120), "2 minutes");
  assert.equal(recording.formatAllowance(60), "1 minute");
  assert.equal(recording.formatAllowance(90), "90 seconds");
});

// ---------------------------------------------------------------------------
// The level meter
// ---------------------------------------------------------------------------

test("the level meter reads silence as silence and a full scale signal as full", () => {
  const silence = new Uint8Array(64).fill(128);
  assert.equal(recording.computeLevelFromWaveform(silence), 0);

  const loud = Uint8Array.from({ length: 64 }, (_, index) => (index % 2 === 0 ? 0 : 255));
  assert.equal(recording.computeLevelFromWaveform(loud), 1);

  const speech = Uint8Array.from({ length: 64 }, (_, index) => 128 + (index % 2 === 0 ? 12 : -12));
  const level = recording.computeLevelFromWaveform(speech);
  assert.ok(level > 0 && level < 1, `speech should land inside the meter, got ${level}`);
  assert.equal(recording.computeLevelFromWaveform(new Uint8Array(0)), 0);
});

test("prefers-reduced-motion quantises the meter instead of animating it continuously", () => {
  assert.equal(recording.meterLevel(0.63, false), 0.63);
  assert.equal(recording.meterLevel(0.63, true), 0.75);
  assert.equal(recording.meterLevel(0.63, true), recording.meterLevel(0.72, true), "small changes must not move a reduced-motion meter");
  assert.equal(recording.meterLevel(2, false), 1);
  assert.equal(recording.meterLevel(-1, false), 0);
  assert.equal(recording.meterLevel(Number.NaN, false), 0);
});

test("the meter keeps a visible baseline at silence and grows with the level", () => {
  const quiet = recording.levelBarHeights(0, 9);
  assert.equal(quiet.length, 9);
  assert.ok(quiet.every((height) => height >= 10), "a meter that collapses to nothing reads as broken hardware");

  const loud = recording.levelBarHeights(1, 9);
  assert.ok(loud[4] > quiet[4], "the meter has to move when the microphone hears something");
  assert.ok(loud.every((height) => height <= 100));
});

// ---------------------------------------------------------------------------
// What a screen reader hears
// ---------------------------------------------------------------------------

test("the live region changes at milestones, not on every tick", () => {
  const announce = (elapsedSeconds) =>
    flow.recordingAnnouncement({ phase: "recording", elapsedSeconds, maximumSeconds: 120, warnWithinSeconds: 20 });

  // A polite live region whose text changes once a second is read out once a
  // second, which is unusable.
  assert.equal(announce(3), announce(9));
  assert.match(announce(1), /Recording started/);
  assert.notEqual(announce(9), announce(31));
  assert.match(announce(31), /30 seconds so far/);
  assert.equal(announce(31), announce(48));

  // The approaching limit is worth an interruption.
  assert.match(announce(105), /15 seconds left/);
  assert.match(flow.recordingAnnouncement({ phase: "recording", elapsedSeconds: 120, maximumSeconds: 120, warnWithinSeconds: 20 }), /limit was reached/);
});

test("every phase says something to a screen reader", () => {
  for (const phase of ["idle", "recording", "recorded", "transcribing", "review", "details"]) {
    const text = flow.recordingAnnouncement({ phase, elapsedSeconds: 0, maximumSeconds: 120, warnWithinSeconds: 20 });
    assert.ok(text.length > 0, `${phase} needs an announcement`);
  }
  assert.match(flow.recordingAnnouncement({ phase: "transcribing", elapsedSeconds: 0, maximumSeconds: 120, warnWithinSeconds: 20 }), /transcrib/i);
});

// ---------------------------------------------------------------------------
// The flow itself
// ---------------------------------------------------------------------------

function take(overrides) {
  return { blob: new Blob(["audio"], { type: "audio/webm" }), url: "blob:take-one", durationSeconds: 42, mimeType: "audio/webm", ...overrides };
}

function stateAfter(actions, from) {
  return actions.reduce(flow.voiceFlowReducer, from || flow.initialVoiceFlowState);
}

test("a failed transcription keeps the recording so the retry sends the same audio", () => {
  // Losing two minutes of somebody talking about their business to a flaky
  // upload, when the bytes are still sitting in memory, is unforgivable.
  const captured = take();
  const state = stateAfter([
    { type: "start_recording" },
    { type: "recording_captured", take: captured },
    { type: "transcription_started" },
    { type: "transcription_failed", message: "The upload timed out. Your recording is still here, so you can try again." },
  ]);
  assert.equal(state.phase, "recorded");
  assert.equal(state.take, captured, "the recording must survive the failure");
  assert.match(state.failure, /still here/);

  // And the retry succeeds from exactly that state.
  const retried = stateAfter([{ type: "transcription_started" }, { type: "transcription_succeeded", transcript: "  We fit kitchens.  ", confidence: 0.97 }], state);
  assert.equal(retried.phase, "review");
  assert.equal(retried.transcript, "We fit kitchens.");
  assert.equal(retried.failure, "");
});

test("recording again discards the previous take and its transcript", () => {
  const first = stateAfter([
    { type: "recording_captured", take: take() },
    { type: "transcription_succeeded", transcript: "The first take", confidence: 0.9 },
    { type: "agent_name_edited", agentName: "Aria" },
  ]);
  const discarded = flow.voiceFlowReducer(first, { type: "discard_recording" });
  assert.equal(discarded.phase, "idle");
  assert.equal(discarded.take, null);
  assert.equal(discarded.transcript, "", "a stale transcript beside no audio is how the wrong words get sent");
  assert.equal(discarded.confidence, null);
  assert.equal(discarded.agentName, "Aria", "the name the owner typed is theirs and survives");

  // Stopping a second recording replaces the first outright.
  const second = take({ url: "blob:take-two", durationSeconds: 11 });
  const replaced = flow.voiceFlowReducer(first, { type: "recording_captured", take: second });
  assert.equal(replaced.take, second);
  assert.equal(replaced.transcript, "");
  assert.equal(replaced.confidence, null);
});

test("a transcription that arrives after the take was discarded is ignored", () => {
  // Press send, change your mind, press record again: the in-flight response
  // must not resurrect audio that is already gone.
  const discarded = stateAfter([
    { type: "recording_captured", take: take() },
    { type: "transcription_started" },
    { type: "discard_recording" },
  ]);
  const late = flow.voiceFlowReducer(discarded, { type: "transcription_succeeded", transcript: "words from the old take", confidence: 0.99 });
  assert.equal(late.phase, "idle");
  assert.equal(late.transcript, "");

  const lateFailure = flow.voiceFlowReducer(discarded, { type: "transcription_failed", message: "nope" });
  assert.equal(lateFailure.phase, "idle");
  assert.equal(lateFailure.failure, "");
});

test("an empty transcript cannot be confirmed", () => {
  const reviewing = stateAfter([
    { type: "recording_captured", take: take() },
    { type: "transcription_succeeded", transcript: "Something", confidence: 0.9 },
    { type: "transcript_edited", transcript: "   " },
  ]);
  assert.equal(flow.voiceFlowReducer(reviewing, { type: "transcript_confirmed" }).phase, "review");

  const filled = flow.voiceFlowReducer(reviewing, { type: "transcript_edited", transcript: "We fit kitchens in Leeds." });
  assert.equal(flow.voiceFlowReducer(filled, { type: "transcript_confirmed" }).phase, "details");
});

test("a failed build leaves the owner on the details step with everything they entered", () => {
  const details = stateAfter([
    { type: "recording_captured", take: take() },
    { type: "transcription_succeeded", transcript: "We fit kitchens in Leeds.", confidence: 0.99 },
    { type: "transcript_confirmed" },
    { type: "agent_name_edited", agentName: "Aria" },
    { type: "booking_chosen", booksAppointments: true },
    { type: "submission_failed", message: "The service is busy." },
  ]);
  assert.equal(details.phase, "details");
  assert.equal(details.agentName, "Aria");
  assert.equal(details.booksAppointments, true);
  assert.equal(details.transcript, "We fit kitchens in Leeds.");
  assert.equal(details.failure, "The service is busy.");
});

test("dropping a take revokes exactly its object url", () => {
  const revoked = [];
  flow.releaseTake(take({ url: "blob:one" }), (url) => revoked.push(url));
  flow.releaseTake(null, (url) => revoked.push(url));
  flow.releaseTake(take({ url: "" }), (url) => revoked.push(url));
  assert.deepEqual(revoked, ["blob:one"]);
  // An unmount after the url is already gone must not throw on the way out.
  assert.doesNotThrow(() => flow.releaseTake(take(), () => { throw new Error("already revoked"); }));
});

// ---------------------------------------------------------------------------
// The structured step
// ---------------------------------------------------------------------------

test("the structured step insists on a name and an explicit booking answer", () => {
  const blank = flow.voiceSubmissionIssues({ transcript: "  ", agentName: " ", booksAppointments: null });
  assert.deepEqual(blank.map((issue) => issue.field).sort(), ["agent_name", "booking", "transcript"]);

  // "No" is an answer; only the untouched state is missing one.
  assert.deepEqual(flow.voiceSubmissionIssues({ transcript: "We fit kitchens.", agentName: "Aria", booksAppointments: false }), []);

  const long = flow.voiceSubmissionIssues({ transcript: "We fit kitchens.", agentName: "x".repeat(flow.agentNameLimit + 1), booksAppointments: true });
  assert.deepEqual(long.map((issue) => issue.field), ["agent_name"]);
});

test("a very short transcript is flagged as advice, never as a blocker", () => {
  assert.match(flow.transcriptHint("We do kitchens."), /quite short/);
  assert.equal(flow.transcriptHint(""), "");
  assert.equal(flow.transcriptHint("a".repeat(flow.shortTranscriptThreshold)), "");
  assert.deepEqual(flow.voiceSubmissionIssues({ transcript: "We do kitchens.", agentName: "Aria", booksAppointments: true }), []);
});

// ---------------------------------------------------------------------------
// The upload
// ---------------------------------------------------------------------------

test("the audio is uploaded as its own body, typed by what the browser actually recorded", () => {
  // decodeJSON on the server rejects unknown fields and caps a body at a
  // megabyte, so audio cannot travel the JSON path.
  const safari = voiceApi.buildTranscriptionRequest({ type: "audio/mp4" }, 42.6);
  assert.equal(safari.path, "/onboarding/voice/transcribe");
  assert.equal(safari.method, "POST");
  assert.equal(safari.headers["Content-Type"], "audio/mp4");
  assert.equal(safari.headers["X-Recording-Duration-Seconds"], "43");

  const chrome = voiceApi.buildTranscriptionRequest({ type: "audio/webm;codecs=opus" }, 12);
  assert.equal(chrome.headers["Content-Type"], "audio/webm;codecs=opus");

  const unknown = voiceApi.buildTranscriptionRequest({ type: "" }, -1);
  assert.equal(unknown.headers["Content-Type"], "application/octet-stream");
  assert.equal(unknown.headers["X-Recording-Duration-Seconds"], "0");

  // Speech takes seconds to come back; the portal's eight second default would
  // abandon almost every recording.
  assert.ok(chrome.timeoutMs >= 60000, `transcription needs a long timeout, got ${chrome.timeoutMs}`);

  // Nothing that could carry what was said goes anywhere it would be logged.
  assert.equal(chrome.path.includes("?"), false);
  assert.deepEqual(Object.keys(chrome.headers).sort(), ["Content-Type", "X-Recording-Duration-Seconds"]);
});

test("every code the transcription endpoint answers with becomes its own usable message", () => {
  // The codes are the ones the Go handler actually writes. A mapping that
  // drifts from the server silently degrades every failure to "something went
  // wrong", which tells the owner nothing they can act on.
  const codes = Object.values(voiceApi.transcriptionFailureCodes);
  assert.deepEqual(
    codes.slice().sort(),
    ["audio_too_large", "audio_too_short", "no_speech_detected", "subscription_required", "transcription_unavailable", "unsupported_media_type", "voice_quota_exceeded", "voice_unavailable"],
  );

  const messages = new Set();
  for (const code of codes) {
    const message = voiceApi.transcriptionFailureMessage(new ApiError({ code, message: "server text" }));
    assert.ok(message.includes(voiceApi.recordingKeptSentence), `"${code}" has to say the recording is kept`);
    assert.doesNotMatch(message, /^We could not transcribe that recording/, `"${code}" fell through to the generic message`);
    messages.add(message);
  }
  assert.ok(messages.size >= 6, "distinct causes need distinct advice");

  // And the two that are not codes at all.
  const timedOut = voiceApi.transcriptionFailureMessage(Object.assign(new Error("aborted"), { name: "AbortError" }));
  assert.match(timedOut, /timed out/);
  assert.ok(timedOut.includes(voiceApi.recordingKeptSentence));
  const unknown = voiceApi.transcriptionFailureMessage(new Error("network down"));
  assert.ok(unknown.includes(voiceApi.recordingKeptSentence));

  assert.match(voiceApi.transcriptionFailureMessage(new ApiError({ code: "audio_too_large", message: "" })), /shorter/);
  assert.match(voiceApi.transcriptionFailureMessage(new ApiError({ code: "subscription_required", message: "" })), /subscription/i);
});

test("a recording the server would reject on size is rejected before it is uploaded", () => {
  // Sending three minutes of audio from a phone and being told afterwards that
  // it was a minute too long spends the owner's data for nothing.
  const capability = voiceApi.readVoiceCapability({ enabled: true, max_bytes: 4194304, min_bytes: 2048 });
  assert.equal(voiceApi.preUploadRejection(500000, capability), "");
  assert.match(voiceApi.preUploadRejection(4194304, capability), /larger than we can send/);
  assert.match(voiceApi.preUploadRejection(120, capability), /too short/);
  for (const size of [4194304, 120]) {
    assert.ok(voiceApi.preUploadRejection(size, capability).includes(voiceApi.recordingKeptSentence));
  }
  // The server's own numbers are what is enforced, not a guess baked in here.
  const generous = voiceApi.readVoiceCapability({ enabled: true, max_bytes: 16777216, min_bytes: 1 });
  assert.equal(voiceApi.preUploadRejection(4194304, generous), "");
});

test("a workspace with no transcription provider reports voice as off rather than half on", () => {
  assert.equal(voiceApi.readVoiceCapability(null).enabled, false);
  assert.equal(voiceApi.readVoiceCapability({}).enabled, false);
  assert.equal(voiceApi.readVoiceCapability({ enabled: false }).enabled, false);

  const configured = voiceApi.readVoiceCapability({ enabled: true, max_duration_seconds: 90, max_bytes: 4194304, min_bytes: 2048 });
  assert.equal(configured.enabled, true);
  assert.equal(configured.maximumSeconds, 90, "the server owns the limit the client enforces");
  assert.equal(configured.maximumBytes, 4194304);
  assert.equal(configured.minimumBytes, 2048);
  assert.ok(configured.warnWithinSeconds > 0 && configured.warnWithinSeconds < configured.maximumSeconds);

  // Nonsense from the wire falls back rather than producing a zero second cap.
  const nonsense = voiceApi.readVoiceCapability({ enabled: true, max_duration_seconds: 0, max_bytes: -1, min_bytes: 0 });
  assert.equal(nonsense.maximumSeconds, voiceApi.voiceRecordingDefaults.maximumSeconds);
  assert.equal(nonsense.maximumBytes, voiceApi.voiceRecordingDefaults.maximumBytes);
  assert.equal(nonsense.minimumBytes, voiceApi.voiceRecordingDefaults.minimumBytes);
});

// ---------------------------------------------------------------------------
// What is actually rendered
// ---------------------------------------------------------------------------

const supported = { supported: true, code: "supported", title: "", message: "" };

function panelProps(overrides) {
  return {
    phase: "idle",
    support: supported,
    voiceAvailable: true,
    requestingMicrophone: false,
    microphoneFailure: null,
    elapsedSeconds: 0,
    maximumSeconds: 120,
    warnWithinSeconds: 20,
    level: 0,
    reducedMotion: false,
    playbackUrl: "",
    takeDurationSeconds: 0,
    transcript: "",
    confidence: null,
    failure: "",
    agentName: "",
    booksAppointments: null,
    issues: [],
    submitting: false,
    onStart: () => {},
    onStop: () => {},
    onDiscard: () => {},
    onSend: () => {},
    onTranscriptChange: () => {},
    onConfirmTranscript: () => {},
    onBackToTranscript: () => {},
    onAgentNameChange: () => {},
    onBookingChange: () => {},
    onSubmit: () => {},
    onSkip: () => {},
    ...overrides,
  };
}

function renderPanel(overrides) {
  return renderToStaticMarkup(React.createElement(VoiceOnboardingPanel, panelProps(overrides)));
}

test("the way out to typing is on screen in every state, including every failure", () => {
  // Someone who cannot record, or will not, must never be trapped in the
  // recorder — and the escape cannot depend on the recorder working.
  const states = [
    { name: "browser still being checked", overrides: { support: null, voiceAvailable: null } },
    { name: "insecure page", overrides: { support: recording.detectRecordingSupport(environment({ secureContext: false, hostname: "10.0.0.4", hasGetUserMedia: false })) } },
    { name: "no MediaRecorder", overrides: { support: recording.detectRecordingSupport(environment({ hasMediaRecorder: false })) } },
    { name: "transcription not configured", overrides: { voiceAvailable: false } },
    { name: "permission blocked", overrides: { microphoneFailure: recording.describeMicrophoneFailure({ name: "NotAllowedError" }, "denied") } },
    { name: "idle", overrides: {} },
    { name: "recording", overrides: { phase: "recording", elapsedSeconds: 12 } },
    { name: "recorded", overrides: { phase: "recorded", playbackUrl: "blob:take", takeDurationSeconds: 12 } },
    { name: "transcribing", overrides: { phase: "transcribing", playbackUrl: "blob:take", takeDurationSeconds: 12 } },
    { name: "review", overrides: { phase: "review", transcript: "We fit kitchens." } },
    { name: "details", overrides: { phase: "details", transcript: "We fit kitchens.", agentName: "Aria" } },
  ];
  for (const state of states) {
    const markup = renderPanel(state.overrides);
    assert.match(markup, /Skip voice and type my answers instead/, `the skip control is missing in: ${state.name}`);
  }
});

test("recording is announced in words and in a clock, not only by the moving meter", () => {
  const markup = renderPanel({ phase: "recording", elapsedSeconds: 12, level: 0.6 });
  assert.match(markup, />Recording</, "a moving bar chart is not a state anyone can rely on");
  assert.match(markup, /0:12/);
  assert.match(markup, /elapsed/);
  assert.match(markup, /Stop recording/);
  // The meter is a second, visual reading of what the live region already says.
  assert.match(markup, /aria-hidden="true" class="flex h-12 items-end/);
  assert.match(markup, /role="status" aria-live="polite"/);
  assert.match(markup, /Recording started/);
});

test("the approaching limit is warned about while the owner can still act on it", () => {
  const markup = renderPanel({ phase: "recording", elapsedSeconds: 106, level: 0.4 });
  // Visibly, not only in the live region: the warning has to reach the person
  // watching the timer as well as the person listening to it.
  assert.match(markup, /text-amber-700"[^>]*>14 seconds left/);
  assert.match(markup, /stops on its own/);
  // And it is announced too.
  assert.match(markup, /aria-live="polite"[^>]*>Recording, 14 seconds left/);
  assert.doesNotMatch(renderPanel({ phase: "recording", elapsedSeconds: 20 }), /seconds left/);
});

test("prefers-reduced-motion stops the meter easing and the recording dot pulsing", () => {
  const moving = renderPanel({ phase: "recording", elapsedSeconds: 5, level: 0.6, reducedMotion: false });
  assert.match(moving, /transition-\[height\]/);
  assert.match(moving, /animate-pulse/);

  const still = renderPanel({ phase: "recording", elapsedSeconds: 5, level: 0.6, reducedMotion: true });
  assert.doesNotMatch(still, /transition-\[height\]/);
  assert.doesNotMatch(still, /animate-pulse/);
  // The meter still reports the level; it just does so in steps.
  assert.match(still, /style="height:/);
});

test("the recording can be played back before it is sent, and re-recording is offered next to sending", () => {
  const markup = renderPanel({ phase: "recorded", playbackUrl: "blob:take-one", takeDurationSeconds: 42 });
  assert.match(markup, /<audio[^>]*controls[^>]*>/, "playback has to use native, keyboard operable controls");
  assert.match(markup, /src="blob:take-one"/);
  assert.match(markup, /0:42/);
  assert.match(markup, /Send for transcription/);
  assert.match(markup, /Record again/);
});

test("uploading and transcribing is an explicit state that cannot be clicked twice", () => {
  const markup = renderPanel({ phase: "transcribing", playbackUrl: "blob:take-one", takeDurationSeconds: 42 });
  assert.match(markup, /Uploading and transcribing/);
  assert.match(markup, /aria-busy="true"/);
  assert.match(markup, /disabled=""/, "the send and re-record controls have to be disabled while it is in flight");
  assert.match(markup, /Uploading and transcribing your recording/, "the spinner needs a name for a screen reader");
});

test("a transcription failure is shown as an alert next to a retry that keeps the recording", () => {
  const markup = renderPanel({
    phase: "recorded",
    playbackUrl: "blob:take-one",
    takeDurationSeconds: 42,
    failure: voiceApi.transcriptionFailureMessage(new Error("network down")),
  });
  assert.match(markup, /role="alert"/);
  assert.match(markup, /still here/);
  assert.match(markup, /Try again/);
  assert.match(markup, /src="blob:take-one"/, "the recording is still on the page, ready to resend");
});

test("the transcript is editable, labelled, and described as the thing the agent is built from", () => {
  // Speech recognition gets business names wrong. An uneditable transcript is
  // what makes the whole feature untrustworthy.
  const markup = renderPanel({ phase: "review", transcript: "We fit kitchens in Leeds.", confidence: 0.99 });
  assert.match(markup, /<textarea[^>]*id="voice-transcript"/);
  assert.match(markup, /for="voice-transcript"/);
  assert.match(markup, /aria-describedby="voice-transcript-help"/);
  // The class list mentions disabled styling, so what is read here is the
  // boolean attribute React would emit, not the word appearing anywhere.
  const transcriptTag = (markup.match(/<textarea[^>]*>/) || [""])[0];
  assert.doesNotMatch(transcriptTag, /\sreadonly=/i);
  assert.doesNotMatch(transcriptTag, /\sdisabled=/i);
  assert.match(markup, /We fit kitchens in Leeds\./);
  assert.match(markup, /business names/);
});

test("a low confidence transcript says so, and a confident one does not nag", () => {
  assert.match(renderPanel({ phase: "review", transcript: "We fit kitchens in Leeds.", confidence: 0.42 }), /hard to hear/);
  assert.doesNotMatch(renderPanel({ phase: "review", transcript: "We fit kitchens in Leeds.", confidence: 0.99 }), /hard to hear/);
});

test("the structured step asks for a display name and a real yes or no on booking", () => {
  const markup = renderPanel({ phase: "details", transcript: "We fit kitchens.", agentName: "Aria", booksAppointments: null });
  assert.match(markup, /<input[^>]*id="voice-agent-name"/);
  assert.match(markup, /for="voice-agent-name"/);
  assert.match(markup, /value="Aria"/);
  assert.match(markup, /<fieldset>/);
  assert.match(markup, /Should it book appointments\?/);
  const radios = markup.match(/type="radio"/g) || [];
  assert.equal(radios.length, 2, "yes and no both have to be choosable, not a single checkbox");
  assert.match(markup, /name="voice-booking"/);
  assert.doesNotMatch(markup, /type="radio"[^>]*checked/, "neither answer is preselected, so the choice is the owner's");

  const answered = renderPanel({ phase: "details", transcript: "We fit kitchens.", agentName: "Aria", booksAppointments: true });
  assert.match(answered, /checked=""/);
});

test("unmet requirements are reported against the field they belong to", () => {
  const markup = renderPanel({
    phase: "details",
    transcript: "We fit kitchens.",
    agentName: "",
    booksAppointments: null,
    issues: flow.voiceSubmissionIssues({ transcript: "We fit kitchens.", agentName: "", booksAppointments: null }),
  });
  assert.match(markup, /aria-invalid="true"/);
  assert.match(markup, /Give your agent a name/);
  assert.match(markup, /Choose whether this agent should book appointments/);
});

test("an unusable browser explains itself instead of showing a record button that cannot work", () => {
  const markup = renderPanel({ support: recording.detectRecordingSupport(environment({ secureContext: false, hostname: "10.0.0.4", hasGetUserMedia: false })) });
  assert.match(markup, /role="alert"/);
  assert.match(markup, /not on a secure connection/);
  assert.match(markup, /https/);
  assert.doesNotMatch(markup, /Start recording/);
});

test("a workspace without transcription degrades to typing rather than offering a dead button", () => {
  const markup = renderPanel({ voiceAvailable: false });
  assert.match(markup, /Voice setup is not available/);
  assert.doesNotMatch(markup, /Start recording/);
  assert.match(markup, /Skip voice and type my answers instead/);
});

test("the whole flow, mounted, renders and offers the way out before anything is probed", () => {
  // The server render, and the first client frame: no microphone has been
  // asked for, and the escape hatch is already there.
  const markup = renderToStaticMarkup(React.createElement(VoiceOnboarding, { onComplete: () => {}, onSkip: () => {} }));
  assert.match(markup, /Skip voice and type my answers instead/);
  assert.match(markup, /Getting the recorder ready/);

  const off = renderToStaticMarkup(
    React.createElement(VoiceOnboarding, {
      onComplete: () => {},
      onSkip: () => {},
      capability: voiceApi.readVoiceCapability({ enabled: false }),
    }),
  );
  assert.match(off, /Voice setup is not available/);
  assert.match(off, /Skip voice and type my answers instead/);
});
