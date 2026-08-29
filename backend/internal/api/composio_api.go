package api

import (
	"net/http"
	"strconv"
	"strings"
)

// Integrations let each customer connect their own third-party accounts through
// Composio. Every handler here scopes to the caller's account id, which is what
// Composio stores the connection against, so one customer can never see or
// disconnect another's.

func (s *Server) integrationsUnavailable(w http.ResponseWriter, r *http.Request) bool {
	if s.composio.Enabled() {
		return false
	}
	s.writeError(w, r, http.StatusServiceUnavailable, "integrations_not_configured", "Integrations are not configured for this deployment", nil)
	return true
}

// listIntegrationCatalog pages the catalogue of connectable products. It is over
// 1,400 entries, so it is always paged and never returned whole.
func (s *Server) listIntegrationCatalog(w http.ResponseWriter, r *http.Request) {
	if s.integrationsUnavailable(w, r) {
		return
	}
	query := r.URL.Query()
	limit, _ := strconv.Atoi(query.Get("limit"))
	page, err := s.composio.Browse(r.Context(), query.Get("search"), query.Get("category"), query.Get("cursor"), limit)
	if err != nil {
		s.logger.Error("integration catalogue failed", "error", err, "request_id", requestID(r.Context()))
		s.writeError(w, r, http.StatusBadGateway, "integration_provider_error", "The integration catalogue is temporarily unavailable", nil)
		return
	}
	s.writeDataMeta(w, http.StatusOK, page.Items, map[string]any{"next_cursor": page.NextCursor, "total_items": page.TotalItems})
}

// listIntegrationCategories returns the catalogue groupings for browsing.
func (s *Server) listIntegrationCategories(w http.ResponseWriter, r *http.Request) {
	if s.integrationsUnavailable(w, r) {
		return
	}
	categories, err := s.composio.Categories(r.Context())
	if err != nil {
		s.logger.Error("integration categories failed", "error", err, "request_id", requestID(r.Context()))
		s.writeError(w, r, http.StatusBadGateway, "integration_provider_error", "The integration catalogue is temporarily unavailable", nil)
		return
	}
	s.writeData(w, http.StatusOK, categories)
}

// listIntegrationConnections returns only the caller's own connected accounts.
func (s *Server) listIntegrationConnections(w http.ResponseWriter, r *http.Request) {
	if s.integrationsUnavailable(w, r) {
		return
	}
	identity := identityFrom(r.Context())
	connections, err := s.composio.Connections(r.Context(), identity.AccountID)
	if err != nil {
		s.logger.Error("integration connections failed", "error", err, "request_id", requestID(r.Context()))
		s.writeError(w, r, http.StatusBadGateway, "integration_provider_error", "Connected accounts are temporarily unavailable", nil)
		return
	}
	s.writeData(w, http.StatusOK, connections)
}

type connectIntegrationRequest struct {
	Toolkit string `json:"toolkit"`
}

// connectIntegration starts an authorisation and returns the URL to send the
// customer to. The account id is taken from the authenticated identity and never
// from the request body, so a caller cannot open a connection for someone else.
func (s *Server) connectIntegration(w http.ResponseWriter, r *http.Request) {
	if s.integrationsUnavailable(w, r) {
		return
	}
	identity := identityFrom(r.Context())
	if !s.hasEntitlement(identity.AccountID) {
		s.writeError(w, r, http.StatusPaymentRequired, "subscription_required", "An active subscription is required to connect integrations", nil)
		return
	}
	var input connectIntegrationRequest
	if !s.decodeJSON(w, r, &input) {
		return
	}
	input.Toolkit = strings.ToLower(strings.TrimSpace(input.Toolkit))
	if input.Toolkit == "" || len(input.Toolkit) > 100 || !safeToolkitSlug(input.Toolkit) {
		s.writeError(w, r, http.StatusUnprocessableEntity, "validation_failed", "A valid toolkit is required", map[string]string{"toolkit": "letters, digits, dash or underscore, up to 100 characters"})
		return
	}
	callback := strings.TrimRight(s.cfg.AuthVerifyURL, "/")
	if parsed := strings.SplitN(callback, "/auth/", 2); len(parsed) == 2 {
		callback = parsed[0] + "/app/integrations"
	}
	connection, err := s.composio.ConnectLink(r.Context(), identity.AccountID, input.Toolkit, callback)
	if err != nil {
		s.logger.Error("integration connect failed", "error", err, "toolkit", input.Toolkit, "request_id", requestID(r.Context()))
		s.writeError(w, r, http.StatusBadGateway, "integration_provider_error", "This integration could not be started", nil)
		return
	}
	s.writeData(w, http.StatusCreated, connection)
}

// disconnectIntegration removes one of the caller's connections. Ownership is
// proven by re-listing the account's connections rather than trusting the id in
// the path, because the provider would otherwise happily delete any id.
func (s *Server) disconnectIntegration(w http.ResponseWriter, r *http.Request) {
	if s.integrationsUnavailable(w, r) {
		return
	}
	identity := identityFrom(r.Context())
	connectionID := strings.TrimSpace(r.PathValue("connectionID"))
	if connectionID == "" {
		s.writeError(w, r, http.StatusUnprocessableEntity, "validation_failed", "A connection is required", nil)
		return
	}
	connections, err := s.composio.Connections(r.Context(), identity.AccountID)
	if err != nil {
		s.logger.Error("integration ownership check failed", "error", err, "request_id", requestID(r.Context()))
		s.writeError(w, r, http.StatusBadGateway, "integration_provider_error", "Connected accounts are temporarily unavailable", nil)
		return
	}
	owned := false
	for _, connection := range connections {
		if connection.ID == connectionID {
			owned = true
			break
		}
	}
	if !owned {
		// 404, not 403: a connection belonging to another account must not be
		// distinguishable from one that does not exist.
		s.writeError(w, r, http.StatusNotFound, "connection_not_found", "Connection not found", nil)
		return
	}
	if err := s.composio.Disconnect(r.Context(), connectionID); err != nil {
		s.logger.Error("integration disconnect failed", "error", err, "request_id", requestID(r.Context()))
		s.writeError(w, r, http.StatusBadGateway, "integration_provider_error", "This integration could not be disconnected", nil)
		return
	}
	s.writeData(w, http.StatusOK, map[string]any{"disconnected": true, "connection_id": connectionID})
}

// safeToolkitSlug keeps a provider-bound path segment to the shape Composio uses.
func safeToolkitSlug(value string) bool {
	for _, character := range value {
		switch {
		case character >= 'a' && character <= 'z',
			character >= '0' && character <= '9',
			character == '-', character == '_':
		default:
			return false
		}
	}
	return true
}
