package api

import (
	"errors"
	"math"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"garuda/backend/internal/model"
)

// A huge page number overflowed (page-1)*pageSize to a negative start, so a
// query string alone produced a slice-out-of-range panic on every list endpoint.
func TestPaginateSurvivesOverflowingPageNumbers(t *testing.T) {
	items := []int{1, 2, 3, 4, 5}
	for _, page := range []int{math.MaxInt, math.MaxInt / 2, 1 << 40, 1 << 21} {
		got := paginate(items, page, 100)
		if len(got) != 0 {
			t.Errorf("page %d: expected an empty page, got %v", page, got)
		}
	}
	if got := paginate(items, 1, 2); len(got) != 2 {
		t.Fatalf("expected a normal first page of 2, got %v", got)
	}
}

func TestParsePageClampsAbsurdPageNumbers(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/v1/leads?page="+strconv.Itoa(math.MaxInt)+"&page_size=100", nil)
	page, pageSize := parsePage(request)
	if page > maxPageNumber {
		t.Fatalf("page not clamped: %d", page)
	}
	if start := (page - 1) * pageSize; start < 0 {
		t.Fatalf("clamped page still overflows: start=%d", start)
	}
}

// A rate limiter placed outside requireAuth let anonymous traffic consume the
// quota belonging to real users on the same address.
func TestProtectedLimitedDoesNotSpendQuotaOnAnonymousRequests(t *testing.T) {
	server, _ := newTestServer(t)
	handler := server.Handler()

	// Exhaust well past the smallest configured limit without a credential.
	for attempt := 0; attempt < 40; attempt++ {
		request := httptest.NewRequest(http.MethodPost, "/v1/agents/generate", nil)
		request.RemoteAddr = "203.0.113.77:5000"
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != http.StatusUnauthorized {
			t.Fatalf("attempt %d: expected 401 for an anonymous request, got %d", attempt, response.Code)
		}
	}
	// The limiter must not have recorded any of that traffic.
	for key := range server.limiter.windows {
		t.Fatalf("anonymous traffic consumed limiter bucket %q", key)
	}
}

// Update rolled back only when persistence failed. A callback that mutated state
// and then returned an error left the mutation in memory while disk still held
// the old value, so a rejected request was silently applied.
func TestStoreUpdateRollsBackWhenTheCallbackFails(t *testing.T) {
	_, dataStore := newTestServer(t)
	if err := dataStore.Update(func(state *model.State) error {
		state.Accounts = append(state.Accounts, model.Account{ID: "org_keep", Name: "original", UpdatedAt: time.Unix(0, 0).UTC()})
		return nil
	}); err != nil {
		t.Fatalf("seed: %v", err)
	}

	sentinel := errors.New("validation failed after a partial write")
	err := dataStore.Update(func(state *model.State) error {
		state.Accounts[0].Name = "mutated"
		state.Accounts = append(state.Accounts, model.Account{ID: "org_ghost"})
		return sentinel
	})
	if !errors.Is(err, sentinel) {
		t.Fatalf("expected the callback error back, got %v", err)
	}

	_ = dataStore.View(func(state *model.State) error {
		if len(state.Accounts) != 1 {
			t.Errorf("rejected write left %d accounts in memory, want 1", len(state.Accounts))
		}
		if state.Accounts[0].Name != "original" {
			t.Errorf("rejected write survived in memory: name = %q", state.Accounts[0].Name)
		}
		return nil
	})
}

// client_message_id is visitor-controlled and is persisted twice per request --
// as the message ID and inside the reply metadata -- so an unbounded value let
// anyone inflate the state file at twice the rate they could send bytes.
func TestSafeClientMessageIDRejectsHostileValues(t *testing.T) {
	for _, value := range []string{"msg_abc123", "3f2504e0-4f89-11d3-9a0c-0305e82c3301", "a.b:c-d_e", ""} {
		if !safeClientMessageID(value) {
			t.Errorf("expected %q to be accepted", value)
		}
	}
	for _, value := range []string{"has space", "quote\"", "new\nline", "<script>", "semi;colon", "sla/sh"} {
		if safeClientMessageID(value) {
			t.Errorf("expected %q to be rejected", value)
		}
	}
}
