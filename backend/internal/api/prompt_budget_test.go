package api

import (
	"strings"
	"testing"

	"garuda/backend/internal/model"
	"garuda/backend/internal/rag"
)

func knowledgeOfSize(count, size int) []model.KnowledgeItem {
	items := make([]model.KnowledgeItem, 0, count)
	for index := 0; index < count; index++ {
		items = append(items, model.KnowledgeItem{
			ID: "kn_" + string(rune('a'+index)), Title: "Source " + string(rune('A'+index)),
			Content: strings.Repeat("x", size), Status: "ready",
		})
	}
	return items
}

// The knowledge block is resent on every turn, so its size is multiplied by the
// length of every conversation. The old guard was checked AFTER appending an
// item, which let one final source overshoot the budget by a quarter.
func TestTheKnowledgeBlockStaysInsideItsBudget(t *testing.T) {
	agent := model.Agent{
		SystemPrompt: "Answer from approved knowledge.",
		Knowledge:    knowledgeOfSize(5, 99_000),
	}
	prompt := promptForAgent(agent)
	if len(prompt) > maxKnowledgeBlockChars+2_000 {
		t.Fatalf("prompt is %d characters, past the budget of %d plus the instructions", len(prompt), maxKnowledgeBlockChars)
	}
	if !strings.Contains(prompt, "Answer from approved knowledge.") {
		t.Error("the agent's own instructions were crowded out by knowledge")
	}
}

// A customer whose fifth source is one line should still get that line, rather
// than having it dropped because the four before it filled the budget.
func TestASmallFinalSourceStillFitsInTheBudget(t *testing.T) {
	items := knowledgeOfSize(3, 4_000)
	items = append(items, model.KnowledgeItem{
		ID: "kn_last", Title: "Opening hours", Content: "We open at 9am.", Status: "ready",
	})
	prompt := promptForAgent(model.Agent{SystemPrompt: "Answer.", Knowledge: items})
	if !strings.Contains(prompt, "We open at 9am.") {
		t.Fatal("a small trailing source was dropped rather than fitted in")
	}
}

// Failed and deleting sources are not knowledge and must not be paid for.
func TestUnusableSourcesAreNotSentToTheModel(t *testing.T) {
	prompt := promptForAgent(model.Agent{
		SystemPrompt: "Answer.",
		Knowledge: []model.KnowledgeItem{
			{ID: "kn_1", Title: "Broken", Content: "this never ingested", Status: "failed"},
			{ID: "kn_2", Title: "Going", Content: "this is on its way out", Status: "deleting"},
			{ID: "kn_3", Title: "Good", Content: "we open at 9am", Status: "ready"},
		},
	})
	if strings.Contains(prompt, "never ingested") || strings.Contains(prompt, "on its way out") {
		t.Fatalf("an unusable source was sent to the model: %q", prompt)
	}
	if !strings.Contains(prompt, "we open at 9am") {
		t.Error("the usable source was not sent")
	}
}

// Retrieval exists to send a slice of the corpus instead of the corpus. Sending
// both pays twice for the same facts and crowds out the passages that were
// actually selected for the question.
func TestRetrievedPassagesReplaceTheFullKnowledgeBlock(t *testing.T) {
	agent := model.Agent{
		SystemPrompt: "Answer from approved knowledge.",
		Knowledge: []model.KnowledgeItem{
			{ID: "kn_1", Title: "Everything", Content: "THE WHOLE CORPUS", Status: "ready"},
		},
	}
	chunks := []rag.Chunk{{SourceName: "Pricing", Content: "The plan is $17 a month."}}

	withRetrieval := promptWithRetrieved(promptWithoutKnowledge(agent), chunks)
	if strings.Contains(withRetrieval, "THE WHOLE CORPUS") {
		t.Fatal("the full knowledge block was sent alongside the retrieved passages")
	}
	if !strings.Contains(withRetrieval, "The plan is $17 a month.") {
		t.Fatal("the retrieved passage was not sent")
	}
	if !strings.Contains(withRetrieval, "Answer from approved knowledge.") {
		t.Fatal("the agent's own instructions were dropped with the knowledge block")
	}

	// With nothing retrieved, the full block is still the right answer.
	if !strings.Contains(promptForAgent(agent), "THE WHOLE CORPUS") {
		t.Fatal("the knowledge block went missing when retrieval returned nothing")
	}
}

// A title or a body in any language must not be cut in half a character on its
// way to the model.
func TestKnowledgeIsTruncatedOnCharacterBoundaries(t *testing.T) {
	agent := model.Agent{
		SystemPrompt: "Answer.",
		Knowledge: []model.KnowledgeItem{
			{ID: "kn_1", Title: "हिन्दी", Content: strings.Repeat("न", maxKnowledgeItemChars*3), Status: "ready"},
		},
	}
	prompt := promptForAgent(agent)
	// A cut on a byte boundary leaves an invalid rune, which round-trips through
	// JSON as U+FFFD.
	if strings.ContainsRune(prompt, '�') {
		t.Fatal("the knowledge block was cut mid-character")
	}
}
