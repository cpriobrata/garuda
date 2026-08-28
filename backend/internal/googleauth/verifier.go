package googleauth

import (
	"context"
	"crypto"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	googleJWKSURL         = "https://www.googleapis.com/oauth2/v3/certs"
	defaultCacheTTL       = time.Hour
	minimumCacheTTL       = 5 * time.Minute
	maximumCacheTTL       = 24 * time.Hour
	unknownKeyRefreshWait = time.Minute
	maximumTokenBytes     = 16 << 10
	maximumJWKSBytes      = 1 << 20
)

type Claims struct {
	Subject      string
	Email        string
	Name         string
	HostedDomain string
}

type Verifier struct {
	clientID   string
	jwksURL    string
	httpClient *http.Client
	now        func() time.Time

	mu        sync.Mutex
	keys      map[string]*rsa.PublicKey
	expiresAt time.Time
	lastFetch time.Time
}

func New(clientID string) *Verifier {
	return NewWithJWKS(clientID, googleJWKSURL, &http.Client{Timeout: 5 * time.Second})
}

func NewWithJWKS(clientID, jwksURL string, httpClient *http.Client) *Verifier {
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 5 * time.Second}
	}
	return &Verifier{
		clientID: strings.TrimSpace(clientID), jwksURL: strings.TrimSpace(jwksURL), httpClient: httpClient,
		now: time.Now, keys: make(map[string]*rsa.PublicKey),
	}
}

func (v *Verifier) Enabled() bool { return v != nil && v.clientID != "" }

func (v *Verifier) Verify(ctx context.Context, credential string) (Claims, error) {
	if !v.Enabled() {
		return Claims{}, errors.New("Google authentication is not configured")
	}
	if len(credential) == 0 || len(credential) > maximumTokenBytes {
		return Claims{}, errors.New("invalid Google credential")
	}
	parts := strings.Split(credential, ".")
	if len(parts) != 3 {
		return Claims{}, errors.New("invalid Google credential")
	}
	headerBytes, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil || len(headerBytes) > 2<<10 {
		return Claims{}, errors.New("invalid Google credential header")
	}
	var header struct {
		Algorithm string `json:"alg"`
		KeyID     string `json:"kid"`
	}
	if err := json.Unmarshal(headerBytes, &header); err != nil || header.Algorithm != "RS256" || header.KeyID == "" || len(header.KeyID) > 256 {
		return Claims{}, errors.New("unsupported Google credential header")
	}
	payloadBytes, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil || len(payloadBytes) > 12<<10 {
		return Claims{}, errors.New("invalid Google credential claims")
	}
	var payload struct {
		Issuer        string          `json:"iss"`
		Audience      json.RawMessage `json:"aud"`
		Subject       string          `json:"sub"`
		Email         string          `json:"email"`
		EmailVerified bool            `json:"email_verified"`
		Name          string          `json:"name"`
		HostedDomain  string          `json:"hd"`
		ExpiresAt     int64           `json:"exp"`
		IssuedAt      int64           `json:"iat"`
	}
	if err := json.Unmarshal(payloadBytes, &payload); err != nil {
		return Claims{}, errors.New("invalid Google credential claims")
	}
	now := v.now().UTC()
	if payload.Issuer != "accounts.google.com" && payload.Issuer != "https://accounts.google.com" {
		return Claims{}, errors.New("invalid Google credential issuer")
	}
	if !exactAudience(payload.Audience, v.clientID) {
		return Claims{}, errors.New("invalid Google credential audience")
	}
	if payload.Subject == "" || len(payload.Subject) > 255 || !payload.EmailVerified || payload.Email == "" {
		return Claims{}, errors.New("incomplete Google identity")
	}
	if payload.ExpiresAt <= now.Unix() || payload.IssuedAt <= 0 || payload.IssuedAt > now.Add(5*time.Minute).Unix() || payload.IssuedAt < now.Add(-24*time.Hour).Unix() || payload.ExpiresAt <= payload.IssuedAt || payload.ExpiresAt-payload.IssuedAt > int64((24*time.Hour).Seconds()) {
		return Claims{}, errors.New("Google credential is expired or has invalid timestamps")
	}
	key, err := v.keyFor(ctx, header.KeyID, now)
	if err != nil {
		return Claims{}, err
	}
	signature, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil || len(signature) == 0 || len(signature) > 2<<10 {
		return Claims{}, errors.New("invalid Google credential signature")
	}
	digest := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
	if err := rsa.VerifyPKCS1v15(key, crypto.SHA256, digest[:], signature); err != nil {
		return Claims{}, errors.New("invalid Google credential signature")
	}
	return Claims{
		Subject: payload.Subject, Email: strings.ToLower(strings.TrimSpace(payload.Email)),
		Name: strings.TrimSpace(payload.Name), HostedDomain: strings.ToLower(strings.TrimSpace(payload.HostedDomain)),
	}, nil
}

func AuthoritativeEmail(claims Claims) bool {
	at := strings.LastIndex(claims.Email, "@")
	return claims.HostedDomain != "" || (at >= 0 && strings.EqualFold(claims.Email[at+1:], "gmail.com"))
}

func exactAudience(raw json.RawMessage, clientID string) bool {
	var single string
	if json.Unmarshal(raw, &single) == nil {
		return single == clientID
	}
	var multiple []string
	return json.Unmarshal(raw, &multiple) == nil && len(multiple) == 1 && multiple[0] == clientID
}

func (v *Verifier) keyFor(ctx context.Context, keyID string, now time.Time) (*rsa.PublicKey, error) {
	v.mu.Lock()
	defer v.mu.Unlock()
	if key := v.keys[keyID]; key != nil && now.Before(v.expiresAt) {
		return key, nil
	}
	shouldFetch := len(v.keys) == 0 || !now.Before(v.expiresAt) || now.Sub(v.lastFetch) >= unknownKeyRefreshWait
	if shouldFetch {
		if err := v.fetchKeysLocked(ctx, now); err != nil {
			return nil, err
		}
	}
	if key := v.keys[keyID]; key != nil {
		return key, nil
	}
	return nil, errors.New("Google signing key is unavailable")
}

func (v *Verifier) fetchKeysLocked(ctx context.Context, now time.Time) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, v.jwksURL, nil)
	if err != nil {
		return err
	}
	response, err := v.httpClient.Do(request)
	if err != nil {
		return fmt.Errorf("fetch Google signing keys: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("Google signing keys returned status %d", response.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, maximumJWKSBytes+1))
	if err != nil {
		return err
	}
	if len(body) > maximumJWKSBytes {
		return errors.New("Google signing-key response is too large")
	}
	var document struct {
		Keys []struct {
			KeyID     string `json:"kid"`
			KeyType   string `json:"kty"`
			Algorithm string `json:"alg"`
			Use       string `json:"use"`
			Modulus   string `json:"n"`
			Exponent  string `json:"e"`
		} `json:"keys"`
	}
	if err := json.Unmarshal(body, &document); err != nil || len(document.Keys) == 0 || len(document.Keys) > 32 {
		return errors.New("invalid Google signing-key response")
	}
	keys := make(map[string]*rsa.PublicKey, len(document.Keys))
	for _, item := range document.Keys {
		if item.KeyID == "" || item.KeyType != "RSA" || (item.Algorithm != "" && item.Algorithm != "RS256") || (item.Use != "" && item.Use != "sig") {
			continue
		}
		modulus, err := base64.RawURLEncoding.DecodeString(item.Modulus)
		if err != nil || len(modulus) < 256 || len(modulus) > 1024 {
			continue
		}
		exponentBytes, err := base64.RawURLEncoding.DecodeString(item.Exponent)
		if err != nil || len(exponentBytes) == 0 || len(exponentBytes) > 4 {
			continue
		}
		exponent := 0
		for _, value := range exponentBytes {
			exponent = exponent<<8 | int(value)
		}
		key := &rsa.PublicKey{N: new(big.Int).SetBytes(modulus), E: exponent}
		if key.N.BitLen() < 2048 || key.N.BitLen() > 8192 || key.E < 3 || key.E%2 == 0 {
			continue
		}
		keys[item.KeyID] = key
	}
	if len(keys) == 0 {
		return errors.New("Google signing-key response contains no usable keys")
	}
	v.keys = keys
	v.lastFetch = now
	v.expiresAt = now.Add(cacheTTL(response.Header.Get("Cache-Control")))
	return nil
}

func cacheTTL(cacheControl string) time.Duration {
	ttl := defaultCacheTTL
	for _, directive := range strings.Split(cacheControl, ",") {
		parts := strings.SplitN(strings.TrimSpace(directive), "=", 2)
		if len(parts) != 2 || !strings.EqualFold(parts[0], "max-age") {
			continue
		}
		seconds, err := strconv.Atoi(strings.Trim(parts[1], `"`))
		if err == nil && seconds >= 0 {
			ttl = time.Duration(seconds) * time.Second
		}
	}
	if ttl < minimumCacheTTL {
		return minimumCacheTTL
	}
	if ttl > maximumCacheTTL {
		return maximumCacheTTL
	}
	return ttl
}
