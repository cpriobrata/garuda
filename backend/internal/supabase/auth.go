package supabase

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type Client struct {
	baseURL    string
	anonKey    string
	httpClient *http.Client
}

type User struct {
	ID           string         `json:"id"`
	Email        string         `json:"email"`
	UserMetadata map[string]any `json:"user_metadata"`
}

type AuthResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int    `json:"expires_in"`
	User         User   `json:"user"`
}

func New(baseURL, anonKey string) *Client {
	return &Client{baseURL: strings.TrimRight(baseURL, "/"), anonKey: anonKey, httpClient: &http.Client{Timeout: 15 * time.Second}}
}

func (c *Client) Enabled() bool { return c.baseURL != "" && c.anonKey != "" }

func (c *Client) SignUp(ctx context.Context, email, password, name string) (AuthResponse, error) {
	return c.authRequest(ctx, http.MethodPost, "/auth/v1/signup", "", map[string]any{
		"email": email, "password": password, "data": map[string]string{"name": name},
	})
}

func (c *Client) SignIn(ctx context.Context, email, password string) (AuthResponse, error) {
	return c.authRequest(ctx, http.MethodPost, "/auth/v1/token?grant_type=password", "", map[string]string{"email": email, "password": password})
}

func (c *Client) Refresh(ctx context.Context, refreshToken string) (AuthResponse, error) {
	return c.authRequest(ctx, http.MethodPost, "/auth/v1/token?grant_type=refresh_token", "", map[string]string{"refresh_token": refreshToken})
}

func (c *Client) User(ctx context.Context, accessToken string) (User, error) {
	response, err := c.authRequest(ctx, http.MethodGet, "/auth/v1/user", accessToken, nil)
	return response.User, err
}

func (c *Client) Recover(ctx context.Context, email, redirectTo string) error {
	path := "/auth/v1/recover"
	if redirectTo != "" {
		path += "?redirect_to=" + url.QueryEscape(redirectTo)
	}
	_, err := c.authRequest(ctx, http.MethodPost, path, "", map[string]string{"email": email})
	return err
}

func (c *Client) ResendSignup(ctx context.Context, email string) error {
	_, err := c.authRequest(ctx, http.MethodPost, "/auth/v1/resend", "", map[string]string{"type": "signup", "email": email})
	return err
}

func (c *Client) UpdatePassword(ctx context.Context, accessToken, password string) error {
	_, err := c.authRequest(ctx, http.MethodPut, "/auth/v1/user", accessToken, map[string]string{"password": password})
	return err
}

func (c *Client) authRequest(ctx context.Context, method, path, bearer string, payload any) (AuthResponse, error) {
	if !c.Enabled() {
		return AuthResponse{}, errors.New("Supabase auth is not configured")
	}
	var body io.Reader
	if payload != nil {
		encoded, err := json.Marshal(payload)
		if err != nil {
			return AuthResponse{}, err
		}
		body = bytes.NewReader(encoded)
	}
	request, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, body)
	if err != nil {
		return AuthResponse{}, err
	}
	request.Header.Set("apikey", c.anonKey)
	request.Header.Set("Content-Type", "application/json")
	if bearer != "" {
		request.Header.Set("Authorization", "Bearer "+bearer)
	} else {
		request.Header.Set("Authorization", "Bearer "+c.anonKey)
	}
	response, err := c.httpClient.Do(request)
	if err != nil {
		return AuthResponse{}, fmt.Errorf("Supabase auth request: %w", err)
	}
	defer response.Body.Close()
	responseBody, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return AuthResponse{}, err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		var failure struct {
			Message string `json:"msg"`
			Error   string `json:"error_description"`
		}
		_ = json.Unmarshal(responseBody, &failure)
		if failure.Message == "" {
			failure.Message = failure.Error
		}
		if failure.Message == "" {
			failure.Message = fmt.Sprintf("Supabase auth returned status %d", response.StatusCode)
		}
		return AuthResponse{}, errors.New(failure.Message)
	}
	var result AuthResponse
	if path == "/auth/v1/user" || strings.HasPrefix(path, "/auth/v1/user?") {
		if err := json.Unmarshal(responseBody, &result.User); err != nil {
			return AuthResponse{}, err
		}
		return result, nil
	}
	if len(responseBody) > 0 {
		if err := json.Unmarshal(responseBody, &result); err != nil {
			// Recover and update may return an empty object; that is still success.
			var user User
			if userErr := json.Unmarshal(responseBody, &user); userErr == nil {
				result.User = user
			}
		}
	}
	return result, nil
}
