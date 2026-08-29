package alerts

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// WhatsApp delivery through Meta's Cloud API.
//
// THE CONSTRAINT THAT SHAPES THIS. WhatsApp does not let a business send free
// text to a number whenever it likes. A plain text message is only accepted
// inside a 24-hour window that opens when that person last messaged the
// business; outside it, only a pre-approved template goes through. An alerting
// channel is business-initiated by definition and will usually be outside the
// window, so the template path is the one that actually works at 3am, and the
// text path is the convenience for when the owner has just replied.
//
// So: set ALERT_WHATSAPP_TEMPLATE to an approved template whose body is a single
// {{1}} placeholder, and alerts arrive whatever the hour. Leave it unset and
// alerts arrive only while the window is open, which is a real behaviour worth
// knowing about rather than a silent failure to debug at the worst moment.

// WhatsAppConfig is the credential set, read from the environment by config.
type WhatsAppConfig struct {
	// AccessToken is the Cloud API token for the sending number.
	AccessToken string
	// PhoneNumberID is the sending number's id, not the number itself.
	PhoneNumberID string
	// Recipient is who gets paged, in E.164 digits with no plus.
	Recipient string
	// BaseURL defaults to the Graph API origin and version.
	BaseURL string
	// Template, when set, is the name of an approved template with one body
	// parameter. Strongly recommended -- see the note above.
	Template string
	// TemplateLanguage is the template's language code, defaulting to en.
	TemplateLanguage string
}

type whatsAppTransport struct {
	config WhatsAppConfig
	client *http.Client
}

// NewWhatsApp builds a transport. It never returns an error: a partly
// configured channel reports Enabled() false and the service runs without
// alerting, exactly like every other adapter in this codebase.
func NewWhatsApp(config WhatsAppConfig) Transport {
	config.AccessToken = strings.TrimSpace(config.AccessToken)
	config.PhoneNumberID = strings.TrimSpace(config.PhoneNumberID)
	config.Recipient = keepDigits(config.Recipient)
	config.BaseURL = strings.TrimRight(strings.TrimSpace(config.BaseURL), "/")
	config.Template = strings.TrimSpace(config.Template)
	config.TemplateLanguage = strings.TrimSpace(config.TemplateLanguage)
	if config.BaseURL == "" {
		config.BaseURL = "https://graph.facebook.com/v21.0"
	}
	if config.TemplateLanguage == "" {
		config.TemplateLanguage = "en"
	}
	return &whatsAppTransport{
		config: config,
		client: &http.Client{Timeout: 10 * time.Second},
	}
}

func (t *whatsAppTransport) Name() string { return "whatsapp" }

func (t *whatsAppTransport) Enabled() bool {
	return t != nil &&
		t.config.AccessToken != "" &&
		t.config.PhoneNumberID != "" &&
		len(t.config.Recipient) >= 8
}

func (t *whatsAppTransport) Send(ctx context.Context, text string) error {
	if !t.Enabled() {
		return errors.New("whatsapp alerting is not configured")
	}
	payload := t.body(text)
	encoded, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	endpoint := t.config.BaseURL + "/" + t.config.PhoneNumberID + "/messages"
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(encoded))
	if err != nil {
		return err
	}
	request.Header.Set("Authorization", "Bearer "+t.config.AccessToken)
	request.Header.Set("Content-Type", "application/json")

	response, err := t.client.Do(request)
	if err != nil {
		return err
	}
	defer func() { _ = response.Body.Close() }()
	// The body is read and bounded even on success so the connection can be
	// reused, and so a failure carries the provider's own reason.
	body, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
	if response.StatusCode >= 200 && response.StatusCode < 300 {
		return nil
	}
	return fmt.Errorf("whatsapp alert rejected with %d: %s", response.StatusCode, strings.TrimSpace(string(body)))
}

func (t *whatsAppTransport) body(text string) map[string]any {
	if t.config.Template == "" {
		return map[string]any{
			"messaging_product": "whatsapp",
			"to":                t.config.Recipient,
			"type":              "text",
			"text":              map[string]any{"body": text, "preview_url": false},
		}
	}
	return map[string]any{
		"messaging_product": "whatsapp",
		"to":                t.config.Recipient,
		"type":              "template",
		"template": map[string]any{
			"name":     t.config.Template,
			"language": map[string]any{"code": t.config.TemplateLanguage},
			"components": []any{
				map[string]any{
					"type": "body",
					// A template body parameter rejects newlines, so the alert is
					// flattened for this path only. The text path keeps its layout.
					"parameters": []any{map[string]any{"type": "text", "text": flatten(text)}},
				},
			},
		},
	}
}

// WebhookConfig is the escape hatch: any endpoint that accepts a JSON POST.
// Slack and Discord incoming webhooks, Zapier, Make, n8n and most alerting
// vendors all take {"text": "..."}, so one shape reaches nearly all of them
// without this package growing a provider per vendor.
type WebhookConfig struct {
	URL string
	// AuthHeader is sent verbatim as Authorization when set, for endpoints that
	// want a bearer token rather than a secret in the URL.
	AuthHeader string
}

type webhookTransport struct {
	config WebhookConfig
	client *http.Client
}

func NewWebhook(config WebhookConfig) Transport {
	config.URL = strings.TrimSpace(config.URL)
	config.AuthHeader = strings.TrimSpace(config.AuthHeader)
	return &webhookTransport{config: config, client: &http.Client{Timeout: 10 * time.Second}}
}

func (t *webhookTransport) Name() string { return "webhook" }

func (t *webhookTransport) Enabled() bool {
	return t != nil && strings.HasPrefix(t.config.URL, "https://")
}

func (t *webhookTransport) Send(ctx context.Context, text string) error {
	if !t.Enabled() {
		return errors.New("webhook alerting is not configured")
	}
	encoded, err := json.Marshal(map[string]any{"text": text, "content": text})
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, t.config.URL, bytes.NewReader(encoded))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")
	if t.config.AuthHeader != "" {
		request.Header.Set("Authorization", t.config.AuthHeader)
	}
	response, err := t.client.Do(request)
	if err != nil {
		return err
	}
	defer func() { _ = response.Body.Close() }()
	body, _ := io.ReadAll(io.LimitReader(response.Body, 2048))
	if response.StatusCode >= 200 && response.StatusCode < 300 {
		return nil
	}
	return fmt.Errorf("alert webhook rejected with %d: %s", response.StatusCode, strings.TrimSpace(string(body)))
}

// First tries each transport in order and uses the first that is configured.
// WhatsApp is the owner's stated channel; the webhook is what keeps alerting
// working on a deployment where WhatsApp credentials have not arrived yet.
func First(transports ...Transport) Transport {
	for _, transport := range transports {
		if transport != nil && transport.Enabled() {
			return transport
		}
	}
	return nil
}

func keepDigits(value string) string {
	var digits strings.Builder
	for _, character := range value {
		if character >= '0' && character <= '9' {
			digits.WriteRune(character)
		}
	}
	return digits.String()
}

func flatten(value string) string {
	return strings.Join(strings.Fields(strings.ReplaceAll(value, "\n", " · ")), " ")
}
