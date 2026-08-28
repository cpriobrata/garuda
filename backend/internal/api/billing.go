package api

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

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
