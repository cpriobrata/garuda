// Package composio talks to Composio, the integration broker that lets each
// Garuda customer connect their own third-party accounts -- Google Calendar,
// Slack, HighLevel, HubSpot and around 1,300 other toolkits.
//
// The important property is per-customer scoping. Garuda registers nothing per
// integration; a customer clicks Connect, authenticates with the provider, and
// Composio stores and refreshes that customer's tokens against a user id we
// supply. We pass the Garuda account id, so one customer's connection can never
// be reached through another's, and no third-party refresh token is ever stored
// in Garuda's own data file.
//
// Hand-rolled against the plain HTTPS API for the same reason as every other
// adapter here: the backend carries no third-party dependencies.
package composio

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

const defaultBaseURL = "https://backend.composio.dev/api/v3"

type Client struct {
	baseURL    string
	apiKey     string
	httpClient *http.Client

	// One auth config per toolkit, shared by every customer, created the first
	// time that toolkit is connected. Remembered so a second customer connecting
	// the same product does not pay a round trip to discover it again.
	authConfigMutex sync.Mutex
	authConfigs     map[string]string
}

// Toolkit is one connectable product, such as Google Calendar or HighLevel.
type Toolkit struct {
	Slug string `json:"slug"`
	Name string `json:"name"`

	// The provider nests these under "meta", which is why they are decoded there
	// and flattened in UnmarshalJSON rather than read from the top level. Read
	// from the top level they were always empty, and every card in the catalogue
	// fell back to a monogram with no description.
	Description string   `json:"description,omitempty"`
	LogoURL     string   `json:"logo,omitempty"`
	Categories  []string `json:"categories,omitempty"`
}

// UnmarshalJSON flattens the provider's shape into ours, so nothing above this
// package has to know where it chose to nest things.
func (t *Toolkit) UnmarshalJSON(data []byte) error {
	var wire struct {
		Slug string `json:"slug"`
		Name string `json:"name"`
		Meta struct {
			Description string `json:"description"`
			Logo        string `json:"logo"`
			Categories  []struct {
				ID   string `json:"id"`
				Name string `json:"name"`
			} `json:"categories"`
		} `json:"meta"`
	}
	if err := json.Unmarshal(data, &wire); err != nil {
		return err
	}
	t.Slug = wire.Slug
	t.Name = wire.Name
	t.Description = wire.Meta.Description
	t.LogoURL = wire.Meta.Logo
	t.Categories = t.Categories[:0]
	for _, category := range wire.Meta.Categories {
		name := category.Name
		if name == "" {
			name = category.ID
		}
		if name != "" {
			t.Categories = append(t.Categories, name)
		}
	}
	return nil
}

// Connection is one customer's authorised account for one toolkit.
type Connection struct {
	ID          string    `json:"id"`
	Toolkit     string    `json:"toolkit"`
	Status      string    `json:"status"`
	UserID      string    `json:"user_id,omitempty"`
	CreatedAt   time.Time `json:"created_at,omitempty"`
	RedirectURL string    `json:"redirect_url,omitempty"`
}

func New(baseURL, apiKey string) *Client {
	trimmed := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if trimmed == "" {
		trimmed = defaultBaseURL
	}
	return &Client{
		baseURL:    trimmed,
		apiKey:     strings.TrimSpace(apiKey),
		httpClient: &http.Client{Timeout: 20 * time.Second},
	}
}

// Enabled reports whether integrations are configured. Every caller must handle
// false: the product runs with no credentials at all, and an unconfigured
// integration surface has to degrade to "not available" rather than fail.
func (c *Client) Enabled() bool { return c != nil && c.apiKey != "" && c.baseURL != "" }

// ToolkitPage is one page of the catalogue. The catalogue is large -- over 1,400
// toolkits -- so it is always paged rather than fetched whole.
type ToolkitPage struct {
	Items      []Toolkit `json:"items"`
	NextCursor string    `json:"next_cursor,omitempty"`
	TotalItems int       `json:"total_items"`
}

// Category groups the catalogue for browsing.
type Category struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// Categories lists the catalogue groupings.
func (c *Client) Categories(ctx context.Context) ([]Category, error) {
	if !c.Enabled() {
		return nil, errors.New("integrations are not configured")
	}
	var payload struct {
		Items []Category `json:"items"`
	}
	if err := c.request(ctx, http.MethodGet, "/toolkits/categories", nil, &payload); err != nil {
		return nil, err
	}
	return payload.Items, nil
}

// Browse returns one page of the catalogue, optionally filtered.
func (c *Client) Browse(ctx context.Context, search, category, cursor string, limit int) (ToolkitPage, error) {
	if !c.Enabled() {
		return ToolkitPage{}, errors.New("integrations are not configured")
	}
	if limit < 1 || limit > 100 {
		limit = 30
	}
	query := url.Values{}
	query.Set("limit", strconv.Itoa(limit))
	if search = strings.TrimSpace(search); search != "" {
		if len(search) > 100 {
			search = search[:100]
		}
		query.Set("search", search)
	}
	if category = strings.TrimSpace(category); category != "" {
		query.Set("category", category)
	}
	if cursor = strings.TrimSpace(cursor); cursor != "" {
		if len(cursor) > 200 {
			return ToolkitPage{}, errors.New("invalid cursor")
		}
		query.Set("cursor", cursor)
	}
	var page ToolkitPage
	if err := c.request(ctx, http.MethodGet, "/toolkits?"+query.Encode(), nil, &page); err != nil {
		return ToolkitPage{}, err
	}
	return page, nil
}

// Toolkits lists what a customer can connect, optionally filtered by search term.
func (c *Client) Toolkits(ctx context.Context, search string, limit int) ([]Toolkit, error) {
	if !c.Enabled() {
		return nil, errors.New("integrations are not configured")
	}
	if limit < 1 || limit > 100 {
		limit = 50
	}
	query := url.Values{}
	query.Set("limit", strconv.Itoa(limit))
	if search = strings.TrimSpace(search); search != "" {
		if len(search) > 100 {
			search = search[:100]
		}
		query.Set("search", search)
	}
	var payload struct {
		Items []Toolkit `json:"items"`
	}
	if err := c.request(ctx, http.MethodGet, "/toolkits?"+query.Encode(), nil, &payload); err != nil {
		return nil, err
	}
	return payload.Items, nil
}

// ConnectLink starts an authorisation for one customer and returns the URL to
// send them to. userID is the Garuda account id, which is what keeps one
// customer's connections unreachable from another's.
func (c *Client) ConnectLink(ctx context.Context, userID, toolkitSlug, callbackURL string) (Connection, error) {
	if !c.Enabled() {
		return Connection{}, errors.New("integrations are not configured")
	}
	if strings.TrimSpace(userID) == "" || strings.TrimSpace(toolkitSlug) == "" {
		return Connection{}, errors.New("a user id and toolkit are required")
	}
	slug := strings.ToLower(strings.TrimSpace(toolkitSlug))

	// A link needs an auth config, and one has to exist before it can be
	// referenced. Sending only the toolkit -- which is what this did -- is a 400
	// from the provider, and the screen showed every customer "this integration
	// could not be started" with no way to get past it.
	authConfigID, err := c.authConfigFor(ctx, slug)
	if err != nil {
		return Connection{}, err
	}

	body := map[string]any{"user_id": userID, "auth_config_id": authConfigID}
	if callbackURL != "" {
		body["callback_url"] = callbackURL
	}
	var payload struct {
		ConnectedAccountID string `json:"connected_account_id"`
		ID                 string `json:"id"`
		Status             string `json:"status"`
		RedirectURL        string `json:"redirect_url"`
	}
	// Connect Link, not initiate(): Composio retired initiate() for its managed
	// OAuth configs during 2026, and link works for every scheme.
	if err := c.request(ctx, http.MethodPost, "/connected_accounts/link", body, &payload); err != nil {
		return Connection{}, err
	}
	identifier := payload.ConnectedAccountID
	if identifier == "" {
		identifier = payload.ID
	}
	status := payload.Status
	if status == "" {
		// A link that has been issued but not yet walked through is exactly what
		// INITIATED means, and the UI already knows not to call that connected.
		status = "INITIATED"
	}
	return Connection{ID: identifier, Toolkit: slug, Status: status, UserID: userID, RedirectURL: payload.RedirectURL}, nil
}

// authConfigFor returns the auth config to link against, creating one the first
// time a toolkit is used.
//
// Composio's managed auth means Garuda needs no OAuth app of its own for the
// toolkits it covers -- which is the whole reason this product uses a broker
// rather than integrating with providers one at a time. The config is per
// toolkit and shared by every customer, so it is created once and remembered.
func (c *Client) authConfigFor(ctx context.Context, slug string) (string, error) {
	c.authConfigMutex.Lock()
	cached, known := c.authConfigs[slug]
	c.authConfigMutex.Unlock()
	if known && cached != "" {
		return cached, nil
	}

	// Ask before creating: a config may exist from an earlier run of this
	// process, or have been made by hand in the provider's dashboard.
	var listing struct {
		Items []struct {
			ID      string `json:"id"`
			Toolkit struct {
				Slug string `json:"slug"`
			} `json:"toolkit"`
		} `json:"items"`
	}
	if err := c.request(ctx, http.MethodGet, "/auth_configs?limit=100", nil, &listing); err == nil {
		for _, item := range listing.Items {
			if strings.EqualFold(item.Toolkit.Slug, slug) && item.ID != "" {
				c.rememberAuthConfig(slug, item.ID)
				return item.ID, nil
			}
		}
	}

	created := map[string]any{
		"toolkit":     map[string]any{"slug": slug},
		"auth_config": map[string]any{"type": "use_composio_managed_auth"},
	}
	var response struct {
		AuthConfig struct {
			ID string `json:"id"`
		} `json:"auth_config"`
	}
	if err := c.request(ctx, http.MethodPost, "/auth_configs", created, &response); err != nil {
		return "", err
	}
	if response.AuthConfig.ID == "" {
		return "", errors.New("the integration provider returned no auth configuration")
	}
	c.rememberAuthConfig(slug, response.AuthConfig.ID)
	return response.AuthConfig.ID, nil
}

func (c *Client) rememberAuthConfig(slug, id string) {
	c.authConfigMutex.Lock()
	defer c.authConfigMutex.Unlock()
	if c.authConfigs == nil {
		c.authConfigs = map[string]string{}
	}
	c.authConfigs[slug] = id
}

// Connections lists one customer's connected accounts and nothing else. The
// user_id filter is the tenant boundary, so it is never optional.
func (c *Client) Connections(ctx context.Context, userID string) ([]Connection, error) {
	if !c.Enabled() {
		return nil, errors.New("integrations are not configured")
	}
	if strings.TrimSpace(userID) == "" {
		return nil, errors.New("a user id is required")
	}
	query := url.Values{}
	query.Set("user_ids", userID)
	var payload struct {
		Items []struct {
			ID        string    `json:"id"`
			Status    string    `json:"status"`
			CreatedAt time.Time `json:"created_at"`
			Toolkit   struct {
				Slug string `json:"slug"`
			} `json:"toolkit"`
		} `json:"items"`
	}
	if err := c.request(ctx, http.MethodGet, "/connected_accounts?"+query.Encode(), nil, &payload); err != nil {
		return nil, err
	}
	connections := make([]Connection, 0, len(payload.Items))
	for _, item := range payload.Items {
		connections = append(connections, Connection{
			ID: item.ID, Toolkit: item.Toolkit.Slug, Status: item.Status,
			UserID: userID, CreatedAt: item.CreatedAt,
		})
	}
	return connections, nil
}

// Disconnect removes one connection. The caller must have already proven the
// connection belongs to the requesting account.
func (c *Client) Disconnect(ctx context.Context, connectionID string) error {
	if !c.Enabled() {
		return errors.New("integrations are not configured")
	}
	if strings.TrimSpace(connectionID) == "" {
		return errors.New("a connection id is required")
	}
	return c.request(ctx, http.MethodDelete, "/connected_accounts/"+url.PathEscape(connectionID), nil, nil)
}

func (c *Client) request(ctx context.Context, method, path string, body, result any) error {
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(encoded)
	}
	request, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, reader)
	if err != nil {
		return err
	}
	request.Header.Set("x-api-key", c.apiKey)
	request.Header.Set("Accept", "application/json")
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	response, err := c.httpClient.Do(request)
	if err != nil {
		return fmt.Errorf("integration provider request: %w", err)
	}
	defer response.Body.Close()
	responseBody, err := io.ReadAll(io.LimitReader(response.Body, 4<<20))
	if err != nil {
		return err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		// Surface the provider's own message but never the API key, which is only
		// ever in the request header.
		var failure struct {
			Error struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		_ = json.Unmarshal(responseBody, &failure)
		if failure.Error.Message == "" {
			return fmt.Errorf("integration provider returned status %d", response.StatusCode)
		}
		return errors.New(failure.Error.Message)
	}
	if result == nil {
		return nil
	}
	if err := json.Unmarshal(responseBody, result); err != nil {
		return fmt.Errorf("decode integration provider response: %w", err)
	}
	return nil
}
