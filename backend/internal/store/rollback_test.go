package store

import (
	"errors"
	"path/filepath"
	"testing"

	"garuda/backend/internal/model"
)

func newRollbackStore(t *testing.T) *FileStore {
	t.Helper()
	dataStore, err := OpenFile(filepath.Join(t.TempDir(), "garuda.json"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	return dataStore
}

// The defect this guards against: Update rolled back by decoding the snapshot
// INTO the live, already-mutated state. encoding/json merges rather than
// replaces, so every field carrying omitempty -- absent from the snapshot
// because it was empty -- kept whatever the rejected callback had written.
//
// In production that meant a 422 still applied. On a published agent it changed
// what the widget served to visitors: a save the server had refused was live on
// the customer's website.
func TestRejectedUpdateLeavesNoTraceInOmitemptyFields(t *testing.T) {
	dataStore := newRollbackStore(t)

	if err := dataStore.Update(func(state *model.State) error {
		state.Agents = append(state.Agents, model.Agent{
			ID: "agt_1", AccountID: "org_1", Name: "Original", Status: "published",
		})
		return nil
	}); err != nil {
		t.Fatalf("seed: %v", err)
	}

	rejected := errors.New("validation failed")
	err := dataStore.Update(func(state *model.State) error {
		agent := &state.Agents[0]
		agent.Name = "Rejected"
		// Every one of these is omitempty on model.Agent, which is exactly why
		// the merging restore could not clear them.
		agent.Branding.AllowedDomains = []string{"attacker.example.com"}
		agent.LeadCapture.FormFields = []model.LeadFormField{{ID: "ssn", Label: "Social Security Number", Type: "text"}}
		agent.SuggestedReplies = []string{"leaked"}
		agent.Knowledge = []model.KnowledgeItem{{ID: "kn_1", Title: "Injected"}}
		return rejected
	})
	if !errors.Is(err, rejected) {
		t.Fatalf("expected the callback error back, got %v", err)
	}

	if err := dataStore.View(func(state *model.State) error {
		agent := state.Agents[0]
		if agent.Name != "Original" {
			t.Errorf("name survived a rejected write: %q", agent.Name)
		}
		if len(agent.Branding.AllowedDomains) != 0 {
			t.Errorf("a rejected write left the widget allowlist as %v", agent.Branding.AllowedDomains)
		}
		if len(agent.LeadCapture.FormFields) != 0 {
			t.Errorf("a rejected write left a lead form the customer never saved: %v", agent.LeadCapture.FormFields)
		}
		if len(agent.SuggestedReplies) != 0 {
			t.Errorf("a rejected write left suggested replies: %v", agent.SuggestedReplies)
		}
		if len(agent.Knowledge) != 0 {
			t.Errorf("a rejected write left knowledge: %v", agent.Knowledge)
		}
		return nil
	}); err != nil {
		t.Fatalf("view: %v", err)
	}
}

// The rejected write must not reach disk either, directly or by riding along on
// the next write that is accepted.
func TestARejectedWriteNeverReachesDisk(t *testing.T) {
	path := filepath.Join(t.TempDir(), "garuda.json")
	dataStore, err := OpenFile(path)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	if err := dataStore.Update(func(state *model.State) error {
		state.Agents = append(state.Agents, model.Agent{ID: "agt_1", AccountID: "org_1", Name: "Original"})
		return nil
	}); err != nil {
		t.Fatalf("seed: %v", err)
	}

	_ = dataStore.Update(func(state *model.State) error {
		state.Agents[0].Branding.AllowedDomains = []string{"attacker.example.com"}
		return errors.New("nope")
	})
	// An unrelated accepted write is what used to flush the rejected one.
	if err := dataStore.Update(func(state *model.State) error {
		state.Agents[0].Description = "an unrelated change"
		return nil
	}); err != nil {
		t.Fatalf("second update: %v", err)
	}

	reopened, err := OpenFile(path)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	if err := reopened.View(func(state *model.State) error {
		if len(state.Agents[0].Branding.AllowedDomains) != 0 {
			t.Fatalf("the rejected allowlist was persisted: %v", state.Agents[0].Branding.AllowedDomains)
		}
		if state.Agents[0].Description != "an unrelated change" {
			t.Fatalf("the accepted change was lost: %q", state.Agents[0].Description)
		}
		return nil
	}); err != nil {
		t.Fatalf("view: %v", err)
	}
}

// A shrinking slice is the case a merging decoder handles worst: it overwrites
// the elements it has and leaves the tail behind.
func TestRollbackShrinksSlicesBackToTheirSnapshotLength(t *testing.T) {
	dataStore := newRollbackStore(t)

	if err := dataStore.Update(func(state *model.State) error {
		state.Accounts = append(state.Accounts, model.Account{ID: "org_1", Name: "Only"})
		return nil
	}); err != nil {
		t.Fatalf("seed: %v", err)
	}

	_ = dataStore.Update(func(state *model.State) error {
		state.Accounts = append(state.Accounts,
			model.Account{ID: "org_2", Name: "Added"},
			model.Account{ID: "org_3", Name: "Also added"},
		)
		return errors.New("nope")
	})

	if err := dataStore.View(func(state *model.State) error {
		if len(state.Accounts) != 1 {
			t.Fatalf("a rejected write left %d accounts, want 1: %+v", len(state.Accounts), state.Accounts)
		}
		return nil
	}); err != nil {
		t.Fatalf("view: %v", err)
	}
}
