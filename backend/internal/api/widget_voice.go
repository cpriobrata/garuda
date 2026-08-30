package api

import (
	"errors"
	"io"
	"net/http"
	"strconv"
	"time"
)

// A visitor speaking to the widget instead of typing.
//
// This transcribes and hands the words back; it does NOT send them. The visitor
// sees what was heard and presses send, and the message then travels the
// ordinary chat path with its own rate limit, its conversation quota and its
// lead-capture rules.
//
// Two reasons for that, and the second is the one that matters. Speech
// recognition is wrong sometimes, and a misheard sentence sent to somebody's
// business without the speaker seeing it is worse than an extra tap -- "cancel
// my order" is one vowel from several other things. And a single chat path is
// one place where quota, consent and storage are decided, rather than two that
// drift.
//
// WHO PAYS. The audio is billed to the CUSTOMER whose website the visitor is on,
// through the same hourly budget the portal's own voice onboarding draws from.
// That is deliberate: it is their visitor and their conversation, and it means
// an account with no subscription cannot spend on transcription through an
// anonymous route.

// transcribeWidgetVoice turns a visitor's recording into text.
func (s *Server) transcribeWidgetVoice(w http.ResponseWriter, r *http.Request) {
	session, authorized := s.authorizeWidgetSession(r)
	if !authorized {
		s.writeError(w, r, http.StatusUnauthorized, "invalid_session", "The widget session is invalid or expired", nil)
		return
	}
	// Entitlement before a byte is read. Transcription reaches a paid provider on
	// a shared key, so a lapsed account must not be able to spend on it through
	// a route that needs no login.
	if !s.hasEntitlement(session.AccountID) {
		s.writeError(w, r, http.StatusPaymentRequired, "subscription_required", "This assistant is temporarily unavailable", nil)
		return
	}

	transcriber := newVoiceTranscriber(s.cfg)
	if !transcriber.Enabled() {
		// Voice is an accelerator, never the only way to talk. The widget falls
		// back to the keyboard and says so.
		s.writeError(w, r, http.StatusServiceUnavailable, "voice_unavailable", "Voice messages are not available here; please type instead", nil)
		return
	}
	mediaType, accepted := acceptedVoiceContentType(r.Header.Get("Content-Type"))
	if !accepted {
		s.writeError(w, r, http.StatusUnsupportedMediaType, "unsupported_media_type", "Send the recording as an audio body such as audio/webm", nil)
		return
	}

	// The cap goes on the body before the first read, so an oversized upload is
	// cut off at the socket rather than buffered and measured afterwards.
	r.Body = http.MaxBytesReader(w, r.Body, maxWidgetVoiceBytes)
	audio, err := io.ReadAll(r.Body)
	if err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			s.writeError(w, r, http.StatusRequestEntityTooLarge, "audio_too_large", "That message is too long; keep it under a minute", map[string]int{"max_bytes": maxWidgetVoiceBytes})
			return
		}
		s.writeError(w, r, http.StatusBadRequest, "invalid_request", "The recording could not be read", nil)
		return
	}
	if len(audio) < minVoiceNoteBytes {
		s.writeError(w, r, http.StatusUnprocessableEntity, "audio_too_short", "That was too short to hear; hold the button and speak", nil)
		return
	}

	now := time.Now().UTC()
	reservationID, err := s.reserveVoiceTranscription(session.AccountID, estimatedVoiceDuration(len(audio)), now)
	var overQuota voiceQuotaExceededError
	if errors.As(err, &overQuota) {
		w.Header().Set("Retry-After", strconv.Itoa(max(1, int(overQuota.retryAfter.Seconds()))))
		// A visitor cannot act on somebody else's quota, so they are told to type
		// rather than told about a budget that is not theirs.
		s.writeError(w, r, http.StatusTooManyRequests, "voice_quota_exceeded", "Voice messages are busy right now; please type your message instead", nil)
		return
	}
	if err != nil {
		s.storageFailure(w, r, err)
		return
	}

	transcript, err := transcriber.Transcribe(r.Context(), audio, mediaType)
	if err != nil {
		// The reservation deliberately stands. A rejected call may still have been
		// billed, and refunding it would open a free unmetered channel: send audio
		// the provider dislikes, get the budget back, repeat. The error is logged;
		// the recording and any words in it are not.
		s.logger.Warn("widget voice transcription failed", "request_id", requestID(r.Context()), "error", err)
		s.writeError(w, r, http.StatusServiceUnavailable, "transcription_unavailable", "That message could not be understood just now; please try again or type it", nil)
		return
	}
	text := truncateCharacters(transcript.Text, maxWidgetVoiceCharacters)

	// Settle against the length the provider measured, so the meter and what was
	// actually spent can never disagree.
	if _, _, err := s.settleVoiceTranscription(session.AccountID, reservationID, transcript.AudioDuration, "", transcript.Language, now); err != nil {
		// The transcription happened and was paid for. Failing the request now
		// would lose the visitor's words to protect a counter, so the failure is
		// logged and the words are returned.
		s.logger.Error("voice usage not recorded", "request_id", requestID(r.Context()), "error", err)
	}

	if text == "" {
		s.writeError(w, r, http.StatusUnprocessableEntity, "no_speech_detected", "Nothing could be heard; try again somewhere quieter, or type your message", nil)
		return
	}

	// The transcript only. The audio is not stored: it is a recording of somebody
	// speaking on a stranger's website, it is not needed once it is words, and
	// keeping it would mean holding a voice sample nobody agreed to give us.
	s.writeData(w, http.StatusOK, map[string]any{
		"text":     text,
		"language": transcript.Language,
	})
}

const (
	// A minute of speech is a long chat message. The portal's onboarding notes
	// allow three, because describing a business takes longer than asking a
	// question, and this is a chat.
	maxWidgetVoiceBytes = 1 << 20
	// Matches the typed message limit, counted in characters.
	maxWidgetVoiceCharacters = 4_000
)
