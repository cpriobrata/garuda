package model

import "time"

const SchemaVersion = 2

type State struct {
	Version              int                   `json:"version"`
	Accounts             []Account             `json:"accounts"`
	Users                []User                `json:"users"`
	EmailVerifications   []EmailVerification   `json:"email_verifications,omitempty"`
	AuthDeliveryAttempts []AuthDeliveryAttempt `json:"auth_delivery_attempts,omitempty"`
	PasswordResets       []PasswordReset       `json:"password_resets"`
	RefreshSessions      []RefreshSession      `json:"refresh_sessions,omitempty"`
	Onboarding           []Onboarding          `json:"onboarding"`
	Agents               []Agent               `json:"agents"`
	Sessions             []Session             `json:"sessions"`
	Messages             []Message             `json:"messages"`
	Leads                []Lead                `json:"leads"`
	Subscriptions        []Subscription        `json:"subscriptions"`
	CheckoutAttempts     []CheckoutAttempt     `json:"checkout_attempts,omitempty"`
	WebhookEvents        []WebhookEvent        `json:"webhook_events"`
	Jobs                 []Job                 `json:"jobs"`
}

type Account struct {
	ID               string    `json:"id"`
	Name             string    `json:"name"`
	Slug             string    `json:"slug"`
	Plan             string    `json:"plan"`
	BillingStatus    string    `json:"billing_status"`
	StripeCustomerID string    `json:"stripe_customer_id,omitempty"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
}

type User struct {
	ID              string     `json:"id"`
	AccountID       string     `json:"account_id"`
	ExternalAuthID  string     `json:"external_auth_id,omitempty"`
	GoogleSubject   string     `json:"google_subject,omitempty"`
	Name            string     `json:"name"`
	Email           string     `json:"email"`
	PasswordHash    string     `json:"password_hash,omitempty"`
	Role            string     `json:"role"`
	EmailVerifiedAt *time.Time `json:"email_verified_at,omitempty"`
	WelcomeSentAt   *time.Time `json:"welcome_sent_at,omitempty"`
	AuthVersion     int        `json:"auth_version,omitempty"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
}

type EmailVerification struct {
	ID        string     `json:"id"`
	UserID    string     `json:"user_id"`
	TokenHash string     `json:"token_hash"`
	ExpiresAt time.Time  `json:"expires_at"`
	UsedAt    *time.Time `json:"used_at,omitempty"`
	CreatedAt time.Time  `json:"created_at"`
}

type AuthDeliveryAttempt struct {
	KeyHash       string    `json:"key_hash"`
	Purpose       string    `json:"purpose"`
	LastAttemptAt time.Time `json:"last_attempt_at"`
}

type PasswordReset struct {
	ID        string     `json:"id"`
	UserID    string     `json:"user_id"`
	TokenHash string     `json:"token_hash"`
	ExpiresAt time.Time  `json:"expires_at"`
	UsedAt    *time.Time `json:"used_at,omitempty"`
	CreatedAt time.Time  `json:"created_at"`
}

type RefreshSession struct {
	ID           string     `json:"id"`
	FamilyID     string     `json:"family_id"`
	UserID       string     `json:"user_id"`
	TokenHash    string     `json:"token_hash"`
	ExpiresAt    time.Time  `json:"expires_at"`
	UsedAt       *time.Time `json:"used_at,omitempty"`
	RevokedAt    *time.Time `json:"revoked_at,omitempty"`
	ReplacedByID string     `json:"replaced_by_id,omitempty"`
	CreatedAt    time.Time  `json:"created_at"`
}

type Onboarding struct {
	AccountID        string              `json:"account_id"`
	BusinessName     string              `json:"business_name"`
	Industry         string              `json:"industry"`
	Website          string              `json:"website,omitempty"`
	Audience         string              `json:"audience"`
	Goals            []string            `json:"goals"`
	Tone             string              `json:"tone"`
	BotType          string              `json:"bot_type"`
	KeyOffers        []string            `json:"key_offers,omitempty"`
	FAQs             []FAQ               `json:"faqs,omitempty"`
	CompletedAt      *time.Time          `json:"completed_at,omitempty"`
	GeneratedAgentID string              `json:"generated_agent_id,omitempty"`
	Answers          map[string]string   `json:"answers,omitempty"`
	Messages         []OnboardingMessage `json:"messages,omitempty"`
	UpdatedAt        time.Time           `json:"updated_at"`
}

type OnboardingMessage struct {
	ID        string    `json:"id"`
	Role      string    `json:"role"`
	Content   string    `json:"content"`
	CreatedAt time.Time `json:"created_at"`
}

type FAQ struct {
	Question string `json:"question"`
	Answer   string `json:"answer"`
}

type Agent struct {
	ID               string            `json:"id"`
	AccountID        string            `json:"account_id"`
	Name             string            `json:"name"`
	Description      string            `json:"description"`
	PublicKey        string            `json:"public_key"`
	Status           string            `json:"status"`
	Revision         int               `json:"revision"`
	SystemPrompt     string            `json:"system_prompt"`
	WelcomeMessage   string            `json:"welcome_message"`
	SuggestedReplies []string          `json:"suggested_replies,omitempty"`
	LeadCapture      LeadCaptureConfig `json:"lead_capture"`
	Branding         BrandingConfig    `json:"branding"`
	Knowledge        []KnowledgeItem   `json:"knowledge,omitempty"`
	PublishedAt      *time.Time        `json:"published_at,omitempty"`
	CreatedAt        time.Time         `json:"created_at"`
	UpdatedAt        time.Time         `json:"updated_at"`
}

type LeadCaptureConfig struct {
	Enabled     bool     `json:"enabled"`
	Prompt      string   `json:"prompt"`
	AfterTurns  int      `json:"after_turns"`
	Fields      []string `json:"fields"`
	PrivacyText string   `json:"privacy_text,omitempty"`
}

type BrandingConfig struct {
	PrimaryColor   string   `json:"primary_color"`
	AccentColor    string   `json:"accent_color"`
	Position       string   `json:"position"`
	AvatarURL      string   `json:"avatar_url,omitempty"`
	LauncherText   string   `json:"launcher_text,omitempty"`
	PrivacyURL     string   `json:"privacy_url,omitempty"`
	AllowedDomains []string `json:"allowed_domains,omitempty"`
}

type KnowledgeItem struct {
	ID        string    `json:"id"`
	Type      string    `json:"type,omitempty"`
	Status    string    `json:"status,omitempty"`
	Title     string    `json:"title"`
	Content   string    `json:"content"`
	SourceURL string    `json:"source_url,omitempty"`
	Failure   string    `json:"failure,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}

type Session struct {
	ID               string     `json:"id"`
	AccountID        string     `json:"account_id"`
	AgentID          string     `json:"agent_id"`
	VisitorID        string     `json:"visitor_id"`
	SessionTokenHash string     `json:"session_token_hash"`
	Origin           string     `json:"origin,omitempty"`
	Locale           string     `json:"locale,omitempty"`
	PageURL          string     `json:"page_url,omitempty"`
	PageTitle        string     `json:"page_title,omitempty"`
	Referrer         string     `json:"referrer,omitempty"`
	MemoryConsent    bool       `json:"memory_consent"`
	StartedAt        *time.Time `json:"started_at,omitempty"`
	ExpiresAt        time.Time  `json:"expires_at"`
	CreatedAt        time.Time  `json:"created_at"`
	UpdatedAt        time.Time  `json:"updated_at"`
	LastSeenAt       time.Time  `json:"last_seen_at"`
}

type Message struct {
	ID        string         `json:"id"`
	AccountID string         `json:"account_id"`
	AgentID   string         `json:"agent_id"`
	SessionID string         `json:"session_id"`
	VisitorID string         `json:"visitor_id"`
	Role      string         `json:"role"`
	Content   string         `json:"content"`
	Metadata  map[string]any `json:"metadata,omitempty"`
	CreatedAt time.Time      `json:"created_at"`
}

type Lead struct {
	ID        string            `json:"id"`
	AccountID string            `json:"account_id"`
	AgentID   string            `json:"agent_id"`
	SessionID string            `json:"session_id"`
	VisitorID string            `json:"visitor_id"`
	Name      string            `json:"name,omitempty"`
	Email     string            `json:"email,omitempty"`
	Phone     string            `json:"phone,omitempty"`
	Company   string            `json:"company,omitempty"`
	Status    string            `json:"status"`
	Source    string            `json:"source"`
	Notes     string            `json:"notes,omitempty"`
	Metadata  map[string]string `json:"metadata,omitempty"`
	CreatedAt time.Time         `json:"created_at"`
	UpdatedAt time.Time         `json:"updated_at"`
}

type Subscription struct {
	ID                     string     `json:"id"`
	AccountID              string     `json:"account_id"`
	StripeSubscriptionID   string     `json:"stripe_subscription_id,omitempty"`
	StripeCustomerID       string     `json:"stripe_customer_id,omitempty"`
	Status                 string     `json:"status"`
	Plan                   string     `json:"plan"`
	CurrentPeriodEnd       *time.Time `json:"current_period_end,omitempty"`
	CancelAtPeriodEnd      bool       `json:"cancel_at_period_end"`
	ProviderEventCreatedAt *time.Time `json:"provider_event_created_at,omitempty"`
	CreatedAt              time.Time  `json:"created_at"`
	UpdatedAt              time.Time  `json:"updated_at"`
}

type CheckoutAttempt struct {
	ID                 string    `json:"id"`
	AccountID          string    `json:"account_id"`
	IdempotencyKeyHash string    `json:"idempotency_key_hash"`
	ProviderSessionID  string    `json:"provider_session_id,omitempty"`
	URL                string    `json:"url,omitempty"`
	Demo               bool      `json:"demo,omitempty"`
	Status             string    `json:"status"`
	ExpiresAt          time.Time `json:"expires_at"`
	CreatedAt          time.Time `json:"created_at"`
	UpdatedAt          time.Time `json:"updated_at"`
}

type WebhookEvent struct {
	ID        string    `json:"id"`
	Type      string    `json:"type"`
	CreatedAt time.Time `json:"created_at"`
}

type Job struct {
	ID        string         `json:"id"`
	AccountID string         `json:"account_id"`
	Type      string         `json:"type"`
	Status    string         `json:"status"`
	Result    map[string]any `json:"result,omitempty"`
	Error     string         `json:"error,omitempty"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
}
