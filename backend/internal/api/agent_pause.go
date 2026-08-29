package api

import (
	"errors"
	"net/http"
	"time"

	"garuda/backend/internal/config"
	"garuda/backend/internal/model"
)

// Pause is represented as the agent Status "paused", not as a new stored field.
//
// Every widget entry point admits an agent only when its Status is exactly
// "published": findPublishedAgent for the config fetch and the session handshake,
// findPublishedAgentByID for a session reset, and the inline lookup in the message
// handler. Moving the status is therefore what stops the widget serving, on all of
// those paths at once, with no way for one of them to be forgotten. A separate
// boolean would have had to be threaded through each gate by hand, and the one
// that got missed would keep answering visitors.
//
// Nothing else changes. The public key, the published timestamp, the prompt, the
// branding and the knowledge sources are all left exactly as they were, so unpause
// is the status moving back and the widget picking up where it stopped. "archived"
// keeps its own meaning: an archived agent is hidden by every agent route, while a
// paused one is still listed, readable, editable and publishable.
const pausedAgentStatus = "paused"

// pauseAgent takes a published agent off the air.
func (s *Server) pauseAgent(w http.ResponseWriter, r *http.Request) {
	identity := identityFrom(r.Context())
	var result model.Agent
	err := s.store.Update(func(state *model.State) error {
		agent, ok := findAgent(state, identity.AccountID, r.PathValue("agentID"))
		if !ok || agent.Status == "archived" {
			return errors.New("not found")
		}
		if agent.Status == pausedAgentStatus {
			// Already off the air. Report the current record rather than an error,
			// and leave the revision alone: bumping it on a retry would invalidate
			// the If-Match token an editor is holding for no reason.
			result = agent.Clone()
			return nil
		}
		if agent.Status != "published" {
			return errors.New("not published")
		}
		agent.Status = pausedAgentStatus
		agent.Revision++
		agent.UpdatedAt = time.Now().UTC()
		result = agent.Clone()
		return nil
	})
	if err != nil {
		switch err.Error() {
		case "not found":
			s.writeError(w, r, http.StatusNotFound, "agent_not_found", "Agent not found", nil)
		case "not published":
			s.writeError(w, r, http.StatusConflict, "agent_not_published", "Only a published agent can be paused", nil)
		default:
			s.storageFailure(w, r, err)
		}
		return
	}
	s.writeData(w, http.StatusOK, result)
}

// unpauseAgent puts a paused agent back on the air.
func (s *Server) unpauseAgent(w http.ResponseWriter, r *http.Request) {
	identity := identityFrom(r.Context())
	// Resuming makes the agent serve visitors again, which is the thing publishing
	// requires a live subscription for. Pausing deliberately requires no such
	// check: a customer must always be able to stop their agent.
	if !s.hasEntitlement(identity.AccountID) {
		s.writeError(w, r, http.StatusPaymentRequired, "subscription_required", "An active subscription is required to resume agents", nil)
		return
	}
	var result model.Agent
	err := s.store.Update(func(state *model.State) error {
		agent, ok := findAgent(state, identity.AccountID, r.PathValue("agentID"))
		if !ok || agent.Status == "archived" {
			return errors.New("not found")
		}
		if agent.Status == "published" {
			result = agent.Clone()
			return nil
		}
		if agent.Status != pausedAgentStatus {
			return errors.New("not paused")
		}
		// The same gates publishing applies, because this ends in the same place.
		// An agent can be edited while it is paused, so its configuration is not
		// guaranteed to be the one that passed these checks on the way in.
		if details := validateAgent(*agent); len(details) > 0 {
			return validationError{details: details}
		}
		if !s.cfg.DemoMode && len(agent.Branding.AllowedDomains) == 0 {
			return validationError{details: map[string]string{"branding.allowed_domains": "add at least one website domain before publishing"}}
		}
		// A paused agent is not serving, so it does not count against the plan's
		// published limit while it sleeps -- which means the slot it vacated can be
		// taken by another agent. Without this recheck, unpausing would quietly
		// carry the account past a limit publishing enforces.
		published := 0
		for _, candidate := range state.Agents {
			if candidate.AccountID == identity.AccountID && candidate.Status == "published" {
				published++
			}
		}
		if published >= config.StarterPublishedAgentLimit {
			return errors.New("published agent limit")
		}
		agent.Status = "published"
		agent.Revision++
		agent.UpdatedAt = time.Now().UTC()
		result = agent.Clone()
		return nil
	})
	if err != nil {
		var validation validationError
		switch {
		case err.Error() == "not found":
			s.writeError(w, r, http.StatusNotFound, "agent_not_found", "Agent not found", nil)
		case err.Error() == "not paused":
			s.writeError(w, r, http.StatusConflict, "agent_not_paused", "Only a paused agent can be resumed", nil)
		case err.Error() == "published agent limit":
			s.writeError(w, r, http.StatusConflict, "published_agent_limit_reached", "The starter plan already has the maximum number of published agents", map[string]int{"limit": config.StarterPublishedAgentLimit})
		case errors.As(err, &validation):
			s.writeError(w, r, http.StatusUnprocessableEntity, "validation_failed", "Complete the required agent fields before resuming", validation.details)
		default:
			s.storageFailure(w, r, err)
		}
		return
	}
	s.writeData(w, http.StatusOK, result)
}
