package api

import (
	"context"
	"errors"
	"io"
	"math"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"garuda/backend/internal/config"
	"garuda/backend/internal/deepgram"
	"garuda/backend/internal/model"
)

// Voice onboarding: the owner presses record, talks about their business, and gets
// back the text of what was heard. Nothing is generated from a recording the owner
// has not read: a transcript can mishear a brand name or a price, and an agent
// drafted from an unseen mistake is worse than no agent at all. This endpoint only
// transcribes; drafting happens afterwards, from text the owner has approved.
//
// Transcription is billed by the minute against one shared provider key, so every
// limit below exists to bound what one signed-in account can spend.
const (
	// maxVoiceNoteSeconds is the recording length the portal is told to allow. An
	// owner describing their business runs one to two minutes; past that they are
	// repeating themselves and the transcript gets harder to read back.
	maxVoiceNoteSeconds = 120
	// maxVoiceNoteBytes caps the upload before a byte of it is read. MediaRecorder
	// encodes mono speech to webm/opus at roughly 24 to 64 kbps, so two minutes is
	// 0.4 to 1 MB. Four megabytes is two minutes at about 260 kbps, far above what
	// any browser produces for speech, which leaves the limit generous for a real
	// recording while staying nowhere near what an hour of audio would need.
	maxVoiceNoteBytes = 4 << 20
	// minVoiceNoteBytes rejects a body too small to hold speech in any container we
	// accept: a webm/opus header plus a second of audio is already several kilobytes.
	// A fumbled tap that recorded nothing must not reach a paid provider.
	minVoiceNoteBytes = 2 << 10
	// The per-account budget. Onboarding needs a handful of recordings, so twenty
	// minutes of audio an hour is generous for a real owner and small enough that a
	// stolen session cannot run up a bill.
	voiceQuotaWindow    = time.Hour
	voiceQuotaPerWindow = 20 * time.Minute
	// estimatedVoiceBytesPerSecond turns a body size into the audio length reserved
	// before the provider is called, at roughly 32 kbps. The provider's own
	// measurement replaces this the moment the call returns, so the estimate only has
	// to be close enough to keep an obviously oversized upload out.
	estimatedVoiceBytesPerSecond = 4_000
	// A three minute recording is a few thousand characters. The cap only exists so a
	// provider response cannot grow the data file without bound.
	maxTranscriptCharacters = 20_000
	// voiceTranscriptionJobType marks the ledger rows this file writes. Jobs already
	// carry an account id and a timestamp, which is exactly what an hourly meter
	// needs, and it keeps the meter out of the answers the owner can see and edit.
	voiceTranscriptionJobType = "voice_transcription"
	voiceUsageResultKey       = "audio_milliseconds"
)

// The onboarding record has no voice fields and model.go is not ours to change, so
// the transcript and the two follow-up answers live in the existing Answers map
// under these keys. They are namespaced so they cannot collide with a question id,
// and PUT /v1/onboarding keeps only known question ids, so a caller cannot overwrite
// them by posting an answers map of their own.
const (
	voiceTranscriptAnswerKey           = "voice_transcript"
	voiceTranscriptLanguageAnswerKey   = "voice_transcript_language"
	voiceTranscriptRecordedAtAnswerKey = "voice_transcript_recorded_at"
	voiceAgentDisplayNameAnswerKey     = "voice_agent_display_name"
	voiceOfferBookingAnswerKey         = "voice_offer_booking"
)

// voiceTranscriber is the part of the speech provider this endpoint uses. The
// interface exists so the handler can be exercised against a stub, and so a build
// with no Deepgram credential takes the disabled path instead of the network.
type voiceTranscriber interface {
	Enabled() bool
	Transcribe(ctx context.Context, audio []byte, contentType string) (deepgram.Transcript, error)
}

// newVoiceTranscriber builds the adapter for one request out of configuration. It
// is a variable because the server holds no field for it and server.go is not ours
// to change; nothing outside tests reassigns it.
var newVoiceTranscriber = func(configuration config.Config) voiceTranscriber {
	return deepgram.New("", configuration.DeepgramAPIKey, configuration.DeepgramModel)
}

// acceptedVoiceMediaTypes is what a browser recorder actually produces. Anything
// else is refused before the provider is called, because even an unsupported
// container costs money to have rejected.
var acceptedVoiceMediaTypes = map[string]bool{
	"audio/webm": true, "audio/ogg": true, "audio/opus": true, "audio/mp4": true,
	"audio/mpeg": true, "audio/mpga": true, "audio/mp3": true, "audio/m4a": true,
	"audio/x-m4a": true, "audio/aac": true, "audio/wav": true, "audio/x-wav": true,
	"audio/wave": true, "audio/flac": true,
	// Chrome labels an audio-only MediaRecorder stream video/webm unless the page
	// names a mimeType, so refusing it would break recording on a default setup. The
	// size cap and the audio meter bound it exactly as they bound audio/webm.
	"video/webm": true,
	"video/mp4":  true,
}

// voiceFollowUpQuestion is a short answer that is better typed or tapped than
// spoken: a display name has a spelling the owner cares about, and a yes-or-no
// belongs on a switch. They are a small structured step after the recording rather
// than part of it.
type voiceFollowUpQuestion struct {
	ID        string `json:"id"`
	Prompt    string `json:"prompt"`
	Kind      string `json:"kind"`
	InputHint string `json:"input_hint,omitempty"`
}

var voiceFollowUpQuestions = []voiceFollowUpQuestion{
	{ID: "agent_display_name", Prompt: "What should your assistant be called?", Kind: "text", InputHint: "Visitors see this name at the top of the chat, for example Acme Assistant."},
	{ID: "offer_booking", Prompt: "Should the assistant offer to book appointments?", Kind: "boolean", InputHint: "Turn this on if visitors should be able to arrange a call or a visit."},
}

// voiceQuotaExceededError reports that the account has already had more audio
// transcribed inside the window than the budget allows.
type voiceQuotaExceededError struct {
	usedMilliseconds  int64
	limitMilliseconds int64
	retryAfter        time.Duration
}

func (e voiceQuotaExceededError) Error() string { return "voice transcription quota exceeded" }

func (s *Server) transcribeVoiceOnboarding(w http.ResponseWriter, r *http.Request) {
	identity := identityFrom(r.Context())
	// Entitlement before anything else. Transcription reaches a paid provider on a
	// shared key, so an account with no subscription must not be able to spend on it.
	if !s.hasEntitlement(identity.AccountID) {
		s.writeError(w, r, http.StatusPaymentRequired, "subscription_required", "An active subscription is required to record a voice note", nil)
		return
	}
	transcriber := newVoiceTranscriber(s.cfg)
	if !transcriber.Enabled() {
		// No credential configured. Voice is an accelerator, not the only path, so
		// this is a plain "not available" and the portal falls back to typing.
		s.writeError(w, r, http.StatusServiceUnavailable, "voice_unavailable", "Voice onboarding is not available; type your answers instead", nil)
		return
	}
	mediaType, accepted := acceptedVoiceContentType(r.Header.Get("Content-Type"))
	if !accepted {
		s.writeError(w, r, http.StatusUnsupportedMediaType, "unsupported_media_type", "Send the recording as an audio body such as audio/webm", nil)
		return
	}
	// The portal also sends the length it recorded. It is not read: a number the
	// caller chose cannot be what a bill is measured against. The length that counts
	// is the one the provider measures, settled below.
	// The limit goes on the body BEFORE the first read, so an oversized upload is cut
	// off at the socket rather than buffered and measured afterwards. decodeJSON's cap
	// cannot be reused here: audio is not JSON, and a base64 field inside a 1 MB JSON
	// envelope would hold barely a minute of speech.
	r.Body = http.MaxBytesReader(w, r.Body, maxVoiceNoteBytes)
	audio, err := io.ReadAll(r.Body)
	if err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			s.writeError(w, r, http.StatusRequestEntityTooLarge, "audio_too_large", "That recording is too long; keep it under three minutes", map[string]int{"max_bytes": maxVoiceNoteBytes})
			return
		}
		s.writeError(w, r, http.StatusBadRequest, "invalid_request", "The recording could not be read", nil)
		return
	}
	if len(audio) < minVoiceNoteBytes {
		s.writeError(w, r, http.StatusUnprocessableEntity, "audio_too_short", "That recording is too short; hold record and speak for a few seconds", nil)
		return
	}

	now := time.Now().UTC()
	reservationID, err := s.reserveVoiceTranscription(identity.AccountID, estimatedVoiceDuration(len(audio)), now)
	var overQuota voiceQuotaExceededError
	if errors.As(err, &overQuota) {
		w.Header().Set("Retry-After", strconv.Itoa(max(1, int(overQuota.retryAfter.Seconds()))))
		s.writeError(w, r, http.StatusTooManyRequests, "voice_quota_exceeded", "This account has transcribed as much audio as an hour allows; try again shortly or type your answers", map[string]any{
			"used_seconds": roundedSeconds(overQuota.usedMilliseconds), "limit_seconds": roundedSeconds(overQuota.limitMilliseconds),
			"window_seconds": int(voiceQuotaWindow.Seconds()),
		})
		return
	}
	if err != nil {
		s.storageFailure(w, r, err)
		return
	}

	transcript, err := transcriber.Transcribe(r.Context(), audio, mediaType)
	if err != nil {
		// The reservation deliberately stands. A rejected call may still have been
		// billed, and refunding it would open a free unmetered channel: send audio the
		// provider dislikes, get the budget back, repeat for as long as you like. The
		// error is logged; the recording and any words in it are not.
		s.logger.Warn("voice transcription failed", "request_id", requestID(r.Context()), "error", err)
		s.writeError(w, r, http.StatusServiceUnavailable, "transcription_unavailable", "That recording could not be transcribed just now; try again or type your answers", nil)
		return
	}
	text := truncateCharacters(transcript.Text, maxTranscriptCharacters)

	// One write settles the reservation against the length the provider measured and
	// stores the transcript, so the meter and the saved answer can never disagree.
	onboarding, usage, err := s.settleVoiceTranscription(identity.AccountID, reservationID, transcript.AudioDuration, text, transcript.Language, now)
	if err != nil {
		s.storageFailure(w, r, err)
		return
	}
	if text == "" {
		// Silence, or a recording with no speech in it. Saying so beats handing the
		// portal an empty box to render. The audio still cost money, so the usage
		// settled above stands.
		s.writeError(w, r, http.StatusUnprocessableEntity, "no_speech_detected", "Nothing could be heard in that recording; try again somewhere quieter", nil)
		return
	}
	s.writeData(w, http.StatusCreated, map[string]any{
		"transcript": text, "language": transcript.Language, "confidence": transcript.Confidence,
		"duration_seconds":    math.Round(transcript.AudioDuration.Seconds()*10) / 10,
		"recorded_at":         now,
		"usage":               usage,
		"follow_up_questions": voiceFollowUpQuestions,
		"details":             voiceDetailsView(onboarding),
	})
}

// getVoiceOnboarding reports whether voice is available, what it stored last, and
// what the account has already spent this hour, so a refreshed page can show the
// owner the transcript instead of asking them to record it again.
func (s *Server) getVoiceOnboarding(w http.ResponseWriter, r *http.Request) {
	identity := identityFrom(r.Context())
	onboarding, found := s.onboardingFor(identity.AccountID)
	if !found {
		onboarding = model.Onboarding{AccountID: identity.AccountID, Answers: map[string]string{}}
	}
	var usedMilliseconds int64
	_ = s.store.View(func(state *model.State) error {
		usedMilliseconds, _ = voiceUsageInWindow(state, identity.AccountID, time.Now().UTC())
		return nil
	})
	payload := map[string]any{
		// enabled, max_duration_seconds and max_bytes are what the recorder reads
		// before it offers a microphone at all: an unconfigured workspace shows the
		// typed questions instead, and the recorder stops itself at the length and
		// size the server will actually accept rather than failing after the fact.
		"enabled":                newVoiceTranscriber(s.cfg).Enabled(),
		"max_duration_seconds":   maxVoiceNoteSeconds,
		"max_bytes":              maxVoiceNoteBytes,
		"min_bytes":              minVoiceNoteBytes,
		"accepted_content_types": acceptedVoiceContentTypeList(),
		"follow_up_questions":    voiceFollowUpQuestions,
		"details":                voiceDetailsView(onboarding),
		"usage":                  voiceUsageView(usedMilliseconds),
	}
	for field, value := range voiceTranscriptView(onboarding) {
		payload[field] = value
	}
	s.writeData(w, http.StatusOK, payload)
}

type saveVoiceDetailsRequest struct {
	AgentDisplayName *string `json:"agent_display_name,omitempty"`
	OfferBooking     *bool   `json:"offer_booking,omitempty"`
}

// saveVoiceOnboardingDetails records the two short follow-ups. They are separate
// from the recording on purpose: a name has a spelling the owner cares about, and a
// yes-or-no is one tap rather than a sentence a transcript could get backwards.
func (s *Server) saveVoiceOnboardingDetails(w http.ResponseWriter, r *http.Request) {
	var input saveVoiceDetailsRequest
	if !s.decodeJSON(w, r, &input) {
		return
	}
	displayName := ""
	if input.AgentDisplayName != nil {
		displayName = strings.TrimSpace(*input.AgentDisplayName)
		// Matches the agent name rule, so a name accepted here cannot be refused by
		// the agent that gets drafted from it.
		if displayName != "" && (utf8.RuneCountInString(displayName) < 2 || len(displayName) > 120) {
			s.writeError(w, r, http.StatusUnprocessableEntity, "validation_failed", "The assistant name must be 2 to 120 characters", map[string]string{"field": "agent_display_name"})
			return
		}
	}
	identity := identityFrom(r.Context())
	now := time.Now().UTC()
	var result model.Onboarding
	if err := s.store.Update(func(state *model.State) error {
		onboarding := ensureOnboarding(state, identity.AccountID, now)
		if input.AgentDisplayName != nil {
			if displayName == "" {
				delete(onboarding.Answers, voiceAgentDisplayNameAnswerKey)
			} else {
				onboarding.Answers[voiceAgentDisplayNameAnswerKey] = displayName
			}
		}
		if input.OfferBooking != nil {
			onboarding.Answers[voiceOfferBookingAnswerKey] = strconv.FormatBool(*input.OfferBooking)
		}
		onboarding.UpdatedAt = now
		// Clone: this value is encoded after the write lock is gone, and the map it
		// carries is the live one another request writes. Reading a map while another
		// goroutine writes it kills the process outright.
		result = onboarding.Clone()
		return nil
	}); err != nil {
		s.storageFailure(w, r, err)
		return
	}
	saved := map[string]any{
		"follow_up_questions": voiceFollowUpQuestions,
		"details":             voiceDetailsView(result),
	}
	for field, value := range voiceTranscriptView(result) {
		saved[field] = value
	}
	s.writeData(w, http.StatusOK, saved)
}

// reserveVoiceTranscription checks the hourly budget and records the spend in the
// SAME write. Checking in a View and recording in a later Update would let two
// requests that both read "under budget" both proceed, which is precisely the race
// an attacker with one session and two connections would use.
func (s *Server) reserveVoiceTranscription(accountID string, estimated time.Duration, now time.Time) (string, error) {
	reservationID := newID("job_")
	estimatedMilliseconds := estimated.Milliseconds()
	if estimatedMilliseconds < 1 {
		estimatedMilliseconds = 1
	}
	err := s.store.Update(func(state *model.State) error {
		used, oldest := voiceUsageInWindow(state, accountID, now)
		if used+estimatedMilliseconds > voiceQuotaPerWindow.Milliseconds() {
			retryAfter := voiceQuotaWindow
			if !oldest.IsZero() {
				retryAfter = oldest.Add(voiceQuotaWindow).Sub(now)
			}
			return voiceQuotaExceededError{usedMilliseconds: used, limitMilliseconds: voiceQuotaPerWindow.Milliseconds(), retryAfter: retryAfter}
		}
		reservation := model.Job{
			ID: reservationID, AccountID: accountID, Type: voiceTranscriptionJobType, Status: "running",
			Result: map[string]any{voiceUsageResultKey: float64(estimatedMilliseconds), "settled": false},
			// No transcript, no audio, no file name: this row is a meter reading.
			CreatedAt: now, UpdatedAt: now,
		}
		state.Jobs = appendVoiceLedgerRow(state.Jobs, reservation, now)
		return nil
	})
	if err != nil {
		return "", err
	}
	return reservationID, nil
}

// settleVoiceTranscription replaces the reserved estimate with the length the
// provider actually measured and stores the transcript, in one write.
//
// Settling down is what stops the estimate from punishing an owner whose browser
// encodes a short note at a high bitrate. Settling up is what makes a deliberately
// low-bitrate upload pay its real cost -- after the fact, which is the part money
// cannot buy back, but it locks the account out for the rest of the hour.
func (s *Server) settleVoiceTranscription(accountID, reservationID string, measured time.Duration, transcriptText, language string, now time.Time) (model.Onboarding, map[string]any, error) {
	var result model.Onboarding
	var usedMilliseconds int64
	err := s.store.Update(func(state *model.State) error {
		if measured > 0 {
			for index := range state.Jobs {
				if state.Jobs[index].ID != reservationID || state.Jobs[index].AccountID != accountID {
					continue
				}
				state.Jobs[index].Result = map[string]any{voiceUsageResultKey: float64(measured.Milliseconds()), "settled": true}
				state.Jobs[index].Status = "succeeded"
				state.Jobs[index].UpdatedAt = now
				break
			}
		}
		onboarding := ensureOnboarding(state, accountID, now)
		if transcriptText != "" {
			onboarding.Answers[voiceTranscriptAnswerKey] = transcriptText
			onboarding.Answers[voiceTranscriptRecordedAtAnswerKey] = now.Format(time.RFC3339)
			if language = strings.TrimSpace(language); language != "" {
				onboarding.Answers[voiceTranscriptLanguageAnswerKey] = language
			} else {
				delete(onboarding.Answers, voiceTranscriptLanguageAnswerKey)
			}
			onboarding.UpdatedAt = now
		}
		result = onboarding.Clone()
		usedMilliseconds, _ = voiceUsageInWindow(state, accountID, now)
		return nil
	})
	if err != nil {
		return model.Onboarding{}, nil, err
	}
	return result, voiceUsageView(usedMilliseconds), nil
}

// voiceUsageInWindow totals the audio already transcribed for one account inside the
// window, and reports the oldest row still counting so the caller can say when room
// frees up. The caller must be inside View or Update.
func voiceUsageInWindow(state *model.State, accountID string, now time.Time) (int64, time.Time) {
	cutoff := now.Add(-voiceQuotaWindow)
	var total int64
	var oldest time.Time
	for _, job := range state.Jobs {
		if job.Type != voiceTranscriptionJobType || job.AccountID != accountID || !job.CreatedAt.After(cutoff) {
			continue
		}
		milliseconds, _ := job.Result[voiceUsageResultKey].(float64)
		if milliseconds <= 0 {
			continue
		}
		total += int64(milliseconds)
		if oldest.IsZero() || job.CreatedAt.Before(oldest) {
			oldest = job.CreatedAt
		}
	}
	return total, oldest
}

// appendVoiceLedgerRow adds one meter reading and drops meter readings far enough
// outside the window that they can never affect it again, so the ledger cannot grow
// without bound. Only rows this file wrote are ever dropped; a generation job the
// portal may still poll is never touched. The survivors are copied into a fresh
// slice rather than filtered in place, so a reader holding the old slice header
// keeps reading an array nothing writes to.
func appendVoiceLedgerRow(jobs []model.Job, row model.Job, now time.Time) []model.Job {
	expiry := now.Add(-2 * voiceQuotaWindow)
	expired := 0
	for _, job := range jobs {
		if job.Type == voiceTranscriptionJobType && job.CreatedAt.Before(expiry) {
			expired++
		}
	}
	if expired == 0 {
		return append(jobs, row)
	}
	kept := make([]model.Job, 0, len(jobs)-expired+1)
	for _, job := range jobs {
		if job.Type == voiceTranscriptionJobType && job.CreatedAt.Before(expiry) {
			continue
		}
		kept = append(kept, job)
	}
	return append(kept, row)
}

// ensureOnboarding returns the account's onboarding record, creating it if this is
// the owner's first move, with an answers map that is safe to write to. The returned
// pointer points into live state and must not outlive the callback.
func ensureOnboarding(state *model.State, accountID string, now time.Time) *model.Onboarding {
	for index := range state.Onboarding {
		if state.Onboarding[index].AccountID == accountID {
			onboarding := &state.Onboarding[index]
			if onboarding.Answers == nil {
				onboarding.Answers = legacyOnboardingAnswers(*onboarding)
			}
			return onboarding
		}
	}
	state.Onboarding = append(state.Onboarding, model.Onboarding{AccountID: accountID, Answers: map[string]string{}, UpdatedAt: now})
	return &state.Onboarding[len(state.Onboarding)-1]
}

// onboardingFor returns a copy of one account's onboarding record. The copy is deep:
// the answers map is written by other requests, and encoding a live map while
// another goroutine writes it terminates the process.
func (s *Server) onboardingFor(accountID string) (model.Onboarding, bool) {
	var result model.Onboarding
	found := false
	_ = s.store.View(func(state *model.State) error {
		for _, candidate := range state.Onboarding {
			if candidate.AccountID == accountID {
				result, found = candidate.Clone(), true
				break
			}
		}
		return nil
	})
	return result, found
}

// voiceTranscriptView is the stored transcript in the same field names the
// transcribe response uses, so the portal reads one shape whether the owner has
// just recorded or has come back to a refreshed page.
func voiceTranscriptView(onboarding model.Onboarding) map[string]any {
	return map[string]any{
		"transcript":  onboarding.Answers[voiceTranscriptAnswerKey],
		"language":    onboarding.Answers[voiceTranscriptLanguageAnswerKey],
		"recorded_at": onboarding.Answers[voiceTranscriptRecordedAtAnswerKey],
	}
}

func voiceDetailsView(onboarding model.Onboarding) map[string]any {
	return map[string]any{
		"agent_display_name": onboarding.Answers[voiceAgentDisplayNameAnswerKey],
		"offer_booking":      onboarding.Answers[voiceOfferBookingAnswerKey] == "true",
	}
}

func voiceUsageView(usedMilliseconds int64) map[string]any {
	limit := voiceQuotaPerWindow.Milliseconds()
	remaining := limit - usedMilliseconds
	if remaining < 0 {
		remaining = 0
	}
	return map[string]any{
		"used_seconds": roundedSeconds(usedMilliseconds), "limit_seconds": roundedSeconds(limit),
		"remaining_seconds": roundedSeconds(remaining), "window_seconds": int(voiceQuotaWindow.Seconds()),
	}
}

func roundedSeconds(milliseconds int64) float64 {
	return math.Round(float64(milliseconds)/100) / 10
}

// estimatedVoiceDuration is what a body size suggests the recording is worth before
// the provider has measured it. It is a reservation, not a verdict: the measured
// length replaces it as soon as the call returns.
func estimatedVoiceDuration(byteCount int) time.Duration {
	seconds := float64(byteCount) / estimatedVoiceBytesPerSecond
	return time.Duration(seconds * float64(time.Second))
}

// acceptedVoiceContentType returns the media type to forward to the provider, and
// whether it is one we accept. Parameters such as codecs=opus are kept because the
// provider uses them, but the accept decision is made on the bare type.
func acceptedVoiceContentType(header string) (string, bool) {
	header = strings.TrimSpace(header)
	if header == "" {
		return "", false
	}
	mediaType := strings.ToLower(header)
	if semicolon := strings.Index(mediaType, ";"); semicolon >= 0 {
		mediaType = strings.TrimSpace(mediaType[:semicolon])
	}
	if !acceptedVoiceMediaTypes[mediaType] {
		return "", false
	}
	return header, true
}

func acceptedVoiceContentTypeList() []string {
	types := make([]string, 0, len(acceptedVoiceMediaTypes))
	for mediaType := range acceptedVoiceMediaTypes {
		types = append(types, mediaType)
	}
	sort.Strings(types)
	return types
}

// truncateCharacters cuts on a character boundary. A transcript may be in any
// language, and slicing bytes would leave a broken character at the end.
func truncateCharacters(value string, limit int) string {
	value = strings.TrimSpace(value)
	if utf8.RuneCountInString(value) <= limit {
		return value
	}
	return string([]rune(value)[:limit])
}
