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

	"garuda/backend/internal/config"
	"garuda/backend/internal/llm"
	"garuda/backend/internal/model"
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
			welcome := strings.TrimSpace(agent.WelcomeMessage)
			if welcome != "" {
				state.Messages = append(state.Messages, model.Message{ID: newID("msg_"), AccountID: agent.AccountID, AgentID: agent.ID, SessionID: session.ID, VisitorID: visitorID, Role: "assistant", Content: welcome, CreatedAt: now})
			}
		}
		for _, message := range state.Messages {
			if message.SessionID == session.ID {
				history = append(history, message)
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
	if input.Content == "" || len(input.Content) > 4_000 {
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
					agent = candidate
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
	history := s.chatHistory(session, 30)
	prompt := promptForAgent(agent)
	ragContext, cancelRAG := context.WithTimeout(providerContext, widgetRAGTTL)
	chunks, ragErr := s.rag.Search(ragContext, session.AccountID, agent.ID, input.Content, 4)
	cancelRAG()
	if ragErr == nil {
		prompt = promptWithRetrieved(prompt, s.filterReadyRAGChunks(session.AccountID, agent.ID, chunks))
	} else {
		s.logger.Warn("RAG search unavailable", "agent_id", agent.ID, "error", ragErr, "request_id", requestID(r.Context()))
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
		writeSSE(w, "meta", map[string]any{"session_id": session.ID, "message_id": assistantMessage.ID})
		writeSSE(w, "delta", map[string]string{"content": assistantMessage.Content})
		writeSSE(w, "done", result)
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

type widgetLeadRequest struct {
	ClientCaptureID string `json:"client_capture_id,omitempty"`
	Fields          struct {
		Name    string `json:"name,omitempty"`
		Email   string `json:"email,omitempty"`
		Phone   string `json:"phone,omitempty"`
		Company string `json:"company,omitempty"`
	} `json:"fields"`
	Consent struct {
		Granted       bool   `json:"granted"`
		NoticeVersion string `json:"notice_version,omitempty"`
	} `json:"consent"`
}

func (s *Server) widgetLead(w http.ResponseWriter, r *http.Request) {
	var input widgetLeadRequest
	if !s.decodeJSON(w, r, &input) {
		return
	}
	if !input.Consent.Granted {
		s.writeError(w, r, http.StatusUnprocessableEntity, "consent_required", "Consent is required before contact details can be saved", nil)
		return
	}
	session, valid := s.authorizeWidgetSession(r)
	if !valid {
		s.writeError(w, r, http.StatusUnauthorized, "invalid_session", "The widget session is invalid or expired", nil)
		return
	}
	email := normalizeEmail(input.Fields.Email)
	phone := normalizePhone(input.Fields.Phone)
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
	if len(input.Fields.Name) > 160 || len(input.Fields.Company) > 160 {
		s.writeError(w, r, http.StatusUnprocessableEntity, "validation_failed", "Lead fields are too long", nil)
		return
	}
	now := time.Now().UTC()
	lead := model.Lead{ID: newID("lead_"), AccountID: session.AccountID, AgentID: session.AgentID, SessionID: session.ID, VisitorID: session.VisitorID, Name: strings.TrimSpace(input.Fields.Name), Email: email, Phone: phone, Company: strings.TrimSpace(input.Fields.Company), Status: "new", Source: "widget", Metadata: map[string]string{"consent": "granted", "notice_version": input.Consent.NoticeVersion, "capture_id": input.ClientCaptureID}, CreatedAt: now, UpdatedAt: now}
	err := s.store.Update(func(state *model.State) error {
		for index := range state.Leads {
			existing := &state.Leads[index]
			if input.ClientCaptureID != "" && existing.AccountID == session.AccountID && existing.AgentID == session.AgentID && existing.SessionID == session.ID && existing.Metadata["capture_id"] == input.ClientCaptureID {
				lead = *existing
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
				lead = *existing
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
				result, found = agent, true
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

func publicAgent(agent model.Agent) map[string]any {
	return map[string]any{
		"display_name": agent.Name, "welcome_message": agent.WelcomeMessage, "suggested_prompts": agent.SuggestedReplies,
		"accent_color": agent.Branding.AccentColor, "position": agent.Branding.Position, "launcher_label": agent.Branding.LauncherText,
		"avatar_url": agent.Branding.AvatarURL, "privacy_url": agent.Branding.PrivacyURL, "memory_enabled": true,
		"lead_capture_enabled": agent.LeadCapture.Enabled, "lead_capture_fields": agent.LeadCapture.Fields,
	}
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
