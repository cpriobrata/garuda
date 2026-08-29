package model

import "time"

// The visitor journey: where a lead came from, what they read before they
// spoke, and how long they spent doing it.
//
// This is the part of the product a customer cannot get from their chat log.
// A lead that says "interested in pricing" is worth something; a lead that
// arrived from a Google ad, read the pricing page for two minutes, went to
// case studies, came back to pricing and only then opened the chat is worth
// knowing how to sell to.
//
// EVERYTHING HERE IS BOUNDED, and that is not a detail. The whole product state
// lives in one JSON file that is rewritten on every write and read back at boot
// through a fixed size limit. Page views are the highest-volume thing a visitor
// can cause this service to store, so an unbounded journey is a way for ordinary
// traffic to stop the API from starting. The caps live in the api package beside
// the handler that enforces them.

// VisitorJourney hangs off a Session. A session with no journey behaves exactly
// as sessions did before this existed.
type VisitorJourney struct {
	Source TrafficSource `json:"source"`
	Device DeviceProfile `json:"device"`

	// Pages is in arrival order, oldest first. When the cap is reached the
	// OLDEST entries are dropped rather than the newest: the pages someone read
	// just before deciding to talk are the ones that explain the lead.
	Pages []PageVisit `json:"pages,omitempty"`

	// PageCount is every page the visitor was seen on, including any dropped
	// from Pages, so the total stays honest after truncation.
	PageCount int `json:"page_count,omitempty"`

	// EngagedSeconds is time the tab was actually visible and the page in front
	// of the visitor. A tab left open overnight adds nothing to it.
	EngagedSeconds int `json:"engaged_seconds,omitempty"`

	FirstSeenAt time.Time `json:"first_seen_at"`
	LastSeenAt  time.Time `json:"last_seen_at"`
}

// TrafficSource is how the visitor arrived. Both halves are kept: the raw
// referrer because it is the ground truth, and the derived channel because a
// customer wants "Google Ads" rather than a URL with a click id in it.
type TrafficSource struct {
	// Channel is one of: direct, organic, paid, social, email, referral,
	// internal. Derived on the server so the rule can be corrected without
	// shipping a new widget to every customer website.
	Channel string `json:"channel"`

	// ReferrerDomain is the host only. The full referring URL can carry the
	// search terms or the private path someone came from, which is more than a
	// lead record needs.
	ReferrerDomain string `json:"referrer_domain,omitempty"`

	// LandingPath is the first page of the visit on the customer's own site.
	LandingPath string `json:"landing_path,omitempty"`

	UTMSource   string `json:"utm_source,omitempty"`
	UTMMedium   string `json:"utm_medium,omitempty"`
	UTMCampaign string `json:"utm_campaign,omitempty"`
	UTMTerm     string `json:"utm_term,omitempty"`
	UTMContent  string `json:"utm_content,omitempty"`

	// ClickIDKind names the ad platform that sent the visitor -- "google" for a
	// gclid, "meta" for an fbclid -- without storing the click id itself. The id
	// identifies one ad click and is not needed to attribute a lead to a channel.
	ClickIDKind string `json:"click_id_kind,omitempty"`
}

// DeviceProfile is what the browser will tell anyone who asks, and nothing more.
//
// There is deliberately no IP geolocation here. It would mean a third-party
// lookup per visitor, on the request path, for a country the browser's own time
// zone already implies. Region is derived from the IANA time zone the browser
// reports, and is labelled approximate everywhere it is shown, because that is
// what it is.
type DeviceProfile struct {
	// Form is mobile, tablet or desktop, derived from the viewport width the
	// widget reports rather than from a user-agent string.
	Form string `json:"form,omitempty"`

	Language string `json:"language,omitempty"`
	Timezone string `json:"timezone,omitempty"`

	// Region is the coarse place the time zone implies -- "India", "United
	// Kingdom", "US (Eastern)". Approximate by construction.
	Region string `json:"region,omitempty"`
}

// PageVisit is one page, once. A visitor who returns to a page appears twice,
// because the order is the story.
type PageVisit struct {
	Path  string `json:"path"`
	Title string `json:"title,omitempty"`

	ArrivedAt time.Time `json:"arrived_at"`

	// Seconds is engaged time on this page: the tab visible and focused. It
	// grows as the widget reports more, so the last page of a live visit has a
	// number that is still climbing.
	Seconds int `json:"seconds,omitempty"`
}

// Clone returns a copy that shares no mutable state with the store. Handing out
// the live Pages slice would let a caller read it while a widget's next batch
// appends to it, and a slice read racing an append is a data race in the caller.
func (j VisitorJourney) Clone() VisitorJourney {
	cloned := j
	if j.Pages != nil {
		cloned.Pages = append([]PageVisit(nil), j.Pages...)
	}
	return cloned
}
