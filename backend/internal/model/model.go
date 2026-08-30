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
	// Additive: a file written before this existed decodes with none, which is
	// exactly right -- nobody had configured a destination yet.
	LeadRoutes []LeadRoute `json:"lead_routes,omitempty"`
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
	Handoff          HandoffConfig     `json:"handoff"`
	Booking          BookingConfig     `json:"booking"`
	Knowledge        []KnowledgeItem   `json:"knowledge,omitempty"`
	PublishedAt      *time.Time        `json:"published_at,omitempty"`
	CreatedAt        time.Time         `json:"created_at"`
	UpdatedAt        time.Time         `json:"updated_at"`
}

// LeadCaptureConfig keeps its original five fields exactly as they were. The
// three added for the form builder are optional: an agent stored before they
// existed decodes with FormFields empty, and the api package then rebuilds
// today's name, email and phone form out of the legacy Fields list, so an absent
// form behaves exactly as it did before the builder shipped.
type LeadCaptureConfig struct {
	Enabled     bool     `json:"enabled"`
	Prompt      string   `json:"prompt"`
	AfterTurns  int      `json:"after_turns"`
	Fields      []string `json:"fields"`
	PrivacyText string   `json:"privacy_text,omitempty"`

	FormHeading string          `json:"form_heading,omitempty"`
	SubmitLabel string          `json:"submit_label,omitempty"`
	FormFields  []LeadFormField `json:"form_fields,omitempty"`
}

// LeadFormField is one row of the customer-authored lead form, in the order the
// customer arranged it. ID is the stable key the widget posts the answer under,
// so renaming a Label never orphans the answers already captured against it.
type LeadFormField struct {
	ID          string   `json:"id"`
	Label       string   `json:"label"`
	Type        string   `json:"type"`
	Required    bool     `json:"required,omitempty"`
	Options     []string `json:"options,omitempty"`
	Placeholder string   `json:"placeholder,omitempty"`
}

// BrandingConfig carries everything the widget paints with. Every field below
// the original seven is additive and optional: absent means today's behaviour
// rather than a zero value, because the api package resolves the whole
// configuration into concrete values before the widget or the settings screen
// sees any of it.
type BrandingConfig struct {
	PrimaryColor   string   `json:"primary_color"`
	AccentColor    string   `json:"accent_color"`
	Position       string   `json:"position"`
	AvatarURL      string   `json:"avatar_url,omitempty"`
	LauncherText   string   `json:"launcher_text,omitempty"`
	PrivacyURL     string   `json:"privacy_url,omitempty"`
	AllowedDomains []string `json:"allowed_domains,omitempty"`

	DisplayName  string         `json:"display_name,omitempty"`
	Tagline      string         `json:"tagline,omitempty"`
	LogoURL      string         `json:"logo_url,omitempty"`
	Theme        string         `json:"theme,omitempty"`
	CustomColors *CustomColors  `json:"custom_colors,omitempty"`
	Toggles      *WidgetToggles `json:"toggles,omitempty"`
}

// CustomColors holds the colours a customer edits by hand under the "custom"
// theme. Primary and accent are deliberately absent here: they already live on
// BrandingConfig, and giving one colour two homes is how the two drift apart.
// Any field left empty falls back to the documented default.
type CustomColors struct {
	Background string `json:"background,omitempty"`
	Surface    string `json:"surface,omitempty"`
	Text       string `json:"text,omitempty"`
	OnPrimary  string `json:"on_primary,omitempty"`
	OnAccent   string `json:"on_accent,omitempty"`
}

// ThemeColors is the resolved palette. The server turns a preset name into one
// of these so the widget never carries the preset table, and so a preset can be
// retuned without shipping a new widget bundle to every customer website.
type ThemeColors struct {
	Primary    string `json:"primary"`
	Accent     string `json:"accent"`
	Background string `json:"background"`
	Surface    string `json:"surface"`
	Text       string `json:"text"`
	OnPrimary  string `json:"on_primary"`
	OnAccent   string `json:"on_accent"`
}

// WidgetToggles carries the nine independently switchable widget behaviours.
// Every field is a pointer because an agent saved before these existed has no
// toggle object at all, and plain booleans would read false for all nine, which
// would switch chat itself off for every agent already serving traffic. Nil
// means the customer has not chosen, and the api package resolves that to the
// documented default. Read the resolved toggles, never these fields directly.
type WidgetToggles struct {
	Transcription   *bool `json:"transcription,omitempty"`
	Chat            *bool `json:"chat,omitempty"`
	Autostart       *bool `json:"autostart,omitempty"`
	MuteOnMinimize  *bool `json:"mute_on_minimize,omitempty"`
	MuteOnTabChange *bool `json:"mute_on_tab_change,omitempty"`
	ShowLeadForm    *bool `json:"show_lead_form,omitempty"`
	IsGlowing       *bool `json:"is_glowing,omitempty"`
	IsTransparent   *bool `json:"is_transparent,omitempty"`
	AgentMute       *bool `json:"agent_mute,omitempty"`
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

	// Journey is where this visitor came from and what they read. Absent on every
	// session stored before it existed, and on any visit the widget could not
	// report -- both of which mean "we do not know", never "they did nothing".
	Journey *VisitorJourney `json:"journey,omitempty"`
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
