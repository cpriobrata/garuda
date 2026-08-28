package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	"garuda/backend/internal/mailer"
	"garuda/backend/internal/model"
)

type capturedEmail struct {
	Subject string `json:"subject"`
	Content []struct {
		Value string `json:"value"`
	} `json:"content"`
}

func TestLocalEmailVerificationResetAndWelcomeLifecycle(t *testing.T) {
	var mu sync.Mutex
	var emails []capturedEmail
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/v3/mail/send" {
			t.Errorf("unexpected mail request %s %s", r.Method, r.URL.Path)
		}
		var email capturedEmail
		if err := json.NewDecoder(r.Body).Decode(&email); err != nil {
			t.Errorf("decode email: %v", err)
		}
		mu.Lock()
		emails = append(emails, email)
		mu.Unlock()
		w.WriteHeader(http.StatusAccepted)
	}))
	defer provider.Close()

	server, dataStore := newTestServer(t)
	server.cfg.DemoMode = false
	server.cfg.AuthMode = "local"
	server.cfg.AuthVerifyURL = "https://app.example.com/auth/verify-email"
	server.cfg.AuthResetURL = "https://app.example.com/auth/reset-password"
	server.cfg.EmailVerificationTTL = time.Hour
	server.mailer = mailer.New("server-only-key", provider.URL+"/v3", "no-reply@example.com", "Garuda", "")
	handler := server.Handler()

	signup := performJSON(t, handler, http.MethodPost, "/v1/auth/signup", "", "http://localhost:3000", map[string]any{
		"name": "Verified Owner", "email": "owner@example.com", "password": "correct-horse-123",
	})
	signupData := dataFrom(t, signup, http.StatusCreated)
	if signupData["verification_required"] != true || signupData["access_token"] != nil || signupData["refresh_token"] != nil {
		t.Fatalf("unexpected unverified signup response: %#v", signupData)
	}
	if got := capturedEmailCount(&mu, &emails); got != 1 {
		t.Fatalf("verification email count = %d", got)
	}

	unverifiedLogin := performJSON(t, handler, http.MethodPost, "/v1/auth/login", "", "http://localhost:3000", map[string]any{
		"email": "owner@example.com", "password": "correct-horse-123",
	})
	if unverifiedLogin.Code != http.StatusForbidden || !strings.Contains(unverifiedLogin.Body.String(), "email_not_verified") {
		t.Fatalf("unverified login = %d %s", unverifiedLogin.Code, unverifiedLogin.Body.String())
	}

	verificationToken := tokenFromEmail(t, capturedEmailAt(&mu, &emails, 0))
	verify := performJSON(t, handler, http.MethodPost, "/v1/auth/verify-email", "", "http://localhost:3000", map[string]any{"token": verificationToken})
	verifyData := dataFrom(t, verify, http.StatusOK)
	accessToken, _ := verifyData["access_token"].(string)
	if accessToken == "" || verifyData["refresh_token"] == "" {
		t.Fatalf("verification did not issue a session: %#v", verifyData)
	}
	if got := capturedEmailCount(&mu, &emails); got != 2 {
		t.Fatalf("expected verification and one welcome email, got %d", got)
	}
	if capturedEmailAt(&mu, &emails, 1).Subject != "Welcome to Garuda" {
		t.Fatalf("unexpected welcome email: %#v", capturedEmailAt(&mu, &emails, 1))
	}

	replay := performJSON(t, handler, http.MethodPost, "/v1/auth/verify-email", "", "http://localhost:3000", map[string]any{"token": verificationToken})
	if replay.Code != http.StatusUnprocessableEntity {
		t.Fatalf("verification replay = %d %s", replay.Code, replay.Body.String())
	}
	login := performJSON(t, handler, http.MethodPost, "/v1/auth/login", "", "http://localhost:3000", map[string]any{
		"email": "owner@example.com", "password": "correct-horse-123",
	})
	dataFrom(t, login, http.StatusOK)
	if got := capturedEmailCount(&mu, &emails); got != 2 {
		t.Fatalf("login resent welcome email; count = %d", got)
	}

	forgot := performJSON(t, handler, http.MethodPost, "/v1/auth/forgot-password", "", "http://localhost:3000", map[string]any{"email": "owner@example.com"})
	dataFrom(t, forgot, http.StatusAccepted)
	if got := capturedEmailCount(&mu, &emails); got != 3 {
		t.Fatalf("password-reset email count = %d", got)
	}
	resetToken := tokenFromEmail(t, capturedEmailAt(&mu, &emails, 2))
	if !strings.HasPrefix(resetToken, localPasswordResetPrefix) {
		t.Fatalf("unexpected reset token prefix")
	}
	reset := performJSON(t, handler, http.MethodPost, "/v1/auth/reset-password", "", "http://localhost:3000", map[string]any{
		"token": resetToken, "password": "new-correct-horse-456",
	})
	dataFrom(t, reset, http.StatusOK)
	oldSession := performJSON(t, handler, http.MethodGet, "/v1/me", accessToken, "http://localhost:3000", nil)
	if oldSession.Code != http.StatusUnauthorized {
		t.Fatalf("pre-reset access token remained valid: %d", oldSession.Code)
	}
	newLogin := performJSON(t, handler, http.MethodPost, "/v1/auth/login", "", "http://localhost:3000", map[string]any{
		"email": "owner@example.com", "password": "new-correct-horse-456",
	})
	dataFrom(t, newLogin, http.StatusOK)

	_ = dataStore.View(func(state *model.State) error {
		encoded, err := json.Marshal(state)
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(encoded), verificationToken) || strings.Contains(string(encoded), resetToken) {
			t.Fatal("raw auth token was persisted")
		}
		return nil
	})
}

func TestResendVerificationIsEnumerationSafe(t *testing.T) {
	server, _ := newTestServer(t)
	server.cfg.DemoMode = false
	server.cfg.AuthMode = "local"
	handler := server.Handler()
	response := performJSON(t, handler, http.MethodPost, "/v1/auth/resend-verification", "", "http://localhost:3000", map[string]any{"email": "missing@example.com"})
	data := dataFrom(t, response, http.StatusAccepted)
	if data["message"] != "If verification is needed, a new email has been sent." {
		t.Fatalf("unexpected generic response: %#v", data)
	}
}

var emailTokenPattern = regexp.MustCompile(`token=([A-Za-z0-9_-]+)`)

func tokenFromEmail(t *testing.T, email capturedEmail) string {
	t.Helper()
	for _, content := range email.Content {
		if match := emailTokenPattern.FindStringSubmatch(content.Value); len(match) == 2 {
			return match[1]
		}
	}
	t.Fatalf("email did not contain a token link: %#v", email)
	return ""
}

func capturedEmailCount(mu *sync.Mutex, emails *[]capturedEmail) int {
	mu.Lock()
	defer mu.Unlock()
	return len(*emails)
}

func capturedEmailAt(mu *sync.Mutex, emails *[]capturedEmail, index int) capturedEmail {
	mu.Lock()
	defer mu.Unlock()
	return (*emails)[index]
}
