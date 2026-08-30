package alerts

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// The policy in alerts.go decides WHAT is sent; these cover what actually goes
// on the wire. Both transports had no coverage of that at all, which for the
// channel that wakes somebody at 3am is the wrong thing to be guessing about.

func TestTheWebhookSendsTheAlertAndTheAuthorizationItWasGiven(t *testing.T) {
	var received struct {
		body []byte
		auth string
		kind string
	}
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		received.body, _ = io.ReadAll(r.Body)
		received.auth = r.Header.Get("Authorization")
		received.kind = r.Header.Get("Content-Type")
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()

	transport := NewWebhook(WebhookConfig{URL: server.URL, AuthHeader: "Bearer hook-token"}).(*webhookTransport)
	transport.client = server.Client()

	if err := transport.Send(context.Background(), "garuda-api (test): the API returned a server error"); err != nil {
		t.Fatalf("send: %v", err)
	}
	if received.auth != "Bearer hook-token" {
		t.Errorf("authorization = %q", received.auth)
	}
	if received.kind != "application/json" {
		t.Errorf("content type = %q", received.kind)
	}

	var payload map[string]any
	if err := json.Unmarshal(received.body, &payload); err != nil {
		t.Fatalf("the body was not JSON: %v", err)
	}
	// Both keys travel because Slack reads "text" and Discord reads "content",
	// and one shape reaching both is worth two bytes.
	for _, key := range []string{"text", "content"} {
		if value, _ := payload[key].(string); !strings.Contains(value, "server error") {
			t.Errorf("%q did not carry the alert: %v", key, payload[key])
		}
	}
}

// A rejected alert must name the provider's own reason. Without it, a channel
// that has silently stopped working is indistinguishable from one with nothing
// to say.
func TestARejectedWebhookNamesTheProvidersReason(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte(`{"error":"channel_not_found"}`))
	}))
	defer server.Close()

	transport := NewWebhook(WebhookConfig{URL: server.URL}).(*webhookTransport)
	transport.client = server.Client()

	err := transport.Send(context.Background(), "anything")
	if err == nil {
		t.Fatal("a 403 was reported as a successful send")
	}
	if !strings.Contains(err.Error(), "403") || !strings.Contains(err.Error(), "channel_not_found") {
		t.Fatalf("the error hides the provider's reason: %v", err)
	}
}

// WhatsApp will not deliver free text outside its 24-hour service window, and
// alerts fire at 3am by definition. The template path is the one that works, so
// it has to produce the shape the provider expects.
func TestTheTemplatePathSendsATemplateAndTheTextPathSendsText(t *testing.T) {
	var bodies []map[string]any
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload map[string]any
		body, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(body, &payload)
		bodies = append(bodies, payload)
		if got := r.Header.Get("Authorization"); got != "Bearer wa-token" {
			t.Errorf("authorization = %q", got)
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"messages":[{"id":"wamid.1"}]}`))
	}))
	defer server.Close()

	base := WhatsAppConfig{
		AccessToken: "wa-token", PhoneNumberID: "1234567890",
		Recipient: "+91 98765 43210", BaseURL: server.URL,
	}

	plain := NewWhatsApp(base).(*whatsAppTransport)
	plain.client = server.Client()
	if err := plain.Send(context.Background(), "line one\nline two"); err != nil {
		t.Fatalf("text send: %v", err)
	}

	templated := base
	templated.Template = "garuda_alert"
	withTemplate := NewWhatsApp(templated).(*whatsAppTransport)
	withTemplate.client = server.Client()
	if err := withTemplate.Send(context.Background(), "line one\nline two"); err != nil {
		t.Fatalf("template send: %v", err)
	}

	if len(bodies) != 2 {
		t.Fatalf("expected two requests, got %d", len(bodies))
	}
	if bodies[0]["type"] != "text" {
		t.Errorf("the unconfigured-template path did not send text: %v", bodies[0]["type"])
	}
	if bodies[1]["type"] != "template" {
		t.Fatalf("the configured-template path did not send a template: %v", bodies[1]["type"])
	}

	// The number must have been reduced to digits: wa.me and the Cloud API both
	// reject the spacing a person pastes off their own phone.
	if bodies[0]["to"] != "919876543210" {
		t.Errorf("recipient = %v, want E.164 digits", bodies[0]["to"])
	}

	// A template body parameter rejects newlines, so the text is flattened for
	// that path only -- and the text path keeps its layout.
	if text, _ := bodies[0]["text"].(map[string]any); text == nil || !strings.Contains(text["body"].(string), "\n") {
		t.Error("the text path lost its line breaks")
	}
	parameter := templateParameter(t, bodies[1])
	if strings.Contains(parameter, "\n") {
		t.Errorf("the template parameter kept a newline, which the provider rejects: %q", parameter)
	}
	if !strings.Contains(parameter, "line one") || !strings.Contains(parameter, "line two") {
		t.Errorf("flattening lost the message: %q", parameter)
	}
}

func templateParameter(t *testing.T, body map[string]any) string {
	t.Helper()
	template, _ := body["template"].(map[string]any)
	components, _ := template["components"].([]any)
	if len(components) == 0 {
		t.Fatalf("the template carried no components: %v", body)
	}
	component, _ := components[0].(map[string]any)
	parameters, _ := component["parameters"].([]any)
	if len(parameters) == 0 {
		t.Fatalf("the template body had no parameter: %v", component)
	}
	parameter, _ := parameters[0].(map[string]any)
	text, _ := parameter["text"].(string)
	return text
}

// The access token is a credential. It is in the request header and must never
// reach an error string, which is logged and read by people.
func TestARejectedWhatsAppAlertNeverEchoesTheToken(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":{"message":"Invalid OAuth access token","code":190}}`))
	}))
	defer server.Close()

	transport := NewWhatsApp(WhatsAppConfig{
		AccessToken: "super-secret-token-value", PhoneNumberID: "1234567890",
		Recipient: "919876543210", BaseURL: server.URL,
	}).(*whatsAppTransport)
	transport.client = server.Client()

	err := transport.Send(context.Background(), "anything")
	if err == nil {
		t.Fatal("a 401 was reported as a successful send")
	}
	if strings.Contains(err.Error(), "super-secret-token-value") {
		t.Fatalf("the access token reached the error: %v", err)
	}
	if !strings.Contains(err.Error(), "190") {
		t.Errorf("the provider's own code was lost, leaving nothing to diagnose: %v", err)
	}
}
