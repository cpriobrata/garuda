// The public surface of the voice lane. Everything the onboarding page needs
// is one import; everything below it is an implementation detail it should
// never have to know about.

export { VoiceOnboarding, type VoiceOnboardingProps, type VoiceOnboardingResult } from "@/components/voice/voice-onboarding";
export { VoiceOnboardingPanel, type VoicePanelProps } from "@/components/voice/voice-onboarding-panel";
export {
  loadVoiceCapability,
  voiceRecordingDefaults,
  transcribeRecording,
  transcriptionFailureMessage,
  buildTranscriptionRequest,
  preUploadRejection,
  transcriptionFailureCodes,
  readVoiceCapability,
  recordingKeptSentence,
  type VoiceCapability,
  type VoiceTranscription,
} from "@/components/voice/voice-api";
export {
  agentNameLimit,
  initialVoiceFlowState,
  recordingAnnouncement,
  releaseTake,
  transcriptHint,
  voiceFlowReducer,
  voiceSubmissionIssues,
  type VoiceFlowAction,
  type VoiceFlowState,
  type VoicePhase,
  type VoiceSubmissionIssue,
  type VoiceTake,
} from "@/components/voice/voice-flow-state";
export {
  chooseRecordingMimeType,
  computeLevelFromWaveform,
  createRecorder,
  describeMicrophoneFailure,
  detectRecordingSupport,
  formatAllowance,
  formatElapsed,
  levelBarHeights,
  meterLevel,
  readRecordingEnvironment,
  recordingLimit,
  recordingMimeTypeCandidates,
  releaseMicrophoneStream,
  type MicrophoneFailure,
  type RecordingEnvironment,
  type RecordingSupport,
} from "@/components/voice/voice-recording";
export { usePrefersReducedMotion, useVoiceRecorder, type CapturedRecording, type VoiceRecorder } from "@/components/voice/use-voice-recorder";
