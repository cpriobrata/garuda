package store

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"garuda/backend/internal/model"
)

func TestOpenFileMigratesLegacyLocalUsersAsVerified(t *testing.T) {
	path := filepath.Join(t.TempDir(), "legacy.json")
	createdAt := time.Date(2025, time.January, 2, 3, 4, 5, 0, time.UTC)
	legacy := model.State{
		Version: 1,
		Users: []model.User{{
			ID: "usr_legacy", AccountID: "org_legacy", Email: "legacy@example.com",
			PasswordHash: "legacy-password-hash", CreatedAt: createdAt, UpdatedAt: createdAt,
		}},
	}
	encoded, err := json.Marshal(legacy)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, encoded, 0o600); err != nil {
		t.Fatal(err)
	}

	dataStore, err := OpenFile(path)
	if err != nil {
		t.Fatalf("OpenFile: %v", err)
	}
	defer dataStore.Close()
	if err := dataStore.View(func(state *model.State) error {
		if state.Version != model.SchemaVersion {
			t.Fatalf("schema version = %d", state.Version)
		}
		if len(state.Users) != 1 || state.Users[0].EmailVerifiedAt == nil || state.Users[0].WelcomeSentAt == nil {
			t.Fatalf("legacy user was not safely grandfathered: %#v", state.Users)
		}
		if !state.Users[0].EmailVerifiedAt.Equal(createdAt) || !state.Users[0].WelcomeSentAt.Equal(createdAt) {
			t.Fatalf("unexpected migration timestamp: %#v", state.Users[0])
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	reopened, err := OpenFile(path)
	if err != nil {
		t.Fatalf("reopen migrated store: %v", err)
	}
	defer reopened.Close()
	_ = reopened.View(func(state *model.State) error {
		if state.Version != model.SchemaVersion || state.Users[0].EmailVerifiedAt == nil {
			t.Fatalf("migration was not persisted: %#v", state)
		}
		return nil
	})
}
