package config

import (
	"fmt"
	"net/mail"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Address              string
	PublicURL            string
	DataFile             string
	JWTSecret            string
	VisitorHMACKey       string
	AccessTokenTTL       time.Duration
	RefreshTokenTTL      time.Duration
	PasswordResetTTL     time.Duration
	EmailVerificationTTL time.Duration
	AuthResetURL         string
	AuthVerifyURL        string
	AllowedOrigins       []string
	TrustedProxies       []string
	ComposioAPIKey       string
	ComposioBaseURL      string
	DeepgramAPIKey       string
	DeepgramModel        string

	// Alerting: how the owner is paged when the service itself fails. Every
	// field is optional -- an unconfigured channel means no alerts, never a
	// startup failure, in the same spirit as every other adapter here.
	AlertWhatsAppToken    string
	AlertWhatsAppPhoneID  string
	AlertWhatsAppTo       string
	AlertWhatsAppBaseURL  string
	AlertWhatsAppTemplate string
	AlertWhatsAppLanguage string
	AlertWebhookURL       string
	AlertWebhookAuth      string
	Environment           string
	DemoMode              bool
	ExposeResetToken      bool
	AuthMode              string
	SupabaseURL           string
	SupabaseAnonKey       string
	GoogleOAuthClientID   string
	SendGridAPIKey        string
	SendGridAPIURL        string
	SendGridFromEmail     string
	SendGridFromName      string
	SendGridReplyTo       string
	StripeSecretKey       string
	StripeWebhookSecret   string
	StripePriceID         string
	PlanAmountCents       int
	PlanCurrency          string
	StripeAPIURL          string
	StripeSuccessURL      string
	StripeCancelURL       string
	StripePortalReturnURL string
	LLMBaseURL            string
	LLMAPIKey             string
	LLMModel              string
	RAGEdgeURL            string
	RAGBearerToken        string
	LogLevel              string
}

const defaultJWTSecret = "local-development-secret-change-me"

func Load() (Config, error) {
	if err := loadExplicitEnvFile(); err != nil {
		return Config{}, err
	}
	supabaseURL := strings.TrimRight(os.Getenv("SUPABASE_URL"), "/")
	supabaseAnonKey := os.Getenv("SUPABASE_ANON_KEY")
	authMode := strings.ToLower(strings.TrimSpace(os.Getenv("GARUDA_AUTH_MODE")))
	if authMode == "" {
		if supabaseURL != "" && supabaseAnonKey != "" {
			authMode = "supabase"
		} else {
			authMode = "local"
		}
	}
	cfg := Config{
		Address:               env("GARUDA_ADDRESS", ":8080"),
		PublicURL:             strings.TrimRight(env("GARUDA_PUBLIC_URL", "http://localhost:8080"), "/"),
		DataFile:              env("GARUDA_DATA_FILE", "./data/garuda.json"),
		JWTSecret:             env("GARUDA_JWT_SECRET", defaultJWTSecret),
		VisitorHMACKey:        env("GARUDA_VISITOR_HMAC_KEY", env("GARUDA_JWT_SECRET", defaultJWTSecret)),
		AccessTokenTTL:        duration("GARUDA_ACCESS_TOKEN_TTL", 24*time.Hour),
		RefreshTokenTTL:       duration("GARUDA_REFRESH_TOKEN_TTL", 30*24*time.Hour),
		PasswordResetTTL:      duration("GARUDA_PASSWORD_RESET_TTL", time.Hour),
		EmailVerificationTTL:  duration("GARUDA_EMAIL_VERIFICATION_TTL", 24*time.Hour),
		AuthResetURL:          env("AUTH_RESET_URL", "http://localhost:3000/auth/reset-password"),
		AuthVerifyURL:         env("AUTH_VERIFY_URL", "http://localhost:3000/auth/verify-email"),
		AllowedOrigins:        csv(env("GARUDA_ALLOWED_ORIGINS", "http://localhost:3000")),
		TrustedProxies:        csv(os.Getenv("GARUDA_TRUSTED_PROXIES")),
		ComposioAPIKey:        strings.TrimSpace(os.Getenv("COMPOSIO_API_KEY")),
		ComposioBaseURL:       strings.TrimRight(env("COMPOSIO_BASE_URL", "https://backend.composio.dev/api/v3"), "/"),
		DeepgramAPIKey:        strings.TrimSpace(os.Getenv("DEEPGRAM_API_KEY")),
		DeepgramModel:         env("DEEPGRAM_MODEL", "nova-3"),
		AlertWhatsAppToken:    strings.TrimSpace(os.Getenv("ALERT_WHATSAPP_TOKEN")),
		AlertWhatsAppPhoneID:  strings.TrimSpace(os.Getenv("ALERT_WHATSAPP_PHONE_ID")),
		AlertWhatsAppTo:       strings.TrimSpace(os.Getenv("ALERT_WHATSAPP_TO")),
		AlertWhatsAppBaseURL:  strings.TrimRight(env("ALERT_WHATSAPP_API_URL", "https://graph.facebook.com/v21.0"), "/"),
		AlertWhatsAppTemplate: strings.TrimSpace(os.Getenv("ALERT_WHATSAPP_TEMPLATE")),
		AlertWhatsAppLanguage: env("ALERT_WHATSAPP_TEMPLATE_LANGUAGE", "en"),
		AlertWebhookURL:       strings.TrimSpace(os.Getenv("ALERT_WEBHOOK_URL")),
		AlertWebhookAuth:      strings.TrimSpace(os.Getenv("ALERT_WEBHOOK_AUTH")),
		Environment:           strings.ToLower(env("GARUDA_ENVIRONMENT", "development")),
		DemoMode:              boolean("GARUDA_DEMO_MODE", true),
		ExposeResetToken:      boolean("GARUDA_EXPOSE_RESET_TOKEN", true),
		AuthMode:              authMode,
		SupabaseURL:           supabaseURL,
		SupabaseAnonKey:       supabaseAnonKey,
		GoogleOAuthClientID:   strings.TrimSpace(os.Getenv("GOOGLE_OAUTH_CLIENT_ID")),
		SendGridAPIKey:        strings.TrimSpace(os.Getenv("SENDGRID_API_KEY")),
		SendGridAPIURL:        strings.TrimRight(env("SENDGRID_API_URL", "https://api.sendgrid.com/v3"), "/"),
		SendGridFromEmail:     normalizeEmail(os.Getenv("SENDGRID_FROM_EMAIL")),
		SendGridFromName:      env("SENDGRID_FROM_NAME", "Garuda"),
		SendGridReplyTo:       normalizeEmail(os.Getenv("SENDGRID_REPLY_TO")),
		StripeSecretKey:       os.Getenv("STRIPE_SECRET_KEY"),
		StripeWebhookSecret:   os.Getenv("STRIPE_WEBHOOK_SECRET"),
		StripePriceID:         env("STRIPE_PRICE_ID", os.Getenv("STRIPE_PRICE_ID_STARTER_17")),
		PlanAmountCents:       integer("GARUDA_PLAN_AMOUNT_CENTS", 1700),
		PlanCurrency:          strings.ToLower(env("GARUDA_PLAN_CURRENCY", "usd")),
		StripeAPIURL:          strings.TrimRight(env("STRIPE_API_URL", "https://api.stripe.com/v1"), "/"),
		StripeSuccessURL:      env("STRIPE_SUCCESS_URL", "http://localhost:3000/checkout/success?checkout=success"),
		StripeCancelURL:       env("STRIPE_CANCEL_URL", "http://localhost:3000/checkout?checkout=cancelled"),
		StripePortalReturnURL: env("STRIPE_PORTAL_RETURN_URL", "http://localhost:3000/app/billing"),
		LLMBaseURL:            strings.TrimRight(env("LLM_BASE_URL", "https://generativelanguage.googleapis.com/v1beta/openai"), "/"),
		LLMAPIKey:             env("LLM_API_KEY", os.Getenv("GEMINI_API_KEY")),
		LLMModel:              env("LLM_MODEL", env("LLM_CHAT_MODEL", "gemini-3.7-flash")),
		RAGEdgeURL:            strings.TrimRight(os.Getenv("RAG_EDGE_URL"), "/"),
		RAGBearerToken:        os.Getenv("RAG_EDGE_BEARER_TOKEN"),
		LogLevel:              env("GARUDA_LOG_LEVEL", "info"),
	}
	if (cfg.SupabaseURL == "") != (cfg.SupabaseAnonKey == "") {
		return Config{}, fmt.Errorf("SUPABASE_URL and SUPABASE_ANON_KEY must be configured together")
	}
	switch cfg.Environment {
	case "development", "staging", "production":
	default:
		return Config{}, fmt.Errorf("GARUDA_ENVIRONMENT must be development, staging, or production")
	}
	// Demo mode disables entitlement checks, the widget domain allowlist, email
	// verification, and secret-strength assertions, and it exposes password-reset
	// tokens in unauthenticated responses. It defaults to true so the documented
	// zero-credential local demo keeps working -- which means the dangerous mistake
	// is deploying without turning it off. These guards make that impossible to do
	// silently: any signal that this is a real deployment refuses to start.
	if cfg.DemoMode {
		if cfg.Environment != "development" {
			return Config{}, fmt.Errorf("GARUDA_DEMO_MODE must be false when GARUDA_ENVIRONMENT=%s: demo mode grants every account an active subscription", cfg.Environment)
		}
		if publicURL, err := url.Parse(cfg.PublicURL); err == nil && publicURL.Scheme == "https" {
			return Config{}, fmt.Errorf("GARUDA_DEMO_MODE must be false when GARUDA_PUBLIC_URL is https (%s): demo mode grants every account an active subscription", cfg.PublicURL)
		}
		for _, origin := range cfg.AllowedOrigins {
			if origin == "*" || strings.HasPrefix(origin, "https://") {
				return Config{}, fmt.Errorf("GARUDA_DEMO_MODE must be false when GARUDA_ALLOWED_ORIGINS contains %q: demo mode grants every account an active subscription", origin)
			}
		}
	}
	// Exposing reset tokens is a demo affordance only. Clamp rather than reject, so
	// a leftover GARUDA_EXPOSE_RESET_TOKEN=true in a deployed environment silently
	// loses its effect instead of either leaking tokens or blocking startup.
	if !cfg.DemoMode {
		cfg.ExposeResetToken = false
	}
	if cfg.AuthMode != "local" && cfg.AuthMode != "supabase" {
		return Config{}, fmt.Errorf("GARUDA_AUTH_MODE must be local or supabase")
	}
	if cfg.AuthMode == "supabase" && cfg.SupabaseURL == "" {
		return Config{}, fmt.Errorf("SUPABASE_URL and SUPABASE_ANON_KEY are required when GARUDA_AUTH_MODE=supabase")
	}
	localJWTNeeded := cfg.AuthMode == "local" || cfg.GoogleOAuthClientID != ""
	if !cfg.DemoMode && localJWTNeeded && (len(cfg.JWTSecret) < 32 || cfg.JWTSecret == defaultJWTSecret) {
		return Config{}, fmt.Errorf("GARUDA_JWT_SECRET must be an explicit random value of at least 32 characters outside demo mode")
	}
	if !cfg.DemoMode && (len(cfg.VisitorHMACKey) < 32 || cfg.VisitorHMACKey == defaultJWTSecret) {
		return Config{}, fmt.Errorf("GARUDA_VISITOR_HMAC_KEY must be an explicit random value of at least 32 characters outside demo mode")
	}
	if !cfg.DemoMode && cfg.VisitorHMACKey == cfg.JWTSecret {
		return Config{}, fmt.Errorf("GARUDA_VISITOR_HMAC_KEY must be different from GARUDA_JWT_SECRET outside demo mode")
	}
	stripeAny := cfg.StripeSecretKey != "" || cfg.StripeWebhookSecret != "" || cfg.StripePriceID != ""
	stripeComplete := cfg.StripeSecretKey != "" && cfg.StripeWebhookSecret != "" && cfg.StripePriceID != ""
	if !cfg.DemoMode && stripeAny && !stripeComplete {
		return Config{}, fmt.Errorf("STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, and STRIPE_PRICE_ID must be configured together outside demo mode")
	}
	if (cfg.RAGEdgeURL == "") != (cfg.RAGBearerToken == "") {
		return Config{}, fmt.Errorf("RAG_EDGE_URL and RAG_EDGE_BEARER_TOKEN must be configured together")
	}
	if cfg.RAGBearerToken != "" && len(cfg.RAGBearerToken) < 32 {
		return Config{}, fmt.Errorf("RAG_EDGE_BEARER_TOKEN must be at least 32 characters")
	}
	resetURL, err := url.Parse(cfg.AuthResetURL)
	if err != nil || resetURL.Host == "" || (resetURL.Scheme != "http" && resetURL.Scheme != "https") || resetURL.Fragment != "" {
		return Config{}, fmt.Errorf("AUTH_RESET_URL must be an absolute HTTP(S) frontend URL without a fragment")
	}
	if !cfg.DemoMode && resetURL.Scheme != "https" {
		return Config{}, fmt.Errorf("AUTH_RESET_URL must use HTTPS outside demo mode")
	}
	verifyURL, err := url.Parse(cfg.AuthVerifyURL)
	if err != nil || verifyURL.Host == "" || (verifyURL.Scheme != "http" && verifyURL.Scheme != "https") || verifyURL.Fragment != "" {
		return Config{}, fmt.Errorf("AUTH_VERIFY_URL must be an absolute HTTP(S) frontend URL without a fragment")
	}
	if !cfg.DemoMode && verifyURL.Scheme != "https" {
		return Config{}, fmt.Errorf("AUTH_VERIFY_URL must use HTTPS outside demo mode")
	}
	sendGridAny := cfg.SendGridAPIKey != "" || cfg.SendGridFromEmail != "" || cfg.SendGridReplyTo != ""
	if sendGridAny && (cfg.SendGridAPIKey == "" || cfg.SendGridFromEmail == "") {
		return Config{}, fmt.Errorf("SENDGRID_API_KEY and SENDGRID_FROM_EMAIL must be configured together")
	}
	if !cfg.DemoMode && cfg.AuthMode == "local" && (cfg.SendGridAPIKey == "" || cfg.SendGridFromEmail == "") {
		return Config{}, fmt.Errorf("SENDGRID_API_KEY and SENDGRID_FROM_EMAIL are required for local auth outside demo mode")
	}
	if cfg.SendGridFromEmail != "" && !validMailbox(cfg.SendGridFromEmail) {
		return Config{}, fmt.Errorf("SENDGRID_FROM_EMAIL must be a valid email address without a display name")
	}
	if cfg.SendGridReplyTo != "" && !validMailbox(cfg.SendGridReplyTo) {
		return Config{}, fmt.Errorf("SENDGRID_REPLY_TO must be a valid email address without a display name")
	}
	if sendGridAny {
		sendGridURL, parseErr := url.Parse(cfg.SendGridAPIURL)
		if parseErr != nil || sendGridURL.Host == "" || (sendGridURL.Scheme != "http" && sendGridURL.Scheme != "https") || sendGridURL.RawQuery != "" || sendGridURL.Fragment != "" {
			return Config{}, fmt.Errorf("SENDGRID_API_URL must be an absolute HTTP(S) base URL without query or fragment")
		}
		if !cfg.DemoMode && sendGridURL.Scheme != "https" {
			return Config{}, fmt.Errorf("SENDGRID_API_URL must use HTTPS outside demo mode")
		}
	}
	return cfg, nil
}

func validMailbox(value string) bool {
	parsed, err := mail.ParseAddress(value)
	return err == nil && parsed.Address == value
}

func normalizeEmail(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func env(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func boolean(key string, fallback bool) bool {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func duration(key string, fallback time.Duration) time.Duration {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := time.ParseDuration(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func integer(key string, fallback int) int {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed < 0 {
		return fallback
	}
	return parsed
}

func csv(value string) []string {
	var values []string
	for _, item := range strings.Split(value, ",") {
		item = strings.TrimSpace(item)
		if item != "" {
			values = append(values, item)
		}
	}
	return values
}
