package api

import (
	"context"
	"crypto/subtle"
	"embed"
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

	"garuda/backend/internal/billing"
	"garuda/backend/internal/config"
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
	cfg      config.Config
	store    store.Store
	llm      *llm.Client
	stripe   *billing.StripeClient
	rag      *rag.Client
	supabase *supabase.Client
	google   googleIdentityVerifier
	mailer   *mailer.Client
	logger   *slog.Logger
	limiter  *fixedWindowLimiter
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
		logger:   logger,
		limiter:  newFixedWindowLimiter(),
	}
}

func (s *Server) Handler() http.Handler {
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

	protected := func(pattern string, handler http.HandlerFunc) {
		mux.Handle(pattern, s.requireAuth(handler))
	}
	protected("GET /v1/me", s.me)
	protected("POST /v1/auth/google/link", s.googleLink)
	protected("PATCH /v1/profile", s.updateProfile)
	protected("GET /v1/onboarding/questions", s.onboardingQuestions)
	protected("GET /v1/onboarding", s.getOnboarding)
	protected("PUT /v1/onboarding", s.saveOnboarding)
	protected("POST /v1/onboarding/messages", s.onboardingMessage)
	protected("POST /v1/onboarding/complete", s.completeOnboarding)
	protected("GET /v1/jobs/{jobID}", s.getJob)
	protected("GET /v1/agents", s.listAgents)
	protected("POST /v1/agents", s.createAgent)
	protected("POST /v1/agents/generate", s.generateAgent)
	protected("GET /v1/agents/{agentID}", s.getAgent)
	protected("PATCH /v1/agents/{agentID}", s.updateAgent)
	protected("DELETE /v1/agents/{agentID}", s.archiveAgent)
	protected("POST /v1/agents/{agentID}/publish", s.publishAgent)
	protected("POST /v1/agents/{agentID}/unpublish", s.unpublishAgent)
	protected("POST /v1/agents/{agentID}/preview/messages", s.previewAgentMessage)
	protected("GET /v1/agents/{agentID}/embed", s.agentEmbed)
	protected("GET /v1/agents/{agentID}/sources", s.listKnowledgeSources)
	protected("POST /v1/agents/{agentID}/sources", s.createKnowledgeSource)
	protected("DELETE /v1/agents/{agentID}/sources/{sourceID}", s.deleteKnowledgeSource)
	protected("GET /v1/dashboard", s.dashboard)
	protected("GET /v1/analytics/overview", s.analyticsOverview)
	protected("GET /v1/leads", s.listLeads)
	protected("GET /v1/leads/{leadID}", s.getLead)
	protected("PATCH /v1/leads/{leadID}", s.updateLead)
	protected("GET /v1/conversations", s.listConversations)
	protected("GET /v1/conversations/{sessionID}", s.getConversation)
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

func (s *Server) widgetScript(w http.ResponseWriter, r *http.Request) {
	content, err := assets.ReadFile("assets/widget.js")
	if err != nil {
		s.writeError(w, r, http.StatusInternalServerError, "asset_unavailable", "Widget asset is unavailable", nil)
		return
	}
	w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
	w.Header().Set("Cache-Control", "public, max-age=300")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(content)
}

func (s *Server) middleware(next http.Handler) http.Handler {
	return s.recoverPanic(s.requestID(s.cors(s.securityHeaders(s.accessLog(next)))))
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
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		next.ServeHTTP(w, r)
	})
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
	})
}

func (s *Server) recoverPanic(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if recovered := recover(); recovered != nil {
				s.logger.Error("panic recovered", "error", recovered, "request_id", requestID(r.Context()))
				s.writeError(w, r, http.StatusInternalServerError, "internal_error", "An unexpected error occurred", nil)
			}
		}()
		next.ServeHTTP(w, r)
	})
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
	id := ""
	if r != nil {
		id = requestID(r.Context())
	}
	s.writeJSON(w, status, errorEnvelope{Error: APIError{Code: code, Message: message, RequestID: id, Details: details}})
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
		for _, account := range state.Accounts {
			if account.ID == accountID && (account.BillingStatus == "active" || account.BillingStatus == "trialing") {
				allowed = true
			}
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

func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err == nil && host != "" {
		return host
	}
	if remote := strings.TrimSpace(r.RemoteAddr); remote != "" {
		return remote
	}
	return "unknown"
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
		key := clientIP(r) + "|" + bucket
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
	return page, pageSize
}

func paginate[T any](items []T, page, pageSize int) []T {
	start := (page - 1) * pageSize
	if start >= len(items) {
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
