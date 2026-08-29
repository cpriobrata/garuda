"use client";

// The container: it owns the flow state, drives the recorder, and hands the
// reviewed transcript plus the two structured answers back to whoever dropped
// this in. It renders nothing itself — VoiceOnboardingPanel does all of that.

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useBusyAction } from "@/lib/busy-action";
import {
  loadVoiceCapability,
  preUploadRejection,
  recordingKeptSentence,
  transcribeRecording,
  transcriptionFailureMessage,
  voiceRecordingDefaults,
  type VoiceCapability,
  type VoiceTranscription,
} from "@/components/voice/voice-api";
import {
  initialVoiceFlowState,
  releaseTake,
  voiceFlowReducer,
  voiceSubmissionIssues,
} from "@/components/voice/voice-flow-state";
import { VoiceOnboardingPanel } from "@/components/voice/voice-onboarding-panel";
import { usePrefersReducedMotion, useVoiceRecorder, type CapturedRecording } from "@/components/voice/use-voice-recorder";

export type VoiceOnboardingResult = {
  transcript: string;
  agentName: string;
  booksAppointments: boolean;
};

export type VoiceOnboardingProps = {
  // Called once, with the transcript the owner has read and corrected. It is
  // the caller's job to turn that into an agent and move the page on.
  onComplete: (result: VoiceOnboardingResult) => Promise<void> | void;
  // Rendered as a control in every state, including every failure state.
  onSkip: () => void;
  // Supply this to skip the capability probe — useful when the surrounding
  // page has already asked the server whether voice is configured.
  capability?: VoiceCapability;
  // Injectable so the flow can be exercised without a server.
  transcribe?: (recording: Blob, durationSeconds: number) => Promise<VoiceTranscription>;
  idPrefix?: string;
};

function revokeObjectUrl(url: string) {
  if (typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(url);
}

export function VoiceOnboarding({ onComplete, onSkip, capability: providedCapability, transcribe, idPrefix }: VoiceOnboardingProps) {
  const [state, dispatch] = useReducer(voiceFlowReducer, initialVoiceFlowState);
  const [capability, setCapability] = useState<VoiceCapability | null>(providedCapability ?? null);
  const [showIssues, setShowIssues] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const transcription = useBusyAction();
  const submission = useBusyAction();
  const reducedMotion = usePrefersReducedMotion();

  // Mirrors the take so the unmount cleanup and the replace path can reach the
  // object URL without the callbacks depending on the current state.
  const takeReference = useRef(state.take);
  takeReference.current = state.take;
  const stateReference = useRef(state);
  stateReference.current = state;

  useEffect(() => {
    if (providedCapability) return;
    let listening = true;
    void loadVoiceCapability().then((loaded) => {
      if (listening) setCapability(loaded);
    });
    return () => {
      listening = false;
    };
  }, [providedCapability]);

  // Object URLs are held by the document until they are revoked, and a couple
  // of minutes of audio is several megabytes each time somebody re-records.
  useEffect(() => () => releaseTake(takeReference.current, revokeObjectUrl), []);

  const maximumSeconds = capability?.maximumSeconds ?? voiceRecordingDefaults.maximumSeconds;
  const warnWithinSeconds = capability?.warnWithinSeconds ?? voiceRecordingDefaults.warnWithinSeconds;

  const handleCaptured = useCallback((recording: CapturedRecording) => {
    // Whatever was recorded before this take is dropped here, not later: two
    // live object URLs for audio the owner has already replaced is a leak.
    releaseTake(takeReference.current, revokeObjectUrl);
    setShowIssues(false);
    dispatch({ type: "recording_captured", take: recording });
  }, []);

  const handleStarted = useCallback(() => dispatch({ type: "start_recording" }), []);
  const handleFailed = useCallback(() => dispatch({ type: "recording_failed" }), []);

  const recorder = useVoiceRecorder({
    maximumSeconds,
    onCaptured: handleCaptured,
    onStarted: handleStarted,
    onFailed: handleFailed,
  });

  const discard = useCallback(() => {
    releaseTake(takeReference.current, revokeObjectUrl);
    recorder.clearFailure();
    setShowIssues(false);
    dispatch({ type: "discard_recording" });
  }, [recorder]);

  const capabilityReference = useRef(capability);
  capabilityReference.current = capability;

  const send = useCallback(() => {
    void transcription.run(async () => {
      const take = stateReference.current.take;
      if (!take) return;
      // Checked here rather than after the upload. A phone that sends three
      // minutes of audio only to be told it was a minute too long has spent
      // the owner's data and their patience for nothing.
      const rejection = preUploadRejection(take.blob.size, capabilityReference.current ?? voiceRecordingDefaults);
      if (rejection) {
        dispatch({ type: "transcription_failed", message: rejection });
        return;
      }
      dispatch({ type: "transcription_started" });
      try {
        const result = await (transcribe ?? transcribeRecording)(take.blob, take.durationSeconds);
        if (!result.transcript.trim()) {
          dispatch({ type: "transcription_failed", message: `We could not hear any words in that recording. Try somewhere quieter, or closer to the microphone. ${recordingKeptSentence}` });
          return;
        }
        dispatch({ type: "transcription_succeeded", transcript: result.transcript, confidence: result.confidence });
      } catch (reason) {
        dispatch({ type: "transcription_failed", message: transcriptionFailureMessage(reason) });
      }
    });
  }, [transcribe, transcription]);

  const issues = useMemo(
    () => voiceSubmissionIssues({ transcript: state.transcript, agentName: state.agentName, booksAppointments: state.booksAppointments }),
    [state.transcript, state.agentName, state.booksAppointments],
  );

  const confirmTranscript = useCallback(() => {
    if (!stateReference.current.transcript.trim()) {
      setShowIssues(true);
      return;
    }
    setShowIssues(false);
    dispatch({ type: "transcript_confirmed" });
  }, []);

  const submit = useCallback(() => {
    if (submitted) return;
    const current = stateReference.current;
    const blockers = voiceSubmissionIssues({ transcript: current.transcript, agentName: current.agentName, booksAppointments: current.booksAppointments });
    if (blockers.length > 0) {
      setShowIssues(true);
      return;
    }
    void submission.run(async () => {
      try {
        await onComplete({
          transcript: current.transcript.trim(),
          agentName: current.agentName.trim(),
          booksAppointments: current.booksAppointments === true,
        });
        // The caller is about to navigate. The control stays disabled through
        // that rather than flicking back to clickable for a frame, because a
        // second click here is a second agent generation.
        setSubmitted(true);
      } catch (reason) {
        dispatch({ type: "submission_failed", message: reason instanceof Error ? reason.message : "We could not build your agent. Please try again." });
      }
    });
  }, [onComplete, submission, submitted]);

  return (
    <VoiceOnboardingPanel
      phase={state.phase}
      support={recorder.support}
      // Null until the server has answered. A workspace with no transcription
      // provider is told so straight away, without a microphone prompt it
      // would have no use for.
      voiceAvailable={capability === null ? null : capability.enabled}
      requestingMicrophone={recorder.status === "requesting"}
      microphoneFailure={recorder.failure}
      elapsedSeconds={recorder.elapsedSeconds}
      maximumSeconds={maximumSeconds}
      warnWithinSeconds={warnWithinSeconds}
      level={recorder.level}
      reducedMotion={reducedMotion}
      playbackUrl={state.take?.url || ""}
      takeDurationSeconds={state.take?.durationSeconds || 0}
      transcript={state.transcript}
      confidence={state.confidence}
      failure={state.failure}
      agentName={state.agentName}
      booksAppointments={state.booksAppointments}
      issues={showIssues ? issues : []}
      submitting={submission.busy || submitted}
      idPrefix={idPrefix}
      onStart={recorder.start}
      onStop={recorder.stop}
      onDiscard={discard}
      onSend={send}
      onTranscriptChange={(transcript) => dispatch({ type: "transcript_edited", transcript })}
      onConfirmTranscript={confirmTranscript}
      onBackToTranscript={() => dispatch({ type: "back_to_transcript" })}
      onAgentNameChange={(agentName) => dispatch({ type: "agent_name_edited", agentName })}
      onBookingChange={(booksAppointments) => dispatch({ type: "booking_chosen", booksAppointments })}
      onSubmit={submit}
      onSkip={onSkip}
    />
  );
}
