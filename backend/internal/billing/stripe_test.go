package billing

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"
)

func TestVerifyEvent(t *testing.T) {
	secret := "whsec_test"
	client := NewStripe("", secret, "", "https://api.stripe.com/v1", "", "")
	now := time.Now().UTC().Truncate(time.Second)
	payload := []byte(`{"id":"evt_1","type":"invoice.paid","data":{"object":{"customer":"cus_1"}}}`)
	signed := strconv.FormatInt(now.Unix(), 10) + "." + string(payload)
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(signed))
	header := "t=" + strconv.FormatInt(now.Unix(), 10) + ",v1=" + hex.EncodeToString(mac.Sum(nil))
	event, err := client.VerifyEvent(payload, header, now)
	if err != nil {
		t.Fatalf("VerifyEvent: %v", err)
	}
	if event.ID != "evt_1" || event.Type != "invoice.paid" {
		t.Fatalf("unexpected event: %#v", event)
	}
	if _, err := client.VerifyEvent(payload, header+"00", now); err == nil {
		t.Fatal("invalid signature was accepted")
	}
}

func TestCreateCheckoutForwardsIdempotencyKey(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Idempotency-Key"); got != "checkout-request-123" {
			t.Errorf("expected Stripe idempotency header, got %q", got)
		}
		if err := r.ParseForm(); err != nil {
			t.Errorf("parse form: %v", err)
		}
		if r.Form.Get("client_reference_id") != "org_123" || r.Form.Get("line_items[0][price]") != "price_123" {
			t.Errorf("unexpected checkout form: %#v", r.Form)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"cs_123","url":"https://checkout.stripe.test/cs_123","expires_at":1788022800}`))
	}))
	defer server.Close()

	client := NewStripe("sk_test", "whsec_test", "price_123", server.URL, "https://app.test/success", "https://app.test/cancel")
	session, err := client.CreateCheckout(context.Background(), "org_123", "", "owner@example.com", "checkout-request-123")
	if err != nil {
		t.Fatalf("CreateCheckout: %v", err)
	}
	if session.ID != "cs_123" || session.ExpiresAt != 1788022800 {
		t.Fatalf("unexpected checkout session: %#v", session)
	}
}
