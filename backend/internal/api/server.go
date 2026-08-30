package api

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"garuda/backend/internal/alerts"
	"garuda/backend/internal/billing"
	"garuda/backend/internal/composio"
	"garuda/backend/internal/config"
	"garuda/backend/internal/fetcher"
	"garuda/backend/internal/googleauth"
	"garuda/backend/internal/llm"
	"garuda/backend/internal/mailer"
	"garuda/backend/internal/model"
	"garuda/backend/internal/rag"
	"garuda/backend/internal/security"
	"garuda/backend/internal/store"
	"garuda/backend/internal/supabase"
)

//go:embed assets/widget.js
var assets embed.FS

type Server struct {
	cfg            config.Config
	store          store.Store
	llm            *llm.Client
	stripe         *billing.StripeClient
	rag            *rag.Client
	supabase       *supabase.Client
	google         googleIdentityVerifier
	mailer         *mailer.Client
	alerts         *alerts.Notifier
	fetcher        *fetcher.Client
	logger         *slog.Logger
	limiter        *fixedWindowLimiter
	composio       *composio.Client
	trustedProxies []*net.IPNet
}

type googleIdentityVerifier interface {
	Enabled() bool
	Verify(context.Context, string) (googleauth.Claims, error)
}

type Identity struct {
	UserID    string
	AccountID string
	Email     string
	Role      string
}

type contextKey string

const (
	identityKey  contextKey = "identity"
	requestIDKey contextKey = "request_id"
)

type APIError struct {
	Code      string `json:"code"`
	Message   string `json:"message"`
	RequestID string `json:"request_id"`
	Details   any    `json:"details,omitempty"`
}

type errorEnvelope struct {
	Error APIError `json:"error"`
}

type dataEnvelope struct {
	Data any `json:"data"`
	Meta any `json:"meta,omitempty"`
}

func New(cfg config.Config, dataStore store.Store, logger *slog.Logger) *Server {
	supabaseURL := ""
	supabaseAnonKey := ""
	if cfg.AuthMode == "supabase" || cfg.AuthMode == "" && cfg.SupabaseURL != "" {
		supabaseURL = cfg.SupabaseURL
		supabaseAnonKey = cfg.SupabaseAnonKey
	}
	return &Server{
		cfg:      cfg,
		store:    dataStore,
		llm:      llm.New(cfg.LLMBaseURL, cfg.LLMAPIKey, cfg.LLMModel),
		stripe:   billing.NewStripe(cfg.StripeSecretKey, cfg.StripeWebhookSecret, cfg.StripePriceID, cfg.StripeAPIURL, cfg.StripeSuccessURL, cfg.StripeCancelURL),
		rag:      rag.New(cfg.RAGEdgeURL, cfg.RAGBearerToken),
		supabase: supabase.New(supabaseURL, supabaseAnonKey),
		google:   googleauth.New(cfg.GoogleOAuthClientID),
		mailer:   mailer.New(cfg.SendGridAPIKey, cfg.SendGridAPIURL, cfg.SendGridFromEmail, cfg.SendGridFromName, cfg.SendGridReplyTo),
		// WhatsApp is the owner's stated channel; the generic webhook keeps
		// alerting working on a deployment whose WhatsApp credentials have not
		// arrived yet. Neither configured means no alerts and no startup failure.
		fetcher: fetcher.New(),
		alerts: alerts.New(alerts.Options{
			Service: "garuda-api (" + cfg.Environment + ")",
			Transport: alerts.First(
				alerts.NewWhatsApp(alerts.WhatsAppConfig{
					AccessToken:      cfg.AlertWhatsAppToken,
					PhoneNumberID:    cfg.AlertWhatsAppPhoneID,
					Recipient:        cfg.AlertWhatsAppTo,
					BaseURL:          cfg.AlertWhatsAppBaseURL,
					Template:         cfg.AlertWhatsAppTemplate,
					TemplateLanguage: cfg.AlertWhatsAppLanguage,
				}),
				alerts.NewWebhook(alerts.WebhookConfig{URL: cfg.AlertWebhookURL, AuthHeader: cfg.AlertWebhookAuth}),
			),
		}),
		logger:         logger,
		limiter:        newFixedWindowLimiter(),
		composio:       composio.New(cfg.ComposioBaseURL, cfg.ComposioAPIKey),
		trustedProxies: parseCIDRs(cfg.TrustedProxies),
	}
}

func (s *Server) Handler() http.Handler {
	// Outbound webhook delivery runs off the request path, so a customer endpoint
	// that is slow or down never degrades the product.
	s.StartOutboundWebhooks()
	s.StartRetention()
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", s.health)
	mux.HandleFunc("GET /readyz", s.ready)
	mux.HandleFunc("GET /widget.js", s.widgetScript)

	mux.Handle("POST /v1/auth/signup", s.rateLimit("auth.signup", 20, time.Minute, http.HandlerFunc(s.signUp)))
	mux.Handle("POST /v1/auth/login", s.rateLimit("auth.login", 30, time.Minute, http.HandlerFunc(s.login)))
	mux.Handle("POST /v1/auth/refresh", s.rateLimit("auth.refresh", 30, time.Minute, http.HandlerFunc(s.refreshSession)))
	mux.Handle("POST /v1/auth/google", s.rateLimit("auth.google", 20, time.Minute, http.HandlerFunc(s.googleSignIn)))
	mux.Handle("POST /v1/auth/verify-email", s.rateLimit("auth.verify_email", 20, time.Hour, http.HandlerFunc(s.verifyEmail)))
	mux.Handle("POST /v1/auth/resend-verification", s.rateLimit("auth.resend_verification", 5, time.Hour, http.HandlerFunc(s.resendVerification)))
	mux.Handle("POST /v1/auth/forgot-password", s.rateLimit("auth.forgot_password", 10, time.Hour, http.HandlerFunc(s.forgotPassword)))
	mux.Handle("POST /v1/auth/reset-password", s.rateLimit("auth.reset_password", 10, time.Hour, http.HandlerFunc(s.resetPassword)))
	mux.Handle("POST /v1/webhooks/stripe", http.HandlerFunc(s.stripeWebhook))

	mux.Handle("GET /widget/v1/agents/{agentKey}", s.rateLimit("widget.agent_config", 120, time.Minute, http.HandlerFunc(s.widgetAgent)))
	mux.Handle("POST /widget/v1/sessions", s.rateLimit("widget.session_create", 60, time.Minute, http.HandlerFunc(s.createWidgetSession)))
	mux.Handle("POST /widget/v1/sessions/{sessionID}/messages", s.rateLimit("widget.message", 120, time.Minute, http.HandlerFunc(s.widgetMessage)))
	mux.Handle("POST /widget/v1/sessions/{sessionID}/leads", s.rateLimit("widget.lead", 30, time.Minute, http.HandlerFunc(s.widgetLead)))
	mux.Handle("POST /widget/v1/sessions/{sessionID}/reset", s.rateLimit("widget.session_reset", 20, time.Minute, http.HandlerFunc(s.resetWidgetSession)))
	// The handoff link is behind a session token because the resolved wa.me URL
	// carries the owner's personal number; the public bootstrap only says a
	// handoff exists.
	mux.Handle("POST /widget/v1/sessions/{sessionID}/handoff", s.rateLimit("widget.handoff", 20, time.Minute, http.HandlerFunc(s.startWidgetHandoff)))
	// Polled by an open widget panel so a reply typed in the owner's inbox reaches
	// the visitor. Cheap and bounded: it returns only what comes after the id the
	// widget already holds.
	mux.Handle("GET /widget/v1/sessions/{sessionID}/messages", s.rateLimit("widget.poll", 240, time.Minute, http.HandlerFunc(s.pollWidgetMessages)))
	// Journey batches. Higher limit than the other widget routes because the
	// widget reports every fifteen seconds while a page is open, and lower cost
	// per call than any of them: the handler does one bounded merge.
	mux.Handle("POST /widget/v1/sessions/{sessionID}/activity", s.rateLimit("widget.activity", 240, time.Minute, http.HandlerFunc(s.recordVisitorJourney)))
	// Appointment booking. Both calls reach the customer's own calendar through
	// Composio, so they are capped far tighter than the routes that only touch
	// state we own -- and the booking call writes to a real person's diary.
	mux.Handle("GET /widget/v1/sessions/{sessionID}/slots", s.rateLimit("widget.slots", 30, time.Minute, http.HandlerFunc(s.listBookingSlots)))
	mux.Handle("POST /widget/v1/sessions/{sessionID}/booking", s.rateLimit("widget.booking", 10, time.Minute, http.HandlerFunc(s.createBooking)))

	protected := func(pattern string, handler http.HandlerFunc) {
		mux.Handle(pattern, s.requireAuth(handler))
	}
	// protectedLimited is protected() plus a per-IP quota. Authenticated routes that
	// reach a paid provider must never be unmetered: without this an account can loop
	// requests against the shared model key.
	protectedLimited := func(pattern, bucket string, limit int, window time.Duration, handler http.HandlerFunc) {
		// requireAuth OUTSIDE the limiter: an unauthenticated request must be rejected
		// without consuming quota, or anyone could spend a real user's allowance from
		// the same address without ever holding a credential.
		mux.Handle(pattern, s.requireAuth(s.rateLimit(bucket, limit, window, handler)))
	}
	protected("GET /v1/me", s.me)
	protected("POST /v1/auth/google/link", s.googleLink)
	protected("PATCH /v1/profile", s.updateProfile)
	protected("GET /v1/onboarding/questions", s.onboardingQuestions)
	protected("GET /v1/onboarding", s.getOnboarding)
	protected("PUT /v1/onboarding", s.saveOnboarding)
	protectedLimited("POST /v1/onboarding/messages", "onboarding.message", 120, time.Minute, s.onboardingMessage)
	protected("POST /v1/onboarding/complete", s.completeOnboarding)

	// Voice onboarding: the owner talks about their business instead of typing.
	// Transcription is billed per minute, so the POST is capped tightly and the
	// handler additionally enforces a per-account hourly audio budget.
	protected("GET /v1/onboarding/voice", s.getVoiceOnboarding)
	protectedLimited("POST /v1/onboarding/voice/transcribe", "onboarding.voice.transcribe", 12, time.Hour, s.transcribeVoiceOnboarding)
	protected("PUT /v1/onboarding/voice/details", s.saveVoiceOnboardingDetails)
	protected("GET /v1/jobs/{jobID}", s.getJob)
	protected("GET /v1/agents", s.listAgents)
	protected("POST /v1/agents", s.createAgent)
	protectedLimited("POST /v1/agents/generate", "agents.generate", 20, time.Hour, s.generateAgent)
	protected("GET /v1/agents/{agentID}", s.getAgent)
	protected("PATCH /v1/agents/{agentID}", s.updateAgent)
	protected("DELETE /v1/agents/{agentID}", s.archiveAgent)
	protected("POST /v1/agents/{agentID}/publish", s.publishAgent)
	protected("POST /v1/agents/{agentID}/unpublish", s.unpublishAgent)
	protectedLimited("POST /v1/agents/{agentID}/preview/messages", "agents.preview", 60, time.Minute, s.previewAgentMessage)
	protected("GET /v1/agents/{agentID}/embed", s.agentEmbed)
	protected("GET /v1/agents/{agentID}/sources", s.listKnowledgeSources)
	protected("POST /v1/agents/{agentID}/sources", s.createKnowledgeSource)
	// Reading a page is a network call to an address the customer chose, so it
	// is capped far tighter than the routes that only touch our own state.
	protectedLimited("POST /v1/agents/{agentID}/sources/fetch", "sources.fetch", 20, time.Hour, s.fetchKnowledgeSource)
	protected("DELETE /v1/agents/{agentID}/sources/{sourceID}", s.deleteKnowledgeSource)
	protected("GET /v1/dashboard", s.dashboard)
	protected("GET /v1/integrations/catalog", s.listIntegrationCatalog)
	protected("GET /v1/integrations/categories", s.listIntegrationCategories)
	protected("GET /v1/integrations/connections", s.listIntegrationConnections)
	protectedLimited("POST /v1/integrations/connections", "integrations.connect", 30, time.Minute, s.connectIntegration)
	protected("DELETE /v1/integrations/connections/{connectionID}", s.disconnectIntegration)

	// In-app billing: everything the hosted Stripe portal used to do.
	protectedLimited("GET /v1/billing/invoices", "billing.invoices", 60, time.Minute, s.listBillingInvoices)
	protectedLimited("GET /v1/billing/payment-methods", "billing.payment_methods", 60, time.Minute, s.listBillingPaymentMethods)
	protectedLimited("POST /v1/billing/payment-methods/setup-intent", "billing.setup_intent", 20, time.Minute, s.createBillingSetupIntent)
	protectedLimited("POST /v1/billing/payment-methods/default", "billing.default_payment_method", 20, time.Minute, s.setDefaultBillingPaymentMethod)
	protectedLimited("GET /v1/billing/subscription/detail", "billing.subscription_detail", 60, time.Minute, s.getBillingSubscriptionDetail)
	protectedLimited("POST /v1/billing/subscription/cancel", "billing.subscription_cancel", 20, time.Minute, s.cancelBillingSubscription)
	protectedLimited("POST /v1/billing/subscription/resume", "billing.subscription_resume", 20, time.Minute, s.resumeBillingSubscription)

	// Lead export and manual capture.
	protectedLimited("GET /v1/leads/export", "leads.export", 30, time.Minute, s.exportLeads)
	protectedLimited("POST /v1/leads", "leads.create", 60, time.Minute, s.createLead)

	// Pause a published agent without archiving it.
	protected("POST /v1/agents/{agentID}/pause", s.pauseAgent)
	protected("POST /v1/agents/{agentID}/unpause", s.unpauseAgent)

	// Outbound webhooks: the CRM path that needs no per-provider integration.
	protected("GET /v1/integrations/events", s.listIntegrationEvents)
	protected("GET /v1/integrations/webhooks", s.listWebhookEndpoints)
	protectedLimited("POST /v1/integrations/webhooks", "integrations.webhook_create", 30, time.Hour, s.createWebhookEndpoint)
	protectedLimited("PATCH /v1/integrations/webhooks/{endpointID}", "integrations.webhook_update", 60, time.Hour, s.updateWebhookEndpoint)
	protected("DELETE /v1/integrations/webhooks/{endpointID}", s.deleteWebhookEndpoint)
	protectedLimited("POST /v1/integrations/webhooks/{endpointID}/secret", "integrations.webhook_rotate", 20, time.Hour, s.rotateWebhookSecret)
	protectedLimited("POST /v1/integrations/webhooks/{endpointID}/test", "integrations.webhook_test", 30, time.Hour, s.sendWebhookTestEvent)
	protected("GET /v1/integrations/webhooks/{endpointID}/deliveries", s.listWebhookDeliveries)
	protected("GET /v1/analytics/overview", s.analyticsOverview)
	protected("GET /v1/leads", s.listLeads)
	protected("GET /v1/leads/{leadID}", s.getLead)
	protected("PATCH /v1/leads/{leadID}", s.updateLead)
	protected("GET /v1/conversations", s.listConversations)
	protected("GET /v1/conversations/{sessionID}", s.getConversation)
	protectedLimited("POST /v1/conversations/{sessionID}/messages", "conversations.reply", 120, time.Minute, s.postTeamReply)
	protected("GET /v1/billing/subscription", s.getSubscription)
	protected("POST /v1/billing/checkout", s.createCheckout)
	protected("POST /v1/billing/checkout-sessions", s.createCheckout)
	protected("POST /v1/billing/portal", s.createBillingPortal)
	protected("POST /v1/billing/portal-sessions", s.createBillingPortal)
	protected("POST /v1/billing/demo/complete", s.completeDemoCheckout)

	return s.middleware(mux)
}

func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	s.writeData(w, http.StatusOK, map[string]any{"status": "ok", "service": "garuda-api", "time": time.Now().UTC()})
}

func (s *Server) ready(w http.ResponseWriter, _ *http.Request) {
	if err := s.store.View(func(_ *model.State) error { return nil }); err != nil {
		s.writeError(w, nil, http.StatusServiceUnavailable, "not_ready", "Storage is unavailable", nil)
		return
	}
	s.writeData(w, http.StatusOK, map[string]string{"status": "ready"})
}

// widgetAsset caches the embedded widget and its gzip encoding. The bytes are
// immutable for the life of the process, so compressing once at first request
// costs nothing per request afterwards.
var widgetAsset struct {
	once    sync.Once
	raw     []byte
	gzipped []byte
	etag    string
	readErr error
}

func loadWidgetAsset() ([]byte, []byte, error) {
	widgetAsset.once.Do(func() {
		content, err := assets.ReadFile("assets/widget.js")
		if err != nil {
			widgetAsset.readErr = err
			return
		}
		widgetAsset.raw = content
		var buffer bytes.Buffer
		writer, err := gzip.NewWriterLevel(&buffer, gzip.BestCompression)
		if err != nil {
			return
		}
		if _, err := writer.Write(content); err != nil {
			return
		}
		if err := writer.Close(); err != nil {
			return
		}
		widgetAsset.gzipped = buffer.Bytes()
		// Computed once, from the bytes themselves, so the tag changes exactly when
		// the widget does and never when it does not.
		widgetAsset.etag = weakDigest(content)
	})
	return widgetAsset.raw, widgetAsset.gzipped, widgetAsset.readErr
}

func (s *Server) widgetScript(w http.ResponseWriter, r *http.Request) {
	raw, gzipped, err := loadWidgetAsset()
	if err != nil {
		s.writeError(w, r, http.StatusInternalServerError, "asset_unavailable", "Widget asset is unavailable", nil)
		return
	}
	w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
	// Five minutes, so a widget fix reaches every embedded site quickly. That
	// short a life only works because of the ETag below: without one, every
	// visitor re-downloads the whole file every five minutes, and that cost lands
	// on the customer's page-speed score rather than ours. With one, a
	// revalidation is a few hundred bytes and a 304.
	w.Header().Set("Cache-Control", "public, max-age=300")
	w.Header().Set("ETag", widgetAsset.etag)
	w.Header().Set("Vary", "Accept-Encoding")

	// A WEAK validator, shared by both variants, and deliberately so.
	//
	// A strong tag identifies bytes, so the gzipped and identity forms would need
	// different ones -- and that breaks the moment anything between here and the
	// browser decompresses. Our own proxy does exactly that: Go's transport asks
	// upstream for gzip whichever encoding the client wanted, decompresses when
	// the client did not, and forwards the header it was given, so an identity
	// body arrives labelled with the gzipped bytes' tag.
	//
	// A weak tag asserts semantic equivalence rather than byte equality, which is
	// exactly the relationship between two content codings of one file, and is
	// what the spec has weak validators for. One tag, correct through any proxy.
	useGzip := len(gzipped) > 0 && acceptsGzip(r.Header.Get("Accept-Encoding"))

	if matchesETag(r.Header.Get("If-None-Match"), widgetAsset.etag) {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	if useGzip {
		w.Header().Set("Content-Encoding", "gzip")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(gzipped)
		return
	}
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(raw)
}

// matchesETag implements the If-None-Match comparison the spec actually asks
// for: a comma-separated list, "*" matching anything, and a weak comparison, so
// a cache that added a W/ prefix still gets its 304.
func matchesETag(header, tag string) bool {
	if header == "" || tag == "" {
		return false
	}
	for _, candidate := range strings.Split(header, ",") {
		candidate = strings.TrimSpace(candidate)
		if candidate == "*" {
			return true
		}
		if strings.TrimPrefix(candidate, "W/") == strings.TrimPrefix(tag, "W/") {
			return true
		}
	}
	return false
}

// acceptsGzip reports whether the client advertised gzip without explicitly
// disabling it via "gzip;q=0".
func acceptsGzip(header string) bool {
	for _, part := range strings.Split(header, ",") {
		fields := strings.Split(strings.TrimSpace(part), ";")
		if !strings.EqualFold(strings.TrimSpace(fields[0]), "gzip") {
			continue
		}
		for _, parameter := range fields[1:] {
			parameter = strings.ReplaceAll(strings.TrimSpace(parameter), " ", "")
			if strings.EqualFold(parameter, "q=0") || strings.EqualFold(parameter, "q=0.0") || strings.EqualFold(parameter, "q=0.00") {
				return false
			}
		}
		return true
	}
	return false
}

// middleware wraps the router. Order matters in two directions: an outer layer
// sees panics raised by every layer below it, and a layer that sets response
// headers before delegating hands those headers to everything below it.
//
// recoverPanic stays outermost so a panic anywhere -- including inside requestID,
// securityHeaders or cors -- becomes an error envelope instead of a dropped
// connection. requestID comes next so every layer below it, and every log line,
// has an id to quote. securityHeaders moved ABOVE cors: it sets its headers and
// then delegates, so putting it higher means a cors preflight rejection, and a
// response written while unwinding a panic out of cors, both carry them. Because
// recoverPanic is above securityHeaders it cannot rely on that alone, so it sets
// the same headers itself before writing.
func (s *Server) middleware(next http.Handler) http.Handler {
	return s.recoverPanic(s.requestID(s.securityHeaders(s.cors(s.accessLog(next)))))
}

func (s *Server) requestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestID := strings.TrimSpace(r.Header.Get("X-Request-ID"))
		if requestID == "" || len(requestID) > 128 {
			requestID, _ = security.RandomToken(12)
		}
		w.Header().Set("X-Request-ID", requestID)
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), requestIDKey, requestID)))
	})
}

func (s *Server) cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		widgetRequest := strings.HasPrefix(r.URL.Path, "/widget/v1/") || r.URL.Path == "/widget.js"
		widgetOrigin := widgetRequest && validOriginSyntax(origin)
		if origin != "" && (s.originAllowed(origin) || widgetOrigin) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			if !widgetRequest {
				w.Header().Set("Access-Control-Allow-Credentials", "true")
			}
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, Idempotency-Key, If-Match, X-Organization-ID, X-Request-ID, X-Garuda-Session-Token")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Max-Age", "600")
		}
		if r.Method == http.MethodOptions {
			if origin != "" && !s.originAllowed(origin) && !widgetOrigin {
				s.writeError(w, r, http.StatusForbidden, "origin_not_allowed", "This origin is not allowed", nil)
				return
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func validOriginSyntax(origin string) bool {
	if origin == "" || strings.ContainsAny(origin, "\r\n") {
		return false
	}
	parsed, err := url.Parse(origin)
	return err == nil && (parsed.Scheme == "http" || parsed.Scheme == "https") && parsed.Host != "" && parsed.Path == "" && parsed.RawQuery == "" && parsed.Fragment == ""
}

func (s *Server) originAllowed(origin string) bool {
	if strings.HasPrefix(origin, "http://localhost:") || strings.HasPrefix(origin, "http://127.0.0.1:") {
		return s.cfg.DemoMode
	}
	for _, allowed := range s.cfg.AllowedOrigins {
		if allowed == "*" || strings.EqualFold(allowed, origin) {
			return true
		}
	}
	return false
}

func (s *Server) securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		applySecurityHeaders(w.Header())
		applyTransportSecurity(w.Header(), r)
		next.ServeHTTP(w, r)
	})
}

// applyTransportSecurity pins this host to HTTPS in every browser that has seen
// it once. Access tokens, session tokens and lead data all travel over this
// origin, and without HSTS the first request of a session -- the one a visitor
// makes by typing the host, or following an old http link -- is downgradeable.
//
// It is sent ONLY over TLS, which is what the spec requires and also what keeps
// it from pinning a developer's localhost to a scheme it does not serve. Two
// years, subdomains included, and deliberately not preloaded: preload is a list
// that is slow to leave, and it should be a decision rather than a side effect.
func applyTransportSecurity(header http.Header, r *http.Request) {
	secure := r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https")
	if !secure {
		return
	}
	header.Set("Strict-Transport-Security", "max-age=63072000; includeSubDomains")
}

// applySecurityHeaders holds the set every response must carry. It is shared with
// recoverPanic, which runs above the securityHeaders middleware and therefore
// cannot assume that middleware was reached before the panic.
func applySecurityHeaders(header http.Header) {
	header.Set("X-Content-Type-Options", "nosniff")
	header.Set("X-Frame-Options", "DENY")
	header.Set("Referrer-Policy", "strict-origin-when-cross-origin")
	header.Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
}

type responseRecorder struct {
	http.ResponseWriter
	status int
}

func (r *responseRecorder) Flush() {
	if flusher, ok := r.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

func (r *responseRecorder) WriteHeader(status int) {
	r.status = status
	r.ResponseWriter.WriteHeader(status)
}

func (s *Server) accessLog(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		recorder := &responseRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(recorder, r)
		s.logger.Info("request", "method", r.Method, "path", r.URL.Path, "status", recorder.status, "duration_ms", time.Since(started).Milliseconds(), "request_id", requestID(r.Context()))
		// Only server faults page a human. A 404, a 401 or a 422 is the service
		// working correctly and telling somebody so.
		if recorder.status >= 500 {
			s.alerts.Notify(alerts.Alert{
				Kind: "http_5xx", Where: safeRoute(r), Status: recorder.status,
				RequestID: requestID(r.Context()),
			})
		}
	})
}

func (s *Server) recoverPanic(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if recovered := recover(); recovered != nil {
				// This handler holds the request as it was BEFORE the requestID
				// middleware derived a new one carrying the id, so r.Context() has no id
				// to give. Take it from the response header instead, which is the value
				// the caller sees and quotes back to support, and mint one if the panic
				// happened before requestID ran at all. A 500 without an id is the one
				// response nobody can correlate with a log line.
				identifier := ensureRequestIDHeader(w)
				// securityHeaders sits below this handler, so it may never have run.
				applySecurityHeaders(w.Header())
				// The access log lives below here too, and the panic unwound past it, so
				// this line is the only record of the request that failed.
				s.logger.Error("panic recovered", "error", recovered, "method", r.Method, "path", r.URL.Path, "request_id", identifier)
				// The route PATTERN, not r.URL.Path: a path carries ids, and an id in
				// an alert is personal data sitting in somebody's phone.
				s.alerts.Notify(alerts.Alert{
					Kind: "panic", Where: safeRoute(r), Status: http.StatusInternalServerError,
					Detail: fmt.Sprint(recovered), RequestID: identifier,
				})
				s.writeError(w, r, http.StatusInternalServerError, "internal_error", "An unexpected error occurred", nil)
			}
		}()
		next.ServeHTTP(w, r)
	})
}

// ensureRequestIDHeader returns the id already promised to the caller on the
// response, minting and setting one when the request failed before the requestID
// middleware could.
func ensureRequestIDHeader(w http.ResponseWriter) string {
	identifier := w.Header().Get("X-Request-ID")
	if identifier != "" {
		return identifier
	}
	identifier, err := security.RandomToken(12)
	if err != nil || identifier == "" {
		return ""
	}
	w.Header().Set("X-Request-ID", identifier)
	return identifier
}

func (s *Server) requireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authorization := strings.TrimSpace(r.Header.Get("Authorization"))
		if !strings.HasPrefix(strings.ToLower(authorization), "bearer ") {
			s.writeError(w, r, http.StatusUnauthorized, "unauthorized", "A bearer access token is required", nil)
			return
		}
		token := strings.TrimSpace(authorization[7:])
		identity, err := s.authenticate(r.Context(), token)
		if err != nil {
			s.writeError(w, r, http.StatusUnauthorized, "invalid_token", "The access token is invalid or expired", nil)
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), identityKey, identity)))
	})
}

func (s *Server) authenticate(ctx context.Context, token string) (Identity, error) {
	if !s.supabase.Enabled() || s.google.Enabled() {
		claims, localErr := security.VerifyJWT([]byte(s.cfg.JWTSecret), token, time.Now())
		if localErr == nil {
			var found bool
			_ = s.store.View(func(state *model.State) error {
				for _, user := range state.Users {
					if user.ID == claims.Subject && user.AccountID == claims.AccountID && user.AuthVersion == claims.AuthVersion {
						found = true
						break
					}
				}
				return nil
			})
			if found {
				return Identity{UserID: claims.Subject, AccountID: claims.AccountID, Email: claims.Email, Role: claims.Role}, nil
			}
			return Identity{}, errors.New("local token has no valid Garuda membership")
		}
		if !s.supabase.Enabled() {
			return Identity{}, errors.New("invalid local token")
		}
	}
	externalUser, err := s.supabase.User(ctx, token)
	if err != nil {
		return Identity{}, err
	}
	// A blank subject must never match. Users created through local auth carry an
	// empty ExternalAuthID, so a provider response without an id would otherwise
	// authenticate the caller as the first such account.
	if strings.TrimSpace(externalUser.ID) == "" {
		return Identity{}, errors.New("authentication provider returned no subject")
	}
	var identity Identity
	err = s.store.View(func(state *model.State) error {
		for _, user := range state.Users {
			if user.ExternalAuthID == externalUser.ID {
				identity = Identity{UserID: user.ID, AccountID: user.AccountID, Email: user.Email, Role: user.Role}
				return nil
			}
		}
		return errors.New("Supabase user has no Garuda membership")
	})
	return identity, err
}

func identityFrom(ctx context.Context) Identity {
	identity, _ := ctx.Value(identityKey).(Identity)
	return identity
}

func requestID(ctx context.Context) string {
	value, _ := ctx.Value(requestIDKey).(string)
	return value
}

func (s *Server) writeData(w http.ResponseWriter, status int, data any) {
	s.writeJSON(w, status, dataEnvelope{Data: data})
}

func (s *Server) writeDataMeta(w http.ResponseWriter, status int, data, meta any) {
	s.writeJSON(w, status, dataEnvelope{Data: data, Meta: meta})
}

func (s *Server) writeError(w http.ResponseWriter, r *http.Request, status int, code, message string, details any) {
	identifier := ""
	if r != nil {
		identifier = requestID(r.Context())
	}
	// Callers that hold no request, and callers whose request predates the requestID
	// middleware -- recoverPanic is one -- have no id in the context. The id still
	// reached the response header, and every error envelope has to carry it: it is
	// the only handle support has for matching a customer report to a log line.
	if identifier == "" {
		identifier = w.Header().Get("X-Request-ID")
	}
	s.writeJSON(w, status, errorEnvelope{Error: APIError{Code: code, Message: message, RequestID: identifier, Details: details}})
}

func (s *Server) writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func (s *Server) decodeJSON(w http.ResponseWriter, r *http.Request, destination any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		s.writeError(w, r, http.StatusBadRequest, "invalid_request", "Request body is not valid JSON", map[string]string{"reason": err.Error()})
		return false
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		s.writeError(w, r, http.StatusBadRequest, "invalid_request", "Request body must contain one JSON object", nil)
		return false
	}
	return true
}

func (s *Server) hasEntitlement(accountID string) bool {
	if s.cfg.DemoMode {
		return true
	}
	allowed := false
	_ = s.store.View(func(state *model.State) error {
		for index := range state.Accounts {
			account := &state.Accounts[index]
			if account.ID != accountID {
				continue
			}
			allowed = account.BillingStatus == "active" || account.BillingStatus == "trialing"
			// Account ids are unique, so there is nothing after the match worth
			// looking at. This runs on every widget session, message, lead and
			// reset, holding the read lock the whole way to the end of the slice.
			break
		}
		return nil
	})
	return allowed
}

func constantStringEqual(a, b string) bool {
	if len(a) != len(b) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}

// peerIP is the address of the immediate TCP peer, ignoring every header.
func peerIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err == nil && host != "" {
		return host
	}
	if remote := strings.TrimSpace(r.RemoteAddr); remote != "" {
		return remote
	}
	return "unknown"
}

// bucketIP normalizes an address for rate-limit keying. IPv6 clients are bucketed
// to their /64: a single subscriber is routinely handed a whole /64 and could
// otherwise walk it to defeat every per-IP limit.
func bucketIP(value string) string {
	parsed := net.ParseIP(strings.TrimSpace(value))
	if parsed == nil {
		return strings.TrimSpace(value)
	}
	if parsed.To4() != nil {
		return parsed.String()
	}
	return parsed.Mask(net.CIDRMask(64, 128)).String() + "/64"
}

// clientIP resolves the address a rate limit keys on.
//
// X-Forwarded-For is attacker-controlled, so it is honoured ONLY when the
// immediate peer is a configured trusted proxy. With GARUDA_TRUSTED_PROXIES
// unset -- the default -- the header is ignored entirely and the peer address is
// used, so a direct-to-internet deployment cannot be tricked into handing each
// spoofed header its own bucket.
func (s *Server) clientIP(r *http.Request) string {
	peer := peerIP(r)
	if len(s.trustedProxies) == 0 || !s.trustedProxy(peer) {
		return bucketIP(peer)
	}
	// Every X-Forwarded-For field line must be considered, not just the first.
	// RFC 7230 makes repeated field lines equivalent to one comma-joined value,
	// and some proxies (HAProxy's `option forwardfor`) add their own line rather
	// than appending to the client's. Reading only the first line would let an
	// attacker's line outrank the one our own proxy wrote.
	hops := strings.Split(strings.Join(r.Header.Values("X-Forwarded-For"), ","), ",")
	// Trim from the FRONT. The rightmost entries are the ones trusted infrastructure
	// appended; the leftmost are whatever the client sent. Dropping the tail would
	// hand the attacker the bucket, and let them rotate junk for a fresh bucket per
	// request -- which defeats rate limiting entirely.
	if len(hops) > maxForwardedHops {
		hops = hops[len(hops)-maxForwardedHops:]
	}
	// Walk right to left: every hop to the right of the client must itself be a
	// trusted proxy, and the first untrusted address is the real client.
	for index := len(hops) - 1; index >= 0; index-- {
		candidate := normalizeForwardedHop(hops[index])
		if candidate == "" {
			break
		}
		if !s.trustedProxy(candidate) {
			return bucketIP(candidate)
		}
	}
	// Every hop was trusted, or the chain was malformed. Deliberately do not fall
	// back to the proxy address -- that would silently put the whole internet in
	// one bucket. A distinct sentinel keeps the failure visible.
	return "unresolved"
}

const maxForwardedHops = 12

// normalizeForwardedHop accepts the shapes proxies actually emit: a bare address,
// an "ip:port" pair, or a bracketed IPv6 literal. It returns "" for anything that
// is not a parseable address, which stops the right-to-left walk.
func normalizeForwardedHop(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	value = strings.Trim(value, `"`)
	if parsed := net.ParseIP(value); parsed != nil {
		return parsed.String()
	}
	if host, _, err := net.SplitHostPort(value); err == nil {
		if parsed := net.ParseIP(strings.Trim(host, "[]")); parsed != nil {
			return parsed.String()
		}
	}
	if parsed := net.ParseIP(strings.Trim(value, "[]")); parsed != nil {
		return parsed.String()
	}
	return ""
}

func (s *Server) trustedProxy(address string) bool {
	parsed := net.ParseIP(strings.TrimSpace(address))
	if parsed == nil {
		return false
	}
	for _, network := range s.trustedProxies {
		if network != nil && network.Contains(parsed) {
			return true
		}
	}
	return false
}

type fixedWindow struct {
	count    int
	reset    time.Time
	lastSeen time.Time
}

type fixedWindowLimiter struct {
	mu         sync.Mutex
	windows    map[string]fixedWindow
	maxEntries int
}

const defaultRateLimitEntries = 4096

func newFixedWindowLimiter() *fixedWindowLimiter {
	return &fixedWindowLimiter{
		windows:    make(map[string]fixedWindow),
		maxEntries: defaultRateLimitEntries,
	}
}

func (s *Server) rateLimit(bucket string, limit int, window time.Duration, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := s.clientIP(r) + "|" + bucket
		now := time.Now()
		s.limiter.mu.Lock()
		entry, exists := s.limiter.windows[key]
		if !exists {
			s.limiter.makeRoom(now)
		}
		if !exists || !entry.reset.After(now) {
			entry = fixedWindow{reset: now.Add(window)}
		}
		entry.lastSeen = now
		entry.count++
		s.limiter.windows[key] = entry
		allowed := entry.count <= limit
		retryAfter := time.Until(entry.reset)
		s.limiter.mu.Unlock()
		w.Header().Set("X-RateLimit-Limit", strconv.Itoa(limit))
		if !allowed {
			w.Header().Set("Retry-After", strconv.Itoa(max(1, int(retryAfter.Seconds()))))
			s.writeError(w, r, http.StatusTooManyRequests, "rate_limited", "Too many requests; please try again shortly", nil)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// makeRoom keeps attacker-controlled client addresses from growing the in-memory
// limiter without bound. The caller must hold l.mu.
func (l *fixedWindowLimiter) makeRoom(now time.Time) {
	maxEntries := l.maxEntries
	if maxEntries <= 0 {
		maxEntries = defaultRateLimitEntries
	}
	if len(l.windows) < maxEntries {
		return
	}
	for key, entry := range l.windows {
		if !entry.reset.After(now) {
			delete(l.windows, key)
		}
	}
	if len(l.windows) < maxEntries {
		return
	}
	var oldestKey string
	var oldestSeen time.Time
	for key, entry := range l.windows {
		if oldestKey == "" || entry.lastSeen.Before(oldestSeen) {
			oldestKey = key
			oldestSeen = entry.lastSeen
		}
	}
	if oldestKey != "" {
		delete(l.windows, oldestKey)
	}
}

func findAccount(state *model.State, accountID string) (*model.Account, bool) {
	for index := range state.Accounts {
		if state.Accounts[index].ID == accountID {
			return &state.Accounts[index], true
		}
	}
	return nil, false
}

func findUser(state *model.State, userID string) (*model.User, bool) {
	for index := range state.Users {
		if state.Users[index].ID == userID {
			return &state.Users[index], true
		}
	}
	return nil, false
}

func findAgent(state *model.State, accountID, agentID string) (*model.Agent, bool) {
	for index := range state.Agents {
		if state.Agents[index].ID == agentID && state.Agents[index].AccountID == accountID {
			return &state.Agents[index], true
		}
	}
	return nil, false
}

func newID(prefix string) string {
	token, _ := security.RandomToken(12)
	return prefix + token
}

func normalizeEmail(email string) string { return strings.ToLower(strings.TrimSpace(email)) }

func stringValue(value any) string {
	result, _ := value.(string)
	return result
}

func unixTime(value any) *time.Time {
	seconds, ok := value.(float64)
	if !ok || seconds <= 0 {
		return nil
	}
	result := time.Unix(int64(seconds), 0).UTC()
	return &result
}

// maxPageNumber keeps (page-1)*pageSize far below overflow while still exceeding
// any real dataset this service holds.
const maxPageNumber = 1 << 20

func parsePage(r *http.Request) (page, pageSize int) {
	page, _ = strconv.Atoi(r.URL.Query().Get("page"))
	pageSize, _ = strconv.Atoi(r.URL.Query().Get("page_size"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}
	if page > maxPageNumber {
		page = maxPageNumber
	}
	return page, pageSize
}

func paginate[T any](items []T, page, pageSize int) []T {
	start := (page - 1) * pageSize
	// A huge page number overflows the multiplication to a negative value, which
	// would slice out of range and turn a query string into a 500.
	if start < 0 || start >= len(items) {
		return []T{}
	}
	end := min(start+pageSize, len(items))
	return items[start:end]
}

func safeUser(user model.User) map[string]any {
	return map[string]any{"id": user.ID, "account_id": user.AccountID, "name": user.Name, "email": user.Email, "role": user.Role, "email_verified": user.EmailVerifiedAt != nil, "created_at": user.CreatedAt}
}

func (s *Server) storageFailure(w http.ResponseWriter, r *http.Request, err error) {
	s.logger.Error("storage operation failed", "error", err, "request_id", requestID(r.Context()))
	s.writeError(w, r, http.StatusInternalServerError, "storage_error", "The request could not be saved", nil)
}

var _ = fmt.Sprintf

// parseCIDRs turns GARUDA_TRUSTED_PROXIES entries into networks. A bare address
// is accepted and treated as a single host. Unparseable entries are skipped
// rather than failing startup, because an operator typo must not take the API
// down -- it degrades to ignoring X-Forwarded-For, which is the safe direction.
func parseCIDRs(values []string) []*net.IPNet {
	networks := make([]*net.IPNet, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, network, err := net.ParseCIDR(value); err == nil {
			networks = append(networks, network)
			continue
		}
		if parsed := net.ParseIP(value); parsed != nil {
			bits := 32
			if parsed.To4() == nil {
				bits = 128
			}
			networks = append(networks, &net.IPNet{IP: parsed, Mask: net.CIDRMask(bits, bits)})
		}
	}
	return networks
}

// safeRoute names where a request went without naming what it was about.
//
// r.URL.Path carries ids: a session id, an agent id, a lead id. Those belong in
// the log, which is access-controlled, and not in an alert, which lands on a
// phone and stays there. r.Pattern would be the ideal answer, but the alerting
// middleware sits ABOVE the mux and therefore sees the request before any
// pattern was matched, so the path is rewritten here instead: every segment
// that looks like an identifier becomes a placeholder, which leaves the shape
// of the route and none of its subjects.
func safeRoute(r *http.Request) string {
	segments := strings.Split(r.URL.Path, "/")
	for index, segment := range segments {
		if looksLikeIdentifier(segment) {
			segments[index] = "{id}"
		}
	}
	route := strings.Join(segments, "/")
	if len(route) > 120 {
		route = route[:120]
	}
	return r.Method + " " + route
}

// looksLikeIdentifier is deliberately eager. Turning a legitimate path segment
// into {id} costs a little precision in an alert; leaving a real identifier in
// costs a disclosure, so every ambiguous case resolves towards redaction.
func looksLikeIdentifier(segment string) bool {
	if len(segment) > 24 {
		return true
	}
	if index := strings.Index(segment, "_"); index > 0 && index < len(segment)-1 {
		// Every id this service mints is prefix_random: agt_, cvs_, msg_, lead_.
		return true
	}
	digits := 0
	for _, character := range segment {
		if character >= '0' && character <= '9' {
			digits++
		}
	}
	return digits > 0 && digits == len(segment)
}

// weakDigest is an ETag from the content itself: a short SHA-256 prefix, marked
// weak because it identifies the widget rather than one encoding of it. Sixteen hex characters is 64 bits, which is
// far more than enough to distinguish the handful of widget builds a cache will
// ever hold, and short enough to keep the header small on a request every
// visitor makes.
func weakDigest(content []byte) string {
	sum := sha256.Sum256(content)
	return `W/"` + hex.EncodeToString(sum[:8]) + `"`
}

// LivenessProbe is what the systemd watchdog asks before this process is allowed
// to say it is alive.
//
// The check is deliberately the same one /readyz makes -- can the store's read
// lock be taken -- because a wedged store is the failure the watchdog exists to
// catch, and it is the one a port-open check cannot see. It runs on the caller's
// context, so a probe that cannot acquire the lock within the watchdog's budget
// returns an error rather than blocking the goroutine that would have pinged.
func (s *Server) LivenessProbe(ctx context.Context) error {
	done := make(chan error, 1)
	go func() {
		done <- s.store.View(func(_ *model.State) error { return nil })
	}()
	select {
	case err := <-done:
		return err
	case <-ctx.Done():
		// The goroutine is left to finish on its own. It is blocked on a mutex
		// that will either be released, in which case it exits, or never will,
		// in which case this process is about to be restarted anyway.
		return ctx.Err()
	}
}
