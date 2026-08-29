package outbound

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"syscall"
	"time"
)

// Guard is the SSRF boundary for customer-supplied webhook URLs.
//
// A webhook URL is typed by a customer and then fetched by this server, which
// sits inside our own network. Without a guard that is a request forgery
// primitive: "https://10.0.0.7/admin", "https://169.254.169.254/latest/meta-data"
// or a public hostname whose A record points at 127.0.0.1 would all make the API
// talk to itself on the customer's behalf.
//
// The defence has four independent layers, because each one alone has a hole:
//
//  1. ValidateURL rejects the URL at the moment the customer saves it: scheme,
//     port, credentials, and any address literal or obviously-internal name.
//     This is UX as much as security -- it gives an immediate, readable error --
//     and it is the only layer that can see a scheme downgrade.
//  2. dialContext resolves the hostname itself, discards every address in a
//     blocked range, and then dials the surviving address AS AN IP LITERAL. The
//     connection therefore goes to an address this process checked, not to a name
//     the transport re-resolves after the check.
//  3. Dialer.Control re-checks the address the kernel is actually about to
//     connect to, immediately before connect(2). This layer closes the
//     check-to-connect window for good: it sees the final address no matter how
//     it was obtained, including whichever address Happy Eyeballs picked.
//  4. CheckRedirect re-runs layer 1 on every redirect target, so a public
//     endpoint cannot bounce us to http:// or to an internal name. Layers 2 and 3
//     run again for the redirected connection as well.
//
// DNS REBINDING, the check-to-connect race. DNS is allowed to return a different
// answer a millisecond after we validated it, so any design that resolves,
// approves the NAME, and then hands the NAME to the transport is broken by
// construction: the transport's own lookup is a second, unchecked resolution.
// Layers 2 and 3 remove that second lookup. The address we approve is the address
// we connect to, and Control verifies that at the syscall itself. Two smaller
// consequences are handled with it: keep-alive is disabled, because a pooled
// connection is a cached decision about an address that may since have changed
// hands, and Proxy is explicitly nil, because a proxy would be handed the
// hostname and resolve it somewhere none of this can see.
type Guard struct {
	// allowPrivateDestinations is TESTS ONLY. Nothing in config.Config and no
	// environment variable can reach it; it exists so the delivery tests can post
	// to an httptest server on the loopback interface. Production builds the guard
	// from a zero Options, and TestGuardRejectsPrivateDestinationsByDefault proves
	// the default refuses loopback.
	allowPrivateDestinations bool
	resolver                 *net.Resolver
}

// webhookPort is the only port a customer endpoint may listen on.
//
// Every webhook consumer this feature targets -- Zapier, Make, n8n cloud,
// Pipedream, and every hosted CRM -- terminates TLS on 443. Allowing arbitrary
// ports would turn the delivery worker into a port scanner aimed at whatever
// public host the customer names, for no product benefit.
const webhookPort = "443"

const maxRedirects = 3

// maxURLLength bounds what one endpoint can store.
const maxURLLength = 2048

func newGuard(allowPrivateDestinations bool) *Guard {
	return &Guard{allowPrivateDestinations: allowPrivateDestinations, resolver: net.DefaultResolver}
}

// ErrDestinationBlocked is returned for every address that resolves inside our
// own network, or any other network that is not the public internet.
var ErrDestinationBlocked = invalid("the endpoint URL resolves to an address that is not on the public internet")

// blockedNetworks holds the ranges net.IP's own predicates do not cover. The
// predicates handle loopback, private, link-local, multicast and unspecified;
// these are the rest of the ranges that either reach infrastructure or wrap an
// address from one of those ranges inside an IPv6 form.
//
// ::ffff:0:0/96 is deliberately NOT in this list even though it looks like it
// belongs. net.IPNet.Contains normalises an IPv4-mapped network back to IPv4, so
// that entry becomes 0.0.0.0/0 and silently blocks the entire IPv4 internet.
// checkIP unmaps the address before it gets here, which covers the case properly.
var blockedNetworks = []*net.IPNet{
	mustParseCIDR("0.0.0.0/8"),       // "this network"
	mustParseCIDR("100.64.0.0/10"),   // carrier-grade NAT
	mustParseCIDR("192.0.0.0/24"),    // IETF protocol assignments
	mustParseCIDR("192.0.2.0/24"),    // TEST-NET-1
	mustParseCIDR("192.88.99.0/24"),  // 6to4 relay anycast
	mustParseCIDR("198.18.0.0/15"),   // benchmarking
	mustParseCIDR("198.51.100.0/24"), // TEST-NET-2
	mustParseCIDR("203.0.113.0/24"),  // TEST-NET-3
	mustParseCIDR("240.0.0.0/4"),     // reserved, includes 255.255.255.255
	mustParseCIDR("::/128"),          // unspecified
	mustParseCIDR("64:ff9b::/96"),    // NAT64
	mustParseCIDR("64:ff9b:1::/48"),  // local-use NAT64
	mustParseCIDR("100::/64"),        // discard-only
	mustParseCIDR("2001::/32"),       // Teredo, wraps an IPv4 address
	mustParseCIDR("2001:db8::/32"),   // documentation
	mustParseCIDR("2002::/16"),       // 6to4, wraps an IPv4 address
	mustParseCIDR("fc00::/7"),        // unique local
}

func mustParseCIDR(value string) *net.IPNet {
	_, network, err := net.ParseCIDR(value)
	if err != nil {
		panic("outbound: unparseable blocked network " + value)
	}
	return network
}

// blockedHostSuffixes are names that resolve inside a network rather than on the
// public internet. They are rejected by name so the customer sees the reason,
// including in the deployments where they would also have failed the address
// check a moment later.
var blockedHostSuffixes = []string{".localhost", ".local", ".internal", ".intranet", ".lan", ".home.arpa"}

func (g *Guard) checkIP(address net.IP) error {
	if address == nil {
		return ErrDestinationBlocked
	}
	if g.allowPrivateDestinations {
		return nil
	}
	// Unmap ::ffff:10.0.0.1 to 10.0.0.1 first. The IPv4 predicates below only fire
	// on a four-byte address, so checking the mapped form would wave it straight
	// through.
	if fourByte := address.To4(); fourByte != nil {
		address = fourByte
	}
	if address.IsLoopback() || address.IsPrivate() || address.IsUnspecified() ||
		address.IsLinkLocalUnicast() || address.IsLinkLocalMulticast() ||
		address.IsInterfaceLocalMulticast() || address.IsMulticast() {
		return ErrDestinationBlocked
	}
	for _, network := range blockedNetworks {
		if network.Contains(address) {
			return ErrDestinationBlocked
		}
	}
	return nil
}

// ValidateURL is the check a customer sees. It never opens a connection and never
// resolves a name, so it is safe to run inside a request handler and cannot
// itself be used to probe anything.
func (g *Guard) ValidateURL(raw string) (*url.URL, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil, invalid("an endpoint URL is required")
	}
	if len(trimmed) > maxURLLength {
		return nil, invalidf("the endpoint URL must be %d characters or fewer", maxURLLength)
	}
	if strings.ContainsAny(trimmed, " \t\r\n") {
		return nil, invalid("the endpoint URL must not contain whitespace")
	}
	parsed, err := url.Parse(trimmed)
	if err != nil {
		return nil, invalid("the endpoint URL is not a valid URL")
	}
	secure := strings.EqualFold(parsed.Scheme, "https")
	if !secure && !(g.allowPrivateDestinations && strings.EqualFold(parsed.Scheme, "http")) {
		return nil, invalid("the endpoint URL must use https")
	}
	if parsed.User != nil {
		return nil, invalid("the endpoint URL must not embed credentials")
	}
	if parsed.Fragment != "" {
		return nil, invalid("the endpoint URL must not contain a fragment")
	}
	host := parsed.Hostname()
	if host == "" {
		return nil, invalid("the endpoint URL must include a host")
	}
	if port := parsed.Port(); port != "" && port != webhookPort && !g.allowPrivateDestinations {
		return nil, invalid("the endpoint URL must use the default https port")
	}
	if literal := net.ParseIP(host); literal != nil {
		if err := g.checkIP(literal); err != nil {
			return nil, err
		}
		return parsed, nil
	}
	if g.allowPrivateDestinations {
		return parsed, nil
	}
	lowered := strings.ToLower(strings.TrimSuffix(host, "."))
	if lowered == "localhost" || !strings.Contains(lowered, ".") {
		return nil, ErrDestinationBlocked
	}
	for _, suffix := range blockedHostSuffixes {
		if strings.HasSuffix(lowered, suffix) {
			return nil, ErrDestinationBlocked
		}
	}
	return parsed, nil
}

// ResolvesToPublicAddress is the optional save-time courtesy check. It reports an
// error only when the name resolves and every address it resolves to is blocked,
// so a transient resolver failure never rejects a URL that is actually fine. It
// is NOT a security control: the answer can change a moment later, which is
// exactly what dialContext and Control exist to survive.
func (g *Guard) ResolvesToPublicAddress(ctx context.Context, host string) error {
	if literal := net.ParseIP(host); literal != nil {
		return g.checkIP(literal)
	}
	addresses, err := g.resolver.LookupIPAddr(ctx, host)
	if err != nil || len(addresses) == 0 {
		return nil
	}
	for _, candidate := range addresses {
		if g.checkIP(candidate.IP) == nil {
			return nil
		}
	}
	return ErrDestinationBlocked
}

func (g *Guard) httpClient(timeout time.Duration) *http.Client {
	return &http.Client{
		Timeout:       timeout,
		CheckRedirect: g.checkRedirect,
		Transport: &http.Transport{
			DialContext:           g.dialContext,
			TLSHandshakeTimeout:   10 * time.Second,
			ResponseHeaderTimeout: 15 * time.Second,
			ExpectContinueTimeout: time.Second,
			// A pooled connection is a cached decision about an address that may
			// since have been reassigned, and reusing it would skip both the
			// resolve step and Control. One connection per delivery is cheap at
			// this volume and keeps every send fully checked.
			DisableKeepAlives: true,
			// Deliberately nil, not http.ProxyFromEnvironment. A proxy would be
			// handed the hostname and resolve it somewhere this guard cannot see,
			// which would defeat every layer below.
			Proxy: nil,
		},
	}
}

func (g *Guard) checkRedirect(request *http.Request, via []*http.Request) error {
	if len(via) >= maxRedirects {
		return fmt.Errorf("endpoint redirected more than %d times", maxRedirects)
	}
	if _, err := g.ValidateURL(request.URL.String()); err != nil {
		return fmt.Errorf("redirect refused: %w", err)
	}
	return nil
}

// dialContext resolves the destination itself and connects to a literal address
// it has already approved. See the Guard doc comment for why the name must never
// reach the transport's own resolver.
func (g *Guard) dialContext(ctx context.Context, network, address string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, err
	}
	if port != webhookPort && !g.allowPrivateDestinations {
		return nil, errors.New("webhook deliveries may only use the default https port")
	}
	dialer := &net.Dialer{Timeout: 5 * time.Second, KeepAlive: -1, Control: g.control}
	if literal := net.ParseIP(host); literal != nil {
		if err := g.checkIP(literal); err != nil {
			return nil, err
		}
		return dialer.DialContext(ctx, network, address)
	}
	addresses, err := g.resolver.LookupIPAddr(ctx, host)
	if err != nil {
		return nil, fmt.Errorf("resolve endpoint host: %w", err)
	}
	if len(addresses) == 0 {
		return nil, errors.New("endpoint host does not resolve")
	}
	var lastError error = ErrDestinationBlocked
	for _, candidate := range addresses {
		if err := g.checkIP(candidate.IP); err != nil {
			lastError = err
			continue
		}
		connection, err := dialer.DialContext(ctx, network, net.JoinHostPort(candidate.IP.String(), port))
		if err == nil {
			return connection, nil
		}
		lastError = err
	}
	return nil, lastError
}

// control runs immediately before connect(2), with the address the kernel will
// actually use. It is the last word: whatever produced this address, one inside a
// blocked range never gets a socket.
func (g *Guard) control(_, address string, _ syscall.RawConn) error {
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		return err
	}
	parsed := net.ParseIP(host)
	if parsed == nil {
		return ErrDestinationBlocked
	}
	return g.checkIP(parsed)
}
