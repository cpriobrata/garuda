"use client";

// The browser half of the recorder: microphone permission, MediaRecorder, the
// Web Audio analyser that drives the level meter, the elapsed clock, the
// client side duration cap, and — the part that matters most — releasing the
// microphone the moment it is no longer needed.
//
// All of the decisions this makes live in voice-recording.ts as plain
// functions. What is left here is the wiring, which is why this file has no
// branching worth testing and that one does.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  chooseRecordingMimeType,
  computeLevelFromWaveform,
  createRecorder,
  describeMicrophoneFailure,
  detectRecordingSupport,
  readRecordingEnvironment,
  recordingMimeTypeCandidates,
  releaseMicrophoneStream,
  type MicrophoneFailure,
  type RecordingSupport,
} from "@/components/voice/voice-recording";

export type CapturedRecording = { blob: Blob; url: string; durationSeconds: number; mimeType: string };

export type VoiceRecorderOptions = {
  maximumSeconds: number;
  onCaptured: (recording: CapturedRecording) => void;
  onStarted?: () => void;
  onFailed?: () => void;
};

export type VoiceRecorderStatus = "idle" | "requesting" | "recording";

export type VoiceRecorder = {
  status: VoiceRecorderStatus;
  elapsedSeconds: number;
  level: number;
  failure: MicrophoneFailure | null;
  support: RecordingSupport | null;
  start: () => void;
  stop: () => void;
  clearFailure: () => void;
};

// prefers-reduced-motion, read live rather than once: people change it, and
// operating systems change it on their behalf when a battery saver kicks in.
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const listen = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener("change", listen);
    return () => query.removeEventListener("change", listen);
  }, []);
  return reduced;
}

async function readMicrophonePermissionState(): Promise<string | undefined> {
  if (typeof navigator === "undefined" || !navigator.permissions?.query) return undefined;
  try {
    const status = await navigator.permissions.query({ name: "microphone" as PermissionName });
    return status.state;
  } catch {
    // Firefox has no microphone permission descriptor and throws. Not knowing
    // is fine; it only costs the more specific of two messages.
    return undefined;
  }
}

export function useVoiceRecorder(options: VoiceRecorderOptions): VoiceRecorder {
  const [status, setStatus] = useState<VoiceRecorderStatus>("idle");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [failure, setFailure] = useState<MicrophoneFailure | null>(null);
  const [support, setSupport] = useState<RecordingSupport | null>(null);

  const streamReference = useRef<MediaStream | null>(null);
  const recorderReference = useRef<MediaRecorder | null>(null);
  const audioContextReference = useRef<AudioContext | null>(null);
  const frameReference = useRef<number | null>(null);
  const intervalReference = useRef<number | null>(null);
  const chunksReference = useRef<Blob[]>([]);
  const startedAtReference = useRef(0);
  const generationReference = useRef(0);
  const optionsReference = useRef(options);
  optionsReference.current = options;

  // Support is detected after mount, never during render: the server has no
  // window and a mismatch between the two would be a hydration error.
  useEffect(() => {
    setSupport(detectRecordingSupport(readRecordingEnvironment()));
  }, []);

  const releaseEverything = useCallback(() => {
    if (frameReference.current !== null) {
      cancelAnimationFrame(frameReference.current);
      frameReference.current = null;
    }
    if (intervalReference.current !== null) {
      window.clearInterval(intervalReference.current);
      intervalReference.current = null;
    }
    const audioContext = audioContextReference.current;
    audioContextReference.current = null;
    if (audioContext) {
      // close() returns a promise that rejects if the context is already gone.
      void audioContext.close().catch(() => undefined);
    }
    releaseMicrophoneStream(streamReference.current);
    streamReference.current = null;
    recorderReference.current = null;
  }, []);

  // The unmount path. Someone who navigates away mid-recording must not leave
  // the browser's microphone indicator burning behind them.
  useEffect(() => releaseEverything, [releaseEverything]);

  const stop = useCallback(() => {
    const recorder = recorderReference.current;
    if (recorder && recorder.state !== "inactive") {
      try {
        // The stop handler assembles the blob and then releases the hardware,
        // so the tracks are deliberately still live at this point: stopping
        // them first truncates the tail of the recording on some browsers.
        recorder.stop();
        return;
      } catch {
        // A recorder that will not stop cleanly still has to give the
        // microphone back.
      }
    }
    releaseEverything();
    setStatus("idle");
    setLevel(0);
  }, [releaseEverything]);

  const startMeter = useCallback((stream: MediaStream) => {
    const AudioContextConstructor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextConstructor) return;
    try {
      const audioContext = new AudioContextConstructor();
      audioContextReference.current = audioContext;
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      audioContext.createMediaStreamSource(stream).connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      const readLevel = () => {
        if (audioContextReference.current !== audioContext) return;
        analyser.getByteTimeDomainData(samples);
        setLevel(computeLevelFromWaveform(samples));
        frameReference.current = requestAnimationFrame(readLevel);
      };
      frameReference.current = requestAnimationFrame(readLevel);
    } catch {
      // No meter is a smaller loss than no recording. The elapsed clock and
      // the recording label carry the state on their own.
      audioContextReference.current = null;
    }
  }, []);

  const start = useCallback(async () => {
    if (recorderReference.current || status !== "idle") return;
    const detected = detectRecordingSupport(readRecordingEnvironment());
    setSupport(detected);
    if (!detected.supported) return;

    setFailure(null);
    setStatus("requesting");
    const generation = generationReference.current + 1;
    generationReference.current = generation;

    const permissionBefore = await readMicrophonePermissionState();
    if (permissionBefore === "denied") {
      // Calling getUserMedia here would reject without ever showing a prompt,
      // so the person is told how to unblock it instead of watching nothing
      // happen.
      setFailure(describeMicrophoneFailure({ name: "NotAllowedError" }, "denied"));
      setStatus("idle");
      optionsReference.current.onFailed?.();
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (reason) {
      const permissionAfter = await readMicrophonePermissionState();
      setFailure(describeMicrophoneFailure(reason, permissionAfter));
      setStatus("idle");
      optionsReference.current.onFailed?.();
      return;
    }

    // The owner pressed cancel, or left, while the permission prompt was open.
    if (generationReference.current !== generation) {
      releaseMicrophoneStream(stream);
      return;
    }

    const preferredMimeType = chooseRecordingMimeType(
      recordingMimeTypeCandidates,
      window.MediaRecorder?.isTypeSupported?.bind(window.MediaRecorder),
    );

    let recorder: MediaRecorder;
    try {
      recorder = createRecorder(
        (recorderOptions) => new window.MediaRecorder(stream, recorderOptions),
        preferredMimeType,
      ).recorder;
    } catch (reason) {
      releaseMicrophoneStream(stream);
      setFailure(describeMicrophoneFailure(reason));
      setStatus("idle");
      optionsReference.current.onFailed?.();
      return;
    }

    streamReference.current = stream;
    recorderReference.current = recorder;
    chunksReference.current = [];
    startedAtReference.current = Date.now();

    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data && event.data.size > 0) chunksReference.current.push(event.data);
    };
    recorder.onstop = () => {
      const chunks = chunksReference.current;
      chunksReference.current = [];
      const durationSeconds = Math.max(0, (Date.now() - startedAtReference.current) / 1000);
      // The recorded type is read back off the recorder rather than assumed,
      // because the browser may have ignored what we asked for.
      const mimeType = recorder.mimeType || chunks[0]?.type || "audio/webm";
      const blob = new Blob(chunks, { type: mimeType });
      releaseEverything();
      setStatus("idle");
      setLevel(0);
      if (blob.size > 0) {
        optionsReference.current.onCaptured({
          blob,
          url: URL.createObjectURL(blob),
          durationSeconds,
          mimeType,
        });
      } else {
        setFailure(describeMicrophoneFailure({ name: "NotReadableError" }));
        optionsReference.current.onFailed?.();
      }
    };

    try {
      // A timeslice keeps chunks arriving, so a tab that is killed mid
      // recording has still delivered most of what was said.
      recorder.start(1000);
    } catch (reason) {
      releaseEverything();
      setFailure(describeMicrophoneFailure(reason));
      setStatus("idle");
      optionsReference.current.onFailed?.();
      return;
    }

    setElapsedSeconds(0);
    setStatus("recording");
    startMeter(stream);
    optionsReference.current.onStarted?.();

    intervalReference.current = window.setInterval(() => {
      // Measured against the clock rather than counted, so a throttled
      // background tab does not under-report how long the recording is.
      const elapsed = (Date.now() - startedAtReference.current) / 1000;
      setElapsedSeconds(elapsed);
      if (elapsed >= optionsReference.current.maximumSeconds) stopReference.current();
    }, 250);
  }, [releaseEverything, startMeter, status]);

  // The interval above is created before `stop` is in scope for it, and the
  // auto-stop at the duration cap has to reach the current one.
  const stopReference = useRef(stop);
  stopReference.current = stop;

  const clearFailure = useCallback(() => setFailure(null), []);

  return {
    status,
    elapsedSeconds,
    level,
    failure,
    support,
    start: useCallback(() => void start(), [start]),
    stop,
    clearFailure,
  };
}
