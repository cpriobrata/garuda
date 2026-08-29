package api

import (
	"testing"
	"time"

	"garuda/backend/internal/model"
	"garuda/backend/internal/store"
)

func seedAgedState(t *testing.T, dataStore *store.FileStore, now time.Time) {
	t.Helper()
	if err := dataStore.Update(func(state *model.State) error {
		state.Accounts = append(state.Accounts, model.Account{ID: "org_1", BillingStatus: "active"})

		add := func(id string, lastSeen time.Time, messages int) {
			state.Sessions = append(state.Sessions, model.Session{
				ID: id, AccountID: "org_1", AgentID: "agt_1", VisitorID: "vst_1",
				StartedAt: &lastSeen, CreatedAt: lastSeen, UpdatedAt: lastSeen, LastSeenAt: lastSeen,
			})
			for index := 0; index < messages; index++ {
				state.Messages = append(state.Messages, model.Message{
					ID: id + "_m" + string(rune('a'+index)), AccountID: "org_1", AgentID: "agt_1",
					SessionID: id, Role: "user", Content: "hello", CreatedAt: lastSeen,
				})
			}
		}
		add("cvs_ancient", now.Add(-200*24*time.Hour), 3)
		add("cvs_old", now.Add(-91*24*time.Hour), 2)
		add("cvs_recent", now.Add(-2*24*time.Hour), 4)

		// A lead attached to the oldest conversation. It must survive.
		state.Leads = append(state.Leads, model.Lead{
			ID: "lead_1", AccountID: "org_1", AgentID: "agt_1", SessionID: "cvs_ancient",
			Email: "buyer@example.com", Status: "new", CreatedAt: now.Add(-200 * 24 * time.Hour),
		})
		state.Jobs = append(state.Jobs,
			model.Job{ID: "job_old", AccountID: "org_1", CreatedAt: now.Add(-30 * 24 * time.Hour)},
			model.Job{ID: "job_new", AccountID: "org_1", CreatedAt: now.Add(-time.Hour)},
		)
		return nil
	}); err != nil {
		t.Fatalf("seed: %v", err)
	}
}

// The file grows until the API cannot start. Nothing removed a session or a
// message, so this is the sweep that keeps the service bootable.
func TestRetentionRemovesAgedConversationsAndTheirMessages(t *testing.T) {
	server, dataStore := newTestServer(t)
	now := time.Now().UTC()
	seedAgedState(t, dataStore, now)

	sessions, messages, jobs := server.sweepRetention(now)
	if sessions != 2 {
		t.Errorf("removed %d sessions, want the two past the window", sessions)
	}
	if messages != 5 {
		t.Errorf("removed %d messages, want the 5 belonging to them", messages)
	}
	if jobs != 1 {
		t.Errorf("removed %d jobs, want 1", jobs)
	}

	if err := dataStore.View(func(state *model.State) error {
		if len(state.Sessions) != 1 || state.Sessions[0].ID != "cvs_recent" {
			t.Fatalf("wrong sessions survived: %+v", state.Sessions)
		}
		for _, message := range state.Messages {
			if message.SessionID != "cvs_recent" {
				t.Fatalf("an orphaned message survived: %+v", message)
			}
		}
		if len(state.Messages) != 4 {
			t.Fatalf("kept %d messages, want the 4 from the recent conversation", len(state.Messages))
		}
		return nil
	}); err != nil {
		t.Fatalf("view: %v", err)
	}
}

// Leads are what the customer pays for. Ageing out a transcript must never take
// the sales record with it.
func TestRetentionNeverRemovesALead(t *testing.T) {
	server, dataStore := newTestServer(t)
	now := time.Now().UTC()
	seedAgedState(t, dataStore, now)

	server.sweepRetention(now)

	if err := dataStore.View(func(state *model.State) error {
		if len(state.Leads) != 1 || state.Leads[0].ID != "lead_1" {
			t.Fatalf("a lead was deleted by the retention sweep: %+v", state.Leads)
		}
		return nil
	}); err != nil {
		t.Fatalf("view: %v", err)
	}
}

// A conversation inside the window must survive a sweep untouched, however many
// times the sweep runs.
func TestRetentionIsIdempotentAndLeavesRecentDataAlone(t *testing.T) {
	server, dataStore := newTestServer(t)
	now := time.Now().UTC()
	seedAgedState(t, dataStore, now)

	server.sweepRetention(now)
	sessions, messages, jobs := server.sweepRetention(now)
	if sessions != 0 || messages != 0 || jobs != 0 {
		t.Fatalf("a second sweep removed more: %d sessions, %d messages, %d jobs", sessions, messages, jobs)
	}
}

// createWidgetSession writes a session and a welcome message unconditionally,
// and the agent key that reaches it is public: it is in the embed snippet on the
// customer's own website. Measured, the route's own rate limit still allowed
// 94MB of permanent state per day from one IP, which reaches an unbootable file
// in about seventeen hours and takes down every tenant at once.
func TestOneVisitorCannotAccumulateUnboundedSessions(t *testing.T) {
	_, dataStore := newTestServer(t)
	now := time.Now().UTC()

	if err := dataStore.Update(func(state *model.State) error {
		for index := 0; index < maxSessionsPerVisitor*4; index++ {
			id := "cvs_" + string(rune('a'+index%26)) + string(rune('a'+index/26))
			state.Sessions = append(state.Sessions, model.Session{
				ID: id, AccountID: "org_1", AgentID: "agt_1", VisitorID: "vst_flood",
				CreatedAt: now, UpdatedAt: now, LastSeenAt: now,
			})
			state.Messages = append(state.Messages, model.Message{
				ID: id + "_m", AccountID: "org_1", AgentID: "agt_1", SessionID: id,
				Role: "assistant", Content: "welcome", CreatedAt: now,
			})
			enforceVisitorSessionBudget(state, "agt_1", "vst_flood")
		}
		return nil
	}); err != nil {
		t.Fatalf("update: %v", err)
	}

	if err := dataStore.View(func(state *model.State) error {
		if len(state.Sessions) > maxSessionsPerVisitor {
			t.Fatalf("one visitor accumulated %d sessions, past the budget of %d", len(state.Sessions), maxSessionsPerVisitor)
		}
		// The messages of a dropped session must go with it, or the budget bounds
		// nothing: the messages are the bulk of the bytes.
		live := map[string]bool{}
		for _, session := range state.Sessions {
			live[session.ID] = true
		}
		for _, message := range state.Messages {
			if !live[message.SessionID] {
				t.Fatalf("a dropped session left its messages behind: %+v", message)
			}
		}
		return nil
	}); err != nil {
		t.Fatalf("view: %v", err)
	}
}

// The budget must not touch a different visitor, or a busy website would evict
// its own real conversations.
func TestTheSessionBudgetIsPerVisitor(t *testing.T) {
	_, dataStore := newTestServer(t)
	now := time.Now().UTC()

	if err := dataStore.Update(func(state *model.State) error {
		for visitor := 0; visitor < 3; visitor++ {
			visitorID := "vst_" + string(rune('a'+visitor))
			for index := 0; index < maxSessionsPerVisitor; index++ {
				state.Sessions = append(state.Sessions, model.Session{
					ID:        visitorID + "_" + string(rune('a'+index)),
					AccountID: "org_1", AgentID: "agt_1", VisitorID: visitorID,
					CreatedAt: now, UpdatedAt: now, LastSeenAt: now,
				})
			}
			enforceVisitorSessionBudget(state, "agt_1", visitorID)
		}
		return nil
	}); err != nil {
		t.Fatalf("update: %v", err)
	}

	if err := dataStore.View(func(state *model.State) error {
		if len(state.Sessions) != maxSessionsPerVisitor*3 {
			t.Fatalf("the budget evicted another visitor's conversations: %d sessions", len(state.Sessions))
		}
		return nil
	}); err != nil {
		t.Fatalf("view: %v", err)
	}
}
