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
	"time"
)

const defaultBaseURL = "https://backend.composio.dev/api/v3"

type Client struct {
	baseURL    string
	apiKey     string
	httpClient *http.Client
}

// Toolkit is one connectable product, such as Google Calendar or HighLevel.
type Toolkit struct {
	Slug        string   `json:"slug"`
	Name        string   `json:"name"`
	Description string   `json:"description,omitempty"`
	LogoURL     string   `json:"logo,omitempty"`
	Categories  []string `json:"categories,omitempty"`
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
	body := map[string]any{"user_id": userID, "toolkit": strings.ToLower(strings.TrimSpace(toolkitSlug))}
	if callbackURL != "" {
		body["callback_url"] = callbackURL
	}
	var payload struct {
		ID          string `json:"id"`
		Status      string `json:"status"`
		RedirectURL string `json:"redirect_url"`
	}
	// Connect Link, not initiate(): Composio retired initiate() for its managed
	// OAuth configs during 2026, and link works for every scheme.
	if err := c.request(ctx, http.MethodPost, "/connected_accounts/link", body, &payload); err != nil {
		return Connection{}, err
	}
	return Connection{ID: payload.ID, Toolkit: toolkitSlug, Status: payload.Status, UserID: userID, RedirectURL: payload.RedirectURL}, nil
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
