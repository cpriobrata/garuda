package api

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"garuda/backend/internal/billing"
	"garuda/backend/internal/model"
	"garuda/backend/internal/store"
)

// billingStripeCall is one request the handlers made to Stripe. The tests assert
// on these as much as on the responses: the point of most of these routes is what
// they ask the provider, and which customer they ask it about.
type billingStripeCall struct {
	method string
	path   string
	query  url.Values
	form   url.Values
}

type billingStripeStub struct {
	server  *httptest.Server
	mutex   sync.Mutex
	calls   []billingStripeCall
	respond func(billingStripeCall) (int, string)
}

func newBillingStripeStub(t *testing.T, respond func(billingStripeCall) (int, string)) *billingStripeStub {
	t.Helper()
	stub := &billingStripeStub{respond: respond}
	stub.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(io.LimitReader(r.Body, 1<<20))
		form, _ := url.ParseQuery(string(body))
		call := billingStripeCall{method: r.Method, path: r.URL.Path, query: r.URL.Query(), form: form}
		stub.mutex.Lock()
		stub.calls = append(stub.calls, call)
		stub.mutex.Unlock()
		status, payload := http.StatusOK, "{}"
		if stub.respond != nil {
			status, payload = stub.respond(call)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = io.WriteString(w, payload)
	}))
	t.Cleanup(stub.server.Close)
	return stub
}

func (stub *billingStripeStub) recorded() []billingStripeCall {
	stub.mutex.Lock()
	defer stub.mutex.Unlock()
	return append([]billingStripeCall(nil), stub.calls...)
}

func (stub *billingStripeStub) find(method, path string) (billingStripeCall, bool) {
	for _, call := range stub.recorded() {
		if call.method == method && call.path == path {
			return call, true
		}
	}
	return billingStripeCall{}, false
}

// billingUseStripe points the server at the stub with a test-mode secret key. Live
// keys travel the identical code path; only the credential differs.
func billingUseStripe(server *Server, stub *billingStripeStub) {
	server.stripe = billing.NewStripe("sk_test_lane", "whsec_lane", "price_lane", stub.server.URL, "https://app.test/success", "https://app.test/cancel")
}

func seedBillingWorkspace(t *testing.T, dataStore *store.FileStore, accountID, customerID, subscriptionID, billingStatus string) Identity {
	t.Helper()
	now := time.Now().UTC()
	periodEnd := now.Add(20 * 24 * time.Hour)
	ownerID := "usr_owner_" + accountID
	if err := dataStore.Update(func(state *model.State) error {
		state.Accounts = append(state.Accounts, model.Account{
			ID: accountID, Name: accountID, Plan: "starter_17", BillingStatus: billingStatus,
			StripeCustomerID: customerID, CreatedAt: now, UpdatedAt: now,
		})
		state.Users = append(state.Users, model.User{
			ID: ownerID, AccountID: accountID, Name: "Owner", Email: ownerID + "@example.test",
			Role: "owner", CreatedAt: now, UpdatedAt: now,
		})
		if subscriptionID != "" {
			state.Subscriptions = append(state.Subscriptions, model.Subscription{
				ID: "sub_local_" + accountID, AccountID: accountID, StripeSubscriptionID: subscriptionID,
				StripeCustomerID: customerID, Status: billingStatus, Plan: "starter_17",
				CurrentPeriodEnd: &periodEnd, CreatedAt: now, UpdatedAt: now,
			})
		}
		return nil
	}); err != nil {
		t.Fatalf("seed billing workspace: %v", err)
	}
	return Identity{UserID: ownerID, AccountID: accountID, Email: ownerID + "@example.test", Role: "owner"}
}

func billingRequest(t *testing.T, method, target string, identity Identity, body any) *http.Request {
	t.Helper()
	var request *http.Request
	if body == nil {
		request = httptest.NewRequest(method, target, nil)
	} else {
		payload, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal body: %v", err)
		}
		request = httptest.NewRequest(method, target, bytes.NewReader(payload))
		request.Header.Set("Content-Type", "application/json")
	}
	return request.WithContext(context.WithValue(request.Context(), identityKey, identity))
}

func billingDecode(t *testing.T, response *httptest.ResponseRecorder, status int, into any) map[string]any {
	t.Helper()
	if response.Code != status {
		t.Fatalf("expected status %d, got %d: %s", status, response.Code, response.Body.String())
	}
	var envelope struct {
		Data json.RawMessage `json:"data"`
		Meta map[string]any  `json:"meta"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode envelope: %v", err)
	}
	if into != nil {
		if err := json.Unmarshal(envelope.Data, into); err != nil {
			t.Fatalf("decode data: %v (%s)", err, string(envelope.Data))
		}
	}
	return envelope.Meta
}

func billingStoredSubscription(t *testing.T, dataStore *store.FileStore, accountID string) model.Subscription {
	t.Helper()
	var found model.Subscription
	if err := dataStore.View(func(state *model.State) error {
		for _, subscription := range state.Subscriptions {
			if subscription.AccountID == accountID {
				found = billingCloneSubscription(subscription)
			}
		}
		return nil
	}); err != nil {
		t.Fatalf("read subscription: %v", err)
	}
	return found
}

func billingStoredAccount(t *testing.T, dataStore *store.FileStore, accountID string) model.Account {
	t.Helper()
	var found model.Account
	if err := dataStore.View(func(state *model.State) error {
		if account, ok := findAccount(state, accountID); ok {
			found = *account
		}
		return nil
	}); err != nil {
		t.Fatalf("read account: %v", err)
	}
	return found
}

const billingInvoiceListPayload = `{"data":[{"id":"in_alpha","number":"GAR-0001","status":"paid","amount_due":1700,"amount_paid":1700,"currency":"usd","created":1767139200,"period_start":1767139200,"period_end":1769817600,"hosted_invoice_url":"https://invoice.stripe.test/hosted/in_alpha","invoice_pdf":"https://invoice.stripe.test/pdf/in_alpha"}]}`

// A saved card as Stripe really returns it: far more than a billing screen may
// show. The fingerprint, the issuing country and the address on file must not
// survive the handler.
const billingCardPayload = `{"id":"pm_alpha","customer":"cus_alpha","billing_details":{"address":{"line1":"12 Harbour Road","country":"SG","postal_code":"049213"},"email":"owner@example.test"},"card":{"brand":"visa","last4":"4242","exp_month":11,"exp_year":2031,"fingerprint":"XyZfingerPrint01","country":"SG","funding":"credit"}}`

func TestBillingInvoicesReturnStripeLinksScopedToTheCallersOwnCustomer(t *testing.T) {
	server, dataStore := newTestServer(t)
	stub := newBillingStripeStub(t, func(call billingStripeCall) (int, string) {
		if call.path == "/invoices" && call.query.Get("customer") == "cus_alpha" {
			return http.StatusOK, billingInvoiceListPayload
		}
		return http.StatusOK, `{"data":[{"id":"in_other","number":"GAR-9999","status":"paid","hosted_invoice_url":"https://invoice.stripe.test/hosted/in_other","invoice_pdf":"https://invoice.stripe.test/pdf/in_other"}]}`
	})
	billingUseStripe(server, stub)
	owner := seedBillingWorkspace(t, dataStore, "org_alpha", "cus_alpha", "sub_alpha", "active")
	seedBillingWorkspace(t, dataStore, "org_beta", "cus_beta", "sub_beta", "active")

	response := httptest.NewRecorder()
	server.listBillingInvoices(response, billingRequest(t, http.MethodGet, "/v1/billing/invoices", owner, nil))

	var invoices []map[string]any
	meta := billingDecode(t, response, http.StatusOK, &invoices)
	if len(invoices) != 1 || invoices[0]["id"] != "in_alpha" {
		t.Fatalf("expected the caller's own invoice, got %v", invoices)
	}
	if invoices[0]["number"] != "GAR-0001" || invoices[0]["status"] != "paid" || invoices[0]["currency"] != "usd" {
		t.Fatalf("expected number, status and currency to be reported, got %v", invoices[0])
	}
	if invoices[0]["amount_due"] != float64(1700) || invoices[0]["amount_paid"] != float64(1700) {
		t.Fatalf("expected invoice amounts to be reported, got %v", invoices[0])
	}
	if invoices[0]["period_start"] == nil || invoices[0]["period_end"] == nil {
		t.Fatalf("expected the billing period to be reported, got %v", invoices[0])
	}
	if invoices[0]["hosted_invoice_url"] != "https://invoice.stripe.test/hosted/in_alpha" {
		t.Fatalf("expected Stripe's hosted invoice link, got %v", invoices[0]["hosted_invoice_url"])
	}
	if invoices[0]["invoice_pdf"] != "https://invoice.stripe.test/pdf/in_alpha" {
		t.Fatalf("expected Stripe's PDF link rather than a proxied download, got %v", invoices[0]["invoice_pdf"])
	}
	if meta["provider"] != "stripe" {
		t.Fatalf("expected the provider to be reported as stripe, got %v", meta["provider"])
	}

	calls := stub.recorded()
	if len(calls) != 1 {
		t.Fatalf("expected exactly one Stripe call, got %d", len(calls))
	}
	if calls[0].method != http.MethodGet || calls[0].path != "/invoices" {
		t.Fatalf("expected a GET of the invoice list, got %s %s", calls[0].method, calls[0].path)
	}
	if got := calls[0].query.Get("customer"); got != "cus_alpha" {
		t.Fatalf("expected the caller's own customer to scope the query, got %q", got)
	}
	// Downloading the PDF must stay a browser-to-Stripe affair.
	for _, call := range calls {
		if strings.Contains(call.path, "pdf") {
			t.Fatalf("expected no PDF bytes to be proxied, but the service fetched %s", call.path)
		}
	}
}

func TestBillingPaymentMethodsExposeOnlyBrandLastFourAndExpiry(t *testing.T) {
	server, dataStore := newTestServer(t)
	stub := newBillingStripeStub(t, func(call billingStripeCall) (int, string) {
		switch {
		case call.path == "/payment_methods":
			return http.StatusOK, `{"data":[` + billingCardPayload + `]}`
		case call.path == "/customers/cus_alpha":
			return http.StatusOK, `{"id":"cus_alpha","invoice_settings":{"default_payment_method":"pm_alpha"}}`
		}
		return http.StatusNotFound, `{"error":{"message":"no such resource"}}`
	})
	billingUseStripe(server, stub)
	owner := seedBillingWorkspace(t, dataStore, "org_alpha", "cus_alpha", "sub_alpha", "active")

	response := httptest.NewRecorder()
	server.listBillingPaymentMethods(response, billingRequest(t, http.MethodGet, "/v1/billing/payment-methods", owner, nil))

	var methods []map[string]any
	meta := billingDecode(t, response, http.StatusOK, &methods)
	if len(methods) != 1 {
		t.Fatalf("expected one saved card, got %v", methods)
	}
	card := methods[0]
	if card["brand"] != "visa" || card["last_four"] != "4242" || card["expiry_month"] != float64(11) || card["expiry_year"] != float64(2031) {
		t.Fatalf("expected brand, last four and expiry, got %v", card)
	}
	if card["default"] != true {
		t.Fatalf("expected the customer default card to be flagged, got %v", card["default"])
	}
	if meta["default_payment_method_id"] != "pm_alpha" {
		t.Fatalf("expected the default payment method id in meta, got %v", meta["default_payment_method_id"])
	}
	body := response.Body.String()
	for _, leaked := range []string{"fingerprint", "XyZfingerPrint01", "Harbour Road", "049213", "funding"} {
		if strings.Contains(body, leaked) {
			t.Fatalf("expected %q to be dropped from the card payload, got %s", leaked, body)
		}
	}
}

func TestBillingSetupIntentReturnsOnlyClientSecretAndNeverCarriesCardData(t *testing.T) {
	server, dataStore := newTestServer(t)
	stub := newBillingStripeStub(t, func(call billingStripeCall) (int, string) {
		if call.path == "/setup_intents" {
			return http.StatusOK, `{"id":"seti_alpha","client_secret":"seti_alpha_secret_browseronly","status":"requires_payment_method"}`
		}
		return http.StatusNotFound, `{"error":{"message":"no such resource"}}`
	})
	billingUseStripe(server, stub)
	owner := seedBillingWorkspace(t, dataStore, "org_alpha", "cus_alpha", "sub_alpha", "active")

	response := httptest.NewRecorder()
	server.createBillingSetupIntent(response, billingRequest(t, http.MethodPost, "/v1/billing/payment-methods/setup-intent", owner, nil))

	var intent map[string]any
	billingDecode(t, response, http.StatusCreated, &intent)
	if intent["client_secret"] != "seti_alpha_secret_browseronly" {
		t.Fatalf("expected the client secret to be returned, got %v", intent)
	}
	if intent["status"] != "requires_payment_method" {
		t.Fatalf("expected the intent status, got %v", intent["status"])
	}

	call, ok := stub.find(http.MethodPost, "/setup_intents")
	if !ok {
		t.Fatal("expected a SetupIntent to be created")
	}
	if call.form.Get("customer") != "cus_alpha" {
		t.Fatalf("expected the intent to be scoped to the caller's customer, got %q", call.form.Get("customer"))
	}
	if call.form.Get("payment_method_types[0]") != "card" || call.form.Get("usage") != "off_session" {
		t.Fatalf("expected an off-session card intent, got %v", call.form)
	}
	if call.form.Get("metadata[account_id]") != "org_alpha" {
		t.Fatalf("expected the account id in metadata, got %q", call.form.Get("metadata[account_id]"))
	}
	// The whole reason a SetupIntent exists is that the card is collected by
	// Stripe.js in the browser. Nothing card-shaped may be sent from here.
	for key := range call.form {
		if strings.Contains(key, "number") || strings.Contains(key, "cvc") || strings.HasPrefix(key, "card") {
			t.Fatalf("expected no card data in the SetupIntent request, found %q", key)
		}
	}
}

func TestBillingDefaultPaymentMethodRejectsACardOwnedByAnotherAccount(t *testing.T) {
	server, dataStore := newTestServer(t)
	stub := newBillingStripeStub(t, func(call billingStripeCall) (int, string) {
		if call.path == "/payment_methods/pm_beta" {
			// Stripe answers happily for any payment method under our platform key.
			// Ownership has to be decided here.
			return http.StatusOK, `{"id":"pm_beta","customer":"cus_beta","card":{"brand":"visa","last4":"1881","exp_month":4,"exp_year":2030}}`
		}
		return http.StatusOK, `{}`
	})
	billingUseStripe(server, stub)
	owner := seedBillingWorkspace(t, dataStore, "org_alpha", "cus_alpha", "sub_alpha", "active")
	seedBillingWorkspace(t, dataStore, "org_beta", "cus_beta", "sub_beta", "active")

	response := httptest.NewRecorder()
	request := billingRequest(t, http.MethodPost, "/v1/billing/payment-methods/default", owner, map[string]string{"payment_method_id": "pm_beta"})
	server.setDefaultBillingPaymentMethod(response, request)

	if response.Code != http.StatusNotFound {
		t.Fatalf("expected a cross-account card to read as missing, got %d: %s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "payment_method_not_found") {
		t.Fatalf("expected payment_method_not_found, got %s", response.Body.String())
	}
	for _, call := range stub.recorded() {
		if call.method == http.MethodPost {
			t.Fatalf("expected no write to Stripe for a foreign card, got %s %s", call.method, call.path)
		}
	}
}

func TestBillingDefaultPaymentMethodPromotesCardOnCustomerAndSubscription(t *testing.T) {
	server, dataStore := newTestServer(t)
	stub := newBillingStripeStub(t, func(call billingStripeCall) (int, string) {
		switch call.path {
		case "/payment_methods/pm_alpha":
			return http.StatusOK, billingCardPayload
		case "/customers/cus_alpha":
			return http.StatusOK, `{"id":"cus_alpha","invoice_settings":{"default_payment_method":"pm_alpha"}}`
		case "/subscriptions/sub_alpha":
			return http.StatusOK, `{"id":"sub_alpha","status":"active","customer":"cus_alpha","default_payment_method":"pm_alpha"}`
		}
		return http.StatusNotFound, `{"error":{"message":"no such resource"}}`
	})
	billingUseStripe(server, stub)
	owner := seedBillingWorkspace(t, dataStore, "org_alpha", "cus_alpha", "sub_alpha", "active")

	response := httptest.NewRecorder()
	request := billingRequest(t, http.MethodPost, "/v1/billing/payment-methods/default", owner, map[string]string{"payment_method_id": "pm_alpha"})
	server.setDefaultBillingPaymentMethod(response, request)

	var card map[string]any
	billingDecode(t, response, http.StatusOK, &card)
	if card["default"] != true || card["last_four"] != "4242" {
		t.Fatalf("expected the promoted card to come back as the default, got %v", card)
	}

	customerCall, ok := stub.find(http.MethodPost, "/customers/cus_alpha")
	if !ok {
		t.Fatal("expected the customer default to be updated")
	}
	if customerCall.form.Get("invoice_settings[default_payment_method]") != "pm_alpha" {
		t.Fatalf("expected the customer invoice default to be set, got %v", customerCall.form)
	}
	subscriptionCall, ok := stub.find(http.MethodPost, "/subscriptions/sub_alpha")
	if !ok {
		t.Fatal("expected the live subscription to be pointed at the new card")
	}
	if subscriptionCall.form.Get("default_payment_method") != "pm_alpha" {
		t.Fatalf("expected the subscription default to be set, got %v", subscriptionCall.form)
	}
}

func TestBillingCancelSchedulesAtPeriodEndAndKeepsEntitlement(t *testing.T) {
	server, dataStore := newTestServer(t)
	server.cfg.DemoMode = false
	stub := newBillingStripeStub(t, func(call billingStripeCall) (int, string) {
		if call.path == "/subscriptions/sub_alpha" {
			return http.StatusOK, `{"id":"sub_alpha","status":"active","customer":"cus_alpha","current_period_end":1769817600,"cancel_at_period_end":true}`
		}
		return http.StatusNotFound, `{"error":{"message":"no such resource"}}`
	})
	billingUseStripe(server, stub)
	owner := seedBillingWorkspace(t, dataStore, "org_alpha", "cus_alpha", "sub_alpha", "active")

	response := httptest.NewRecorder()
	server.cancelBillingSubscription(response, billingRequest(t, http.MethodPost, "/v1/billing/subscription/cancel", owner, nil))

	var payload map[string]any
	billingDecode(t, response, http.StatusOK, &payload)
	if payload["cancel_at_period_end"] != true {
		t.Fatalf("expected the cancellation to be scheduled, got %v", payload)
	}
	if payload["status"] != "active" || payload["entitled"] != true {
		t.Fatalf("expected the customer to keep the period they paid for, got %v", payload)
	}
	if payload["current_period_end"] == nil {
		t.Fatalf("expected the period end to be reported, got %v", payload)
	}

	call, ok := stub.find(http.MethodPost, "/subscriptions/sub_alpha")
	if !ok {
		t.Fatal("expected the subscription to be updated at Stripe")
	}
	if call.form.Get("cancel_at_period_end") != "true" {
		t.Fatalf("expected cancel_at_period_end=true, got %v", call.form)
	}
	for _, recorded := range stub.recorded() {
		if recorded.method == http.MethodDelete {
			t.Fatalf("expected no immediate cancellation by default, got %s %s", recorded.method, recorded.path)
		}
	}

	stored := billingStoredSubscription(t, dataStore, "org_alpha")
	if !stored.CancelAtPeriodEnd {
		t.Fatal("expected the scheduled cancellation to be recorded locally")
	}
	if account := billingStoredAccount(t, dataStore, "org_alpha"); account.BillingStatus != "active" {
		t.Fatalf("expected billing status to stay active until the period ends, got %q", account.BillingStatus)
	}
	if !server.hasEntitlement("org_alpha") {
		t.Fatal("expected entitlement to survive a cancellation scheduled for the period end")
	}
}

func TestBillingCancelImmediatelyIsOptInAndRevokesEntitlement(t *testing.T) {
	server, dataStore := newTestServer(t)
	server.cfg.DemoMode = false
	stub := newBillingStripeStub(t, func(call billingStripeCall) (int, string) {
		if call.method == http.MethodDelete && call.path == "/subscriptions/sub_alpha" {
			return http.StatusOK, `{"id":"sub_alpha","status":"canceled","customer":"cus_alpha","cancel_at_period_end":false}`
		}
		return http.StatusNotFound, `{"error":{"message":"no such resource"}}`
	})
	billingUseStripe(server, stub)
	owner := seedBillingWorkspace(t, dataStore, "org_alpha", "cus_alpha", "sub_alpha", "active")

	response := httptest.NewRecorder()
	request := billingRequest(t, http.MethodPost, "/v1/billing/subscription/cancel", owner, map[string]bool{"immediate": true})
	server.cancelBillingSubscription(response, request)

	var payload map[string]any
	billingDecode(t, response, http.StatusOK, &payload)
	if payload["status"] != "canceled" || payload["entitled"] != false {
		t.Fatalf("expected an immediate cancellation to end the entitlement, got %v", payload)
	}
	if _, ok := stub.find(http.MethodDelete, "/subscriptions/sub_alpha"); !ok {
		t.Fatalf("expected an immediate cancellation to delete the subscription, got %v", stub.recorded())
	}
	if account := billingStoredAccount(t, dataStore, "org_alpha"); account.BillingStatus != "canceled" {
		t.Fatalf("expected the account to be recorded as canceled, got %q", account.BillingStatus)
	}
	if server.hasEntitlement("org_alpha") {
		t.Fatal("expected entitlement to end with an immediate cancellation")
	}
}

func TestBillingResumeClearsAScheduledCancellation(t *testing.T) {
	server, dataStore := newTestServer(t)
	stub := newBillingStripeStub(t, func(call billingStripeCall) (int, string) {
		if call.path == "/subscriptions/sub_alpha" {
			return http.StatusOK, `{"id":"sub_alpha","status":"active","customer":"cus_alpha","current_period_end":1769817600,"cancel_at_period_end":false}`
		}
		return http.StatusNotFound, `{"error":{"message":"no such resource"}}`
	})
	billingUseStripe(server, stub)
	owner := seedBillingWorkspace(t, dataStore, "org_alpha", "cus_alpha", "sub_alpha", "active")
	if err := dataStore.Update(func(state *model.State) error {
		for index := range state.Subscriptions {
			if state.Subscriptions[index].AccountID == "org_alpha" {
				state.Subscriptions[index].CancelAtPeriodEnd = true
			}
		}
		return nil
	}); err != nil {
		t.Fatalf("schedule cancellation: %v", err)
	}

	response := httptest.NewRecorder()
	server.resumeBillingSubscription(response, billingRequest(t, http.MethodPost, "/v1/billing/subscription/resume", owner, nil))

	var payload map[string]any
	billingDecode(t, response, http.StatusOK, &payload)
	if payload["cancel_at_period_end"] != false || payload["status"] != "active" {
		t.Fatalf("expected the subscription to continue, got %v", payload)
	}
	call, ok := stub.find(http.MethodPost, "/subscriptions/sub_alpha")
	if !ok {
		t.Fatal("expected the subscription to be updated at Stripe")
	}
	if call.form.Get("cancel_at_period_end") != "false" {
		t.Fatalf("expected cancel_at_period_end=false, got %v", call.form)
	}
	if stored := billingStoredSubscription(t, dataStore, "org_alpha"); stored.CancelAtPeriodEnd {
		t.Fatal("expected the scheduled cancellation to be cleared locally")
	}
}

func TestBillingResumeRefusesAnEndedSubscription(t *testing.T) {
	server, dataStore := newTestServer(t)
	server.cfg.DemoMode = false
	stub := newBillingStripeStub(t, func(billingStripeCall) (int, string) { return http.StatusOK, `{}` })
	billingUseStripe(server, stub)
	owner := seedBillingWorkspace(t, dataStore, "org_alpha", "cus_alpha", "sub_alpha", "canceled")

	response := httptest.NewRecorder()
	server.resumeBillingSubscription(response, billingRequest(t, http.MethodPost, "/v1/billing/subscription/resume", owner, nil))

	if response.Code != http.StatusConflict || !strings.Contains(response.Body.String(), "subscription_not_resumable") {
		t.Fatalf("expected an ended subscription to be unresumable, got %d: %s", response.Code, response.Body.String())
	}
	if len(stub.recorded()) != 0 {
		t.Fatalf("expected no Stripe call for an ended subscription, got %v", stub.recorded())
	}
}

func TestBillingSubscriptionDetailReportsPlanPeriodAndCardInUse(t *testing.T) {
	server, dataStore := newTestServer(t)
	stub := newBillingStripeStub(t, func(call billingStripeCall) (int, string) {
		switch call.path {
		case "/subscriptions/sub_alpha":
			// The period lives on the subscription item here, as newer Stripe API
			// versions report it. The detail must read either shape.
			return http.StatusOK, `{"id":"sub_alpha","status":"active","customer":"cus_alpha","cancel_at_period_end":true,"default_payment_method":"pm_alpha","items":{"data":[{"current_period_end":1769817600,"price":{"unit_amount":1700,"currency":"usd","recurring":{"interval":"month"}}}]}}`
		case "/payment_methods/pm_alpha":
			return http.StatusOK, billingCardPayload
		}
		return http.StatusNotFound, `{"error":{"message":"no such resource"}}`
	})
	billingUseStripe(server, stub)
	owner := seedBillingWorkspace(t, dataStore, "org_alpha", "cus_alpha", "sub_alpha", "active")

	response := httptest.NewRecorder()
	server.getBillingSubscriptionDetail(response, billingRequest(t, http.MethodGet, "/v1/billing/subscription/detail", owner, nil))

	var payload map[string]any
	billingDecode(t, response, http.StatusOK, &payload)
	if payload["status"] != "active" || payload["cancel_at_period_end"] != true {
		t.Fatalf("expected status and the scheduled cancellation, got %v", payload)
	}
	periodEnd, _ := payload["current_period_end"].(string)
	if !strings.HasPrefix(periodEnd, "2026-01-31") {
		t.Fatalf("expected the period end read from the subscription item, got %v", payload["current_period_end"])
	}
	plan, _ := payload["plan"].(map[string]any)
	if plan["unit_amount"] != float64(1700) || plan["currency"] != "usd" || plan["interval"] != "month" {
		t.Fatalf("expected the plan amount and currency from Stripe, got %v", plan)
	}
	card, _ := payload["payment_method"].(map[string]any)
	if card["brand"] != "visa" || card["last_four"] != "4242" || card["expiry_year"] != float64(2031) {
		t.Fatalf("expected the card in use, got %v", payload["payment_method"])
	}
	if strings.Contains(response.Body.String(), "fingerprint") {
		t.Fatalf("expected no card fingerprint in the detail, got %s", response.Body.String())
	}
}

func TestBillingDegradesCleanlyWithoutStripeCredentials(t *testing.T) {
	// newTestServer configures no Stripe credentials at all, which is how the product
	// has to be able to run.
	server, dataStore := newTestServer(t)
	owner := seedBillingWorkspace(t, dataStore, "org_alpha", "", "", "active")
	if server.stripe.BillingEnabled() {
		t.Fatal("expected the test server to have no Stripe credentials")
	}

	invoices := httptest.NewRecorder()
	server.listBillingInvoices(invoices, billingRequest(t, http.MethodGet, "/v1/billing/invoices", owner, nil))
	var invoiceItems []map[string]any
	invoiceMeta := billingDecode(t, invoices, http.StatusOK, &invoiceItems)
	if len(invoiceItems) != 0 || invoiceMeta["provider"] != "demo" {
		t.Fatalf("expected an empty invoice history marked as demo, got %v %v", invoiceItems, invoiceMeta)
	}

	cards := httptest.NewRecorder()
	server.listBillingPaymentMethods(cards, billingRequest(t, http.MethodGet, "/v1/billing/payment-methods", owner, nil))
	var cardItems []map[string]any
	billingDecode(t, cards, http.StatusOK, &cardItems)
	if len(cardItems) != 0 {
		t.Fatalf("expected no saved cards without a provider, got %v", cardItems)
	}

	intent := httptest.NewRecorder()
	server.createBillingSetupIntent(intent, billingRequest(t, http.MethodPost, "/v1/billing/payment-methods/setup-intent", owner, nil))
	var intentPayload map[string]any
	billingDecode(t, intent, http.StatusOK, &intentPayload)
	if intentPayload["demo"] != true || intentPayload["client_secret"] != "" {
		t.Fatalf("expected a demo setup intent with no client secret, got %v", intentPayload)
	}

	cancel := httptest.NewRecorder()
	server.cancelBillingSubscription(cancel, billingRequest(t, http.MethodPost, "/v1/billing/subscription/cancel", owner, nil))
	var cancelPayload map[string]any
	billingDecode(t, cancel, http.StatusOK, &cancelPayload)
	if cancelPayload["cancel_at_period_end"] != true {
		t.Fatalf("expected the local cancellation to be scheduled, got %v", cancelPayload)
	}
	if !billingStoredSubscription(t, dataStore, "org_alpha").CancelAtPeriodEnd {
		t.Fatal("expected the demo cancellation to be stored")
	}

	resume := httptest.NewRecorder()
	server.resumeBillingSubscription(resume, billingRequest(t, http.MethodPost, "/v1/billing/subscription/resume", owner, nil))
	var resumePayload map[string]any
	billingDecode(t, resume, http.StatusOK, &resumePayload)
	if resumePayload["cancel_at_period_end"] != false {
		t.Fatalf("expected the local cancellation to be undone, got %v", resumePayload)
	}
	if billingStoredSubscription(t, dataStore, "org_alpha").CancelAtPeriodEnd {
		t.Fatal("expected the demo resume to be stored")
	}

	detail := httptest.NewRecorder()
	server.getBillingSubscriptionDetail(detail, billingRequest(t, http.MethodGet, "/v1/billing/subscription/detail", owner, nil))
	var detailPayload map[string]any
	billingDecode(t, detail, http.StatusOK, &detailPayload)
	if detailPayload["source"] != "demo" || detailPayload["payment_method"] != nil {
		t.Fatalf("expected a locally sourced detail with no card, got %v", detailPayload)
	}
	plan, _ := detailPayload["plan"].(map[string]any)
	if plan["interval"] != "month" {
		t.Fatalf("expected the configured plan to fill in, got %v", plan)
	}
}

func TestBillingWithoutStripeAndWithoutDemoModeRefusesRatherThanPretending(t *testing.T) {
	server, dataStore := newTestServer(t)
	server.cfg.DemoMode = false
	owner := seedBillingWorkspace(t, dataStore, "org_alpha", "cus_alpha", "sub_alpha", "active")

	intent := httptest.NewRecorder()
	server.createBillingSetupIntent(intent, billingRequest(t, http.MethodPost, "/v1/billing/payment-methods/setup-intent", owner, nil))
	if intent.Code != http.StatusServiceUnavailable || !strings.Contains(intent.Body.String(), "billing_not_configured") {
		t.Fatalf("expected a plain 503 with no provider, got %d: %s", intent.Code, intent.Body.String())
	}

	cancel := httptest.NewRecorder()
	server.cancelBillingSubscription(cancel, billingRequest(t, http.MethodPost, "/v1/billing/subscription/cancel", owner, nil))
	if cancel.Code != http.StatusServiceUnavailable || !strings.Contains(cancel.Body.String(), "billing_not_configured") {
		t.Fatalf("expected a plain 503 with no provider, got %d: %s", cancel.Code, cancel.Body.String())
	}
}

func TestBillingRoutesRequireAnOwnerAndAPaidRelationship(t *testing.T) {
	server, dataStore := newTestServer(t)
	server.cfg.DemoMode = false
	owner := seedBillingWorkspace(t, dataStore, "org_alpha", "cus_alpha", "sub_alpha", "active")
	member := Identity{UserID: "usr_member", AccountID: owner.AccountID, Email: "member@example.test", Role: "member"}

	handlers := map[string]http.HandlerFunc{
		"invoices":     server.listBillingInvoices,
		"payment":      server.listBillingPaymentMethods,
		"setup_intent": server.createBillingSetupIntent,
		"default_card": server.setDefaultBillingPaymentMethod,
		"detail":       server.getBillingSubscriptionDetail,
		"cancel":       server.cancelBillingSubscription,
		"resume":       server.resumeBillingSubscription,
	}
	for name, handler := range handlers {
		response := httptest.NewRecorder()
		handler(response, billingRequest(t, http.MethodPost, "/v1/billing/"+name, member, nil))
		if response.Code != http.StatusForbidden || !strings.Contains(response.Body.String(), "owner_required") {
			t.Fatalf("%s: expected a non-owner to be refused, got %d: %s", name, response.Code, response.Body.String())
		}
	}

	// A workspace that never paid has no Stripe relationship to manage.
	unpaid := seedBillingWorkspace(t, dataStore, "org_unpaid", "", "", "incomplete")
	response := httptest.NewRecorder()
	server.listBillingInvoices(response, billingRequest(t, http.MethodGet, "/v1/billing/invoices", unpaid, nil))
	if response.Code != http.StatusPaymentRequired || !strings.Contains(response.Body.String(), "subscription_required") {
		t.Fatalf("expected an unpaid workspace to be gated, got %d: %s", response.Code, response.Body.String())
	}

	// A customer whose renewal was declined must still be able to reach the screens
	// that let them fix it, or in-app billing is useless exactly when it matters.
	repairable := seedBillingWorkspace(t, dataStore, "org_pastdue", "cus_pastdue", "sub_pastdue", "past_due")
	stub := newBillingStripeStub(t, func(billingStripeCall) (int, string) { return http.StatusOK, `{"data":[]}` })
	billingUseStripe(server, stub)
	pastDue := httptest.NewRecorder()
	server.listBillingInvoices(pastDue, billingRequest(t, http.MethodGet, "/v1/billing/invoices", repairable, nil))
	if pastDue.Code != http.StatusOK {
		t.Fatalf("expected a past-due owner to reach their invoices, got %d: %s", pastDue.Code, pastDue.Body.String())
	}
}

func TestBillingRejectsIdentifiersSuppliedByTheCaller(t *testing.T) {
	server, dataStore := newTestServer(t)
	stub := newBillingStripeStub(t, func(billingStripeCall) (int, string) { return http.StatusOK, `{}` })
	billingUseStripe(server, stub)
	owner := seedBillingWorkspace(t, dataStore, "org_alpha", "cus_alpha", "sub_alpha", "active")

	// A subscription identifier in the body is not an input this API has. It is
	// resolved from the authenticated account, and an unknown field is a 400.
	cancel := httptest.NewRecorder()
	server.cancelBillingSubscription(cancel, billingRequest(t, http.MethodPost, "/v1/billing/subscription/cancel", owner, map[string]string{"subscription_id": "sub_beta"}))
	if cancel.Code != http.StatusBadRequest {
		t.Fatalf("expected a caller-supplied subscription id to be rejected, got %d: %s", cancel.Code, cancel.Body.String())
	}

	// A payment method identifier shaped like a path traversal must never reach a
	// Stripe request path.
	for _, candidate := range []string{"pm_alpha/../../customers", "cus_alpha", "", "pm_alpha?expand=customer"} {
		response := httptest.NewRecorder()
		server.setDefaultBillingPaymentMethod(response, billingRequest(t, http.MethodPost, "/v1/billing/payment-methods/default", owner, map[string]string{"payment_method_id": candidate}))
		if response.Code != http.StatusUnprocessableEntity {
			t.Fatalf("expected %q to be rejected, got %d: %s", candidate, response.Code, response.Body.String())
		}
	}
	if len(stub.recorded()) != 0 {
		t.Fatalf("expected no Stripe call for rejected input, got %v", stub.recorded())
	}
}
