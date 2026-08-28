package api

import (
	"errors"
	"net/http"
	"net/mail"
	"strings"
	"time"

	"garuda/backend/internal/googleauth"
	"garuda/backend/internal/model"
)

var (
	errGoogleIdentityConflict = errors.New("Google identity conflicts with this account")
	errGoogleLinkRequired     = errors.New("existing account requires explicit Google linking")
	errGoogleEmailMismatch    = errors.New("Google email does not match the signed-in account")
)

type googleSignInRequest struct {
	Credential string `json:"credential"`
}

func (s *Server) googleSignIn(w http.ResponseWriter, r *http.Request) {
	var input googleSignInRequest
	if !s.decodeJSON(w, r, &input) {
		return
	}
	claims, ok := s.verifiedGoogleClaims(w, r, input.Credential)
	if !ok {
		return
	}
	now := time.Now().UTC()
	var user model.User
	var account model.Account
	accessToken := ""
	refreshToken := ""
	err := s.store.Update(func(state *model.State) error {
		var bySubject *model.User
		var byEmail *model.User
		for index := range state.Users {
			candidate := &state.Users[index]
			if candidate.GoogleSubject == claims.Subject {
				bySubject = candidate
			}
			if normalizeEmail(candidate.Email) == claims.Email {
				byEmail = candidate
			}
		}
		linkGoogleSubject := false
		createAccount := false
		switch {
		case bySubject != nil:
			user = *bySubject
		case byEmail != nil:
			if byEmail.GoogleSubject != "" && byEmail.GoogleSubject != claims.Subject {
				return errGoogleIdentityConflict
			}
			if !googleauth.AuthoritativeEmail(claims) {
				return errGoogleLinkRequired
			}
			user = *byEmail
			linkGoogleSubject = true
		case byEmail == nil:
			name := googleDisplayName(claims.Name, claims.Email)
			accountName := name + "'s workspace"
			account = model.Account{ID: newID("org_"), Name: accountName, Slug: slugify(accountName), Plan: "starter_17", BillingStatus: "incomplete", CreatedAt: now, UpdatedAt: now}
			user = model.User{ID: newID("usr_"), AccountID: account.ID, GoogleSubject: claims.Subject, Name: name, Email: claims.Email, Role: "owner", EmailVerifiedAt: &now, CreatedAt: now, UpdatedAt: now}
			createAccount = true
		}
		var refresh model.RefreshSession
		var sessionErr error
		accessToken, refreshToken, refresh, sessionErr = s.newLocalSession(user, now)
		if sessionErr != nil {
			return sessionErr
		}
		if createAccount {
			state.Accounts = append(state.Accounts, account)
			state.Users = append(state.Users, user)
			state.Subscriptions = append(state.Subscriptions, model.Subscription{ID: newID("sub_"), AccountID: account.ID, Status: "incomplete", Plan: "starter_17", CreatedAt: now, UpdatedAt: now})
		} else {
			storedUser := bySubject
			if storedUser == nil {
				storedUser = byEmail
			}
			if linkGoogleSubject {
				storedUser.GoogleSubject = claims.Subject
				storedUser.UpdatedAt = now
			}
			if storedUser.EmailVerifiedAt == nil {
				storedUser.EmailVerifiedAt = &now
				storedUser.UpdatedAt = now
			}
			user = *storedUser
			if existing, ok := findAccount(state, user.AccountID); ok {
				account = *existing
			}
		}
		pruneRefreshSessions(state, now)
		state.RefreshSessions = append(state.RefreshSessions, refresh)
		return nil
	})
	if err != nil {
		switch {
		case errors.Is(err, errGoogleIdentityConflict):
			s.writeError(w, r, http.StatusConflict, "identity_conflict", "This email is already linked to a different Google identity", nil)
		case errors.Is(err, errGoogleLinkRequired):
			s.writeError(w, r, http.StatusConflict, "account_link_required", "This existing account must link Google from an authenticated session before Google sign-in can be used", map[string]string{"provider": "google", "email": claims.Email, "link_endpoint": "/v1/auth/google/link"})
		default:
			s.storageFailure(w, r, err)
		}
		return
	}
	s.sendWelcomeIfNeeded(r.Context(), user)
	s.writeData(w, http.StatusOK, map[string]any{
		"access_token": accessToken, "refresh_token": refreshToken, "token_type": "Bearer", "expires_in": int(s.cfg.AccessTokenTTL.Seconds()),
		"verification_required": false, "user": safeUser(user), "organization": account,
	})
}

func (s *Server) googleLink(w http.ResponseWriter, r *http.Request) {
	var input googleSignInRequest
	if !s.decodeJSON(w, r, &input) {
		return
	}
	claims, ok := s.verifiedGoogleClaims(w, r, input.Credential)
	if !ok {
		return
	}
	identity := identityFrom(r.Context())
	now := time.Now().UTC()
	var user model.User
	err := s.store.Update(func(state *model.State) error {
		current, found := findUser(state, identity.UserID)
		if !found || current.AccountID != identity.AccountID {
			return errors.New("membership not found")
		}
		if normalizeEmail(current.Email) != claims.Email {
			return errGoogleEmailMismatch
		}
		for _, candidate := range state.Users {
			if candidate.GoogleSubject == claims.Subject && candidate.ID != current.ID {
				return errGoogleIdentityConflict
			}
		}
		if current.GoogleSubject != "" && current.GoogleSubject != claims.Subject {
			return errGoogleIdentityConflict
		}
		current.GoogleSubject = claims.Subject
		if current.EmailVerifiedAt == nil {
			current.EmailVerifiedAt = &now
		}
		current.UpdatedAt = now
		user = *current
		return nil
	})
	if err != nil {
		switch {
		case errors.Is(err, errGoogleIdentityConflict):
			s.writeError(w, r, http.StatusConflict, "identity_conflict", "This Google identity is already linked to another account", nil)
		case errors.Is(err, errGoogleEmailMismatch):
			s.writeError(w, r, http.StatusConflict, "email_mismatch", "The Google email must match the signed-in account email", nil)
		case err.Error() == "membership not found":
			s.writeError(w, r, http.StatusNotFound, "membership_not_found", "Account membership was not found", nil)
		default:
			s.storageFailure(w, r, err)
		}
		return
	}
	s.sendWelcomeIfNeeded(r.Context(), user)
	s.writeData(w, http.StatusOK, map[string]any{"linked": true, "provider": "google", "user": safeUser(user)})
}

func (s *Server) verifiedGoogleClaims(w http.ResponseWriter, r *http.Request, credential string) (googleauth.Claims, bool) {
	if !s.google.Enabled() {
		s.writeError(w, r, http.StatusServiceUnavailable, "google_auth_not_configured", "Google sign-in is not configured", nil)
		return googleauth.Claims{}, false
	}
	claims, err := s.google.Verify(r.Context(), strings.TrimSpace(credential))
	if err != nil {
		s.logger.Warn("Google credential verification failed", "error", err, "request_id", requestID(r.Context()))
		s.writeError(w, r, http.StatusUnauthorized, "invalid_google_credential", "The Google credential is invalid or expired", nil)
		return googleauth.Claims{}, false
	}
	claims.Email = normalizeEmail(claims.Email)
	parsedEmail, err := mail.ParseAddress(claims.Email)
	if err != nil || !strings.EqualFold(parsedEmail.Address, claims.Email) || len(claims.Email) > 254 {
		s.writeError(w, r, http.StatusUnauthorized, "invalid_google_credential", "The Google credential is invalid or expired", nil)
		return googleauth.Claims{}, false
	}
	return claims, true
}

func googleDisplayName(name, email string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		name = strings.SplitN(email, "@", 2)[0]
	}
	runes := []rune(name)
	if len(runes) > 120 {
		name = string(runes[:120])
	}
	if name == "" {
		return "Google user"
	}
	return name
}
