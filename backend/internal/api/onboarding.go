package api

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"garuda/backend/internal/model"
)

type onboardingQuestion struct {
	ID        string `json:"id"`
	Prompt    string `json:"prompt"`
	InputHint string `json:"input_hint"`
}

var onboardingQuestionsList = []onboardingQuestion{
	{ID: "business_profile", Prompt: "Tell me about your business, what it offers, and your website if you have one.", InputHint: "For example: Acme Realty helps buyers find new homes in Noida."},
	{ID: "primary_outcome", Prompt: "What is the main outcome you want this assistant to create?", InputHint: "Answer questions, qualify leads, recommend an offer, or arrange a human follow-up."},
	{ID: "audience_and_offer", Prompt: "Who is your ideal visitor, and what products or services should the assistant discuss?", InputHint: "Describe the audience, their needs, and your most important offers."},
	{ID: "voice_and_capture", Prompt: "How should the assistant sound, and when should it request contact details or hand off to a person?", InputHint: "For example: warm and professional; ask for email after giving a useful recommendation."},
}

func (s *Server) onboardingQuestions(w http.ResponseWriter, _ *http.Request) {
	s.writeData(w, http.StatusOK, map[string]any{"questions": onboardingQuestionsList, "required": len(onboardingQuestionsList)})
}

func (s *Server) getOnboarding(w http.ResponseWriter, r *http.Request) {
	identity := identityFrom(r.Context())
	onboarding := model.Onboarding{AccountID: identity.AccountID, Answers: map[string]string{}, Messages: []model.OnboardingMessage{}}
	_ = s.store.View(func(state *model.State) error {
		for _, candidate := range state.Onboarding {
			if candidate.AccountID == identity.AccountID {
				onboarding = candidate.Clone()
				if onboarding.Answers == nil {
					onboarding.Answers = legacyOnboardingAnswers(candidate)
				}
				break
			}
		}
		return nil
	})
	s.writeData(w, http.StatusOK, onboardingView(onboarding))
}

type saveOnboardingRequest struct {
	BusinessName string            `json:"business_name"`
	Industry     string            `json:"industry"`
	Website      string            `json:"website,omitempty"`
	Audience     string            `json:"audience"`
	Goals        []string          `json:"goals"`
	Tone         string            `json:"tone"`
	BotType      string            `json:"bot_type"`
	KeyOffers    []string          `json:"key_offers,omitempty"`
	FAQs         []model.FAQ       `json:"faqs,omitempty"`
	Answers      map[string]string `json:"answers,omitempty"`
}

func (s *Server) saveOnboarding(w http.ResponseWriter, r *http.Request) {
	var input saveOnboardingRequest
	if !s.decodeJSON(w, r, &input) {
		return
	}
	identity := identityFrom(r.Context())
	if len(input.BusinessName) > 160 || len(input.Industry) > 120 || len(input.Website) > 500 || len(input.Audience) > 2_000 {
		s.writeError(w, r, http.StatusUnprocessableEntity, "validation_failed", "One or more onboarding answers are too long", nil)
		return
	}
	submitted, overlongField := submittedOnboardingAnswers(input.Answers)
	if overlongField != "" {
		s.writeError(w, r, http.StatusUnprocessableEntity, "validation_failed", "One or more onboarding answers are too long", map[string]string{"field": overlongField})
		return
	}
	now := time.Now().UTC()
	value := model.Onboarding{
		AccountID: identity.AccountID, BusinessName: strings.TrimSpace(input.BusinessName), Industry: strings.TrimSpace(input.Industry),
		Website: strings.TrimSpace(input.Website), Audience: strings.TrimSpace(input.Audience), Goals: cleanStrings(input.Goals, 8, 200),
		Tone: strings.TrimSpace(input.Tone), BotType: strings.TrimSpace(input.BotType), KeyOffers: cleanStrings(input.KeyOffers, 20, 300), FAQs: input.FAQs,
		UpdatedAt: now,
	}
	var result model.Onboarding
	if err := s.store.Update(func(state *model.State) error {
		var existing *model.Onboarding
		for index := range state.Onboarding {
			if state.Onboarding[index].AccountID == identity.AccountID {
				existing = &state.Onboarding[index]
				break
			}
		}
		answers := map[string]string{}
		if existing != nil {
			value.Messages = existing.Messages
			value.CompletedAt = existing.CompletedAt
			value.GeneratedAgentID = existing.GeneratedAgentID
			previous := existing.Answers
			if previous == nil {
				previous = legacyOnboardingAnswers(*existing)
			}
			for field, answer := range previous {
				answers[field] = answer
			}
		}
		for field, answer := range legacyOnboardingAnswers(value) {
			answers[field] = answer
		}
		// The portal only ever sends the typed answers, so they have to survive this
		// write and become the business context the agent generator reads. Replacing
		// the record wholesale left every generated agent generic.
		for field, answer := range submitted {
			answers[field] = answer
		}
		value.Answers = answers
		fillOnboardingContextFromAnswers(&value)
		if existing != nil {
			*existing = value
		} else {
			state.Onboarding = append(state.Onboarding, value)
		}
		result = value.Clone()
		return nil
	}); err != nil {
		s.storageFailure(w, r, err)
		return
	}
	s.writeData(w, http.StatusOK, onboardingView(result))
}

// submittedOnboardingAnswers keeps the answers that belong to a known question and
// reports the first field whose answer exceeds the same limit the chat path applies.
func submittedOnboardingAnswers(supplied map[string]string) (map[string]string, string) {
	answers := map[string]string{}
	for _, question := range onboardingQuestionsList {
		answer := strings.TrimSpace(supplied[question.ID])
		if answer == "" {
			continue
		}
		if len(answer) > 4_000 {
			return nil, question.ID
		}
		answers[question.ID] = answer
	}
	return answers, ""
}

// fillOnboardingContextFromAnswers derives the business context fields that agent
// generation reads from the typed answers, without overwriting anything the caller
// stated directly. applyCanonicalAnswers does the same for the chat path.
func fillOnboardingContextFromAnswers(onboarding *model.Onboarding) {
	if onboarding.BusinessName == "" {
		onboarding.BusinessName = onboarding.Answers["business_profile"]
	}
	if len(onboarding.Goals) == 0 && onboarding.Answers["primary_outcome"] != "" {
		onboarding.Goals = []string{onboarding.Answers["primary_outcome"]}
	}
	if onboarding.Audience == "" {
		onboarding.Audience = onboarding.Answers["audience_and_offer"]
	}
	if onboarding.Tone == "" {
		onboarding.Tone = onboarding.Answers["voice_and_capture"]
	}
}

type onboardingMessageRequest struct {
	ClientMessageID string `json:"client_message_id,omitempty"`
	Content         string `json:"content"`
}

func (s *Server) onboardingMessage(w http.ResponseWriter, r *http.Request) {
	var input onboardingMessageRequest
	if !s.decodeJSON(w, r, &input) {
		return
	}
	input.Content = strings.TrimSpace(input.Content)
	if input.Content == "" || len(input.Content) > 4_000 {
		s.writeError(w, r, http.StatusUnprocessableEntity, "validation_failed", "Answer must contain 1 to 4,000 characters", nil)
		return
	}
	identity := identityFrom(r.Context())
	now := time.Now().UTC()
	userMessage := model.OnboardingMessage{ID: input.ClientMessageID, Role: "user", Content: input.Content, CreatedAt: now}
	if userMessage.ID == "" {
		userMessage.ID = newID("omsg_")
	}
	var assistantMessage model.OnboardingMessage
	acceptedField := ""
	var result model.Onboarding
	err := s.store.Update(func(state *model.State) error {
		var onboarding *model.Onboarding
		for index := range state.Onboarding {
			if state.Onboarding[index].AccountID == identity.AccountID {
				onboarding = &state.Onboarding[index]
				break
			}
		}
		if onboarding == nil {
			state.Onboarding = append(state.Onboarding, model.Onboarding{AccountID: identity.AccountID, Answers: map[string]string{}, UpdatedAt: now})
			onboarding = &state.Onboarding[len(state.Onboarding)-1]
		}
		if onboarding.Answers == nil {
			onboarding.Answers = legacyOnboardingAnswers(*onboarding)
		}
		for index, existing := range onboarding.Messages {
			if input.ClientMessageID == "" || existing.ID != input.ClientMessageID {
				continue
			}
			// A retry has to be answerable with the body the first call returned, so
			// rebuild that answer from the stored conversation instead of switching
			// to the onboarding record shape the caller cannot parse.
			userMessage = existing
			if index+1 < len(onboarding.Messages) && onboarding.Messages[index+1].Role == "assistant" {
				assistantMessage = onboarding.Messages[index+1]
			}
			acceptedField = onboardingFieldAnsweredBy(*onboarding, existing.Content)
			result = onboarding.Clone()
			return errors.New("duplicate")
		}
		for _, question := range onboardingQuestionsList {
			if strings.TrimSpace(onboarding.Answers[question.ID]) == "" {
				acceptedField = question.ID
				break
			}
		}
		if acceptedField == "" {
			return errors.New("complete")
		}
		onboarding.Answers[acceptedField] = input.Content
		onboarding.Messages = append(onboarding.Messages, userMessage)
		next := currentOnboardingQuestion(*onboarding)
		assistantContent := "Thanks, I have all four answers. Review them, then generate your draft agent."
		if next != nil {
			assistantContent = next.Prompt
		}
		assistantMessage = model.OnboardingMessage{ID: newID("omsg_"), Role: "assistant", Content: assistantContent, CreatedAt: now}
		onboarding.Messages = append(onboarding.Messages, assistantMessage)
		onboarding.UpdatedAt = now
		applyCanonicalAnswers(onboarding)
		result = onboarding.Clone()
		return nil
	})
	if err != nil {
		switch err.Error() {
		case "duplicate":
			s.writeData(w, http.StatusOK, onboardingMessageView(userMessage, assistantMessage, acceptedField, result, true))
		case "complete":
			s.writeError(w, r, http.StatusConflict, "onboarding_already_answered", "All required onboarding questions are already answered", nil)
		default:
			s.storageFailure(w, r, err)
		}
		return
	}
	s.writeData(w, http.StatusCreated, onboardingMessageView(userMessage, assistantMessage, acceptedField, result, false))
}

// onboardingMessageView builds the one body shape POST /v1/onboarding/messages
// answers with, so an idempotent retry returns what the first call returned.
func onboardingMessageView(userMessage, assistantMessage model.OnboardingMessage, acceptedField string, onboarding model.Onboarding, replayed bool) map[string]any {
	return map[string]any{
		"user_message": userMessage, "assistant_message": assistantMessage,
		"accepted_answer":  map[string]string{"field": acceptedField, "value": userMessage.Content},
		"current_question": currentOnboardingQuestion(onboarding), "progress": onboardingProgress(onboarding),
		"ready_to_complete": onboardingAnswered(onboarding) == 4, "replayed": replayed,
	}
}

// onboardingFieldAnsweredBy reports which question a stored answer belongs to, so a
// replayed message can name the field the original call reported accepting.
func onboardingFieldAnsweredBy(onboarding model.Onboarding, content string) string {
	answers := onboarding.Answers
	if answers == nil {
		answers = legacyOnboardingAnswers(onboarding)
	}
	for _, question := range onboardingQuestionsList {
		if answers[question.ID] == content {
			return question.ID
		}
	}
	return ""
}

// onboardingRaceError reports that a concurrent request already generated the
// agent, and carries the winner's id so the loser can return that instead of
// failing. Generation takes seconds, so several clicks routinely overlap.
type onboardingRaceError struct{ agentID string }

func (e onboardingRaceError) Error() string { return "onboarding agent already generated" }

func (s *Server) completeOnboarding(w http.ResponseWriter, r *http.Request) {
	identity := identityFrom(r.Context())
	if !s.hasEntitlement(identity.AccountID) {
		s.writeError(w, r, http.StatusPaymentRequired, "subscription_required", "An active subscription is required to generate an agent", nil)
		return
	}
	var onboarding model.Onboarding
	found := false
	_ = s.store.View(func(state *model.State) error {
		for _, candidate := range state.Onboarding {
			if candidate.AccountID == identity.AccountID {
				// Clone: the answers are counted and handed to agent generation long
				// after this read lock is released, and a message arriving meanwhile
				// writes that same map. A concurrent map read is fatal, not a panic.
				onboarding, found = candidate.Clone(), true
				break
			}
		}
		return nil
	})
	if !found || onboardingAnswered(onboarding) < 4 {
		s.writeError(w, r, http.StatusUnprocessableEntity, "onboarding_incomplete", "All four onboarding questions must be answered", map[string]int{"answered": onboardingAnswered(onboarding), "required": 4})
		return
	}
	if onboarding.GeneratedAgentID != "" {
		var existing model.Agent
		_ = s.store.View(func(state *model.State) error {
			if agent, ok := findAgent(state, identity.AccountID, onboarding.GeneratedAgentID); ok {
				existing = agent.Clone()
			}
			return nil
		})
		s.writeData(w, http.StatusAccepted, map[string]any{"job": map[string]any{"id": "completed_" + existing.ID, "type": "generate_agent", "status": "succeeded"}, "agent": existing})
		return
	}
	draft, err := s.llm.GenerateAgent(r.Context(), onboarding, "")
	if err != nil {
		s.writeError(w, r, http.StatusServiceUnavailable, "ai_unavailable", "Agent generation is temporarily unavailable", nil)
		return
	}
	now := time.Now().UTC()
	agent := agentFromDraft(identity.AccountID, draft, now)
	job := model.Job{ID: newID("job_"), AccountID: identity.AccountID, Type: "generate_agent", Status: "succeeded", Result: map[string]any{"agent_id": agent.ID}, CreatedAt: now, UpdatedAt: now}
	err = s.store.Update(func(state *model.State) error {
		for index := range state.Onboarding {
			if state.Onboarding[index].AccountID == identity.AccountID {
				if state.Onboarding[index].GeneratedAgentID != "" {
					return onboardingRaceError{agentID: state.Onboarding[index].GeneratedAgentID}
				}
				state.Onboarding[index].GeneratedAgentID = agent.ID
				state.Onboarding[index].CompletedAt = &now
				state.Onboarding[index].UpdatedAt = now
			}
		}
		state.Agents = append(state.Agents, agent)
		state.Jobs = append(state.Jobs, job)
		return nil
	})
	var raced onboardingRaceError
	if errors.As(err, &raced) {
		// A concurrent request won. Answer with the agent it created rather than a
		// 500: completing onboarding is idempotent from the caller's point of view.
		var existing model.Agent
		_ = s.store.View(func(state *model.State) error {
			if winner, ok := findAgent(state, identity.AccountID, raced.agentID); ok {
				existing = winner.Clone()
			}
			return nil
		})
		s.writeData(w, http.StatusAccepted, map[string]any{"job": map[string]any{"id": "completed_" + existing.ID, "type": "generate_agent", "status": "succeeded"}, "agent": existing})
		return
	}
	if err != nil {
		s.storageFailure(w, r, err)
		return
	}
	s.writeData(w, http.StatusAccepted, map[string]any{"job": job, "agent": agent})
}

func (s *Server) getJob(w http.ResponseWriter, r *http.Request) {
	identity := identityFrom(r.Context())
	jobID := r.PathValue("jobID")
	var result model.Job
	found := false
	_ = s.store.View(func(state *model.State) error {
		for _, job := range state.Jobs {
			if job.ID == jobID && job.AccountID == identity.AccountID {
				result, found = job.Clone(), true
				break
			}
		}
		return nil
	})
	if !found {
		s.writeError(w, r, http.StatusNotFound, "job_not_found", "Job not found", nil)
		return
	}
	s.writeData(w, http.StatusOK, result)
}

func onboardingView(onboarding model.Onboarding) map[string]any {
	status := "in_progress"
	if onboardingAnswered(onboarding) == 0 {
		status = "not_started"
	}
	if onboarding.CompletedAt != nil {
		status = "completed"
	}
	return map[string]any{
		"id": onboarding.AccountID, "status": status, "answers": onboarding.Answers, "messages": onboarding.Messages,
		"current_question": currentOnboardingQuestion(onboarding), "progress": onboardingProgress(onboarding),
		"completed_at": onboarding.CompletedAt, "generated_agent_id": onboarding.GeneratedAgentID,
	}
}

func onboardingProgress(onboarding model.Onboarding) map[string]int {
	return map[string]int{"answered": onboardingAnswered(onboarding), "required": len(onboardingQuestionsList)}
}

func onboardingAnswered(onboarding model.Onboarding) int {
	answers := onboarding.Answers
	if answers == nil {
		answers = legacyOnboardingAnswers(onboarding)
	}
	count := 0
	for _, question := range onboardingQuestionsList {
		if strings.TrimSpace(answers[question.ID]) != "" {
			count++
		}
	}
	return count
}

func currentOnboardingQuestion(onboarding model.Onboarding) *onboardingQuestion {
	answers := onboarding.Answers
	if answers == nil {
		answers = legacyOnboardingAnswers(onboarding)
	}
	for _, question := range onboardingQuestionsList {
		if strings.TrimSpace(answers[question.ID]) == "" {
			copy := question
			return &copy
		}
	}
	return nil
}

func legacyOnboardingAnswers(onboarding model.Onboarding) map[string]string {
	answers := map[string]string{}
	if onboarding.BusinessName != "" || onboarding.Industry != "" || onboarding.Website != "" {
		answers["business_profile"] = strings.TrimSpace(strings.Join([]string{onboarding.BusinessName, onboarding.Industry, onboarding.Website}, "; "))
	}
	if len(onboarding.Goals) > 0 {
		answers["primary_outcome"] = strings.Join(onboarding.Goals, ", ")
	}
	if onboarding.Audience != "" || len(onboarding.KeyOffers) > 0 {
		answers["audience_and_offer"] = strings.TrimSpace(onboarding.Audience + "; " + strings.Join(onboarding.KeyOffers, ", "))
	}
	if onboarding.Tone != "" || onboarding.BotType != "" {
		answers["voice_and_capture"] = strings.TrimSpace(onboarding.Tone + "; " + onboarding.BotType)
	}
	return answers
}

func applyCanonicalAnswers(onboarding *model.Onboarding) {
	onboarding.BusinessName = onboarding.Answers["business_profile"]
	onboarding.Goals = []string{onboarding.Answers["primary_outcome"]}
	onboarding.Audience = onboarding.Answers["audience_and_offer"]
	onboarding.Tone = onboarding.Answers["voice_and_capture"]
}

func cleanStrings(values []string, maxItems, maxLength int) []string {
	result := make([]string, 0, min(len(values), maxItems))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" && len(value) <= maxLength && len(result) < maxItems {
			result = append(result, value)
		}
	}
	return result
}
