// Package deepgram turns a recorded voice note into text.
//
// The business owner presses record, talks about their business in their own
// language, and this adapter hands the recording to Deepgram's pre-recorded
// transcription endpoint. Pre-recorded rather than the streaming socket: a voice
// note is already a finished file by the time it reaches the API, so uploading it
// once is both simpler and far more robust than holding a WebSocket open per
// signed-in owner.
//
// The model is nova-3 with language=multi, because the owner may not describe
// their business in English and an English-only model would return confident
// nonsense rather than an obvious failure.
//
// Hand-rolled against the plain HTTPS API for the same reason as every other
// adapter here: the backend carries no third-party dependencies.
//
// Nothing in this package logs. A transcript is the owner's own words about their
// business and the audio is their voice; neither is ever written to a log line, an
// error message, or a URL. The API key travels in a header and appears in no
// message this package produces.
package deepgram

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const (
	defaultBaseURL = "https://api.deepgram.com/v1"
	defaultModel   = "nova-3"
)

type Client struct {
	baseURL    string
	apiKey     string
	model      string
	httpClient *http.Client
}

// Transcript is one recording turned into text.
//
// AudioDuration is what Deepgram itself measured, not what the caller guessed from
// the file size. Transcription is billed per minute of audio, so the metering that
// protects the account has to settle against this number rather than an estimate.
type Transcript struct {
	Text          string
	Confidence    float64
	Language      string
	AudioDuration time.Duration
}

func New(baseURL, apiKey, model string) *Client {
	trimmedBaseURL := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if trimmedBaseURL == "" {
		trimmedBaseURL = defaultBaseURL
	}
	trimmedModel := strings.TrimSpace(model)
	if trimmedModel == "" {
		trimmedModel = defaultModel
	}
	return &Client{
		baseURL: trimmedBaseURL,
		apiKey:  strings.TrimSpace(apiKey),
		model:   trimmedModel,
		// Generous relative to the few seconds a short voice note takes, because a
		// timeout here costs the owner their recording, but bounded so a stalled
		// provider cannot pin a request goroutine open indefinitely.
		httpClient: &http.Client{Timeout: 60 * time.Second},
	}
}

// Enabled reports whether transcription is configured. Every caller must handle
// false: Garuda runs with no Deepgram credential at all, and voice onboarding then
// has to degrade to the typed onboarding rather than fail.
func (c *Client) Enabled() bool { return c != nil && c.apiKey != "" && c.baseURL != "" }

// Model is the transcription model this client will ask for. It is safe to show:
// it is a published model name, not a credential.
func (c *Client) Model() string {
	if c == nil {
		return ""
	}
	return c.model
}

// Transcribe sends the recording exactly as the browser produced it. contentType is
// the browser's own media type -- MediaRecorder emits audio/webm;codecs=opus on
// Chrome and Firefox and audio/mp4 on Safari -- and Deepgram detects the container
// itself, so no re-encoding happens anywhere in Garuda.
func (c *Client) Transcribe(ctx context.Context, audio []byte, contentType string) (Transcript, error) {
	if !c.Enabled() {
		return Transcript{}, errors.New("transcription is not configured")
	}
	if len(audio) == 0 {
		return Transcript{}, errors.New("an audio recording is required")
	}
	contentType = strings.TrimSpace(contentType)
	if contentType == "" {
		return Transcript{}, errors.New("an audio content type is required")
	}
	query := url.Values{}
	query.Set("model", c.model)
	// multi, not a fixed language: the owner describes their business in whatever
	// language they think in, and nova-3 detects and transcribes it.
	query.Set("language", "multi")
	query.Set("smart_format", "true")
	query.Set("punctuate", "true")

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/listen?"+query.Encode(), bytes.NewReader(audio))
	if err != nil {
		return Transcript{}, err
	}
	request.Header.Set("Authorization", "Token "+c.apiKey)
	request.Header.Set("Content-Type", contentType)
	request.Header.Set("Accept", "application/json")
	request.ContentLength = int64(len(audio))

	response, err := c.httpClient.Do(request)
	if err != nil {
		// The wrapped transport error carries the request URL, which holds only the
		// model name and formatting flags. The key is a header and stays out of it.
		return Transcript{}, fmt.Errorf("transcription provider request: %w", err)
	}
	defer response.Body.Close()
	// A transcript of a few minutes of speech is kilobytes; the limit is only here so
	// a misbehaving provider cannot stream unbounded data into memory.
	responseBody, err := io.ReadAll(io.LimitReader(response.Body, 2<<20))
	if err != nil {
		return Transcript{}, fmt.Errorf("read transcription provider response: %w", err)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return Transcript{}, providerFailure(response.StatusCode, responseBody)
	}
	var payload struct {
		Metadata struct {
			Duration float64 `json:"duration"`
		} `json:"metadata"`
		Results struct {
			Channels []struct {
				DetectedLanguage string `json:"detected_language"`
				Alternatives     []struct {
					Transcript string   `json:"transcript"`
					Confidence float64  `json:"confidence"`
					Languages  []string `json:"languages"`
				} `json:"alternatives"`
			} `json:"channels"`
		} `json:"results"`
	}
	if err := json.Unmarshal(responseBody, &payload); err != nil {
		return Transcript{}, errors.New("transcription provider returned an unreadable response")
	}
	if len(payload.Results.Channels) == 0 || len(payload.Results.Channels[0].Alternatives) == 0 {
		return Transcript{}, errors.New("transcription provider returned no transcript")
	}
	channel := payload.Results.Channels[0]
	best := channel.Alternatives[0]
	language := strings.TrimSpace(channel.DetectedLanguage)
	if language == "" && len(best.Languages) > 0 {
		language = strings.TrimSpace(best.Languages[0])
	}
	duration := time.Duration(0)
	if payload.Metadata.Duration > 0 {
		duration = time.Duration(payload.Metadata.Duration * float64(time.Second))
	}
	return Transcript{
		Text:          strings.TrimSpace(best.Transcript),
		Confidence:    best.Confidence,
		Language:      language,
		AudioDuration: duration,
	}, nil
}

// providerFailure turns a rejection into an error that names the reason without
// ever repeating the request: the body we sent was the owner's voice.
func providerFailure(statusCode int, responseBody []byte) error {
	var failure struct {
		ErrorMessage string `json:"err_msg"`
		Message      string `json:"message"`
		Reason       string `json:"reason"`
		Error        string `json:"error"`
	}
	_ = json.Unmarshal(responseBody, &failure)
	for _, candidate := range []string{failure.ErrorMessage, failure.Message, failure.Reason, failure.Error} {
		if candidate = strings.TrimSpace(candidate); candidate != "" {
			if len(candidate) > 200 {
				candidate = candidate[:200]
			}
			return fmt.Errorf("transcription provider: %s", candidate)
		}
	}
	return fmt.Errorf("transcription provider returned status %d", statusCode)
}
