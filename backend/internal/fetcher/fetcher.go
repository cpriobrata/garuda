// Package fetcher reads a public web page and returns its readable text, so a
// customer can point Garuda at their own website instead of pasting it in.
//
// THIS IS A SERVER MAKING A REQUEST TO A URL A USER CHOSE, which is the classic
// shape of server-side request forgery. On a VPS that means the cloud metadata
// service, anything else listening on localhost, and every private host on the
// same network are all one URL away. So the guards here are not incidental to
// the feature, they are most of it:
//
//   - HTTPS only. Not http, not file, not gopher, not data.
//   - Every resolved IP is checked against the private, loopback, link-local,
//     multicast and unique-local ranges BEFORE the connection is made -- via a
//     dial-time hook, so a DNS name that resolves to a private address is caught
//     even though the name itself looks public.
//   - Redirects are followed, but each hop is re-checked. A public URL that
//     redirects to 169.254.169.254 is the standard bypass.
//   - No credentials, no cookies, and the response is read through a size cap
//     with a whole-request deadline.
//
// The extractor is deliberately small and forgiving. It is not a browser and
// does not need to be: it strips script, style and markup, keeps the text a
// reader would see, and collapses the whitespace that a hand-written page is
// full of.
package fetcher

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode"
)

const (
	// maxBodyBytes bounds what is read off the wire. A page larger than this is
	// truncated rather than refused: the top of a long page is still useful
	// knowledge, and a customer should not have to explain a size error.
	maxBodyBytes = 3 << 20
	// maxTextChars is what survives extraction, matched to the knowledge-source
	// limit the API already enforces.
	maxTextChars = 100_000

	requestTimeout = 15 * time.Second
	maxRedirects   = 5
)

// ErrBlocked is returned when a URL resolves somewhere it must not reach. It is
// distinguished from an ordinary failure so the API can answer with a message
// that says what is wrong without describing the internal network.
var ErrBlocked = errors.New("this address cannot be fetched")

// Page is what a fetch produced.
type Page struct {
	// FinalURL is where the redirects ended, which is what should be stored:
	// the URL the text actually came from.
	FinalURL string
	Title    string
	Text     string
	// Truncated says the page was longer than the cap, so a customer is told
	// rather than quietly given part of their own site.
	Truncated bool
}

type Client struct {
	http *http.Client
}

func New() *Client {
	dialer := &net.Dialer{Timeout: 5 * time.Second, KeepAlive: 15 * time.Second}
	transport := &http.Transport{
		// The check runs at DIAL time, on the address the resolver actually
		// returned. Checking the hostname instead would be defeated by any name
		// that resolves to a private address, which anyone can create.
		DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
			host, port, err := net.SplitHostPort(address)
			if err != nil {
				return nil, err
			}
			addresses, err := net.DefaultResolver.LookupIPAddr(ctx, host)
			if err != nil {
				return nil, err
			}
			for _, candidate := range addresses {
				if !publicIP(candidate.IP) {
					return nil, fmt.Errorf("%w: %s resolves to a non-public address", ErrBlocked, host)
				}
			}
			// Dial the address that was checked, not the name, so a second
			// resolution cannot return something different from the one approved.
			return dialer.DialContext(ctx, network, net.JoinHostPort(addresses[0].IP.String(), port))
		},
		TLSHandshakeTimeout:   5 * time.Second,
		ResponseHeaderTimeout: 10 * time.Second,
		DisableKeepAlives:     true,
		MaxIdleConns:          2,
	}
	return &Client{
		http: &http.Client{
			Transport: transport,
			Timeout:   requestTimeout,
			CheckRedirect: func(request *http.Request, via []*http.Request) error {
				if len(via) >= maxRedirects {
					return fmt.Errorf("too many redirects")
				}
				// A public URL redirecting to a private one is the standard
				// bypass, so every hop is validated, not just the first.
				return validateURL(request.URL)
			},
		},
	}
}

// Fetch reads the page at rawURL and extracts its text.
func (c *Client) Fetch(ctx context.Context, rawURL string) (Page, error) {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil {
		return Page{}, fmt.Errorf("%w: the address could not be read", ErrBlocked)
	}
	if err := validateURL(parsed); err != nil {
		return Page{}, err
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodGet, parsed.String(), nil)
	if err != nil {
		return Page{}, err
	}
	// Identify honestly. A site that wants to refuse this should be able to.
	request.Header.Set("User-Agent", "GarudaBot/1.0 (+https://garuda.ravan.ai; website knowledge import)")
	request.Header.Set("Accept", "text/html,application/xhtml+xml;q=0.9,text/plain;q=0.8")
	request.Header.Set("Accept-Language", "en;q=0.9,*;q=0.5")

	response, err := c.http.Do(request)
	if err != nil {
		if errors.Is(err, ErrBlocked) || strings.Contains(err.Error(), ErrBlocked.Error()) {
			return Page{}, ErrBlocked
		}
		return Page{}, fmt.Errorf("the page could not be reached")
	}
	defer func() { _ = response.Body.Close() }()

	if response.StatusCode >= 400 {
		return Page{}, fmt.Errorf("the page returned %d", response.StatusCode)
	}
	contentType := strings.ToLower(response.Header.Get("Content-Type"))
	if contentType != "" && !strings.Contains(contentType, "text/html") && !strings.Contains(contentType, "text/plain") && !strings.Contains(contentType, "xhtml") {
		return Page{}, fmt.Errorf("that address is not a web page")
	}

	limited := io.LimitReader(response.Body, maxBodyBytes+1)
	body, err := io.ReadAll(limited)
	if err != nil {
		return Page{}, fmt.Errorf("the page could not be read")
	}
	truncated := len(body) > maxBodyBytes
	if truncated {
		body = body[:maxBodyBytes]
	}

	title, text := extract(string(body))
	if len(text) > maxTextChars {
		text = truncateRunes(text, maxTextChars)
		truncated = true
	}
	if strings.TrimSpace(text) == "" {
		return Page{}, fmt.Errorf("no readable text was found on that page")
	}

	final := parsed.String()
	if response.Request != nil && response.Request.URL != nil {
		final = response.Request.URL.String()
	}
	return Page{FinalURL: final, Title: title, Text: text, Truncated: truncated}, nil
}

func validateURL(parsed *url.URL) error {
	if parsed.Scheme != "https" {
		return fmt.Errorf("%w: only https addresses can be imported", ErrBlocked)
	}
	host := parsed.Hostname()
	if host == "" {
		return fmt.Errorf("%w: the address has no host", ErrBlocked)
	}
	if parsed.User != nil {
		// Credentials in a URL are either a mistake or an attempt to reach
		// something that needs them, and neither should be fetched.
		return fmt.Errorf("%w: the address must not carry credentials", ErrBlocked)
	}
	// A literal IP is checked here as well as at dial time, so an obviously
	// blocked address is refused before any DNS lookup happens at all.
	if ip := net.ParseIP(host); ip != nil && !publicIP(ip) {
		return fmt.Errorf("%w: that address is not public", ErrBlocked)
	}
	return nil
}

// publicIP is the whole allowlist, expressed as a denylist of everything that is
// not routable on the public internet. Written out rather than delegated to a
// library because there is no library here, and because each line is a class of
// SSRF target worth being able to point at.
func publicIP(ip net.IP) bool {
	if ip == nil || ip.IsUnspecified() || ip.IsLoopback() || ip.IsPrivate() ||
		ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() ||
		ip.IsInterfaceLocalMulticast() || ip.IsMulticast() {
		return false
	}
	if v4 := ip.To4(); v4 != nil {
		switch {
		// 100.64.0.0/10, carrier-grade NAT: a cloud provider's own network.
		case v4[0] == 100 && v4[1] >= 64 && v4[1] <= 127:
			return false
		// 192.0.0.0/24 and 192.0.2.0/24, IETF protocol assignments and TEST-NET.
		case v4[0] == 192 && v4[1] == 0 && (v4[2] == 0 || v4[2] == 2):
			return false
		// 198.18.0.0/15, benchmarking.
		case v4[0] == 198 && (v4[1] == 18 || v4[1] == 19):
			return false
		// 240.0.0.0/4, reserved, and 255.255.255.255.
		case v4[0] >= 240:
			return false
		}
		return true
	}
	// From here on the address is IPv6, and the v6 space has several ways to
	// spell a v4 address. Each of them is a way to reach 127.0.0.1 or the
	// metadata service past a check that only looked at the v4 form, so each is
	// unwrapped and re-checked rather than pattern-matched.
	if len(ip) != net.IPv6len {
		return false
	}
	switch {
	// fc00::/7, unique-local. The metadata service is reachable over v6 on some
	// providers, so this is not theoretical.
	case (ip[0] & 0xfe) == 0xfc:
		return false
	// ::ffff:0:0/96, IPv4-mapped. net.IP.To4 already unwraps these, so reaching
	// here means the prefix was present without To4 recognising it.
	case ipHasPrefix(ip, []byte{0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff}):
		return publicIP(ip[12:])
	// 64:ff9b::/96 and 64:ff9b:1::/48, NAT64. A translator will happily carry
	// ::ffff:a9fe:a9fe-shaped traffic to 169.254.169.254.
	case ipHasPrefix(ip, []byte{0x00, 0x64, 0xff, 0x9b}):
		return publicIP(ip[len(ip)-4:])
	// 2002::/16, 6to4, embeds the v4 address in the next four bytes.
	case ip[0] == 0x20 && ip[1] == 0x02:
		return publicIP(ip[2:6])
	// ::/96 IPv4-compatible, deprecated but still routed by some stacks, and
	// ::1 is already caught by IsLoopback above.
	case ipHasPrefix(ip, make([]byte, 12)):
		return publicIP(ip[12:])
	// 100::/64, discard-only. 2001:db8::/32, documentation. 3fff::/20,
	// documentation. 5f00::/16, SRv6. None is a place to fetch a web page from.
	case ipHasPrefix(ip, []byte{0x01, 0x00, 0, 0, 0, 0, 0, 0}):
		return false
	case ip[0] == 0x20 && ip[1] == 0x01 && ip[2] == 0x0d && ip[3] == 0xb8:
		return false
	case ip[0] == 0x3f && (ip[1]&0xf0) == 0xf0:
		return false
	case ip[0] == 0x5f:
		return false
	}
	return true
}

func ipHasPrefix(ip net.IP, prefix []byte) bool {
	if len(ip) < len(prefix) {
		return false
	}
	for index := range prefix {
		if ip[index] != prefix[index] {
			return false
		}
	}
	return true
}

// extract turns HTML into the text a reader would see. It is intentionally not
// a parser: a parser would be a dependency, and this needs to survive the
// malformed markup that real websites are made of rather than reject it.
func extract(document string) (title, text string) {
	title = firstTag(document, "title")

	var builder strings.Builder
	builder.Grow(len(document) / 2)
	depth := 0
	skipping := ""
	for index := 0; index < len(document); index++ {
		character := document[index]
		if character == '<' {
			end := strings.IndexByte(document[index:], '>')
			if end < 0 {
				break
			}
			tag := strings.ToLower(strings.TrimSpace(document[index+1 : index+end]))
			name := tagName(tag)

			// script, style, noscript and template hold code and templates, not
			// prose. Their contents are skipped entirely rather than stripped of
			// markup, which would leave JavaScript in the knowledge base.
			switch {
			case skipping != "":
				if strings.HasPrefix(tag, "/") && name == skipping {
					skipping = ""
				}
			case name == "script", name == "style", name == "noscript", name == "template", name == "svg":
				if !strings.HasSuffix(tag, "/") {
					skipping = name
				}
			// A newline on the OPENING tag only. Emitting one for the closing tag as
			// well gave every list item and every paragraph a blank line after it,
			// which is a token paid for on every reply for no reader benefit.
			case isBlockTag(name) && !strings.HasPrefix(tag, "/"):
				builder.WriteByte('\n')
			}
			index += end
			depth++
			continue
		}
		if skipping != "" {
			continue
		}
		builder.WriteByte(character)
	}
	if depth == 0 {
		// No markup at all: the response was plain text.
		builder.Reset()
		builder.WriteString(document)
	}
	return strings.TrimSpace(decodeEntities(title)), collapse(decodeEntities(builder.String()))
}

func tagName(tag string) string {
	tag = strings.TrimPrefix(tag, "/")
	for index := 0; index < len(tag); index++ {
		if tag[index] == ' ' || tag[index] == '\t' || tag[index] == '\n' || tag[index] == '/' {
			return tag[:index]
		}
	}
	return tag
}

func isBlockTag(name string) bool {
	switch name {
	case "p", "div", "br", "li", "tr", "section", "article", "header", "footer",
		"h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "table", "blockquote", "pre":
		return true
	}
	return false
}

func firstTag(document, name string) string {
	lower := strings.ToLower(document)
	open := strings.Index(lower, "<"+name)
	if open < 0 {
		return ""
	}
	start := strings.IndexByte(document[open:], '>')
	if start < 0 {
		return ""
	}
	start += open + 1
	end := strings.Index(lower[start:], "</"+name)
	if end < 0 {
		return ""
	}
	return strings.TrimSpace(document[start : start+end])
}

// decodeEntities handles the handful that actually appear in prose. A full table
// would be a lot of code to turn &copy; into a character nobody is searching for.
var entities = strings.NewReplacer(
	"&nbsp;", " ", "&amp;", "&", "&lt;", "<", "&gt;", ">",
	"&quot;", `"`, "&#39;", "'", "&apos;", "'", "&rsquo;", "’",
	"&lsquo;", "‘", "&ldquo;", "“", "&rdquo;", "”",
	"&mdash;", "—", "&ndash;", "–", "&hellip;", "…",
	"&pound;", "£", "&euro;", "€", "&copy;", "©",
)

func decodeEntities(value string) string { return entities.Replace(value) }

// collapse turns the whitespace of hand-written HTML into something a model can
// read without paying for a thousand blank lines.
func collapse(value string) string {
	var builder strings.Builder
	builder.Grow(len(value))
	newlines := 0
	spaced := false
	for _, character := range value {
		switch {
		case character == '\n':
			newlines++
			spaced = false
			continue
		case unicode.IsSpace(character):
			spaced = true
			continue
		}
		if builder.Len() > 0 {
			if newlines >= 2 {
				builder.WriteString("\n\n")
			} else if newlines == 1 {
				builder.WriteByte('\n')
			} else if spaced {
				builder.WriteByte(' ')
			}
		}
		newlines, spaced = 0, false
		builder.WriteRune(character)
	}
	return strings.TrimSpace(builder.String())
}

func truncateRunes(value string, limit int) string {
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit])
}
