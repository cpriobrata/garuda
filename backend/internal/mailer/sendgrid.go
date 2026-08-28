package mailer

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type Client struct {
	apiKey     string
	apiURL     string
	fromEmail  string
	fromName   string
	replyTo    string
	httpClient *http.Client
}

// Message is the provider-neutral payload used by callers that need to send a
// transactional message not covered by the task-specific helpers below.
type Message struct {
	ToEmail string
	ToName  string
	Subject string
	Text    string
	HTML    string
}

type address struct {
	Email string `json:"email"`
	Name  string `json:"name,omitempty"`
}

type message struct {
	Personalizations []struct {
		To []address `json:"to"`
	} `json:"personalizations"`
	From    address  `json:"from"`
	ReplyTo *address `json:"reply_to,omitempty"`
	Subject string   `json:"subject"`
	Content []struct {
		Type  string `json:"type"`
		Value string `json:"value"`
	} `json:"content"`
}

func New(apiKey, apiURL, fromEmail, fromName, replyTo string) *Client {
	return &Client{
		apiKey:     strings.TrimSpace(apiKey),
		apiURL:     strings.TrimRight(strings.TrimSpace(apiURL), "/"),
		fromEmail:  strings.TrimSpace(fromEmail),
		fromName:   strings.TrimSpace(fromName),
		replyTo:    strings.TrimSpace(replyTo),
		httpClient: &http.Client{Timeout: 10 * time.Second},
	}
}

// NewSendGrid accepts the SendGrid API origin (for example
// https://api.sendgrid.com) and keeps compatibility with the generic mailer
// constructor used by package tests.
func NewSendGrid(apiKey, apiURL, fromEmail, fromName, replyTo string) *Client {
	apiURL = strings.TrimRight(strings.TrimSpace(apiURL), "/")
	parsed, err := url.Parse(apiURL)
	if err == nil && (parsed.Path == "" || parsed.Path == "/") {
		apiURL += "/v3"
	}
	return New(apiKey, apiURL, fromEmail, fromName, replyTo)
}

func (c *Client) Enabled() bool {
	return c != nil && c.apiKey != "" && c.apiURL != "" && c.fromEmail != ""
}

func (c *Client) Send(ctx context.Context, input Message) error {
	if strings.TrimSpace(input.ToEmail) == "" || strings.TrimSpace(input.Subject) == "" || strings.TrimSpace(input.Text) == "" {
		return errors.New("email recipient, subject, and text are required")
	}
	return c.send(ctx, input.ToEmail, input.ToName, input.Subject, input.Text, input.HTML)
}

func (c *Client) SendVerification(ctx context.Context, toEmail, toName, frontendURL, token string) error {
	link, err := tokenLink(frontendURL, token)
	if err != nil {
		return err
	}
	plain := "Verify your Garuda email address by opening this link:\n\n" + link + "\n\nThis link expires soon and can only be used once."
	htmlBody := "<p>Verify your Garuda email address by opening the link below.</p><p><a href=\"" + html.EscapeString(link) + "\">Verify email</a></p><p>This link expires soon and can only be used once.</p>"
	return c.send(ctx, toEmail, toName, "Verify your Garuda email", plain, htmlBody)
}

func (c *Client) SendPasswordReset(ctx context.Context, toEmail, toName, frontendURL, token string) error {
	link, err := tokenLink(frontendURL, token)
	if err != nil {
		return err
	}
	plain := "Reset your Garuda password by opening this link:\n\n" + link + "\n\nIf you did not request this, you can ignore this email."
	htmlBody := "<p>Reset your Garuda password by opening the link below.</p><p><a href=\"" + html.EscapeString(link) + "\">Reset password</a></p><p>If you did not request this, you can ignore this email.</p>"
	return c.send(ctx, toEmail, toName, "Reset your Garuda password", plain, htmlBody)
}

func (c *Client) SendWelcome(ctx context.Context, toEmail, toName string) error {
	plain := "Welcome to Garuda. Your email is verified and your workspace is ready."
	htmlBody := "<p>Welcome to Garuda.</p><p>Your email is verified and your workspace is ready.</p>"
	return c.send(ctx, toEmail, toName, "Welcome to Garuda", plain, htmlBody)
}

func tokenLink(frontendURL, token string) (string, error) {
	if strings.TrimSpace(token) == "" {
		return "", errors.New("email token is empty")
	}
	parsed, err := url.Parse(frontendURL)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return "", errors.New("email frontend URL is invalid")
	}
	query := parsed.Query()
	query.Set("token", token)
	parsed.RawQuery = query.Encode()
	return parsed.String(), nil
}

func (c *Client) send(ctx context.Context, toEmail, toName, subject, plain, htmlBody string) error {
	if !c.Enabled() {
		return errors.New("email delivery is not configured")
	}
	payload := message{
		From:    address{Email: c.fromEmail, Name: c.fromName},
		Subject: subject,
	}
	payload.Personalizations = append(payload.Personalizations, struct {
		To []address `json:"to"`
	}{To: []address{{Email: strings.TrimSpace(toEmail), Name: strings.TrimSpace(toName)}}})
	if c.replyTo != "" {
		payload.ReplyTo = &address{Email: c.replyTo}
	}
	payload.Content = append(payload.Content,
		struct {
			Type  string `json:"type"`
			Value string `json:"value"`
		}{Type: "text/plain", Value: plain},
		struct {
			Type  string `json:"type"`
			Value string `json:"value"`
		}{Type: "text/html", Value: htmlBody},
	)
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("encode email request: %w", err)
	}
	endpoint := c.apiURL
	if !strings.HasSuffix(endpoint, "/mail/send") {
		endpoint += "/mail/send"
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create email request: %w", err)
	}
	request.Header.Set("Authorization", "Bearer "+c.apiKey)
	request.Header.Set("Content-Type", "application/json")
	response, err := c.httpClient.Do(request)
	if err != nil {
		return fmt.Errorf("send email request: %w", err)
	}
	defer response.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 64<<10))
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("email provider returned status %d", response.StatusCode)
	}
	return nil
}
