package store

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"
	"time"

	"garuda/backend/internal/model"
)

type Store interface {
	View(func(*model.State) error) error
	Update(func(*model.State) error) error
	Close() error
}

type FileStore struct {
	mu    sync.RWMutex
	path  string
	state model.State
}

func OpenFile(path string) (*FileStore, error) {
	if path == "" {
		return nil, errors.New("data file path is required")
	}
	store := &FileStore{path: path, state: model.State{Version: model.SchemaVersion}}
	file, err := os.Open(path)
	if errors.Is(err, os.ErrNotExist) {
		if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
			return nil, fmt.Errorf("create data directory: %w", err)
		}
		if err := store.persistLocked(); err != nil {
			return nil, err
		}
		return store, nil
	}
	if err != nil {
		return nil, fmt.Errorf("open data file: %w", err)
	}
	defer file.Close()
	decoder := json.NewDecoder(io.LimitReader(file, 64<<20))
	if err := decoder.Decode(&store.state); err != nil {
		return nil, fmt.Errorf("decode data file: %w", err)
	}
	if store.state.Version == 0 {
		store.state.Version = 1
	}
	if store.state.Version > model.SchemaVersion {
		return nil, fmt.Errorf("data schema %d is newer than supported schema %d", store.state.Version, model.SchemaVersion)
	}
	if store.state.Version < model.SchemaVersion {
		migrateState(&store.state)
		if err := store.persistLocked(); err != nil {
			return nil, fmt.Errorf("persist data migration: %w", err)
		}
	}
	return store, nil
}

func migrateState(state *model.State) {
	if state.Version < 2 {
		for index := range state.Users {
			user := &state.Users[index]
			if user.EmailVerifiedAt != nil || user.PasswordHash == "" && user.GoogleSubject == "" {
				continue
			}
			verifiedAt := user.UpdatedAt
			if verifiedAt.IsZero() {
				verifiedAt = user.CreatedAt
			}
			if verifiedAt.IsZero() {
				verifiedAt = time.Unix(0, 0).UTC()
			}
			user.EmailVerifiedAt = &verifiedAt
			// Existing users predate transactional welcome delivery; do not
			// surprise them with a welcome message on their next login.
			user.WelcomeSentAt = &verifiedAt
		}
		state.Version = 2
	}
}

func (s *FileStore) View(fn func(*model.State) error) error {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return fn(&s.state)
}

func (s *FileStore) Update(fn func(*model.State) error) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	backup, err := json.Marshal(s.state)
	if err != nil {
		return fmt.Errorf("snapshot state: %w", err)
	}
	if err := fn(&s.state); err != nil {
		return err
	}
	if err := s.persistLocked(); err != nil {
		_ = json.Unmarshal(backup, &s.state)
		return err
	}
	return nil
}

func (s *FileStore) persistLocked() error {
	directory := filepath.Dir(s.path)
	if err := os.MkdirAll(directory, 0o750); err != nil {
		return fmt.Errorf("create data directory: %w", err)
	}
	temporary, err := os.CreateTemp(directory, ".garuda-*.tmp")
	if err != nil {
		return fmt.Errorf("create temporary data file: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	encoder := json.NewEncoder(temporary)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(&s.state); err != nil {
		temporary.Close()
		return fmt.Errorf("encode data: %w", err)
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return fmt.Errorf("sync data: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close temporary data file: %w", err)
	}
	if err := replaceFile(temporaryPath, s.path); err != nil {
		return fmt.Errorf("replace data file: %w", err)
	}
	return nil
}

func replaceFile(source, destination string) error {
	if err := os.Rename(source, destination); err == nil {
		return nil
	}
	backup := destination + ".previous"
	_ = os.Remove(backup)
	if err := os.Rename(destination, backup); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if err := os.Rename(source, destination); err != nil {
		_ = os.Rename(backup, destination)
		return err
	}
	_ = os.Remove(backup)
	return nil
}

func (s *FileStore) Close() error { return nil }
