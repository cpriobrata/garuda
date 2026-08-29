package alerts

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"
)

type recordingTransport struct {
	mutex   sync.Mutex
	sent    []string
	enabled bool
	err     error
}

func (t *recordingTransport) Name() string { return "recording" }
func (t *recordingTransport) Enabled() bool {
	return t.enabled
}
func (t *recordingTransport) Send(_ context.Context, text string) error {
	t.mutex.Lock()
	defer t.mutex.Unlock()
	t.sent = append(t.sent, text)
	return t.err
}
func (t *recordingTransport) count() int {
	t.mutex.Lock()
	defer t.mutex.Unlock()
	return len(t.sent)
}

// consider() is used directly rather than Notify() throughout, because Notify
// delivers on a goroutine and a test that raced the network would be a test that
// sometimes lies.
func newTestNotifier(clock *time.Time) (*Notifier, *recordingTransport) {
	transport := &recordingTransport{enabled: true}
	notifier := New(Options{
		Transport: transport,
		Service:   "garuda-api (test)",
		Now:       func() time.Time { return *clock },
	})
	return notifier, transport
}

// The failure this whole package exists to prevent: one broken dependency
// hammering a phone with thousands of identical messages.
func TestTheSameFailureAlertsOncePerCooldown(t *testing.T) {
	now := time.Date(2026, 8, 30, 3, 0, 0, 0, time.UTC)
	notifier, _ := newTestNotifier(&now)
	alert := Alert{Kind: "http_5xx", Where: "POST /v1/agents", Status: 500}

	sent := 0
	for attempt := 0; attempt < 500; attempt++ {
		if _, ok := notifier.consider(alert); ok {
			sent++
		}
		now = now.Add(time.Second)
	}
	if sent != 1 {
		t.Fatalf("500 identical failures over 8 minutes produced %d alerts, want 1", sent)
	}

	// Past the cooldown it speaks again, because a failure that is still
	// happening twenty minutes later is news.
	now = now.Add(defaultCooldown)
	text, ok := notifier.consider(alert)
	if !ok {
		t.Fatal("the same failure never alerted again after the cooldown expired")
	}
	if !strings.Contains(text, "occurrences were suppressed") {
		t.Errorf("the follow-up does not say how much was held back: %q", text)
	}
}

// Distinct failures are distinct incidents and each deserves its own message.
func TestDifferentFailuresAlertSeparately(t *testing.T) {
	now := time.Date(2026, 8, 30, 3, 0, 0, 0, time.UTC)
	notifier, _ := newTestNotifier(&now)

	if _, ok := notifier.consider(Alert{Kind: "http_5xx", Where: "POST /v1/agents", Status: 500}); !ok {
		t.Fatal("the first failure was suppressed")
	}
	if _, ok := notifier.consider(Alert{Kind: "http_5xx", Where: "GET /v1/leads", Status: 500}); !ok {
		t.Fatal("a failure somewhere else was mistaken for the first one")
	}
	if _, ok := notifier.consider(Alert{Kind: "panic", Where: "POST /v1/agents", Status: 500}); !ok {
		t.Fatal("a panic was mistaken for the 5xx at the same route")
	}
}

// A cascading failure is exactly when the alert channel must not become the
// second outage.
func TestTheHourlyCapStopsAFloodAndSaysSo(t *testing.T) {
	now := time.Date(2026, 8, 30, 3, 0, 0, 0, time.UTC)
	notifier, _ := newTestNotifier(&now)

	messages := []string{}
	for attempt := 0; attempt < 200; attempt++ {
		alert := Alert{Kind: "http_5xx", Where: "GET /v1/route" + string(rune('a'+attempt%26)) + string(rune('a'+attempt/26)), Status: 500}
		if text, ok := notifier.consider(alert); ok {
			messages = append(messages, text)
		}
		now = now.Add(time.Second)
	}
	if len(messages) > defaultHourlyCap {
		t.Fatalf("200 distinct failures produced %d messages, past the cap of %d", len(messages), defaultHourlyCap)
	}
	last := messages[len(messages)-1]
	if !strings.Contains(last, "alerts are paused") {
		t.Fatalf("the channel went quiet without saying why: %q", last)
	}
}

// The cap is a rolling window, not a budget spent forever.
func TestAlertingResumesAfterTheHourPasses(t *testing.T) {
	now := time.Date(2026, 8, 30, 3, 0, 0, 0, time.UTC)
	notifier, _ := newTestNotifier(&now)

	for attempt := 0; attempt < defaultHourlyCap+5; attempt++ {
		notifier.consider(Alert{Kind: "http_5xx", Where: "GET /v1/r" + string(rune('a'+attempt)), Status: 500})
		now = now.Add(time.Second)
	}
	if _, ok := notifier.consider(Alert{Kind: "http_5xx", Where: "GET /v1/fresh", Status: 500}); ok {
		t.Fatal("the cap was not in force")
	}

	now = now.Add(time.Hour + time.Minute)
	if _, ok := notifier.consider(Alert{Kind: "http_5xx", Where: "GET /v1/fresh", Status: 500}); !ok {
		t.Fatal("alerting never resumed after the hour rolled over")
	}
}

// An alert lands on a phone and stays there, so it must carry no personal data
// even when a caller passes something it should not have.
func TestAnAlertCarriesNoPersonalData(t *testing.T) {
	now := time.Date(2026, 8, 30, 3, 0, 0, 0, time.UTC)
	notifier, _ := newTestNotifier(&now)

	text, ok := notifier.consider(Alert{
		Kind:      "dependency",
		Where:     "gemini",
		Detail:    "failed for visitor@example.com with token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abcdefghijklmnop",
		RequestID: "req_abc123",
		Status:    502,
	})
	if !ok {
		t.Fatal("the alert was suppressed")
	}
	if strings.Contains(text, "visitor@example.com") {
		t.Errorf("an email address reached the alert: %q", text)
	}
	if strings.Contains(text, "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9") {
		t.Errorf("a token reached the alert: %q", text)
	}
	if !strings.Contains(text, "req_abc123") {
		t.Errorf("the request id was redacted, leaving nothing to correlate: %q", text)
	}
}

// A crafted error string must not be able to forge extra fields by embedding
// newlines in what becomes a multi-line message.
func TestAlertDetailCannotForgeItsOwnFields(t *testing.T) {
	now := time.Date(2026, 8, 30, 3, 0, 0, 0, time.UTC)
	notifier, _ := newTestNotifier(&now)

	text, _ := notifier.consider(Alert{
		Kind:   "dependency",
		Where:  "gemini",
		Detail: "boom\nStatus: 200\nDetail: everything is fine",
		Status: 502,
	})
	// The property that matters is that a crafted string cannot become its own
	// LINE. Inline text is just text; a forged line is a lie about the incident.
	statusLines := 0
	for _, line := range strings.Split(text, "\n") {
		if strings.HasPrefix(line, "Status: ") {
			statusLines++
		}
	}
	if statusLines != 1 {
		t.Fatalf("a detail string forged a Status line: %q", text)
	}
	if strings.Contains(text, "\nDetail: everything is fine") {
		t.Fatalf("a detail string forged a Detail line: %q", text)
	}
}

// A deployment with no alerting credentials must run exactly as it does today.
func TestAnUnconfiguredNotifierIsSilentRatherThanBroken(t *testing.T) {
	transport := &recordingTransport{enabled: false}
	notifier := New(Options{Transport: transport})
	if notifier.Enabled() {
		t.Fatal("an unconfigured transport reports itself enabled")
	}
	notifier.Notify(Alert{Kind: "panic", Where: "POST /v1/agents", Status: 500})
	if transport.count() != 0 {
		t.Fatal("an unconfigured notifier tried to deliver")
	}

	// And a nil notifier -- what a partially built server holds -- must not panic
	// while reporting that something else panicked.
	var absent *Notifier
	absent.Notify(Alert{Kind: "panic"})
}

// The environment goes in every message, because an owner running staging and
// production otherwise cannot tell which one woke them.
func TestEveryAlertNamesTheDeployment(t *testing.T) {
	now := time.Date(2026, 8, 30, 3, 0, 0, 0, time.UTC)
	notifier, _ := newTestNotifier(&now)
	text, _ := notifier.consider(Alert{Kind: "panic", Where: "POST /v1/agents", Status: 500})
	if !strings.HasPrefix(text, "garuda-api (test)") {
		t.Fatalf("the alert does not name the deployment: %q", text)
	}
}

func TestWhatsAppTransportNeedsEveryCredentialBeforeItClaimsToWork(t *testing.T) {
	complete := WhatsAppConfig{AccessToken: "token", PhoneNumberID: "123", Recipient: "+91 98765 43210"}
	if !NewWhatsApp(complete).Enabled() {
		t.Fatal("a fully configured WhatsApp transport reports itself disabled")
	}
	for name, config := range map[string]WhatsAppConfig{
		"no token":     {PhoneNumberID: "123", Recipient: "919876543210"},
		"no phone id":  {AccessToken: "token", Recipient: "919876543210"},
		"no recipient": {AccessToken: "token", PhoneNumberID: "123"},
		"short number": {AccessToken: "token", PhoneNumberID: "123", Recipient: "12345"},
	} {
		if NewWhatsApp(config).Enabled() {
			t.Errorf("%s: a partly configured transport reports itself enabled", name)
		}
	}
}

// First is what lets WhatsApp be the channel while a webhook keeps alerting
// alive on a deployment whose WhatsApp credentials have not arrived.
func TestFirstPrefersTheConfiguredTransport(t *testing.T) {
	whatsapp := NewWhatsApp(WhatsAppConfig{})
	webhook := NewWebhook(WebhookConfig{URL: "https://hooks.example/alerts"})
	chosen := First(whatsapp, webhook)
	if chosen == nil || chosen.Name() != "webhook" {
		t.Fatalf("First did not fall through to the configured transport: %v", chosen)
	}
	if First(NewWhatsApp(WhatsAppConfig{}), NewWebhook(WebhookConfig{})) != nil {
		t.Fatal("First returned a transport when nothing was configured")
	}
}

// An http:// webhook would put the alert on the wire in clear text.
func TestWebhookTransportRefusesPlaintextEndpoints(t *testing.T) {
	if NewWebhook(WebhookConfig{URL: "http://hooks.example/alerts"}).Enabled() {
		t.Fatal("a plaintext alert endpoint was accepted")
	}
}
