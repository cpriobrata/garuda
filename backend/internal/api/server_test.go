package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
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

	"garuda/backend/internal/billing"
	"garuda/backend/internal/config"
	"garuda/backend/internal/googleauth"
	"garuda/backend/internal/model"
	"garuda/backend/internal/rag"
	"garuda/backend/internal/security"
	"garuda/backend/internal/store"
	"garuda/backend/internal/supabase"
)

type fakeGoogleVerifier struct {
	claims googleauth.Claims
	err    error
}

func (f fakeGoogleVerifier) Enabled() bool { return true }

func (f fakeGoogleVerifier) Verify(context.Context, string) (googleauth.Claims, error) {
	return f.claims, f.err
}

func newTestServer(t *testing.T) (*Server, *store.FileStore) {
	t.Helper()
	dataStore, err := store.OpenFile(filepath.Join(t.TempDir(), "garuda.json"))
	if err != nil {
		t.Fatalf("OpenFile: %v", err)
	}
	cfg := config.Config{
		PublicURL: "http://localhost:8080", JWTSecret: "test-secret-at-least-thirty-two-bytes-long",
		VisitorHMACKey: "visitor-hmac-test-secret", AccessTokenTTL: time.Hour, RefreshTokenTTL: 30 * 24 * time.Hour, PasswordResetTTL: time.Hour,
		AllowedOrigins: []string{"http://localhost:3000"}, DemoMode: true, ExposeResetToken: true,
		StripeSuccessURL: "http://localhost:3000/checkout/success?ok=1", StripePortalReturnURL: "http://localhost:3000/app/billing",
		LLMBaseURL: "https://api.openai.com/v1", LLMModel: "test-model",
	}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	return New(cfg, dataStore, logger), dataStore
}

func performJSON(t *testing.T, handler http.Handler, method, path, token, origin string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var payload []byte
	if body != nil {
		var err error
		payload, err = json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal request: %v", err)
		}
	}
	request := httptest.NewRequest(method, path, bytes.NewReader(payload))
	request.Header.Set("Content-Type", "application/json")
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	if origin != "" {
		request.Header.Set("Origin", origin)
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

func dataFrom(t *testing.T, response *httptest.ResponseRecorder, status int) map[string]any {
	t.Helper()
	if response.Code != status {
		t.Fatalf("expected status %d, got %d: %s", status, response.Code, response.Body.String())
	}
	var envelope struct {
		Data map[string]any `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	return envelope.Data
}

func TestRateLimitUsesRemoteAddressAndStableRouteBucket(t *testing.T) {
	server, _ := newTestServer(t)
	calls := 0
	handler := server.rateLimit("widget.message", 1, time.Minute, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls++
		w.WriteHeader(http.StatusNoContent)
	}))

	first := httptest.NewRequest(http.MethodPost, "/widget/v1/sessions/random-one/messages", nil)
	first.RemoteAddr = "203.0.113.10:41000"
	first.Header.Set("X-Forwarded-For", "198.51.100.1")
	firstResponse := httptest.NewRecorder()
	handler.ServeHTTP(firstResponse, first)
	if firstResponse.Code != http.StatusNoContent {
		t.Fatalf("expected first request 204, got %d", firstResponse.Code)
	}

	second := httptest.NewRequest(http.MethodPost, "/widget/v1/sessions/random-two/messages", nil)
	second.RemoteAddr = "203.0.113.10:42000"
	second.Header.Set("X-Forwarded-For", "198.51.100.2")
	secondResponse := httptest.NewRecorder()
	handler.ServeHTTP(secondResponse, second)
	if secondResponse.Code != http.StatusTooManyRequests {
		t.Fatalf("expected spoofed X-Forwarded-For and a new dynamic path to share the bucket, got %d", secondResponse.Code)
	}
	if calls != 1 {
		t.Fatalf("expected downstream handler to run once, ran %d times", calls)
	}
	if got := len(server.limiter.windows); got != 1 {
		t.Fatalf("expected one normalized limiter entry, got %d", got)
	}
}

func TestRateLimitWindowMapIsBounded(t *testing.T) {
	server, _ := newTestServer(t)
	server.limiter.maxEntries = 3
	handler := server.rateLimit("widget.session_create", 10, time.Hour, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))

	for index := 0; index < 10; index++ {
		request := httptest.NewRequest(http.MethodPost, "/widget/v1/sessions", nil)
		request.RemoteAddr = fmt.Sprintf("203.0.113.%d:40000", index+1)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != http.StatusNoContent {
			t.Fatalf("request %d: expected 204, got %d", index, response.Code)
		}
	}

	if got := len(server.limiter.windows); got != server.limiter.maxEntries {
		t.Fatalf("expected limiter map to remain capped at %d entries, got %d", server.limiter.maxEntries, got)
	}
}

func TestAddQueryParameterHandlesRedirectsWithAndWithoutQuery(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		want string
	}{
		{name: "without existing query", raw: "http://localhost:3000/checkout/success", want: "http://localhost:3000/checkout/success?demo_checkout=cs_demo_123"},
		{name: "with existing query", raw: "http://localhost:3000/checkout/success?checkout=success", want: "http://localhost:3000/checkout/success?checkout=success&demo_checkout=cs_demo_123"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := addQueryParameter(test.raw, "demo_checkout", "cs_demo_123")
			if err != nil {
				t.Fatalf("addQueryParameter: %v", err)
			}
			if got != test.want {
				t.Fatalf("expected %q, got %q", test.want, got)
			}
		})
	}
	if _, err := addQueryParameter("://not-a-url", "demo_checkout", "cs_demo_123"); err == nil {
		t.Fatal("expected malformed redirect to be rejected")
	}
}

func TestCheckoutRejectsAlreadyEntitledWorkspace(t *testing.T) {
	server, dataStore := newTestServer(t)
	now := time.Now().UTC()
	account := model.Account{ID: "org_paid", Name: "Paid workspace", BillingStatus: "active", CreatedAt: now, UpdatedAt: now}
	user := model.User{ID: "usr_paid", AccountID: account.ID, Name: "Owner", Email: "paid@example.com", Role: "owner", CreatedAt: now, UpdatedAt: now}
	if err := dataStore.Update(func(state *model.State) error {
		state.Accounts = append(state.Accounts, account)
		state.Users = append(state.Users, user)
		return nil
	}); err != nil {
		t.Fatalf("seed paid workspace: %v", err)
	}
	token, err := server.issueToken(user)
	if err != nil {
		t.Fatalf("issue token: %v", err)
	}
	response := performJSON(t, server.Handler(), http.MethodPost, "/v1/billing/checkout", token, "http://localhost:3000", nil)
	if response.Code != http.StatusConflict || !strings.Contains(response.Body.String(), "subscription_already_active") {
		t.Fatalf("expected active-subscription conflict, got %d: %s", response.Code, response.Body.String())
	}
}

func TestCheckoutReplaysExistingSessionAcrossKeys(t *testing.T) {
	server, dataStore := newTestServer(t)
	server.cfg.DemoMode = false
	now := time.Now().UTC()
	account := model.Account{ID: "org_checkout_guard", Name: "Checkout guard", BillingStatus: "incomplete", CreatedAt: now, UpdatedAt: now}
	user := model.User{ID: "usr_checkout_guard", AccountID: account.ID, Name: "Owner", Email: "checkout@example.com", Role: "owner", CreatedAt: now, UpdatedAt: now}
	if err := dataStore.Update(func(state *model.State) error {
		state.Accounts = append(state.Accounts, account)
		state.Users = append(state.Users, user)
		return nil
	}); err != nil {
		t.Fatalf("seed checkout workspace: %v", err)
	}
	token, err := server.issueToken(user)
	if err != nil {
		t.Fatalf("issue token: %v", err)
	}
	providerCalls := 0
	stripeServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		providerCalls++
		if got := r.Header.Get("Idempotency-Key"); got != "checkout-key-one" {
			t.Errorf("unexpected Stripe idempotency key %q", got)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprintf(w, `{"id":"cs_guard","url":"https://checkout.stripe.test/cs_guard","expires_at":%d}`, now.Add(time.Hour).Unix())
	}))
	defer stripeServer.Close()
	server.stripe = billing.NewStripe("sk_test", "whsec_test", "price_test", stripeServer.URL, "https://app.test/success", "https://app.test/cancel")

	checkout := func(key string) *httptest.ResponseRecorder {
		request := httptest.NewRequest(http.MethodPost, "/v1/billing/checkout", nil)
		request.Header.Set("Authorization", "Bearer "+token)
		request.Header.Set("Origin", "http://localhost:3000")
		request.Header.Set("Idempotency-Key", key)
		response := httptest.NewRecorder()
		server.Handler().ServeHTTP(response, request)
		return response
	}
	first := checkout("checkout-key-one")
	dataFrom(t, first, http.StatusCreated)
	replay := checkout("checkout-key-one")
	replayData := dataFrom(t, replay, http.StatusOK)
	if replayData["session_id"] != "cs_guard" || replayData["replayed"] != true {
		t.Fatalf("unexpected checkout replay: %#v", replayData)
	}
	parallel := checkout("checkout-key-two")
	parallelData := dataFrom(t, parallel, http.StatusOK)
	if parallelData["session_id"] != "cs_guard" || parallelData["replayed"] != true {
		t.Fatalf("new key did not recover the existing checkout session: %#v", parallelData)
	}
	if providerCalls != 1 {
		t.Fatalf("expected one provider checkout call, got %d", providerCalls)
	}
}

func TestCheckoutReservationBlocksConcurrentCreation(t *testing.T) {
	server, _ := newTestServer(t)
	now := time.Now().UTC()
	first, replayed, err := server.reserveCheckout("org_parallel_checkout", security.HashOpaqueToken("checkout-key-one"), now)
	if err != nil || replayed || first.ID == "" {
		t.Fatalf("reserve first checkout: attempt=%#v replayed=%v err=%v", first, replayed, err)
	}
	if _, _, err := server.reserveCheckout("org_parallel_checkout", security.HashOpaqueToken("checkout-key-two"), now.Add(time.Millisecond)); !errors.Is(err, errCheckoutInProgress) {
		t.Fatalf("expected concurrent checkout reservation to be blocked, got %v", err)
	}
}

func TestInvoiceEventPreservesSubscriptionPeriodEnd(t *testing.T) {
	now := time.Now().UTC()
	periodEnd := now.Add(20 * 24 * time.Hour)
	state := model.State{
		Accounts:      []model.Account{{ID: "org_invoice", StripeCustomerID: "cus_invoice", BillingStatus: "active"}},
		Subscriptions: []model.Subscription{{ID: "sub_invoice", AccountID: "org_invoice", StripeCustomerID: "cus_invoice", Status: "active", CurrentPeriodEnd: &periodEnd}},
	}
	if err := applyStripeEvent(&state, "invoice.paid", map[string]any{"customer": "cus_invoice", "subscription": "sub_stripe"}, now, now); err != nil {
		t.Fatalf("apply invoice event: %v", err)
	}
	if state.Subscriptions[0].CurrentPeriodEnd == nil || !state.Subscriptions[0].CurrentPeriodEnd.Equal(periodEnd) {
		t.Fatalf("invoice event cleared current period end: %#v", state.Subscriptions[0].CurrentPeriodEnd)
	}
}

func TestPublicWidgetHistoryIsMinimalSortedAndCapped(t *testing.T) {
	base := time.Date(2026, time.August, 29, 12, 0, 0, 0, time.UTC)
	messages := make([]model.Message, 0, widgetHistoryLimit+5)
	for index := widgetHistoryLimit + 4; index >= 0; index-- {
		messages = append(messages, model.Message{
			ID: "msg_" + fmt.Sprint(index), AccountID: "org_private", AgentID: "agt_private", SessionID: "cvs_private", VisitorID: "vst_private",
			Role: "assistant", Content: fmt.Sprintf("message %d", index), Metadata: map[string]any{"private": true}, CreatedAt: base.Add(time.Duration(index) * time.Second),
		})
	}

	public := publicWidgetHistory(messages, widgetHistoryLimit)
	if len(public) != widgetHistoryLimit {
		t.Fatalf("expected %d public messages, got %d", widgetHistoryLimit, len(public))
	}
	if public[0].ID != "msg_5" || public[len(public)-1].ID != "msg_54" {
		t.Fatalf("expected oldest retained msg_5 and newest msg_54, got %q and %q", public[0].ID, public[len(public)-1].ID)
	}
	payload, err := json.Marshal(public)
	if err != nil {
		t.Fatalf("marshal public history: %v", err)
	}
	for _, forbidden := range []string{"account_id", "agent_id", "session_id", "visitor_id", "metadata", "org_private", "cvs_private"} {
		if strings.Contains(string(payload), forbidden) {
			t.Fatalf("public widget history exposed %q: %s", forbidden, payload)
		}
	}
}

func TestLocalHappyPath(t *testing.T) {
	server, _ := newTestServer(t)
	handler := server.Handler()

	signup := performJSON(t, handler, http.MethodPost, "/v1/auth/signup", "", "http://localhost:3000", map[string]any{
		"name": "Asha", "email": "asha@example.com", "password": "correct-horse-123", "business_name": "Acme Realty",
	})
	signupData := dataFrom(t, signup, http.StatusCreated)
	accessToken, _ := signupData["access_token"].(string)
	if accessToken == "" {
		t.Fatal("signup did not return an access token")
	}

	demo := performJSON(t, handler, http.MethodPost, "/v1/billing/demo/complete", accessToken, "http://localhost:3000", nil)
	dataFrom(t, demo, http.StatusOK)

	onboarding := performJSON(t, handler, http.MethodPut, "/v1/onboarding", accessToken, "http://localhost:3000", map[string]any{
		"business_name": "Acme Realty", "industry": "real estate", "audience": "home buyers", "goals": []string{"qualify leads"}, "tone": "warm", "bot_type": "sales",
		"answers": map[string]string{
			"business_profile": "Acme Realty helps people find homes.", "primary_outcome": "qualify leads",
			"audience_and_offer": "Home buyers looking for apartments.", "voice_and_capture": "Warm; ask for email after helping.",
		},
	})
	dataFrom(t, onboarding, http.StatusOK)
	complete := performJSON(t, handler, http.MethodPost, "/v1/onboarding/complete", accessToken, "http://localhost:3000", nil)
	completeData := dataFrom(t, complete, http.StatusAccepted)
	agentMap, _ := completeData["agent"].(map[string]any)
	agentID, _ := agentMap["id"].(string)
	if agentID == "" {
		t.Fatal("onboarding completion did not create an agent")
	}

	published := performJSON(t, handler, http.MethodPost, "/v1/agents/"+agentID+"/publish", accessToken, "http://localhost:3000", nil)
	publishedData := dataFrom(t, published, http.StatusOK)
	agentKey, _ := publishedData["agent_key"].(string)
	if agentKey == "" {
		t.Fatal("publish did not return an agent key")
	}

	bootstrap := performJSON(t, handler, http.MethodPost, "/widget/v1/sessions", "", "http://localhost:3000", map[string]any{
		"agent_key": agentKey, "consent": map[string]bool{"memory": true, "analytics": true},
	})
	bootstrapData := dataFrom(t, bootstrap, http.StatusCreated)
	sessionID, _ := bootstrapData["session_id"].(string)
	sessionToken, _ := bootstrapData["session_token"].(string)
	visitorToken, _ := bootstrapData["visitor_token"].(string)
	if sessionID == "" || sessionToken == "" || visitorToken == "" {
		t.Fatalf("incomplete widget bootstrap: %#v", bootstrapData)
	}

	messageRequest := httptest.NewRequest(http.MethodPost, "/widget/v1/sessions/"+sessionID+"/messages", bytes.NewBufferString(`{"client_message_id":"web_1","content":"Hello, I need a home"}`))
	messageRequest.Header.Set("Content-Type", "application/json")
	messageRequest.Header.Set("Origin", "http://localhost:3000")
	messageRequest.Header.Set("X-Garuda-Session-Token", sessionToken)
	messageResponse := httptest.NewRecorder()
	handler.ServeHTTP(messageResponse, messageRequest)
	dataFrom(t, messageResponse, http.StatusCreated)

	leadRequest := httptest.NewRequest(http.MethodPost, "/widget/v1/sessions/"+sessionID+"/leads", bytes.NewBufferString(`{"client_capture_id":"lead_1","fields":{"name":"Ravi","email":"ravi@example.com"},"consent":{"granted":true,"notice_version":"v1"}}`))
	leadRequest.Header.Set("Content-Type", "application/json")
	leadRequest.Header.Set("Origin", "http://localhost:3000")
	leadRequest.Header.Set("X-Garuda-Session-Token", sessionToken)
	leadResponse := httptest.NewRecorder()
	handler.ServeHTTP(leadResponse, leadRequest)
	dataFrom(t, leadResponse, http.StatusCreated)

	secondBootstrap := performJSON(t, handler, http.MethodPost, "/widget/v1/sessions", "", "http://localhost:3000", map[string]any{
		"agent_key": agentKey, "visitor_token": visitorToken, "consent": map[string]bool{"memory": true},
	})
	secondData := dataFrom(t, secondBootstrap, http.StatusCreated)
	conversation, _ := secondData["conversation"].(map[string]any)
	if resumed, _ := conversation["resumed"].(bool); !resumed {
		t.Fatal("returning visitor did not resume the conversation")
	}

	dashboard := performJSON(t, handler, http.MethodGet, "/v1/dashboard", accessToken, "http://localhost:3000", nil)
	dashboardData := dataFrom(t, dashboard, http.StatusOK)
	metrics, _ := dashboardData["metrics"].(map[string]any)
	if metrics["leads"].(float64) != 1 {
		t.Fatalf("expected one lead, got %#v", metrics)
	}
}

func TestLocalRefreshTokenRotatesAndRejectsReplay(t *testing.T) {
	server, _ := newTestServer(t)
	handler := server.Handler()
	signup := performJSON(t, handler, http.MethodPost, "/v1/auth/signup", "", "http://localhost:3000", map[string]any{
		"name": "Refresh Owner", "email": "refresh@example.com", "password": "correct-horse-123",
	})
	signupData := dataFrom(t, signup, http.StatusCreated)
	oldRefresh, _ := signupData["refresh_token"].(string)
	if len(oldRefresh) < 16 {
		t.Fatalf("signup did not issue a local refresh token: %#v", signupData)
	}
	rotated := performJSON(t, handler, http.MethodPost, "/v1/auth/refresh", "", "http://localhost:3000", map[string]any{"refresh_token": oldRefresh})
	rotatedData := dataFrom(t, rotated, http.StatusOK)
	newRefresh, _ := rotatedData["refresh_token"].(string)
	if newRefresh == "" || newRefresh == oldRefresh || rotatedData["access_token"] == "" || rotatedData["token_type"] != "Bearer" {
		t.Fatalf("refresh did not rotate the session: %#v", rotatedData)
	}
	replay := performJSON(t, handler, http.MethodPost, "/v1/auth/refresh", "", "http://localhost:3000", map[string]any{"refresh_token": oldRefresh})
	if replay.Code != http.StatusUnauthorized || !strings.Contains(replay.Body.String(), "invalid_refresh_token") {
		t.Fatalf("used refresh token replay returned %d: %s", replay.Code, replay.Body.String())
	}
	revokedDescendant := performJSON(t, handler, http.MethodPost, "/v1/auth/refresh", "", "http://localhost:3000", map[string]any{"refresh_token": newRefresh})
	if revokedDescendant.Code != http.StatusUnauthorized || !strings.Contains(revokedDescendant.Body.String(), "invalid_refresh_token") {
		t.Fatalf("refresh-family replay did not revoke the replacement: %d %s", revokedDescendant.Code, revokedDescendant.Body.String())
	}
}

func TestSupabaseRefreshProxyValidatesMembership(t *testing.T) {
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/auth/v1/token" || r.URL.Query().Get("grant_type") != "refresh_token" {
			http.Error(w, "unexpected route", http.StatusNotFound)
			return
		}
		var payload map[string]string
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil || payload["refresh_token"] != "supabase-refresh-token" {
			http.Error(w, "invalid refresh", http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"access_token":"supabase-access-new","refresh_token":"supabase-refresh-new","expires_in":3600,"user":{"id":"external-refresh-user","email":"member@example.com"}}`))
	}))
	defer provider.Close()
	server, dataStore := newTestServer(t)
	server.supabase = supabase.New(provider.URL, "anon-key")
	now := time.Now().UTC()
	if err := dataStore.Update(func(state *model.State) error {
		state.Accounts = append(state.Accounts, model.Account{ID: "org_supabase_refresh", Name: "Supabase", CreatedAt: now, UpdatedAt: now})
		state.Users = append(state.Users, model.User{ID: "usr_supabase_refresh", AccountID: "org_supabase_refresh", ExternalAuthID: "external-refresh-user", Name: "Member", Email: "member@example.com", Role: "owner", CreatedAt: now, UpdatedAt: now})
		return nil
	}); err != nil {
		t.Fatalf("seed Supabase membership: %v", err)
	}
	response := performJSON(t, server.Handler(), http.MethodPost, "/v1/auth/refresh", "", "http://localhost:3000", map[string]any{"refresh_token": "supabase-refresh-token"})
	data := dataFrom(t, response, http.StatusOK)
	if data["access_token"] != "supabase-access-new" || data["refresh_token"] != "supabase-refresh-new" || data["expires_in"] != float64(3600) {
		t.Fatalf("unexpected Supabase refresh response: %#v", data)
	}
}

func TestSupabaseAndGoogleTokenFamiliesCoexist(t *testing.T) {
	tokenGrantCalls := 0
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/auth/v1/user":
			if r.Header.Get("Authorization") != "Bearer supabase-access-token" {
				http.Error(w, `{"msg":"invalid token"}`, http.StatusUnauthorized)
				return
			}
			_, _ = w.Write([]byte(`{"id":"external-mixed-user","email":"mixed@example.com"}`))
		case "/auth/v1/token":
			tokenGrantCalls++
			http.Error(w, `{"msg":"local refresh token leaked upstream"}`, http.StatusUnauthorized)
		default:
			http.NotFound(w, r)
		}
	}))
	defer provider.Close()
	server, dataStore := newTestServer(t)
	server.supabase = supabase.New(provider.URL, "anon-key")
	server.google = fakeGoogleVerifier{claims: googleauth.Claims{Subject: "mixed-google-subject", Email: "google.mixed@example.com", Name: "Google Mixed"}}
	now := time.Now().UTC()
	account := model.Account{ID: "org_mixed_auth", Name: "Mixed", CreatedAt: now, UpdatedAt: now}
	user := model.User{ID: "usr_mixed_auth", AccountID: account.ID, ExternalAuthID: "external-mixed-user", Name: "Mixed", Email: "mixed@example.com", Role: "owner", CreatedAt: now, UpdatedAt: now}
	if err := dataStore.Update(func(state *model.State) error {
		state.Accounts = append(state.Accounts, account)
		state.Users = append(state.Users, user)
		return nil
	}); err != nil {
		t.Fatalf("seed mixed auth: %v", err)
	}
	me := performJSON(t, server.Handler(), http.MethodGet, "/v1/me", "supabase-access-token", "http://localhost:3000", nil)
	dataFrom(t, me, http.StatusOK)
	googleSession := performJSON(t, server.Handler(), http.MethodPost, "/v1/auth/google", "", "http://localhost:3000", map[string]any{"credential": "mixed-google-credential"})
	googleData := dataFrom(t, googleSession, http.StatusOK)
	localRefresh, _ := googleData["refresh_token"].(string)
	if !strings.HasPrefix(localRefresh, localRefreshPrefix) {
		t.Fatalf("Google session did not use a versioned local refresh token: %q", localRefresh)
	}
	refreshed := performJSON(t, server.Handler(), http.MethodPost, "/v1/auth/refresh", "", "http://localhost:3000", map[string]any{"refresh_token": localRefresh})
	dataFrom(t, refreshed, http.StatusOK)
	if tokenGrantCalls != 0 {
		t.Fatalf("local Google refresh token was sent to Supabase %d times", tokenGrantCalls)
	}
}

func TestGoogleSignInLinksOnlyAuthoritativeExistingEmail(t *testing.T) {
	server, dataStore := newTestServer(t)
	now := time.Now().UTC()
	gmailAccount := model.Account{ID: "org_google_gmail", Name: "Gmail", CreatedAt: now, UpdatedAt: now}
	gmailUser := model.User{ID: "usr_google_gmail", AccountID: gmailAccount.ID, Name: "Gmail Owner", Email: "owner@gmail.com", PasswordHash: "existing-password-hash", Role: "owner", CreatedAt: now, UpdatedAt: now}
	consumerAccount := model.Account{ID: "org_google_consumer", Name: "Consumer", CreatedAt: now, UpdatedAt: now}
	consumerUser := model.User{ID: "usr_google_consumer", AccountID: consumerAccount.ID, Name: "Consumer", Email: "person@example.com", PasswordHash: "existing-password-hash", Role: "owner", CreatedAt: now, UpdatedAt: now}
	if err := dataStore.Update(func(state *model.State) error {
		state.Accounts = append(state.Accounts, gmailAccount, consumerAccount)
		state.Users = append(state.Users, gmailUser, consumerUser)
		return nil
	}); err != nil {
		t.Fatalf("seed Google link accounts: %v", err)
	}
	server.google = fakeGoogleVerifier{claims: googleauth.Claims{Subject: "google-gmail-subject", Email: "owner@gmail.com", Name: "Gmail Owner"}}
	linked := performJSON(t, server.Handler(), http.MethodPost, "/v1/auth/google", "", "http://localhost:3000", map[string]any{"credential": "signed-google-id-token"})
	linkedData := dataFrom(t, linked, http.StatusOK)
	if linkedData["access_token"] == "" || linkedData["refresh_token"] == "" || linkedData["verification_required"] != false {
		t.Fatalf("Google link did not issue a standard session: %#v", linkedData)
	}
	_ = dataStore.View(func(state *model.State) error {
		stored, _ := findUser(state, gmailUser.ID)
		if stored.GoogleSubject != "google-gmail-subject" || stored.PasswordHash == "" {
			t.Fatalf("Google link did not preserve password identity: %#v", stored)
		}
		return nil
	})

	server.google = fakeGoogleVerifier{claims: googleauth.Claims{Subject: "different-google-subject", Email: "owner@gmail.com", Name: "Other"}}
	conflict := performJSON(t, server.Handler(), http.MethodPost, "/v1/auth/google", "", "http://localhost:3000", map[string]any{"credential": "other-signed-token"})
	if conflict.Code != http.StatusConflict || !strings.Contains(conflict.Body.String(), "identity_conflict") {
		t.Fatalf("different Google subject reused a linked email: %d %s", conflict.Code, conflict.Body.String())
	}

	server.google = fakeGoogleVerifier{claims: googleauth.Claims{Subject: "consumer-google-subject", Email: "person@example.com", Name: "Consumer"}}
	linkRequired := performJSON(t, server.Handler(), http.MethodPost, "/v1/auth/google", "", "http://localhost:3000", map[string]any{"credential": "consumer-signed-token"})
	if linkRequired.Code != http.StatusConflict || !strings.Contains(linkRequired.Body.String(), "account_link_required") {
		t.Fatalf("non-authoritative email silently linked: %d %s", linkRequired.Code, linkRequired.Body.String())
	}
	consumerToken, err := server.issueToken(consumerUser)
	if err != nil {
		t.Fatalf("issue consumer token: %v", err)
	}
	linkedConsumer := performJSON(t, server.Handler(), http.MethodPost, "/v1/auth/google/link", consumerToken, "http://localhost:3000", map[string]any{"credential": "consumer-signed-token"})
	linkedConsumerData := dataFrom(t, linkedConsumer, http.StatusOK)
	if linkedConsumerData["linked"] != true || linkedConsumerData["provider"] != "google" {
		t.Fatalf("authenticated Google link returned %#v", linkedConsumerData)
	}
	_ = dataStore.View(func(state *model.State) error {
		stored, _ := findUser(state, consumerUser.ID)
		if stored.GoogleSubject != "consumer-google-subject" {
			t.Fatalf("authenticated link did not persist subject: %#v", stored)
		}
		return nil
	})
}

func TestGoogleSignInCreatesNewIdentityBySubject(t *testing.T) {
	server, dataStore := newTestServer(t)
	server.google = fakeGoogleVerifier{claims: googleauth.Claims{Subject: "new-google-subject", Email: "new.person@example.com", Name: "New Person"}}
	response := performJSON(t, server.Handler(), http.MethodPost, "/v1/auth/google", "", "http://localhost:3000", map[string]any{"credential": "new-signed-token"})
	dataFrom(t, response, http.StatusOK)
	_ = dataStore.View(func(state *model.State) error {
		found := false
		for _, user := range state.Users {
			if user.GoogleSubject == "new-google-subject" && user.Email == "new.person@example.com" {
				found = true
			}
		}
		if !found {
			t.Fatal("new Google user was not persisted by provider subject")
		}
		return nil
	})
}

func TestWidgetCORSAllowsHostOriginWithoutCredentials(t *testing.T) {
	server, dataStore := newTestServer(t)
	now := time.Now().UTC()
	err := dataStore.Update(func(state *model.State) error {
		state.Accounts = append(state.Accounts, model.Account{ID: "org_1", Name: "Acme", Plan: "starter_17", BillingStatus: "active", CreatedAt: now, UpdatedAt: now})
		state.Agents = append(state.Agents, model.Agent{ID: "agt_1", AccountID: "org_1", PublicKey: "pub_live_test", Name: "Acme", Status: "published", Branding: model.BrandingConfig{PrimaryColor: "#111827", AccentColor: "#F97316", Position: "bottom_right", AllowedDomains: []string{"customer.example"}}, CreatedAt: now, UpdatedAt: now})
		return nil
	})
	if err != nil {
		t.Fatalf("seed data: %v", err)
	}
	request := httptest.NewRequest(http.MethodOptions, "/widget/v1/sessions", nil)
	request.Header.Set("Origin", "https://customer.example")
	request.Header.Set("Access-Control-Request-Method", "POST")
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusNoContent {
		t.Fatalf("expected preflight 204, got %d", response.Code)
	}
	if got := response.Header().Get("Access-Control-Allow-Origin"); got != "https://customer.example" {
		t.Fatalf("unexpected allowed origin %q", got)
	}
	if got := response.Header().Get("Access-Control-Allow-Credentials"); got != "" {
		t.Fatalf("widget CORS must not enable credentials, got %q", got)
	}
}

func TestPortalCORSAllowsIdempotencyAndRevisionHeaders(t *testing.T) {
	server, _ := newTestServer(t)
	request := httptest.NewRequest(http.MethodOptions, "/v1/billing/checkout", nil)
	request.Header.Set("Origin", "http://localhost:3000")
	request.Header.Set("Access-Control-Request-Method", "POST")
	request.Header.Set("Access-Control-Request-Headers", "idempotency-key,if-match,x-organization-id")
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusNoContent {
		t.Fatalf("expected preflight 204, got %d", response.Code)
	}
	allowed := response.Header().Get("Access-Control-Allow-Headers")
	for _, header := range []string{"Idempotency-Key", "If-Match", "X-Organization-ID"} {
		if !strings.Contains(allowed, header) {
			t.Fatalf("CORS headers %q do not include %s", allowed, header)
		}
	}
	if response.Header().Get("Access-Control-Allow-Credentials") != "true" {
		t.Fatal("portal CORS must allow credentials for the configured origin")
	}
}

func TestProductionPublishRequiresAndCanPatchAllowedDomain(t *testing.T) {
	server, dataStore := newTestServer(t)
	server.cfg.DemoMode = false
	now := time.Now().UTC()
	account := model.Account{ID: "org_production", Name: "Production", Plan: "starter_17", BillingStatus: "active", CreatedAt: now, UpdatedAt: now}
	user := model.User{ID: "usr_owner", AccountID: account.ID, Name: "Owner", Email: "owner@example.com", Role: "owner", CreatedAt: now, UpdatedAt: now}
	agent := model.Agent{
		ID: "agt_production", AccountID: account.ID, Name: "Website assistant", PublicKey: "pub_live_production", Status: "draft", Revision: 1,
		LeadCapture: model.LeadCaptureConfig{Enabled: true, AfterTurns: 3},
		Branding:    model.BrandingConfig{PrimaryColor: "#111827", AccentColor: "#F97316", Position: "bottom_right"},
		CreatedAt:   now, UpdatedAt: now,
	}
	if err := dataStore.Update(func(state *model.State) error {
		state.Accounts = append(state.Accounts, account)
		state.Users = append(state.Users, user)
		state.Agents = append(state.Agents, agent)
		state.Subscriptions = append(state.Subscriptions, model.Subscription{ID: "sub_production", AccountID: account.ID, Status: "active", Plan: "starter_17", CreatedAt: now, UpdatedAt: now})
		return nil
	}); err != nil {
		t.Fatalf("seed production data: %v", err)
	}
	token, err := server.issueToken(user)
	if err != nil {
		t.Fatalf("issue token: %v", err)
	}
	handler := server.Handler()
	blocked := performJSON(t, handler, http.MethodPost, "/v1/agents/"+agent.ID+"/publish", token, "http://localhost:3000", nil)
	if blocked.Code != http.StatusUnprocessableEntity {
		t.Fatalf("publish without a domain returned %d: %s", blocked.Code, blocked.Body.String())
	}
	patched := performJSON(t, handler, http.MethodPatch, "/v1/agents/"+agent.ID, token, "http://localhost:3000", map[string]any{
		"branding": map[string]any{"allowed_domains": []string{"customer.example"}},
	})
	dataFrom(t, patched, http.StatusOK)
	published := performJSON(t, handler, http.MethodPost, "/v1/agents/"+agent.ID+"/publish", token, "http://localhost:3000", nil)
	dataFrom(t, published, http.StatusOK)
}

func TestPublishedAgentQuotaIsEnforced(t *testing.T) {
	server, dataStore := newTestServer(t)
	now := time.Now().UTC()
	account := model.Account{ID: "org_quota", Name: "Quota workspace", BillingStatus: "active", CreatedAt: now, UpdatedAt: now}
	user := model.User{ID: "usr_quota", AccountID: account.ID, Name: "Owner", Email: "quota@example.com", Role: "owner", CreatedAt: now, UpdatedAt: now}
	candidate := model.Agent{ID: "agt_candidate", AccountID: account.ID, Name: "Candidate", PublicKey: "pub_candidate", Status: "draft", Revision: 1, Branding: model.BrandingConfig{PrimaryColor: "#111827", AccentColor: "#F97316", Position: "bottom_right"}, CreatedAt: now, UpdatedAt: now}
	if err := dataStore.Update(func(state *model.State) error {
		state.Accounts = append(state.Accounts, account)
		state.Users = append(state.Users, user)
		state.Agents = append(state.Agents, candidate)
		for index := 0; index < config.StarterPublishedAgentLimit; index++ {
			state.Agents = append(state.Agents, model.Agent{ID: fmt.Sprintf("agt_live_%d", index), AccountID: account.ID, Name: "Live", PublicKey: fmt.Sprintf("pub_live_%d", index), Status: "published", Revision: 1, Branding: model.BrandingConfig{PrimaryColor: "#111827", AccentColor: "#F97316", Position: "bottom_right"}, CreatedAt: now, UpdatedAt: now})
		}
		return nil
	}); err != nil {
		t.Fatalf("seed agent quota: %v", err)
	}
	token, err := server.issueToken(user)
	if err != nil {
		t.Fatalf("issue token: %v", err)
	}
	response := performJSON(t, server.Handler(), http.MethodPost, "/v1/agents/"+candidate.ID+"/publish", token, "http://localhost:3000", nil)
	if response.Code != http.StatusConflict || !strings.Contains(response.Body.String(), "published_agent_limit_reached") {
		t.Fatalf("expected published-agent quota conflict, got %d: %s", response.Code, response.Body.String())
	}
	_ = dataStore.View(func(state *model.State) error {
		agent, _ := findAgent(state, account.ID, candidate.ID)
		if agent.Status != "draft" {
			t.Fatalf("quota failure mutated candidate status to %q", agent.Status)
		}
		return nil
	})
}

func TestConversationQuotaBlocksNewButAllowsResume(t *testing.T) {
	server, dataStore := newTestServer(t)
	now := time.Now().UTC()
	account := model.Account{ID: "org_conversation_quota", Name: "Conversation quota", BillingStatus: "active", CreatedAt: now, UpdatedAt: now}
	agent := model.Agent{ID: "agt_conversation_quota", AccountID: account.ID, Name: "Assistant", PublicKey: "pub_conversation_quota", Status: "published", Branding: model.BrandingConfig{PrimaryColor: "#111827", AccentColor: "#F97316", Position: "bottom_right"}, CreatedAt: now, UpdatedAt: now}
	visitorToken := "visitor-token-with-more-than-thirty-two-characters"
	visitorID := "vst_" + security.HashScopedToken([]byte(server.cfg.VisitorHMACKey), agent.ID, visitorToken)
	startedAt := now.Add(-time.Hour)
	if err := dataStore.Update(func(state *model.State) error {
		state.Accounts = append(state.Accounts, account)
		state.Agents = append(state.Agents, agent)
		for index := 0; index < config.StarterMonthlyConversationLimit; index++ {
			session := model.Session{ID: fmt.Sprintf("cvs_quota_%d", index), AccountID: account.ID, AgentID: agent.ID, VisitorID: fmt.Sprintf("vst_%d", index), StartedAt: &startedAt, CreatedAt: now.Add(-time.Hour), UpdatedAt: now.Add(-time.Hour), LastSeenAt: now.Add(-time.Hour)}
			if index == 0 {
				session.VisitorID = visitorID
				session.MemoryConsent = true
			}
			state.Sessions = append(state.Sessions, session)
		}
		return nil
	}); err != nil {
		t.Fatalf("seed conversation quota: %v", err)
	}
	handler := server.Handler()
	bootstrap := performJSON(t, handler, http.MethodPost, "/widget/v1/sessions", "", "http://localhost:3000", map[string]any{"agent_key": agent.PublicKey, "consent": map[string]bool{"memory": false}})
	bootstrapData := dataFrom(t, bootstrap, http.StatusCreated)
	blockedRequest := httptest.NewRequest(http.MethodPost, "/widget/v1/sessions/"+bootstrapData["session_id"].(string)+"/messages", bytes.NewBufferString(`{"client_message_id":"new-over-limit","content":"Hello"}`))
	blockedRequest.Header.Set("Content-Type", "application/json")
	blockedRequest.Header.Set("Origin", "http://localhost:3000")
	blockedRequest.Header.Set("X-Garuda-Session-Token", bootstrapData["session_token"].(string))
	blocked := httptest.NewRecorder()
	handler.ServeHTTP(blocked, blockedRequest)
	if blocked.Code != http.StatusTooManyRequests || !strings.Contains(blocked.Body.String(), "conversation_limit_reached") {
		t.Fatalf("expected first message to enforce conversation quota, got %d: %s", blocked.Code, blocked.Body.String())
	}
	resumed := performJSON(t, handler, http.MethodPost, "/widget/v1/sessions", "", "http://localhost:3000", map[string]any{"agent_key": agent.PublicKey, "visitor_token": visitorToken, "consent": map[string]bool{"memory": true}})
	data := dataFrom(t, resumed, http.StatusCreated)
	conversation, _ := data["conversation"].(map[string]any)
	if resumedValue, _ := conversation["resumed"].(bool); !resumedValue {
		t.Fatal("valid returning visitor was not resumed at the conversation quota")
	}
	resumeMessage := httptest.NewRequest(http.MethodPost, "/widget/v1/sessions/"+data["session_id"].(string)+"/messages", bytes.NewBufferString(`{"client_message_id":"resumed-at-limit","content":"Hello again"}`))
	resumeMessage.Header.Set("Content-Type", "application/json")
	resumeMessage.Header.Set("Origin", "http://localhost:3000")
	resumeMessage.Header.Set("X-Garuda-Session-Token", data["session_token"].(string))
	resumeResponse := httptest.NewRecorder()
	handler.ServeHTTP(resumeResponse, resumeMessage)
	dataFrom(t, resumeResponse, http.StatusCreated)
}

func TestUntouchedWidgetBootstrapsDoNotConsumeConversationQuota(t *testing.T) {
	server, dataStore := newTestServer(t)
	now := time.Now().UTC()
	account := model.Account{ID: "org_unengaged", Name: "Unengaged", BillingStatus: "active", CreatedAt: now, UpdatedAt: now}
	user := model.User{ID: "usr_unengaged", AccountID: account.ID, Name: "Owner", Email: "unengaged@example.com", Role: "owner", CreatedAt: now, UpdatedAt: now}
	agent := model.Agent{ID: "agt_unengaged", AccountID: account.ID, Name: "Assistant", PublicKey: "pub_unengaged", Status: "published", CreatedAt: now, UpdatedAt: now}
	if err := dataStore.Update(func(state *model.State) error {
		state.Accounts = append(state.Accounts, account)
		state.Users = append(state.Users, user)
		state.Agents = append(state.Agents, agent)
		for index := 0; index < config.StarterMonthlyConversationLimit+25; index++ {
			state.Sessions = append(state.Sessions, model.Session{ID: fmt.Sprintf("cvs_unengaged_%d", index), AccountID: account.ID, AgentID: agent.ID, VisitorID: fmt.Sprintf("vst_unengaged_%d", index), CreatedAt: now, UpdatedAt: now, LastSeenAt: now})
		}
		return nil
	}); err != nil {
		t.Fatalf("seed untouched bootstraps: %v", err)
	}
	portalToken, err := server.issueToken(user)
	if err != nil {
		t.Fatalf("issue portal token: %v", err)
	}
	handler := server.Handler()
	bootstrap := performJSON(t, handler, http.MethodPost, "/widget/v1/sessions", "", "http://localhost:3000", map[string]any{"agent_key": agent.PublicKey, "consent": map[string]bool{"memory": false}})
	data := dataFrom(t, bootstrap, http.StatusCreated)
	message := httptest.NewRequest(http.MethodPost, "/widget/v1/sessions/"+data["session_id"].(string)+"/messages", bytes.NewBufferString(`{"client_message_id":"first-real-engagement","content":"Hello"}`))
	message.Header.Set("Content-Type", "application/json")
	message.Header.Set("Origin", "http://localhost:3000")
	message.Header.Set("X-Garuda-Session-Token", data["session_token"].(string))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, message)
	dataFrom(t, response, http.StatusCreated)
	_ = dataStore.View(func(state *model.State) error {
		engaged := 0
		for _, session := range state.Sessions {
			if session.AccountID == account.ID && session.StartedAt != nil {
				engaged++
			}
		}
		if engaged != 1 {
			t.Fatalf("expected one engaged conversation, got %d", engaged)
		}
		return nil
	})
	dashboard := performJSON(t, handler, http.MethodGet, "/v1/dashboard", portalToken, "http://localhost:3000", nil)
	metrics, _ := dataFrom(t, dashboard, http.StatusOK)["metrics"].(map[string]any)
	if metrics["conversations"] != float64(1) {
		t.Fatalf("dashboard counted untouched bootstraps: %#v", metrics)
	}
	conversationResponse := performJSON(t, handler, http.MethodGet, "/v1/conversations", portalToken, "http://localhost:3000", nil)
	if conversationResponse.Code != http.StatusOK {
		t.Fatalf("list conversations returned %d: %s", conversationResponse.Code, conversationResponse.Body.String())
	}
	var envelope struct {
		Data []map[string]any `json:"data"`
		Meta map[string]any   `json:"meta"`
	}
	if err := json.Unmarshal(conversationResponse.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode conversation list: %v", err)
	}
	if len(envelope.Data) != 1 || envelope.Meta["total"] != float64(1) {
		t.Fatalf("conversation list counted untouched bootstraps: data=%d meta=%#v", len(envelope.Data), envelope.Meta)
	}
}

func TestWidgetLeadIdempotencyCannotCrossSessions(t *testing.T) {
	server, dataStore := newTestServer(t)
	now := time.Now().UTC()
	firstToken := "first-session-secret"
	secondToken := "second-session-secret"
	if err := dataStore.Update(func(state *model.State) error {
		state.Sessions = append(state.Sessions,
			model.Session{ID: "cvs_first", AccountID: "org_leads", AgentID: "agt_leads", VisitorID: "vst_first", Origin: "http://localhost:3000", SessionTokenHash: security.HashOpaqueToken(firstToken), ExpiresAt: now.Add(time.Hour), CreatedAt: now, UpdatedAt: now, LastSeenAt: now},
			model.Session{ID: "cvs_second", AccountID: "org_leads", AgentID: "agt_leads", VisitorID: "vst_second", Origin: "http://localhost:3000", SessionTokenHash: security.HashOpaqueToken(secondToken), ExpiresAt: now.Add(time.Hour), CreatedAt: now, UpdatedAt: now, LastSeenAt: now},
		)
		return nil
	}); err != nil {
		t.Fatalf("seed lead sessions: %v", err)
	}
	submit := func(sessionID, token, name string) map[string]any {
		request := httptest.NewRequest(http.MethodPost, "/widget/v1/sessions/"+sessionID+"/leads", bytes.NewBufferString(fmt.Sprintf(`{"client_capture_id":"same-capture","fields":{"name":%q,"email":"victim@example.com"},"consent":{"granted":true,"notice_version":"v1"}}`, name)))
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("Origin", "http://localhost:3000")
		request.Header.Set("X-Garuda-Session-Token", token)
		response := httptest.NewRecorder()
		server.Handler().ServeHTTP(response, request)
		return dataFrom(t, response, http.StatusCreated)
	}
	first := submit("cvs_first", firstToken, "Original visitor")
	second := submit("cvs_second", secondToken, "Other visitor")
	if first["lead_id"] == second["lead_id"] {
		t.Fatalf("cross-session capture disclosed/reused lead ID %v", first["lead_id"])
	}
	_ = dataStore.View(func(state *model.State) error {
		if len(state.Leads) != 2 {
			t.Fatalf("expected separate leads per public session, got %d", len(state.Leads))
		}
		if state.Leads[0].Name != "Original visitor" || state.Leads[0].SessionID != "cvs_first" {
			t.Fatalf("first visitor lead was overwritten: %#v", state.Leads[0])
		}
		return nil
	})
}

func TestWidgetMessageRetryFindsCorrelatedReplyAcrossInterleaving(t *testing.T) {
	server, dataStore := newTestServer(t)
	now := time.Now().UTC()
	sessionToken := "widget-retry-session-secret"
	account := model.Account{ID: "org_widget_retry", Name: "Widget retry", BillingStatus: "active", CreatedAt: now, UpdatedAt: now}
	agent := model.Agent{ID: "agt_widget_retry", AccountID: account.ID, Name: "Assistant", PublicKey: "pub_widget_retry", Status: "published", CreatedAt: now, UpdatedAt: now}
	session := model.Session{ID: "cvs_widget_retry", AccountID: account.ID, AgentID: agent.ID, VisitorID: "vst_widget_retry", Origin: "http://localhost:3000", SessionTokenHash: security.HashOpaqueToken(sessionToken), ExpiresAt: now.Add(time.Hour), CreatedAt: now, UpdatedAt: now, LastSeenAt: now}
	if err := dataStore.Update(func(state *model.State) error {
		state.Accounts = append(state.Accounts, account)
		state.Agents = append(state.Agents, agent)
		state.Sessions = append(state.Sessions, session)
		state.Messages = append(state.Messages,
			model.Message{ID: "client_turn_1", AccountID: account.ID, AgentID: agent.ID, SessionID: session.ID, VisitorID: session.VisitorID, Role: "user", Content: "Hello", CreatedAt: now},
			model.Message{ID: "interleaved", AccountID: "org_other", AgentID: "agt_other", SessionID: "cvs_other", VisitorID: "vst_other", Role: "user", Content: "Other request", CreatedAt: now.Add(time.Millisecond)},
			model.Message{ID: "assistant_turn_1", AccountID: account.ID, AgentID: agent.ID, SessionID: session.ID, VisitorID: session.VisitorID, Role: "assistant", Content: "Welcome back", Metadata: map[string]any{"reply_to_client_message_id": "client_turn_1"}, CreatedAt: now.Add(2 * time.Millisecond)},
		)
		return nil
	}); err != nil {
		t.Fatalf("seed interleaved messages: %v", err)
	}
	request := httptest.NewRequest(http.MethodPost, "/widget/v1/sessions/"+session.ID+"/messages", bytes.NewBufferString(`{"client_message_id":"client_turn_1","content":"Hello"}`))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", session.Origin)
	request.Header.Set("X-Garuda-Session-Token", sessionToken)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	data := dataFrom(t, response, http.StatusCreated)
	assistant, _ := data["assistant_message"].(map[string]any)
	if assistant["id"] != "assistant_turn_1" {
		t.Fatalf("retry did not return its correlated assistant: %#v", assistant)
	}
	_ = dataStore.View(func(state *model.State) error {
		if len(state.Messages) != 3 {
			t.Fatalf("idempotent retry appended messages: %d", len(state.Messages))
		}
		return nil
	})
}

func TestKnowledgeSourceDeleteKeepsRetryStateUntilVectorsAreRemoved(t *testing.T) {
	server, dataStore := newTestServer(t)
	now := time.Now().UTC()
	account := model.Account{ID: "org_rag_delete", Name: "RAG delete", BillingStatus: "active", CreatedAt: now, UpdatedAt: now}
	user := model.User{ID: "usr_rag_delete", AccountID: account.ID, Name: "Owner", Email: "rag-delete@example.com", Role: "owner", CreatedAt: now, UpdatedAt: now}
	source := model.KnowledgeItem{ID: "src_rag_delete", Type: "text", Status: "ready", Title: "FAQ", Content: "Private product facts", CreatedAt: now}
	agent := model.Agent{ID: "agt_rag_delete", AccountID: account.ID, Name: "Assistant", Status: "draft", Revision: 1, Knowledge: []model.KnowledgeItem{source}, CreatedAt: now, UpdatedAt: now}
	if err := dataStore.Update(func(state *model.State) error {
		state.Accounts = append(state.Accounts, account)
		state.Users = append(state.Users, user)
		state.Agents = append(state.Agents, agent)
		return nil
	}); err != nil {
		t.Fatalf("seed RAG source: %v", err)
	}
	token, err := server.issueToken(user)
	if err != nil {
		t.Fatalf("issue token: %v", err)
	}

	edgeCalls := 0
	failingEdge := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		edgeCalls++
		var payload map[string]any
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil || payload["action"] != "delete" || payload["source_id"] != source.ID {
			http.Error(w, "invalid delete payload", http.StatusBadRequest)
			return
		}
		http.Error(w, `{"error":"embedding store unavailable"}`, http.StatusServiceUnavailable)
	}))
	server.rag = rag.New(failingEdge.URL, "rag-delete-test-secret")
	if err := dataStore.Update(func(state *model.State) error {
		stored, _ := findAgent(state, account.ID, agent.ID)
		stored.Knowledge[0].Status = "processing"
		return nil
	}); err != nil {
		t.Fatalf("mark source processing: %v", err)
	}
	processing := performJSON(t, server.Handler(), http.MethodDelete, "/v1/agents/"+agent.ID+"/sources/"+source.ID, token, "http://localhost:3000", nil)
	if processing.Code != http.StatusConflict || !strings.Contains(processing.Body.String(), "source_processing") || edgeCalls != 0 {
		t.Fatalf("processing source deletion was not serialized: status=%d calls=%d body=%s", processing.Code, edgeCalls, processing.Body.String())
	}
	if err := dataStore.Update(func(state *model.State) error {
		stored, _ := findAgent(state, account.ID, agent.ID)
		stored.Knowledge[0].Status = "ready"
		return nil
	}); err != nil {
		t.Fatalf("mark source ready: %v", err)
	}
	failed := performJSON(t, server.Handler(), http.MethodDelete, "/v1/agents/"+agent.ID+"/sources/"+source.ID, token, "http://localhost:3000", nil)
	failingEdge.Close()
	if failed.Code != http.StatusServiceUnavailable || !strings.Contains(failed.Body.String(), "rag_deletion_failed") {
		t.Fatalf("expected retryable RAG deletion failure, got %d: %s", failed.Code, failed.Body.String())
	}
	_ = dataStore.View(func(state *model.State) error {
		stored, _ := findAgent(state, account.ID, agent.ID)
		if stored == nil || len(stored.Knowledge) != 1 || stored.Knowledge[0].ID != source.ID {
			t.Fatalf("failed vector deletion lost its local retry state: %#v", stored)
		}
		return nil
	})

	successEdge := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = dataStore.View(func(state *model.State) error {
			stored, _ := findAgent(state, account.ID, agent.ID)
			if stored == nil || len(stored.Knowledge) != 1 {
				t.Error("local source was removed before the remote vector delete")
			}
			return nil
		})
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"deleted"}`))
	}))
	defer successEdge.Close()
	server.rag = rag.New(successEdge.URL, "rag-delete-test-secret")
	deleted := performJSON(t, server.Handler(), http.MethodDelete, "/v1/agents/"+agent.ID+"/sources/"+source.ID, token, "http://localhost:3000", nil)
	if deleted.Code != http.StatusNoContent {
		t.Fatalf("expected successful retry to return 204, got %d: %s", deleted.Code, deleted.Body.String())
	}
	_ = dataStore.View(func(state *model.State) error {
		stored, _ := findAgent(state, account.ID, agent.ID)
		if stored == nil || len(stored.Knowledge) != 0 {
			t.Fatalf("successful vector deletion did not remove local source: %#v", stored)
		}
		return nil
	})
}

func TestKnowledgeSourceDeleteCannotRaceActiveIngest(t *testing.T) {
	server, dataStore := newTestServer(t)
	now := time.Now().UTC()
	account := model.Account{ID: "org_rag_race", Name: "RAG race", BillingStatus: "active", CreatedAt: now, UpdatedAt: now}
	user := model.User{ID: "usr_rag_race", AccountID: account.ID, Name: "Owner", Email: "rag-race@example.com", Role: "owner", CreatedAt: now, UpdatedAt: now}
	agent := model.Agent{ID: "agt_rag_race", AccountID: account.ID, Name: "Assistant", Status: "draft", Revision: 1, CreatedAt: now, UpdatedAt: now}
	if err := dataStore.Update(func(state *model.State) error {
		state.Accounts = append(state.Accounts, account)
		state.Users = append(state.Users, user)
		state.Agents = append(state.Agents, agent)
		return nil
	}); err != nil {
		t.Fatalf("seed RAG race: %v", err)
	}
	token, err := server.issueToken(user)
	if err != nil {
		t.Fatalf("issue token: %v", err)
	}
	ingestStarted := make(chan struct{})
	releaseIngest := make(chan struct{})
	deleteCalled := make(chan struct{}, 1)
	var releaseOnce sync.Once
	release := func() { releaseOnce.Do(func() { close(releaseIngest) }) }
	t.Cleanup(release)
	edge := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload map[string]any
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			http.Error(w, `{"error":"invalid payload"}`, http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if payload["action"] == "delete" {
			deleteCalled <- struct{}{}
			_, _ = w.Write([]byte(`{"status":"deleted"}`))
			return
		}
		close(ingestStarted)
		<-releaseIngest
		_, _ = w.Write([]byte(`{"status":"ready"}`))
	}))
	defer edge.Close()
	defer release()
	server.rag = rag.New(edge.URL, "rag-race-test-secret")
	handler := server.Handler()
	createRequest := httptest.NewRequest(http.MethodPost, "/v1/agents/"+agent.ID+"/sources", bytes.NewBufferString(`{"type":"text","name":"FAQ","text":"We are open from nine to five."}`))
	createRequest.Header.Set("Authorization", "Bearer "+token)
	createRequest.Header.Set("Content-Type", "application/json")
	createRequest.Header.Set("Origin", "http://localhost:3000")
	createResponse := httptest.NewRecorder()
	createDone := make(chan struct{})
	go func() {
		handler.ServeHTTP(createResponse, createRequest)
		close(createDone)
	}()
	select {
	case <-ingestStarted:
	case <-time.After(2 * time.Second):
		t.Fatal("RAG ingest did not start")
	}
	var sourceID string
	_ = dataStore.View(func(state *model.State) error {
		stored, _ := findAgent(state, account.ID, agent.ID)
		if stored != nil && len(stored.Knowledge) == 1 {
			sourceID = stored.Knowledge[0].ID
		}
		return nil
	})
	if sourceID == "" {
		t.Fatal("processing source was not persisted before ingest")
	}
	blocked := performJSON(t, handler, http.MethodDelete, "/v1/agents/"+agent.ID+"/sources/"+sourceID, token, "http://localhost:3000", nil)
	if blocked.Code != http.StatusConflict || !strings.Contains(blocked.Body.String(), "source_processing") {
		t.Fatalf("concurrent delete was not blocked: %d %s", blocked.Code, blocked.Body.String())
	}
	if len(deleteCalled) != 0 {
		t.Fatal("Edge delete ran while ingest was active")
	}
	release()
	select {
	case <-createDone:
	case <-time.After(2 * time.Second):
		t.Fatal("RAG ingest did not finish")
	}
	dataFrom(t, createResponse, http.StatusCreated)
	deleted := performJSON(t, handler, http.MethodDelete, "/v1/agents/"+agent.ID+"/sources/"+sourceID, token, "http://localhost:3000", nil)
	if deleted.Code != http.StatusNoContent {
		t.Fatalf("delete after ingest returned %d: %s", deleted.Code, deleted.Body.String())
	}
	if len(deleteCalled) != 1 {
		t.Fatal("Edge delete did not run after ingest completed")
	}
}

func TestRAGChunksAreAllowListedToCurrentReadySources(t *testing.T) {
	server, dataStore := newTestServer(t)
	now := time.Now().UTC()
	if err := dataStore.Update(func(state *model.State) error {
		state.Agents = append(state.Agents, model.Agent{
			ID: "agt_rag_filter", AccountID: "org_rag_filter", Name: "Assistant", Status: "published", CreatedAt: now, UpdatedAt: now,
			Knowledge: []model.KnowledgeItem{
				{ID: "src_ready", Status: "ready", Title: "Ready", CreatedAt: now},
				{ID: "src_failed", Status: "failed", Title: "Failed", CreatedAt: now},
			},
		})
		return nil
	}); err != nil {
		t.Fatalf("seed RAG filter: %v", err)
	}
	filtered := server.filterReadyRAGChunks("org_rag_filter", "agt_rag_filter", []rag.Chunk{
		{ID: "chk_ready", SourceID: "src_ready", Content: "allowed"},
		{ID: "chk_failed", SourceID: "src_failed", Content: "must not be used"},
		{ID: "chk_orphan", SourceID: "src_deleted", Content: "must not be used"},
	})
	if len(filtered) != 1 || filtered[0].SourceID != "src_ready" {
		t.Fatalf("stale RAG chunks passed the ready-source allow-list: %#v", filtered)
	}
}

func TestAgentWritesRejectRawKnowledgeMutation(t *testing.T) {
	server, dataStore := newTestServer(t)
	now := time.Now().UTC()
	account := model.Account{ID: "org_source_boundary", Name: "Source boundary", BillingStatus: "active", CreatedAt: now, UpdatedAt: now}
	user := model.User{ID: "usr_source_boundary", AccountID: account.ID, Name: "Owner", Email: "sources@example.com", Role: "owner", CreatedAt: now, UpdatedAt: now}
	agent := model.Agent{ID: "agt_source_boundary", AccountID: account.ID, Name: "Assistant", Status: "draft", Revision: 1, CreatedAt: now, UpdatedAt: now}
	if err := dataStore.Update(func(state *model.State) error {
		state.Accounts = append(state.Accounts, account)
		state.Users = append(state.Users, user)
		state.Agents = append(state.Agents, agent)
		return nil
	}); err != nil {
		t.Fatalf("seed source boundary: %v", err)
	}
	token, err := server.issueToken(user)
	if err != nil {
		t.Fatalf("issue token: %v", err)
	}
	payload := map[string]any{"name": "Assistant", "knowledge": []map[string]any{{"id": "src_bypass", "title": "Bypass", "content": "stale vectors"}}}
	created := performJSON(t, server.Handler(), http.MethodPost, "/v1/agents", token, "http://localhost:3000", payload)
	if created.Code != http.StatusBadRequest || !strings.Contains(created.Body.String(), "invalid_request") {
		t.Fatalf("raw knowledge on create was not rejected: %d %s", created.Code, created.Body.String())
	}
	patched := performJSON(t, server.Handler(), http.MethodPatch, "/v1/agents/"+agent.ID, token, "http://localhost:3000", map[string]any{"knowledge": payload["knowledge"]})
	if patched.Code != http.StatusBadRequest || !strings.Contains(patched.Body.String(), "invalid_request") {
		t.Fatalf("raw knowledge on update was not rejected: %d %s", patched.Code, patched.Body.String())
	}
}

func TestCrossTenantAgentIsNotFound(t *testing.T) {
	server, dataStore := newTestServer(t)
	handler := server.Handler()
	response := performJSON(t, handler, http.MethodPost, "/v1/auth/signup", "", "http://localhost:3000", map[string]any{"name": "Owner", "email": "owner@example.com", "password": "correct-horse-123"})
	token, _ := dataFrom(t, response, http.StatusCreated)["access_token"].(string)
	now := time.Now().UTC()
	_ = dataStore.Update(func(state *model.State) error {
		state.Agents = append(state.Agents, model.Agent{ID: "agt_other", AccountID: "org_other", Name: "Other", Status: "draft", CreatedAt: now, UpdatedAt: now})
		return nil
	})
	result := performJSON(t, handler, http.MethodGet, "/v1/agents/agt_other", token, "http://localhost:3000", nil)
	if result.Code != http.StatusNotFound {
		t.Fatalf("cross-tenant read returned %d: %s", result.Code, result.Body.String())
	}
}
