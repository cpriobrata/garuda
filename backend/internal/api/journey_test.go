package api

import (
	"strings"
	"testing"
	"time"

	"garuda/backend/internal/model"
)

func TestChannelIsResolvedFromWhatTheBrowserActuallySaw(t *testing.T) {
	cases := map[string]struct {
		input   journeySource
		channel string
	}{
		"an ad click is paid however it is tagged": {
			input:   journeySource{Referrer: "https://www.google.com/", GoogleClick: true},
			channel: "paid",
		},
		"a Meta ad click is paid, not social": {
			input:   journeySource{Referrer: "https://l.facebook.com/", MetaClick: true},
			channel: "paid",
		},
		"utm_medium=cpc is paid": {
			input:   journeySource{UTMSource: "google", UTMMedium: "cpc"},
			channel: "paid",
		},
		"a search engine referrer with no tagging is organic": {
			input:   journeySource{Referrer: "https://www.bing.com/search"},
			channel: "organic",
		},
		"a social referrer is social": {
			input:   journeySource{Referrer: "https://www.linkedin.com/feed/"},
			channel: "social",
		},
		"a newsletter is email": {
			input:   journeySource{UTMSource: "mailchimp", UTMMedium: "newsletter"},
			channel: "email",
		},
		"any other site is a referral": {
			input:   journeySource{Referrer: "https://someblog.example/post"},
			channel: "referral",
		},
		"no referrer at all is direct": {
			input:   journeySource{},
			channel: "direct",
		},
	}
	for name, testCase := range cases {
		if got := resolveTrafficSource(testCase.input).Channel; got != testCase.channel {
			t.Errorf("%s: channel = %q, want %q", name, got, testCase.channel)
		}
	}
}

// A referring URL can carry the search someone typed or a path inside a private
// tool. The host answers "where did they come from"; the rest is theirs.
func TestOnlyTheReferrerHostIsKept(t *testing.T) {
	source := resolveTrafficSource(journeySource{
		Referrer: "https://www.google.com/search?q=how+do+i+treat+my+diagnosis",
	})
	if source.ReferrerDomain != "google.com" {
		t.Fatalf("referrer domain = %q, want the bare host", source.ReferrerDomain)
	}
	if strings.Contains(source.ReferrerDomain, "diagnosis") || strings.Contains(source.ReferrerDomain, "?") {
		t.Fatalf("the referring query survived: %q", source.ReferrerDomain)
	}
}

// Knowing a visitor came from a Google ad is the useful part. The id of the
// individual click is not, and it is one more identifier to hold.
func TestTheClickIdItselfIsNeverStored(t *testing.T) {
	source := resolveTrafficSource(journeySource{GoogleClick: true, Referrer: "https://www.google.com/"})
	if source.ClickIDKind != "google" {
		t.Fatalf("click kind = %q", source.ClickIDKind)
	}
	if strings.Contains(source.UTMTerm+source.UTMContent+source.UTMCampaign, "Cj0KCQ") {
		t.Fatal("a click id reached the stored source")
	}
}

// A customer's own URLs can carry an order id, a reset token, or an email in a
// tracking parameter. None of that belongs in a lead record.
func TestPathsKeepNoQueryString(t *testing.T) {
	for _, input := range []string{
		"/reset?token=secret-value",
		"https://customer.example/reset?token=secret-value",
		"/checkout#email=buyer@example.com",
	} {
		if got := cleanPath(input); strings.ContainsAny(got, "?#") {
			t.Errorf("cleanPath(%q) = %q, which still carries a query", input, got)
		}
	}
	if got := cleanPath("pricing"); got != "/pricing" {
		t.Errorf("a relative path was not normalised: %q", got)
	}
}

// A batch usually re-reports the page the visitor is still on with a bigger
// number. Appending each report would produce the same page every fifteen
// seconds and an engaged total that counted the same time repeatedly.
func TestReportingTheSamePageAgainUpdatesItInPlace(t *testing.T) {
	journey := &model.VisitorJourney{}
	now := time.Now().UTC()

	applyJourneyBatch(journey, journeyRequest{Pages: []journeyPage{{Path: "/pricing", Seconds: 10}}}, now)
	applyJourneyBatch(journey, journeyRequest{Pages: []journeyPage{{Path: "/pricing", Seconds: 25}}}, now.Add(15*time.Second))
	applyJourneyBatch(journey, journeyRequest{Pages: []journeyPage{{Path: "/pricing", Seconds: 40}}}, now.Add(30*time.Second))

	if len(journey.Pages) != 1 {
		t.Fatalf("the same page was recorded %d times: %+v", len(journey.Pages), journey.Pages)
	}
	if journey.Pages[0].Seconds != 40 {
		t.Errorf("time on page = %d, want the latest report", journey.Pages[0].Seconds)
	}
	if journey.EngagedSeconds != 40 {
		t.Errorf("engaged time = %d, want 40 -- the same seconds must not be counted twice", journey.EngagedSeconds)
	}
	if journey.PageCount != 1 {
		t.Errorf("page count = %d, want 1", journey.PageCount)
	}
}

// Returning to a page after visiting others is a separate visit. The order is
// the story: pricing, features, pricing again is a buying signal.
func TestReturningToAPageIsANewEntry(t *testing.T) {
	journey := &model.VisitorJourney{}
	now := time.Now().UTC()

	applyJourneyBatch(journey, journeyRequest{Pages: []journeyPage{
		{Path: "/pricing", Seconds: 30},
		{Path: "/features", Seconds: 20},
		{Path: "/pricing", Seconds: 45},
	}}, now)

	if len(journey.Pages) != 3 {
		t.Fatalf("expected three entries in order, got %d: %+v", len(journey.Pages), journey.Pages)
	}
	if journey.Pages[2].Path != "/pricing" {
		t.Errorf("the return visit was collapsed away: %+v", journey.Pages)
	}
	if journey.EngagedSeconds != 95 {
		t.Errorf("engaged time = %d, want 95", journey.EngagedSeconds)
	}
}

// Page views are the highest-volume thing a visitor can make this service store,
// and everything lives in one file that is read back at boot through a size
// limit. An unbounded journey is a way to stop the API starting.
func TestAJourneyIsBoundedAndSaysSoWhenItTruncates(t *testing.T) {
	journey := &model.VisitorJourney{}
	now := time.Now().UTC()

	for batch := 0; batch < 20; batch++ {
		pages := make([]journeyPage, 0, maxJourneyBatch)
		for index := 0; index < maxJourneyBatch; index++ {
			pages = append(pages, journeyPage{Path: "/p" + string(rune('a'+index)) + string(rune('a'+batch)), Seconds: 5})
		}
		applyJourneyBatch(journey, journeyRequest{Pages: pages}, now)
	}

	if len(journey.Pages) != maxJourneyPages {
		t.Fatalf("kept %d pages, want the cap of %d", len(journey.Pages), maxJourneyPages)
	}
	if journey.PageCount != 20*maxJourneyBatch {
		t.Errorf("page count = %d, want every page seen, so the total stays honest after truncation", journey.PageCount)
	}
	// The pages someone read just before deciding to talk are the ones that
	// explain the lead, so the OLDEST are the ones that go.
	payload := publicJourney(journey)
	if payload["pages_truncated"] != true {
		t.Error("a truncated journey does not report itself as truncated")
	}
}

// The referrer that brought somebody to the site is a fact about the visit. A
// later batch reporting an internal navigation must not overwrite it with the
// customer's own domain.
func TestTheArrivalSourceIsNeverOverwrittenByLaterNavigation(t *testing.T) {
	journey := &model.VisitorJourney{}
	now := time.Now().UTC()

	applyJourneyBatch(journey, journeyRequest{
		Source: &journeySource{Referrer: "https://www.google.com/", GoogleClick: true, LandingPath: "/lp/ads"},
	}, now)
	applyJourneyBatch(journey, journeyRequest{
		Source: &journeySource{Referrer: "https://customer.example/pricing"},
	}, now.Add(time.Minute))

	if journey.Source.Channel != "paid" {
		t.Fatalf("channel became %q -- an internal navigation overwrote the arrival", journey.Source.Channel)
	}
	if journey.Source.LandingPath != "/lp/ads" {
		t.Fatalf("landing page became %q", journey.Source.LandingPath)
	}
}

// The question a customer is really asking is whether the page they are paying
// for works on a phone, so the answer comes from the viewport, not a user agent.
func TestDeviceFormComesFromTheViewport(t *testing.T) {
	for width, form := range map[int]string{360: "mobile", 820: "tablet", 1440: "desktop", 0: ""} {
		if got := resolveDeviceProfile(journeyDevice{ViewportWidth: width}).Form; got != form {
			t.Errorf("width %d resolved to %q, want %q", width, got, form)
		}
	}
}

// Region is derived from the browser's time zone rather than an IP lookup: no
// third party on the request path, and nothing stored that the browser did not
// already volunteer. It is approximate and the payload says so.
func TestRegionIsDerivedFromTheTimeZoneAndLabelledApproximate(t *testing.T) {
	profile := resolveDeviceProfile(journeyDevice{Timezone: "Asia/Kolkata", ViewportWidth: 400})
	if profile.Region != "India" {
		t.Errorf("region = %q, want India", profile.Region)
	}
	// A zone absent from the table still resolves to something true.
	if got := regionFromTimezone("Asia/Colombo"); !strings.Contains(got, "Asia") {
		t.Errorf("an unlisted zone resolved to %q", got)
	}
	if regionFromTimezone("") != "" {
		t.Error("a missing time zone invented a region")
	}

	payload := publicJourney(&model.VisitorJourney{Device: profile})
	if payload["region_is_approximate"] != true {
		t.Error("the payload does not carry the caveat, so any consumer of the API loses it")
	}
}

// A broken clock or a forged report must not produce a lead that claims someone
// read the pricing page for nine years.
func TestAnAbsurdTimeOnPageIsClamped(t *testing.T) {
	journey := &model.VisitorJourney{}
	applyJourneyBatch(journey, journeyRequest{Pages: []journeyPage{
		{Path: "/pricing", Seconds: 999_999_999},
		{Path: "/features", Seconds: -50},
	}}, time.Now().UTC())

	if journey.Pages[0].Seconds != maxPageSeconds {
		t.Errorf("time on page = %d, want it clamped to %d", journey.Pages[0].Seconds, maxPageSeconds)
	}
	if journey.Pages[1].Seconds != 0 {
		t.Errorf("a negative time became %d", journey.Pages[1].Seconds)
	}
}

// A title in any language must not be cut in half a character.
func TestTitlesAreTruncatedOnCharacterBoundaries(t *testing.T) {
	long := strings.Repeat("न", maxTitleLength+50)
	journey := &model.VisitorJourney{}
	applyJourneyBatch(journey, journeyRequest{Pages: []journeyPage{{Path: "/p", Title: long}}}, time.Now().UTC())

	stored := journey.Pages[0].Title
	if []rune(stored)[len([]rune(stored))-1] != 'न' {
		t.Fatalf("the title was cut mid-character: %q", stored)
	}
}

// Clone exists so a caller cannot read the pages slice while a live widget's
// next batch appends to it.
func TestJourneyCloneDoesNotShareItsPages(t *testing.T) {
	original := model.VisitorJourney{Pages: []model.PageVisit{{Path: "/pricing"}}}
	cloned := original.Clone()
	cloned.Pages[0].Path = "/mutated"
	if original.Pages[0].Path != "/pricing" {
		t.Fatal("Clone shares the pages slice with live state")
	}
}
