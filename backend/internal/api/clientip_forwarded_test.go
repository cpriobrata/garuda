package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func forwardedServer(proxies ...string) *Server {
	return &Server{trustedProxies: parseCIDRs(proxies)}
}

func forwardedRequest(peer string, headerLines ...string) *http.Request {
	request := httptest.NewRequest(http.MethodGet, "/x", nil)
	request.RemoteAddr = peer
	for _, line := range headerLines {
		request.Header.Add("X-Forwarded-For", line)
	}
	return request
}

// Some proxies (HAProxy's `option forwardfor`) add their own X-Forwarded-For
// field line instead of appending to the client's. Reading only the first line
// would let a line the attacker sent outrank the one our proxy wrote.
func TestClientIPConsidersEveryForwardedFieldLine(t *testing.T) {
	server := forwardedServer("127.0.0.1")
	request := forwardedRequest("127.0.0.1:9999", "9.9.9.9", "203.0.113.9")
	if got := server.clientIP(request); got != "203.0.113.9" {
		t.Fatalf("expected the proxy-appended address to win, got %q", got)
	}
}

// A long attacker-supplied chain must not push the proxy-appended address out of
// the window. Trimming the wrong end would let an attacker rotate junk to mint a
// fresh rate-limit bucket per request.
func TestClientIPTrimsForwardedChainFromTheFront(t *testing.T) {
	server := forwardedServer("127.0.0.1")
	spoofed := strings.Repeat("8.8.8.8, ", 60)

	first := server.clientIP(forwardedRequest("127.0.0.1:9999", spoofed+"198.51.100.77, 203.0.113.9"))
	if first != "203.0.113.9" {
		t.Fatalf("expected the real client behind a long chain, got %q", first)
	}

	// Same client, attacker rotates its own value: the bucket must not move.
	second := server.clientIP(forwardedRequest("127.0.0.1:9999", spoofed+"198.51.100.78, 203.0.113.9"))
	if second != first {
		t.Fatalf("rate-limit bucket moved for the same client: %q then %q", first, second)
	}
}

// An untrusted peer must never be able to choose its own bucket, however the
// header is shaped.
func TestClientIPIgnoresForwardedFromUntrustedPeer(t *testing.T) {
	server := forwardedServer("10.0.0.0/8")
	request := forwardedRequest("203.0.113.9:5555", "1.2.3.4", "5.6.7.8")
	if got := server.clientIP(request); got != "203.0.113.9" {
		t.Fatalf("expected the peer address, got %q", got)
	}
}

// Proxies emit ip:port and bracketed IPv6 literals; both must resolve.
func TestClientIPNormalizesForwardedHopShapes(t *testing.T) {
	server := forwardedServer("127.0.0.1")
	for _, testCase := range []struct{ header, want string }{
		{"203.0.113.9:41000", "203.0.113.9"},
		{"[2001:db8:1:2::5]:41000", "2001:db8:1:2::/64"},
		{"2001:db8:1:2::5", "2001:db8:1:2::/64"},
	} {
		if got := server.clientIP(forwardedRequest("127.0.0.1:9999", testCase.header)); got != testCase.want {
			t.Errorf("header %q: want %q, got %q", testCase.header, testCase.want, got)
		}
	}
}
