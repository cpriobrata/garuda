package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// This script is fetched by every visitor on every customer page, and its
// Cache-Control is only five minutes so a fix reaches embedded sites quickly.
// That combination only works with a validator: without one, every visitor
// re-downloads the whole file every five minutes, and the cost lands on the
// customer's page-speed score rather than ours.

func fetchWidget(t *testing.T, server *Server, acceptEncoding, ifNoneMatch string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(http.MethodGet, "/widget.js", nil)
	if acceptEncoding != "" {
		request.Header.Set("Accept-Encoding", acceptEncoding)
	}
	if ifNoneMatch != "" {
		request.Header.Set("If-None-Match", ifNoneMatch)
	}
	response := httptest.NewRecorder()
	server.widgetScript(response, request)
	return response
}

func TestTheWidgetIsRevalidatableRatherThanRedownloaded(t *testing.T) {
	server, _ := newTestServer(t)

	first := fetchWidget(t, server, "gzip", "")
	if first.Code != http.StatusOK {
		t.Fatalf("first fetch: %d", first.Code)
	}
	tag := first.Header().Get("ETag")
	if tag == "" {
		t.Fatal("the widget was served with no ETag, so every visitor re-downloads it")
	}
	if !strings.HasSuffix(tag, `"`) || !strings.Contains(tag, `"`) {
		t.Errorf("the ETag is not in the quoted form the header requires: %s", tag)
	}

	second := fetchWidget(t, server, "gzip", tag)
	if second.Code != http.StatusNotModified {
		t.Fatalf("a conditional request returned %d, want 304", second.Code)
	}
	if second.Body.Len() != 0 {
		t.Errorf("a 304 carried %d bytes of body", second.Body.Len())
	}
}

// One WEAK tag covers both variants. A strong tag identifies bytes, so the two
// codings would need different ones -- and that breaks through any proxy that
// decompresses, which our own does: it asks upstream for gzip whichever encoding
// the client wanted, decompresses when the client did not, and forwards the
// header it was given. A weak tag asserts semantic equivalence, which is exactly
// the relationship between two codings of one file.
func TestOneWeakTagCoversBothEncodings(t *testing.T) {
	server, _ := newTestServer(t)

	compressed := fetchWidget(t, server, "gzip", "")
	plain := fetchWidget(t, server, "", "")

	if compressed.Header().Get("Content-Encoding") != "gzip" {
		t.Fatal("gzip was advertised and not used")
	}
	if plain.Header().Get("Content-Encoding") != "" {
		t.Fatal("a client that did not ask for gzip was sent gzip")
	}
	tag := compressed.Header().Get("ETag")
	if tag != plain.Header().Get("ETag") {
		t.Fatalf("the two codings carry different tags: %q and %q", tag, plain.Header().Get("ETag"))
	}
	if !strings.HasPrefix(tag, "W/") {
		t.Fatalf("a tag shared between codings must be weak, got %q", tag)
	}
	if compressed.Header().Get("Vary") != "Accept-Encoding" {
		t.Error("Vary is missing, so a shared cache can serve the wrong variant")
	}

	// And it revalidates from either side.
	if code := fetchWidget(t, server, "gzip", tag).Code; code != http.StatusNotModified {
		t.Errorf("gzip revalidation returned %d", code)
	}
	if code := fetchWidget(t, server, "", tag).Code; code != http.StatusNotModified {
		t.Errorf("identity revalidation returned %d", code)
	}
}

// The comparison the spec actually asks for: a list, "*", and a weak prefix that
// intermediaries add on their own.
func TestConditionalRequestsAreMatchedTheWayCachesSendThem(t *testing.T) {
	server, _ := newTestServer(t)
	tag := fetchWidget(t, server, "gzip", "").Header().Get("ETag")

	for name, header := range map[string]string{
		"exact":     tag,
		"in a list": `"something-else", ` + tag,
		"without the weak prefix a cache stripped": strings.TrimPrefix(tag, "W/"),
		"the wildcard":     "*",
		"spaces around it": "  " + tag + "  ",
	} {
		if code := fetchWidget(t, server, "gzip", header).Code; code != http.StatusNotModified {
			t.Errorf("%s: got %d, want 304", name, code)
		}
	}

	for name, header := range map[string]string{
		"a different tag": `"0000000000000000"`,
		"empty":           "",
	} {
		if code := fetchWidget(t, server, "gzip", header).Code; code == http.StatusNotModified {
			t.Errorf("%s: a non-matching validator produced a 304", name)
		}
	}
}

// A client that explicitly refuses gzip gets the real bytes, not a compressed
// body it will not decode.
func TestGzipIsNotForcedOnAClientThatRefusedIt(t *testing.T) {
	server, _ := newTestServer(t)
	response := fetchWidget(t, server, "gzip;q=0", "")
	if response.Header().Get("Content-Encoding") == "gzip" {
		t.Fatal("gzip was sent to a client that set q=0")
	}
	if !strings.Contains(response.Body.String(), "garudaWidgetRuntime") {
		t.Error("the uncompressed body is not the widget")
	}
}
