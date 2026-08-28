package api

import (
	"context"
	"net/http"
	"net/mail"
	"strings"
	"time"

	"garuda/backend/internal/model"
	"garuda/backend/internal/security"
)

type verifyEmailRequest struct {
	Token string `json:"token"`
}

func (s *Server) verifyEmail(w http.ResponseWriter, r *http.Request) {
	var input verifyEmailRequest
	if !s.decodeJSON(w, r, &input) {
		return
	}
	rawToken := strings.TrimSpace(input.Token)
	if len(rawToken) < 16 || len(rawToken) > 4096 {
		s.writeError(w, r, http.StatusUnprocessableEntity, "invalid_verification_token", "The verification token is invalid or expired", nil)
		return
	}
	tokenHash := security.HashOpaqueToken(rawToken)
	now := time.Now().UTC()
	verified := false
	becameVerified := false
	accessToken := ""
	refreshToken := ""
	var user model.User
	err := s.store.Update(func(state *model.State) error {
		matched := -1
		for index := range state.EmailVerifications {
			candidate := &state.EmailVerifications[index]
			if candidate.UsedAt == nil && candidate.ExpiresAt.After(now) && constantStringEqual(candidate.TokenHash, tokenHash) {
				matched = index
			}
		}
		if matched < 0 {
			return nil
		}
		verification := &state.EmailVerifications[matched]
		storedUser, found := findUser(state, verification.UserID)
		if !found || storedUser.PasswordHash == "" {
			return nil
		}
		var refresh model.RefreshSession
		var sessionErr error
		accessToken, refreshToken, refresh, sessionErr = s.newLocalSession(*storedUser, now)
		if sessionErr != nil {
			return sessionErr
		}
		if storedUser.EmailVerifiedAt == nil {
			storedUser.EmailVerifiedAt = &now
			storedUser.UpdatedAt = now
			becameVerified = true
		}
		for index := range state.EmailVerifications {
			if state.EmailVerifications[index].UserID == storedUser.ID && state.EmailVerifications[index].UsedAt == nil {
				state.EmailVerifications[index].UsedAt = &now
			}
		}
		pruneRefreshSessions(state, now)
		state.RefreshSessions = append(state.RefreshSessions, refresh)
		user = *storedUser
		verified = true
		pruneEmailVerifications(state, now)
		return nil
	})
	if err != nil {
		s.storageFailure(w, r, err)
		return
	}
	if !verified {
		s.writeError(w, r, http.StatusUnprocessableEntity, "invalid_verification_token", "The verification token is invalid or expired", nil)
		return
	}
	if becameVerified {
		s.sendWelcomeIfNeeded(r.Context(), user)
	}
	s.writeData(w, http.StatusOK, map[string]any{
		"message": "Email verified", "access_token": accessToken, "refresh_token": refreshToken,
		"token_type": "Bearer", "expires_in": int(s.cfg.AccessTokenTTL.Seconds()), "user": safeUser(user),
	})
}

type resendVerificationRequest struct {
	Email string `json:"email"`
}

func (s *Server) resendVerification(w http.ResponseWriter, r *http.Request) {
	var input resendVerificationRequest
	if !s.decodeJSON(w, r, &input) {
		return
	}
	message := map[string]string{"message": "If verification is needed, a new email has been sent."}
	email := normalizeEmail(input.Email)
	parsed, parseErr := mail.ParseAddress(email)
	validEmail := parseErr == nil && strings.EqualFold(parsed.Address, email) && len(email) <= 254
	if !validEmail {
		s.writeData(w, http.StatusAccepted, message)
		return
	}
	allowed, reserveErr := s.reserveAuthDelivery(email, "verification", time.Now().UTC())
	if reserveErr != nil {
		s.logger.Error("verification resend throttle could not be stored", "error", reserveErr, "request_id", requestID(r.Context()))
		s.writeData(w, http.StatusAccepted, message)
		return
	}
	if !allowed {
		s.writeData(w, http.StatusAccepted, message)
		return
	}
	if s.supabase.Enabled() {
		if err := s.supabase.ResendSignup(r.Context(), email); err != nil {
			s.logger.Warn("Supabase verification resend failed", "error", err, "request_id", requestID(r.Context()))
		}
		s.writeData(w, http.StatusAccepted, message)
		return
	}
	if s.cfg.DemoMode || !s.mailer.Enabled() {
		s.writeData(w, http.StatusAccepted, message)
		return
	}
	var user model.User
	found := false
	_ = s.store.View(func(state *model.State) error {
		for _, candidate := range state.Users {
			if normalizeEmail(candidate.Email) == email && candidate.EmailVerifiedAt == nil && candidate.PasswordHash != "" {
				user, found = candidate, true
				break
			}
		}
		return nil
	})
	if found {
		rawToken, err := security.RandomToken(32)
		if err == nil {
			now := time.Now().UTC()
			record := model.EmailVerification{
				ID: newID("evf_"), UserID: user.ID, TokenHash: security.HashOpaqueToken(rawToken),
				ExpiresAt: now.Add(s.emailVerificationTTL()), CreatedAt: now,
			}
			if updateErr := s.store.Update(func(state *model.State) error {
				for index := range state.EmailVerifications {
					if state.EmailVerifications[index].UserID == user.ID && state.EmailVerifications[index].UsedAt == nil {
						state.EmailVerifications[index].UsedAt = &now
					}
				}
				state.EmailVerifications = append(state.EmailVerifications, record)
				pruneEmailVerifications(state, now)
				return nil
			}); updateErr != nil {
				s.logger.Error("verification resend could not be stored", "error", updateErr, "request_id", requestID(r.Context()))
			} else if sendErr := s.mailer.SendVerification(r.Context(), user.Email, user.Name, s.cfg.AuthVerifyURL, rawToken); sendErr != nil {
				s.logger.Warn("verification resend delivery failed", "error", sendErr, "request_id", requestID(r.Context()))
			}
		}
	}
	s.writeData(w, http.StatusAccepted, message)
}

func (s *Server) sendWelcomeIfNeeded(ctx context.Context, user model.User) {
	if user.EmailVerifiedAt == nil || user.WelcomeSentAt != nil || !s.mailer.Enabled() {
		return
	}
	if err := s.mailer.SendWelcome(ctx, user.Email, user.Name); err != nil {
		s.logger.Warn("welcome email delivery failed", "error", err)
		return
	}
	now := time.Now().UTC()
	if err := s.store.Update(func(state *model.State) error {
		candidate, found := findUser(state, user.ID)
		if found && candidate.WelcomeSentAt == nil {
			candidate.WelcomeSentAt = &now
			candidate.UpdatedAt = now
		}
		return nil
	}); err != nil {
		s.logger.Error("welcome email status could not be stored", "error", err)
	}
}

func (s *Server) emailVerificationTTL() time.Duration {
	if s.cfg.EmailVerificationTTL > 0 {
		return s.cfg.EmailVerificationTTL
	}
	return 24 * time.Hour
}

func pruneEmailVerifications(state *model.State, now time.Time) {
	cutoff := now.Add(-7 * 24 * time.Hour)
	retained := state.EmailVerifications[:0]
	for _, verification := range state.EmailVerifications {
		if verification.ExpiresAt.After(cutoff) {
			retained = append(retained, verification)
		}
	}
	state.EmailVerifications = retained
}

func (s *Server) reserveAuthDelivery(email, purpose string, now time.Time) (bool, error) {
	keyHash := security.HashScopedToken([]byte(s.cfg.JWTSecret), "auth-delivery:"+purpose, normalizeEmail(email))
	allowed := false
	err := s.store.Update(func(state *model.State) error {
		for index := range state.AuthDeliveryAttempts {
			attempt := &state.AuthDeliveryAttempts[index]
			if attempt.Purpose == purpose && constantStringEqual(attempt.KeyHash, keyHash) {
				if attempt.LastAttemptAt.Add(time.Minute).After(now) {
					return nil
				}
				attempt.LastAttemptAt = now
				allowed = true
				return nil
			}
		}
		state.AuthDeliveryAttempts = append(state.AuthDeliveryAttempts, model.AuthDeliveryAttempt{KeyHash: keyHash, Purpose: purpose, LastAttemptAt: now})
		allowed = true
		cutoff := now.Add(-7 * 24 * time.Hour)
		retained := state.AuthDeliveryAttempts[:0]
		for _, attempt := range state.AuthDeliveryAttempts {
			if attempt.LastAttemptAt.After(cutoff) {
				retained = append(retained, attempt)
			}
		}
		state.AuthDeliveryAttempts = retained
		return nil
	})
	return allowed, err
}
