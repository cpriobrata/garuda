package rag

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSearchUsesInternalBearerAndTenantScope(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/garuda-rag-search" {
			t.Fatalf("unexpected path %q", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer shared-secret" {
			t.Fatalf("missing internal bearer: %q", r.Header.Get("Authorization"))
		}
		var payload map[string]any
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("decode payload: %v", err)
		}
		if payload["organization_id"] != "org-1" || payload["agent_id"] != "agent-1" {
			t.Fatalf("tenant scope missing: %#v", payload)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"chunks":[{"id":"chunk-1","source_id":"source-1","source_name":"FAQ","content":"Opening hours are 9 to 5.","similarity":0.91}]}`))
	}))
	defer server.Close()

	client := New(server.URL, "shared-secret")
	chunks, err := client.Search(context.Background(), "org-1", "agent-1", "When are you open?", 4)
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	if len(chunks) != 1 || chunks[0].SourceName != "FAQ" || chunks[0].Similarity != 0.91 {
		t.Fatalf("unexpected chunks: %#v", chunks)
	}
}

func TestIngestPreservesOpaqueFileRepositoryKeys(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/garuda-rag-ingest" {
			t.Fatalf("unexpected path %q", r.URL.Path)
		}
		var payload map[string]any
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("decode payload: %v", err)
		}
		if payload["organization_id"] != "org_Qx2j8bXvG7Y" || payload["agent_id"] != "agt_8mL2nR5vT9K" || payload["source_id"] != "src_4pD7sH1wC6Z" {
			t.Fatalf("opaque keys changed: %#v", payload)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"ready","storage":"runtime_compat"}`))
	}))
	defer server.Close()

	client := New(server.URL, "shared-secret")
	if err := client.Ingest(context.Background(), "org_Qx2j8bXvG7Y", "agt_8mL2nR5vT9K", "src_4pD7sH1wC6Z", "FAQ", "We are open from 9 to 5."); err != nil {
		t.Fatalf("Ingest: %v", err)
	}
}
