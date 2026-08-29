package api

import (
	"context"
	"errors"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"garuda/backend/internal/outbound"
)

// Outbound webhooks are the CRM integration surface.
//
// The ask was "every CRM at once". The honest answer is that N native adapters
// never converge, and that one signed outbound webhook already reaches Zapier,
// Make, n8n, Pipedream and every CRM with an HTTP endpoint. That is what this
// file exposes. See internal/outbound for the delivery, retry and SSRF design.

// outboundRegistries maps a server to its webhook registry.
//
// The registry has to outlive a request -- it owns the delivery queue and the
// worker draining it -- and *Server is constructed in server.go, which this lane
// does not own, so it cannot hold the field. Keying on the server pointer gives
// exactly the same lifetime: one registry per server, a fresh one per test
// server, and nothing shared between them. The map pins each server, which costs
// nothing in production, where there is one, and is bounded by the test count
// under `go test`.
var (
	outboundRegistryMutex sync.Mutex
	outboundRegistries    = map[*Server]*outbound.Registry{}
)

// StartOutboundWebhooks starts the delivery worker.
//
// It is idempotent, and every integrations handler calls it anyway, so nothing
// breaks if it is never called. Calling it once from Handler() is still worth a
// line: without it, a server that restarts delivers nothing until somebody opens
// the integrations page, because that first request is what would otherwise
// start the worker.
func (s *Server) StartOutboundWebhooks() { _ = s.outboundWebhooks() }

func (s *Server) outboundWebhooks() *outbound.Registry {
	outboundRegistryMutex.Lock()
	defer outboundRegistryMutex.Unlock()
	if registry, exists := outboundRegistries[s]; exists {
		return registry
	}
	registry := outbound.New(outbound.Options{
		Store:  s.store,
		Path:   outboundStatePath(s.cfg.DataFile),
		Logger: s.logger,
	})
	outboundRegistries[s] = registry
	return registry
}

// setOutboundWebhooks installs a registry built by a test, and returns a
// function that stops it again. Production never calls it.
func setOutboundWebhooks(server *Server, registry *outbound.Registry) func() {
	outboundRegistryMutex.Lock()
	previous, existed := outboundRegistries[server]
	outboundRegistries[server] = registry
	outboundRegistryMutex.Unlock()
	return func() {
		outboundRegistryMutex.Lock()
		if existed {
			outboundRegistries[server] = previous
		} else {
			delete(outboundRegistries, server)
		}
		outboundRegistryMutex.Unlock()
		registry.Close()
	}
}

// outboundStatePath puts the webhook file beside the main data file. An empty
// data file path -- which is what the tests configure -- keeps the registry in
// memory.
func outboundStatePath(dataFile string) string {
	trimmed := strings.TrimSpace(dataFile)
	if trimmed == "" {
		return ""
	}
	return filepath.Join(filepath.Dir(trimmed), "outbound.json")
}

// webhookEndpointResponse is the endpoint as the API renders it. It is a
// separate type from outbound.Endpoint on purpose: the stored value carries the
// signing secret, and a response type that cannot hold the secret cannot leak it
// by someone later removing a Public() call.
type webhookEndpointResponse struct {
	ID                  string     `json:"id"`
	URL                 string     `json:"url"`
	Description         string     `json:"description,omitempty"`
	Events              []string   `json:"events"`
	Enabled             bool       `json:"enabled"`
	Status              string     `json:"status"`
	SuspendedUntil      *time.Time `json:"suspended_until,omitempty"`
	ConsecutiveFailures int        `json:"consecutive_failures"`
	LastSuccessAt       *time.Time `json:"last_success_at,omitempty"`
	LastFailureAt       *time.Time `json:"last_failure_at,omitempty"`
	CreatedAt           time.Time  `json:"created_at"`
	UpdatedAt           time.Time  `json:"updated_at"`
}

type webhookDeliveryResponse struct {
	ID             string     `json:"id"`
	EndpointID     string     `json:"endpoint_id"`
	Event          string     `json:"event"`
	EventID        string     `json:"event_id"`
	Status         string     `json:"status"`
	Attempts       int        `json:"attempts"`
	ResponseStatus int        `json:"response_status,omitempty"`
	LastError      string     `json:"last_error,omitempty"`
	NextAttemptAt  *time.Time `json:"next_attempt_at,omitempty"`
	DeliveredAt    *time.Time `json:"delivered_at,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
}

func presentWebhookEndpoint(endpoint outbound.Endpoint, now time.Time) webhookEndpointResponse {
	status := "active"
	switch {
	case !endpoint.Enabled:
		status = "disabled"
	case endpoint.SuspendedUntil != nil && endpoint.SuspendedUntil.After(now):
		status = "suspended"
	}
	events := endpoint.Events
	if events == nil {
		events = []string{}
	}
	return webhookEndpointResponse{
		ID:                  endpoint.ID,
		URL:                 endpoint.URL,
		Description:         endpoint.Description,
		Events:              events,
		Enabled:             endpoint.Enabled,
		Status:              status,
		SuspendedUntil:      endpoint.SuspendedUntil,
		ConsecutiveFailures: endpoint.ConsecutiveFailures,
		LastSuccessAt:       endpoint.LastSuccessAt,
		LastFailureAt:       endpoint.LastFailureAt,
		CreatedAt:           endpoint.CreatedAt,
		UpdatedAt:           endpoint.UpdatedAt,
	}
}

func presentWebhookDelivery(delivery outbound.Delivery) webhookDeliveryResponse {
	return webhookDeliveryResponse{
		ID:             delivery.ID,
		EndpointID:     delivery.EndpointID,
		Event:          delivery.Event,
		EventID:        delivery.EventID,
		Status:         delivery.Status,
		Attempts:       delivery.Attempts,
		ResponseStatus: delivery.ResponseStatus,
		LastError:      delivery.LastError,
		NextAttemptAt:  delivery.NextAttemptAt,
		DeliveredAt:    delivery.DeliveredAt,
		CreatedAt:      delivery.CreatedAt,
		UpdatedAt:      delivery.UpdatedAt,
	}
}

// writeOutboundError maps a registry failure onto the error envelope. A missing
// endpoint and an endpoint owned by another account both arrive here as
// ErrNotFound and both become 404 -- never 403, which would confirm the id
// exists in another tenant.
func (s *Server) writeOutboundError(w http.ResponseWriter, r *http.Request, err error) {
	var validation outbound.ValidationError
	switch {
	case errors.Is(err, outbound.ErrNotFound):
		s.writeError(w, r, http.StatusNotFound, "webhook_endpoint_not_found", "Webhook endpoint not found", nil)
	case errors.As(err, &validation):
		s.writeError(w, r, http.StatusUnprocessableEntity, "validation_failed", validation.Message, nil)
	default:
		s.logger.Error("outbound webhook operation failed", "error", err, "request_id", requestID(r.Context()))
		s.writeError(w, r, http.StatusInternalServerError, "storage_error", "The request could not be saved", nil)
	}
}

// listIntegrationEvents is the catalogue the settings screen renders, plus the
// facts a developer needs to verify a signature. It is deliberately a real
// endpoint rather than a constant in the frontend, so the two can never drift.
func (s *Server) listIntegrationEvents(w http.ResponseWriter, _ *http.Request) {
	catalogue := []map[string]string{
		{"id": outbound.EventLeadCreated, "label": "Lead captured", "description": "A visitor completed the lead form on one of your agents."},
		{"id": outbound.EventConversationStarted, "label": "Conversation started", "description": "A visitor sent their first message to one of your agents."},
		{"id": outbound.EventConversationEnded, "label": "Conversation ended", "description": "A conversation went quiet and is considered finished."},
	}
	s.writeData(w, http.StatusOK, map[string]any{
		"events": catalogue,
		"signature": map[string]any{
			"header":            "Garuda-Signature",
			"format":            "t=<unix seconds>,v1=<hex HMAC-SHA256>",
			"signed_value":      "<t>.<raw request body>",
			"algorithm":         "HMAC-SHA256",
			"tolerance_seconds": 300,
			"notes": "Identical to the Stripe webhook signature scheme, so any Stripe verifier works unchanged. " +
				"Verify against the raw body bytes, not a re-encoding of the parsed JSON, and reject a timestamp " +
				"further than the tolerance from your clock.",
		},
		"delivery": map[string]any{
			"method":         "POST",
			"content_type":   "application/json",
			"retries":        "5 retries with exponential backoff after the first attempt",
			"guarantee":      "at least once; de-duplicate on the Garuda-Event-Id header",
			"requirements":   "https only, on the default port; the URL must resolve to a public address",
			"expected_reply": "any 2xx; reply 410 Gone to have Garuda stop retrying immediately",
		},
	})
}

func (s *Server) listWebhookEndpoints(w http.ResponseWriter, r *http.Request) {
	identity := identityFrom(r.Context())
	endpoints, err := s.outboundWebhooks().List(identity.AccountID)
	if err != nil {
		s.writeOutboundError(w, r, err)
		return
	}
	now := time.Now().UTC()
	items := make([]webhookEndpointResponse, 0, len(endpoints))
	for _, endpoint := range endpoints {
		items = append(items, presentWebhookEndpoint(endpoint, now))
	}
	s.writeDataMeta(w, http.StatusOK, items, map[string]any{"total": len(items)})
}

type createWebhookEndpointRequest struct {
	URL         string   `json:"url"`
	Description string   `json:"description,omitempty"`
	Events      []string `json:"events"`
}

func (s *Server) createWebhookEndpoint(w http.ResponseWriter, r *http.Request) {
	identity := identityFrom(r.Context())
	var input createWebhookEndpointRequest
	if !s.decodeJSON(w, r, &input) {
		return
	}
	registry := s.outboundWebhooks()
	parsed, err := registry.Guard().ValidateURL(input.URL)
	if err != nil {
		s.writeOutboundError(w, r, err)
		return
	}
	// A courtesy resolution so an obviously-internal name fails while the customer
	// is looking at the form. It is NOT the security boundary -- DNS can change a
	// moment later, which is why every delivery re-checks the address it is about
	// to connect to. See outbound.Guard.
	resolveContext, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	if err := registry.Guard().ResolvesToPublicAddress(resolveContext, parsed.Hostname()); err != nil {
		s.writeOutboundError(w, r, err)
		return
	}
	// The account comes from the authenticated identity, never from the body.
	endpoint, secret, err := registry.Create(identity.AccountID, input.URL, input.Description, input.Events)
	if err != nil {
		s.writeOutboundError(w, r, err)
		return
	}
	s.writeDataMeta(w, http.StatusCreated, map[string]any{
		"endpoint": presentWebhookEndpoint(endpoint, time.Now().UTC()),
		"secret":   secret,
	}, map[string]any{"secret_shown_once": true})
}

type updateWebhookEndpointRequest struct {
	URL         *string   `json:"url,omitempty"`
	Description *string   `json:"description,omitempty"`
	Events      *[]string `json:"events,omitempty"`
	Enabled     *bool     `json:"enabled,omitempty"`
}

func (s *Server) updateWebhookEndpoint(w http.ResponseWriter, r *http.Request) {
	identity := identityFrom(r.Context())
	var input updateWebhookEndpointRequest
	if !s.decodeJSON(w, r, &input) {
		return
	}
	if input.URL == nil && input.Description == nil && input.Events == nil && input.Enabled == nil {
		s.writeError(w, r, http.StatusUnprocessableEntity, "validation_failed", "No changes were supplied", nil)
		return
	}
	registry := s.outboundWebhooks()
	if input.URL != nil {
		parsed, err := registry.Guard().ValidateURL(*input.URL)
		if err != nil {
			s.writeOutboundError(w, r, err)
			return
		}
		resolveContext, cancel := context.WithTimeout(r.Context(), 3*time.Second)
		defer cancel()
		if err := registry.Guard().ResolvesToPublicAddress(resolveContext, parsed.Hostname()); err != nil {
			s.writeOutboundError(w, r, err)
			return
		}
	}
	endpoint, err := registry.Update(identity.AccountID, r.PathValue("endpointID"), outbound.EndpointPatch{
		URL:         input.URL,
		Description: input.Description,
		Events:      input.Events,
		Enabled:     input.Enabled,
	})
	if err != nil {
		s.writeOutboundError(w, r, err)
		return
	}
	s.writeData(w, http.StatusOK, presentWebhookEndpoint(endpoint, time.Now().UTC()))
}

func (s *Server) deleteWebhookEndpoint(w http.ResponseWriter, r *http.Request) {
	identity := identityFrom(r.Context())
	if err := s.outboundWebhooks().Delete(identity.AccountID, r.PathValue("endpointID")); err != nil {
		s.writeOutboundError(w, r, err)
		return
	}
	s.writeData(w, http.StatusOK, map[string]any{"deleted": true})
}

func (s *Server) rotateWebhookSecret(w http.ResponseWriter, r *http.Request) {
	identity := identityFrom(r.Context())
	secret, err := s.outboundWebhooks().RotateSecret(identity.AccountID, r.PathValue("endpointID"))
	if err != nil {
		s.writeOutboundError(w, r, err)
		return
	}
	s.writeDataMeta(w, http.StatusOK, map[string]any{"secret": secret}, map[string]any{"secret_shown_once": true})
}

func (s *Server) sendWebhookTestEvent(w http.ResponseWriter, r *http.Request) {
	identity := identityFrom(r.Context())
	delivery, err := s.outboundWebhooks().SendTest(identity.AccountID, r.PathValue("endpointID"))
	if err != nil {
		s.writeOutboundError(w, r, err)
		return
	}
	// 202: the event is queued, and the worker sends it. Waiting for a customer's
	// server here is exactly the thing this design refuses to do.
	s.writeData(w, http.StatusAccepted, presentWebhookDelivery(delivery))
}

func (s *Server) listWebhookDeliveries(w http.ResponseWriter, r *http.Request) {
	identity := identityFrom(r.Context())
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	deliveries, err := s.outboundWebhooks().Deliveries(identity.AccountID, r.PathValue("endpointID"), limit)
	if err != nil {
		s.writeOutboundError(w, r, err)
		return
	}
	items := make([]webhookDeliveryResponse, 0, len(deliveries))
	for _, delivery := range deliveries {
		items = append(items, presentWebhookDelivery(delivery))
	}
	s.writeDataMeta(w, http.StatusOK, items, map[string]any{"total": len(items)})
}
