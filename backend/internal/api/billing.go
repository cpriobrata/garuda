package api

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"garuda/backend/internal/billing"
	"garuda/backend/internal/config"
	"garuda/backend/internal/model"
	"garuda/backend/internal/security"
)

const (
	checkoutCreatingTTL = 5 * time.Minute
	checkoutRetryTTL    = 2 * time.Minute
	checkoutSessionTTL  = 24 * time.Hour
)

var errCheckoutInProgress = errors.New("checkout already in progress")

func (s *Server) getSubscription(w http.ResponseWriter, r *http.Request) {
	identity := identityFrom(r.Context())
	var account model.Account
	var subscription model.Subscription
	_ = s.store.View(func(state *model.State) error {
		if candidate, ok := findAccount(state, identity.AccountID); ok {
			account = *candidate
		}
		for _, candidate := range state.Subscriptions {
			if candidate.AccountID == identity.AccountID {
				subscription = candidate
			}
		}
		return nil
	})
	s.writeData(w, http.StatusOK, s.subscriptionView(account, subscription, s.hasEntitlement(identity.AccountID)))
}

func (s *Server) subscriptionView(account model.Account, subscription model.Subscription, entitled bool) map[string]any {
	status := subscription.Status
	if status == "" {
		status = account.BillingStatus
	}
	return map[string]any{
		"status": status, "plan_code": "starter_17", "current_period_end": subscription.CurrentPeriodEnd,
		"cancel_at_period_end": subscription.CancelAtPeriodEnd, "entitled": entitled,
		"price": map[string]any{"unit_amount": s.cfg.PlanAmountCents, "currency": s.cfg.PlanCurrency, "interval": "month"},
		"limits": map[string]int{
			"published_agents":            config.StarterPublishedAgentLimit,
			"monthly_conversations":       config.StarterMonthlyConversationLimit,
			"knowledge_sources_per_agent": config.StarterKnowledgeSourceLimit,
		},
	}
}

func (s *Server) createCheckout(w http.ResponseWriter, r *http.Request) {
	identity := identityFrom(r.Context())
	var account model.Account
	var user model.User
	found := false
	_ = s.store.View(func(state *model.State) error {
		if candidate, ok := findAccount(state, identity.AccountID); ok {
			account, found = *candidate, true
		}
		if candidate, ok := findUser(state, identity.UserID); ok {
			user = *candidate
		}
		return nil
	})
	if !found {
		s.writeError(w, r, http.StatusNotFound, "account_not_found", "Account not found", nil)
		return
	}
	if account.BillingStatus == "active" || account.BillingStatus == "trialing" {
		s.writeError(w, r, http.StatusConflict, "subscription_already_active", "This workspace already has an active subscription; use the billing portal to manage it", nil)
		return
	}
	if !s.stripe.CheckoutEnabled() && !s.cfg.DemoMode {
		s.writeError(w, r, http.StatusServiceUnavailable, "billing_not_configured", "Billing is not configured", nil)
		return
	}
	idempotencyKey := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if len(idempotencyKey) < 8 || len(idempotencyKey) > 255 {
		s.writeError(w, r, http.StatusBadRequest, "idempotency_key_required", "Idempotency-Key must contain 8 to 255 characters", nil)
		return
	}
	now := time.Now().UTC()
	attempt, replayed, err := s.reserveCheckout(account.ID, security.HashOpaqueToken(idempotencyKey), now)
	if errors.Is(err, errCheckoutInProgress) {
		w.Header().Set("Retry-After", "30")
		s.writeError(w, r, http.StatusConflict, "checkout_in_progress", "A checkout is already being created for this workspace", nil)
		return
	}
	if err != nil {
		s.storageFailure(w, r, err)
		return
	}
	if replayed {
		s.writeData(w, http.StatusOK, map[string]any{"session_id": attempt.ProviderSessionID, "url": attempt.URL, "demo": attempt.Demo, "replayed": true})
		return
	}
	if s.stripe.CheckoutEnabled() {
		session, err := s.stripe.CreateCheckout(r.Context(), account.ID, account.StripeCustomerID, user.Email, idempotencyKey)
		if err != nil {
			s.markCheckoutRetryable(attempt.ID, time.Now().UTC())
			s.logger.Error("Stripe checkout failed", "error", err, "request_id", requestID(r.Context()))
			s.writeError(w, r, http.StatusBadGateway, "billing_provider_error", "Checkout is temporarily unavailable", nil)
			return
		}
		expiresAt := time.Now().UTC().Add(checkoutSessionTTL)
		if session.ExpiresAt > 0 {
			expiresAt = time.Unix(session.ExpiresAt, 0).UTC()
		}
		if err := s.completeCheckoutReservation(attempt.ID, session.ID, session.URL, false, expiresAt, time.Now().UTC()); err != nil {
			s.storageFailure(w, r, err)
			return
		}
		s.writeData(w, http.StatusCreated, map[string]any{"session_id": session.ID, "url": session.URL, "demo": false})
		return
	}
	demoID := newID("cs_demo_")
	successURL, err := addQueryParameter(s.cfg.StripeSuccessURL, "demo_checkout", demoID)
	if err != nil {
		s.markCheckoutRetryable(attempt.ID, time.Now().UTC())
		s.logger.Error("Demo checkout redirect is invalid", "error", err, "request_id", requestID(r.Context()))
		s.writeError(w, r, http.StatusServiceUnavailable, "billing_not_configured", "Billing redirect is not configured", nil)
		return
	}
	if err := s.completeCheckoutReservation(attempt.ID, demoID, successURL, true, time.Now().UTC().Add(checkoutSessionTTL), time.Now().UTC()); err != nil {
		s.storageFailure(w, r, err)
		return
	}
	s.writeData(w, http.StatusCreated, map[string]any{
		"session_id": demoID, "url": successURL,
		"demo": true, "notice": "Local demo only. Call POST /v1/billing/demo/complete to simulate a verified billing event.",
	})
}

func (s *Server) reserveCheckout(accountID, keyHash string, now time.Time) (model.CheckoutAttempt, bool, error) {
	var result model.CheckoutAttempt
	replayed := false
	err := s.store.Update(func(state *model.State) error {
		for index := range state.CheckoutAttempts {
			attempt := &state.CheckoutAttempts[index]
			if attempt.AccountID != accountID || !attempt.ExpiresAt.After(now) {
				continue
			}
			if attempt.IdempotencyKeyHash != keyHash {
				if attempt.Status == "created" {
					result = *attempt
					replayed = true
					return nil
				}
				return errCheckoutInProgress
			}
			switch attempt.Status {
			case "created":
				result = *attempt
				replayed = true
				return nil
			case "retryable":
				attempt.Status = "creating"
				attempt.ExpiresAt = now.Add(checkoutCreatingTTL)
				attempt.UpdatedAt = now
				result = *attempt
				return nil
			default:
				return errCheckoutInProgress
			}
		}
		active := state.CheckoutAttempts[:0]
		for _, attempt := range state.CheckoutAttempts {
			if attempt.ExpiresAt.After(now) {
				active = append(active, attempt)
			}
		}
		state.CheckoutAttempts = active
		result = model.CheckoutAttempt{
			ID: newID("chk_"), AccountID: accountID, IdempotencyKeyHash: keyHash, Status: "creating",
			ExpiresAt: now.Add(checkoutCreatingTTL), CreatedAt: now, UpdatedAt: now,
		}
		state.CheckoutAttempts = append(state.CheckoutAttempts, result)
		return nil
	})
	return result, replayed, err
}

func (s *Server) completeCheckoutReservation(attemptID, sessionID, checkoutURL string, demo bool, expiresAt, now time.Time) error {
	return s.store.Update(func(state *model.State) error {
		for index := range state.CheckoutAttempts {
			attempt := &state.CheckoutAttempts[index]
			if attempt.ID == attemptID {
				attempt.ProviderSessionID = sessionID
				attempt.URL = checkoutURL
				attempt.Demo = demo
				attempt.Status = "created"
				attempt.ExpiresAt = expiresAt
				attempt.UpdatedAt = now
				return nil
			}
		}
		return errors.New("checkout reservation not found")
	})
}

func (s *Server) markCheckoutRetryable(attemptID string, now time.Time) {
	if err := s.store.Update(func(state *model.State) error {
		for index := range state.CheckoutAttempts {
			attempt := &state.CheckoutAttempts[index]
			if attempt.ID == attemptID {
				attempt.Status = "retryable"
				attempt.ExpiresAt = now.Add(checkoutRetryTTL)
				attempt.UpdatedAt = now
				break
			}
		}
		return nil
	}); err != nil {
		s.logger.Error("Checkout retry state could not be saved", "attempt_id", attemptID, "error", err)
	}
}

func addQueryParameter(rawURL, key, value string) (string, error) {
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return "", errors.New("redirect must be an absolute URL")
	}
	query := parsed.Query()
	query.Set(key, value)
	parsed.RawQuery = query.Encode()
	return parsed.String(), nil
}

func (s *Server) createBillingPortal(w http.ResponseWriter, r *http.Request) {
	identity := identityFrom(r.Context())
	if identity.Role != "owner" {
		s.writeError(w, r, http.StatusForbidden, "owner_required", "Only an organization owner can manage billing", nil)
		return
	}
	var account model.Account
	_ = s.store.View(func(state *model.State) error {
		if candidate, ok := findAccount(state, identity.AccountID); ok {
			account = *candidate
		}
		return nil
	})
	if account.ID == "" {
		s.writeError(w, r, http.StatusNotFound, "account_not_found", "Account not found", nil)
		return
	}
	if !s.stripe.CheckoutEnabled() {
		if s.cfg.DemoMode {
			s.writeData(w, http.StatusOK, map[string]any{"url": s.cfg.StripePortalReturnURL, "demo": true})
			return
		}
		s.writeError(w, r, http.StatusServiceUnavailable, "billing_not_configured", "Billing is not configured", nil)
		return
	}
	session, err := s.stripe.CreatePortal(r.Context(), account.StripeCustomerID, s.cfg.StripePortalReturnURL)
	if err != nil {
		s.logger.Error("Stripe portal failed", "error", err, "request_id", requestID(r.Context()))
		s.writeError(w, r, http.StatusBadGateway, "billing_provider_error", "The billing portal is temporarily unavailable", nil)
		return
	}
	s.writeData(w, http.StatusCreated, map[string]any{"session_id": session.ID, "url": session.URL})
}

func (s *Server) completeDemoCheckout(w http.ResponseWriter, r *http.Request) {
	if !s.cfg.DemoMode {
		s.writeError(w, r, http.StatusNotFound, "not_found", "Route not found", nil)
		return
	}
	identity := identityFrom(r.Context())
	now := time.Now().UTC()
	periodEnd := now.Add(30 * 24 * time.Hour)
	err := s.store.Update(func(state *model.State) error {
		account, ok := findAccount(state, identity.AccountID)
		if !ok {
			return errors.New("account not found")
		}
		account.BillingStatus = "active"
		account.Plan = "starter_17"
		account.UpdatedAt = now
		subscription := ensureSubscription(state, identity.AccountID, now)
		subscription.Status = "active"
		subscription.Plan = "starter_17"
		subscription.CurrentPeriodEnd = &periodEnd
		subscription.UpdatedAt = now
		return nil
	})
	if err != nil {
		s.storageFailure(w, r, err)
		return
	}
	s.writeData(w, http.StatusOK, map[string]any{"status": "active", "entitled": true, "demo": true, "notice": "This entitlement came from the local demo simulator, not Stripe."})
}

func (s *Server) stripeWebhook(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	payload, err := io.ReadAll(r.Body)
	if err != nil {
		s.writeError(w, r, http.StatusBadRequest, "invalid_webhook", "Webhook body could not be read", nil)
		return
	}
	event, err := s.stripe.VerifyEvent(payload, r.Header.Get("Stripe-Signature"), time.Now())
	if err != nil {
		s.writeError(w, r, http.StatusBadRequest, "invalid_webhook_signature", "Stripe webhook signature is invalid", nil)
		return
	}
	duplicate := false
	err = s.store.Update(func(state *model.State) error {
		for _, processed := range state.WebhookEvents {
			if processed.ID == event.ID {
				duplicate = true
				return nil
			}
		}
		var data struct {
			Object map[string]any `json:"object"`
		}
		if err := json.Unmarshal(event.Data, &data); err != nil {
			return errors.New("invalid event data")
		}
		eventCreatedAt := time.Unix(event.Created, 0).UTC()
		if event.Created <= 0 {
			eventCreatedAt = time.Now().UTC()
		}
		if err := applyStripeEvent(state, event.Type, data.Object, eventCreatedAt, time.Now().UTC()); err != nil {
			return err
		}
		state.WebhookEvents = append(state.WebhookEvents, model.WebhookEvent{ID: event.ID, Type: event.Type, CreatedAt: time.Now().UTC()})
		if len(state.WebhookEvents) > 5_000 {
			state.WebhookEvents = state.WebhookEvents[len(state.WebhookEvents)-5_000:]
		}
		return nil
	})
	if err != nil {
		s.logger.Error("Stripe webhook processing failed", "event_id", event.ID, "event_type", event.Type, "error", err)
		s.writeError(w, r, http.StatusUnprocessableEntity, "webhook_processing_failed", "Webhook could not be applied", nil)
		return
	}
	s.writeData(w, http.StatusOK, map[string]any{"received": true, "duplicate": duplicate})
}

func applyStripeEvent(state *model.State, eventType string, object map[string]any, eventCreatedAt, now time.Time) error {
	metadata, _ := object["metadata"].(map[string]any)
	accountID := stringValue(metadata["account_id"])
	customerID := stringValue(object["customer"])
	if accountID == "" {
		accountID = stringValue(object["client_reference_id"])
	}
	if accountID == "" && customerID != "" {
		for _, account := range state.Accounts {
			if account.StripeCustomerID == customerID {
				accountID = account.ID
				break
			}
		}
	}
	if accountID == "" {
		// Events unrelated to a known Garuda account are acknowledged and ignored.
		return nil
	}
	account, ok := findAccount(state, accountID)
	if !ok {
		return errors.New("Stripe metadata references an unknown account")
	}
	subscription := ensureSubscription(state, accountID, now)
	if subscription.ProviderEventCreatedAt != nil && eventCreatedAt.Before(*subscription.ProviderEventCreatedAt) {
		return nil
	}
	status := stringValue(object["status"])
	subscriptionID := stringValue(object["subscription"])
	if strings.HasPrefix(eventType, "customer.subscription.") {
		subscriptionID = stringValue(object["id"])
	}
	if customerID != "" {
		account.StripeCustomerID = customerID
		subscription.StripeCustomerID = customerID
	}
	if subscriptionID != "" {
		subscription.StripeSubscriptionID = subscriptionID
	}
	switch eventType {
	case "checkout.session.completed":
		if stringValue(object["payment_status"]) == "paid" {
			status = "active"
		} else if status == "" {
			status = "incomplete"
		}
	case "customer.subscription.created", "customer.subscription.updated":
		// status comes from the subscription object.
	case "customer.subscription.deleted":
		status = "canceled"
	case "invoice.paid":
		status = "active"
	case "invoice.payment_failed":
		status = "past_due"
	default:
		return nil
	}
	if status == "" {
		return nil
	}
	subscription.Status = status
	subscription.Plan = "starter_17"
	if value, present := object["current_period_end"]; present {
		subscription.CurrentPeriodEnd = unixTime(value)
	}
	if cancel, ok := object["cancel_at_period_end"].(bool); ok {
		subscription.CancelAtPeriodEnd = cancel
	}
	subscription.UpdatedAt = now
	subscription.ProviderEventCreatedAt = &eventCreatedAt
	account.BillingStatus = status
	account.Plan = "starter_17"
	account.UpdatedAt = now
	return nil
}

func ensureSubscription(state *model.State, accountID string, now time.Time) *model.Subscription {
	for index := range state.Subscriptions {
		if state.Subscriptions[index].AccountID == accountID {
			return &state.Subscriptions[index]
		}
	}
	state.Subscriptions = append(state.Subscriptions, model.Subscription{ID: newID("sub_"), AccountID: accountID, Plan: "starter_17", Status: "incomplete", CreatedAt: now, UpdatedAt: now})
	return &state.Subscriptions[len(state.Subscriptions)-1]
}

// ---- In-app billing ---------------------------------------------------------
//
// These routes are the in-product replacement for the hosted Stripe portal. The
// portal still exists as a fallback, but everything an owner needs day to day --
// invoices, saved cards, adding a card, cancelling and resuming -- happens here.
//
// Two invariants hold across all of them. The customer and subscription are always
// resolved from the authenticated account, never from the request body, so Stripe
// is only ever asked about resources this account owns. And every one of them has
// an answer when Stripe is not configured at all, because the product has to run
// with zero credentials.

const (
	billingInvoiceListLimit       = 24
	billingPaymentMethodListLimit = 10
)

type billingAccess struct {
	account      model.Account
	subscription model.Subscription
	entitled     bool
}

type billingPaymentMethodInput struct {
	PaymentMethodID string `json:"payment_method_id"`
}

type billingCancelInput struct {
	// Immediate forfeits the rest of a period the customer already paid for, so it
	// has to be asked for explicitly. The zero value is the humane default.
	Immediate bool `json:"immediate"`
}

// billingAccessFor resolves the caller's own account and subscription and applies
// the gates every in-app billing route shares.
//
// Both records come from the authenticated identity, so every Stripe call made
// downstream is addressed by a customer and a subscription this account provably
// owns. Stripe would answer just as happily for another workspace's identifiers;
// this is the reason it is never asked to.
func (s *Server) billingAccessFor(w http.ResponseWriter, r *http.Request) (billingAccess, bool) {
	identity := identityFrom(r.Context())
	if identity.Role != "owner" {
		s.writeError(w, r, http.StatusForbidden, "owner_required", "Only an organization owner can manage billing", nil)
		return billingAccess{}, false
	}
	var access billingAccess
	found := false
	_ = s.store.View(func(state *model.State) error {
		candidate, ok := findAccount(state, identity.AccountID)
		if !ok {
			return nil
		}
		access.account, found = *candidate, true
		for _, subscription := range state.Subscriptions {
			if subscription.AccountID == identity.AccountID {
				access.subscription = billingCloneSubscription(subscription)
			}
		}
		return nil
	})
	if !found {
		s.writeError(w, r, http.StatusNotFound, "account_not_found", "Account not found", nil)
		return billingAccess{}, false
	}
	access.entitled = s.hasEntitlement(identity.AccountID)
	if !access.entitled && !billingRepairable(access.account) {
		s.writeError(w, r, http.StatusPaymentRequired, "subscription_required", "An active subscription is required to manage billing", nil)
		return billingAccess{}, false
	}
	return access, true
}

// billingRepairable reports whether a workspace without a live entitlement still
// has a billing relationship worth showing it. A declined renewal leaves the
// account past_due, and locking that owner out of the invoice and card screens
// would leave them no way to fix the card in-product, which is the entire point of
// these routes. A workspace that never paid has no Stripe customer and stays gated.
func billingRepairable(account model.Account) bool {
	if account.StripeCustomerID == "" {
		return false
	}
	switch account.BillingStatus {
	case "past_due", "unpaid", "incomplete", "incomplete_expired", "canceled":
		return true
	}
	return false
}

// billingCloneSubscription detaches a subscription from live state. The struct
// copies by value, but its timestamps are pointers into state that a webhook can
// replace while this response is still being written, so they are copied too.
func billingCloneSubscription(subscription model.Subscription) model.Subscription {
	copied := subscription
	if subscription.CurrentPeriodEnd != nil {
		periodEnd := *subscription.CurrentPeriodEnd
		copied.CurrentPeriodEnd = &periodEnd
	}
	if subscription.ProviderEventCreatedAt != nil {
		eventCreatedAt := *subscription.ProviderEventCreatedAt
		copied.ProviderEventCreatedAt = &eventCreatedAt
	}
	return copied
}

// billingTime converts a Stripe Unix timestamp into the RFC 3339 shape every other
// timestamp in this API uses. An absent value stays absent instead of becoming 1970.
func billingTime(seconds int64) *time.Time {
	if seconds <= 0 {
		return nil
	}
	value := time.Unix(seconds, 0).UTC()
	return &value
}

// billingProviderName names whatever actually answered, so a screen can tell an
// empty invoice history apart from a service running without Stripe credentials.
func (s *Server) billingProviderName() string {
	if s.stripe.BillingEnabled() {
		return "stripe"
	}
	if s.cfg.DemoMode {
		return "demo"
	}
	return "none"
}

// billingLocalSource names where a payload built from stored state came from. It
// is never "stripe": a workspace can have Stripe configured and still have nothing
// recorded at the provider yet, and saying "stripe" there would claim the numbers
// were confirmed upstream when they were not.
func (s *Server) billingLocalSource() string {
	if s.stripe.BillingEnabled() {
		return "local"
	}
	if s.cfg.DemoMode {
		return "demo"
	}
	return "none"
}

// billingPaymentMethodPayload is the only shape a saved card is ever rendered in:
// brand, last four and expiry. No fingerprint, no issuing country, no billing
// address on file -- a billing screen needs none of it.
func billingPaymentMethodPayload(method billing.PaymentMethod, isDefault bool) map[string]any {
	return map[string]any{
		"id": method.ID, "brand": method.Brand, "last_four": method.LastFour,
		"expiry_month": method.ExpiryMonth, "expiry_year": method.ExpiryYear, "default": isDefault,
	}
}

// billingProviderFailure reports an upstream Stripe error. Only the message and the
// request id are logged: no customer record, no card, no invoice link.
func (s *Server) billingProviderFailure(w http.ResponseWriter, r *http.Request, logMessage string, err error) {
	s.logger.Error(logMessage, "error", err, "request_id", requestID(r.Context()))
	s.writeError(w, r, http.StatusBadGateway, "billing_provider_error", "Billing is temporarily unavailable", nil)
}

func billingCurrentStatus(access billingAccess) string {
	if access.subscription.Status != "" {
		return access.subscription.Status
	}
	return access.account.BillingStatus
}

func (s *Server) listBillingInvoices(w http.ResponseWriter, r *http.Request) {
	access, ok := s.billingAccessFor(w, r)
	if !ok {
		return
	}
	if !s.stripe.BillingEnabled() || access.account.StripeCustomerID == "" {
		// No provider, or no customer yet, means there is no invoice history to show.
		// That is an empty list, not an error: the screen still renders.
		s.writeDataMeta(w, http.StatusOK, []map[string]any{}, map[string]any{"count": 0, "provider": s.billingProviderName()})
		return
	}
	invoices, err := s.stripe.ListInvoices(r.Context(), access.account.StripeCustomerID, billingInvoiceListLimit)
	if err != nil {
		s.billingProviderFailure(w, r, "Stripe invoice list failed", err)
		return
	}
	items := make([]map[string]any, 0, len(invoices))
	for _, invoice := range invoices {
		items = append(items, map[string]any{
			"id": invoice.ID, "number": invoice.Number, "status": invoice.Status,
			"amount_due": invoice.AmountDue, "amount_paid": invoice.AmountPaid, "currency": invoice.Currency,
			"created":      billingTime(invoice.Created),
			"period_start": billingTime(invoice.PeriodStart), "period_end": billingTime(invoice.PeriodEnd),
			// Both links are Stripe's own, already signed and expiring. The PDF is
			// handed over as a link on purpose: proxying the bytes would put this
			// service in the middle of every download and buy nothing for it.
			"hosted_invoice_url": invoice.HostedInvoiceURL, "invoice_pdf": invoice.InvoicePDF,
		})
	}
	s.writeDataMeta(w, http.StatusOK, items, map[string]any{"count": len(items), "provider": "stripe"})
}

func (s *Server) listBillingPaymentMethods(w http.ResponseWriter, r *http.Request) {
	access, ok := s.billingAccessFor(w, r)
	if !ok {
		return
	}
	if !s.stripe.BillingEnabled() || access.account.StripeCustomerID == "" {
		s.writeDataMeta(w, http.StatusOK, []map[string]any{}, map[string]any{"count": 0, "provider": s.billingProviderName(), "default_payment_method_id": ""})
		return
	}
	methods, err := s.stripe.ListPaymentMethods(r.Context(), access.account.StripeCustomerID, billingPaymentMethodListLimit)
	if err != nil {
		s.billingProviderFailure(w, r, "Stripe payment method list failed", err)
		return
	}
	customer, err := s.stripe.RetrieveCustomer(r.Context(), access.account.StripeCustomerID)
	if err != nil {
		s.billingProviderFailure(w, r, "Stripe customer lookup failed", err)
		return
	}
	items := make([]map[string]any, 0, len(methods))
	for _, method := range methods {
		// The list was addressed by this account's own customer, so a card belonging
		// to anyone else cannot appear in it. The check stays anyway, next to the
		// only place that would be harmed if that ever stopped being true.
		if method.CustomerID != "" && method.CustomerID != access.account.StripeCustomerID {
			continue
		}
		items = append(items, billingPaymentMethodPayload(method, method.ID != "" && method.ID == customer.DefaultPaymentMethodID))
	}
	s.writeDataMeta(w, http.StatusOK, items, map[string]any{
		"count": len(items), "provider": "stripe", "default_payment_method_id": customer.DefaultPaymentMethodID,
	})
}

// createBillingSetupIntent hands the browser a SetupIntent client secret so
// Stripe.js can collect the card directly. A card number must never touch this
// server: taking one here would drag the whole service into PCI scope, and there is
// nothing this service could do with it that Stripe.js cannot do better.
func (s *Server) createBillingSetupIntent(w http.ResponseWriter, r *http.Request) {
	access, ok := s.billingAccessFor(w, r)
	if !ok {
		return
	}
	if !s.stripe.BillingEnabled() {
		if s.cfg.DemoMode {
			s.writeData(w, http.StatusOK, map[string]any{
				"demo": true, "client_secret": "", "status": "unavailable",
				"notice": "Local demo only. Stripe is not configured, so no card can be collected.",
			})
			return
		}
		s.writeError(w, r, http.StatusServiceUnavailable, "billing_not_configured", "Billing is not configured", nil)
		return
	}
	if access.account.StripeCustomerID == "" {
		s.writeError(w, r, http.StatusConflict, "billing_customer_missing", "This workspace has no billing customer yet; complete a checkout first", nil)
		return
	}
	idempotencyKey := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if idempotencyKey != "" && (len(idempotencyKey) < 8 || len(idempotencyKey) > 255) {
		s.writeError(w, r, http.StatusBadRequest, "idempotency_key_invalid", "Idempotency-Key must contain 8 to 255 characters", nil)
		return
	}
	intent, err := s.stripe.CreateSetupIntent(r.Context(), access.account.ID, access.account.StripeCustomerID, idempotencyKey)
	if err != nil {
		s.billingProviderFailure(w, r, "Stripe setup intent failed", err)
		return
	}
	// The client secret is the entire response on purpose. It is the browser's
	// authority to attach a card to this one customer, so it is never logged and
	// never stored, and no card detail comes back through this service at all.
	s.writeData(w, http.StatusCreated, map[string]any{"client_secret": intent.ClientSecret, "status": intent.Status})
}

// setDefaultBillingPaymentMethod promotes a card the browser just saved to the one
// future invoices are charged against.
func (s *Server) setDefaultBillingPaymentMethod(w http.ResponseWriter, r *http.Request) {
	access, ok := s.billingAccessFor(w, r)
	if !ok {
		return
	}
	var input billingPaymentMethodInput
	if !s.decodeJSON(w, r, &input) {
		return
	}
	paymentMethodID := strings.TrimSpace(input.PaymentMethodID)
	if !billingValidPaymentMethodID(paymentMethodID) {
		s.writeError(w, r, http.StatusUnprocessableEntity, "validation_failed", "A Stripe payment method id is required", map[string]string{"payment_method_id": "must be a Stripe payment method identifier"})
		return
	}
	if !s.stripe.BillingEnabled() {
		if s.cfg.DemoMode {
			s.writeData(w, http.StatusOK, map[string]any{"demo": true, "notice": "Local demo only. Stripe is not configured, so no card was changed."})
			return
		}
		s.writeError(w, r, http.StatusServiceUnavailable, "billing_not_configured", "Billing is not configured", nil)
		return
	}
	if access.account.StripeCustomerID == "" {
		s.writeError(w, r, http.StatusConflict, "billing_customer_missing", "This workspace has no billing customer yet; complete a checkout first", nil)
		return
	}
	method, err := s.stripe.RetrievePaymentMethod(r.Context(), paymentMethodID)
	if err != nil {
		if errors.Is(err, billing.ErrNotFound) {
			s.writeError(w, r, http.StatusNotFound, "payment_method_not_found", "Payment method not found", nil)
			return
		}
		s.billingProviderFailure(w, r, "Stripe payment method lookup failed", err)
		return
	}
	// The identifier arrived from a browser, so ownership is settled by Stripe's
	// answer rather than by the request. A card attached to another workspace's
	// customer is reported as missing and never as forbidden: a 403 here would
	// confirm to the caller that the identifier exists.
	if method.CustomerID == "" || method.CustomerID != access.account.StripeCustomerID {
		s.writeError(w, r, http.StatusNotFound, "payment_method_not_found", "Payment method not found", nil)
		return
	}
	if err := s.stripe.SetCustomerDefaultPaymentMethod(r.Context(), access.account.StripeCustomerID, method.ID); err != nil {
		s.billingProviderFailure(w, r, "Stripe default payment method update failed", err)
		return
	}
	// The customer default only governs invoices that have no subscription-level
	// default of their own, so the live subscription has to be pointed at the new
	// card too or the old one keeps being charged.
	if access.subscription.StripeSubscriptionID != "" {
		if _, err := s.stripe.SetSubscriptionDefaultPaymentMethod(r.Context(), access.subscription.StripeSubscriptionID, method.ID); err != nil {
			s.billingProviderFailure(w, r, "Stripe subscription payment method update failed", err)
			return
		}
	}
	s.writeData(w, http.StatusOK, billingPaymentMethodPayload(method, true))
}

func (s *Server) getBillingSubscriptionDetail(w http.ResponseWriter, r *http.Request) {
	access, ok := s.billingAccessFor(w, r)
	if !ok {
		return
	}
	if !s.stripe.BillingEnabled() || access.subscription.StripeSubscriptionID == "" {
		s.writeData(w, http.StatusOK, s.billingLocalSubscriptionPayload(access))
		return
	}
	detail, err := s.stripe.RetrieveSubscription(r.Context(), access.subscription.StripeSubscriptionID)
	if err != nil {
		if errors.Is(err, billing.ErrNotFound) {
			s.writeError(w, r, http.StatusNotFound, "subscription_not_found", "Subscription not found", nil)
			return
		}
		s.billingProviderFailure(w, r, "Stripe subscription lookup failed", err)
		return
	}
	s.writeData(w, http.StatusOK, s.billingSubscriptionPayload(detail, s.billingPaymentMethodInUse(r, access, detail), access.entitled))
}

// billingPaymentMethodInUse resolves the card the next invoice will actually be
// charged to: the subscription's own default when it has one, otherwise the
// customer default it falls back to. Failing to resolve it is not fatal -- the
// subscription detail is still worth showing without it.
func (s *Server) billingPaymentMethodInUse(r *http.Request, access billingAccess, detail billing.SubscriptionDetail) map[string]any {
	paymentMethodID := detail.DefaultPaymentMethodID
	if paymentMethodID == "" && access.account.StripeCustomerID != "" {
		customer, err := s.stripe.RetrieveCustomer(r.Context(), access.account.StripeCustomerID)
		if err != nil {
			s.logger.Warn("Stripe customer lookup failed", "error", err, "request_id", requestID(r.Context()))
			return nil
		}
		paymentMethodID = customer.DefaultPaymentMethodID
	}
	if paymentMethodID == "" {
		return nil
	}
	method, err := s.stripe.RetrievePaymentMethod(r.Context(), paymentMethodID)
	if err != nil {
		s.logger.Warn("Stripe payment method lookup failed", "error", err, "request_id", requestID(r.Context()))
		return nil
	}
	if method.CustomerID != "" && method.CustomerID != access.account.StripeCustomerID {
		return nil
	}
	return billingPaymentMethodPayload(method, true)
}

// cancelBillingSubscription schedules the cancellation for the end of the period
// the customer already paid for. Ending it on the spot throws away time they have
// been charged for, so it happens only when the request asks for it by name.
func (s *Server) cancelBillingSubscription(w http.ResponseWriter, r *http.Request) {
	access, ok := s.billingAccessFor(w, r)
	if !ok {
		return
	}
	var input billingCancelInput
	if r.ContentLength != 0 {
		if !s.decodeJSON(w, r, &input) {
			return
		}
	}
	if billingCurrentStatus(access) == "canceled" {
		s.writeError(w, r, http.StatusConflict, "subscription_not_active", "This subscription has already ended", nil)
		return
	}
	now := time.Now().UTC()
	if s.stripe.BillingEnabled() {
		if access.subscription.StripeSubscriptionID == "" {
			s.writeError(w, r, http.StatusNotFound, "subscription_not_found", "This workspace has no subscription to cancel", nil)
			return
		}
		var detail billing.SubscriptionDetail
		var err error
		if input.Immediate {
			detail, err = s.stripe.CancelSubscriptionNow(r.Context(), access.subscription.StripeSubscriptionID)
		} else {
			detail, err = s.stripe.SetSubscriptionCancellation(r.Context(), access.subscription.StripeSubscriptionID, true)
		}
		if err != nil {
			if errors.Is(err, billing.ErrNotFound) {
				s.writeError(w, r, http.StatusNotFound, "subscription_not_found", "Subscription not found", nil)
				return
			}
			s.billingProviderFailure(w, r, "Stripe subscription cancellation failed", err)
			return
		}
		if err := s.billingRecordSubscription(access.account.ID, detail, now); err != nil {
			s.storageFailure(w, r, err)
			return
		}
		s.writeData(w, http.StatusOK, s.billingSubscriptionPayload(detail, nil, s.hasEntitlement(access.account.ID)))
		return
	}
	if !s.cfg.DemoMode {
		s.writeError(w, r, http.StatusServiceUnavailable, "billing_not_configured", "Billing is not configured", nil)
		return
	}
	// With no provider to talk to, the same transition is applied to local state so
	// the cancel and resume flow stays exercisable end to end with zero credentials.
	if err := s.billingApplyLocalCancellation(access.account.ID, input.Immediate, now); err != nil {
		s.storageFailure(w, r, err)
		return
	}
	s.writeBillingLocalSubscription(w, r, access.account.ID)
}

// resumeBillingSubscription undoes a scheduled cancellation while the paid period
// is still running.
func (s *Server) resumeBillingSubscription(w http.ResponseWriter, r *http.Request) {
	access, ok := s.billingAccessFor(w, r)
	if !ok {
		return
	}
	if billingCurrentStatus(access) == "canceled" {
		// Once the period has run out there is nothing left to resume; the customer
		// has to subscribe again, which is a checkout and not an undo.
		s.writeError(w, r, http.StatusConflict, "subscription_not_resumable", "This subscription has already ended; start a new checkout to subscribe again", nil)
		return
	}
	now := time.Now().UTC()
	if s.stripe.BillingEnabled() {
		if access.subscription.StripeSubscriptionID == "" {
			s.writeError(w, r, http.StatusNotFound, "subscription_not_found", "This workspace has no subscription to resume", nil)
			return
		}
		detail, err := s.stripe.SetSubscriptionCancellation(r.Context(), access.subscription.StripeSubscriptionID, false)
		if err != nil {
			if errors.Is(err, billing.ErrNotFound) {
				s.writeError(w, r, http.StatusNotFound, "subscription_not_found", "Subscription not found", nil)
				return
			}
			s.billingProviderFailure(w, r, "Stripe subscription resume failed", err)
			return
		}
		if err := s.billingRecordSubscription(access.account.ID, detail, now); err != nil {
			s.storageFailure(w, r, err)
			return
		}
		s.writeData(w, http.StatusOK, s.billingSubscriptionPayload(detail, nil, s.hasEntitlement(access.account.ID)))
		return
	}
	if !s.cfg.DemoMode {
		s.writeError(w, r, http.StatusServiceUnavailable, "billing_not_configured", "Billing is not configured", nil)
		return
	}
	if err := s.billingApplyLocalResume(access.account.ID, now); err != nil {
		s.storageFailure(w, r, err)
		return
	}
	s.writeBillingLocalSubscription(w, r, access.account.ID)
}

// billingRecordSubscription writes back what Stripe just reported, so the screen
// the caller returns to is correct immediately instead of only once the webhook
// lands. ProviderEventCreatedAt is deliberately left alone: it is the webhook's own
// ordering marker, and advancing it here would make a later, legitimate event look
// stale and be dropped.
func (s *Server) billingRecordSubscription(accountID string, detail billing.SubscriptionDetail, now time.Time) error {
	return s.store.Update(func(state *model.State) error {
		account, ok := findAccount(state, accountID)
		if !ok {
			return errors.New("account not found")
		}
		subscription := ensureSubscription(state, accountID, now)
		if detail.ID != "" {
			subscription.StripeSubscriptionID = detail.ID
		}
		if detail.CustomerID != "" {
			subscription.StripeCustomerID = detail.CustomerID
		}
		if detail.Status != "" {
			subscription.Status = detail.Status
			account.BillingStatus = detail.Status
			account.UpdatedAt = now
		}
		subscription.CancelAtPeriodEnd = detail.CancelAtPeriodEnd
		if periodEnd := billingTime(detail.CurrentPeriodEnd); periodEnd != nil {
			subscription.CurrentPeriodEnd = periodEnd
		}
		subscription.UpdatedAt = now
		return nil
	})
}

func (s *Server) billingApplyLocalCancellation(accountID string, immediate bool, now time.Time) error {
	return s.store.Update(func(state *model.State) error {
		account, ok := findAccount(state, accountID)
		if !ok {
			return errors.New("account not found")
		}
		subscription := ensureSubscription(state, accountID, now)
		if immediate {
			subscription.Status = "canceled"
			subscription.CancelAtPeriodEnd = false
			account.BillingStatus = "canceled"
			account.UpdatedAt = now
		} else {
			// A cancellation scheduled for the period end changes nothing about the
			// entitlement today. The customer paid through the end of the period and
			// keeps everything until then.
			subscription.CancelAtPeriodEnd = true
		}
		subscription.UpdatedAt = now
		return nil
	})
}

func (s *Server) billingApplyLocalResume(accountID string, now time.Time) error {
	return s.store.Update(func(state *model.State) error {
		if _, ok := findAccount(state, accountID); !ok {
			return errors.New("account not found")
		}
		subscription := ensureSubscription(state, accountID, now)
		subscription.CancelAtPeriodEnd = false
		subscription.UpdatedAt = now
		return nil
	})
}

// writeBillingLocalSubscription re-reads the account after a local change so the
// response describes stored state rather than what the handler hoped it wrote.
func (s *Server) writeBillingLocalSubscription(w http.ResponseWriter, r *http.Request, accountID string) {
	var access billingAccess
	_ = s.store.View(func(state *model.State) error {
		if candidate, ok := findAccount(state, accountID); ok {
			access.account = *candidate
		}
		for _, subscription := range state.Subscriptions {
			if subscription.AccountID == accountID {
				access.subscription = billingCloneSubscription(subscription)
			}
		}
		return nil
	})
	access.entitled = s.hasEntitlement(accountID)
	s.writeData(w, http.StatusOK, s.billingLocalSubscriptionPayload(access))
}

func (s *Server) billingSubscriptionPayload(detail billing.SubscriptionDetail, paymentMethod map[string]any, entitled bool) map[string]any {
	amountCents := detail.PlanAmountCents
	currency := detail.PlanCurrency
	interval := detail.PlanInterval
	// A subscription whose price item did not come back still has a plan as far as
	// the product is concerned, so the configured plan fills the gap.
	if amountCents == 0 {
		amountCents = int64(s.cfg.PlanAmountCents)
	}
	if currency == "" {
		currency = s.cfg.PlanCurrency
	}
	if interval == "" {
		interval = "month"
	}
	return map[string]any{
		"status": detail.Status, "current_period_end": billingTime(detail.CurrentPeriodEnd),
		"cancel_at_period_end": detail.CancelAtPeriodEnd, "entitled": entitled, "source": "stripe",
		"plan":           map[string]any{"code": "starter_17", "unit_amount": amountCents, "currency": currency, "interval": interval},
		"payment_method": paymentMethod,
	}
}

// billingLocalSubscriptionPayload answers from stored state alone. It is what a
// deployment with no Stripe credentials returns, and it is the same shape the
// Stripe-backed answer uses so a screen needs one renderer.
func (s *Server) billingLocalSubscriptionPayload(access billingAccess) map[string]any {
	status := billingCurrentStatus(access)
	return map[string]any{
		"status": status, "current_period_end": access.subscription.CurrentPeriodEnd,
		"cancel_at_period_end": access.subscription.CancelAtPeriodEnd, "entitled": access.entitled,
		"source":         s.billingLocalSource(),
		"plan":           map[string]any{"code": "starter_17", "unit_amount": int64(s.cfg.PlanAmountCents), "currency": s.cfg.PlanCurrency, "interval": "month"},
		"payment_method": nil,
	}
}

// billingValidPaymentMethodID rejects anything not shaped like a Stripe payment
// method identifier before it can reach the provider or a request path. The value
// arrives straight from a browser, so it is checked before it is trusted for
// anything at all.
func billingValidPaymentMethodID(value string) bool {
	if !strings.HasPrefix(value, "pm_") || len(value) > 255 {
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
