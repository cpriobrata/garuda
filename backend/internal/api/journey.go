package api

import (
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"

	"garuda/backend/internal/model"
)

// Visitor journey tracking: where a lead came from, what they read, how long.
//
// THE CONSTRAINT THAT SHAPES EVERY NUMBER IN THIS FILE. Page views are the
// highest-volume thing a visitor can make this service store, and the whole
// product state is one JSON file rewritten on every write and read back at boot
// through a fixed size limit. An unbounded journey is therefore not a storage
// inefficiency, it is a way for ordinary traffic to stop the API from starting
// -- which is exactly the defect that was just fixed in the lead handler. So
// every field is capped, the page list is capped, the batch is capped, and the
// route is rate limited on top.
//
// WHAT IS DELIBERATELY NOT COLLECTED. No IP geolocation: it would mean a
// third-party lookup per visitor for a country the browser's own time zone
// already implies, and the time zone costs nothing and leaves no trail. No full
// referring URL, only its host -- a referrer can carry search terms or a private
// path. No click id: knowing the visitor came from a Google ad is the useful
// part; the id of the individual click is not. No page query strings beyond the
// campaign parameters, because a customer's own URLs can carry anything.

const (
	// maxJourneyPages is what one session keeps. Fifty pages is a long visit;
	// past that the OLDEST are dropped, because the pages someone read just
	// before they decided to talk are the ones that explain the lead.
	maxJourneyPages = 50
	// maxJourneyBatch is one request's worth. The widget batches every fifteen
	// seconds and on page hide, so a legitimate batch is one or two entries.
	maxJourneyBatch = 20

	maxPathLength     = 512
	maxTitleLength    = 200
	maxCampaignLength = 120
	maxReferrerHost   = 253
	maxTimezoneLength = 64
	maxLanguageLength = 32

	// maxPageSeconds bounds a single page's engaged time at four hours. A number
	// larger than that is a broken clock or a forged report, not a reader.
	maxPageSeconds = 4 * 60 * 60
)

type journeyRequest struct {
	// Source and Device are sent once, on the first batch of a visit. Later
	// batches omit them and the stored values are left alone: a visitor who
	// navigates within the site must not overwrite the referrer that brought
	// them there with the customer's own domain.
	Source *journeySource `json:"source,omitempty"`
	Device *journeyDevice `json:"device,omitempty"`
	Pages  []journeyPage  `json:"pages,omitempty"`
}

type journeySource struct {
	Referrer    string `json:"referrer,omitempty"`
	LandingPath string `json:"landing_path,omitempty"`
	UTMSource   string `json:"utm_source,omitempty"`
	UTMMedium   string `json:"utm_medium,omitempty"`
	UTMCampaign string `json:"utm_campaign,omitempty"`
	UTMTerm     string `json:"utm_term,omitempty"`
	UTMContent  string `json:"utm_content,omitempty"`
	// GoogleClick and MetaClick are booleans, not ids. The widget reports only
	// that the parameter was present.
	GoogleClick bool `json:"google_click,omitempty"`
	MetaClick   bool `json:"meta_click,omitempty"`
}

type journeyDevice struct {
	ViewportWidth int    `json:"viewport_width,omitempty"`
	Language      string `json:"language,omitempty"`
	Timezone      string `json:"timezone,omitempty"`
}

type journeyPage struct {
	Path    string `json:"path"`
	Title   string `json:"title,omitempty"`
	Seconds int    `json:"seconds,omitempty"`
}

// recordVisitorJourney takes one batch from an open widget.
//
// It is the only write on this path, it is small, and it must stay that way:
// this runs while somebody is reading a customer's website, and a slow response
// here is a slow page there.
func (s *Server) recordVisitorJourney(w http.ResponseWriter, r *http.Request) {
	session, authorized := s.authorizeWidgetSession(r)
	if !authorized {
		s.writeError(w, r, http.StatusUnauthorized, "invalid_session", "The widget session is invalid or expired", nil)
		return
	}
	var input journeyRequest
	if !s.decodeJSON(w, r, &input) {
		return
	}
	if len(input.Pages) > maxJourneyBatch {
		s.writeError(w, r, http.StatusUnprocessableEntity, "validation_failed", "Too many page views in one batch", map[string]int{"limit": maxJourneyBatch})
		return
	}

	now := time.Now().UTC()
	err := s.store.Update(func(state *model.State) error {
		for index := range state.Sessions {
			if state.Sessions[index].ID != session.ID {
				continue
			}
			stored := &state.Sessions[index]
			if stored.Journey == nil {
				stored.Journey = &model.VisitorJourney{FirstSeenAt: now}
			}
			applyJourneyBatch(stored.Journey, input, now)
			stored.LastSeenAt = now
			stored.UpdatedAt = now
			break
		}
		return nil
	})
	if err != nil {
		s.storageFailure(w, r, err)
		return
	}
	// The widget does not read this response. Returning no content keeps the
	// reply small on a path that fires every fifteen seconds per open panel.
	w.WriteHeader(http.StatusNoContent)
}

// applyJourneyBatch merges one report into the stored journey. It is separated
// from the handler so the merge rules -- which are the whole substance -- can be
// tested without a request.
func applyJourneyBatch(journey *model.VisitorJourney, input journeyRequest, now time.Time) {
	journey.LastSeenAt = now

	// Source is first-write-wins. The referrer that brought somebody to the site
	// is a fact about the visit, and a later batch reporting an internal
	// navigation must not overwrite it with the customer's own domain.
	if input.Source != nil && journey.Source.Channel == "" {
		journey.Source = resolveTrafficSource(*input.Source)
	}
	if input.Device != nil {
		journey.Device = resolveDeviceProfile(*input.Device)
	}

	for _, page := range input.Pages {
		path := cleanPath(page.Path)
		if path == "" {
			continue
		}
		seconds := page.Seconds
		if seconds < 0 {
			seconds = 0
		}
		if seconds > maxPageSeconds {
			seconds = maxPageSeconds
		}

		// A batch usually re-reports the page the visitor is still on, with a
		// larger number. Updating in place is what makes engaged time climb
		// during a visit instead of the same page appearing every fifteen
		// seconds. Only the LAST entry is a candidate: returning to a page after
		// visiting others is a separate visit and the order is the story.
		if last := len(journey.Pages) - 1; last >= 0 && journey.Pages[last].Path == path {
			if seconds > journey.Pages[last].Seconds {
				journey.EngagedSeconds += seconds - journey.Pages[last].Seconds
				journey.Pages[last].Seconds = seconds
			}
			if journey.Pages[last].Title == "" {
				journey.Pages[last].Title = truncateRunes(page.Title, maxTitleLength)
			}
			continue
		}

		journey.Pages = append(journey.Pages, model.PageVisit{
			Path:      path,
			Title:     truncateRunes(page.Title, maxTitleLength),
			ArrivedAt: now,
			Seconds:   seconds,
		})
		journey.PageCount++
		journey.EngagedSeconds += seconds
	}

	// Drop from the front. PageCount already counted everything, so the total a
	// customer sees stays honest after the oldest pages fall off.
	if len(journey.Pages) > maxJourneyPages {
		journey.Pages = journey.Pages[len(journey.Pages)-maxJourneyPages:]
	}
}

// resolveTrafficSource turns what the browser saw into what a customer wants to
// read. The classification lives here, on the server, so it can be corrected
// without shipping a new widget to every customer website.
func resolveTrafficSource(input journeySource) model.TrafficSource {
	source := model.TrafficSource{
		LandingPath: cleanPath(input.LandingPath),
		UTMSource:   truncateRunes(strings.TrimSpace(input.UTMSource), maxCampaignLength),
		UTMMedium:   truncateRunes(strings.TrimSpace(input.UTMMedium), maxCampaignLength),
		UTMCampaign: truncateRunes(strings.TrimSpace(input.UTMCampaign), maxCampaignLength),
		UTMTerm:     truncateRunes(strings.TrimSpace(input.UTMTerm), maxCampaignLength),
		UTMContent:  truncateRunes(strings.TrimSpace(input.UTMContent), maxCampaignLength),
	}
	switch {
	case input.GoogleClick:
		source.ClickIDKind = "google"
	case input.MetaClick:
		source.ClickIDKind = "meta"
	}

	if host := referrerHost(input.Referrer); host != "" {
		source.ReferrerDomain = host
	}
	source.Channel = classifyChannel(source)
	return source
}

// classifyChannel is the rule a customer actually reads. Order matters: an ad
// click is paid however it is tagged, and a utm_medium is more authoritative
// than a guess from the referring domain.
func classifyChannel(source model.TrafficSource) string {
	medium := strings.ToLower(source.UTMMedium)
	switch {
	case source.ClickIDKind != "":
		return "paid"
	case medium == "cpc", medium == "ppc", medium == "paid", medium == "paidsocial", medium == "paid_social", medium == "display":
		return "paid"
	case medium == "email", medium == "newsletter":
		return "email"
	case medium == "social":
		return "social"
	case medium == "organic":
		return "organic"
	case source.UTMSource != "" || source.UTMCampaign != "":
		return "campaign"
	}

	host := source.ReferrerDomain
	switch {
	case host == "":
		return "direct"
	case isSearchHost(host):
		return "organic"
	case isSocialHost(host):
		return "social"
	default:
		return "referral"
	}
}

// The lists are short and deliberately so: they name the places most website
// traffic actually comes from, and everything else falls through to "referral",
// which is a true answer rather than a wrong one.
func isSearchHost(host string) bool {
	for _, engine := range []string{"google.", "bing.", "duckduckgo.", "yahoo.", "yandex.", "baidu.", "ecosia.", "brave.", "search."} {
		if strings.HasPrefix(host, engine) || strings.Contains(host, "."+engine) {
			return true
		}
	}
	return false
}

func isSocialHost(host string) bool {
	for _, network := range []string{
		"facebook.com", "instagram.com", "linkedin.com", "twitter.com", "x.com", "t.co",
		"youtube.com", "pinterest.com", "reddit.com", "tiktok.com", "whatsapp.com",
		"threads.net", "quora.com", "telegram.org", "snapchat.com",
	} {
		if host == network || strings.HasSuffix(host, "."+network) {
			return true
		}
	}
	return false
}

// referrerHost keeps the host and discards the rest. A referring URL can carry
// the search someone typed or a path inside a private tool; the host is the part
// that answers "where did they come from".
func referrerHost(referrer string) string {
	referrer = strings.TrimSpace(referrer)
	if referrer == "" || len(referrer) > 2000 {
		return ""
	}
	parsed, err := url.Parse(referrer)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return ""
	}
	host := strings.ToLower(parsed.Hostname())
	host = strings.TrimPrefix(host, "www.")
	if len(host) > maxReferrerHost {
		return ""
	}
	return host
}

func resolveDeviceProfile(input journeyDevice) model.DeviceProfile {
	profile := model.DeviceProfile{
		Language: truncateRunes(strings.TrimSpace(input.Language), maxLanguageLength),
		Timezone: truncateRunes(strings.TrimSpace(input.Timezone), maxTimezoneLength),
	}
	// Viewport width, not the user-agent string: the question a customer is
	// really asking is whether the page they are paying for works on a phone.
	switch {
	case input.ViewportWidth <= 0:
		profile.Form = ""
	case input.ViewportWidth < 640:
		profile.Form = "mobile"
	case input.ViewportWidth < 1024:
		profile.Form = "tablet"
	default:
		profile.Form = "desktop"
	}
	profile.Region = regionFromTimezone(profile.Timezone)
	return profile
}

// regionFromTimezone is an approximation and is labelled as one everywhere it is
// shown. It is here rather than an IP lookup because it costs nothing, adds no
// third party to the request path, and is right often enough to be useful --
// which is the honest bar for a field a customer will use to decide where to
// advertise, not to decide anything about a person.
func regionFromTimezone(timezone string) string {
	zone := strings.TrimSpace(timezone)
	if zone == "" {
		return ""
	}
	if named, known := timezoneRegions[zone]; known {
		return named
	}
	// Fall back to the continent the IANA name starts with, which is coarse but
	// never wrong: "Asia/Colombo" is Asia whether or not it is in the table.
	if slash := strings.IndexByte(zone, '/'); slash > 0 {
		continent := zone[:slash]
		switch continent {
		case "Africa", "America", "Antarctica", "Asia", "Atlantic", "Australia", "Europe", "Indian", "Pacific":
			if city := strings.ReplaceAll(zone[slash+1:], "_", " "); city != "" {
				return city + ", " + continent
			}
			return continent
		}
	}
	return ""
}

// The table covers the zones this product's customers and their visitors are
// most likely to be in. Anything absent falls through to the continent, so the
// table is an improvement on the fallback rather than a requirement.
var timezoneRegions = map[string]string{
	"Asia/Kolkata":        "India",
	"Asia/Calcutta":       "India",
	"Asia/Dubai":          "United Arab Emirates",
	"Asia/Karachi":        "Pakistan",
	"Asia/Dhaka":          "Bangladesh",
	"Asia/Singapore":      "Singapore",
	"Asia/Tokyo":          "Japan",
	"Asia/Shanghai":       "China",
	"Asia/Hong_Kong":      "Hong Kong",
	"Asia/Jakarta":        "Indonesia",
	"Asia/Manila":         "Philippines",
	"Europe/London":       "United Kingdom",
	"Europe/Dublin":       "Ireland",
	"Europe/Paris":        "France",
	"Europe/Berlin":       "Germany",
	"Europe/Madrid":       "Spain",
	"Europe/Rome":         "Italy",
	"Europe/Amsterdam":    "Netherlands",
	"Europe/Stockholm":    "Sweden",
	"Europe/Warsaw":       "Poland",
	"Europe/Moscow":       "Russia",
	"America/New_York":    "US (Eastern)",
	"America/Chicago":     "US (Central)",
	"America/Denver":      "US (Mountain)",
	"America/Phoenix":     "US (Arizona)",
	"America/Los_Angeles": "US (Pacific)",
	"America/Toronto":     "Canada (Eastern)",
	"America/Vancouver":   "Canada (Pacific)",
	"America/Sao_Paulo":   "Brazil",
	"America/Mexico_City": "Mexico",
	"Australia/Sydney":    "Australia (East)",
	"Australia/Perth":     "Australia (West)",
	"Pacific/Auckland":    "New Zealand",
	"Africa/Lagos":        "Nigeria",
	"Africa/Johannesburg": "South Africa",
	"Africa/Cairo":        "Egypt",
	"Africa/Nairobi":      "Kenya",
	"UTC":                 "UTC",
}

// cleanPath keeps the path and drops the query. A customer's own URLs can carry
// anything -- an order id, a token in a reset link, an email address in a
// tracking parameter -- and none of that belongs in a lead record.
func cleanPath(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if parsed, err := url.Parse(value); err == nil && parsed.Path != "" {
		value = parsed.Path
	}
	if cut := strings.IndexAny(value, "?#"); cut >= 0 {
		value = value[:cut]
	}
	if !strings.HasPrefix(value, "/") {
		value = "/" + value
	}
	return truncateRunes(value, maxPathLength)
}

// truncateRunes cuts on a character boundary. Cutting on a byte boundary would
// leave half a character at the end of a title in any language that is not
// mostly ASCII, which is most of them.
func truncateRunes(value string, limit int) string {
	value = strings.TrimSpace(value)
	if utf8.RuneCountInString(value) <= limit {
		return value
	}
	runes := []rune(value)
	return string(runes[:limit])
}

// publicJourney is the owner's view. It is a separate shape from the stored one
// so that adding a field to storage is never accidentally a disclosure, and so
// the approximate fields can be labelled as approximate in the payload itself.
func publicJourney(journey *model.VisitorJourney) map[string]any {
	if journey == nil {
		return nil
	}
	pages := make([]map[string]any, 0, len(journey.Pages))
	for _, page := range journey.Pages {
		pages = append(pages, map[string]any{
			"path": page.Path, "title": page.Title,
			"arrived_at": page.ArrivedAt, "seconds": page.Seconds,
		})
	}
	return map[string]any{
		"source": journey.Source,
		"device": journey.Device,
		// region_is_approximate travels with the data rather than living only in
		// the UI, so any consumer of this API inherits the caveat.
		"region_is_approximate": journey.Device.Region != "",
		"pages":                 pages,
		"page_count":            journey.PageCount,
		"pages_truncated":       journey.PageCount > len(journey.Pages),
		"engaged_seconds":       journey.EngagedSeconds,
		"first_seen_at":         journey.FirstSeenAt,
		"last_seen_at":          journey.LastSeenAt,
	}
}
