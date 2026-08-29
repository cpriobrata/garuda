package meta

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// TestEventIDIsStableAndDerivedFromTheLeadID is the dedup test.
//
// If this breaks, every lead is counted twice: the browser pixel reports one
// conversion and this server reports a second one that Meta cannot tell is the
// same event, and the ad account optimises towards a cost per lead that is half
// the truth. The literal below is also what
// frontend/components/analytics/meta-events.ts must produce for the same input.
func TestEventIDIsStableAndDerivedFromTheLeadID(t *testing.T) {
	const leadID = "lead_9f3c1a2b4d5e"
	const expected = "lead_9f3c1a2b4d5e"

	if got := EventID(leadID); got != expected {
		t.Fatalf("event id changed: got %q, want %q", got, expected)
	}
	// Stable: the same lead reported twice must produce the same id, or a retry
	// becomes a second conversion.
	if EventID(leadID) != EventID(leadID) {
		t.Fatal("event id is not stable across calls")
	}
	// Whitespace a caller picked up from a header or a form must not change it.
	if EventID("  "+leadID+"\n") != expected {
		t.Fatalf("event id is sensitive to surrounding whitespace")
	}
	// Distinct leads must never collide, or two conversions become one.
	if EventID("lead_aaa") == EventID("lead_bbb") {
		t.Fatal("two different leads produced the same event id")
	}
	// The whole point: the id that reaches the wire is the derived one.
	event := LeadEvent(leadID, time.Unix(1_700_000_000, 0).UTC(), "", UserData{Email: "a@example.com"})
	rendered, err := event.wire()
	if err != nil {
		t.Fatalf("wire: %v", err)
	}
	if rendered.EventID != expected {
		t.Fatalf("wire event id: got %q, want %q", rendered.EventID, expected)
	}
	if rendered.EventName != EventNameLead {
		t.Fatalf("dedup also needs a matching event_name: got %q", rendered.EventName)
	}
}

func TestNormalizeEmail(t *testing.T) {
	cases := map[string]string{
		"  Person@Example.COM  ": "person@example.com",
		"person@example.com":     "person@example.com",
		"\tPERSON@EXAMPLE.COM\n": "person@example.com",
		// Dots and +tags are NOT stripped: Meta hashes the address as written.
		"first.last+garuda@gmail.com": "first.last+garuda@gmail.com",
		"":                            "",
		"   ":                         "",
	}
	for input, want := range cases {
		if got := NormalizeEmail(input); got != want {
			t.Fatalf("NormalizeEmail(%q): got %q, want %q", input, got, want)
		}
	}
}

func TestNormalizePhone(t *testing.T) {
	cases := map[string]string{
		"+44 7700 900123":    "447700900123",
		"+1 (415) 555-0132":  "14155550132",
		" 44-7700-900123 ":   "447700900123",
		"+91 98765 43210":    "919876543210",
		"tel: +44 7700 9001": "4477009001",
		// Leading zeroes go, per Meta's rule. A bare national number ends up
		// without a country code and will not match -- see NormalizePhone.
		"07700 900123": "7700900123",
		"00447700900":  "447700900",
		"":             "",
		"not a phone":  "",
	}
	for input, want := range cases {
		if got := NormalizePhone(input); got != want {
			t.Fatalf("NormalizePhone(%q): got %q, want %q", input, got, want)
		}
	}
}

func TestNormalizeName(t *testing.T) {
	cases := map[string]string{
		"  Mary  ":     "mary",
		"O'Neill":      "oneill",
		"Smith-Jones":  "smithjones",
		"McDonald Jr.": "mcdonaldjr",
		"Anna-Maria":   "annamaria",
		"Agent 47":     "agent",
		// Accents survive: the hash is over UTF-8 bytes and stripping them would
		// break every name that carries one.
		"Renée":  "renée",
		"ÖZTÜRK": "öztürk",
		"":       "",
		"  ":     "",
	}
	for input, want := range cases {
		if got := NormalizeName(input); got != want {
			t.Fatalf("NormalizeName(%q): got %q, want %q", input, got, want)
		}
	}
}

// TestHashIsLowercaseHexOfTheNormalisedValue pins the exact bytes Meta will
// compare against. The vector is the SHA-256 of "person@example.com".
func TestHashIsLowercaseHexOfTheNormalisedValue(t *testing.T) {
	const want = "542d240129883c019e106e3b1b2d3f3cb3537c43c425364de8e951d5a3083345"
	got := Hash(NormalizeEmail("  Person@Example.COM "))
	if got != want {
		t.Fatalf("hash of the normalised address: got %q, want %q", got, want)
	}
	if got != strings.ToLower(got) || len(got) != 64 {
		t.Fatalf("hash is not 64 lowercase hex characters: %q", got)
	}
	// Same normalised input, same hash, whatever the casing or padding was.
	if Hash(NormalizeEmail("person@example.com")) != want {
		t.Fatal("normalisation did not converge two spellings of one address")
	}
	// The phone and name vectors, pinned the same way.
	if Hash(NormalizePhone("+44 7700 900123")) != "033134b911b137918338415ee3d20a064b24773d36a3b02e8b99fdd3fcd6b4cd" {
		t.Fatal("phone hash changed")
	}
	if Hash(NormalizeName("O'Neill")) != "fa0fd24b2d0175a5c48e1b82f4d707a8a95f5279c4abdc43fa2f19d8e30eb47d" {
		t.Fatal("name hash changed")
	}
	// An absent value must hash to nothing, never to the hash of "".
	if Hash("") != "" {
		t.Fatal("an empty value produced a hash")
	}
}

// TestSendHashesEveryIdentifierAndNeverSendsARawOne is the privacy guarantee:
// the raw email, phone and name must not appear anywhere in the request.
func TestSendHashesEveryIdentifierAndNeverSendsARawOne(t *testing.T) {
	var body []byte
	var path string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path = r.URL.Path
		body, _ = io.ReadAll(r.Body)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"events_received":1,"fbtrace_id":"abc"}`))
	}))
	defer server.Close()

	client := New(server.URL, "1234567890", "EAAtoken", "TEST12345")
	received, err := client.Send(context.Background(), LeadEvent(
		"lead_abc", time.Unix(1_700_000_000, 0).UTC(), "https://shop.example.com/pricing?email=person@example.com#top",
		UserData{Email: "Person@Example.COM", Phone: "+44 7700 900123", FirstName: "Mary", LastName: "O'Neill"},
	))
	if err != nil {
		t.Fatalf("send: %v", err)
	}
	if received != 1 {
		t.Fatalf("events_received: got %d, want 1", received)
	}
	if path != "/1234567890/events" {
		t.Fatalf("endpoint: got %q, want /1234567890/events", path)
	}

	text := string(body)
	for _, raw := range []string{"Person@Example.COM", "person@example.com", "7700 900123", "447700900123", "Mary", "mary", "O'Neill", "oneill"} {
		if strings.Contains(text, raw) {
			t.Fatalf("request body carried an unhashed identifier %q", raw)
		}
	}
	// The query string on the customer's page carried an address. It must have
	// been stripped, not forwarded.
	if strings.Contains(text, "?") || strings.Contains(text, "#top") {
		t.Fatalf("request body carried the page query string or fragment")
	}

	var payload struct {
		Data []struct {
			EventName      string `json:"event_name"`
			EventTime      int64  `json:"event_time"`
			EventID        string `json:"event_id"`
			ActionSource   string `json:"action_source"`
			EventSourceURL string `json:"event_source_url"`
			UserData       struct {
				Email     []string `json:"em"`
				Phone     []string `json:"ph"`
				FirstName []string `json:"fn"`
				LastName  []string `json:"ln"`
			} `json:"user_data"`
		} `json:"data"`
		AccessToken   string `json:"access_token"`
		TestEventCode string `json:"test_event_code"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatalf("decode request body: %v", err)
	}
	if len(payload.Data) != 1 {
		t.Fatalf("data length: got %d, want 1", len(payload.Data))
	}
	event := payload.Data[0]
	if event.EventName != "Lead" || event.ActionSource != "website" {
		t.Fatalf("event shape: name %q, action_source %q", event.EventName, event.ActionSource)
	}
	if event.EventID != "lead_abc" {
		t.Fatalf("event id: got %q", event.EventID)
	}
	if event.EventTime != 1_700_000_000 {
		t.Fatalf("event_time: got %d, want the lead's own time", event.EventTime)
	}
	if event.EventSourceURL != "https://shop.example.com/pricing" {
		t.Fatalf("event_source_url: got %q", event.EventSourceURL)
	}
	if payload.AccessToken != "EAAtoken" {
		t.Fatalf("access token did not travel in the body")
	}
	if payload.TestEventCode != "TEST12345" {
		t.Fatalf("test_event_code: got %q", payload.TestEventCode)
	}
	for label, values := range map[string][]string{
		"em": event.UserData.Email, "ph": event.UserData.Phone,
		"fn": event.UserData.FirstName, "ln": event.UserData.LastName,
	} {
		if len(values) != 1 || len(values[0]) != 64 {
			t.Fatalf("%s is not a single 64-character hash: %v", label, values)
		}
		if values[0] != strings.ToLower(values[0]) {
			t.Fatalf("%s is not lowercase hex: %q", label, values[0])
		}
	}
	if event.UserData.Email[0] != Hash(NormalizeEmail("Person@Example.COM")) {
		t.Fatal("em is not the hash of the normalised email")
	}
	if event.UserData.Phone[0] != Hash(NormalizePhone("+44 7700 900123")) {
		t.Fatal("ph is not the hash of the normalised phone")
	}
}

// TestEnabledIsFalseWithPartialCredentials proves a half-filled .env switches the
// adapter off rather than half-configuring it.
func TestEnabledIsFalseWithPartialCredentials(t *testing.T) {
	cases := []struct {
		name    string
		client  *Client
		enabled bool
	}{
		{"nothing at all", New("", "", "", ""), false},
		{"pixel id but no token", New("", "1234567890", "", ""), false},
		{"token but no pixel id", New("", "", "EAAtoken", ""), false},
		{"whitespace is not a credential", New("", "   ", "  ", ""), false},
		{"test event code alone", New("", "", "", "TEST12345"), false},
		{"a nil client", nil, false},
		{"both halves", New("", "1234567890", "EAAtoken", ""), true},
	}
	for _, testCase := range cases {
		if got := testCase.client.Enabled(); got != testCase.enabled {
			t.Fatalf("%s: Enabled() = %v, want %v", testCase.name, got, testCase.enabled)
		}
	}
	// An unconfigured client must refuse rather than reach the network.
	if _, err := (New("", "1234567890", "", "")).Send(context.Background(), LeadEvent("lead_a", time.Now(), "", UserData{Email: "a@example.com"})); err != ErrNotConfigured {
		t.Fatalf("a partly configured client sent something: %v", err)
	}
}

// TestSendNamesTheProvidersOwnReason keeps a rejection diagnosable. Meta's
// numeric codes are what its troubleshooting pages are indexed by.
func TestSendNamesTheProvidersOwnReason(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":{"message":"Invalid OAuth access token.","type":"OAuthException","code":190,"error_subcode":463}}`))
	}))
	defer server.Close()

	client := New(server.URL, "1234567890", "EAAtoken", "")
	_, err := client.Send(context.Background(), LeadEvent("lead_a", time.Now(), "", UserData{Email: "a@example.com"}))
	if err == nil {
		t.Fatal("a rejection was reported as a success")
	}
	if !strings.Contains(err.Error(), "Invalid OAuth access token.") {
		t.Fatalf("error does not carry the provider's reason: %v", err)
	}
	if !strings.Contains(err.Error(), "190") {
		t.Fatalf("error does not carry the provider's code: %v", err)
	}
	if strings.Contains(err.Error(), "EAAtoken") {
		t.Fatalf("error leaked the access token: %v", err)
	}
}

// TestSendRefusesAnEventWithNothingToMatchOn stops a conversion being reported
// that Meta could never attribute to anybody.
func TestSendRefusesAnEventWithNothingToMatchOn(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("an unmatchable event reached the network")
	}))
	defer server.Close()

	client := New(server.URL, "1234567890", "EAAtoken", "")
	if _, err := client.Send(context.Background(), LeadEvent("lead_a", time.Now(), "", UserData{})); err == nil {
		t.Fatal("an event with no identifier was accepted")
	}
	if _, err := client.Send(context.Background(), Event{EventID: "", OccurredAt: time.Now(), User: UserData{Email: "a@example.com"}}); err == nil {
		t.Fatal("an event with no event id was accepted, which would break dedup")
	}
	if _, err := client.Send(context.Background(), Event{EventID: "lead_a", User: UserData{Email: "a@example.com"}}); err == nil {
		t.Fatal("an event with no time was accepted")
	}
}
