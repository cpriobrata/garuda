package mailer

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSendGridSendsBoundedServerSideMessage(t *testing.T) {
	var authorization string
	var payload map[string]any
	var method, path string
	var decodeErr error
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		method, path = r.Method, r.URL.Path
		authorization = r.Header.Get("Authorization")
		decodeErr = json.NewDecoder(r.Body).Decode(&payload)
		w.WriteHeader(http.StatusAccepted)
	}))
	defer server.Close()

	client := NewSendGrid("test-api-key", server.URL, "hello@garuda.test", "Garuda", "support@garuda.test")
	err := client.Send(context.Background(), Message{
		ToEmail: "owner@example.com", ToName: "Owner", Subject: "Verify your email",
		Text: "Open the secure verification link.", HTML: "<p>Open the secure verification link.</p>",
	})
	if err != nil {
		t.Fatalf("send message: %v", err)
	}
	if method != http.MethodPost || path != "/v3/mail/send" {
		t.Fatalf("unexpected request %s %s", method, path)
	}
	if decodeErr != nil {
		t.Fatalf("decode mail payload: %v", decodeErr)
	}
	if authorization != "Bearer test-api-key" {
		t.Fatalf("unexpected authorization header %q", authorization)
	}
	if payload["subject"] != "Verify your email" {
		t.Fatalf("unexpected payload: %#v", payload)
	}
	if strings.Contains(strings.ToLower(payload["subject"].(string)), "test-api-key") {
		t.Fatal("API key leaked into message payload")
	}
}

func TestSendGridRejectsProviderFailure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "rejected", http.StatusUnauthorized)
	}))
	defer server.Close()

	client := NewSendGrid("bad-key", server.URL, "hello@garuda.test", "Garuda", "")
	err := client.Send(context.Background(), Message{ToEmail: "owner@example.com", Subject: "Welcome", Text: "Welcome"})
	if err == nil || !strings.Contains(err.Error(), "status 401") {
		t.Fatalf("expected provider failure, got %v", err)
	}
}

func TestDisabledSendGridFailsClosed(t *testing.T) {
	client := NewSendGrid("", "", "", "", "")
	if client.Enabled() {
		t.Fatal("incomplete SendGrid configuration was enabled")
	}
	if err := client.Send(context.Background(), Message{ToEmail: "owner@example.com", Subject: "Welcome", Text: "Welcome"}); err == nil {
		t.Fatal("disabled SendGrid accepted a message")
	}
}
