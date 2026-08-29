// Package meta reports conversions to Meta's Conversions API so a paid ad
// account can optimise against the leads the product actually captured.
//
// WHY A SERVER EVENT AT ALL. A browser pixel alone loses every conversion an ad
// blocker, a cookie restriction or a closed tab takes with it, and it can only
// see what happens inside the page. The lead Garuda cares about is written on
// the server, so the server is the only place that knows for certain that it
// happened. The browser pixel stays useful for attribution signals the server
// never sees, which is why both are sent and why EventID exists to stop the pair
// being counted twice.
//
// WHAT LEAVES THIS MACHINE. Only hashed identifiers. Email, phone and name are
// normalised and SHA-256'd here and the raw value never reaches a request body,
// a URL or a log line -- which also means no error Meta returns can echo one
// back, because it never had one. The access token travels in the JSON body
// rather than the query string for the same reason house rule seven forbids
// URL-encoding a token: a URL ends up in proxy logs and a body does not.
//
// Hand-rolled against the plain HTTPS API for the same reason as every other
// adapter here: the backend carries no third-party dependencies.
package meta

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode"
)

const (
	defaultAPIURL = "https://graph.facebook.com/v21.0"

	// EventNameLead is Meta's standard event for a captured lead. A standard
	// event name rather than a custom one because only standard events can be
	// chosen as an optimisation goal without further setup in Events Manager,
	// and optimisation is the entire point of sending this.
	EventNameLead = "Lead"

	// actionSourceWebsite tells Meta the conversion happened on a website rather
	// than in a shop, an app or over the phone. Meta rejects an event with no
	// action_source, so it is set here and never left to a caller.
	actionSourceWebsite = "website"

	// maxEventsPerRequest bounds one batch. Meta's own cap is larger, but a
	// smaller batch keeps a single failed request from costing a whole backlog
	// and keeps the request body predictable.
	maxEventsPerRequest = 500

	// maxProviderMessage bounds how much of Meta's rejection text is repeated in
	// an error. The text is Meta's, not ours, so it is truncated rather than
	// trusted to be short.
	maxProviderMessage = 300
)

// ErrNotConfigured is returned by every call on a client with no credentials. It
// exists so a caller can tell "Meta is switched off" apart from "Meta said no",
// and treat the first as normal.
var ErrNotConfigured = errors.New("meta conversions reporting is not configured")

// Client posts conversions to one pixel.
type Client struct {
	baseURL       string
	pixelID       string
	accessToken   string
	testEventCode string
	httpClient    *http.Client
}

// New builds a client. Every argument may be empty: an empty pixel id or access
// token produces a client whose Enabled() is false and whose Send is a refusal,
// which is how this adapter degrades to a no-op rather than a startup failure.
func New(baseURL, pixelID, accessToken, testEventCode string) *Client {
	trimmedBaseURL := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if trimmedBaseURL == "" {
		trimmedBaseURL = defaultAPIURL
	}
	return &Client{
		baseURL:       trimmedBaseURL,
		pixelID:       strings.TrimSpace(pixelID),
		accessToken:   strings.TrimSpace(accessToken),
		testEventCode: strings.TrimSpace(testEventCode),
		// Short by design. This runs on a background poll, so a stalled provider
		// costs a delayed conversion report and nothing else, but an unbounded
		// wait would pin the reporter goroutine for as long as Meta felt like it.
		httpClient: &http.Client{Timeout: 15 * time.Second},
	}
}

// Enabled reports whether conversions can be sent. Both halves of the credential
// are required: a pixel id on its own has nothing to authenticate with, and a
// token on its own has no pixel to post to, so a half-filled .env is switched
// off rather than half-working.
func (c *Client) Enabled() bool {
	return c != nil && c.pixelID != "" && c.accessToken != "" && c.baseURL != ""
}

// TestMode reports whether a test_event_code is configured, which routes every
// event to the Test Events tab in Events Manager instead of counting it. This is
// how the owner proves the pipeline works before any money is spent, and it is
// worth surfacing because leaving it set in production silently stops real
// conversions being attributed.
func (c *Client) TestMode() bool { return c != nil && c.testEventCode != "" }

// EventID is the deduplication key.
//
// THIS IS THE PROPERTY THAT MATTERS MOST. Meta collapses a browser pixel event
// and a server event into one conversion when they share an event_name and an
// event_id. Get it wrong and every lead is counted twice, the ad account learns
// from a number that is double the truth, and the bid strategy optimises towards
// a cost per lead that does not exist.
//
// The derivation is deliberately the identity function on the lead id, trimmed.
// The lead id is already unique, already stable for the life of the lead, and
// already opaque -- it carries nothing about the visitor. Any cleverer
// derivation (a hash, a prefix, a salt) has to be reimplemented byte for byte in
// the browser, and the moment the two implementations disagree the dedup
// silently stops working with no error anywhere. The safest derivation is the
// one that cannot drift. frontend/components/analytics/meta-events.ts mirrors
// this, and both sides have a test pinning the same literal.
func EventID(leadID string) string { return strings.TrimSpace(leadID) }

// UserData is the set of identifiers Meta matches a conversion against a person
// with. Values are supplied RAW and are normalised and hashed by this package --
// a caller must never pre-hash, because then the normalisation Meta requires
// would already have been skipped.
type UserData struct {
	Email     string
	Phone     string
	FirstName string
	LastName  string
}

// Event is one conversion.
type Event struct {
	// Name is a Meta event name. Empty means EventNameLead.
	Name string
	// EventID is the dedup key. Build it with EventID, never by hand.
	EventID string
	// OccurredAt is when the conversion actually happened, not when it is being
	// reported. Meta rejects events older than seven days, and an event stamped
	// with the send time rather than the lead time attributes to the wrong day.
	OccurredAt time.Time
	// SourceURL is the page the visitor was on. Optional; the query string and
	// fragment are stripped before it is sent.
	SourceURL string
	User      UserData
}

// LeadEvent builds the Lead conversion for one captured lead.
func LeadEvent(leadID string, occurredAt time.Time, sourceURL string, user UserData) Event {
	return Event{
		Name:       EventNameLead,
		EventID:    EventID(leadID),
		OccurredAt: occurredAt,
		SourceURL:  sourceURL,
		User:       user,
	}
}

// ---------------------------------------------------------------- normalisation

// NormalizeEmail is Meta's email rule: trim the surrounding whitespace and
// lowercase it. Nothing else -- in particular the dots and the +tag in a Gmail
// address are NOT stripped, because Meta hashes what the advertiser's other
// systems hash and those keep them.
func NormalizeEmail(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

// NormalizePhone is Meta's phone rule: digits only, no plus, no punctuation, no
// spaces, no letters and no leading zeroes, with the country code included.
//
// The country code is the part this code cannot manufacture. Garuda stores what
// the visitor typed, so "+44 7700 900123" normalises correctly to
// "447700900123", while a bare national "07700 900123" becomes "7700900123" and
// will simply not match anybody. That is a data problem, not a hashing one:
// inventing a country code would produce a hash that is confidently wrong, which
// is worse than one that fails to match.
func NormalizePhone(value string) string {
	var digits strings.Builder
	for _, character := range value {
		if character >= '0' && character <= '9' {
			digits.WriteRune(character)
		}
	}
	return strings.TrimLeft(digits.String(), "0")
}

// NormalizeName is Meta's rule for fn and ln: lowercase letters only. Digits,
// punctuation and whitespace are removed, so "O'Neill" and "Smith-Jones" hash as
// "oneill" and "smithjones". Non-ASCII letters are kept as themselves -- the
// hash is over UTF-8 bytes, and stripping accents would break every name that
// carries one.
func NormalizeName(value string) string {
	var letters strings.Builder
	for _, character := range strings.ToLower(strings.TrimSpace(value)) {
		if unicode.IsLetter(character) {
			letters.WriteRune(character)
		}
	}
	return letters.String()
}

// Hash is SHA-256 over an ALREADY NORMALISED value, lowercase hex. An empty
// value hashes to empty rather than to the hash of the empty string, because the
// hash of "" is a real 64-character value that Meta would accept and match
// against every other advertiser who made the same mistake.
func Hash(normalized string) string {
	if normalized == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(normalized))
	return hex.EncodeToString(sum[:])
}

// hashed turns raw user data into the wire form. It is the only path to the
// wire, so an unhashed identifier cannot be sent by forgetting a call.
func (u UserData) hashed() wireUserData {
	wire := wireUserData{}
	if hash := Hash(NormalizeEmail(u.Email)); hash != "" {
		wire.Email = []string{hash}
	}
	if hash := Hash(NormalizePhone(u.Phone)); hash != "" {
		wire.Phone = []string{hash}
	}
	if hash := Hash(NormalizeName(u.FirstName)); hash != "" {
		wire.FirstName = []string{hash}
	}
	if hash := Hash(NormalizeName(u.LastName)); hash != "" {
		wire.LastName = []string{hash}
	}
	return wire
}

func (u wireUserData) empty() bool {
	return len(u.Email) == 0 && len(u.Phone) == 0 && len(u.FirstName) == 0 && len(u.LastName) == 0
}

// ------------------------------------------------------------------- wire types

type wireUserData struct {
	Email     []string `json:"em,omitempty"`
	Phone     []string `json:"ph,omitempty"`
	FirstName []string `json:"fn,omitempty"`
	LastName  []string `json:"ln,omitempty"`
}

type wireEvent struct {
	EventName      string       `json:"event_name"`
	EventTime      int64        `json:"event_time"`
	EventID        string       `json:"event_id"`
	ActionSource   string       `json:"action_source"`
	EventSourceURL string       `json:"event_source_url,omitempty"`
	UserData       wireUserData `json:"user_data"`
}

type wireRequest struct {
	Data []wireEvent `json:"data"`
	// AccessToken rides in the body, never the query string. See the package
	// comment.
	AccessToken string `json:"access_token"`
	// TestEventCode is omitted unless configured. Present, it diverts every event
	// in the request to Events Manager's Test Events tab.
	TestEventCode string `json:"test_event_code,omitempty"`
}

// wire validates one event and renders it. Validation lives here rather than in
// the caller so nothing can reach Meta half-formed.
func (e Event) wire() (wireEvent, error) {
	name := strings.TrimSpace(e.Name)
	if name == "" {
		name = EventNameLead
	}
	identifier := strings.TrimSpace(e.EventID)
	if identifier == "" {
		return wireEvent{}, errors.New("a conversion needs an event id to deduplicate against the browser pixel")
	}
	if e.OccurredAt.IsZero() {
		return wireEvent{}, errors.New("a conversion needs the time it actually happened")
	}
	user := e.User.hashed()
	if user.empty() {
		return wireEvent{}, errors.New("a conversion needs at least one identifier Meta can match against")
	}
	return wireEvent{
		EventName:      name,
		EventTime:      e.OccurredAt.UTC().Unix(),
		EventID:        identifier,
		ActionSource:   actionSourceWebsite,
		EventSourceURL: sourceURL(e.SourceURL),
		UserData:       user,
	}, nil
}

// sourceURL keeps the scheme, host and path and drops everything after them.
//
// The query string on a customer's page is not ours to forward. It routinely
// carries a session id, an email in a prefill parameter, or whatever else that
// customer's own marketing put there, and none of it is needed for attribution:
// Meta uses this field to tell one landing page from another. A URL that is not
// absolute http(s) is dropped entirely rather than sent as a fragment of one.
func sourceURL(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return ""
	}
	parsed, err := url.Parse(trimmed)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return ""
	}
	return (&url.URL{Scheme: parsed.Scheme, Host: parsed.Host, Path: parsed.Path}).String()
}

// ------------------------------------------------------------------------- send

// Send posts a batch of conversions and reports how many Meta accepted.
//
// It is safe to send the same event twice: Meta collapses events that share an
// event_name and an event_id, which is what makes a retry cheaper than a queue.
func (c *Client) Send(ctx context.Context, events ...Event) (int, error) {
	if !c.Enabled() {
		return 0, ErrNotConfigured
	}
	if len(events) == 0 {
		return 0, nil
	}
	if len(events) > maxEventsPerRequest {
		return 0, fmt.Errorf("a conversions batch may hold at most %d events", maxEventsPerRequest)
	}
	payload := wireRequest{
		Data:          make([]wireEvent, 0, len(events)),
		AccessToken:   c.accessToken,
		TestEventCode: c.testEventCode,
	}
	for _, event := range events {
		rendered, err := event.wire()
		if err != nil {
			return 0, err
		}
		payload.Data = append(payload.Data, rendered)
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return 0, err
	}
	endpoint := c.baseURL + "/" + url.PathEscape(c.pixelID) + "/events"
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(encoded))
	if err != nil {
		return 0, err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")
	response, err := c.httpClient.Do(request)
	if err != nil {
		// The wrapped transport error carries the request URL, which holds the
		// pixel id and nothing else. The token is in the body and stays there.
		return 0, fmt.Errorf("meta conversions request: %w", err)
	}
	defer response.Body.Close()
	// A receipt is a few hundred bytes; the limit only stops a misbehaving
	// provider streaming unbounded data into memory.
	responseBody, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return 0, fmt.Errorf("read meta conversions response: %w", err)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return 0, providerFailure(response.StatusCode, responseBody)
	}
	var receipt struct {
		EventsReceived int `json:"events_received"`
	}
	if err := json.Unmarshal(responseBody, &receipt); err != nil {
		return 0, errors.New("meta conversions returned an unreadable response")
	}
	return receipt.EventsReceived, nil
}

// providerFailure names Meta's own reason for the rejection. Nothing we sent is
// repeated back into the error, and nothing we sent was unhashed anyway.
func providerFailure(statusCode int, responseBody []byte) error {
	var failure struct {
		Error struct {
			Message     string `json:"message"`
			Type        string `json:"type"`
			Code        int    `json:"code"`
			Subcode     int    `json:"error_subcode"`
			UserMessage string `json:"error_user_msg"`
		} `json:"error"`
	}
	_ = json.Unmarshal(responseBody, &failure)
	reason := strings.TrimSpace(failure.Error.Message)
	if reason == "" {
		reason = strings.TrimSpace(failure.Error.UserMessage)
	}
	if reason == "" {
		return fmt.Errorf("meta conversions returned status %d", statusCode)
	}
	if len(reason) > maxProviderMessage {
		reason = reason[:maxProviderMessage] + "..."
	}
	// The numeric code is what Meta's own troubleshooting pages are indexed by --
	// 190 is an expired token, 100 a malformed field -- so it is worth carrying.
	if failure.Error.Code != 0 {
		return fmt.Errorf("meta conversions: %s (code %d, subcode %d)", reason, failure.Error.Code, failure.Error.Subcode)
	}
	return fmt.Errorf("meta conversions: %s", reason)
}
