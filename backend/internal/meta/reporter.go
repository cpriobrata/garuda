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

// Reporter turns durably committed state changes into Meta conversions.
//
// THE EVENT SET. Three events, from three different state changes, and they are
// not interchangeable:
//
//	CompleteRegistration  a model.User's EmailVerifiedAt became non-nil
//	                      -- somebody signed up for GARUDA and proved the
//	                      address is theirs. Garuda's own funnel.
//
//	Purchase              a model.Subscription entered a paid status
//	                      -- somebody PAID for Garuda. Garuda's own funnel,
//	                      carrying value and currency from the one plan.
//
//	Lead                  a model.Lead was written
//	                      -- a visitor on one of our CUSTOMERS' websites filled
//	                      in that customer's contact form. NOT Garuda's funnel.
//
// The first two are what an acquisition campaign should optimise against: they
// are the outcomes the ad spend is buying. The third says the product is working
// for the people already paying for it, which is worth reporting as a separate
// signal but must never be the optimisation goal -- one customer's busy widget
// would otherwise outweigh every actual sale. Keep them on separate custom
// conversions in Events Manager.
//
// WHY POLLING AND NOT A CALL FROM THE HANDLERS.
//
// The mechanism is copied from internal/outbound on purpose -- read the Scan doc
// comment there, the reasoning for polling committed state instead of calling
// from the handler applies here word for word, and a slow Meta API on the
// widget's lead request would be a slow chat widget for a visitor. What is NOT
// reused is the registry itself, for three reasons:
//
//  1. Different audience. outbound only emits lead.created for accounts that
//     have an enabled webhook endpoint subscribed to it, because those events
//     belong to the customer. Meta conversions belong to Garuda's own ad
//     account and must cover EVERY account, including the overwhelming majority
//     that will never configure a webhook -- and outbound has no notion of a
//     signup or a payment at all.
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
// HOW A STATE TRANSITION IS DETECTED WITHOUT DIFFING TWO SNAPSHOTS.
//
// A new row is easy: it is newer than a watermark. A transition on an existing
// row normally is not, because the poll only ever sees the current state.
//
// CompleteRegistration escapes that because the transition STAMPS ITS OWN
// TIMESTAMP into the row. EmailVerifiedAt is nil until the moment of
// verification and then holds that moment, and every write site in the api
// package guards on `== nil` first, so it is write-once and never moves. That
// turns "find the users who verified since I last looked" into exactly the same
// "find the rows whose timestamp is past the watermark" problem the lead scan
// already solves -- the watermark simply keys on EmailVerifiedAt instead of
// CreatedAt. No previous snapshot is needed and none is kept.
//
// Purchase has no such stamp: nothing records WHEN a subscription became paid,
// only that it is paid now, and UpdatedAt moves on every later write including a
// renewal. So it uses the other shape of the same idea -- a persisted set of the
// subscription ids already reported. The set is seeded on first run with every
// subscription that is ALREADY paid, which is what stops the back catalogue
// being reported as today's sales, and a subscription is reported exactly once,
// on its first entry into a paid status. A monthly renewal is deliberately not a
// Purchase: it is retention, and counting it against the ad spend that acquired
// the customer would inflate the conversion count and flatter the campaign.
//
// The set never shrinks. It is bounded by the number of subscriptions that have
// ever been paid, which is bounded by the number of accounts -- every one of
// which is already fully materialised in the same data file -- so it introduces
// no new class of growth.
type Reporter struct {
	options   ReporterOptions
	initError error

	// scanMutex serialises Scan against itself, so two passes can never send the
	// same conversion twice. mutex protects state, which Scan briefly releases.
	scanMutex sync.Mutex

	mutex sync.Mutex
	state reporterState
	// consecutiveFailures drives the give-up rule below.
	consecutiveFailures int

	stop      chan struct{}
	stopped   chan struct{}
	closeOnce sync.Once
}

// ReporterOptions configures a Reporter. Everything has a working default except
// the plan price, which has none on purpose -- see PlanValueCents.
type ReporterOptions struct {
	// Client is the Conversions API client. A nil or unconfigured client makes
	// the whole Reporter a no-op: it never reads the store and never writes its
	// state file, so an install with no Meta credentials behaves exactly as it
	// does today.
	Client *Client
	// Store is read by the scan. A nil store disables scanning.
	Store store.Store
	// Path is the JSON file the watermarks live in. Empty keeps them in memory,
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

	// PlanValueCents is what one subscription is worth, in minor units, and it
	// is DELIBERATELY not defaulted. The price lives in config.PlanAmountCents
	// (GARUDA_PLAN_AMOUNT_CENTS, 1700) and is hard-coded as the single plan
	// "starter_17" in internal/api/billing.go; a default here would be a second
	// copy of the price that could silently drift from the one Stripe charges.
	// Left unset, Purchase reporting is switched off with a warning rather than
	// sending Meta a number that might be wrong.
	PlanValueCents int
	// PlanCurrency is an ISO 4217 code, from config.PlanCurrency. Required
	// alongside PlanValueCents for the same reason.
	PlanCurrency string
	// PlanCode names the plan on the conversion. Defaults to the only plan there
	// is.
	PlanCode string

	// SignUpSourceURL and CheckoutSourceURL are the pages a registration and a
	// purchase happen on. Both are optional and both are stripped to scheme,
	// host and path before they are sent. They exist because event_source_url is
	// what Meta uses to tie a conversion to a verified domain, and a signup
	// completed through the API has no page of its own to report.
	SignUpSourceURL   string
	CheckoutSourceURL string
}

const (
	reporterStateVersion = 2

	// defaultPlanCode is the only plan this product sells. Hard-coded as
	// "starter_17" throughout internal/api/billing.go.
	defaultPlanCode = "starter_17"

	// maxSendAttempts is the give-up rule. A failed batch is NOT skipped: the
	// watermarks stay put and the next poll re-reads and re-sends it, which is
	// safe because Meta collapses repeats by event_id. But a batch that fails
	// this many times in a row is presumed poisoned -- a malformed row, a
	// permanently rejected pixel -- and the watermarks are advanced past it so
	// one bad batch can never stop every later conversion being reported.
	maxSendAttempts = 5

	// maxEventAge is Meta's limit on how far in the past an event may be
	// stamped. Anything older is dropped here rather than sent, because Meta
	// would reject it and take the whole batch down with it -- which after a
	// multi-day outage would mean a backlog that poisons every batch forever.
	maxEventAge = 7 * 24 * time.Hour
)

// paidStatuses are the subscription statuses that mean money actually moved.
//
// "trialing" is deliberately absent even though internal/api treats it as
// entitling. A trial is access without payment; reporting it as a Purchase worth
// the full plan price would tell Meta revenue arrived when it has not, and
// value-based bidding would chase trials. A trial that converts writes "active"
// and fires then, which is the correct moment.
var paidStatuses = map[string]bool{"active": true}

// reporterState is the whole on-disk file. It holds positions and ids, and
// nothing else: no email, no phone, no name, no hash is ever written here.
type reporterState struct {
	Version       int       `json:"version"`
	LeadWatermark watermark `json:"lead_watermark"`
	// RegistrationWatermark keys on EmailVerifiedAt, not CreatedAt. See the
	// Reporter doc comment.
	RegistrationWatermark watermark `json:"registration_watermark"`
	// ReportedPurchases is the subscription ids already reported, against the
	// time they were reported. A membership test is all that is read; the time
	// is kept because a position file that cannot say when is useless to debug.
	ReportedPurchases map[string]time.Time `json:"reported_purchases,omitempty"`
	// PurchasesSeeded records that the already-paid subscriptions present on
	// first run have been absorbed. Without it, every existing customer would be
	// reported as having bought today.
	PurchasesSeeded bool `json:"purchases_seeded"`
}

// watermark records how far a scan has read. IDs holds the identifiers whose
// timestamp is exactly At, which is what makes the scan exact rather than
// approximate: two rows stamped in the same instant cannot make the second one
// vanish, and neither can be reported twice. It stays small because only ties on
// the newest instant are ever kept.
//
// This mirrors outbound's unexported watermark. Duplicating thirty lines is
// preferable to widening that package's API for a consumer it was not written
// for.
type watermark struct {
	At  time.Time `json:"at"`
	IDs []string  `json:"ids,omitempty"`
}

func (w watermark) seen(identifier string, at time.Time) bool {
	if at.After(w.At) {
		return false
	}
	if at.Before(w.At) {
		return true
	}
	for _, seen := range w.IDs {
		if seen == identifier {
			return true
		}
	}
	return false
}

func (w watermark) advance(identifier string, at time.Time) watermark {
	switch {
	case at.After(w.At):
		return watermark{At: at, IDs: []string{identifier}}
	case at.Equal(w.At):
		return watermark{At: w.At, IDs: append(append([]string(nil), w.IDs...), identifier)}
	default:
		return w
	}
}

// StatePath puts the conversion watermarks beside the main data file. An empty
// data file path -- which is what the tests configure -- keeps them in memory.
func StatePath(dataFile string) string {
	trimmed := strings.TrimSpace(dataFile)
	if trimmed == "" {
		return ""
	}
	return filepath.Join(filepath.Dir(trimmed), "meta-conversions.json")
}

// NewReporter opens a reporter and, unless DisableBackground is set, starts the
// goroutine that polls for new conversions. It never fails: an unreadable state
// file is logged and disables scanning, because losing conversion reporting is a
// far better outcome than refusing to boot the API.
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
	if strings.TrimSpace(options.PlanCode) == "" {
		options.PlanCode = defaultPlanCode
	}
	options.PlanCurrency = strings.TrimSpace(options.PlanCurrency)
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
		if !reporter.purchasesConfigured() {
			// Loud, once, at startup. Silently never reporting a sale is the
			// worst outcome available here.
			options.Logger.Warn("meta purchase conversions are disabled: no plan value and currency were configured, so only registrations and leads will be reported")
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

// purchasesConfigured reports whether a Purchase can carry a real price.
func (r *Reporter) purchasesConfigured() bool {
	return r != nil && r.options.PlanValueCents > 0 && r.options.PlanCurrency != ""
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
// is what keeps a slow or dead Meta API off a visitor's conversation and off a
// signing-up owner's request.
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

// ------------------------------------------------------------------- snapshots
//
// Every type below holds only values copied out of the store: strings, which are
// immutable, and time.Time, which is a value. Nothing aliases live state. In
// particular a *time.Time from a row is DEREFERENCED inside the View callback
// and the time copied out, never the pointer -- model.User and
// model.Subscription have no Clone helper, and carrying a pointer out of the
// read lock is exactly the aliasing that rule one warns about.

type pendingLead struct {
	id        string
	sessionID string
	email     string
	phone     string
	name      string
	createdAt time.Time
	pageURL   string
}

type pendingRegistration struct {
	id         string
	email      string
	name       string
	verifiedAt time.Time
}

type pendingPurchase struct {
	subscriptionID string
	accountID      string
	occurredAt     time.Time
	email          string
	name           string
}

// ownerContact is the person a purchase should be matched to.
type ownerContact struct {
	email     string
	name      string
	role      string
	createdAt time.Time
}

// Scan reads committed state and reports every conversion it has not reported
// yet. It is called from a single goroutine -- the poller, or a test -- and
// scanMutex enforces that.
func (r *Reporter) Scan(ctx context.Context) {
	if !r.Enabled() || r.initError != nil {
		return
	}
	r.scanMutex.Lock()
	defer r.scanMutex.Unlock()

	r.mutex.Lock()
	leadMark := r.state.LeadWatermark
	registrationMark := r.state.RegistrationWatermark
	seeded := r.state.PurchasesSeeded
	reported := make(map[string]bool, len(r.state.ReportedPurchases))
	for identifier := range r.state.ReportedPurchases {
		reported[identifier] = true
	}
	r.mutex.Unlock()

	var (
		leads         []pendingLead
		registrations []pendingRegistration
		purchases     []pendingPurchase
		seedIDs       map[string]time.Time
	)

	// One View for all three scans: one acquisition of the read lock, one pass
	// over committed state, and a consistent picture across the three tables.
	_ = r.options.Store.View(func(state *model.State) error {
		for _, lead := range state.Leads {
			if leadMark.seen(lead.ID, lead.CreatedAt) {
				continue
			}
			leads = append(leads, pendingLead{
				id: lead.ID, sessionID: lead.SessionID, email: lead.Email,
				phone: lead.Phone, name: lead.Name, createdAt: lead.CreatedAt,
			})
		}
		if len(leads) > 0 {
			// The landing page a lead came from lives on its session, not on the
			// lead. Only the sessions actually referenced are kept, so a store with
			// a long session history costs nothing on a scan that finds none.
			wanted := make(map[string]bool, len(leads))
			for _, item := range leads {
				if item.sessionID != "" {
					wanted[item.sessionID] = true
				}
			}
			pageURLs := make(map[string]string, len(wanted))
			for _, session := range state.Sessions {
				if wanted[session.ID] {
					pageURLs[session.ID] = session.PageURL
				}
			}
			for index := range leads {
				leads[index].pageURL = pageURLs[leads[index].sessionID]
			}
		}

		for _, user := range state.Users {
			// A user who has not verified has not registered as far as this
			// pipeline is concerned. Nothing is advanced for them -- they come back
			// as a candidate the moment the stamp lands.
			if user.EmailVerifiedAt == nil {
				continue
			}
			verifiedAt := *user.EmailVerifiedAt
			if registrationMark.seen(user.ID, verifiedAt) {
				continue
			}
			registrations = append(registrations, pendingRegistration{
				id: user.ID, email: user.Email, name: user.Name, verifiedAt: verifiedAt,
			})
		}

		if !seeded {
			// First run. Absorb every subscription that is already paid so the back
			// catalogue is never reported as today's sales, and emit nothing this
			// pass.
			seedIDs = map[string]time.Time{}
			for _, subscription := range state.Subscriptions {
				if paidStatuses[subscription.Status] {
					seedIDs[subscription.ID] = subscription.UpdatedAt
				}
			}
		} else if r.purchasesConfigured() {
			var candidates []pendingPurchase
			accountsWanted := map[string]bool{}
			for _, subscription := range state.Subscriptions {
				if !paidStatuses[subscription.Status] || reported[subscription.ID] {
					continue
				}
				candidates = append(candidates, pendingPurchase{
					subscriptionID: subscription.ID,
					accountID:      subscription.AccountID,
					// Nothing records when a subscription became paid, so the last
					// write to it is the closest thing available. For the transition
					// itself -- which is the only time a subscription reaches here --
					// that write IS the transition.
					occurredAt: subscription.UpdatedAt,
				})
				accountsWanted[subscription.AccountID] = true
			}
			if len(candidates) > 0 {
				owners := map[string]ownerContact{}
				for _, user := range state.Users {
					if !accountsWanted[user.AccountID] {
						continue
					}
					candidate := ownerContact{email: user.Email, name: user.Name, role: user.Role, createdAt: user.CreatedAt}
					existing, found := owners[user.AccountID]
					if !found || betterOwner(candidate, existing) {
						owners[user.AccountID] = candidate
					}
				}
				for _, candidate := range candidates {
					contact := owners[candidate.accountID]
					candidate.email = contact.email
					candidate.name = contact.name
					purchases = append(purchases, candidate)
				}
			}
		}
		return nil
	})

	if seedIDs != nil {
		r.seedPurchases(seedIDs)
		// Deliberately fall through: leads and registrations found on this same
		// pass are still reported. Only purchases are absorbed.
	}

	now := r.now()
	events, plan := r.plan(leads, registrations, purchases, now)
	if len(events) > 0 {
		received, err := r.options.Client.Send(ctx, events...)
		if err != nil {
			r.recordFailure(plan, err)
			return
		}
		// Counts only. No identifier, hashed or otherwise, is ever logged.
		r.options.Logger.Info("meta conversions reported",
			"registrations", plan.registrationCount, "purchases", plan.purchaseCount,
			"leads", plan.leadCount, "accepted", received, "skipped", plan.skipped,
			"test_mode", r.options.Client.TestMode())
	}
	r.commit(plan)
}

// commitPlan is what a successful send makes durable.
type commitPlan struct {
	leadMark          watermark
	registrationMark  watermark
	newPurchases      map[string]time.Time
	leadCount         int
	registrationCount int
	purchaseCount     int
	skipped           int
}

// plan turns the three candidate lists into one batch of events plus exactly
// what to persist if it lands. Building both together is what keeps a watermark
// from ever advancing past something that was not in the batch.
func (r *Reporter) plan(leads []pendingLead, registrations []pendingRegistration, purchases []pendingPurchase, now time.Time) ([]Event, commitPlan) {
	r.mutex.Lock()
	plan := commitPlan{
		leadMark:         r.state.LeadWatermark,
		registrationMark: r.state.RegistrationWatermark,
		newPurchases:     map[string]time.Time{},
	}
	r.mutex.Unlock()

	// Oldest first within each kind, with the id breaking a tie, so a capped
	// batch always makes forward progress and two runs over the same data behave
	// identically.
	sort.SliceStable(registrations, func(first, second int) bool {
		if registrations[first].verifiedAt.Equal(registrations[second].verifiedAt) {
			return registrations[first].id < registrations[second].id
		}
		return registrations[first].verifiedAt.Before(registrations[second].verifiedAt)
	})
	sort.SliceStable(purchases, func(first, second int) bool {
		if purchases[first].occurredAt.Equal(purchases[second].occurredAt) {
			return purchases[first].subscriptionID < purchases[second].subscriptionID
		}
		return purchases[first].occurredAt.Before(purchases[second].occurredAt)
	})
	sort.SliceStable(leads, func(first, second int) bool {
		if leads[first].createdAt.Equal(leads[second].createdAt) {
			return leads[first].id < leads[second].id
		}
		return leads[first].createdAt.Before(leads[second].createdAt)
	})

	// Garuda's own funnel is budgeted first. If a single poll ever finds more
	// than one batch of work, a sale must not be crowded out by a customer's
	// busy widget.
	budget := maxEventsPerRequest
	registrations, budget = capSlice(registrations, budget)
	purchases, budget = capSlice(purchases, budget)
	leads, _ = capSlice(leads, budget)

	events := make([]Event, 0, len(registrations)+len(purchases)+len(leads))

	for _, item := range registrations {
		plan.registrationMark = plan.registrationMark.advance(item.id, item.verifiedAt)
		if item.email == "" || tooOld(item.verifiedAt, now) {
			plan.skipped++
			continue
		}
		firstName, lastName := splitName(item.name)
		events = append(events, RegistrationEvent(item.id, item.verifiedAt, r.options.SignUpSourceURL, UserData{
			Email: item.email, FirstName: firstName, LastName: lastName,
		}))
		plan.registrationCount++
	}

	for _, item := range purchases {
		// A purchase is recorded as reported whether or not it could be sent.
		// Leaving an unsendable one out would make every later poll reconsider it
		// forever.
		plan.newPurchases[item.subscriptionID] = now
		if item.email == "" || tooOld(item.occurredAt, now) {
			plan.skipped++
			continue
		}
		firstName, lastName := splitName(item.name)
		events = append(events, PurchaseEvent(item.subscriptionID, item.occurredAt, r.options.CheckoutSourceURL,
			UserData{Email: item.email, FirstName: firstName, LastName: lastName},
			r.options.PlanValueCents, r.options.PlanCurrency, r.options.PlanCode))
		plan.purchaseCount++
	}

	for _, item := range leads {
		// The watermark advances for every lead considered, including the ones
		// with nothing to match on. Leaving those behind would make the scan
		// re-read them forever.
		plan.leadMark = plan.leadMark.advance(item.id, item.createdAt)
		if (item.email == "" && item.phone == "") || tooOld(item.createdAt, now) {
			plan.skipped++
			continue
		}
		firstName, lastName := splitName(item.name)
		// A NOTE ON PHONE MATCH RATES, so nobody later reads a low one as a bug
		// in the hashing. normalizePhone in internal/api/widget.go stores what the
		// visitor typed. A number typed as a bare national "07700 900123" reaches
		// here with no country code, is normalised and hashed exactly as Meta
		// specifies, and will still match nobody, because the hash Meta holds is
		// of the E.164 form. That is a capture-form problem, not a hashing one --
		// and inventing a country code would produce a hash that is confidently
		// wrong, which is strictly worse than one that fails to match. The email
		// on the same lead is unaffected and carries the match on its own.
		events = append(events, LeadEvent(item.id, item.createdAt, item.pageURL, UserData{
			Email: item.email, Phone: item.phone, FirstName: firstName, LastName: lastName,
		}))
		plan.leadCount++
	}
	return events, plan
}

// capSlice trims a batch to the remaining budget and returns what is left of it.
func capSlice[T any](items []T, budget int) ([]T, int) {
	if budget <= 0 {
		return nil, 0
	}
	if len(items) > budget {
		return items[:budget], 0
	}
	return items, budget - len(items)
}

// tooOld drops an event Meta would reject for age. After a multi-day outage the
// backlog would otherwise fail the whole batch on every retry, forever.
func tooOld(at time.Time, now time.Time) bool {
	return now.Sub(at) >= maxEventAge
}

// betterOwner picks the person a purchase is matched to: the account's owner
// row, or failing that the earliest user on the account, which is whoever
// created it.
func betterOwner(candidate, existing ownerContact) bool {
	if (candidate.role == "owner") != (existing.role == "owner") {
		return candidate.role == "owner"
	}
	return candidate.createdAt.Before(existing.createdAt)
}

// seedPurchases absorbs the already-paid subscriptions found on the first run.
func (r *Reporter) seedPurchases(seedIDs map[string]time.Time) {
	r.mutex.Lock()
	if r.state.ReportedPurchases == nil {
		r.state.ReportedPurchases = map[string]time.Time{}
	}
	for identifier, at := range seedIDs {
		r.state.ReportedPurchases[identifier] = at
	}
	r.state.PurchasesSeeded = true
	err := r.save()
	r.mutex.Unlock()
	r.options.Logger.Info("meta purchase reporting started", "existing_subscriptions_absorbed", len(seedIDs))
	if err != nil {
		r.options.Logger.Error("meta conversion watermark could not be persisted", "error", err)
	}
}

// recordFailure leaves every watermark alone so the next poll retries the same
// batch, unless the batch has now failed enough times in a row to be presumed
// poisoned.
func (r *Reporter) recordFailure(plan commitPlan, sendErr error) {
	r.mutex.Lock()
	r.consecutiveFailures++
	attempts := r.consecutiveFailures
	abandon := attempts >= maxSendAttempts
	var saveErr error
	if abandon {
		r.consecutiveFailures = 0
		r.applyLocked(plan)
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

func (r *Reporter) commit(plan commitPlan) {
	r.mutex.Lock()
	r.consecutiveFailures = 0
	r.applyLocked(plan)
	err := r.save()
	r.mutex.Unlock()
	if err != nil {
		r.options.Logger.Error("meta conversion watermark could not be persisted", "error", err)
	}
}

// applyLocked folds a plan into the persisted state. The caller must hold mutex.
func (r *Reporter) applyLocked(plan commitPlan) {
	r.state.LeadWatermark = plan.leadMark
	r.state.RegistrationWatermark = plan.registrationMark
	if len(plan.newPurchases) == 0 {
		return
	}
	if r.state.ReportedPurchases == nil {
		r.state.ReportedPurchases = map[string]time.Time{}
	}
	for identifier, at := range plan.newPurchases {
		r.state.ReportedPurchases[identifier] = at
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
	r.state = reporterState{Version: reporterStateVersion, ReportedPurchases: map[string]time.Time{}}
	if r.options.Path == "" {
		r.state.LeadWatermark = watermark{At: r.now()}
		r.state.RegistrationWatermark = watermark{At: r.now()}
		return nil
	}
	file, err := os.Open(r.options.Path)
	if errors.Is(err, os.ErrNotExist) {
		// First run starts at now. The database already holds every lead, user and
		// subscription this product has ever had, and replaying that history the
		// morning the credentials land would report months of conversions as if
		// they happened today -- Meta rejects anything older than seven days
		// anyway, and the rest would teach the ad account a spike that never
		// occurred. Purchases get the same protection through PurchasesSeeded,
		// which is applied on the first scan because it needs the store.
		r.state.LeadWatermark = watermark{At: r.now()}
		r.state.RegistrationWatermark = watermark{At: r.now()}
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
	// A file written by the version of this package that only knew about leads
	// upgrades in place: the registration watermark starts at now, and purchases
	// are seeded on the next scan, so neither replays history.
	if r.state.LeadWatermark.At.IsZero() {
		r.state.LeadWatermark.At = r.now()
	}
	if r.state.RegistrationWatermark.At.IsZero() {
		r.state.RegistrationWatermark.At = r.now()
	}
	if r.state.ReportedPurchases == nil {
		r.state.ReportedPurchases = map[string]time.Time{}
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
