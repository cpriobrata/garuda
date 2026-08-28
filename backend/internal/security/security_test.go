package security

import (
	"testing"
	"time"
)

func TestPasswordHashAndVerify(t *testing.T) {
	hash, err := HashPassword("correct horse battery staple")
	if err != nil {
		t.Fatalf("HashPassword: %v", err)
	}
	if !VerifyPassword(hash, "correct horse battery staple") {
		t.Fatal("valid password was rejected")
	}
	if VerifyPassword(hash, "wrong password") {
		t.Fatal("invalid password was accepted")
	}
}

func TestJWTSignVerifyAndExpiry(t *testing.T) {
	secret := []byte("test-secret-at-least-thirty-two-bytes-long")
	now := time.Now().UTC()
	token, err := SignJWT(secret, Claims{Subject: "usr_1", AccountID: "org_1", Email: "owner@example.com", Role: "owner", IssuedAt: now.Unix(), ExpiresAt: now.Add(time.Hour).Unix()})
	if err != nil {
		t.Fatalf("SignJWT: %v", err)
	}
	claims, err := VerifyJWT(secret, token, now)
	if err != nil {
		t.Fatalf("VerifyJWT: %v", err)
	}
	if claims.AccountID != "org_1" || claims.Subject != "usr_1" {
		t.Fatalf("unexpected claims: %#v", claims)
	}
	if _, err := VerifyJWT(secret, token, now.Add(2*time.Hour)); err == nil {
		t.Fatal("expired token was accepted")
	}
}

func TestScopedVisitorTokensDifferByAgent(t *testing.T) {
	secret := []byte("visitor-secret")
	first := HashScopedToken(secret, "agent-a", "visitor-token")
	second := HashScopedToken(secret, "agent-b", "visitor-token")
	if first == second {
		t.Fatal("visitor token digest must be scoped to one agent")
	}
}
