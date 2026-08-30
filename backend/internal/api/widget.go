package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/mail"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"garuda/backend/internal/config"
	"garuda/backend/internal/llm"
	"garuda/backend/internal/model"
	"garuda/backend/internal/rag"
	"garuda/backend/internal/security"
)

const (
	widgetSessionTTL   = 15 * time.Minute
	widgetHistoryLimit = 50
	widgetProviderTTL  = 45 * time.Second
	widgetRAGTTL       = 8 * time.Second
)

type publicWidgetMessage struct {
	ID        string    `json:"id"`
	Role      string    `json:"role"`
	Content   string    `json:"content"`
	CreatedAt time.Time `json:"created_at"`
}

func (s *Server) widgetAgent(w http.ResponseWriter, r *http.Request) {
	agent, found := s.findPublishedAgent(r.PathValue("agentKey"))
	if !found || !s.widgetOriginAllowed(agent, r.Header.Get("Origin")) {
		s.writeError(w, r, http.StatusNotFound, "agent_not_found", "Published agent not found", nil)
		return
	}
	s.writeData(w, http.StatusOK, publicAgent(agent))
}

type createWidgetSessionRequest struct {
	AgentKey     string `json:"agent_key"`
	VisitorToken string `json:"visitor_token,omitempty"`
	Page         struct {
		URL      string `json:"url,omitempty"`
		Title    string `json:"title,omitempty"`
		Referrer string `json:"referrer,omitempty"`
	} `json:"page,omitempty"`
	Locale  string `json:"locale,omitempty"`
	Consent struct {
		Memory    bool `json:"memory"`
		Analytics bool `json:"analytics"`
	} `json:"consent,omitempty"`
}

func (s *Server) createWidgetSession(w http.ResponseWriter, r *http.Request) {
	var input createWidgetSessionRequest
	if !s.decodeJSON(w, r, &input) {
		return
	}
	agent, found := s.findPublishedAgent(strings.TrimSpace(input.AgentKey))
	if !found || !s.widgetOriginAllowed(agent, r.Header.Get("Origin")) {
		s.writeError(w, r, http.StatusNotFound, "agent_not_found", "Published agent not found for this origin", nil)
		return
	}
	if !s.hasEntitlement(agent.AccountID) {
		s.writeError(w, r, http.StatusPaymentRequired, "subscription_required", "This assistant is temporarily unavailable", nil)
		return
	}
	if len(input.Page.URL) > 2_000 || len(input.Page.Title) > 500 || len(input.Page.Referrer) > 2_000 || len(input.Locale) > 32 {
		s.writeError(w, r, http.StatusUnprocessableEntity, "validation_failed", "Widget context is too long", nil)
		return
	}

	visitorToken := strings.TrimSpace(input.VisitorToken)
	if input.Consent.Memory {
		if len(visitorToken) < 32 || len(visitorToken) > 256 {
			visitorToken, _ = security.RandomToken(32)
		}
	} else {
		visitorToken = ""
	}
	visitorID := newID("vst_ephemeral_")
	if visitorToken != "" {
		visitorID = "vst_" + security.HashScopedToken([]byte(s.cfg.VisitorHMACKey), agent.ID, visitorToken)
	}
	sessionToken, err := security.RandomToken(32)
	if err != nil {
		s.writeError(w, r, http.StatusInternalServerError, "token_error", "A widget session could not be created", nil)
		return
	}
	now := time.Now().UTC()
	expiresAt := now.Add(widgetSessionTTL)
	resumed := false
	var session model.Session
	var history []model.Message
	err = s.store.Update(func(state *model.State) error {
		if input.Consent.Memory {
			for index := len(state.Sessions) - 1; index >= 0; index-- {
				candidate := &state.Sessions[index]
				if candidate.AgentID == agent.ID && candidate.VisitorID == visitorID && candidate.MemoryConsent && candidate.LastSeenAt.After(now.Add(-config.StarterConversationWindow)) {
					session = *candidate
					candidate.SessionTokenHash = security.HashOpaqueToken(sessionToken)
					candidate.ExpiresAt = expiresAt
					candidate.LastSeenAt = now
					candidate.UpdatedAt = now
					candidate.Origin = r.Header.Get("Origin")
					session = *candidate
					resumed = true
					break
				}
			}
		}
		if session.ID == "" {
			session = model.Session{
				ID: newID("cvs_"), AccountID: agent.AccountID, AgentID: agent.ID, VisitorID: visitorID,
				SessionTokenHash: security.HashOpaqueToken(sessionToken), Origin: r.Header.Get("Origin"), Locale: strings.TrimSpace(input.Locale),
				PageURL: strings.TrimSpace(input.Page.URL), PageTitle: strings.TrimSpace(input.Page.Title), Referrer: strings.TrimSpace(input.Page.Referrer),
				MemoryConsent: input.Consent.Memory, ExpiresAt: expiresAt, CreatedAt: now, UpdatedAt: now, LastSeenAt: now,
			}
			state.Sessions = append(state.Sessions, session)
			// Inside the same write, so the budget can never be exceeded even briefly.
			enforceVisitorSessionBudget(state, agent.ID, visitorID)
			welcome := strings.TrimSpace(agent.WelcomeMessage)
			if welcome != "" {
				state.Messages = append(state.Messages, model.Message{ID: newID("msg_"), AccountID: agent.AccountID, AgentID: agent.ID, SessionID: session.ID, VisitorID: visitorID, Role: "assistant", Content: welcome, CreatedAt: now})
			}
		}
		for _, message := range state.Messages {
			if message.SessionID == session.ID {
				history = append(history, message.Clone())
			}
		}
		return nil
	})
	if err != nil {
		s.storageFailure(w, r, err)
		return
	}
	if visitorToken == "" {
		visitorToken = ""
	}
	s.writeData(w, http.StatusCreated, map[string]any{
		"session_id": session.ID, "session_token": sessionToken, "expires_at": expiresAt, "visitor_token": visitorToken,
		"conversation": map[string]any{"id": session.ID, "resumed": resumed, "messages": publicWidgetHistory(history, widgetHistoryLimit)}, "agent": publicAgent(agent),
	})
}

type widgetMessageRequest struct {
	ClientMessageID string `json:"client_message_id,omitempty"`
	Content         string `json:"content"`
}

func (s *Server) widgetMessage(w http.ResponseWriter, r *http.Request) {
	var input widgetMessageRequest
	if !s.decodeJSON(w, r, &input) {
		return
	}
	input.Content = strings.TrimSpace(input.Content)
	// Runes, not bytes: len() on a string counts bytes, so a byte cap silently
	// halves or thirds the message a visitor may send in any language that is not
	// mostly ASCII. The widget textarea caps at 4,000 characters, so a byte check
	// here rejects text the visitor was allowed to type.
	if input.Content == "" || utf8.RuneCountInString(input.Content) > 4_000 {
		s.writeError(w, r, http.StatusUnprocessableEntity, "validation_failed", "Message must contain 1 to 4,000 characters", nil)
		return
	}
	sessionToken := strings.TrimSpace(r.Header.Get("X-Garuda-Session-Token"))
	if sessionToken == "" {
		s.writeError(w, r, http.StatusUnauthorized, "session_token_required", "A widget session token is required", nil)
		return
	}
	var session model.Session
	var agent model.Agent
	authorized := false
	_ = s.store.View(func(state *model.State) error {
		for _, candidate := range state.Sessions {
			if candidate.ID == r.PathValue("sessionID") && candidate.ExpiresAt.After(time.Now()) && constantStringEqual(candidate.SessionTokenHash, security.HashOpaqueToken(sessionToken)) {
				if candidate.Origin != "" && !strings.EqualFold(candidate.Origin, r.Header.Get("Origin")) {
					return nil
				}
				session, authorized = candidate, true
				break
			}
		}
		if authorized {
			for _, candidate := range state.Agents {
				if candidate.ID == session.AgentID && candidate.AccountID == session.AccountID && candidate.Status == "published" {
					// Clone: Knowledge and LeadCapture.Fields are slices, and a struct
					// copy shares their headers with live state. Both are read after
					// this callback returns -- promptForAgent walks Knowledge, and the
					// lead payload encodes Fields -- while another request may be
					// appending a knowledge source to the same agent.
					agent = candidate.Clone()
					break
				}
			}
		}
		return nil
	})
	if !authorized || agent.ID == "" {
		s.writeError(w, r, http.StatusUnauthorized, "invalid_session", "The widget session is invalid or expired", nil)
		return
	}
	if !s.hasEntitlement(agent.AccountID) {
		s.writeError(w, r, http.StatusPaymentRequired, "subscription_required", "This assistant is temporarily unavailable", nil)
		return
	}
	input.ClientMessageID = strings.TrimSpace(input.ClientMessageID)
	// The visitor controls this value and it is persisted twice per request: once
	// as the message ID and once inside the reply's metadata. Unbounded, it lets
	// anyone inflate the state file -- which is rewritten in full on every write --
	// at roughly twice the rate they can send bytes.
	if len(input.ClientMessageID) > 128 || !safeClientMessageID(input.ClientMessageID) {
		s.writeError(w, r, http.StatusUnprocessableEntity, "validation_failed", "client_message_id must be at most 128 characters of letters, digits, dot, dash, underscore, or colon", nil)
		return
	}
	if input.ClientMessageID == "" {
		input.ClientMessageID = newID("msg_")
	}
	var duplicateUser, duplicateAssistant *model.Message
	_ = s.store.View(func(state *model.State) error {
		for _, message := range state.Messages {
			if message.SessionID == session.ID && message.ID == input.ClientMessageID && message.Role == "user" {
				copy := message
				duplicateUser = &copy
			}
			if message.SessionID == session.ID && message.Role == "assistant" && stringMetadata(message.Metadata, "reply_to_client_message_id") == input.ClientMessageID {
				copy := message
				duplicateAssistant = &copy
			}
		}
		return nil
	})
	if duplicateUser != nil && duplicateAssistant != nil {
		s.writeWidgetMessageResult(w, r, *duplicateUser, *duplicateAssistant, agent, session)
		return
	}
	now := time.Now().UTC()
	userMessage := model.Message{ID: input.ClientMessageID, AccountID: session.AccountID, AgentID: session.AgentID, SessionID: session.ID, VisitorID: session.VisitorID, Role: "user", Content: input.Content, CreatedAt: now}
	if err := s.store.Update(func(state *model.State) error {
		for _, existing := range state.Messages {
			if existing.SessionID == session.ID && existing.ID == input.ClientMessageID {
				return errors.New("duplicate message")
			}
		}
		var storedSession *model.Session
		for index := range state.Sessions {
			if state.Sessions[index].ID == session.ID {
				storedSession = &state.Sessions[index]
				break
			}
		}
		if storedSession == nil {
			return errors.New("session not found")
		}
		if storedSession.StartedAt == nil {
			conversationCount := 0
			windowStart := now.Add(-config.StarterConversationWindow)
			for _, candidate := range state.Sessions {
				if candidate.AccountID == session.AccountID && candidate.StartedAt != nil && !candidate.StartedAt.Before(windowStart) {
					conversationCount++
				}
			}
			if conversationCount >= config.StarterMonthlyConversationLimit {
				return errors.New("conversation limit")
			}
			startedAt := now
			storedSession.StartedAt = &startedAt
		}
		state.Messages = append(state.Messages, userMessage)
		storedSession.LastSeenAt = now
		storedSession.UpdatedAt = now
		return nil
	}); err != nil {
		switch err.Error() {
		case "duplicate message":
			s.writeError(w, r, http.StatusConflict, "message_in_progress", "This message is already being processed", nil)
		case "conversation limit":
			s.writeError(w, r, http.StatusTooManyRequests, "conversation_limit_reached", "This workspace has reached its rolling 30-day conversation limit", map[string]int{"limit": config.StarterMonthlyConversationLimit, "window_days": int(config.StarterConversationWindow / (24 * time.Hour))})
		case "session not found":
			s.writeError(w, r, http.StatusUnauthorized, "invalid_session", "The widget session is invalid or expired", nil)
		default:
			s.storageFailure(w, r, err)
		}
		return
	}

	providerContext, cancelProviders := context.WithTimeout(r.Context(), widgetProviderTTL)
	defer cancelProviders()
	// Twelve turns, not thirty. Thirty was measured at ~2,250 tokens of history
	// resent on every message, and with memory consent the filter is by VISITOR
	// rather than by session -- so it could reach back across every conversation
	// that person ever had with this agent. Twelve is ample for a website
	// concierge and bounds a cost that otherwise grows with a customer's history.
	history := s.chatHistory(session, 12)

	// Retrieval REPLACES the knowledge dump; it does not sit on top of it. Sending
	// both meant paying for the whole corpus and then again for the slice of it
	// that retrieval had just selected -- which is the exact cost retrieval exists
	// to avoid. When retrieval returns nothing, or is not configured at all, the
	// full block is still the right answer and is still sent.
	ragContext, cancelRAG := context.WithTimeout(providerContext, widgetRAGTTL)
	chunks, ragErr := s.rag.Search(ragContext, session.AccountID, agent.ID, input.Content, 4)
	cancelRAG()
	var retrieved []rag.Chunk
	if ragErr == nil {
		retrieved = s.filterReadyRAGChunks(session.AccountID, agent.ID, chunks)
	} else {
		s.logger.Warn("RAG search unavailable", "agent_id", agent.ID, "error", ragErr, "request_id", requestID(r.Context()))
	}
	var prompt string
	if len(retrieved) > 0 {
		prompt = promptWithRetrieved(promptWithoutKnowledge(agent), retrieved)
	} else {
		prompt = promptForAgent(agent)
	}
	reply, err := s.llm.Chat(providerContext, prompt, history)
	if err != nil {
		reply = "I’m sorry, I’m having trouble responding right now. Please try again in a moment or leave your contact details for the team."
	}
	assistantMessage := model.Message{ID: newID("msg_"), AccountID: session.AccountID, AgentID: session.AgentID, SessionID: session.ID, VisitorID: session.VisitorID, Role: "assistant", Content: reply, Metadata: map[string]any{"provider_mode": map[bool]string{true: "configured", false: "local_demo"}[s.llm.Enabled()], "reply_to_client_message_id": input.ClientMessageID}, CreatedAt: time.Now().UTC()}
	if err := s.store.Update(func(state *model.State) error {
		state.Messages = append(state.Messages, assistantMessage)
		return nil
	}); err != nil {
		s.storageFailure(w, r, err)
		return
	}
	s.writeWidgetMessageResult(w, r, userMessage, assistantMessage, agent, session)
}

func stringMetadata(metadata map[string]any, key string) string {
	value, _ := metadata[key].(string)
	return value
}

func (s *Server) writeWidgetMessageResult(w http.ResponseWriter, r *http.Request, userMessage, assistantMessage model.Message, agent model.Agent, session model.Session) {
	turns := 0
	_ = s.store.View(func(state *model.State) error {
		for _, message := range state.Messages {
			if message.SessionID == session.ID && message.Role == "user" {
				turns++
			}
		}
		return nil
	})
	leadRequested := agent.LeadCapture.Enabled && turns >= max(1, agent.LeadCapture.AfterTurns)
	result := map[string]any{"user_message": publicWidgetMessageFrom(userMessage), "assistant_message": publicWidgetMessageFrom(assistantMessage), "lead_capture_requested": leadRequested, "lead_capture": map[string]any{"prompt": agent.LeadCapture.Prompt, "fields": agent.LeadCapture.Fields, "privacy_text": agent.LeadCapture.PrivacyText}}
	if strings.Contains(r.Header.Get("Accept"), "text/event-stream") {
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.WriteHeader(http.StatusOK)
		// The integration contract names these events message.start, message.delta
		// and message.done and carries the text of a delta under "text". The shipped
		// widget accepts the contract name and the older short name for each event,
		// and reads "text" before it reads "content", so the events can be renamed in
		// place without stranding a browser that still holds the old bundle. Emitting
		// both names for the same event would be worse than renaming: that widget
		// would append every delta twice. Payload keys are safe to duplicate because
		// only the first one it finds is used, so the delta keeps "content" alongside
		// the contract's "text", and the start event keeps the session id it used to
		// carry next to the conversation id the contract asks for.
		writeSSE(w, "message.start", map[string]any{"message_id": assistantMessage.ID, "conversation_id": session.ID, "session_id": session.ID})
		writeSSE(w, "message.delta", map[string]string{"text": assistantMessage.Content, "content": assistantMessage.Content})
		completion := map[string]any{"message_id": assistantMessage.ID, "conversation_id": session.ID}
		for key, value := range result {
			completion[key] = value
		}
		writeSSE(w, "message.done", completion)
		if flusher, ok := w.(http.Flusher); ok {
			flusher.Flush()
		}
		return
	}
	s.writeData(w, http.StatusCreated, result)
}

func publicWidgetMessageFrom(message model.Message) publicWidgetMessage {
	return publicWidgetMessage{ID: message.ID, Role: message.Role, Content: message.Content, CreatedAt: message.CreatedAt}
}

func publicWidgetHistory(messages []model.Message, limit int) []publicWidgetMessage {
	sort.SliceStable(messages, func(i, j int) bool { return messages[i].CreatedAt.Before(messages[j].CreatedAt) })
	if limit <= 0 {
		return []publicWidgetMessage{}
	}
	if len(messages) > limit {
		messages = messages[len(messages)-limit:]
	}
	result := make([]publicWidgetMessage, 0, len(messages))
	for _, message := range messages {
		if message.Role == "user" || message.Role == "assistant" {
			result = append(result, publicWidgetMessageFrom(message))
		}
	}
	return result
}

// widgetLeadCustomFieldLimit and the sizes beside it bound a payload a visitor
// controls and this service then stores, in the same spirit as the cap on
// client_message_id: the state file is rewritten in full on every write.
const (
	widgetLeadCustomFieldLimit      = 20
	widgetLeadCustomFieldKeyLimit   = 64
	widgetLeadCustomFieldValueLimit = 500
	// capture_id and notice_version are copied straight into the stored lead, and
	// were bounded only by the 1MB body cap. That was enough for one anonymous
	// visitor to add 800KB of permanent state per accepted request and, in a few
	// minutes of ordinary rate-limited traffic, push the data file past the 64MiB
	// the store can read back -- at which point the API cannot boot at all and
	// systemd restarts it forever. Both are opaque client identifiers; a UUID is
	// 36 characters and a version string is shorter still.
	widgetCaptureIDLimit     = 128
	widgetNoticeVersionLimit = 64
)

// The widget deployed today posts contact details inside a "fields" object and
// expresses consent as "granted". The integration contract documents the same
// values at the top level, with "custom_fields" beside them and consent given as
// "contact", "privacy_policy" and "captured_at". decodeJSON refuses unknown
// fields, so a client written against the contract was answered with 400 for
// every capture. Both spellings are accepted here; where a caller sends both,
// the nested object wins because that is what the shipped widget sends.
type widgetLeadRequest struct {
	ClientCaptureID string `json:"client_capture_id,omitempty"`
	Name            string `json:"name,omitempty"`
	Email           string `json:"email,omitempty"`
	Phone           string `json:"phone,omitempty"`
	Company         string `json:"company,omitempty"`
	Fields          struct {
		Name    string `json:"name,omitempty"`
		Email   string `json:"email,omitempty"`
		Phone   string `json:"phone,omitempty"`
		Company string `json:"company,omitempty"`
	} `json:"fields,omitempty"`
	CustomFields map[string]string `json:"custom_fields,omitempty"`
	Consent      struct {
		Granted       bool   `json:"granted"`
		Contact       bool   `json:"contact"`
		PrivacyPolicy bool   `json:"privacy_policy"`
		CapturedAt    string `json:"captured_at,omitempty"`
		NoticeVersion string `json:"notice_version,omitempty"`
	} `json:"consent"`
}

// firstProvidedValue returns the first value that still holds something once the
// surrounding whitespace is gone.
func firstProvidedValue(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func (s *Server) widgetLead(w http.ResponseWriter, r *http.Request) {
	var input widgetLeadRequest
	if !s.decodeJSON(w, r, &input) {
		return
	}
	// "granted" is what the widget sends, "contact" is what the contract calls the
	// same affirmative permission to get in touch. Either one, on its own, is the
	// consent this endpoint requires.
	if !input.Consent.Granted && !input.Consent.Contact {
		s.writeError(w, r, http.StatusUnprocessableEntity, "consent_required", "Consent is required before contact details can be saved", nil)
		return
	}
	session, valid := s.authorizeWidgetSession(r)
	if !valid {
		s.writeError(w, r, http.StatusUnauthorized, "invalid_session", "The widget session is invalid or expired", nil)
		return
	}
	// Every other widget surface refuses to serve an account without a live
	// subscription. Lead capture is the one the account is actually paid for, so
	// leaving it open let a lapsed workspace keep collecting contact details for
	// as long as an already issued session token stayed valid.
	if !s.hasEntitlement(session.AccountID) {
		s.writeError(w, r, http.StatusPaymentRequired, "subscription_required", "This assistant is temporarily unavailable", nil)
		return
	}
	name := firstProvidedValue(input.Fields.Name, input.Name)
	company := firstProvidedValue(input.Fields.Company, input.Company)
	email := normalizeEmail(firstProvidedValue(input.Fields.Email, input.Email))
	phone := normalizePhone(firstProvidedValue(input.Fields.Phone, input.Phone))
	if email == "" && phone == "" {
		s.writeError(w, r, http.StatusUnprocessableEntity, "validation_failed", "An email address or phone number is required", nil)
		return
	}
	if email != "" {
		if _, err := mail.ParseAddress(email); err != nil || len(email) > 254 {
			s.writeError(w, r, http.StatusUnprocessableEntity, "validation_failed", "Email address is invalid", map[string]string{"email": "invalid"})
			return
		}
	}
	if phone != "" && len(phone) < 7 {
		s.writeError(w, r, http.StatusUnprocessableEntity, "validation_failed", "Phone number is invalid", map[string]string{"phone": "invalid"})
		return
	}
	if len(name) > 160 || len(company) > 160 {
		s.writeError(w, r, http.StatusUnprocessableEntity, "validation_failed", "Lead fields are too long", nil)
		return
	}
	if len(input.CustomFields) > widgetLeadCustomFieldLimit {
		s.writeError(w, r, http.StatusUnprocessableEntity, "validation_failed", "Too many custom lead fields were submitted", map[string]int{"limit": widgetLeadCustomFieldLimit})
		return
	}
	for key, value := range input.CustomFields {
		if len(key) > widgetLeadCustomFieldKeyLimit || len(value) > widgetLeadCustomFieldValueLimit {
			s.writeError(w, r, http.StatusUnprocessableEntity, "validation_failed", "Custom lead fields are too long", nil)
			return
		}
	}
	// Everything below reaches the persisted lead. Nothing a visitor controls may
	// enter the state file without a bound: the file is rewritten in full on every
	// write and read back through a fixed-size limit at boot.
	if len(input.ClientCaptureID) > widgetCaptureIDLimit || (input.ClientCaptureID != "" && !safeClientMessageID(input.ClientCaptureID)) {
		s.writeError(w, r, http.StatusUnprocessableEntity, "validation_failed", "The capture id is not valid", map[string]string{"client_capture_id": "invalid"})
		return
	}
	if len(input.Consent.NoticeVersion) > widgetNoticeVersionLimit {
		s.writeError(w, r, http.StatusUnprocessableEntity, "validation_failed", "The consent notice version is too long", map[string]string{"consent.notice_version": "too long"})
		return
	}
	now := time.Now().UTC()
	metadata := map[string]string{"consent": "granted", "notice_version": input.Consent.NoticeVersion, "capture_id": input.ClientCaptureID}
	if input.Consent.PrivacyPolicy {
		metadata["privacy_policy_accepted"] = "true"
	}
	// The moment of consent is evidence worth keeping, but it arrives from the
	// browser, so it is stored only when it really is a timestamp and only in the
	// shape this service writes elsewhere.
	if capturedAt, err := time.Parse(time.RFC3339, strings.TrimSpace(input.Consent.CapturedAt)); err == nil {
		metadata["consent_captured_at"] = capturedAt.UTC().Format(time.RFC3339)
	}
	// Custom answers are namespaced so a visitor cannot overwrite the consent
	// evidence stored beside them.
	for key, value := range input.CustomFields {
		metadata["custom."+key] = value
	}
	lead := model.Lead{ID: newID("lead_"), AccountID: session.AccountID, AgentID: session.AgentID, SessionID: session.ID, VisitorID: session.VisitorID, Name: name, Email: email, Phone: phone, Company: company, Status: "new", Source: "widget", Metadata: metadata, CreatedAt: now, UpdatedAt: now}
	err := s.store.Update(func(state *model.State) error {
		for index := range state.Leads {
			existing := &state.Leads[index]
			if input.ClientCaptureID != "" && existing.AccountID == session.AccountID && existing.AgentID == session.AgentID && existing.SessionID == session.ID && existing.Metadata["capture_id"] == input.ClientCaptureID {
				lead = existing.Clone()
				return nil
			}
			if existing.AccountID == session.AccountID && existing.AgentID == session.AgentID && existing.SessionID == session.ID && ((email != "" && existing.Email == email) || (phone != "" && existing.Phone == phone)) {
				if lead.Name != "" {
					existing.Name = lead.Name
				}
				if lead.Email != "" {
					existing.Email = lead.Email
				}
				if lead.Phone != "" {
					existing.Phone = lead.Phone
				}
				if lead.Company != "" {
					existing.Company = lead.Company
				}
				existing.UpdatedAt = now
				lead = existing.Clone()
				return nil
			}
		}
		state.Leads = append(state.Leads, lead)
		return nil
	})
	if err != nil {
		s.storageFailure(w, r, err)
		return
	}
	s.writeData(w, http.StatusCreated, map[string]any{"lead_id": lead.ID, "status": lead.Status})
}

func (s *Server) authorizeWidgetSession(r *http.Request) (model.Session, bool) {
	token := strings.TrimSpace(r.Header.Get("X-Garuda-Session-Token"))
	if token == "" {
		return model.Session{}, false
	}
	var result model.Session
	found := false
	_ = s.store.View(func(state *model.State) error {
		for _, session := range state.Sessions {
			if session.ID == r.PathValue("sessionID") && session.ExpiresAt.After(time.Now()) && constantStringEqual(session.SessionTokenHash, security.HashOpaqueToken(token)) {
				if session.Origin != "" && !strings.EqualFold(session.Origin, r.Header.Get("Origin")) {
					return nil
				}
				result, found = session, true
				break
			}
		}
		return nil
	})
	return result, found
}

func (s *Server) chatHistory(session model.Session, limit int) []llm.ChatMessage {
	var messages []model.Message
	_ = s.store.View(func(state *model.State) error {
		for _, message := range state.Messages {
			if message.AgentID != session.AgentID {
				continue
			}
			if session.MemoryConsent {
				if message.VisitorID == session.VisitorID {
					messages = append(messages, message.Clone())
				}
			} else if message.SessionID == session.ID {
				messages = append(messages, message.Clone())
			}
		}
		return nil
	})
	sort.SliceStable(messages, func(i, j int) bool { return messages[i].CreatedAt.Before(messages[j].CreatedAt) })
	if len(messages) > limit {
		messages = messages[len(messages)-limit:]
	}
	history := make([]llm.ChatMessage, 0, len(messages))
	for _, message := range messages {
		if message.Role == "user" || message.Role == "assistant" {
			history = append(history, llm.ChatMessage{Role: message.Role, Content: message.Content})
		}
	}
	return history
}

func (s *Server) findPublishedAgent(publicKey string) (model.Agent, bool) {
	var result model.Agent
	found := false
	_ = s.store.View(func(state *model.State) error {
		for _, agent := range state.Agents {
			if agent.PublicKey == publicKey && agent.Status == "published" {
				result, found = agent.Clone(), true
				break
			}
		}
		return nil
	})
	return result, found
}

func (s *Server) widgetOriginAllowed(agent model.Agent, origin string) bool {
	if origin == "" {
		return s.cfg.DemoMode
	}
	parsed, err := url.Parse(origin)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Hostname() == "" {
		return false
	}
	if s.cfg.DemoMode && (parsed.Hostname() == "localhost" || parsed.Hostname() == "127.0.0.1") {
		return true
	}
	for _, domain := range agent.Branding.AllowedDomains {
		domain = strings.ToLower(strings.TrimSpace(domain))
		domain = strings.TrimPrefix(domain, "https://")
		domain = strings.TrimPrefix(domain, "http://")
		domain = strings.TrimSuffix(domain, "/")
		if strings.EqualFold(domain, parsed.Host) || strings.EqualFold(domain, parsed.Hostname()) {
			return true
		}
	}
	return s.cfg.DemoMode && len(agent.Branding.AllowedDomains) == 0
}

// publicAgent is the agent half of the widget bootstrap: everything a visitor's
// browser is allowed to know, and nothing else.
//
// The base map is the shape the deployed widget has always received, so an older
// cached bundle keeps working. widgetBrandingPayload is then overlaid on top,
// which is what carries the studio's identity, theme, placement, toggles and
// authored lead form. Without that overlay nothing a customer configures ever
// reaches their website, so the order matters: resolved values win over the raw
// stored ones they replace.
func publicAgent(agent model.Agent) map[string]any {
	payload := map[string]any{
		"display_name": agent.Name, "welcome_message": agent.WelcomeMessage, "suggested_prompts": agent.SuggestedReplies,
		"accent_color": agent.Branding.AccentColor, "position": agent.Branding.Position, "launcher_label": agent.Branding.LauncherText,
		"avatar_url": agent.Branding.AvatarURL, "privacy_url": agent.Branding.PrivacyURL, "memory_enabled": true,
		"lead_capture_enabled": agent.LeadCapture.Enabled, "lead_capture_fields": agent.LeadCapture.Fields,
		"handoff": resolveHandoff(agent),
		"booking": resolveBooking(agent),
	}
	for key, value := range widgetBrandingPayload(agent) {
		payload[key] = value
	}
	return payload
}

func writeSSE(w http.ResponseWriter, event string, payload any) {
	encoded, _ := json.Marshal(payload)
	_, _ = fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event, encoded)
}

var nonPhoneCharacters = regexp.MustCompile(`[^0-9+]`)

func normalizePhone(value string) string {
	value = nonPhoneCharacters.ReplaceAllString(strings.TrimSpace(value), "")
	if value == "" {
		return ""
	}
	if strings.Count(value, "+") > 1 || strings.Contains(value[1:], "+") {
		return ""
	}
	if len(value) > 20 {
		return ""
	}
	return value
}

// safeClientMessageID accepts the shapes a client library would plausibly emit
// -- a UUID, a nanoid, or this service's own msg_ prefix -- and nothing else, so
// the value can be stored and logged without escaping concerns.
func safeClientMessageID(value string) bool {
	for _, character := range value {
		switch {
		case character >= 'a' && character <= 'z',
			character >= 'A' && character <= 'Z',
			character >= '0' && character <= '9',
			character == '-', character == '_', character == '.', character == ':':
		default:
			return false
		}
	}
	return true
}

// resetWidgetSession ends the caller's conversation and hands back a fresh one.
//
// A visitor who wants to start over should not have to clear site data. Expiring
// the old session is what makes it non-resumable: createWidgetSession only revives
// a session that is still live, so an expired row is left alone and the transcript
// stays intact for the customer's inbox rather than being deleted.
//
// The visitor identity is deliberately preserved. Reset means "new conversation",
// not "forget me" -- erasure is a separate concern with its own consent semantics.
func (s *Server) resetWidgetSession(w http.ResponseWriter, r *http.Request) {
	session, authorized := s.authorizeWidgetSession(r)
	if !authorized {
		s.writeError(w, r, http.StatusUnauthorized, "invalid_session", "The widget session is invalid or expired", nil)
		return
	}
	agent, found := s.findPublishedAgentByID(session.AccountID, session.AgentID)
	if !found {
		s.writeError(w, r, http.StatusNotFound, "agent_not_found", "Published agent not found", nil)
		return
	}
	if !s.hasEntitlement(agent.AccountID) {
		s.writeError(w, r, http.StatusPaymentRequired, "subscription_required", "This assistant is temporarily unavailable", nil)
		return
	}
	sessionToken, err := security.RandomToken(32)
	if err != nil {
		s.writeError(w, r, http.StatusInternalServerError, "token_error", "A widget session could not be created", nil)
		return
	}
	now := time.Now().UTC()
	expiresAt := now.Add(widgetSessionTTL)
	fresh := model.Session{
		ID: newID("cvs_"), AccountID: agent.AccountID, AgentID: agent.ID, VisitorID: session.VisitorID,
		SessionTokenHash: security.HashOpaqueToken(sessionToken), Origin: r.Header.Get("Origin"), Locale: session.Locale,
		PageURL: session.PageURL, PageTitle: session.PageTitle, Referrer: session.Referrer,
		MemoryConsent: session.MemoryConsent, ExpiresAt: expiresAt, CreatedAt: now, UpdatedAt: now, LastSeenAt: now,
	}
	var history []model.Message
	err = s.store.Update(func(state *model.State) error {
		for index := range state.Sessions {
			if state.Sessions[index].ID == session.ID {
				// Expire the old session TOKEN so the caller cannot keep using it after
				// being handed a new one. The row itself stays: the customer keeps the
				// transcript, and the resume path walks newest-first, so the fresh
				// session below is what a returning visitor gets.
				state.Sessions[index].ExpiresAt = now
				state.Sessions[index].UpdatedAt = now
				break
			}
		}
		state.Sessions = append(state.Sessions, fresh)
		if welcome := strings.TrimSpace(agent.WelcomeMessage); welcome != "" {
			state.Messages = append(state.Messages, model.Message{
				ID: newID("msg_"), AccountID: agent.AccountID, AgentID: agent.ID, SessionID: fresh.ID,
				VisitorID: fresh.VisitorID, Role: "assistant", Content: welcome, CreatedAt: now,
			})
		}
		for _, message := range state.Messages {
			if message.SessionID == fresh.ID {
				history = append(history, message.Clone())
			}
		}
		return nil
	})
	if err != nil {
		s.storageFailure(w, r, err)
		return
	}
	// Same shape as createWidgetSession so the widget can reuse one code path.
	s.writeData(w, http.StatusCreated, map[string]any{
		"session_id": fresh.ID, "session_token": sessionToken, "expires_at": expiresAt,
		"conversation": map[string]any{"id": fresh.ID, "resumed": false, "messages": publicWidgetHistory(history, widgetHistoryLimit)},
		"agent":        publicAgent(agent),
	})
}

// findPublishedAgentByID resolves a published agent within one account, which is
// what a session already proves the caller may reach.
func (s *Server) findPublishedAgentByID(accountID, agentID string) (model.Agent, bool) {
	var result model.Agent
	found := false
	_ = s.store.View(func(state *model.State) error {
		if agent, ok := findAgent(state, accountID, agentID); ok && agent.Status == "published" {
			result, found = agent.Clone(), true
		}
		return nil
	})
	return result, found
}
