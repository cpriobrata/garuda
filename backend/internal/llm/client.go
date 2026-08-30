package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"garuda/backend/internal/model"
)

type Client struct {
	baseURL    string
	apiKey     string
	model      string
	httpClient *http.Client
}

type ChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type AgentDraft struct {
	Name             string   `json:"name"`
	Description      string   `json:"description"`
	SystemPrompt     string   `json:"system_prompt"`
	WelcomeMessage   string   `json:"welcome_message"`
	SuggestedReplies []string `json:"suggested_replies"`
}

func New(baseURL, apiKey, modelName string) *Client {
	return &Client{
		baseURL: strings.TrimRight(baseURL, "/"),
		apiKey:  apiKey,
		model:   modelName,
		httpClient: &http.Client{
			Timeout: 45 * time.Second,
		},
	}
}

func (c *Client) Enabled() bool { return c.apiKey != "" && c.baseURL != "" && c.model != "" }

const (
	// chatMaxTokens has to clear the model's THINKING budget before a single word
	// of answer appears, which is why it is not cut to the length of a reply.
	// Measured on this model, a short exchange spent about 300 tokens thinking.
	//
	// It is a ceiling on a runaway answer, not the target. The target is set by
	// the style rule in promptForAgent, which asks for one or two sentences --
	// the right lever, because a budget tight enough to enforce brevity would
	// truncate mid-sentence instead.
	chatMaxTokens  = 1_200
	draftMaxTokens = 8_000
)

func (c *Client) Chat(ctx context.Context, systemPrompt string, history []ChatMessage) (string, error) {
	if !c.Enabled() {
		return localReply(history), nil
	}
	messages := make([]ChatMessage, 0, len(history)+1)
	messages = append(messages, ChatMessage{Role: "system", Content: systemPrompt})
	messages = append(messages, history...)
	// A visitor reply that runs past this is not a better answer, it is a wall of
	// text in a chat bubble. The budget clears the thinking the model does first.
	return c.complete(ctx, messages, 0.45, chatMaxTokens, "low")
}

func (c *Client) GenerateAgent(ctx context.Context, onboarding model.Onboarding, brief string) (AgentDraft, error) {
	fallback := localDraft(onboarding, brief)
	if !c.Enabled() {
		return fallback, nil
	}
	contextJSON, _ := json.Marshal(onboarding)
	prompt := `Design a focused website sales and support chatbot from the business context below.
Return only valid JSON with string fields name, description, system_prompt, welcome_message and a suggested_replies array of 3 short strings.
The system prompt must be truthful, conversion-oriented, concise, protect visitor privacy, never invent business facts, and ask permission before collecting contact details.

Business context: ` + string(contextJSON) + "\nAdditional request: " + brief
	// Drafting an agent happens once per account and is where reasoning actually
	// pays, so it keeps the higher effort and a larger budget.
	result, err := c.complete(ctx, []ChatMessage{{Role: "user", Content: prompt}}, 0.25, draftMaxTokens, "")
	if err != nil {
		return AgentDraft{}, err
	}
	result = strings.TrimSpace(result)
	result = strings.TrimPrefix(result, "```json")
	result = strings.TrimPrefix(result, "```")
	result = strings.TrimSuffix(result, "```")
	var draft AgentDraft
	if err := json.Unmarshal([]byte(strings.TrimSpace(result)), &draft); err != nil {
		return fallback, nil
	}
	if strings.TrimSpace(draft.Name) == "" || strings.TrimSpace(draft.SystemPrompt) == "" {
		return fallback, nil
	}
	return draft, nil
}

func (c *Client) complete(ctx context.Context, messages []ChatMessage, temperature float64, maxTokens int, reasoningEffort string) (string, error) {
	// max_tokens and reasoning_effort were both absent, which is not the same as
	// being conservative: with no bound at all, output length and thinking budget
	// were entirely at the provider's discretion on every call, and the
	// per-conversation cost had no ceiling anyone here controlled.
	//
	// The default model is a REASONING model, so a small max_tokens is the opposite
	// trap -- the budget gets eaten by thinking before any answer appears. Both
	// values were verified against the live endpoint rather than assumed: on one
	// short exchange, reasoning_effort "medium" cost 236 total tokens against 185
	// at "low", for the same answer. A website concierge answering from supplied
	// passages does not need extended reasoning.
	payload := struct {
		Model           string        `json:"model"`
		Messages        []ChatMessage `json:"messages"`
		Temperature     float64       `json:"temperature"`
		MaxTokens       int           `json:"max_tokens,omitempty"`
		ReasoningEffort string        `json:"reasoning_effort,omitempty"`
	}{Model: c.model, Messages: messages, Temperature: temperature, MaxTokens: maxTokens, ReasoningEffort: reasoningEffort}
	body, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	request.Header.Set("Authorization", "Bearer "+c.apiKey)
	request.Header.Set("Content-Type", "application/json")
	response, err := c.httpClient.Do(request)
	if err != nil {
		return "", fmt.Errorf("LLM request: %w", err)
	}
	defer response.Body.Close()
	responseBody, err := io.ReadAll(io.LimitReader(response.Body, 2<<20))
	if err != nil {
		return "", err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return "", fmt.Errorf("LLM returned status %d", response.StatusCode)
	}
	var decoded struct {
		Choices []struct {
			Message ChatMessage `json:"message"`
		} `json:"choices"`
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(responseBody, &decoded); err != nil {
		return "", fmt.Errorf("decode LLM response: %w", err)
	}
	if len(decoded.Choices) == 0 || strings.TrimSpace(decoded.Choices[0].Message.Content) == "" {
		if decoded.Error.Message != "" {
			return "", errors.New(decoded.Error.Message)
		}
		return "", errors.New("LLM returned no response")
	}
	return strings.TrimSpace(decoded.Choices[0].Message.Content), nil
}

func localDraft(onboarding model.Onboarding, brief string) AgentDraft {
	business := strings.TrimSpace(onboarding.BusinessName)
	if business == "" {
		business = "Your business"
	}
	industry := strings.TrimSpace(onboarding.Industry)
	if industry == "" {
		industry = "business"
	}
	goal := "help visitors get clear answers and choose the right next step"
	if len(onboarding.Goals) > 0 {
		goal = strings.Join(onboarding.Goals, ", ")
	}
	if strings.TrimSpace(brief) != "" {
		goal += ". The owner also requested: " + strings.TrimSpace(brief)
	}
	return AgentDraft{
		Name:             business + " Concierge",
		Description:      "A conversion-focused " + industry + " assistant for " + business + ".",
		SystemPrompt:     "You are the website concierge for " + business + ". Your goal is to " + goal + ". Be warm, concise, and accurate. Use only the supplied business knowledge and conversation context. If information is missing, say so and offer a human follow-up. Ask one question at a time. Before collecting a name, email, or phone number, explain why it helps and get permission. Never make up prices, availability, policies, guarantees, or legal claims.",
		WelcomeMessage:   "Hi! I’m the " + business + " assistant. What can I help you find today?",
		SuggestedReplies: []string{"Explore your services", "Get a recommendation", "Talk to your team"},
	}
}

func localReply(history []ChatMessage) string {
	last := ""
	for index := len(history) - 1; index >= 0; index-- {
		if history[index].Role == "user" {
			last = strings.ToLower(history[index].Content)
			break
		}
	}
	switch {
	case strings.Contains(last, "price"), strings.Contains(last, "cost"):
		return "I can help with pricing, but I don’t want to guess. Tell me which service or option you’re considering, and I’ll narrow it down or arrange a follow-up."
	case strings.Contains(last, "human"), strings.Contains(last, "person"), strings.Contains(last, "call"):
		return "Absolutely. If you’d like, share the best email or phone number for a follow-up. I’ll only use it to connect you with the team."
	case strings.Contains(last, "hello"), strings.Contains(last, "hi"):
		return "Hi! I’m glad you stopped by. What are you hoping to accomplish today?"
	case last == "":
		return "How can I help you today?"
	default:
		return "Thanks for sharing that. Could you tell me a little more about the outcome you want, so I can point you in the right direction?"
	}
}
