package api

import (
	"context"
	"errors"
	"net/http"
	"sort"
	"strings"
	"time"

	"garuda/backend/internal/composio"
	"garuda/backend/internal/model"
)

// Getting a captured lead into the app the customer connected.
//
// WHY THIS POLLS RATHER THAN BEING CALLED FROM THE LEAD HANDLER. The natural
// design is a line in widgetLead saying "also send it to HubSpot". That line
// would sit on the widget request path, where a customer's slow CRM becomes a
// slow chat widget for a visitor on their website, and where a restart between
// the write and the send loses the lead with nothing to replay it from. Reading
// committed state on an interval instead means the trigger is the durable fact:
// nothing is lost across a restart, and the request that captured the lead has
// already returned before any of this runs. It is the same reasoning as the
// outbound webhook dispatcher, and deliberately the same shape.

const (
	// leadRoutingInterval is slower than the webhook scan. A CRM does not care
	// about twenty seconds and a lower rate is one fewer wake-up on a small VPS.
	leadRoutingInterval = 20 * time.Second

	// leadRoutingBatch bounds one pass. A backlog is worked through over several
	// passes rather than in one long lock-free burst that could outlive the
	// interval and overlap itself.
	leadRoutingBatch = 10

	// routeFailureLimit is the circuit breaker. A destination whose credentials
	// were revoked would otherwise be tried once per lead forever, and every
	// attempt is a request somebody pays for.
	routeFailureLimit = 5
)

// StartLeadRouting delivers new leads to their destinations for the life of the
// process. Absent Composio credentials it does nothing at all.
func (s *Server) StartLeadRouting() {
	if !s.composio.Enabled() {
		return
	}
	go func() {
		ticker := time.NewTicker(leadRoutingInterval)
		defer ticker.Stop()
		// The watermark starts at now. A deployment that has been collecting
		// leads for weeks must not deliver all of them the moment somebody
		// connects a CRM -- that is a hundred notifications and a support call,
		// not a feature.
		watermark := time.Now().UTC()
		for range ticker.C {
			watermark = s.routeNewLeads(watermark)
		}
	}()
}

// routeNewLeads delivers everything captured since the watermark and returns the
// new one.
func (s *Server) routeNewLeads(since time.Time) time.Time {
	type delivery struct {
		route  model.LeadRoute
		lead   composio.LeadPayload
		leadAt time.Time
	}

	var pending []delivery
	newest := since

	// One read, holding nothing while the network is touched.
	_ = s.store.View(func(state *model.State) error {
		routes := map[string][]model.LeadRoute{}
		for index := range state.LeadRoutes {
			route := &state.LeadRoutes[index]
			if route.Enabled && route.FailureCount < routeFailureLimit {
				routes[route.AccountID] = append(routes[route.AccountID], route.Clone())
			}
		}
		if len(routes) == 0 {
			return nil
		}
		agentNames := map[string]string{}
		for index := range state.Agents {
			agentNames[state.Agents[index].ID] = state.Agents[index].Name
		}
		pageURLs := map[string]string{}
		for index := range state.Sessions {
			pageURLs[state.Sessions[index].ID] = state.Sessions[index].PageURL
		}

		for index := range state.Leads {
			lead := &state.Leads[index]
			if !lead.CreatedAt.After(since) {
				continue
			}
			if lead.CreatedAt.After(newest) {
				newest = lead.CreatedAt
			}
			for _, route := range routes[lead.AccountID] {
				pending = append(pending, delivery{
					route: route,
					// Built here, inside the read, and deliberately from scalars
					// only: a map or slice header taken out of live state and
					// read after the lock is released is a data race, and a map
					// read racing a write is fatal to the process.
					lead: composio.LeadPayload{
						Name: lead.Name, Email: lead.Email, Phone: lead.Phone,
						Company: lead.Company, Notes: lead.Notes, Source: lead.Source,
						AgentName: agentNames[lead.AgentID], PageURL: pageURLs[lead.SessionID],
						CreatedAt: lead.CreatedAt,
					},
					leadAt: lead.CreatedAt,
				})
			}
		}
		return nil
	})

	if len(pending) == 0 {
		return newest
	}
	// Oldest first, so a backlog is delivered in the order it happened.
	sort.SliceStable(pending, func(i, j int) bool { return pending[i].leadAt.Before(pending[j].leadAt) })
	if len(pending) > leadRoutingBatch {
		pending = pending[:leadRoutingBatch]
		// Only advance as far as what was actually attempted, or the remainder
		// is skipped forever.
		newest = pending[len(pending)-1].leadAt
	}

	for _, item := range pending {
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		err := s.composio.DeliverLead(ctx, item.route.AccountID, item.route.Toolkit, item.route.Setting, item.lead)
		cancel()
		s.recordRouteResult(item.route.AccountID, item.route.Toolkit, err)
	}
	return newest
}

// recordRouteResult writes what happened, so the settings screen can show a
// destination that has been failing rather than a green tick that means nothing.
func (s *Server) recordRouteResult(accountID, toolkit string, deliveryErr error) {
	now := time.Now().UTC()
	_ = s.store.Update(func(state *model.State) error {
		for index := range state.LeadRoutes {
			route := &state.LeadRoutes[index]
			if route.AccountID != accountID || route.Toolkit != toolkit {
				continue
			}
			route.UpdatedAt = now
			if deliveryErr == nil {
				route.LastDeliveredAt = &now
				route.LastError = ""
				route.FailureCount = 0
				return nil
			}
			route.FailureCount++
			// The provider's own reason, bounded. It is shown to the customer,
			// who can act on "channel_not_found" and cannot act on "error".
			route.LastError = truncateRunes(deliveryErr.Error(), 200)
			return nil
		}
		return nil
	})
	if deliveryErr != nil {
		s.logger.Warn("lead delivery failed", "toolkit", toolkit, "error", deliveryErr)
	}
}

type leadRouteInput struct {
	Toolkit string `json:"toolkit"`
	Setting string `json:"setting,omitempty"`
	Enabled bool   `json:"enabled"`
}

// listLeadRoutes returns where this account's leads are being sent, and what is
// available to send them to.
func (s *Server) listLeadRoutes(w http.ResponseWriter, r *http.Request) {
	identity := identityFrom(r.Context())

	configured := make([]map[string]any, 0)
	_ = s.store.View(func(state *model.State) error {
		for index := range state.LeadRoutes {
			route := &state.LeadRoutes[index]
			if route.AccountID != identity.AccountID {
				continue
			}
			entry := map[string]any{
				"toolkit": route.Toolkit, "setting": route.Setting, "enabled": route.Enabled,
				"failure_count": route.FailureCount,
			}
			if route.LastDeliveredAt != nil {
				entry["last_delivered_at"] = *route.LastDeliveredAt
			}
			if route.LastError != "" {
				entry["last_error"] = route.LastError
			}
			// A destination that has failed its way past the limit has stopped
			// being tried, and saying so is the difference between a customer
			// fixing it and a customer wondering where their leads went.
			entry["paused"] = route.FailureCount >= routeFailureLimit
			configured = append(configured, entry)
		}
		return nil
	})
	sort.Slice(configured, func(i, j int) bool {
		return configured[i]["toolkit"].(string) < configured[j]["toolkit"].(string)
	})

	available := make([]map[string]any, 0)
	for _, destination := range composio.Destinations() {
		available = append(available, map[string]any{
			"toolkit": destination.Toolkit, "label": destination.Label,
			"summary": destination.Summary, "setting_label": destination.SettingLabel,
			"setting_hint": destination.SettingHint,
		})
	}

	s.writeData(w, http.StatusOK, map[string]any{"routes": configured, "available": available})
}

// saveLeadRoute switches one destination on or off, and stores its setting.
func (s *Server) saveLeadRoute(w http.ResponseWriter, r *http.Request) {
	identity := identityFrom(r.Context())
	var input leadRouteInput
	if !s.decodeJSON(w, r, &input) {
		return
	}
	toolkit := strings.ToLower(strings.TrimSpace(input.Toolkit))
	destination, supported := composio.DestinationFor(toolkit)
	if !supported {
		s.writeError(w, r, http.StatusUnprocessableEntity, "destination_not_supported", "Leads cannot be sent to that app directly. Use an outbound webhook instead.", nil)
		return
	}
	setting := truncateRunes(input.Setting, 200)
	if input.Enabled && destination.SettingLabel != "" && setting == "" {
		s.writeError(w, r, http.StatusUnprocessableEntity, "validation_failed", destination.Label+" needs its "+strings.ToLower(destination.SettingLabel), map[string]string{
			"setting": "required",
		})
		return
	}

	now := time.Now().UTC()
	err := s.store.Update(func(state *model.State) error {
		for index := range state.LeadRoutes {
			route := &state.LeadRoutes[index]
			if route.AccountID != identity.AccountID || route.Toolkit != toolkit {
				continue
			}
			route.Setting = setting
			route.Enabled = input.Enabled
			route.UpdatedAt = now
			// Changing the setting is somebody fixing what was wrong, so the
			// breaker is released rather than leaving them switched off with no
			// way back.
			route.FailureCount = 0
			route.LastError = ""
			return nil
		}
		state.LeadRoutes = append(state.LeadRoutes, model.LeadRoute{
			AccountID: identity.AccountID, Toolkit: toolkit, Setting: setting,
			Enabled: input.Enabled, CreatedAt: now, UpdatedAt: now,
		})
		return nil
	})
	if err != nil {
		s.storageFailure(w, r, err)
		return
	}
	s.writeData(w, http.StatusOK, map[string]any{"toolkit": toolkit, "enabled": input.Enabled, "setting": setting})
}

// testLeadRoute sends one sample lead, so a customer finds out here rather than
// from a lead that never arrived.
func (s *Server) testLeadRoute(w http.ResponseWriter, r *http.Request) {
	identity := identityFrom(r.Context())
	var input leadRouteInput
	if !s.decodeJSON(w, r, &input) {
		return
	}
	toolkit := strings.ToLower(strings.TrimSpace(input.Toolkit))

	var route model.LeadRoute
	found := false
	_ = s.store.View(func(state *model.State) error {
		for index := range state.LeadRoutes {
			if state.LeadRoutes[index].AccountID == identity.AccountID && state.LeadRoutes[index].Toolkit == toolkit {
				route, found = state.LeadRoutes[index].Clone(), true
				return nil
			}
		}
		return nil
	})
	if !found {
		s.writeError(w, r, http.StatusNotFound, "destination_not_configured", "Set this destination up before testing it", nil)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
	defer cancel()
	// Obviously a test, so nobody mistakes it for a real enquiry and calls back.
	err := s.composio.DeliverLead(ctx, identity.AccountID, route.Toolkit, route.Setting, composio.LeadPayload{
		Name: "Garuda test lead", Email: "test@garuda.ravan.ai",
		Notes:     "This is a test from your Garuda integration settings. No visitor sent it.",
		Source:    "test",
		CreatedAt: time.Now().UTC(),
	})
	s.recordRouteResult(identity.AccountID, toolkit, err)
	if err != nil {
		if errors.Is(err, composio.ErrNotConnected) {
			s.writeError(w, r, http.StatusServiceUnavailable, "calendar_not_connected", "Connect that app on the Integrations page first", nil)
			return
		}
		s.writeError(w, r, http.StatusBadGateway, "delivery_failed", "That app refused the test: "+truncateRunes(err.Error(), 200), nil)
		return
	}
	s.writeData(w, http.StatusOK, map[string]any{"delivered": true})
}
