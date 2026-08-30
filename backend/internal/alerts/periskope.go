package alerts

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// WhatsApp delivery through Periskope.
//
// WHY THIS EXISTS ALONGSIDE THE CLOUD API TRANSPORT. Meta's own Cloud API will
// not let a business send free text outside a 24-hour window that opens when the
// recipient last messaged it, so alerting through it means getting a template
// approved and then living inside its single {{1}} placeholder. Periskope drives
// a real WhatsApp account, so an alert at 3am is an ordinary message: no window,
// no template review, and no approval standing between a fault and the person
// who needs to know about it.
//
// It also sends to a GROUP rather than a number, which matters more than it
// sounds: alerting a person means alerting one phone, and a group is where a
// second pair of eyes can be added without a deployment.
//
// The Cloud API transport stays. Both are registered, both are optional, and
// whichever is configured gets used -- an alerting channel with exactly one way
// through is one outage away from being no alerting channel at all.

// PeriskopeConfig is the credential set, read from the environment by config.
type PeriskopeConfig struct {
	// APIKey is the bearer token.
	APIKey string
	// Phone is the sending WhatsApp account's id, sent as x-phone.
	Phone string
	// ChatID is the destination: a group id ending @g.us, or a direct chat.
	ChatID string
	// BaseURL defaults to the production API origin.
	BaseURL string
}

type periskopeTransport struct {
	config PeriskopeConfig
	client *http.Client
}

// NewPeriskope builds a transport. Like every other adapter here it never
// returns an error: a partly configured channel reports Enabled() false and the
// service runs without it.
func NewPeriskope(config PeriskopeConfig) Transport {
	config.APIKey = strings.TrimSpace(config.APIKey)
	config.Phone = strings.TrimSpace(config.Phone)
	config.ChatID = strings.TrimSpace(config.ChatID)
	config.BaseURL = strings.TrimRight(strings.TrimSpace(config.BaseURL), "/")
	if config.BaseURL == "" {
		config.BaseURL = "https://api.periskope.app/v1"
	}
	return &periskopeTransport{
		config: config,
		// Ten seconds, like the other transports. An alerting channel that
		// blocks is a second fault on top of the one being reported.
		client: &http.Client{Timeout: 10 * time.Second},
	}
}

func (t *periskopeTransport) Name() string { return "periskope" }

func (t *periskopeTransport) Enabled() bool {
	return t != nil && t.config.APIKey != "" && t.config.Phone != "" && t.config.ChatID != ""
}

func (t *periskopeTransport) Send(ctx context.Context, text string) error {
	if !t.Enabled() {
		return fmt.Errorf("periskope is not configured")
	}
	body, err := json.Marshal(map[string]any{
		"chat_id": t.config.ChatID,
		"message": text,
	})
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, t.config.BaseURL+"/message/send", bytes.NewReader(body))
	if err != nil {
		return err
	}
	request.Header.Set("Authorization", "Bearer "+t.config.APIKey)
	request.Header.Set("x-phone", t.config.Phone)
	request.Header.Set("Content-Type", "application/json")

	response, err := t.client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	// Bounded: a gateway answering with an HTML error page must not become a
	// megabyte of it in the log of a service that is already having a bad time.
	payload, _ := io.ReadAll(io.LimitReader(response.Body, 2048))
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("periskope refused the alert: %s %s", response.Status, strings.TrimSpace(string(payload)))
	}
	return nil
}
