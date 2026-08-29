package meta

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"garuda/backend/internal/model"
	"garuda/backend/internal/store"
)

// Reporter turns durably created leads into Meta Lead conversions.
//
// WHY A SECOND POLLER AND NOT A LINE IN outbound.Registry.Scan.
//
// The mechanism is copied from internal/outbound on purpose -- read the Scan
// doc comment there, the reasoning for polling committed state instead of
// calling from the handler applies here word for word, and a slow Meta API on
// the widget's lead request would be a slow chat widget for a visitor. What is
// NOT reused is the registry itself, for three reasons:
//
//  1. Different audience. outbound only emits lead.created for accounts that
//     have an enabled webhook endpoint subscribed to it, because those events
//     belong to the customer. Meta conversions belong to Garuda's own ad
//     account and must cover EVERY lead, including the overwhelming majority of
//     accounts that will never configure a webhook. Sharing the scan would mean
//     either sending nothing or changing what the customer-facing scan emits.
//
//  2. Different failure isolation. Registry.run() calls Scan and then Drain in
//     one goroutine. A Meta request inside that goroutine puts Meta's latency in
//     front of every customer's webhook delivery, and a Meta outage would hold
//     up CRM notifications that have nothing to do with advertising. Separate
//     goroutines mean neither outage can reach the other.
//
//  3. Different retry economics. A webhook delivery must be queued and retried
//     with backoff because the customer's CRM is the record. A conversion is an
//     optimisation signal that Meta itself de-duplicates by event_id, so a plain
//     re-read of the same watermark is a complete retry strategy and no queue
//     needs to exist.
//
// The cost of the duplication is one more small watermark file and about thirty
// lines of watermark arithmetic. That is cheaper than coupling the ad pipeline
// to the CRM pipeline.
type Reporter struct {
	options   ReporterOptions
	initError error

	// scanMutex serialises Scan against itself, so two passes can never send the
	// same lead twice. mutex protects state, which Scan briefly releases.
	scanMutex sync.Mutex

	mutex sync.Mutex
	state reporterState
	// consecutiveFailures drives the give-up rule below.
	consecutiveFailures int

	stop      chan struct{}
	stopped   chan struct{}
	closeOnce sync.Once
}

// ReporterOptions configures a Reporter. Everything has a working default.
type ReporterOptions struct {
	// Client is the Conversions API client. A nil or unconfigured client makes
	// the whole Reporter a no-op: it never reads the store and never writes its
	// state file, so an install with no Meta credentials behaves exactly as it
	// does today.
	Client *Client
	// Store is read by the scan. A nil store disables scanning.
	Store store.Store
	// Path is the JSON file the watermark lives in. Empty keeps it in memory,
	// which is what tests use.
	Path   string
	Logger *slog.Logger
	// Now exists so tests can move time without sleeping.
	Now func() time.Time
	// PollInterval is how often committed state is re-read.
	PollInterval time.Duration
	// DisableBackground stops NewReporter from starting the poll goroutine, so a
	// test can call Scan itself instead of racing a ticker.
	DisableBackground bool
}

const (
	reporterStateVersion = 1

	// maxSendAttempts is the give-up rule. A failed batch is NOT skipped: the
	// watermark stays put and the next poll re-reads and re-sends it, which is
	// safe because Meta collapses repeats by event_id. But a batch that fails
	// this many times in a row is presumed poisoned -- a malformed lead, a
	// permanently rejected pixel -- and the watermark is advanced past it so one
	// bad batch can never stop every later conversion from being reported.
	maxSendAttempts = 5
)

// reporterState is the whole on-disk file. It holds a position and nothing else:
// no lead, no identifier, no contact detail is ever written here.
type reporterState struct {
	Version       int       `json:"version"`
	LeadWatermark watermark `json:"lead_watermark"`
}

// watermark records how far the conversion scan has read. IDs holds the
// identifiers whose timestamp is exactly At, which is what makes the scan exact
// rather than approximate: two leads created in the same instant cannot make the
// second one vanish, and neither can be reported twice. It stays small because
// only ties on the newest instant are ever kept.
//
// This mirrors outbound's unexported watermark. Duplicating thirty lines is
// preferable to widening that package's API for a consumer it was not written
// for.
type watermark struct {
	At  time.Time `json:"at"`
	IDs []string  `json:"ids,omitempty"`
}

func (w watermark) seen(identifier string, createdAt time.Time) bool {
	if createdAt.After(w.At) {
		return false
	}
	if createdAt.Before(w.At) {
		return true
	}
	for _, seen := range w.IDs {
		if seen == identifier {
			return true
		}
	}
	return false
}

func (w watermark) advance(identifier string, createdAt time.Time) watermark {
	switch {
	case createdAt.After(w.At):
		return watermark{At: createdAt, IDs: []string{identifier}}
	case createdAt.Equal(w.At):
		return watermark{At: w.At, IDs: append(append([]string(nil), w.IDs...), identifier)}
	default:
		return w
	}
}

// StatePath puts the conversion watermark beside the main data file. An empty
// data file path -- which is what the tests configure -- keeps it in memory.
func StatePath(dataFile string) string {
	trimmed := strings.TrimSpace(dataFile)
	if trimmed == "" {
		return ""
	}
	return filepath.Join(filepath.Dir(trimmed), "meta-conversions.json")
}

// NewReporter opens a reporter and, unless DisableBackground is set, starts the
// goroutine that polls for new leads. It never fails: an unreadable state file
// is logged and disables scanning, because losing conversion reporting is a far
// better outcome than refusing to boot the API.
func NewReporter(options ReporterOptions) *Reporter {
	if options.Logger == nil {
		options.Logger = slog.New(slog.NewTextHandler(io.Discard, nil))
	}
	if options.Now == nil {
		options.Now = func() time.Time { return time.Now().UTC() }
	}
	if options.PollInterval <= 0 {
		// Slower than the webhook scan on purpose. An ad platform's optimiser does
		// not care about fifteen seconds, and a lower rate is one fewer background
		// wake-up on a single small VPS.
		options.PollInterval = 15 * time.Second
	}
	reporter := &Reporter{
		options: options,
		stop:    make(chan struct{}),
		stopped: make(chan struct{}),
	}
	// Nothing is read and no file is created unless the credentials are actually
	// present. A Garuda with no Meta keys must leave no trace of this package on
	// disk, which is also what makes "no-op when disabled" testable.
	if reporter.Enabled() {
		if err := reporter.load(); err != nil {
			reporter.initError = err
			options.Logger.Error("meta conversion watermark could not be loaded", "error", err)
		}
	}
	if !options.DisableBackground && reporter.Enabled() {
		go reporter.run()
	} else {
		close(reporter.stopped)
	}
	return reporter
}

// Enabled reports whether anything will be sent. False means every method on
// this reporter is a no-op.
func (r *Reporter) Enabled() bool {
	return r != nil && r.options.Store != nil && r.options.Client.Enabled()
}

// Close stops the poll goroutine. It is safe to call more than once, and safe on
// a reporter that never started one.
func (r *Reporter) Close() {
	if r == nil {
		return
	}
	r.closeOnce.Do(func() { close(r.stop) })
	<-r.stopped
}

func (r *Reporter) now() time.Time { return r.options.Now() }

// run is the whole background loop. It never touches a request goroutine, which
// is what keeps a slow or dead Meta API off a visitor's conversation.
func (r *Reporter) run() {
	defer close(r.stopped)
	ticker := time.NewTicker(r.options.PollInterval)
	defer ticker.Stop()
	for {
		select {
		case <-r.stop:
			return
		case <-ticker.C:
		}
		scanContext, cancel := context.WithTimeout(context.Background(), time.Minute)
		r.Scan(scanContext)
		cancel()
	}
}

// pendingLead is one lead ready to be reported, taken out of the store as a deep
// copy. Nothing here aliases live state.
type pendingLead struct {
	lead    model.Lead
	pageURL string
}

// Scan reads committed state and reports every lead it has not reported yet.
//
// It is called from a single goroutine -- the poller, or a test -- and scanMutex
// enforces that.
func (r *Reporter) Scan(ctx context.Context) {
	if !r.Enabled() || r.initError != nil {
		return
	}
	r.scanMutex.Lock()
	defer r.scanMutex.Unlock()

	r.mutex.Lock()
	mark := r.state.LeadWatermark
	r.mutex.Unlock()

	var pending []pendingLead
	_ = r.options.Store.View(func(state *model.State) error {
		// Everything taken out of this callback is either a scalar, an immutable
		// string, or a value produced by a Clone helper. A map or slice header
		// copied straight out of live state would still be read after the read
		// lock is released, and a map read racing a write is fatal to the process.
		for _, lead := range state.Leads {
			if mark.seen(lead.ID, lead.CreatedAt) {
				continue
			}
			pending = append(pending, pendingLead{lead: lead.Clone()})
		}
		if len(pending) == 0 {
			return nil
		}
		// The landing page a lead came from lives on its session, not on the lead.
		// Only the sessions actually referenced are looked up, so a store with a
		// long session history costs nothing on a scan that finds no leads.
		wanted := make(map[string]bool, len(pending))
		for _, item := range pending {
			if item.lead.SessionID != "" {
				wanted[item.lead.SessionID] = true
			}
		}
		pageURLs := make(map[string]string, len(wanted))
		for _, session := range state.Sessions {
			if wanted[session.ID] {
				pageURLs[session.ID] = session.PageURL
			}
		}
		for index := range pending {
			pending[index].pageURL = pageURLs[pending[index].lead.SessionID]
		}
		return nil
	})
	if len(pending) == 0 {
		return
	}

	// Oldest first, with the id breaking a tie, so a capped batch always makes
	// forward progress and two runs over the same data behave identically.
	sort.SliceStable(pending, func(first, second int) bool {
		if pending[first].lead.CreatedAt.Equal(pending[second].lead.CreatedAt) {
			return pending[first].lead.ID < pending[second].lead.ID
		}
		return pending[first].lead.CreatedAt.Before(pending[second].lead.CreatedAt)
	})
	if len(pending) > maxEventsPerRequest {
		pending = pending[:maxEventsPerRequest]
	}

	next := mark
	events := make([]Event, 0, len(pending))
	skipped := 0
	for _, item := range pending {
		// The watermark advances for every lead considered, including the ones
		// with nothing to match on. Leaving those behind would make the scan
		// re-read them forever.
		next = next.advance(item.lead.ID, item.lead.CreatedAt)
		if item.lead.Email == "" && item.lead.Phone == "" {
			skipped++
			continue
		}
		firstName, lastName := splitName(item.lead.Name)
		events = append(events, LeadEvent(item.lead.ID, item.lead.CreatedAt, item.pageURL, UserData{
			Email:     item.lead.Email,
			Phone:     item.lead.Phone,
			FirstName: firstName,
			LastName:  lastName,
		}))
	}

	if len(events) > 0 {
		received, err := r.options.Client.Send(ctx, events...)
		if err != nil {
			r.recordFailure(next, err)
			return
		}
		// Counts only. No identifier, hashed or otherwise, is ever logged.
		r.options.Logger.Info("meta conversions reported",
			"events", len(events), "accepted", received, "skipped", skipped,
			"test_mode", r.options.Client.TestMode())
	}
	r.commit(next)
}

// recordFailure leaves the watermark alone so the next poll retries the same
// batch, unless the batch has now failed enough times in a row to be presumed
// poisoned.
func (r *Reporter) recordFailure(next watermark, sendErr error) {
	r.mutex.Lock()
	r.consecutiveFailures++
	attempts := r.consecutiveFailures
	abandon := attempts >= maxSendAttempts
	var saveErr error
	if abandon {
		r.consecutiveFailures = 0
		r.state.LeadWatermark = next
		saveErr = r.save()
	}
	r.mutex.Unlock()
	if abandon {
		r.options.Logger.Error("meta conversions abandoned after repeated failures",
			"attempts", attempts, "error", sendErr)
		if saveErr != nil {
			r.options.Logger.Error("meta conversion watermark could not be persisted", "error", saveErr)
		}
		return
	}
	r.options.Logger.Warn("meta conversions could not be reported, will retry",
		"attempts", attempts, "error", sendErr)
}

func (r *Reporter) commit(next watermark) {
	r.mutex.Lock()
	r.consecutiveFailures = 0
	r.state.LeadWatermark = next
	err := r.save()
	r.mutex.Unlock()
	if err != nil {
		r.options.Logger.Error("meta conversion watermark could not be persisted", "error", err)
	}
}

// splitName takes the first and the LAST token, not the first and the rest.
// Meta's fn and ln are single given and family names, and its normalisation
// removes whitespace, so "Mary Jane Watson" hashed as fn "mary" ln "maryjane"
// would match nobody. Dropping the middle name is the closer answer.
func splitName(full string) (string, string) {
	fields := strings.Fields(full)
	switch len(fields) {
	case 0:
		return "", ""
	case 1:
		return fields[0], ""
	default:
		return fields[0], fields[len(fields)-1]
	}
}

// ------------------------------------------------------------------ persistence

func (r *Reporter) load() error {
	r.state = reporterState{Version: reporterStateVersion}
	if r.options.Path == "" {
		r.state.LeadWatermark = watermark{At: r.now()}
		return nil
	}
	file, err := os.Open(r.options.Path)
	if errors.Is(err, os.ErrNotExist) {
		// First run starts at now. The database already holds every lead this
		// product has ever captured, and replaying that history the morning the
		// credentials land would report months of conversions as if they happened
		// today -- Meta rejects anything older than seven days anyway, and the
		// rest would teach the ad account a spike that never occurred.
		r.state.LeadWatermark = watermark{At: r.now()}
		return r.save()
	}
	if err != nil {
		return fmt.Errorf("open meta conversion file: %w", err)
	}
	decodeErr := json.NewDecoder(io.LimitReader(file, 8<<20)).Decode(&r.state)
	// Close before save() renames over this path. Windows refuses os.Rename while
	// a handle is open, which is the same reason store.OpenFile closes early.
	closeErr := file.Close()
	if decodeErr != nil {
		return fmt.Errorf("decode meta conversion file: %w", decodeErr)
	}
	if closeErr != nil {
		return fmt.Errorf("close meta conversion file: %w", closeErr)
	}
	if r.state.LeadWatermark.At.IsZero() {
		r.state.LeadWatermark.At = r.now()
	}
	r.state.Version = reporterStateVersion
	return nil
}

// save writes the file atomically. The caller must hold r.mutex.
func (r *Reporter) save() error {
	if r.options.Path == "" {
		return nil
	}
	directory := filepath.Dir(r.options.Path)
	if err := os.MkdirAll(directory, 0o750); err != nil {
		return fmt.Errorf("create meta conversion directory: %w", err)
	}
	temporary, err := os.CreateTemp(directory, ".garuda-meta-*.tmp")
	if err != nil {
		return fmt.Errorf("create temporary meta conversion file: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	encoder := json.NewEncoder(temporary)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(&r.state); err != nil {
		temporary.Close()
		return fmt.Errorf("encode meta conversion file: %w", err)
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return fmt.Errorf("sync meta conversion file: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close temporary meta conversion file: %w", err)
	}
	if err := os.Rename(temporaryPath, r.options.Path); err != nil {
		return fmt.Errorf("replace meta conversion file: %w", err)
	}
	return nil
}
