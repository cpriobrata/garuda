package api

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"garuda/backend/internal/model"
)

// A value read inside store.View shares its maps and slices with the live state.
// getOnboarding used to copy the Onboarding struct out of View and JSON-encode it
// after the read lock was released, while onboardingMessage wrote to that same
// Answers map under Update. Concurrently reading and writing a Go map is a fatal
// error, not a panic -- recoverPanic cannot catch it and the process dies. Two
// ordinary requests from one signed-in user were enough to kill the API.
func TestOnboardingReadDoesNotAliasLiveState(t *testing.T) {
	server, dataStore := newTestServer(t)

	const accountID = "org_alias"
	seed := make(map[string]string, 64)
	for index := 0; index < 64; index++ {
		seed[fmt.Sprintf("seed%02d", index)] = "value"
	}
	if err := dataStore.Update(func(state *model.State) error {
		state.Onboarding = append(state.Onboarding, model.Onboarding{AccountID: accountID, Answers: seed})
		return nil
	}); err != nil {
		t.Fatalf("seed onboarding: %v", err)
	}

	identity := Identity{UserID: "usr_alias", AccountID: accountID, Email: "alias@example.com", Role: "owner"}
	stop := make(chan struct{})
	var writer sync.WaitGroup
	writer.Add(1)
	go func() { // what onboardingMessage does to Answers under Update
		defer writer.Done()
		for index := 0; ; index++ {
			select {
			case <-stop:
				return
			default:
			}
			_ = dataStore.Update(func(state *model.State) error {
				for position := range state.Onboarding {
					if state.Onboarding[position].AccountID == accountID {
						state.Onboarding[position].Answers[fmt.Sprintf("hot%d", index%32)] = "x"
						delete(state.Onboarding[position].Answers, fmt.Sprintf("hot%d", (index+16)%32))
					}
				}
				return nil
			})
		}
	}()

	var readers sync.WaitGroup
	for reader := 0; reader < 4; reader++ { // the real GET /v1/onboarding handler
		readers.Add(1)
		go func() {
			defer readers.Done()
			for call := 0; call < 400; call++ {
				request := httptest.NewRequest(http.MethodGet, "/v1/onboarding", nil)
				request = request.WithContext(context.WithValue(request.Context(), identityKey, identity))
				response := httptest.NewRecorder()
				server.getOnboarding(response, request)
				if response.Code != http.StatusOK {
					t.Errorf("getOnboarding returned %d", response.Code)
					return
				}
			}
		}()
	}
	readers.Wait()
	close(stop)
	writer.Wait()
}
