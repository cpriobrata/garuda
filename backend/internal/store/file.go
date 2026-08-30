package store

import (
	"bufio"
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

// Store is the persistence boundary.
//
// View and Update both hand the callback the LIVE state. Copying a struct out of
// either copies only map and slice HEADERS, so a value that outlives the callback
// still aliases data another goroutine may write. Anything that escapes -- most
// often a value JSON-encoded after the call returns -- must be deep-copied first
// with the model Clone helpers. This matters more than the usual aliasing bug:
// reading a Go map while another goroutine writes it is a fatal error, not a
// panic, so it cannot be recovered and it terminates the process.
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

// maxDataFileBytes bounds what is read back at boot: a guard against a corrupt
// or hostile file exhausting memory, not a product limit.
//
// It was 64MiB, which sounds generous and is not. Everything the product stores
// lives in this one file, and it was measured to cross 64MiB at roughly 97,000
// messages -- around 16,500 ordinary conversations, or a few months of a hundred
// customers. Past that the API could not start AT ALL, and systemd, configured
// for unlimited restarts precisely so the service never stays down, restarted it
// into the same deterministic failure every two seconds forever. The six-hourly
// backups were all copies of the same unreadable file.
//
// A gigabyte is bounded by the disk rather than by a number somebody picked, and
// the size check in OpenFile turns crossing it into an operator-readable error
// instead of a crash loop. Pruning is what actually keeps the file small; this
// constant is only the last line of defence.
const maxDataFileBytes = 1 << 30

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
	// The read limit exists so a corrupt or hostile file cannot exhaust memory at
	// boot. On its own it is a trap: a file one byte past the limit is silently
	// truncated mid-JSON, the decode fails with "unexpected EOF", main exits 1,
	// and systemd -- configured for unlimited restarts so the service never stays
	// down -- loops forever on a failure no restart can fix. The size is checked
	// first so an oversized store is an operator-readable error naming the actual
	// size and the actual limit, rather than a crash loop that reads like corruption.
	if info, statErr := file.Stat(); statErr == nil && info.Size() > maxDataFileBytes {
		_ = file.Close()
		return nil, fmt.Errorf("data file is %d bytes, larger than the %d this build can read: restore a smaller backup or raise the limit", info.Size(), int64(maxDataFileBytes))
	}
	decoder := json.NewDecoder(io.LimitReader(file, maxDataFileBytes))
	decodeErr := decoder.Decode(&store.state)
	// Close before any rename. persistLocked below replaces this exact path, and
	// Windows refuses os.Rename over a handle that is still open -- a deferred
	// Close here made every schema migration fail on that platform.
	closeErr := file.Close()
	if decodeErr != nil {
		return nil, fmt.Errorf("decode data file: %w", decodeErr)
	}
	if closeErr != nil {
		return nil, fmt.Errorf("close data file: %w", closeErr)
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

// Path is where the state lives. It exists so an operator, and a test, can look
// at the file without hard-coding the layout the store chose.
func (s *FileStore) Path() string { return s.path }

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
		// The callback may have mutated state before deciding to fail. Without a
		// restore those mutations survive in memory while disk still holds the old
		// value, so a rejected request is silently applied and the next successful
		// write persists it.
		s.restore(backup)
		return err
	}
	if err := s.persistLocked(); err != nil {
		s.restore(backup)
		return err
	}
	return nil
}

// restore puts the snapshot back. It decodes into a FRESH State and assigns,
// which looks like a pointless extra allocation and is not.
//
// encoding/json MERGES into an existing value rather than replacing it: a struct
// field whose key is absent from the JSON is left exactly as it was, and slice
// elements are decoded field by field on top of whatever is already there. Every
// field in model.go carrying omitempty disappears from the snapshot when it is
// empty -- so decoding onto the live, already-mutated state restored nothing at
// all for precisely those fields. A rejected 422 kept the allowed_domains and the
// lead form it had just written, and on a published agent that reached the
// customer widget: a save the server had refused was live on their website.
//
// Decoding into a zero State and assigning cannot merge with anything, because
// there is nothing to merge with.
func (s *FileStore) restore(backup []byte) {
	var restored model.State
	if err := json.Unmarshal(backup, &restored); err != nil {
		// The snapshot came from json.Marshal of this same type moments ago, so a
		// failure here is not recoverable by retrying. Keeping the mutated state is
		// still wrong, but discarding it for a zero State would drop every account
		// in the process, which is worse.
		return
	}
	s.state = restored
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
	// No SetIndent, and a buffered writer. Indenting marshals the whole state and
	// then re-indents it through an intermediate buffer -- measured at roughly
	// four times the time and five times the allocation of a plain encode, for a
	// file no human reads. Together with the buffer this measured 2.8x faster and
	// 6x less garbage on a 100,000-message state, and it makes the file 15%
	// smaller, which is 15% more headroom before any size limit matters.
	//
	// Whitespace is not part of the format: json.Unmarshal reads the compact file
	// and the indented one identically, so this is not a migration.
	writer := bufio.NewWriterSize(temporary, 1<<20)
	encoder := json.NewEncoder(writer)
	if err := encoder.Encode(&s.state); err != nil {
		temporary.Close()
		return fmt.Errorf("encode data: %w", err)
	}
	// Flush BEFORE Sync. Syncing an unflushed buffer durably writes nothing.
	if err := writer.Flush(); err != nil {
		temporary.Close()
		return fmt.Errorf("flush data: %w", err)
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
