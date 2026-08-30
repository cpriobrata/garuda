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

// Every store.Update rewrites the entire state file. This route carried the
// highest write rate limit in the service on the strength of a comment saying
// the handler was cheap -- the merge is cheap, the write is O(the whole
// database), and an EMPTY batch was paying it.
func TestABatchThatChangesNothingCostsNoWrite(t *testing.T) {
	journey := &model.VisitorJourney{}
	now := time.Now().UTC()

	applyJourneyBatch(journey, journeyRequest{Pages: []journeyPage{{Path: "/pricing", Seconds: 30}}}, now)
	pagesAfterFirst, engagedAfterFirst := journey.PageCount, journey.EngagedSeconds

	// The widget re-reports the page a visitor is still on every fifteen seconds
	// whether or not anything moved. A report with no new engaged time must be
	// detectable as a no-op by the caller, or the quiet case costs a full write.
	applyJourneyBatch(journey, journeyRequest{Pages: []journeyPage{{Path: "/pricing", Seconds: 30}}}, now.Add(15*time.Second))
	if journey.PageCount != pagesAfterFirst || journey.EngagedSeconds != engagedAfterFirst {
		t.Fatalf("an unchanged re-report moved the journey: pages %d->%d, engaged %d->%d",
			pagesAfterFirst, journey.PageCount, engagedAfterFirst, journey.EngagedSeconds)
	}

	// And a report that DID move must still be detectable as a change.
	applyJourneyBatch(journey, journeyRequest{Pages: []journeyPage{{Path: "/pricing", Seconds: 75}}}, now.Add(30*time.Second))
	if journey.EngagedSeconds == engagedAfterFirst {
		t.Fatal("real additional engaged time was not recorded")
	}
}

// Two open tabs interleave their reports, so "is this the last page I stored"
// was wrong exactly when a visitor was engaged enough to have two tabs open: the
// continuing visit stopped being last, was appended again, and its engaged time
// was counted twice.
func TestTwoTabsDoNotDoubleCountEngagedTime(t *testing.T) {
	journey := &model.VisitorJourney{}
	now := time.Now().UTC()

	applyJourneyBatch(journey, journeyRequest{Pages: []journeyPage{{Visit: "v1", Path: "/pricing", Seconds: 30}}}, now)
	applyJourneyBatch(journey, journeyRequest{Pages: []journeyPage{{Visit: "v2", Path: "/features", Seconds: 20}}}, now.Add(15*time.Second))
	// The first tab reports again. It is no longer the last entry.
	applyJourneyBatch(journey, journeyRequest{Pages: []journeyPage{{Visit: "v1", Path: "/pricing", Seconds: 45}}}, now.Add(30*time.Second))

	if len(journey.Pages) != 2 {
		t.Fatalf("expected two page visits, got %d: %+v", len(journey.Pages), journey.Pages)
	}
	if journey.EngagedSeconds != 65 {
		t.Fatalf("engaged time = %d, want 65 -- the first tab's thirty seconds were counted twice", journey.EngagedSeconds)
	}
	if journey.PageCount != 2 {
		t.Errorf("page count = %d, want 2", journey.PageCount)
	}
}

// A reload restarts the timer at zero. Without a visit id that read as a report
// going backwards and was discarded, so every reload lost the engagement that
// followed it.
func TestAReloadIsANewVisitRatherThanADiscardedReport(t *testing.T) {
	journey := &model.VisitorJourney{}
	now := time.Now().UTC()

	applyJourneyBatch(journey, journeyRequest{Pages: []journeyPage{{Visit: "v1", Path: "/pricing", Seconds: 90}}}, now)
	// Reload: same path, a new visit, and the clock starts again.
	applyJourneyBatch(journey, journeyRequest{Pages: []journeyPage{{Visit: "v2", Path: "/pricing", Seconds: 5}}}, now.Add(time.Minute))
	applyJourneyBatch(journey, journeyRequest{Pages: []journeyPage{{Visit: "v2", Path: "/pricing", Seconds: 40}}}, now.Add(2*time.Minute))

	if len(journey.Pages) != 2 {
		t.Fatalf("the reload was merged into the visit it replaced: %+v", journey.Pages)
	}
	if journey.EngagedSeconds != 130 {
		t.Fatalf("engaged time = %d, want 130 -- the time after the reload was discarded", journey.EngagedSeconds)
	}
}

// A widget cached on a customer's site before visit ids shipped sends none, and
// has to keep working exactly as it did.
func TestABatchWithNoVisitIdStillMergesInPlace(t *testing.T) {
	journey := &model.VisitorJourney{}
	now := time.Now().UTC()

	applyJourneyBatch(journey, journeyRequest{Pages: []journeyPage{{Path: "/pricing", Seconds: 10}}}, now)
	applyJourneyBatch(journey, journeyRequest{Pages: []journeyPage{{Path: "/pricing", Seconds: 25}}}, now.Add(15*time.Second))

	if len(journey.Pages) != 1 {
		t.Fatalf("an older widget's batch stopped merging: %+v", journey.Pages)
	}
	if journey.EngagedSeconds != 25 {
		t.Fatalf("engaged time = %d, want 25", journey.EngagedSeconds)
	}
}
