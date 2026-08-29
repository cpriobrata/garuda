"use client";

// Everything the owner sees, as a function of props alone.
//
// The panel holds no state and reaches for no browser API, which is what lets
// every screen it can show — including the four failure screens people
// actually hit — be rendered and asserted on directly.

import { AlertCircle, ArrowLeft, ArrowRight, CalendarCheck, Check, Keyboard, Mic, Pencil, RotateCcw, Square } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, Spinner } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  agentNameLimit,
  recordingAnnouncement,
  transcriptHint,
  type VoicePhase,
  type VoiceSubmissionIssue,
} from "@/components/voice/voice-flow-state";
import { formatAllowance, formatElapsed, levelBarHeights, meterLevel, recordingLimit, type MicrophoneFailure, type RecordingSupport } from "@/components/voice/voice-recording";

export type VoicePanelProps = {
  phase: VoicePhase;
  // Null while the browser has not been inspected yet, which is every server
  // render and the first client frame.
  support: RecordingSupport | null;
  // Null while the server has not yet said whether transcription is
  // configured for this workspace.
  voiceAvailable: boolean | null;
  requestingMicrophone: boolean;
  microphoneFailure: MicrophoneFailure | null;
  elapsedSeconds: number;
  maximumSeconds: number;
  warnWithinSeconds: number;
  level: number;
  reducedMotion: boolean;
  playbackUrl: string;
  takeDurationSeconds: number;
  transcript: string;
  confidence: number | null;
  failure: string;
  agentName: string;
  booksAppointments: boolean | null;
  issues: VoiceSubmissionIssue[];
  submitting: boolean;
  idPrefix?: string;
  onStart: () => void;
  onStop: () => void;
  onDiscard: () => void;
  onSend: () => void;
  onTranscriptChange: (transcript: string) => void;
  onConfirmTranscript: () => void;
  onBackToTranscript: () => void;
  onAgentNameChange: (agentName: string) => void;
  onBookingChange: (booksAppointments: boolean) => void;
  onSubmit: () => void;
  onSkip: () => void;
};

function issueFor(issues: VoiceSubmissionIssue[], field: VoiceSubmissionIssue["field"]) {
  return issues.find((issue) => issue.field === field)?.message || "";
}

// The level meter. Marked aria-hidden because it is a second, visual reading
// of something the live region already says in words; a bar chart that
// re-renders sixty times a second is not something to hand a screen reader.
function LevelMeter({ level, reducedMotion }: { level: number; reducedMotion: boolean }) {
  const heights = levelBarHeights(meterLevel(level, reducedMotion), 9);
  return (
    <div aria-hidden="true" className="flex h-12 items-end justify-center gap-1.5">
      {heights.map((height, index) => (
        <span
          key={index}
          style={{ height: `${height}%` }}
          className={cn(
            "w-1.5 rounded-full bg-indigo-500",
            // Under reduced motion the bar still reports the level, it simply
            // stops easing between values.
            reducedMotion ? "transition-none" : "transition-[height] duration-75",
          )}
        />
      ))}
    </div>
  );
}

function FailureNotice({ title, message }: { title: string; message: string }) {
  return (
    <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-left">
      <p className="flex items-start gap-2 text-sm font-semibold text-amber-900">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        {title}
      </p>
      <p className="mt-1.5 pl-6 text-xs leading-5 text-amber-800">{message}</p>
    </div>
  );
}

export function VoiceOnboardingPanel(props: VoicePanelProps) {
  const idPrefix = props.idPrefix || "voice";
  const transcriptId = `${idPrefix}-transcript`;
  const transcriptHelpId = `${idPrefix}-transcript-help`;
  const agentNameId = `${idPrefix}-agent-name`;
  const agentNameHelpId = `${idPrefix}-agent-name-help`;
  const limit = recordingLimit(props.elapsedSeconds, props.maximumSeconds, props.warnWithinSeconds);
  // Only worth telling someone their browser cannot record once we know the
  // workspace would have accepted a recording at all.
  const unusable = props.voiceAvailable === true && props.support !== null && !props.support.supported;
  const announcement = recordingAnnouncement({
    phase: props.phase,
    elapsedSeconds: props.elapsedSeconds,
    maximumSeconds: props.maximumSeconds,
    warnWithinSeconds: props.warnWithinSeconds,
  });
  const hint = transcriptHint(props.transcript);

  return (
    <section aria-labelledby={`${idPrefix}-title`} className="mx-auto w-full max-w-2xl overflow-hidden rounded-3xl border bg-white shadow-[0_30px_90px_rgba(41,37,92,.11)]">
      <div className="border-b px-5 py-5 sm:px-6">
        <Badge variant="purple" className="mb-3">
          <Mic className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Talk, do not type
        </Badge>
        <h2 id={`${idPrefix}-title`} className="text-xl font-bold tracking-[-.03em] text-slate-950">
          Tell me about your business out loud
        </h2>
        <p className="mt-1.5 text-sm leading-6 text-slate-600">
          Speak in whichever language you are most comfortable in. You will see the transcript and can correct every word before anything is built.
        </p>
      </div>

      {/* The single live region for the whole flow. Its text changes at
          milestones rather than on every tick, so it is read out when
          something has actually happened. */}
      <p role="status" aria-live="polite" className="sr-only">{announcement}</p>

      <div className="space-y-5 px-5 py-6 sm:px-6">
        {props.microphoneFailure && <FailureNotice title={props.microphoneFailure.title} message={props.microphoneFailure.message} />}

        {props.voiceAvailable === false && (
          <FailureNotice
            title="Voice setup is not available on this workspace"
            message="Transcription is not configured here, so the questions are the way in for now. Nothing is lost — the typed answers build exactly the same agent."
          />
        )}

        {props.voiceAvailable !== false && (props.support === null || props.voiceAvailable === null) && (
          <div className="grid place-items-center gap-3 py-6 text-center">
            <Button type="button" size="lg" variant="dark" disabled className="h-20 w-20 rounded-full p-0">
              <Mic className="h-7 w-7" aria-hidden="true" />
            </Button>
            <p className="text-xs text-slate-500">Getting the recorder ready…</p>
          </div>
        )}

        {unusable && props.support && <FailureNotice title={props.support.title} message={props.support.message} />}

        {props.voiceAvailable === true && props.support !== null && props.support.supported && (
          <>
            {props.phase === "idle" && (
              <div className="grid place-items-center gap-4 py-4 text-center">
                <Button
                  type="button"
                  size="lg"
                  variant="dark"
                  onClick={props.onStart}
                  loading={props.requestingMicrophone}
                  loadingLabel="Asking for microphone access"
                  className="h-24 w-24 rounded-full p-0 shadow-glow"
                >
                  <Mic className="h-9 w-9" aria-hidden="true" />
                  <span className="sr-only">Start recording</span>
                </Button>
                <div>
                  <p className="text-sm font-semibold text-slate-900">Press record and just talk</p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    What you sell, who buys it, and what you want the agent to do. Up to {formatAllowance(props.maximumSeconds)}.
                  </p>
                </div>
              </div>
            )}

            {props.phase === "recording" && (
              <div className="grid place-items-center gap-4 py-2 text-center">
                {/* Three separate signals that this is live: the words, the
                    clock, and the meter. The meter alone would leave anyone
                    who cannot see it, or who has motion turned down, guessing. */}
                <p className="flex items-center gap-2 text-sm font-semibold text-red-600">
                  <span className={cn("h-2.5 w-2.5 rounded-full bg-red-600", !props.reducedMotion && "animate-pulse motion-reduce:animate-none")} aria-hidden="true" />
                  Recording
                </p>
                <p className="text-3xl font-bold tabular-nums tracking-tight text-slate-950">
                  {formatElapsed(props.elapsedSeconds)}
                  <span className="sr-only"> elapsed</span>
                </p>
                <LevelMeter level={props.level} reducedMotion={props.reducedMotion} />
                {limit.warning && (
                  <p role="alert" className="text-xs font-semibold text-amber-700">
                    {limit.remainingSeconds} seconds left — recording stops on its own at the limit.
                  </p>
                )}
                <Button type="button" size="lg" variant="destructive" onClick={props.onStop} className="rounded-full px-7">
                  <Square className="mr-2 h-4 w-4" aria-hidden="true" /> Stop recording
                </Button>
              </div>
            )}

            {(props.phase === "recorded" || props.phase === "transcribing") && (
              <div className="space-y-4">
                <div className="rounded-xl border bg-slate-50/60 p-4">
                  <p className="mb-2 text-xs font-semibold text-slate-700">
                    Your recording · {formatElapsed(props.takeDurationSeconds)}
                  </p>
                  {/* Native controls, so play, pause and seek are keyboard
                      operable without anything of ours in the way. */}
                  <audio className="w-full" controls src={props.playbackUrl} preload="metadata" />
                </div>
                {props.failure && <FailureNotice title="That did not go through" message={props.failure} />}
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    onClick={props.onSend}
                    loading={props.phase === "transcribing"}
                    loadingLabel="Uploading and transcribing your recording"
                    className="flex-1"
                  >
                    {props.failure ? "Try again" : "Send for transcription"}
                    <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
                  </Button>
                  <Button type="button" variant="outline" onClick={props.onDiscard} disabled={props.phase === "transcribing"}>
                    <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" /> Record again
                  </Button>
                </div>
                {props.phase === "transcribing" && (
                  <p className="flex items-center gap-2 text-xs text-slate-500">
                    <Spinner className="h-3.5 w-3.5 text-indigo-600" />
                    Uploading and transcribing. This takes a few seconds — you do not need to press anything again.
                  </p>
                )}
              </div>
            )}

            {props.phase === "review" && (
              <div className="space-y-4">
                <div>
                  <label htmlFor={transcriptId} className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <Pencil className="h-3.5 w-3.5 text-indigo-600" aria-hidden="true" /> Check the transcript
                  </label>
                  <p id={transcriptHelpId} className="mt-1 text-xs leading-5 text-slate-500">
                    Edit anything that came out wrong — business names especially. This exact text is what your agent is built from.
                  </p>
                  <Textarea
                    id={transcriptId}
                    value={props.transcript}
                    onChange={(event) => props.onTranscriptChange(event.target.value)}
                    aria-describedby={transcriptHelpId}
                    aria-invalid={issueFor(props.issues, "transcript") ? true : undefined}
                    className="mt-2 min-h-[180px]"
                  />
                  <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11px] text-slate-400">{props.transcript.trim().length} characters</span>
                    {props.confidence !== null && props.confidence < 0.8 && (
                      <span className="text-[11px] font-semibold text-amber-700">Parts of this were hard to hear — read it through carefully.</span>
                    )}
                  </div>
                  {hint && <p className="mt-1 text-[11px] leading-4 text-slate-500">{hint}</p>}
                  {issueFor(props.issues, "transcript") && (
                    <p role="alert" className="mt-1.5 text-xs font-medium text-red-600">{issueFor(props.issues, "transcript")}</p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" onClick={props.onConfirmTranscript} className="flex-1">
                    This is right <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
                  </Button>
                  <Button type="button" variant="outline" onClick={props.onDiscard}>
                    <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" /> Record again
                  </Button>
                </div>
              </div>
            )}

            {props.phase === "details" && (
              <div className="space-y-5">
                <div>
                  <label htmlFor={agentNameId} className="text-sm font-semibold text-slate-900">What should your agent be called?</label>
                  <p id={agentNameHelpId} className="mt-1 text-xs leading-5 text-slate-500">This is the name visitors see at the top of the chat.</p>
                  <Input
                    id={agentNameId}
                    value={props.agentName}
                    onChange={(event) => props.onAgentNameChange(event.target.value)}
                    maxLength={agentNameLimit}
                    placeholder="e.g. Aria"
                    aria-describedby={agentNameHelpId}
                    aria-invalid={issueFor(props.issues, "agent_name") ? true : undefined}
                    className="mt-2"
                  />
                  {issueFor(props.issues, "agent_name") && (
                    <p role="alert" className="mt-1.5 text-xs font-medium text-red-600">{issueFor(props.issues, "agent_name")}</p>
                  )}
                </div>

                <fieldset>
                  <legend className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <CalendarCheck className="h-3.5 w-3.5 text-indigo-600" aria-hidden="true" /> Should it book appointments?
                  </legend>
                  <p className="mt-1 text-xs leading-5 text-slate-500">Booking agents offer times and take a slot. Otherwise the agent answers questions and hands over contact details.</p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {[
                      { value: true, label: "Yes, book appointments", description: "Offer times and confirm a slot" },
                      { value: false, label: "No, just conversations", description: "Answer questions and capture details" },
                    ].map((choice) => (
                      <label
                        key={String(choice.value)}
                        className={cn(
                          "flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition focus-within:ring-2 focus-within:ring-indigo-500/25 motion-reduce:transition-none",
                          props.booksAppointments === choice.value ? "border-indigo-300 bg-indigo-50/60" : "hover:border-indigo-200",
                        )}
                      >
                        <input
                          type="radio"
                          name={`${idPrefix}-booking`}
                          value={String(choice.value)}
                          checked={props.booksAppointments === choice.value}
                          onChange={() => props.onBookingChange(choice.value)}
                          className="mt-0.5 h-4 w-4 accent-indigo-600"
                        />
                        <span>
                          <span className="block text-xs font-semibold text-slate-900">{choice.label}</span>
                          <span className="mt-0.5 block text-[11px] leading-4 text-slate-500">{choice.description}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                  {issueFor(props.issues, "booking") && (
                    <p role="alert" className="mt-1.5 text-xs font-medium text-red-600">{issueFor(props.issues, "booking")}</p>
                  )}
                </fieldset>

                {props.failure && <FailureNotice title="That did not go through" message={props.failure} />}

                <div className="flex flex-wrap gap-2">
                  <Button type="button" onClick={props.onSubmit} loading={props.submitting} loadingLabel="Building your agent" className="flex-1">
                    <Check className="mr-2 h-4 w-4" aria-hidden="true" /> Build my agent
                  </Button>
                  <Button type="button" variant="outline" onClick={props.onBackToTranscript} disabled={props.submitting}>
                    <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" /> Back to transcript
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Always present, in every phase and every failure. Someone who cannot
          or will not record needs a way out that does not depend on the
          recorder working at all. */}
      <div className="border-t bg-slate-50/60 px-5 py-4 sm:px-6">
        <button
          type="button"
          onClick={props.onSkip}
          className="inline-flex items-center gap-2 rounded-lg px-1 text-xs font-semibold text-slate-600 underline-offset-4 transition hover:text-indigo-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transition-none"
        >
          <Keyboard className="h-3.5 w-3.5" aria-hidden="true" /> Skip voice and type my answers instead
        </button>
      </div>
    </section>
  );
}
