package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// panicHandler stands in for whatever blew up underneath a middleware layer.
func panicHandler() http.Handler {
	return http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		panic("deliberate panic from the server core lane test")
	})
}

func decodeErrorEnvelope(t *testing.T, response *httptest.ResponseRecorder) APIError {
	t.Helper()
	var envelope errorEnvelope
	if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode error envelope: %v (body %q)", err, response.Body.String())
	}
	return envelope.Error
}

func assertSecurityHeaders(t *testing.T, response *httptest.ResponseRecorder, context string) {
	t.Helper()
	expected := map[string]string{
		"X-Content-Type-Options": "nosniff",
		"X-Frame-Options":        "DENY",
		"Referrer-Policy":        "strict-origin-when-cross-origin",
		"Permissions-Policy":     "camera=(), microphone=(), geolocation=()",
	}
	for header, want := range expected {
		if got := response.Header().Get(header); got != want {
			t.Errorf("%s: header %s = %q, want %q", context, header, got, want)
		}
	}
}

// recoverPanic wraps the requestID middleware, so the request it holds when the
// stack unwinds is the one from before the id was placed in the context. The 500
// it wrote therefore carried an empty request_id, which is the single field
// support needs to match a customer report against a log line.
func TestRecoveredPanicResponseCarriesARequestID(t *testing.T) {
	server, _ := newTestServer(t)
	handler := server.middleware(panicHandler())

	request := httptest.NewRequest(http.MethodGet, "/v1/agents", nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500 from a recovered panic, got %d", response.Code)
	}
	apiError := decodeErrorEnvelope(t, response)
	if apiError.Code != "internal_error" {
		t.Fatalf("expected code internal_error, got %q", apiError.Code)
	}
	if apiError.RequestID == "" {
		t.Fatal("recovered panic wrote an error envelope with an empty request_id")
	}
	if header := response.Header().Get("X-Request-ID"); apiError.RequestID != header {
		t.Fatalf("envelope request_id %q does not match the X-Request-ID header %q", apiError.RequestID, header)
	}
}

// The id a caller supplies is the one echoed on the response header, so it has to
// be the one in the body too, otherwise the two records cannot be joined.
func TestRecoveredPanicEchoesTheCallerSuppliedRequestID(t *testing.T) {
	server, _ := newTestServer(t)
	handler := server.middleware(panicHandler())

	request := httptest.NewRequest(http.MethodGet, "/v1/agents", nil)
	request.Header.Set("X-Request-ID", "caller-supplied-trace-id")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if apiError := decodeErrorEnvelope(t, response); apiError.RequestID != "caller-supplied-trace-id" {
		t.Fatalf("expected the caller's id in the envelope, got %q", apiError.RequestID)
	}
}

// writeError is called with a nil request from readiness checks, and from
// recoverPanic with a request whose context predates the id. Both still have the
// id on the response header, and neither may ship an empty request_id.
func TestWriteErrorFallsBackToTheResponseHeaderRequestID(t *testing.T) {
	server, _ := newTestServer(t)
	response := httptest.NewRecorder()
	response.Header().Set("X-Request-ID", "id-set-by-the-middleware")

	server.writeError(response, nil, http.StatusServiceUnavailable, "not_ready", "Storage is unavailable", nil)

	if apiError := decodeErrorEnvelope(t, response); apiError.RequestID != "id-set-by-the-middleware" {
		t.Fatalf("expected the header id in the envelope, got %q", apiError.RequestID)
	}
}

// A panic raised at the position cors and securityHeaders occupy unwinds past the
// layer that sets the security headers, so recoverPanic has to set them itself.
// The chains below place the panic exactly where each of those layers sits.
func TestRecoveredPanicResponseKeepsSecurityHeadersAtEveryDepth(t *testing.T) {
	server, _ := newTestServer(t)
	chains := map[string]http.Handler{
		"below the router":             server.middleware(panicHandler()),
		"at the cors layer":            server.recoverPanic(server.requestID(server.securityHeaders(panicHandler()))),
		"at the securityHeaders layer": server.recoverPanic(server.requestID(panicHandler())),
		"at the requestID layer":       server.recoverPanic(panicHandler()),
	}
	for name, handler := range chains {
		request := httptest.NewRequest(http.MethodGet, "/v1/agents", nil)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)

		if response.Code != http.StatusInternalServerError {
			t.Errorf("panic %s: expected 500, got %d", name, response.Code)
			continue
		}
		assertSecurityHeaders(t, response, "panic "+name)
		if apiError := decodeErrorEnvelope(t, response); apiError.RequestID == "" {
			t.Errorf("panic %s: error envelope has an empty request_id", name)
		}
	}
}

// securityHeaders sits above cors, so a preflight rejected by cors -- which never
// reaches anything below it -- still carries the security headers.
func TestRejectedCORSPreflightCarriesSecurityHeaders(t *testing.T) {
	server, _ := newTestServer(t)
	handler := server.Handler()

	request := httptest.NewRequest(http.MethodOptions, "/v1/agents", nil)
	request.Header.Set("Origin", "https://not-an-allowed-origin.example")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for a disallowed preflight origin, got %d", response.Code)
	}
	assertSecurityHeaders(t, response, "rejected preflight")
	if apiError := decodeErrorEnvelope(t, response); apiError.RequestID == "" {
		t.Error("rejected preflight wrote an error envelope with an empty request_id")
	}
}

// An allowed request must keep both sets of headers: reordering securityHeaders
// above cors must not have cost the CORS response headers.
func TestAllowedCORSRequestKeepsBothHeaderSets(t *testing.T) {
	server, _ := newTestServer(t)
	handler := server.Handler()

	request := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	request.Header.Set("Origin", "http://localhost:3000")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", response.Code)
	}
	assertSecurityHeaders(t, response, "allowed origin")
	if got := response.Header().Get("Access-Control-Allow-Origin"); got != "http://localhost:3000" {
		t.Fatalf("Access-Control-Allow-Origin = %q, want the request origin", got)
	}
}
