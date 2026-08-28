package googleauth

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestVerifyGoogleCredentialAndCacheJWKS(t *testing.T) {
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	fetches := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		fetches++
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "public, max-age=3600")
		_ = json.NewEncoder(w).Encode(map[string]any{"keys": []map[string]any{{
			"kid": "google-test-key", "kty": "RSA", "alg": "RS256", "use": "sig",
			"n": base64.RawURLEncoding.EncodeToString(privateKey.PublicKey.N.Bytes()),
			"e": base64.RawURLEncoding.EncodeToString(big.NewInt(int64(privateKey.PublicKey.E)).Bytes()),
		}}})
	}))
	defer server.Close()

	now := time.Date(2026, time.August, 29, 12, 0, 0, 0, time.UTC)
	verifier := NewWithJWKS("client-id.apps.googleusercontent.com", server.URL, server.Client())
	verifier.now = func() time.Time { return now }
	claims := map[string]any{
		"iss": "https://accounts.google.com", "aud": "client-id.apps.googleusercontent.com", "sub": "google-subject-123",
		"email": "owner@gmail.com", "email_verified": true, "name": "Owner", "iat": now.Unix(), "exp": now.Add(time.Hour).Unix(),
	}
	token := signGoogleTestToken(t, privateKey, "RS256", claims)
	for index := 0; index < 2; index++ {
		identity, err := verifier.Verify(context.Background(), token)
		if err != nil {
			t.Fatalf("Verify %d: %v", index, err)
		}
		if identity.Subject != "google-subject-123" || identity.Email != "owner@gmail.com" || !AuthoritativeEmail(identity) {
			t.Fatalf("unexpected identity: %#v", identity)
		}
	}
	if fetches != 1 {
		t.Fatalf("expected one cached JWKS fetch, got %d", fetches)
	}

	invalidCases := []struct {
		name   string
		mutate func(map[string]any)
		alg    string
	}{
		{name: "audience", mutate: func(c map[string]any) { c["aud"] = "another-client" }, alg: "RS256"},
		{name: "issuer", mutate: func(c map[string]any) { c["iss"] = "https://attacker.example" }, alg: "RS256"},
		{name: "expired", mutate: func(c map[string]any) { c["exp"] = now.Add(-time.Minute).Unix() }, alg: "RS256"},
		{name: "future issued", mutate: func(c map[string]any) { c["iat"] = now.Add(10 * time.Minute).Unix() }, alg: "RS256"},
		{name: "unverified email", mutate: func(c map[string]any) { c["email_verified"] = false }, alg: "RS256"},
		{name: "algorithm", mutate: func(map[string]any) {}, alg: "HS256"},
	}
	for _, test := range invalidCases {
		t.Run(test.name, func(t *testing.T) {
			copyClaims := make(map[string]any, len(claims))
			for key, value := range claims {
				copyClaims[key] = value
			}
			test.mutate(copyClaims)
			if _, err := verifier.Verify(context.Background(), signGoogleTestToken(t, privateKey, test.alg, copyClaims)); err == nil {
				t.Fatal("invalid Google credential was accepted")
			}
		})
	}
}

func TestAuthoritativeEmailPolicy(t *testing.T) {
	if AuthoritativeEmail(Claims{Email: "person@example.com"}) {
		t.Fatal("consumer non-Gmail address without hd was treated as authoritative")
	}
	if !AuthoritativeEmail(Claims{Email: "person@example.com", HostedDomain: "example.com"}) {
		t.Fatal("Workspace hd claim was not treated as authoritative")
	}
}

func signGoogleTestToken(t *testing.T, key *rsa.PrivateKey, algorithm string, claims map[string]any) string {
	t.Helper()
	header, _ := json.Marshal(map[string]string{"alg": algorithm, "kid": "google-test-key", "typ": "JWT"})
	payload, _ := json.Marshal(claims)
	encodedHeader := base64.RawURLEncoding.EncodeToString(header)
	encodedPayload := base64.RawURLEncoding.EncodeToString(payload)
	digest := sha256.Sum256([]byte(encodedHeader + "." + encodedPayload))
	signature, err := rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, digest[:])
	if err != nil {
		t.Fatalf("sign token: %v", err)
	}
	return encodedHeader + "." + encodedPayload + "." + base64.RawURLEncoding.EncodeToString(signature)
}
