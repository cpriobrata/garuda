package api

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"garuda/backend/internal/fetcher"
	"garuda/backend/internal/model"
)

// Website ingestion: the customer types their own URL and Garuda reads the page.
//
// This existed as a disabled input and a note saying URL crawling was not
// available, which for a product whose whole promise is "your website, answered"
// was the wrong thing to be missing. The reason it was disabled is real, though,
// and it is why this handler is thin: a server fetching a URL a user chose is
// server-side request forgery unless every guard holds, and all of those guards
// live in internal/fetcher rather than here.
//
// The fetch is separate from creating the source deliberately. The customer sees
// what was extracted from their page BEFORE it becomes knowledge their agent
// answers from, because a page whose text came out as a cookie banner and a
// navigation menu is something they should be able to reject.

type fetchSourceRequest struct {
	URL string `json:"url"`
}

// fetchKnowledgeSource reads a page and hands back its text for review.
func (s *Server) fetchKnowledgeSource(w http.ResponseWriter, r *http.Request) {
	identity := identityFrom(r.Context())
	if !s.hasEntitlement(identity.AccountID) {
		s.writeError(w, r, http.StatusPaymentRequired, "subscription_required", "An active subscription is required to import a website", nil)
		return
	}
	// Ownership is proved before anything is fetched, so this endpoint cannot be
	// used as a general-purpose URL reader by anyone holding an account.
	owned := false
	_ = s.store.View(func(state *model.State) error {
		agent, ok := findAgent(state, identity.AccountID, r.PathValue("agentID"))
		owned = ok && agent.Status != "archived"
		return nil
	})
	if !owned {
		s.writeError(w, r, http.StatusNotFound, "agent_not_found", "Agent not found", nil)
		return
	}

	var input fetchSourceRequest
	if !s.decodeJSON(w, r, &input) {
		return
	}
	target := strings.TrimSpace(input.URL)
	if target == "" || len(target) > 2000 {
		s.writeError(w, r, http.StatusUnprocessableEntity, "validation_failed", "Enter the address of a page on your website", map[string]string{"url": "required"})
		return
	}
	// Typing "example.com" is what a person does. Assuming https rather than
	// rejecting it is the difference between a feature and a form error.
	if !strings.Contains(target, "://") {
		target = "https://" + target
	}

	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	page, err := s.fetcher.Fetch(ctx, target)
	if err != nil {
		// A blocked address gets a message about the address, never about what is
		// or is not reachable from this server.
		if errors.Is(err, fetcher.ErrBlocked) {
			s.writeError(w, r, http.StatusUnprocessableEntity, "url_not_allowed", "That address cannot be imported. Use a public https address on your own website.", nil)
			return
		}
		s.writeError(w, r, http.StatusUnprocessableEntity, "fetch_failed", "That page could not be read: "+err.Error(), nil)
		return
	}

	title := page.Title
	if title == "" {
		title = page.FinalURL
	}
	s.writeData(w, http.StatusOK, map[string]any{
		"url":        page.FinalURL,
		"title":      truncateRunes(title, 200),
		"text":       page.Text,
		"truncated":  page.Truncated,
		"characters": len([]rune(page.Text)),
	})
}
