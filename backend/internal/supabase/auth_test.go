package supabase

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRecoveryRedirectAndPasswordToken(t *testing.T) {
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		w.Header().Set("Content-Type", "application/json")
		switch requests {
		case 1:
			if r.URL.Path != "/auth/v1/recover" || r.URL.Query().Get("redirect_to") != "https://app.example.com/auth/reset-password" {
				t.Fatalf("unexpected recovery request %s", r.URL.String())
			}
			_, _ = w.Write([]byte(`{}`))
		case 2:
			if r.URL.Path != "/auth/v1/user" || r.Method != http.MethodPut {
				t.Fatalf("unexpected password request %s %s", r.Method, r.URL.Path)
			}
			if r.Header.Get("Authorization") != "Bearer recovery-access-token" {
				t.Fatalf("unexpected recovery authorization %q", r.Header.Get("Authorization"))
			}
			var body map[string]string
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body["password"] != "new-secure-password" {
				t.Fatalf("unexpected password body %#v, error %v", body, err)
			}
			_, _ = w.Write([]byte(`{"id":"user-1","email":"owner@example.com"}`))
		}
	}))
	defer server.Close()

	client := New(server.URL, "anon-key")
	if err := client.Recover(context.Background(), "owner@example.com", "https://app.example.com/auth/reset-password"); err != nil {
		t.Fatalf("Recover: %v", err)
	}
	if err := client.UpdatePassword(context.Background(), "recovery-access-token", "new-secure-password"); err != nil {
		t.Fatalf("UpdatePassword: %v", err)
	}
}

func TestRefreshRotatesThroughSupabaseGrant(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/auth/v1/token" || r.URL.Query().Get("grant_type") != "refresh_token" || r.Method != http.MethodPost {
			t.Errorf("unexpected refresh request %s %s", r.Method, r.URL.String())
		}
		var body map[string]string
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body["refresh_token"] != "old-refresh-token" {
			t.Errorf("unexpected refresh body %#v, error %v", body, err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"access_token":"new-access","refresh_token":"new-refresh","expires_in":3600,"user":{"id":"external-user","email":"owner@example.com"}}`))
	}))
	defer server.Close()

	response, err := New(server.URL, "anon-key").Refresh(context.Background(), "old-refresh-token")
	if err != nil {
		t.Fatalf("Refresh: %v", err)
	}
	if response.AccessToken != "new-access" || response.RefreshToken != "new-refresh" || response.User.ID != "external-user" {
		t.Fatalf("unexpected refresh response: %#v", response)
	}
}
