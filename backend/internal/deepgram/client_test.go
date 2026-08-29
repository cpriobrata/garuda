package deepgram

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

const transcriptResponse = `{
	"metadata": {"duration": 12.5},
	"results": {"channels": [{
		"detected_language": "hi",
		"alternatives": [{"transcript": "Hum Noida mein ghar bechte hain.", "confidence": 0.999, "languages": ["hi"]}]
	}]}
}`

// The recording is uploaded as the raw request body with the browser's own media
// type, and asked for with nova-3 in multilingual mode. An owner who describes
// their business in Hindi has to get Hindi back, not a confident English guess,
// which is what an English-only model returns for the same audio.
func TestTranscribeUploadsRawAudioAndAsksForMultilingualModel(t *testing.T) {
	audio := []byte("\x1a\x45\xdf\xa3 pretend webm opus bytes")
	var capturedQuery, capturedAuthorization, capturedContentType, capturedPath string
	var capturedBody []byte
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedPath = r.URL.Path
		capturedQuery = r.URL.RawQuery
		capturedAuthorization = r.Header.Get("Authorization")
		capturedContentType = r.Header.Get("Content-Type")
		capturedBody, _ = io.ReadAll(r.Body)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(transcriptResponse))
	}))
	defer provider.Close()

	client := New(provider.URL, "secret-provider-key", "nova-3")
	transcript, err := client.Transcribe(context.Background(), audio, "audio/webm;codecs=opus")
	if err != nil {
		t.Fatalf("Transcribe: %v", err)
	}
	if capturedPath != "/listen" {
		t.Fatalf("expected the pre-recorded endpoint /listen, got %q", capturedPath)
	}
	if capturedAuthorization != "Token secret-provider-key" {
		t.Fatalf("expected a Token authorization header, got %q", capturedAuthorization)
	}
	if capturedContentType != "audio/webm;codecs=opus" {
		t.Fatalf("expected the browser's own content type to be forwarded, got %q", capturedContentType)
	}
	if string(capturedBody) != string(audio) {
		t.Fatalf("expected the audio to be sent as the raw body, got %d of %d bytes", len(capturedBody), len(audio))
	}
	for _, expected := range []string{"model=nova-3", "language=multi", "smart_format=true", "punctuate=true"} {
		if !strings.Contains(capturedQuery, expected) {
			t.Fatalf("expected query to contain %q, got %q", expected, capturedQuery)
		}
	}
	if transcript.Text != "Hum Noida mein ghar bechte hain." {
		t.Fatalf("unexpected transcript text: %q", transcript.Text)
	}
	if transcript.Confidence < 0.99 {
		t.Fatalf("expected the provider confidence to be returned, got %v", transcript.Confidence)
	}
	if transcript.Language != "hi" {
		t.Fatalf("expected the detected language to be returned, got %q", transcript.Language)
	}
	if transcript.AudioDuration != 12500*time.Millisecond {
		t.Fatalf("expected the measured audio length to be returned, got %v", transcript.AudioDuration)
	}
}

// The detected language may arrive on the alternative rather than the channel.
func TestTranscribeFallsBackToAlternativeLanguages(t *testing.T) {
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"results":{"channels":[{"alternatives":[{"transcript":"hola","confidence":0.9,"languages":["es"]}]}]}}`))
	}))
	defer provider.Close()

	transcript, err := New(provider.URL, "key", "").Transcribe(context.Background(), []byte("audio"), "audio/webm")
	if err != nil {
		t.Fatalf("Transcribe: %v", err)
	}
	if transcript.Language != "es" {
		t.Fatalf("expected the alternative's language, got %q", transcript.Language)
	}
}

// With no credential the product still has to work: voice degrades to the typed
// onboarding. A disabled client must fail closed without touching the network.
func TestDisabledClientNeverCallsTheProvider(t *testing.T) {
	calls := 0
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls++
		_, _ = w.Write([]byte(transcriptResponse))
	}))
	defer provider.Close()

	client := New(provider.URL, "   ", "nova-3")
	if client.Enabled() {
		t.Fatal("expected a client with no API key to report itself disabled")
	}
	if _, err := client.Transcribe(context.Background(), []byte("audio"), "audio/webm"); err == nil {
		t.Fatal("expected a disabled client to refuse to transcribe")
	}
	if calls != 0 {
		t.Fatalf("expected no provider call from a disabled client, made %d", calls)
	}
}

// A rejection must explain itself without ever repeating the credential. The key is
// a header, and no error this package builds may carry it.
func TestProviderRejectionNeverCarriesTheAPIKey(t *testing.T) {
	const apiKey = "dg-live-should-never-appear"
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"err_code":"INVALID_AUTH","err_msg":"Invalid credentials."}`))
	}))
	defer provider.Close()

	_, err := New(provider.URL, apiKey, "nova-3").Transcribe(context.Background(), []byte("audio"), "audio/webm")
	if err == nil {
		t.Fatal("expected an error from a 401")
	}
	if !strings.Contains(err.Error(), "Invalid credentials.") {
		t.Fatalf("expected the provider's own message, got %q", err.Error())
	}
	if strings.Contains(err.Error(), apiKey) {
		t.Fatalf("the API key reached an error message: %q", err.Error())
	}
}

// An unreachable provider must also fail without the key, since the transport error
// carries the request URL and the key must never be part of it.
func TestTransportFailureNeverCarriesTheAPIKey(t *testing.T) {
	const apiKey = "dg-live-should-never-appear"
	provider := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	unreachableURL := provider.URL
	provider.Close()

	_, err := New(unreachableURL, apiKey, "nova-3").Transcribe(context.Background(), []byte("audio"), "audio/webm")
	if err == nil {
		t.Fatal("expected an error from an unreachable provider")
	}
	if strings.Contains(err.Error(), apiKey) {
		t.Fatalf("the API key reached an error message: %q", err.Error())
	}
}

// An empty body would be billed as a request and answered with a provider error, so
// it is refused locally.
func TestTranscribeRefusesAnEmptyRecording(t *testing.T) {
	calls := 0
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls++
		_, _ = w.Write([]byte(transcriptResponse))
	}))
	defer provider.Close()

	client := New(provider.URL, "key", "nova-3")
	if _, err := client.Transcribe(context.Background(), nil, "audio/webm"); err == nil {
		t.Fatal("expected an empty recording to be refused")
	}
	if _, err := client.Transcribe(context.Background(), []byte("audio"), ""); err == nil {
		t.Fatal("expected a missing content type to be refused")
	}
	if calls != 0 {
		t.Fatalf("expected no provider call, made %d", calls)
	}
}

// A response with no channels is a provider problem, not a silent empty transcript
// the portal would render as an empty box.
func TestTranscribeRejectsAResponseWithNoAlternatives(t *testing.T) {
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"results":{"channels":[]}}`))
	}))
	defer provider.Close()

	_, err := New(provider.URL, "key", "nova-3").Transcribe(context.Background(), []byte("audio"), "audio/webm")
	if err == nil {
		t.Fatal("expected a response with no alternatives to be an error")
	}
}

// A cancelled request must not leave the caller waiting on the provider.
func TestTranscribeHonoursContextCancellation(t *testing.T) {
	release := make(chan struct{})
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		<-release
		_, _ = w.Write([]byte(transcriptResponse))
	}))
	defer provider.Close()
	defer close(release)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := New(provider.URL, "key", "nova-3").Transcribe(ctx, []byte("audio"), "audio/webm")
	if err == nil || !errors.Is(err, context.Canceled) {
		t.Fatalf("expected a cancelled context to abort the call, got %v", err)
	}
}
