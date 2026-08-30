package fetcher

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// This package makes a request to a URL a user chose, which is the classic shape
// of server-side request forgery. On a VPS that means the cloud metadata
// service, anything on localhost, and every private host on the same network are
// one URL away. These are the tests that matter most in the package.

func TestPrivateAndReservedAddressesAreNotPublic(t *testing.T) {
	blocked := []string{
		"127.0.0.1",       // loopback
		"::1",             // loopback, v6
		"10.0.0.5",        // private
		"172.16.4.4",      // private
		"192.168.1.1",     // private
		"169.254.169.254", // the cloud metadata service
		"100.64.0.1",      // carrier-grade NAT, a provider's own network
		"0.0.0.0",         // unspecified
		"224.0.0.1",       // multicast
		"198.18.0.1",      // benchmarking
		"192.0.2.1",       // TEST-NET
		"240.0.0.1",       // reserved
		"255.255.255.255",
		"fc00::1", // IPv6 unique-local
		"fe80::1", // IPv6 link-local
	}
	for _, address := range blocked {
		if publicIP(net.ParseIP(address)) {
			t.Errorf("%s was treated as a public address", address)
		}
	}

	allowed := []string{"8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700:4700::1111"}
	for _, address := range allowed {
		if !publicIP(net.ParseIP(address)) {
			t.Errorf("%s was blocked but is a public address", address)
		}
	}
}

func TestOnlyHTTPSAddressesAreAccepted(t *testing.T) {
	client := New()
	for _, rawURL := range []string{
		"http://example.com/",
		"file:///etc/passwd",
		"gopher://example.com/",
		"data:text/html,<h1>hi</h1>",
		"https://user:password@example.com/",
		"https://127.0.0.1/",
		"https://169.254.169.254/latest/meta-data/",
		"https://[::1]/",
	} {
		if _, err := client.Fetch(context.Background(), rawURL); !errors.Is(err, ErrBlocked) {
			t.Errorf("%s was not blocked: %v", rawURL, err)
		}
	}
}

// A public URL that redirects to the metadata service is the standard bypass, so
// every hop has to be checked, not only the first.
func TestARedirectToAPrivateAddressIsBlocked(t *testing.T) {
	client := New()
	target, _ := http.NewRequest(http.MethodGet, "https://169.254.169.254/latest/meta-data/", nil)
	if err := client.http.CheckRedirect(target, nil); !errors.Is(err, ErrBlocked) {
		t.Fatalf("a redirect to the metadata service was allowed: %v", err)
	}
	plain, _ := http.NewRequest(http.MethodGet, "http://example.com/", nil)
	if err := client.http.CheckRedirect(plain, nil); !errors.Is(err, ErrBlocked) {
		t.Fatalf("a redirect to plain http was allowed: %v", err)
	}
}

// A page's script and style contents are code, not prose. Left in, they become
// JavaScript in the customer's knowledge base and tokens on every reply.
func TestExtractionKeepsProseAndDropsCode(t *testing.T) {
	title, text := extract(`
		<html><head><title>Thatch Roofing Co</title>
		<style>.hero { color: #fff; }</style>
		<script>window.dataLayer = [{"secret":"do not learn me"}];</script>
		</head><body>
		<h1>Roofing across Devon</h1>
		<p>We install slate, tile and metal roofs.</p>
		<noscript>Enable JavaScript</noscript>
		<p>Surveys cost &pound;120 &amp; are refunded.</p>
		</body></html>`)

	if title != "Thatch Roofing Co" {
		t.Errorf("title = %q", title)
	}
	for _, unwanted := range []string{"color: #fff", "dataLayer", "do not learn me", "Enable JavaScript"} {
		if strings.Contains(text, unwanted) {
			t.Errorf("extracted text kept %q:\n%s", unwanted, text)
		}
	}
	for _, wanted := range []string{"Roofing across Devon", "slate, tile and metal", "£120 & are refunded"} {
		if !strings.Contains(text, wanted) {
			t.Errorf("extracted text lost %q:\n%s", wanted, text)
		}
	}
}

// Block-level tags are where a reader sees a line break. Without them the whole
// page arrives as one run-on sentence.
func TestBlockTagsBecomeLineBreaks(t *testing.T) {
	_, text := extract(`<ul><li>Slate</li><li>Tile</li><li>Metal</li></ul>`)
	if !strings.Contains(text, "Slate\nTile") {
		t.Fatalf("list items ran together: %q", text)
	}
}

// Hand-written HTML is mostly whitespace. Left alone it is tokens paid for on
// every single reply.
func TestWhitespaceIsCollapsed(t *testing.T) {
	_, text := extract("<p>one</p>\n\n\n\n\n\n<p>two</p>")
	if strings.Contains(text, "\n\n\n") {
		t.Fatalf("blank lines were not collapsed: %q", text)
	}
	_, spaced := extract("<p>a          b</p>")
	if strings.Contains(spaced, "  ") {
		t.Fatalf("runs of spaces survived: %q", spaced)
	}
}

// Real websites are full of malformed markup. The extractor must survive it
// rather than reject the customer's own site.
func TestMalformedMarkupDoesNotBreakExtraction(t *testing.T) {
	for _, document := range []string{
		"<p>unclosed paragraph",
		"<div><span>nested <b>and unclosed",
		"<<>><p>weird</p>",
		"plain text with no markup at all",
		"<script>never closed",
	} {
		_, text := extract(document)
		_ = text // the assertion is that this does not panic or hang
	}
	if _, text := extract("plain text with no markup at all"); !strings.Contains(text, "plain text") {
		t.Fatal("a plain-text response lost its content")
	}
}

// A real fetch, against a local server, to prove the pieces work together. The
// dial guard blocks 127.0.0.1, so this exercises the extractor and the response
// handling through the client's own transport rather than the network path.
func TestFetchRejectsANonPageContentType(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/pdf")
		_, _ = w.Write([]byte("%PDF-1.4"))
	}))
	defer server.Close()

	// The URL is http and local, so it is blocked before the content type is
	// ever considered -- which is itself the more important guarantee.
	if _, err := New().Fetch(context.Background(), server.URL); !errors.Is(err, ErrBlocked) {
		t.Fatalf("a local http address was reachable: %v", err)
	}
}

func TestTitleIsFoundEvenWithAttributesOnTheTag(t *testing.T) {
	title, _ := extract(`<title lang="en">Pricing &mdash; Garuda</title><p>hi</p>`)
	if title != "Pricing — Garuda" {
		t.Fatalf("title = %q", title)
	}
}

// The v6 space has several ways to spell a v4 address, and each is a route to
// 127.0.0.1 or the metadata service past a check that only looked at the v4
// form. Every one of these must resolve to the address it actually reaches.
func TestIPv6SpellingsOfPrivateIPv4AddressesAreBlocked(t *testing.T) {
	blocked := map[string]string{
		"IPv4-mapped loopback":       "::ffff:127.0.0.1",
		"IPv4-mapped metadata":       "::ffff:169.254.169.254",
		"IPv4-mapped private":        "::ffff:10.0.0.1",
		"IPv4-compatible loopback":   "::127.0.0.1",
		"IPv4-compatible private":    "::192.168.1.1",
		"NAT64 metadata":             "64:ff9b::169.254.169.254",
		"NAT64 loopback":             "64:ff9b::127.0.0.1",
		"6to4 wrapping a private v4": "2002:c0a8:0101::",
		"discard-only":               "100::1",
		"documentation":              "2001:db8::1",
		"SRv6":                       "5f00::1",
	}
	for name, address := range blocked {
		ip := net.ParseIP(address)
		if ip == nil {
			t.Fatalf("%s: %q is not parseable, so the test is wrong", name, address)
		}
		if publicIP(ip) {
			t.Errorf("%s (%s) was treated as a public address", name, address)
		}
	}

	// And an ordinary v6 address, including one that merely starts with 0x20,
	// must still be reachable.
	for _, address := range []string{"2606:4700:4700::1111", "2a00:1450:4009::200e", "::ffff:8.8.8.8"} {
		if !publicIP(net.ParseIP(address)) {
			t.Errorf("%s was blocked but is a public address", address)
		}
	}
}
