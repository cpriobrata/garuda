package api

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"garuda/backend/internal/llm"
	"garuda/backend/internal/model"
	"garuda/backend/internal/security"
	"garuda/backend/internal/store"
	"garuda/backend/internal/supabase"
)

func seedLaneWorkspace(t *testing.T, server *Server, dataStore *store.FileStore, accountID, userID, email string) string {
	t.Helper()
	now := time.Now().UTC()
	account := model.Account{ID: accountID, Name: "Lane workspace", BillingStatus: "active", CreatedAt: now, UpdatedAt: now}
	user := model.User{ID: userID, AccountID: accountID, Name: "Owner", Email: email, Role: "owner", EmailVerifiedAt: &now, CreatedAt: now, UpdatedAt: now}
	if err := dataStore.Update(func(state *model.State) error {
		state.Accounts = append(state.Accounts, account)
		state.Users = append(state.Users, user)
		return nil
	}); err != nil {
		t.Fatalf("seed workspace: %v", err)
	}
	token, err := server.issueToken(user)
	if err != nil {
		t.Fatalf("issue token: %v", err)
	}
	return token
}

func laneOnboarding(t *testing.T, dataStore *store.FileStore, accountID string) model.Onboarding {
	t.Helper()
	var record model.Onboarding
	_ = dataStore.View(func(state *model.State) error {
		for _, candidate := range state.Onboarding {
			if candidate.AccountID == accountID {
				record = candidate.Clone()
			}
		}
		return nil
	})
	return record
}

// The portal writes onboarding through PUT /v1/onboarding and sends nothing but the
// typed answers. saveOnboarding stored that map but never derived the business
// context fields from it, so every generated agent came back as the generic
// "Your business Concierge" and the context the customer typed never described the
// business to the model.
func TestSaveOnboardingCarriesTypedAnswersIntoAgentGeneration(t *testing.T) {
	server, dataStore := newTestServer(t)
	token := seedLaneWorkspace(t, server, dataStore, "org_lane_answers", "usr_lane_answers", "answers@example.com")

	answers := map[string]string{
		"business_profile":   "Northstar Labs helps growth teams improve website conversion",
		"audience_and_offer": "B2B SaaS growth leads who need a conversion audit",
		"primary_outcome":    "Qualify leads and book an audit call",
		"voice_and_capture":  "Warm and direct, ask for an email after a recommendation",
	}
	saved := performJSON(t, server.Handler(), http.MethodPut, "/v1/onboarding", token, "http://localhost:3000", map[string]any{"answers": answers})
	savedData := dataFrom(t, saved, http.StatusOK)
	storedAnswers, _ := savedData["answers"].(map[string]any)
	for field, expected := range answers {
		if storedAnswers[field] != expected {
			t.Fatalf("answer %q was not persisted, got %v", field, storedAnswers[field])
		}
	}

	record := laneOnboarding(t, dataStore, "org_lane_answers")
	if record.BusinessName != answers["business_profile"] {
		t.Fatalf("business context was discarded, business name is %q", record.BusinessName)
	}
	if record.Audience != answers["audience_and_offer"] {
		t.Fatalf("audience was discarded, got %q", record.Audience)
	}
	if record.Tone != answers["voice_and_capture"] {
		t.Fatalf("tone was discarded, got %q", record.Tone)
	}
	if len(record.Goals) != 1 || record.Goals[0] != answers["primary_outcome"] {
		t.Fatalf("primary outcome was discarded, goals are %v", record.Goals)
	}

	// Confirm the answers reach llm.GenerateAgent itself, on the configured provider
	// path and on the credential-free local draft the product falls back to.
	prompts := make(chan string, 1)
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(io.LimitReader(r.Body, 1<<20))
		var request struct {
			Messages []struct {
				Content string `json:"content"`
			} `json:"messages"`
		}
		_ = json.Unmarshal(body, &request)
		if len(request.Messages) > 0 {
			prompts <- request.Messages[0].Content
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":"not json"}}]}`))
	}))
	defer provider.Close()
	server.llm = llm.New(provider.URL, "test-key", "test-model")

	completed := performJSON(t, server.Handler(), http.MethodPost, "/v1/onboarding/complete", token, "http://localhost:3000", nil)
	completedData := dataFrom(t, completed, http.StatusAccepted)

	select {
	case prompt := <-prompts:
		for field, expected := range answers {
			if !strings.Contains(prompt, expected) {
				t.Fatalf("answer %q never reached the generation prompt", field)
			}
		}
		if !strings.Contains(prompt, "\"business_name\":\""+answers["business_profile"]+"\"") {
			t.Fatalf("generation prompt carried no business context: %s", prompt)
		}
	default:
		t.Fatal("agent generation never called the model")
	}

	agent, _ := completedData["agent"].(map[string]any)
	name, _ := agent["name"].(string)
	systemPrompt, _ := agent["system_prompt"].(string)
	if strings.Contains(name, "Your business") || strings.Contains(systemPrompt, "Your business") {
		t.Fatalf("the generated agent is still generic: name %q", name)
	}
	if !strings.Contains(systemPrompt, "Northstar Labs") {
		t.Fatalf("the generated agent does not mention the business: %q", systemPrompt)
	}
	if !strings.Contains(systemPrompt, answers["primary_outcome"]) {
		t.Fatalf("the generated agent does not carry the requested outcome: %q", systemPrompt)
	}
}

// A later write that carries one answer must not wipe the other three.
func TestSaveOnboardingKeepsAnswersItWasNotGiven(t *testing.T) {
	server, dataStore := newTestServer(t)
	token := seedLaneWorkspace(t, server, dataStore, "org_lane_merge", "usr_lane_merge", "merge@example.com")

	first := map[string]string{
		"business_profile":   "Acme Realty sells new homes in Noida",
		"audience_and_offer": "First time buyers looking at three bedroom flats",
		"primary_outcome":    "Arrange a site visit",
		"voice_and_capture":  "Friendly and patient",
	}
	dataFrom(t, performJSON(t, server.Handler(), http.MethodPut, "/v1/onboarding", token, "http://localhost:3000", map[string]any{"answers": first}), http.StatusOK)

	second := performJSON(t, server.Handler(), http.MethodPut, "/v1/onboarding", token, "http://localhost:3000", map[string]any{"answers": map[string]string{"voice_and_capture": "Formal and brief"}})
	secondData := dataFrom(t, second, http.StatusOK)
	answers, _ := secondData["answers"].(map[string]any)
	if answers["voice_and_capture"] != "Formal and brief" {
		t.Fatalf("the new answer was not stored, got %v", answers["voice_and_capture"])
	}
	for _, field := range []string{"business_profile", "audience_and_offer", "primary_outcome"} {
		if answers[field] != first[field] {
			t.Fatalf("answer %q was dropped by an unrelated write, got %v", field, answers[field])
		}
	}
	progress, _ := secondData["progress"].(map[string]any)
	if progress["answered"] != float64(4) {
		t.Fatalf("expected all four answers to survive, got %v", progress["answered"])
	}
}

// In Supabase mode a provider that answers 200 without a user id used to match the
// first locally created account, because those users carry an empty ExternalAuthID.
// A wrong password then signed the caller in as somebody else.
func TestSupabaseLoginRejectsABlankProviderSubject(t *testing.T) {
	server, dataStore := newTestServer(t)
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"access_token":"provider-access","refresh_token":"provider-refresh","expires_in":3600,"user":{"id":"","email":""}}`))
	}))
	defer provider.Close()
	server.supabase = supabase.New(provider.URL, "anon-key")

	now := time.Now().UTC()
	passwordHash, err := security.HashPassword("the-real-password")
	if err != nil {
		t.Fatalf("hash password: %v", err)
	}
	if err := dataStore.Update(func(state *model.State) error {
		state.Accounts = append(state.Accounts, model.Account{ID: "org_lane_local", Name: "Local", CreatedAt: now, UpdatedAt: now})
		state.Users = append(state.Users, model.User{
			ID: "usr_lane_local", AccountID: "org_lane_local", Name: "Owner", Email: "victim@example.com",
			PasswordHash: passwordHash, Role: "owner", EmailVerifiedAt: &now, CreatedAt: now, UpdatedAt: now,
		})
		return nil
	}); err != nil {
		t.Fatalf("seed local user: %v", err)
	}

	response := performJSON(t, server.Handler(), http.MethodPost, "/v1/auth/login", "", "http://localhost:3000", map[string]any{
		"email": "attacker@example.com", "password": "not-the-real-password",
	})
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("a blank provider subject signed the caller in: status %d body %s", response.Code, response.Body.String())
	}
	if strings.Contains(response.Body.String(), "access_token") {
		t.Fatalf("a session was issued for a blank provider subject: %s", response.Body.String())
	}
}

// Retrying POST /v1/onboarding/messages with the same client_message_id used to
// answer with the onboarding record instead of the message result, so a client that
// retried after a timeout received a body it could not parse.
func TestOnboardingMessageReplayReturnsTheFirstResponseShape(t *testing.T) {
	server, dataStore := newTestServer(t)
	token := seedLaneWorkspace(t, server, dataStore, "org_lane_replay", "usr_lane_replay", "replay@example.com")

	body := map[string]any{"client_message_id": "omsg_lane_replay", "content": "Northstar Labs helps growth teams improve conversion"}
	first := performJSON(t, server.Handler(), http.MethodPost, "/v1/onboarding/messages", token, "http://localhost:3000", body)
	firstData := dataFrom(t, first, http.StatusCreated)

	replay := performJSON(t, server.Handler(), http.MethodPost, "/v1/onboarding/messages", token, "http://localhost:3000", body)
	replayData := dataFrom(t, replay, http.StatusOK)

	for _, field := range []string{"user_message", "assistant_message", "accepted_answer", "current_question", "progress", "ready_to_complete"} {
		if _, present := replayData[field]; !present {
			t.Fatalf("the replay dropped %q from the response, got %v", field, replayData)
		}
	}
	if len(replayData) != len(firstData) {
		t.Fatalf("the replay returned a different shape:\nfirst  %v\nreplay %v", firstData, replayData)
	}
	firstUser, _ := json.Marshal(firstData["user_message"])
	replayUser, _ := json.Marshal(replayData["user_message"])
	if string(firstUser) != string(replayUser) {
		t.Fatalf("the replay returned a different user message: %s vs %s", firstUser, replayUser)
	}
	firstAssistant, _ := json.Marshal(firstData["assistant_message"])
	replayAssistant, _ := json.Marshal(replayData["assistant_message"])
	if string(firstAssistant) != string(replayAssistant) {
		t.Fatalf("the replay returned a different assistant message: %s vs %s", firstAssistant, replayAssistant)
	}
	firstAccepted, _ := firstData["accepted_answer"].(map[string]any)
	replayAccepted, _ := replayData["accepted_answer"].(map[string]any)
	if firstAccepted["field"] != replayAccepted["field"] || firstAccepted["value"] != replayAccepted["value"] {
		t.Fatalf("the replay named a different accepted answer: %v vs %v", firstAccepted, replayAccepted)
	}
	if replayData["replayed"] != true {
		t.Fatalf("the replay was not marked as a replay: %v", replayData["replayed"])
	}

	stored := laneOnboarding(t, dataStore, "org_lane_replay")
	if len(stored.Messages) != 2 {
		t.Fatalf("the replay stored the answer twice, message count is %d", len(stored.Messages))
	}
}

// completeOnboarding handed the record it read to agent generation after its read
// lock was released, and generation JSON-encodes that record, walking every key of
// the Answers map. An onboarding message arriving on another connection writes to
// that same map. A concurrent map read is a fatal Go error that kills the process,
// and recoverPanic cannot catch it.
func TestCompleteOnboardingDoesNotAliasLiveState(t *testing.T) {
	server, dataStore := newTestServer(t)
	token := seedLaneWorkspace(t, server, dataStore, "org_lane_complete", "usr_lane_complete", "complete@example.com")
	// A provider that refuses leaves generation reporting an error, so every call
	// walks the answers and then returns without touching the store. The read under
	// test is the one generation makes, not the write that follows a success.
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer provider.Close()
	server.llm = llm.New(provider.URL, "test-key", "test-model")

	seed := map[string]string{
		"business_profile":   "Northstar Labs",
		"audience_and_offer": "Growth teams",
		"primary_outcome":    "Qualify leads",
		"voice_and_capture":  "Warm and direct",
	}
	for index := 0; index < 64; index++ {
		seed[fmt.Sprintf("seed%02d", index)] = "value"
	}
	if err := dataStore.Update(func(state *model.State) error {
		state.Onboarding = append(state.Onboarding, model.Onboarding{AccountID: "org_lane_complete", Answers: seed})
		return nil
	}); err != nil {
		t.Fatalf("seed onboarding: %v", err)
	}

	stop := make(chan struct{})
	var writer sync.WaitGroup
	writer.Add(1)
	go func() { // what an onboarding message does to Answers under Update
		defer writer.Done()
		for index := 0; ; index++ {
			select {
			case <-stop:
				return
			default:
			}
			_ = dataStore.Update(func(state *model.State) error {
				for position := range state.Onboarding {
					if state.Onboarding[position].AccountID == "org_lane_complete" {
						state.Onboarding[position].Answers[fmt.Sprintf("hot%d", index%32)] = "x"
						delete(state.Onboarding[position].Answers, fmt.Sprintf("hot%d", (index+16)%32))
					}
				}
				return nil
			})
		}
	}()

	handler := server.Handler()
	var readers sync.WaitGroup
	for reader := 0; reader < 4; reader++ {
		readers.Add(1)
		go func() {
			defer readers.Done()
			for call := 0; call < 400; call++ {
				response := performJSON(t, handler, http.MethodPost, "/v1/onboarding/complete", token, "http://localhost:3000", nil)
				if response.Code != http.StatusServiceUnavailable {
					t.Errorf("complete onboarding returned %d", response.Code)
					return
				}
			}
		}()
	}
	readers.Wait()
	close(stop)
	writer.Wait()
}

// Generating an agent takes seconds, so a double click or a client retry sends
// several completes at once. All of them pass the pre-check before any writes,
// then every loser used to answer 500 -- after each had already paid for a full
// model generation. Completing is idempotent, so losers must get the winner's
// agent back.
func TestCompleteOnboardingIsIdempotentUnderConcurrency(t *testing.T) {
	server, dataStore := newTestServer(t)
	const accountID = "org_race"
	identity := Identity{UserID: "usr_race", AccountID: accountID, Email: "race@example.com", Role: "owner"}

	if err := dataStore.Update(func(state *model.State) error {
		state.Accounts = append(state.Accounts, model.Account{ID: accountID, Name: "Race", BillingStatus: "active"})
		state.Onboarding = append(state.Onboarding, model.Onboarding{
			AccountID: accountID,
			Answers: map[string]string{
				"business_profile":   "Acme sells roofing in Toronto.",
				"primary_outcome":    "qualify_leads",
				"audience_and_offer": "Homeowners needing a new roof.",
				"voice_and_capture":  "Friendly; collect name and email.",
			},
		})
		return nil
	}); err != nil {
		t.Fatalf("seed: %v", err)
	}

	const callers = 4
	codes := make([]int, callers)
	agents := make([]string, callers)
	var waitGroup sync.WaitGroup
	for index := 0; index < callers; index++ {
		waitGroup.Add(1)
		go func(slot int) {
			defer waitGroup.Done()
			request := httptest.NewRequest(http.MethodPost, "/v1/onboarding/complete", nil)
			request = request.WithContext(context.WithValue(request.Context(), identityKey, identity))
			response := httptest.NewRecorder()
			server.completeOnboarding(response, request)
			codes[slot] = response.Code
			var envelope struct {
				Data struct {
					Agent struct {
						ID string `json:"id"`
					} `json:"agent"`
				} `json:"data"`
			}
			_ = json.Unmarshal(response.Body.Bytes(), &envelope)
			agents[slot] = envelope.Data.Agent.ID
		}(index)
	}
	waitGroup.Wait()

	for slot, code := range codes {
		if code != http.StatusAccepted {
			t.Errorf("caller %d returned %d, want 202", slot, code)
		}
		if agents[slot] == "" {
			t.Errorf("caller %d returned no agent id", slot)
		}
	}
	// Every caller must be pointed at the same agent, and only one may exist.
	for slot := 1; slot < callers; slot++ {
		if agents[slot] != agents[0] {
			t.Errorf("callers disagree on the agent: %q vs %q", agents[0], agents[slot])
		}
	}
	_ = dataStore.View(func(state *model.State) error {
		count := 0
		for _, agent := range state.Agents {
			if agent.AccountID == accountID {
				count++
			}
		}
		if count != 1 {
			t.Errorf("expected exactly one generated agent, got %d", count)
		}
		return nil
	})
}
