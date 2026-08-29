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
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	if idempotencyKey != "" {
		request.Header.Set("Idempotency-Key", idempotencyKey)
	}
	return s.send(request, result)
}

// getForm reads a resource or a list. Stripe takes list filters in the query
// string, so the same url.Values that postForm would send as a body are encoded
// onto the URL here.
func (s *StripeClient) getForm(ctx context.Context, path string, values url.Values, result any) error {
	target := s.apiURL + path
	if encoded := values.Encode(); encoded != "" {
		target += "?" + encoded
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return err
	}
	return s.send(request, result)
}

// deleteForm is only used for an immediate subscription cancellation, which Stripe
// models as a DELETE on the subscription.
func (s *StripeClient) deleteForm(ctx context.Context, path string, result any) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodDelete, s.apiURL+path, nil)
	if err != nil {
		return err
	}
	return s.send(request, result)
}

func (s *StripeClient) send(request *http.Request, result any) error {
	request.SetBasicAuth(s.secretKey, "")
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
		// A resource Stripe does not have is not an outage, and the caller has to be
		// able to tell the two apart: a payment method someone else owns must answer
		// 404, while a failing Stripe must answer 502.
		if response.StatusCode == http.StatusNotFound {
			return fmt.Errorf("%w: %s", ErrNotFound, failure.Error.Message)
		}
		return errors.New(failure.Error.Message)
	}
	if err := json.Unmarshal(body, result); err != nil {
		return fmt.Errorf("decode Stripe response: %w", err)
	}
	return nil
}

// ---- In-app billing ---------------------------------------------------------
//
// These calls back the billing screens that live inside the product instead of on
// Stripe's hosted portal. Every one of them is addressed by a customer, payment
// method or subscription identifier that the caller resolves from an authenticated
// account: this client never looks up "the current user", so an identifier that
// arrived in a request body can only reach Stripe after the API layer has proved
// it belongs to that account.
//
// Nothing here is mode-specific. A test secret key reaches the same endpoints with
// the same parameters as a live one; only the key changes.

// ErrNotFound reports that Stripe does not have the requested resource. It is
// exported because the API layer has to answer 404 for a missing resource and 502
// for a provider that is merely unwell.
var ErrNotFound = errors.New("Stripe resource not found")

var (
	errStripeNotConfigured = errors.New("Stripe is not configured")
	errStripeIdentifier    = errors.New("invalid Stripe identifier")
)

// BillingEnabled reports whether the in-app billing calls can reach Stripe.
// Starting a checkout also needs a configured price, but reading invoices, listing
// saved cards and changing an existing subscription need only the secret key, so
// this is deliberately a weaker gate than CheckoutEnabled.
func (s *StripeClient) BillingEnabled() bool { return s.secretKey != "" }

type Invoice struct {
	ID               string `json:"id"`
	Number           string `json:"number"`
	Status           string `json:"status"`
	AmountDue        int64  `json:"amount_due"`
	AmountPaid       int64  `json:"amount_paid"`
	Currency         string `json:"currency"`
	Created          int64  `json:"created"`
	PeriodStart      int64  `json:"period_start"`
	PeriodEnd        int64  `json:"period_end"`
	HostedInvoiceURL string `json:"hosted_invoice_url"`
	InvoicePDF       string `json:"invoice_pdf"`
}

// PaymentMethod carries only what a billing screen may display. Everything else
// Stripe returns about a card -- fingerprint, issuing country, the billing address
// on file -- is dropped here rather than at the edge, so it cannot leak later by
// someone widening a handler.
type PaymentMethod struct {
	ID          string
	CustomerID  string
	Brand       string
	LastFour    string
	ExpiryMonth int
	ExpiryYear  int
}

// SetupIntent is the browser's ticket to collect a card. ClientSecret authorizes
// attaching a payment method to this customer, so it is returned to the account
// that asked for it and never written to a log.
type SetupIntent struct {
	ID           string `json:"id"`
	ClientSecret string `json:"client_secret"`
	Status       string `json:"status"`
}

type Customer struct {
	ID                     string
	DefaultPaymentMethodID string
}

type SubscriptionDetail struct {
	ID                     string
	Status                 string
	CustomerID             string
	CurrentPeriodEnd       int64
	CancelAtPeriodEnd      bool
	PlanAmountCents        int64
	PlanCurrency           string
	PlanInterval           string
	DefaultPaymentMethodID string
}

type paymentMethodPayload struct {
	ID       string `json:"id"`
	Customer string `json:"customer"`
	Card     struct {
		Brand       string `json:"brand"`
		LastFour    string `json:"last4"`
		ExpiryMonth int    `json:"exp_month"`
		ExpiryYear  int    `json:"exp_year"`
	} `json:"card"`
}

func (p paymentMethodPayload) paymentMethod() PaymentMethod {
	return PaymentMethod{
		ID: p.ID, CustomerID: p.Customer, Brand: p.Card.Brand, LastFour: p.Card.LastFour,
		ExpiryMonth: p.Card.ExpiryMonth, ExpiryYear: p.Card.ExpiryYear,
	}
}

type customerPayload struct {
	ID              string `json:"id"`
	InvoiceSettings struct {
		DefaultPaymentMethod string `json:"default_payment_method"`
	} `json:"invoice_settings"`
}

type subscriptionPayload struct {
	ID                   string `json:"id"`
	Status               string `json:"status"`
	Customer             string `json:"customer"`
	CurrentPeriodEnd     int64  `json:"current_period_end"`
	CancelAtPeriodEnd    bool   `json:"cancel_at_period_end"`
	DefaultPaymentMethod string `json:"default_payment_method"`
	Items                struct {
		Data []struct {
			CurrentPeriodEnd int64 `json:"current_period_end"`
			Price            struct {
				UnitAmount int64  `json:"unit_amount"`
				Currency   string `json:"currency"`
				Recurring  struct {
					Interval string `json:"interval"`
				} `json:"recurring"`
			} `json:"price"`
		} `json:"data"`
	} `json:"items"`
}

func (p subscriptionPayload) subscriptionDetail() SubscriptionDetail {
	detail := SubscriptionDetail{
		ID: p.ID, Status: p.Status, CustomerID: p.Customer,
		CurrentPeriodEnd: p.CurrentPeriodEnd, CancelAtPeriodEnd: p.CancelAtPeriodEnd,
		DefaultPaymentMethodID: p.DefaultPaymentMethod,
	}
	if len(p.Items.Data) > 0 {
		item := p.Items.Data[0]
		detail.PlanAmountCents = item.Price.UnitAmount
		detail.PlanCurrency = item.Price.Currency
		detail.PlanInterval = item.Price.Recurring.Interval
		// Newer Stripe API versions report the billing period on the subscription
		// item rather than on the subscription. Reading the item as a fallback keeps
		// one code path correct on both, since this client pins no API version and
		// so follows whatever version the account is set to.
		if detail.CurrentPeriodEnd == 0 {
			detail.CurrentPeriodEnd = item.CurrentPeriodEnd
		}
	}
	return detail
}

// validProviderID guards an identifier that is about to be interpolated into a
// request path. Stripe identifiers are ASCII letters, digits and underscores;
// anything else is a caller-supplied string that must never become a path segment
// of a request carrying our secret key.
func validProviderID(value string) bool {
	if value == "" || len(value) > 255 {
		return false
	}
	for _, character := range value {
		switch {
		case character >= 'a' && character <= 'z':
		case character >= 'A' && character <= 'Z':
		case character >= '0' && character <= '9':
		case character == '_':
		default:
			return false
		}
	}
	return true
}

// stripeListLimit keeps a page size inside the range the Stripe list API accepts,
// so a caller-influenced number can never turn into a provider error.
func stripeListLimit(limit int) int {
	if limit < 1 {
		return 1
	}
	if limit > 100 {
		return 100
	}
	return limit
}

// ListInvoices returns the customer's own invoices, newest first, as Stripe orders
// them. The hosted page and the PDF come back as the links Stripe already
// publishes: this service deliberately does not proxy the bytes, which would put
// it in the middle of every download and add nothing.
func (s *StripeClient) ListInvoices(ctx context.Context, customerID string, limit int) ([]Invoice, error) {
	if !s.BillingEnabled() {
		return nil, errStripeNotConfigured
	}
	if !validProviderID(customerID) {
		return nil, errStripeIdentifier
	}
	values := url.Values{"customer": {customerID}, "limit": {strconv.Itoa(stripeListLimit(limit))}}
	var page struct {
		Data []Invoice `json:"data"`
	}
	if err := s.getForm(ctx, "/invoices", values, &page); err != nil {
		return nil, err
	}
	return page.Data, nil
}

func (s *StripeClient) ListPaymentMethods(ctx context.Context, customerID string, limit int) ([]PaymentMethod, error) {
	if !s.BillingEnabled() {
		return nil, errStripeNotConfigured
	}
	if !validProviderID(customerID) {
		return nil, errStripeIdentifier
	}
	values := url.Values{"customer": {customerID}, "type": {"card"}, "limit": {strconv.Itoa(stripeListLimit(limit))}}
	var page struct {
		Data []paymentMethodPayload `json:"data"`
	}
	if err := s.getForm(ctx, "/payment_methods", values, &page); err != nil {
		return nil, err
	}
	methods := make([]PaymentMethod, 0, len(page.Data))
	for _, payload := range page.Data {
		methods = append(methods, payload.paymentMethod())
	}
	return methods, nil
}

// RetrievePaymentMethod is how a payment method identifier that arrived from a
// browser gets checked. The returned CustomerID is the only trustworthy statement
// about who owns that card, and the caller must compare it with the customer on
// the authenticated account before acting on it.
func (s *StripeClient) RetrievePaymentMethod(ctx context.Context, paymentMethodID string) (PaymentMethod, error) {
	if !s.BillingEnabled() {
		return PaymentMethod{}, errStripeNotConfigured
	}
	if !validProviderID(paymentMethodID) {
		return PaymentMethod{}, errStripeIdentifier
	}
	var payload paymentMethodPayload
	if err := s.getForm(ctx, "/payment_methods/"+paymentMethodID, nil, &payload); err != nil {
		return PaymentMethod{}, err
	}
	return payload.paymentMethod(), nil
}

func (s *StripeClient) RetrieveCustomer(ctx context.Context, customerID string) (Customer, error) {
	if !s.BillingEnabled() {
		return Customer{}, errStripeNotConfigured
	}
	if !validProviderID(customerID) {
		return Customer{}, errStripeIdentifier
	}
	var payload customerPayload
	if err := s.getForm(ctx, "/customers/"+customerID, nil, &payload); err != nil {
		return Customer{}, err
	}
	return Customer{ID: payload.ID, DefaultPaymentMethodID: payload.InvoiceSettings.DefaultPaymentMethod}, nil
}

// CreateSetupIntent starts the card-collection flow that replaces the hosted
// portal. The card itself is collected by Stripe.js in the browser against the
// returned client secret, so no card number, expiry or security code ever reaches
// this server -- which is what keeps the service out of PCI scope.
func (s *StripeClient) CreateSetupIntent(ctx context.Context, accountID, customerID, idempotencyKey string) (SetupIntent, error) {
	if !s.BillingEnabled() {
		return SetupIntent{}, errStripeNotConfigured
	}
	if !validProviderID(customerID) {
		return SetupIntent{}, errStripeIdentifier
	}
	values := url.Values{
		"customer":                {customerID},
		"payment_method_types[0]": {"card"},
		// The saved card is charged by the recurring invoice with nobody at the
		// keyboard, so it has to be set up for off-session use.
		"usage":                {"off_session"},
		"metadata[account_id]": {accountID},
	}
	var result SetupIntent
	if err := s.postForm(ctx, "/setup_intents", values, idempotencyKey, &result); err != nil {
		return SetupIntent{}, err
	}
	return result, nil
}

// SetCustomerDefaultPaymentMethod promotes an already-attached card to the one
// future invoices are charged against.
func (s *StripeClient) SetCustomerDefaultPaymentMethod(ctx context.Context, customerID, paymentMethodID string) error {
	if !s.BillingEnabled() {
		return errStripeNotConfigured
	}
	if !validProviderID(customerID) || !validProviderID(paymentMethodID) {
		return errStripeIdentifier
	}
	values := url.Values{"invoice_settings[default_payment_method]": {paymentMethodID}}
	var payload customerPayload
	return s.postForm(ctx, "/customers/"+customerID, values, "", &payload)
}

// SetSubscriptionDefaultPaymentMethod points the existing subscription at the new
// card. Without this the customer default only applies to invoices that have no
// subscription-level default of their own, so an old card can keep being charged.
func (s *StripeClient) SetSubscriptionDefaultPaymentMethod(ctx context.Context, subscriptionID, paymentMethodID string) (SubscriptionDetail, error) {
	if !s.BillingEnabled() {
		return SubscriptionDetail{}, errStripeNotConfigured
	}
	if !validProviderID(subscriptionID) || !validProviderID(paymentMethodID) {
		return SubscriptionDetail{}, errStripeIdentifier
	}
	values := url.Values{"default_payment_method": {paymentMethodID}}
	var payload subscriptionPayload
	if err := s.postForm(ctx, "/subscriptions/"+subscriptionID, values, "", &payload); err != nil {
		return SubscriptionDetail{}, err
	}
	return payload.subscriptionDetail(), nil
}

func (s *StripeClient) RetrieveSubscription(ctx context.Context, subscriptionID string) (SubscriptionDetail, error) {
	if !s.BillingEnabled() {
		return SubscriptionDetail{}, errStripeNotConfigured
	}
	if !validProviderID(subscriptionID) {
		return SubscriptionDetail{}, errStripeIdentifier
	}
	var payload subscriptionPayload
	if err := s.getForm(ctx, "/subscriptions/"+subscriptionID, nil, &payload); err != nil {
		return SubscriptionDetail{}, err
	}
	return payload.subscriptionDetail(), nil
}

// SetSubscriptionCancellation schedules or unschedules a cancellation at the end
// of the paid period. Passing false is the undo: while the period is still running
// Stripe clears the flag and the subscription simply continues.
func (s *StripeClient) SetSubscriptionCancellation(ctx context.Context, subscriptionID string, cancelAtPeriodEnd bool) (SubscriptionDetail, error) {
	if !s.BillingEnabled() {
		return SubscriptionDetail{}, errStripeNotConfigured
	}
	if !validProviderID(subscriptionID) {
		return SubscriptionDetail{}, errStripeIdentifier
	}
	values := url.Values{"cancel_at_period_end": {strconv.FormatBool(cancelAtPeriodEnd)}}
	var payload subscriptionPayload
	if err := s.postForm(ctx, "/subscriptions/"+subscriptionID, values, "", &payload); err != nil {
		return SubscriptionDetail{}, err
	}
	return payload.subscriptionDetail(), nil
}

// CancelSubscriptionNow ends the subscription immediately and forfeits the rest of
// the paid period. It exists for the rare explicit request; scheduling the
// cancellation at the period end is the normal path.
func (s *StripeClient) CancelSubscriptionNow(ctx context.Context, subscriptionID string) (SubscriptionDetail, error) {
	if !s.BillingEnabled() {
		return SubscriptionDetail{}, errStripeNotConfigured
	}
	if !validProviderID(subscriptionID) {
		return SubscriptionDetail{}, errStripeIdentifier
	}
	var payload subscriptionPayload
	if err := s.deleteForm(ctx, "/subscriptions/"+subscriptionID, &payload); err != nil {
		return SubscriptionDetail{}, err
	}
	return payload.subscriptionDetail(), nil
}
