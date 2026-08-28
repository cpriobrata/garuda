package billing

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

type StripeClient struct {
	secretKey     string
	webhookSecret string
	priceID       string
	apiURL        string
	successURL    string
	cancelURL     string
	httpClient    *http.Client
}

type CheckoutSession struct {
	ID        string `json:"id"`
	URL       string `json:"url"`
	ExpiresAt int64  `json:"expires_at"`
}

type PortalSession struct {
	ID  string `json:"id"`
	URL string `json:"url"`
}

type Event struct {
	ID      string          `json:"id"`
	Type    string          `json:"type"`
	Created int64           `json:"created"`
	Data    json.RawMessage `json:"data"`
}

func NewStripe(secretKey, webhookSecret, priceID, apiURL, successURL, cancelURL string) *StripeClient {
	return &StripeClient{
		secretKey: secretKey, webhookSecret: webhookSecret, priceID: priceID,
		apiURL: apiURL, successURL: successURL, cancelURL: cancelURL,
		httpClient: &http.Client{Timeout: 20 * time.Second},
	}
}

func (s *StripeClient) CheckoutEnabled() bool { return s.secretKey != "" && s.priceID != "" }

func (s *StripeClient) WebhookEnabled() bool { return s.webhookSecret != "" }

func (s *StripeClient) CreateCheckout(ctx context.Context, accountID, customerID, email, idempotencyKey string) (CheckoutSession, error) {
	if !s.CheckoutEnabled() {
		return CheckoutSession{}, errors.New("Stripe checkout is not configured")
	}
	values := url.Values{
		"mode":                    {"subscription"},
		"line_items[0][price]":    {s.priceID},
		"line_items[0][quantity]": {"1"},
		"success_url":             {s.successURL},
		"cancel_url":              {s.cancelURL},
		"client_reference_id":     {accountID},
		"metadata[account_id]":    {accountID},
		"subscription_data[metadata][account_id]": {accountID},
		"allow_promotion_codes":                   {"true"},
	}
	if customerID != "" {
		values.Set("customer", customerID)
	} else {
		values.Set("customer_email", email)
	}
	var result CheckoutSession
	if err := s.postForm(ctx, "/checkout/sessions", values, idempotencyKey, &result); err != nil {
		return CheckoutSession{}, err
	}
	return result, nil
}

func (s *StripeClient) CreatePortal(ctx context.Context, customerID, returnURL string) (PortalSession, error) {
	if s.secretKey == "" {
		return PortalSession{}, errors.New("Stripe is not configured")
	}
	if customerID == "" {
		return PortalSession{}, errors.New("account does not have a Stripe customer")
	}
	values := url.Values{"customer": {customerID}, "return_url": {returnURL}}
	var result PortalSession
	if err := s.postForm(ctx, "/billing_portal/sessions", values, "", &result); err != nil {
		return PortalSession{}, err
	}
	return result, nil
}

func (s *StripeClient) VerifyEvent(payload []byte, signatureHeader string, now time.Time) (Event, error) {
	if !s.WebhookEnabled() {
		return Event{}, errors.New("Stripe webhook secret is not configured")
	}
	var timestamp int64
	var signatures []string
	for _, part := range strings.Split(signatureHeader, ",") {
		keyValue := strings.SplitN(strings.TrimSpace(part), "=", 2)
		if len(keyValue) != 2 {
			continue
		}
		switch keyValue[0] {
		case "t":
			timestamp, _ = strconv.ParseInt(keyValue[1], 10, 64)
		case "v1":
			signatures = append(signatures, keyValue[1])
		}
	}
	if timestamp == 0 || len(signatures) == 0 {
		return Event{}, errors.New("invalid Stripe-Signature header")
	}
	if delta := now.Sub(time.Unix(timestamp, 0)); delta > 5*time.Minute || delta < -5*time.Minute {
		return Event{}, errors.New("Stripe signature timestamp is outside tolerance")
	}
	signedPayload := strconv.FormatInt(timestamp, 10) + "." + string(payload)
	mac := hmac.New(sha256.New, []byte(s.webhookSecret))
	_, _ = mac.Write([]byte(signedPayload))
	expected := mac.Sum(nil)
	verified := false
	for _, signature := range signatures {
		decoded, err := hex.DecodeString(signature)
		if err == nil && hmac.Equal(decoded, expected) {
			verified = true
			break
		}
	}
	if !verified {
		return Event{}, errors.New("invalid Stripe webhook signature")
	}
	var event Event
	if err := json.Unmarshal(payload, &event); err != nil {
		return Event{}, errors.New("invalid Stripe event payload")
	}
	if event.ID == "" || event.Type == "" {
		return Event{}, errors.New("incomplete Stripe event")
	}
	return event, nil
}

func (s *StripeClient) postForm(ctx context.Context, path string, values url.Values, idempotencyKey string, result any) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, s.apiURL+path, strings.NewReader(values.Encode()))
	if err != nil {
		return err
	}
	request.SetBasicAuth(s.secretKey, "")
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	if idempotencyKey != "" {
		request.Header.Set("Idempotency-Key", idempotencyKey)
	}
	response, err := s.httpClient.Do(request)
	if err != nil {
		return fmt.Errorf("Stripe request: %w", err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		var failure struct {
			Error struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		_ = json.Unmarshal(body, &failure)
		if failure.Error.Message == "" {
			failure.Error.Message = fmt.Sprintf("Stripe returned status %d", response.StatusCode)
		}
		return errors.New(failure.Error.Message)
	}
	if err := json.Unmarshal(body, result); err != nil {
		return fmt.Errorf("decode Stripe response: %w", err)
	}
	return nil
}
