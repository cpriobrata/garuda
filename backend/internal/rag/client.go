package rag

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type Client struct {
	baseURL     string
	bearerToken string
	httpClient  *http.Client
}

type Chunk struct {
	ID         string         `json:"id"`
	SourceID   string         `json:"source_id"`
	SourceName string         `json:"source_name"`
	Content    string         `json:"content"`
	Similarity float64        `json:"similarity"`
	Metadata   map[string]any `json:"metadata,omitempty"`
}

func New(baseURL, bearerToken string) *Client {
	return &Client{
		baseURL: strings.TrimRight(baseURL, "/"), bearerToken: bearerToken,
		httpClient: &http.Client{Timeout: 30 * time.Second},
	}
}

func (c *Client) Enabled() bool { return c.baseURL != "" && c.bearerToken != "" }

func (c *Client) Ingest(ctx context.Context, organizationID, agentID, sourceID, name, content string) error {
	if !c.Enabled() {
		return errors.New("RAG edge service is not configured")
	}
	request := map[string]any{
		"organization_id": organizationID, "agent_id": agentID, "source_id": sourceID,
		"name": name, "content": content,
	}
	var response struct {
		Status string `json:"status"`
	}
	return c.post(ctx, "/garuda-rag-ingest", request, &response)
}

func (c *Client) Delete(ctx context.Context, organizationID, agentID, sourceID string) error {
	if !c.Enabled() {
		return nil
	}
	request := map[string]any{"action": "delete", "organization_id": organizationID, "agent_id": agentID, "source_id": sourceID}
	var response struct {
		Status string `json:"status"`
	}
	return c.post(ctx, "/garuda-rag-ingest", request, &response)
}

func (c *Client) Search(ctx context.Context, organizationID, agentID, query string, limit int) ([]Chunk, error) {
	if !c.Enabled() {
		return nil, nil
	}
	if limit < 1 {
		limit = 4
	}
	if limit > 8 {
		limit = 8
	}
	request := map[string]any{"organization_id": organizationID, "agent_id": agentID, "query": query, "limit": limit}
	var response struct {
		Chunks []Chunk `json:"chunks"`
	}
	if err := c.post(ctx, "/garuda-rag-search", request, &response); err != nil {
		return nil, err
	}
	return response.Chunks, nil
}

func (c *Client) post(ctx context.Context, path string, payload, result any) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+path, bytes.NewReader(body))
	if err != nil {
		return err
	}
	request.Header.Set("Authorization", "Bearer "+c.bearerToken)
	request.Header.Set("Content-Type", "application/json")
	response, err := c.httpClient.Do(request)
	if err != nil {
		return fmt.Errorf("RAG edge request: %w", err)
	}
	defer response.Body.Close()
	responseBody, err := io.ReadAll(io.LimitReader(response.Body, 4<<20))
	if err != nil {
		return err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		var failure struct {
			Error string `json:"error"`
		}
		_ = json.Unmarshal(responseBody, &failure)
		if failure.Error == "" {
			failure.Error = fmt.Sprintf("RAG edge service returned status %d", response.StatusCode)
		}
		return errors.New(failure.Error)
	}
	if err := json.Unmarshal(responseBody, result); err != nil {
		return fmt.Errorf("decode RAG edge response: %w", err)
	}
	return nil
}
