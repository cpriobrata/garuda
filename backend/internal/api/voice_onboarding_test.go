package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"garuda/backend/internal/config"
	"garuda/backend/internal/deepgram"
	"garuda/backend/internal/model"
	"garuda/backend/internal/store"
)

// stubTranscriber stands in for Deepgram so a test can assert what reached the
// provider -- and, more often, that nothing did, because every guard in this file
// exists to stop a request before it costs money.
type stubTranscriber struct {
	mutex        sync.Mutex
	enabled      bool
	calls        int
	bytesSeen    int
	contentTypes []string
	result       deepgram.Transcript
	failure      error
	delay        time.Duration
}

func (t *stubTranscriber) Enabled() bool { return t.enabled }

func (t *stubTranscriber) Transcribe(_ context.Context, audio []byte, contentType string) (deepgram.Transcript, error) {
	if t.delay > 0 {
		time.Sleep(t.delay)
	}
	t.mutex.Lock()
	t.calls++
	t.bytesSeen += len(audio)
	t.contentTypes = append(t.contentTypes, contentType)
	t.mutex.Unlock()
	if t.failure != nil {
		return deepgram.Transcript{}, t.failure
	}
	return t.result, nil
}

func (t *stubTranscriber) callCount() int {
	t.mutex.Lock()
	defer t.mutex.Unlock()
	return t.calls
}

func useTranscriber(t *testing.T, transcriber voiceTranscriber) {
	t.Helper()
	previous := newVoiceTranscriber
	newVoiceTranscriber = func(config.Config) voiceTranscriber { return transcriber }
	t.Cleanup(func() { newVoiceTranscriber = previous })
}

// newVoiceServer builds a server whose configuration a test can bend, which
// newTestServer deliberately does not allow.
func newVoiceServer(t *testing.T, logWriter io.Writer, adjust func(*config.Config)) (*Server, *store.FileStore) {
	t.Helper()
	dataStore, err := store.OpenFile(filepath.Join(t.TempDir(), "garuda.json"))
	if err != nil {
		t.Fatalf("OpenFile: %v", err)
	}
	cfg := config.Config{
		PublicURL: "http://localhost:8080", JWTSecret: "test-secret-at-least-thirty-two-bytes-long",
		AccessTokenTTL: time.Hour, RefreshTokenTTL: time.Hour, DemoMode: true,
		DeepgramModel: "nova-3",
	}
	if adjust != nil {
		adjust(&cfg)
	}
	if logWriter == nil {
		logWriter = io.Discard
	}
	return New(cfg, dataStore, slog.New(slog.NewTextHandler(logWriter, nil))), dataStore
}

func voiceIdentity(accountID string) Identity {
	return Identity{UserID: "usr_" + accountID, AccountID: accountID, Email: "owner@example.com", Role: "owner"}
}

func voiceRequest(method, path string, body io.Reader, contentType string, identity Identity) *http.Request {
	request := httptest.NewRequest(method, path, body)
	if contentType != "" {
		request.Header.Set("Content-Type", contentType)
	}
	return request.WithContext(context.WithValue(request.Context(), identityKey, identity))
}

// countingReader reports how much of an endless body the handler actually pulled
// into memory, which is the only way to tell a limit applied before the read from
// one applied after it.
type countingReader struct {
	remaining int
	read      int
}

func (c *countingReader) Read(destination []byte) (int, error) {
	if c.remaining <= 0 {
		return 0, io.EOF
	}
	count := len(destination)
	if count > c.remaining {
		count = c.remaining
	}
	for index := 0; index < count; index++ {
		destination[index] = 'a'
	}
	c.remaining -= count
	c.read += count
	return count, nil
}

func errorCode(t *testing.T, response *httptest.ResponseRecorder) string {
	t.Helper()
	var envelope errorEnvelope
	if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode error envelope: %v (%s)", err, response.Body.String())
	}
	return envelope.Error.Code
}

func speech(byteCount int) *bytes.Reader {
	return bytes.NewReader(bytes.Repeat([]byte("a"), byteCount))
}

// The body limit has to be attached to the body before the first read. A limit
// applied after io.ReadAll would still answer 413, but the process would already
// have buffered whatever the attacker sent -- which is the actual attack.
func TestVoiceNoteIsCutOffBeforeItIsBuffered(t *testing.T) {
	server, _ := newTestServer(t)
	transcriber := &stubTranscriber{enabled: true}
	useTranscriber(t, transcriber)

	body := &countingReader{remaining: 64 << 20}
	response := httptest.NewRecorder()
	server.transcribeVoiceOnboarding(response, voiceRequest(http.MethodPost, "/v1/onboarding/voice", body, "audio/webm", voiceIdentity("org_big")))

	if response.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("expected 413 for an oversized recording, got %d: %s", response.Code, response.Body.String())
	}
	if code := errorCode(t, response); code != "audio_too_large" {
		t.Fatalf("expected audio_too_large, got %q", code)
	}
	if body.read > maxVoiceNoteBytes+(64<<10) {
		t.Fatalf("read %d bytes of an endless body; the cap must be applied before reading, not after", body.read)
	}
	if transcriber.callCount() != 0 {
		t.Fatalf("expected no provider call for an oversized recording, made %d", transcriber.callCount())
	}
}

// A content type we cannot transcribe is refused before the body is read and before
// the provider is called: having the provider reject it costs the same as a
// successful call.
func TestVoiceNoteContentTypeIsCheckedBeforeAnythingIsSpent(t *testing.T) {
	server, _ := newTestServer(t)
	transcriber := &stubTranscriber{enabled: true}
	useTranscriber(t, transcriber)

	for _, contentType := range []string{"application/json", "text/plain", "image/png", ""} {
		body := &countingReader{remaining: 8 << 20}
		response := httptest.NewRecorder()
		server.transcribeVoiceOnboarding(response, voiceRequest(http.MethodPost, "/v1/onboarding/voice", body, contentType, voiceIdentity("org_type")))
		if response.Code != http.StatusUnsupportedMediaType {
			t.Fatalf("expected 415 for content type %q, got %d", contentType, response.Code)
		}
		if body.read != 0 {
			t.Fatalf("content type %q: read %d bytes before rejecting an unsupported type", contentType, body.read)
		}
	}
	if transcriber.callCount() != 0 {
		t.Fatalf("expected no provider call for unsupported types, made %d", transcriber.callCount())
	}

	// The types a browser recorder actually emits stay accepted, parameters and all.
	transcriber.result = deepgram.Transcript{Text: "we sell homes", Confidence: 0.99, Language: "en", AudioDuration: 20 * time.Second}
	for _, contentType := range []string{"audio/webm;codecs=opus", "AUDIO/WEBM", "audio/mp4", "video/webm"} {
		response := httptest.NewRecorder()
		server.transcribeVoiceOnboarding(response, voiceRequest(http.MethodPost, "/v1/onboarding/voice", speech(8<<10), contentType, voiceIdentity("org_type")))
		if response.Code != http.StatusCreated {
			t.Fatalf("expected content type %q to be accepted, got %d: %s", contentType, response.Code, response.Body.String())
		}
	}
	if got := transcriber.contentTypes[0]; got != "audio/webm;codecs=opus" {
		t.Fatalf("expected the browser's own content type to reach the provider, got %q", got)
	}
}

// A tap that recorded nothing must not become a paid request.
func TestShortVoiceNoteNeverReachesTheProvider(t *testing.T) {
	server, _ := newTestServer(t)
	transcriber := &stubTranscriber{enabled: true}
	useTranscriber(t, transcriber)

	response := httptest.NewRecorder()
	server.transcribeVoiceOnboarding(response, voiceRequest(http.MethodPost, "/v1/onboarding/voice", speech(64), "audio/webm", voiceIdentity("org_short")))

	if response.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422 for a recording with nothing in it, got %d", response.Code)
	}
	if code := errorCode(t, response); code != "audio_too_short" {
		t.Fatalf("expected audio_too_short, got %q", code)
	}
	if transcriber.callCount() != 0 {
		t.Fatalf("expected no provider call for a tiny body, made %d", transcriber.callCount())
	}
}

// With no Deepgram credential the product still works: voice reports itself
// unavailable and the portal falls back to the typed onboarding.
func TestVoiceOnboardingDegradesWithoutACredential(t *testing.T) {
	server, _ := newVoiceServer(t, nil, func(cfg *config.Config) { cfg.DeepgramAPIKey = "" })

	response := httptest.NewRecorder()
	server.transcribeVoiceOnboarding(response, voiceRequest(http.MethodPost, "/v1/onboarding/voice", speech(8<<10), "audio/webm", voiceIdentity("org_nokey")))
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503 without a credential, got %d: %s", response.Code, response.Body.String())
	}
	if code := errorCode(t, response); code != "voice_unavailable" {
		t.Fatalf("expected voice_unavailable, got %q", code)
	}

	status := httptest.NewRecorder()
	server.getVoiceOnboarding(status, voiceRequest(http.MethodGet, "/v1/onboarding/voice", nil, "", voiceIdentity("org_nokey")))
	data := dataFrom(t, status, http.StatusOK)
	if enabled, _ := data["enabled"].(bool); enabled {
		t.Fatal("expected the status endpoint to report voice unavailable so the portal can offer typing instead")
	}
	if questions, _ := data["follow_up_questions"].([]any); len(questions) != 2 {
		t.Fatalf("expected the two follow-up questions even without voice, got %d", len(questions))
	}
	// The recorder stops itself at the length and size the server accepts, so both
	// have to be published rather than guessed.
	if seconds, _ := data["max_duration_seconds"].(float64); seconds != float64(maxVoiceNoteSeconds) {
		t.Fatalf("expected the recording length limit to be published, got %v", data["max_duration_seconds"])
	}
	if bytesAllowed, _ := data["max_bytes"].(float64); bytesAllowed != float64(maxVoiceNoteBytes) {
		t.Fatalf("expected the body limit to be published, got %v", data["max_bytes"])
	}
}

// Transcription spends real money on a shared key, so an account with no
// subscription must not reach the provider at all.
func TestVoiceOnboardingRequiresAnEntitlement(t *testing.T) {
	server, dataStore := newVoiceServer(t, nil, func(cfg *config.Config) {
		cfg.DemoMode = false
		cfg.DeepgramAPIKey = "configured"
	})
	transcriber := &stubTranscriber{enabled: true}
	useTranscriber(t, transcriber)
	if err := dataStore.Update(func(state *model.State) error {
		state.Accounts = append(state.Accounts, model.Account{ID: "org_free", BillingStatus: "incomplete"})
		return nil
	}); err != nil {
		t.Fatalf("seed account: %v", err)
	}

	response := httptest.NewRecorder()
	server.transcribeVoiceOnboarding(response, voiceRequest(http.MethodPost, "/v1/onboarding/voice", speech(16<<10), "audio/webm", voiceIdentity("org_free")))
	if response.Code != http.StatusPaymentRequired {
		t.Fatalf("expected 402 without a subscription, got %d: %s", response.Code, response.Body.String())
	}
	if transcriber.callCount() != 0 {
		t.Fatalf("expected no provider call for an unentitled account, made %d", transcriber.callCount())
	}

	if err := dataStore.Update(func(state *model.State) error {
		state.Accounts[0].BillingStatus = "active"
		return nil
	}); err != nil {
		t.Fatalf("activate account: %v", err)
	}
	transcriber.result = deepgram.Transcript{Text: "we run a bakery", Confidence: 0.98, Language: "en", AudioDuration: 30 * time.Second}
	allowed := httptest.NewRecorder()
	server.transcribeVoiceOnboarding(allowed, voiceRequest(http.MethodPost, "/v1/onboarding/voice", speech(16<<10), "audio/webm", voiceIdentity("org_free")))
	if allowed.Code != http.StatusCreated {
		t.Fatalf("expected an active subscription to be allowed, got %d: %s", allowed.Code, allowed.Body.String())
	}
}

// The transcript is returned for the owner to read and stored so a refresh does not
// lose it -- and it belongs to one account only.
func TestTranscriptIsReturnedStoredAndScopedToOneAccount(t *testing.T) {
	server, dataStore := newTestServer(t)
	transcriber := &stubTranscriber{enabled: true, result: deepgram.Transcript{
		Text: "Hum Noida mein naye ghar bechte hain.", Confidence: 0.999, Language: "hi", AudioDuration: 42 * time.Second,
	}}
	useTranscriber(t, transcriber)

	response := httptest.NewRecorder()
	server.transcribeVoiceOnboarding(response, voiceRequest(http.MethodPost, "/v1/onboarding/voice", speech(32<<10), "audio/webm;codecs=opus", voiceIdentity("org_owner")))
	created := dataFrom(t, response, http.StatusCreated)
	if created["transcript"] != "Hum Noida mein naye ghar bechte hain." {
		t.Fatalf("expected the transcript to come back for review, got %v", created["transcript"])
	}
	if created["language"] != "hi" {
		t.Fatalf("expected the detected language to come back, got %v", created["language"])
	}
	if confidence, _ := created["confidence"].(float64); confidence < 0.99 {
		t.Fatalf("expected the provider confidence to come back, got %v", created["confidence"])
	}

	stored := ""
	_ = dataStore.View(func(state *model.State) error {
		for _, onboarding := range state.Onboarding {
			if onboarding.AccountID == "org_owner" {
				stored = onboarding.Answers[voiceTranscriptAnswerKey]
			}
		}
		return nil
	})
	if stored != "Hum Noida mein naye ghar bechte hain." {
		t.Fatalf("expected the transcript on the onboarding record so a refresh keeps it, got %q", stored)
	}

	refreshed := httptest.NewRecorder()
	server.getVoiceOnboarding(refreshed, voiceRequest(http.MethodGet, "/v1/onboarding/voice", nil, "", voiceIdentity("org_owner")))
	reloaded := dataFrom(t, refreshed, http.StatusOK)
	if reloaded["transcript"] != "Hum Noida mein naye ghar bechte hain." || reloaded["language"] != "hi" {
		t.Fatalf("expected a refresh to return the stored transcript, got %v", reloaded["transcript"])
	}

	other := httptest.NewRecorder()
	server.getVoiceOnboarding(other, voiceRequest(http.MethodGet, "/v1/onboarding/voice", nil, "", voiceIdentity("org_stranger")))
	if leaked := dataFrom(t, other, http.StatusOK)["transcript"]; leaked != "" {
		t.Fatalf("another account read this owner's transcript: %v", leaked)
	}
}

// The owner must never have an agent built from words they have not seen, so a
// recording with no speech in it says so rather than storing an empty answer.
func TestSilentRecordingIsReportedRatherThanStored(t *testing.T) {
	server, dataStore := newTestServer(t)
	useTranscriber(t, &stubTranscriber{enabled: true, result: deepgram.Transcript{Text: "   ", AudioDuration: 8 * time.Second}})

	response := httptest.NewRecorder()
	server.transcribeVoiceOnboarding(response, voiceRequest(http.MethodPost, "/v1/onboarding/voice", speech(16<<10), "audio/webm", voiceIdentity("org_silent")))
	if response.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422 for a recording with no speech, got %d: %s", response.Code, response.Body.String())
	}
	if code := errorCode(t, response); code != "no_speech_detected" {
		t.Fatalf("expected no_speech_detected, got %q", code)
	}
	_ = dataStore.View(func(state *model.State) error {
		for _, onboarding := range state.Onboarding {
			if onboarding.AccountID == "org_silent" && onboarding.Answers[voiceTranscriptAnswerKey] != "" {
				t.Fatalf("stored an empty transcript: %q", onboarding.Answers[voiceTranscriptAnswerKey])
			}
		}
		return nil
	})
}

// The hourly budget is checked and written in one store.Update. Splitting the check
// from the write lets requests that all read "under budget" all proceed, which is
// exactly how a single session runs up an unbounded provider bill.
func TestHourlyAudioQuotaIsCheckedAndRecordedInOneWrite(t *testing.T) {
	server, _ := newTestServer(t)
	const noteBytes = 1 << 20
	measured := estimatedVoiceDuration(noteBytes)
	transcriber := &stubTranscriber{enabled: true, delay: 2 * time.Millisecond, result: deepgram.Transcript{
		Text: "we sell homes in Noida", Confidence: 0.97, Language: "en", AudioDuration: measured,
	}}
	useTranscriber(t, transcriber)

	allowedByBudget := int(voiceQuotaPerWindow.Milliseconds() / measured.Milliseconds())
	var group sync.WaitGroup
	results := make([]int, 10)
	for index := range results {
		group.Add(1)
		go func(position int) {
			defer group.Done()
			response := httptest.NewRecorder()
			server.transcribeVoiceOnboarding(response, voiceRequest(http.MethodPost, "/v1/onboarding/voice", speech(noteBytes), "audio/webm", voiceIdentity("org_burst")))
			results[position] = response.Code
		}(index)
	}
	group.Wait()

	accepted, refused := 0, 0
	for _, code := range results {
		switch code {
		case http.StatusCreated:
			accepted++
		case http.StatusTooManyRequests:
			refused++
		default:
			t.Fatalf("unexpected status %d from a concurrent voice note", code)
		}
	}
	if accepted != allowedByBudget {
		t.Fatalf("expected exactly %d of 10 concurrent recordings to fit the hourly budget, %d were accepted", allowedByBudget, accepted)
	}
	if refused != 10-allowedByBudget {
		t.Fatalf("expected %d refusals, got %d", 10-allowedByBudget, refused)
	}
	if transcriber.callCount() != accepted {
		t.Fatalf("expected the provider to be called once per accepted recording, %d calls for %d accepted", transcriber.callCount(), accepted)
	}
}

// Once the budget is gone the request is refused without the provider being called,
// and the caller is told when room frees up.
func TestSpentQuotaRefusesFurtherRecordingsWithoutSpending(t *testing.T) {
	server, dataStore := newTestServer(t)
	transcriber := &stubTranscriber{enabled: true, result: deepgram.Transcript{Text: "hello", AudioDuration: time.Minute}}
	useTranscriber(t, transcriber)

	spent := time.Now().UTC().Add(-10 * time.Minute)
	if err := dataStore.Update(func(state *model.State) error {
		state.Jobs = append(state.Jobs, model.Job{
			ID: "job_spent", AccountID: "org_spent", Type: voiceTranscriptionJobType, Status: "succeeded",
			Result: map[string]any{voiceUsageResultKey: float64(voiceQuotaPerWindow.Milliseconds())}, CreatedAt: spent, UpdatedAt: spent,
		})
		return nil
	}); err != nil {
		t.Fatalf("seed usage: %v", err)
	}

	response := httptest.NewRecorder()
	server.transcribeVoiceOnboarding(response, voiceRequest(http.MethodPost, "/v1/onboarding/voice", speech(16<<10), "audio/webm", voiceIdentity("org_spent")))
	if response.Code != http.StatusTooManyRequests {
		t.Fatalf("expected 429 once the hourly budget is spent, got %d: %s", response.Code, response.Body.String())
	}
	if code := errorCode(t, response); code != "voice_quota_exceeded" {
		t.Fatalf("expected voice_quota_exceeded, got %q", code)
	}
	if response.Header().Get("Retry-After") == "" {
		t.Fatal("expected a Retry-After header so the portal can say when recording works again")
	}
	if transcriber.callCount() != 0 {
		t.Fatalf("expected no provider call once the budget is spent, made %d", transcriber.callCount())
	}

	// Another account's budget is its own.
	fresh := httptest.NewRecorder()
	server.transcribeVoiceOnboarding(fresh, voiceRequest(http.MethodPost, "/v1/onboarding/voice", speech(16<<10), "audio/webm", voiceIdentity("org_untouched")))
	if fresh.Code != http.StatusCreated {
		t.Fatalf("expected one account's spend to leave another alone, got %d", fresh.Code)
	}
}

// The reservation is an estimate from the body size; the provider's own measurement
// replaces it. Without the settlement an owner whose browser encodes at a high
// bitrate would be charged several times the audio they actually recorded.
func TestUsageSettlesToTheDurationTheProviderMeasured(t *testing.T) {
	server, _ := newTestServer(t)
	const noteBytes = 1 << 20
	useTranscriber(t, &stubTranscriber{enabled: true, result: deepgram.Transcript{
		Text: "a short note recorded at a high bitrate", Confidence: 0.95, Language: "en", AudioDuration: 12 * time.Second,
	}})

	request := voiceRequest(http.MethodPost, "/v1/onboarding/voice", speech(noteBytes), "audio/webm", voiceIdentity("org_settle"))
	// The portal reports how long it recorded. A caller-chosen number can never be
	// what the bill is measured against, so an implausible one must change nothing.
	request.Header.Set("X-Recording-Duration-Seconds", "0")
	response := httptest.NewRecorder()
	server.transcribeVoiceOnboarding(response, request)
	usage, _ := dataFrom(t, response, http.StatusCreated)["usage"].(map[string]any)
	used, _ := usage["used_seconds"].(float64)
	if used > 13 || used < 11 {
		t.Fatalf("expected usage to settle to the 12 seconds the provider measured, got %v (the reservation was %v)", used, estimatedVoiceDuration(noteBytes).Seconds())
	}
	if remaining, _ := usage["remaining_seconds"].(float64); remaining < voiceQuotaPerWindow.Seconds()-13 {
		t.Fatalf("expected the unused reservation to be given back, remaining %v", remaining)
	}
}

// A provider failure keeps its charge. Refunding a failed call would hand an
// attacker a free channel: send audio the provider rejects, get the budget back,
// repeat for as long as the key lasts.
func TestFailedTranscriptionKeepsItsReservation(t *testing.T) {
	server, _ := newTestServer(t)
	useTranscriber(t, &stubTranscriber{enabled: true, failure: fmt.Errorf("transcription provider returned status 500")})

	response := httptest.NewRecorder()
	server.transcribeVoiceOnboarding(response, voiceRequest(http.MethodPost, "/v1/onboarding/voice", speech(512<<10), "audio/webm", voiceIdentity("org_failed")))
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503 when the provider fails, got %d: %s", response.Code, response.Body.String())
	}

	status := httptest.NewRecorder()
	server.getVoiceOnboarding(status, voiceRequest(http.MethodGet, "/v1/onboarding/voice", nil, "", voiceIdentity("org_failed")))
	usage, _ := dataFrom(t, status, http.StatusOK)["usage"].(map[string]any)
	if used, _ := usage["used_seconds"].(float64); used <= 0 {
		t.Fatalf("expected a failed call to keep its reservation, usage reports %v seconds", used)
	}
}

// The follow-ups are typed or tapped, not spoken, and they survive a refresh.
func TestFollowUpDetailsAreValidatedAndStored(t *testing.T) {
	server, _ := newTestServer(t)

	tooShort := httptest.NewRecorder()
	server.saveVoiceOnboardingDetails(tooShort, voiceRequest(http.MethodPut, "/v1/onboarding/voice/details", strings.NewReader(`{"agent_display_name":"A"}`), "application/json", voiceIdentity("org_details")))
	if tooShort.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected a one-character assistant name to be refused, got %d", tooShort.Code)
	}

	unknownField := httptest.NewRecorder()
	server.saveVoiceOnboardingDetails(unknownField, voiceRequest(http.MethodPut, "/v1/onboarding/voice/details", strings.NewReader(`{"account_id":"org_someone_else"}`), "application/json", voiceIdentity("org_details")))
	if unknownField.Code != http.StatusBadRequest {
		t.Fatalf("expected an unknown field to be refused so no account id can be taken from a body, got %d", unknownField.Code)
	}

	saved := httptest.NewRecorder()
	server.saveVoiceOnboardingDetails(saved, voiceRequest(http.MethodPut, "/v1/onboarding/voice/details", strings.NewReader(`{"agent_display_name":"Acme Assistant","offer_booking":true}`), "application/json", voiceIdentity("org_details")))
	details, _ := dataFrom(t, saved, http.StatusOK)["details"].(map[string]any)
	if details["agent_display_name"] != "Acme Assistant" || details["offer_booking"] != true {
		t.Fatalf("expected the follow-up answers to be stored, got %v", details)
	}

	reloaded := httptest.NewRecorder()
	server.getVoiceOnboarding(reloaded, voiceRequest(http.MethodGet, "/v1/onboarding/voice", nil, "", voiceIdentity("org_details")))
	reloadedDetails, _ := dataFrom(t, reloaded, http.StatusOK)["details"].(map[string]any)
	if reloadedDetails["agent_display_name"] != "Acme Assistant" || reloadedDetails["offer_booking"] != true {
		t.Fatalf("expected the follow-up answers to survive a refresh, got %v", reloadedDetails)
	}

	turnedOff := httptest.NewRecorder()
	server.saveVoiceOnboardingDetails(turnedOff, voiceRequest(http.MethodPut, "/v1/onboarding/voice/details", strings.NewReader(`{"offer_booking":false}`), "application/json", voiceIdentity("org_details")))
	offDetails, _ := dataFrom(t, turnedOff, http.StatusOK)["details"].(map[string]any)
	if offDetails["offer_booking"] != false {
		t.Fatalf("expected booking to be turned off, got %v", offDetails)
	}
	if offDetails["agent_display_name"] != "Acme Assistant" {
		t.Fatalf("expected an omitted name to be left alone, got %v", offDetails["agent_display_name"])
	}
}

// The voice answers share the onboarding answers map with the typed questions, so
// the typed path must neither drop them nor let a caller forge them.
func TestVoiceAnswersSurviveTheTypedOnboardingWriteAndCannotBeForged(t *testing.T) {
	server, dataStore := newTestServer(t)
	useTranscriber(t, &stubTranscriber{enabled: true, result: deepgram.Transcript{Text: "the real transcript", Confidence: 0.9, Language: "en", AudioDuration: 10 * time.Second}})

	recorded := httptest.NewRecorder()
	server.transcribeVoiceOnboarding(recorded, voiceRequest(http.MethodPost, "/v1/onboarding/voice", speech(16<<10), "audio/webm", voiceIdentity("org_mixed")))
	if recorded.Code != http.StatusCreated {
		t.Fatalf("record: %d %s", recorded.Code, recorded.Body.String())
	}

	body := `{"business_name":"Acme","industry":"realty","audience":"buyers","goals":["qualify leads"],"tone":"warm","bot_type":"sales","answers":{"business_profile":"typed","voice_transcript":"forged transcript"}}`
	typed := httptest.NewRecorder()
	server.saveOnboarding(typed, voiceRequest(http.MethodPut, "/v1/onboarding", strings.NewReader(body), "application/json", voiceIdentity("org_mixed")))
	if typed.Code != http.StatusOK {
		t.Fatalf("save typed onboarding: %d %s", typed.Code, typed.Body.String())
	}

	stored := ""
	_ = dataStore.View(func(state *model.State) error {
		for _, onboarding := range state.Onboarding {
			if onboarding.AccountID == "org_mixed" {
				stored = onboarding.Answers[voiceTranscriptAnswerKey]
			}
		}
		return nil
	})
	if stored != "the real transcript" {
		t.Fatalf("expected the recorded transcript to survive the typed write unforged, got %q", stored)
	}
}

// A transcript is the owner's own words about their business. It never reaches a log
// line, and neither does the audio.
func TestTranscriptNeverReachesTheLog(t *testing.T) {
	var logs bytes.Buffer
	server, _ := newVoiceServer(t, &logs, func(cfg *config.Config) { cfg.DeepgramAPIKey = "configured" })
	const spoken = "we are a family bakery on Sector 18 and our best seller is the almond croissant"
	useTranscriber(t, &stubTranscriber{enabled: true, result: deepgram.Transcript{Text: spoken, Confidence: 0.99, Language: "en", AudioDuration: 20 * time.Second}})

	response := httptest.NewRecorder()
	server.transcribeVoiceOnboarding(response, voiceRequest(http.MethodPost, "/v1/onboarding/voice", speech(16<<10), "audio/webm", voiceIdentity("org_quiet")))
	if response.Code != http.StatusCreated {
		t.Fatalf("record: %d %s", response.Code, response.Body.String())
	}
	if strings.Contains(logs.String(), "almond croissant") || strings.Contains(logs.String(), spoken) {
		t.Fatalf("the transcript reached the log: %s", logs.String())
	}
}

// End to end through the real adapter: the handler, the HTTPS client, and a stand-in
// for Deepgram that answers in the shape the live API answered in.
func TestVoiceOnboardingThroughTheRealAdapter(t *testing.T) {
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Token live-key" {
			t.Errorf("unexpected authorization header %q", r.Header.Get("Authorization"))
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"metadata":{"duration":31.4},"results":{"channels":[{"detected_language":"en","alternatives":[{"transcript":"We fit solar panels across Jaipur.","confidence":0.994}]}]}}`))
	}))
	defer provider.Close()

	server, _ := newTestServer(t)
	previous := newVoiceTranscriber
	newVoiceTranscriber = func(config.Config) voiceTranscriber { return deepgram.New(provider.URL, "live-key", "nova-3") }
	t.Cleanup(func() { newVoiceTranscriber = previous })

	response := httptest.NewRecorder()
	server.transcribeVoiceOnboarding(response, voiceRequest(http.MethodPost, "/v1/onboarding/voice", speech(24<<10), "audio/webm;codecs=opus", voiceIdentity("org_live")))
	created := dataFrom(t, response, http.StatusCreated)
	if created["transcript"] != "We fit solar panels across Jaipur." {
		t.Fatalf("unexpected transcript: %v", created["transcript"])
	}
	if seconds, _ := created["duration_seconds"].(float64); seconds < 31 || seconds > 32 {
		t.Fatalf("expected the measured length to be reported, got %v", seconds)
	}
	usage, _ := created["usage"].(map[string]any)
	if used, _ := usage["used_seconds"].(float64); used < 31 || used > 32 {
		t.Fatalf("expected usage to settle to the measured length, got %v", used)
	}
}

// The meter cannot be allowed to grow the data file forever, and it must never drop
// a row another surface still needs.
func TestVoiceMeterPrunesOnlyItsOwnExpiredRows(t *testing.T) {
	now := time.Now().UTC()
	jobs := []model.Job{
		{ID: "job_generate", AccountID: "org_a", Type: "generate_agent", CreatedAt: now.Add(-72 * time.Hour)},
		{ID: "job_old_meter", AccountID: "org_a", Type: voiceTranscriptionJobType, CreatedAt: now.Add(-5 * time.Hour)},
		{ID: "job_recent_meter", AccountID: "org_a", Type: voiceTranscriptionJobType, CreatedAt: now.Add(-30 * time.Minute)},
	}
	result := appendVoiceLedgerRow(jobs, model.Job{ID: "job_new", Type: voiceTranscriptionJobType, CreatedAt: now}, now)

	kept := map[string]bool{}
	for _, job := range result {
		kept[job.ID] = true
	}
	if !kept["job_generate"] {
		t.Fatal("the meter dropped a generation job the portal may still be polling")
	}
	if !kept["job_recent_meter"] || !kept["job_new"] {
		t.Fatal("the meter dropped a reading that still counts against the window")
	}
	if kept["job_old_meter"] {
		t.Fatal("expected a reading far outside the window to be pruned")
	}
	if &result[0] == &jobs[0] {
		t.Fatal("expected the survivors to be copied into a fresh slice, not filtered in place")
	}
}
