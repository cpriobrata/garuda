package api

import (
	"errors"
	"net/http"
	"sort"
	"strings"
	"time"

	"garuda/backend/internal/model"
)

func (s *Server) dashboard(w http.ResponseWriter, r *http.Request) {
	identity := identityFrom(r.Context())
	type dayStat struct {
		Date          string `json:"date"`
		Conversations int    `json:"conversations"`
		Leads         int    `json:"leads"`
		Messages      int    `json:"messages"`
	}
	days := make([]dayStat, 7)
	dayIndex := map[string]int{}
	today := time.Now().UTC().Truncate(24 * time.Hour)
	for index := range days {
		date := today.AddDate(0, 0, index-6).Format("2006-01-02")
		days[index].Date = date
		dayIndex[date] = index
	}
	var agents []model.Agent
	var sessions []model.Session
	var leads []model.Lead
	messageCount := 0
	engagedSessionIDs := make(map[string]struct{})
	_ = s.store.View(func(state *model.State) error {
		for _, agent := range state.Agents {
			if agent.AccountID == identity.AccountID && agent.Status != "archived" {
				agents = append(agents, agent)
			}
		}
		for _, session := range state.Sessions {
			if session.AccountID == identity.AccountID && session.StartedAt != nil {
				sessions = append(sessions, session)
				engagedSessionIDs[session.ID] = struct{}{}
				if index, ok := dayIndex[session.StartedAt.UTC().Format("2006-01-02")]; ok {
					days[index].Conversations++
				}
			}
		}
		for _, lead := range state.Leads {
			if lead.AccountID == identity.AccountID {
				leads = append(leads, lead.Clone())
				if index, ok := dayIndex[lead.CreatedAt.UTC().Format("2006-01-02")]; ok {
					days[index].Leads++
				}
			}
		}
		for _, message := range state.Messages {
			if message.AccountID == identity.AccountID {
				if _, engaged := engagedSessionIDs[message.SessionID]; !engaged {
					continue
				}
				messageCount++
				if index, ok := dayIndex[message.CreatedAt.UTC().Format("2006-01-02")]; ok {
					days[index].Messages++
				}
			}
		}
		return nil
	})
	sort.Slice(leads, func(i, j int) bool { return leads[i].CreatedAt.After(leads[j].CreatedAt) })
	recentLeads := leads
	if len(recentLeads) > 5 {
		recentLeads = recentLeads[:5]
	}
	published := 0
	for _, agent := range agents {
		if agent.Status == "published" {
			published++
		}
	}
	conversionRate := float64(0)
	if len(sessions) > 0 {
		conversionRate = float64(len(leads)) / float64(len(sessions)) * 100
	}
	s.writeData(w, http.StatusOK, map[string]any{
		"metrics":  map[string]any{"agents": len(agents), "published_agents": published, "conversations": len(sessions), "messages": messageCount, "leads": len(leads), "lead_conversion_rate": conversionRate},
		"activity": days, "recent_leads": recentLeads, "agents": agents,
	})
}

func (s *Server) analyticsOverview(w http.ResponseWriter, r *http.Request) {
	s.dashboard(w, r)
}

func (s *Server) listLeads(w http.ResponseWriter, r *http.Request) {
	identity := identityFrom(r.Context())
	page, pageSize := parsePage(r)
	agentID := strings.TrimSpace(r.URL.Query().Get("agent_id"))
	status := strings.TrimSpace(r.URL.Query().Get("status"))
	query := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("query")))
	items := make([]model.Lead, 0)
	_ = s.store.View(func(state *model.State) error {
		for index := len(state.Leads) - 1; index >= 0; index-- {
			lead := state.Leads[index]
			if lead.AccountID != identity.AccountID || (agentID != "" && lead.AgentID != agentID) || (status != "" && lead.Status != status) {
				continue
			}
			if query != "" && !strings.Contains(strings.ToLower(strings.Join([]string{lead.Name, lead.Email, lead.Phone, lead.Company}, " ")), query) {
				continue
			}
			items = append(items, lead.Clone())
		}
		return nil
	})
	total := len(items)
	s.writeDataMeta(w, http.StatusOK, paginate(items, page, pageSize), map[string]any{"page": page, "page_size": pageSize, "total": total})
}

func (s *Server) getLead(w http.ResponseWriter, r *http.Request) {
	identity := identityFrom(r.Context())
	var result model.Lead
	found := false
	_ = s.store.View(func(state *model.State) error {
		for _, lead := range state.Leads {
			if lead.ID == r.PathValue("leadID") && lead.AccountID == identity.AccountID {
				result, found = lead, true
				break
			}
		}
		return nil
	})
	if !found {
		s.writeError(w, r, http.StatusNotFound, "lead_not_found", "Lead not found", nil)
		return
	}
	s.writeData(w, http.StatusOK, result)
}

type updateLeadRequest struct {
	Status *string `json:"status,omitempty"`
	Notes  *string `json:"notes,omitempty"`
}

func (s *Server) updateLead(w http.ResponseWriter, r *http.Request) {
	identity := identityFrom(r.Context())
	var input updateLeadRequest
	if !s.decodeJSON(w, r, &input) {
		return
	}
	validStatuses := map[string]bool{"new": true, "qualified": true, "contacted": true, "converted": true, "disqualified": true}
	if input.Status != nil && !validStatuses[*input.Status] {
		s.writeError(w, r, http.StatusUnprocessableEntity, "validation_failed", "Lead status is invalid", nil)
		return
	}
	if input.Notes != nil && len(*input.Notes) > 4_000 {
		s.writeError(w, r, http.StatusUnprocessableEntity, "validation_failed", "Notes must not exceed 4,000 characters", nil)
		return
	}
	var result model.Lead
	found := false
	err := s.store.Update(func(state *model.State) error {
		for index := range state.Leads {
			lead := &state.Leads[index]
			if lead.ID == r.PathValue("leadID") && lead.AccountID == identity.AccountID {
				if input.Status != nil {
					lead.Status = *input.Status
				}
				if input.Notes != nil {
					lead.Notes = strings.TrimSpace(*input.Notes)
				}
				lead.UpdatedAt = time.Now().UTC()
				result, found = *lead, true
				break
			}
		}
		return nil
	})
	if err != nil {
		s.storageFailure(w, r, err)
		return
	}
	if !found {
		s.writeError(w, r, http.StatusNotFound, "lead_not_found", "Lead not found", nil)
		return
	}
	s.writeData(w, http.StatusOK, result)
}

type conversationSummary struct {
	ID           string         `json:"id"`
	AgentID      string         `json:"agent_id"`
	Origin       string         `json:"origin,omitempty"`
	PageURL      string         `json:"page_url,omitempty"`
	PageTitle    string         `json:"page_title,omitempty"`
	Locale       string         `json:"locale,omitempty"`
	CreatedAt    time.Time      `json:"created_at"`
	UpdatedAt    time.Time      `json:"updated_at"`
	LastSeenAt   time.Time      `json:"last_seen_at"`
	MessageCount int            `json:"message_count"`
	LastMessage  *model.Message `json:"last_message,omitempty"`
	Lead         *model.Lead    `json:"lead,omitempty"`
}

func (s *Server) listConversations(w http.ResponseWriter, r *http.Request) {
	identity := identityFrom(r.Context())
	page, pageSize := parsePage(r)
	agentID := strings.TrimSpace(r.URL.Query().Get("agent_id"))
	items := make([]conversationSummary, 0)
	_ = s.store.View(func(state *model.State) error {
		for index := len(state.Sessions) - 1; index >= 0; index-- {
			session := state.Sessions[index]
			if session.AccountID != identity.AccountID || session.StartedAt == nil || (agentID != "" && session.AgentID != agentID) {
				continue
			}
			summary := conversationSummary{ID: session.ID, AgentID: session.AgentID, Origin: session.Origin, PageURL: session.PageURL, PageTitle: session.PageTitle, Locale: session.Locale, CreatedAt: session.CreatedAt, UpdatedAt: session.UpdatedAt, LastSeenAt: session.LastSeenAt}
			for messageIndex := range state.Messages {
				message := state.Messages[messageIndex]
				if message.SessionID == session.ID {
					summary.MessageCount++
					copy := message
					summary.LastMessage = &copy
				}
			}
			for leadIndex := range state.Leads {
				if state.Leads[leadIndex].SessionID == session.ID {
					copy := state.Leads[leadIndex]
					summary.Lead = &copy
					break
				}
			}
			items = append(items, summary)
		}
		return nil
	})
	total := len(items)
	s.writeDataMeta(w, http.StatusOK, paginate(items, page, pageSize), map[string]any{"page": page, "page_size": pageSize, "total": total})
}

func (s *Server) getConversation(w http.ResponseWriter, r *http.Request) {
	identity := identityFrom(r.Context())
	var session model.Session
	var messages []model.Message
	var lead *model.Lead
	found := false
	_ = s.store.View(func(state *model.State) error {
		for _, candidate := range state.Sessions {
			if candidate.ID == r.PathValue("sessionID") && candidate.AccountID == identity.AccountID {
				session, found = candidate, true
				break
			}
		}
		if found {
			for _, message := range state.Messages {
				if message.SessionID == session.ID && message.AccountID == identity.AccountID {
					messages = append(messages, message.Clone())
				}
			}
			for _, candidate := range state.Leads {
				if candidate.SessionID == session.ID && candidate.AccountID == identity.AccountID {
					copy := candidate.Clone()
					lead = &copy
					break
				}
			}
		}
		return nil
	})
	if !found {
		s.writeError(w, r, http.StatusNotFound, "conversation_not_found", "Conversation not found", nil)
		return
	}
	s.writeData(w, http.StatusOK, map[string]any{"conversation": map[string]any{
		"id": session.ID, "agent_id": session.AgentID, "origin": session.Origin, "page_url": session.PageURL,
		"page_title": session.PageTitle, "referrer": session.Referrer, "locale": session.Locale,
		"created_at": session.CreatedAt, "updated_at": session.UpdatedAt, "last_seen_at": session.LastSeenAt,
	}, "messages": messages, "lead": lead})
}

type updateProfileRequest struct {
	Name string `json:"name"`
}

func (s *Server) updateProfile(w http.ResponseWriter, r *http.Request) {
	identity := identityFrom(r.Context())
	var input updateProfileRequest
	if !s.decodeJSON(w, r, &input) {
		return
	}
	input.Name = strings.TrimSpace(input.Name)
	if input.Name == "" || len(input.Name) > 120 {
		s.writeError(w, r, http.StatusUnprocessableEntity, "validation_failed", "Name must contain 1 to 120 characters", nil)
		return
	}
	var result model.User
	err := s.store.Update(func(state *model.State) error {
		user, ok := findUser(state, identity.UserID)
		if !ok || user.AccountID != identity.AccountID {
			return errors.New("not found")
		}
		user.Name = input.Name
		user.UpdatedAt = time.Now().UTC()
		result = *user
		return nil
	})
	if err != nil {
		if err.Error() == "not found" {
			s.writeError(w, r, http.StatusNotFound, "user_not_found", "User not found", nil)
			return
		}
		s.storageFailure(w, r, err)
		return
	}
	s.writeData(w, http.StatusOK, safeUser(result))
}
