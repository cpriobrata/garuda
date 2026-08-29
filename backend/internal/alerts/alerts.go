// Package alerts pages a human when the service is in trouble.
//
// WHAT THIS IS FOR. The owner asked to be told on WhatsApp the moment anything
// breaks anywhere in the codebase. That is the right instinct and the wrong
// literal implementation: a service that messages a phone on every error is a
// service that messages a phone ten thousand times during one bad deploy, and
// the eleventh message is the one nobody reads. So this package sends, and it
// also decides what is worth sending.
//
// THREE RULES HOLD IT TOGETHER.
//
// First, ONLY SERVER FAULTS. A 404, a 401, a 422 -- somebody typed a bad URL,
// somebody's token expired, somebody submitted a bad form -- are the service
// working correctly. Only a panic or a 5xx means the service itself is wrong.
//
// Second, DEDUPLICATED BY FINGERPRINT. The same failure at the same place is one
// alert per cooldown window, with a count attached, not one alert per request.
// A dependency that is down produces one message an hour, not one a millisecond.
//
// Third, HARD CAPPED. Even across distinct fingerprints there is a ceiling per
// hour. A cascading failure is exactly when the alert channel must not become
// the second outage.
//
// WHAT IS NEVER SENT. No prompt, no chat message, no transcript, no email
// address, no phone number, no token, no request body. An alert carries the
// route pattern, the status, an error class and a request id -- enough to find
// the incident in the logs, and nothing that turns a phone into a data store.
package alerts

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"
)

// Transport is what actually delivers a message. It is an interface so that the
// WhatsApp provider can be swapped without touching any of the policy above,
// and so tests can assert on what would have been sent without a network.
type Transport interface {
	Enabled() bool
	Send(ctx context.Context, text string) error
	Name() string
}

// Alert is one thing that went wrong.
type Alert struct {
	// Kind is the coarse class: "panic", "http_5xx", "dependency".
	Kind string
	// Where is the route pattern or subsystem -- never a URL with parameters
	// substituted in, which would leak ids into the message.
	Where string
	// Detail is a short, already-safe description. Callers are responsible for
	// making sure it carries no visitor content; sanitize() is a backstop.
	Detail string
	// RequestID ties the alert to the log line that has the full story.
	RequestID string
	// Status is the HTTP status, when there was one.
	Status int
}

// fingerprint is what deduplication groups by. Two failures with the same kind,
// place and status are the same incident however many times they happen.
func (a Alert) fingerprint() string {
	return a.Kind + "|" + a.Where + "|" + fmt.Sprint(a.Status)
}

const (
	// defaultCooldown is how long one fingerprint stays quiet after alerting.
	// Long enough that a persistent failure is a handful of messages a night,
	// short enough that a recurrence after a fix is noticed.
	defaultCooldown = 15 * time.Minute
	// defaultHourlyCap bounds every fingerprint together. Past this the notifier
	// goes quiet and says so in the last message it sends, so silence is never
	// ambiguous.
	defaultHourlyCap = 12
	// maxDetailLength keeps one message inside what every messaging API accepts
	// and stops an enormous error string becoming an enormous bill.
	maxDetailLength = 400
)

// Notifier applies the policy and hands what survives to the transport.
type Notifier struct {
	transport Transport
	service   string
	cooldown  time.Duration
	hourlyCap int
	now       func() time.Time

	mutex         sync.Mutex
	lastSent      map[string]time.Time
	suppressed    map[string]int
	sentTimes     []time.Time
	capNoticeSent bool
}

// Options configures a Notifier. Zero values take the documented defaults, so a
// caller that only has a transport can pass just that.
type Options struct {
	Transport Transport
	// Service names the deployment in every message, because an owner running
	// staging and production sees two identical alerts otherwise.
	Service   string
	Cooldown  time.Duration
	HourlyCap int
	Now       func() time.Time
}

func New(options Options) *Notifier {
	notifier := &Notifier{
		transport:  options.Transport,
		service:    strings.TrimSpace(options.Service),
		cooldown:   options.Cooldown,
		hourlyCap:  options.HourlyCap,
		now:        options.Now,
		lastSent:   map[string]time.Time{},
		suppressed: map[string]int{},
	}
	if notifier.cooldown <= 0 {
		notifier.cooldown = defaultCooldown
	}
	if notifier.hourlyCap <= 0 {
		notifier.hourlyCap = defaultHourlyCap
	}
	if notifier.now == nil {
		notifier.now = func() time.Time { return time.Now().UTC() }
	}
	if notifier.service == "" {
		notifier.service = "garuda"
	}
	return notifier
}

// Enabled reports whether anything would actually be delivered. Callers use it
// to skip building a message at all, which matters because Notify is called
// from the request path.
func (n *Notifier) Enabled() bool {
	return n != nil && n.transport != nil && n.transport.Enabled()
}

// Notify considers one alert and, if policy allows, sends it.
//
// It never blocks the caller: delivery runs on its own goroutine with its own
// timeout, because the whole point is to report that something is already
// broken, and waiting on a messaging API to say so would make the outage worse.
func (n *Notifier) Notify(alert Alert) {
	if !n.Enabled() {
		return
	}
	text, send := n.consider(alert)
	if !send {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
		defer cancel()
		// A failed alert is deliberately silent. There is no second channel to
		// report it on, and logging it is already handled by the caller that
		// logged the underlying failure.
		_ = n.transport.Send(ctx, text)
	}()
}

// consider is the whole policy, separated from delivery so it can be tested
// without a transport and without a clock.
func (n *Notifier) consider(alert Alert) (string, bool) {
	now := n.now()
	fingerprint := alert.fingerprint()

	n.mutex.Lock()
	defer n.mutex.Unlock()

	// Drop send times older than the hour so the cap is a rolling window rather
	// than a permanent budget.
	fresh := n.sentTimes[:0]
	for _, sent := range n.sentTimes {
		if now.Sub(sent) < time.Hour {
			fresh = append(fresh, sent)
		}
	}
	n.sentTimes = fresh
	if len(n.sentTimes) < n.hourlyCap {
		n.capNoticeSent = false
	}

	if last, seen := n.lastSent[fingerprint]; seen && now.Sub(last) < n.cooldown {
		n.suppressed[fingerprint]++
		return "", false
	}

	// The LAST slot in the window is reserved for the notice, so the cap is a
	// true ceiling on messages sent rather than a ceiling plus one. Without the
	// reservation a flood delivers hourlyCap+1, which is a small lie in exactly
	// the code whose job is to be trustworthy about volume.
	if len(n.sentTimes) >= n.hourlyCap-1 {
		if n.capNoticeSent {
			n.suppressed[fingerprint]++
			return "", false
		}
		// One final message saying the channel has gone quiet, so an owner who
		// stops receiving alerts knows whether that means fixed or flooded.
		n.capNoticeSent = true
		n.sentTimes = append(n.sentTimes, now)
		return n.service + ": too many distinct failures this hour. Further alerts are paused until the rate drops. Check the server logs.", true
	}

	repeats := n.suppressed[fingerprint]
	delete(n.suppressed, fingerprint)
	n.lastSent[fingerprint] = now
	n.sentTimes = append(n.sentTimes, now)
	return n.compose(alert, repeats, now), true
}

func (n *Notifier) compose(alert Alert, repeats int, now time.Time) string {
	var builder strings.Builder
	builder.WriteString(n.service)
	builder.WriteString(": ")
	switch alert.Kind {
	case "panic":
		builder.WriteString("a request crashed the handler")
	case "http_5xx":
		builder.WriteString("the API returned a server error")
	case "dependency":
		builder.WriteString("a dependency failed")
	default:
		builder.WriteString(sanitize(alert.Kind, 60))
	}
	builder.WriteString("\n\nWhere: ")
	builder.WriteString(sanitize(alert.Where, 120))
	if alert.Status > 0 {
		builder.WriteString(fmt.Sprintf("\nStatus: %d", alert.Status))
	}
	if detail := sanitize(alert.Detail, maxDetailLength); detail != "" {
		builder.WriteString("\nDetail: ")
		builder.WriteString(detail)
	}
	if alert.RequestID != "" {
		builder.WriteString("\nRequest: ")
		builder.WriteString(sanitize(alert.RequestID, 80))
	}
	if repeats > 0 {
		builder.WriteString(fmt.Sprintf("\n\n(%d further occurrences were suppressed since the last alert.)", repeats))
	}
	builder.WriteString("\nAt: ")
	builder.WriteString(now.Format(time.RFC3339))
	return builder.String()
}

// sanitize is the backstop for the no-personal-data rule. Callers are meant to
// pass safe values; this makes a mistake harmless rather than a disclosure, by
// stripping anything shaped like an address or a long opaque token and by
// collapsing the newlines that would otherwise let a crafted error string forge
// extra fields in the message.
func sanitize(value string, limit int) string {
	value = strings.TrimSpace(strings.Map(func(r rune) rune {
		if r == '\n' || r == '\r' || r == '\t' {
			return ' '
		}
		return r
	}, value))
	if value == "" {
		return ""
	}
	fields := strings.Fields(value)
	for index, field := range fields {
		if strings.Contains(field, "@") && strings.Contains(field, ".") {
			fields[index] = "[redacted]"
			continue
		}
		if len(field) > 40 && !strings.ContainsAny(field, " ") {
			fields[index] = "[redacted]"
		}
	}
	value = strings.Join(fields, " ")
	if len(value) > limit {
		value = value[:limit] + "…"
	}
	return value
}

// SuppressedCounts reports what is currently being held back, newest fingerprint
// last. It exists for the health endpoint and for tests; nothing on the request
// path reads it.
func (n *Notifier) SuppressedCounts() map[string]int {
	if n == nil {
		return nil
	}
	n.mutex.Lock()
	defer n.mutex.Unlock()
	counts := make(map[string]int, len(n.suppressed))
	for fingerprint, count := range n.suppressed {
		counts[fingerprint] = count
	}
	return counts
}

// Fingerprints lists what has alerted, sorted, for the same diagnostic use.
func (n *Notifier) Fingerprints() []string {
	if n == nil {
		return nil
	}
	n.mutex.Lock()
	defer n.mutex.Unlock()
	seen := make([]string, 0, len(n.lastSent))
	for fingerprint := range n.lastSent {
		seen = append(seen, fingerprint)
	}
	sort.Strings(seen)
	return seen
}
