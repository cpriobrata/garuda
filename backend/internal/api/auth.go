package api

import (
	"errors"
	"net/http"
	"net/mail"
	"strings"
	"time"

	"garuda/backend/internal/model"
	"garuda/backend/internal/security"
)

type signUpRequest struct {
	Name         string `json:"name"`
	Email        string `json:"email"`
	Password     string `json:"password"`
	BusinessName string `json:"business_name,omitempty"`
}

var timingSafeDummyPasswordHash = func() string {
	hash, err := security.HashPassword("garuda-nonexistent-account-password")
	if err != nil {
		panic("initialize password timing defense: " + err.Error())
	}
	return hash
}()

func (s *Server) signUp(w http.ResponseWriter, r *http.Request) {
	var input signUpRequest
	if !s.decodeJSON(w, r, &input) {
		return
	}
	input.Name = strings.TrimSpace(input.Name)
	input.Email = normalizeEmail(input.Email)
	input.BusinessName = strings.TrimSpace(input.BusinessName)
	if input.Name == "" || len(input.Name) > 120 {
		s.writeError(w, r, http.StatusUnprocessableEntity, "validation_failed", "Please provide your name", map[string]string{"name": "required, up to 120 characters"})
		return
	}
	if _, err := mail.ParseAddress(input.Email); err != nil || len(input.Email) > 254 {
		s.writeError(w, r, http.StatusUnprocessableEntity, "validation_failed", "Please provide a valid email address", map[string]string{"email": "invalid"})
		return
	}
	if len(input.Password) < 8 || len(input.Password) > 256 {
		s.writeError(w, r, http.StatusUnprocessableEntity, "validation_failed", "Password must contain 8 to 256 characters", map[string]string{"password": "invalid length"})
		return
	}
	alreadyExists := false
	_ = s.store.View(func(state *model.State) error {
		for _, user := range state.Users {
			if normalizeEmail(user.Email) == input.Email {
				alreadyExists = true
				break
			}
		}
		return nil
	})
	if alreadyExists {
		s.writeError(w, r, http.StatusConflict, "email_exists", "An account already exists for this email", nil)
		return
	}

	now := time.Now().UTC()
	accountName := input.BusinessName
	if accountName == "" {
		accountName = input.Name + "'s workspace"
	}
	account := model.Account{ID: newID("org_"), Name: accountName, Slug: slugify(accountName), Plan: "starter_17", BillingStatus: "incomplete", CreatedAt: now, UpdatedAt: now}
	user := model.User{ID: newID("usr_"), AccountID: account.ID, Name: input.Name, Email: input.Email, Role: "owner", CreatedAt: now, UpdatedAt: now}
	accessToken := ""
	refreshToken := ""
	expiresIn := int(s.cfg.AccessTokenTTL.Seconds())
	verificationRequired := false
	var localRefresh *model.RefreshSession
	var verification *model.EmailVerification
	verificationToken := ""

	if s.supabase.Enabled() {
		response, err := s.supabase.SignUp(r.Context(), input.Email, input.Password, input.Name)
		if err != nil {
			s.writeError(w, r, http.StatusBadGateway, "auth_provider_error", "The account could not be created", nil)
			return
		}
		if response.User.ID == "" {
			s.writeError(w, r, http.StatusBadGateway, "auth_provider_error", "The authentication provider returned an incomplete account", nil)
			return
		}
		user.ExternalAuthID = response.User.ID
		user.PasswordHash = ""
		accessToken, refreshToken, expiresIn = response.AccessToken, response.RefreshToken, response.ExpiresIn
		verificationRequired = accessToken == ""
		if !verificationRequired {
			user.EmailVerifiedAt = &now
		}
	} else {
		passwordHash, err := security.HashPassword(input.Password)
		if err != nil {
			s.writeError(w, r, http.StatusUnprocessableEntity, "validation_failed", err.Error(), nil)
			return
		}
		user.PasswordHash = passwordHash
		if s.cfg.DemoMode {
			user.EmailVerifiedAt = &now
			var refresh model.RefreshSession
			accessToken, refreshToken, refresh, err = s.newLocalSession(user, now)
			if err != nil {
				s.writeError(w, r, http.StatusInternalServerError, "token_error", "The account was created but a session could not be issued", nil)
				return
			}
			localRefresh = &refresh
		} else {
			verificationToken, err = security.RandomToken(32)
			if err != nil {
				s.writeError(w, r, http.StatusInternalServerError, "token_error", "The account could not be prepared for verification", nil)
				return
			}
			verificationRequired = true
			verification = &model.EmailVerification{
				ID: newID("evf_"), UserID: user.ID, TokenHash: security.HashOpaqueToken(verificationToken),
				ExpiresAt: now.Add(s.emailVerificationTTL()), CreatedAt: now,
			}
		}
	}
	subscription := model.Subscription{ID: newID("sub_"), AccountID: account.ID, Status: "incomplete", Plan: "starter_17", CreatedAt: now, UpdatedAt: now}
	if err := s.store.Update(func(state *model.State) error {
		for _, candidate := range state.Users {
			if normalizeEmail(candidate.Email) == input.Email {
				return errors.New("email already exists")
			}
		}
		state.Accounts = append(state.Accounts, account)
		state.Users = append(state.Users, user)
		state.Subscriptions = append(state.Subscriptions, subscription)
		if localRefresh != nil {
			state.RefreshSessions = append(state.RefreshSessions, *localRefresh)
		}
		if verification != nil {
			state.EmailVerifications = append(state.EmailVerifications, *verification)
		}
		return nil
	}); err != nil {
		if err.Error() == "email already exists" {
			s.writeError(w, r, http.StatusConflict, "email_exists", "An account already exists for this email", nil)
			return
		}
		s.storageFailure(w, r, err)
		return
	}
	if verification != nil {
		if err := s.mailer.SendVerification(r.Context(), user.Email, user.Name, s.cfg.AuthVerifyURL, verificationToken); err != nil {
			s.logger.Error("verification email delivery failed", "error", err, "request_id", requestID(r.Context()))
			s.writeError(w, r, http.StatusServiceUnavailable, "verification_email_failed", "The account was created, but the verification email could not be sent. Please use resend verification.", nil)
			return
		}
	}
	response := map[string]any{
		"verification_required": verificationRequired, "user": safeUser(user), "organization": account,
	}
	if accessToken != "" {
		response["access_token"] = accessToken
		response["refresh_token"] = refreshToken
		response["token_type"] = "Bearer"
		response["expires_in"] = expiresIn
	}
	s.writeData(w, http.StatusCreated, response)
}

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	var input loginRequest
	if !s.decodeJSON(w, r, &input) {
		return
	}
	input.Email = normalizeEmail(input.Email)
	if input.Email == "" || input.Password == "" {
		s.writeError(w, r, http.StatusUnprocessableEntity, "validation_failed", "Email and password are required", nil)
		return
	}
	if s.supabase.Enabled() {
		response, err := s.supabase.SignIn(r.Context(), input.Email, input.Password)
		if err != nil {
			s.writeError(w, r, http.StatusUnauthorized, "invalid_credentials", "Email or password is incorrect", nil)
			return
		}
		// A blank subject must never match. Users created through local auth carry an
		// empty ExternalAuthID, so a provider response without an id would otherwise
		// sign the caller in as the first such account, wrong password and all.
		externalSubject := strings.TrimSpace(response.User.ID)
		if externalSubject == "" {
			s.logger.Error("authentication provider returned a sign in without a subject", "request_id", requestID(r.Context()))
			s.writeError(w, r, http.StatusUnauthorized, "invalid_credentials", "Email or password is incorrect", nil)
			return
		}
		var user model.User
		found := false
		now := time.Now().UTC()
		if err := s.store.Update(func(state *model.State) error {
			for index := range state.Users {
				candidate := &state.Users[index]
				if candidate.ExternalAuthID == externalSubject {
					if candidate.EmailVerifiedAt == nil {
						candidate.EmailVerifiedAt = &now
						candidate.UpdatedAt = now
					}
					user, found = *candidate, true
					break
				}
			}
			return nil
		}); err != nil {
			s.storageFailure(w, r, err)
			return
		}
		if !found {
			s.writeError(w, r, http.StatusForbidden, "membership_missing", "This identity has no Garuda organization membership", nil)
			return
		}
		s.sendWelcomeIfNeeded(r.Context(), user)
		s.writeData(w, http.StatusOK, map[string]any{"access_token": response.AccessToken, "refresh_token": response.RefreshToken, "expires_in": response.ExpiresIn, "user": safeUser(user)})
		return
	}
	var user model.User
	found := false
	_ = s.store.View(func(state *model.State) error {
		for _, candidate := range state.Users {
			if normalizeEmail(candidate.Email) == input.Email {
				user, found = candidate, true
				break
			}
		}
		return nil
	})
	passwordHash := timingSafeDummyPasswordHash
	if found && user.PasswordHash != "" {
		passwordHash = user.PasswordHash
	}
	passwordValid := security.VerifyPassword(passwordHash, input.Password)
	if !found || !passwordValid || user.PasswordHash == "" {
		s.writeError(w, r, http.StatusUnauthorized, "invalid_credentials", "Email or password is incorrect", nil)
		return
	}
	if !s.cfg.DemoMode && user.EmailVerifiedAt == nil {
		s.writeError(w, r, http.StatusForbidden, "email_not_verified", "Verify your email before signing in", map[string]string{"resend_endpoint": "/v1/auth/resend-verification"})
		return
	}
	token, refreshToken, refreshSession, err := s.newLocalSession(user, time.Now().UTC())
	if err != nil {
		s.writeError(w, r, http.StatusInternalServerError, "token_error", "A session could not be issued", nil)
		return
	}
	if err := s.store.Update(func(state *model.State) error {
		pruneRefreshSessions(state, time.Now().UTC())
		state.RefreshSessions = append(state.RefreshSessions, refreshSession)
		return nil
	}); err != nil {
		s.storageFailure(w, r, err)
		return
	}
	s.sendWelcomeIfNeeded(r.Context(), user)
	s.writeData(w, http.StatusOK, map[string]any{"access_token": token, "refresh_token": refreshToken, "token_type": "Bearer", "expires_in": int(s.cfg.AccessTokenTTL.Seconds()), "user": safeUser(user)})
}

type refreshSessionRequest struct {
	RefreshToken string `json:"refresh_token"`
}

const localRefreshPrefix = "grt1_"

func (s *Server) refreshSession(w http.ResponseWriter, r *http.Request) {
	var input refreshSessionRequest
	if !s.decodeJSON(w, r, &input) {
		return
	}
	input.RefreshToken = strings.TrimSpace(input.RefreshToken)
	if len(input.RefreshToken) < 16 || len(input.RefreshToken) > 4096 {
		s.writeError(w, r, http.StatusUnauthorized, "invalid_refresh_token", "The refresh token is invalid or expired", nil)
		return
	}
	recognized, rotated, accessToken, newRefreshToken, user, err := s.rotateLocalRefresh(input.RefreshToken, time.Now().UTC())
	if err != nil {
		s.storageFailure(w, r, err)
		return
	}
	if recognized {
		if !rotated {
			s.writeError(w, r, http.StatusUnauthorized, "invalid_refresh_token", "The refresh token is invalid or expired", nil)
			return
		}
		s.writeData(w, http.StatusOK, map[string]any{"access_token": accessToken, "refresh_token": newRefreshToken, "token_type": "Bearer", "expires_in": int(s.cfg.AccessTokenTTL.Seconds()), "user": safeUser(user)})
		return
	}
	if strings.HasPrefix(input.RefreshToken, localRefreshPrefix) {
		s.writeError(w, r, http.StatusUnauthorized, "invalid_refresh_token", "The refresh token is invalid or expired", nil)
		return
	}
	if s.supabase.Enabled() {
		response, err := s.supabase.Refresh(r.Context(), input.RefreshToken)
		if err != nil || response.AccessToken == "" || response.RefreshToken == "" {
			s.writeError(w, r, http.StatusUnauthorized, "invalid_refresh_token", "The refresh token is invalid or expired", nil)
			return
		}
		externalUser := response.User
		if externalUser.ID == "" {
			externalUser, err = s.supabase.User(r.Context(), response.AccessToken)
			if err != nil {
				s.writeError(w, r, http.StatusUnauthorized, "invalid_refresh_token", "The refresh token is invalid or expired", nil)
				return
			}
		}
		var user model.User
		found := false
		_ = s.store.View(func(state *model.State) error {
			for _, candidate := range state.Users {
				if candidate.ExternalAuthID == externalUser.ID {
					user, found = candidate, true
					break
				}
			}
			return nil
		})
		if !found {
			s.writeError(w, r, http.StatusUnauthorized, "invalid_refresh_token", "The refresh token is invalid or expired", nil)
			return
		}
		s.writeData(w, http.StatusOK, map[string]any{"access_token": response.AccessToken, "refresh_token": response.RefreshToken, "token_type": "Bearer", "expires_in": response.ExpiresIn, "user": safeUser(user)})
		return
	}
	s.writeError(w, r, http.StatusUnauthorized, "invalid_refresh_token", "The refresh token is invalid or expired", nil)
}

func (s *Server) rotateLocalRefresh(rawToken string, now time.Time) (recognized, rotated bool, accessToken, newRawToken string, user model.User, err error) {
	tokenHash := security.HashOpaqueToken(rawToken)
	err = s.store.Update(func(state *model.State) error {
		for index := range state.RefreshSessions {
			current := &state.RefreshSessions[index]
			if !constantStringEqual(current.TokenHash, tokenHash) {
				continue
			}
			recognized = true
			familyID := current.FamilyID
			if familyID == "" {
				familyID = current.ID
			}
			if current.UsedAt != nil || current.RevokedAt != nil {
				for familyIndex := range state.RefreshSessions {
					family := &state.RefreshSessions[familyIndex]
					candidateFamily := family.FamilyID
					if candidateFamily == "" {
						candidateFamily = family.ID
					}
					if candidateFamily == familyID && family.RevokedAt == nil {
						family.RevokedAt = &now
					}
				}
				break
			}
			if !current.ExpiresAt.After(now) {
				break
			}
			candidate, ok := findUser(state, current.UserID)
			if !ok {
				break
			}
			if !s.cfg.DemoMode && candidate.EmailVerifiedAt == nil {
				break
			}
			accessToken, err = s.issueToken(*candidate)
			if err != nil {
				return err
			}
			opaque, randomErr := security.RandomToken(32)
			if randomErr != nil {
				return randomErr
			}
			newRawToken = localRefreshPrefix + opaque
			newSessionID := newID("rfs_")
			user = *candidate
			current.UsedAt = &now
			current.ReplacedByID = newSessionID
			state.RefreshSessions = append(state.RefreshSessions, model.RefreshSession{
				ID: newSessionID, FamilyID: familyID, UserID: user.ID, TokenHash: security.HashOpaqueToken(newRawToken),
				ExpiresAt: now.Add(s.refreshTokenTTL()), CreatedAt: now,
			})
			rotated = true
			break
		}
		pruneRefreshSessions(state, now)
		return nil
	})
	return
}

type forgotPasswordRequest struct {
	Email string `json:"email"`
}

const localPasswordResetPrefix = "grst1_"

func (s *Server) forgotPassword(w http.ResponseWriter, r *http.Request) {
	var input forgotPasswordRequest
	if !s.decodeJSON(w, r, &input) {
		return
	}
	input.Email = normalizeEmail(input.Email)
	response := map[string]any{"message": "If an account exists, password reset instructions have been sent."}
	parsedEmail, emailErr := mail.ParseAddress(input.Email)
	if emailErr != nil || !strings.EqualFold(parsedEmail.Address, input.Email) || len(input.Email) > 254 {
		s.writeData(w, http.StatusAccepted, response)
		return
	}
	allowed, reserveErr := s.reserveAuthDelivery(input.Email, "password_reset", time.Now().UTC())
	if reserveErr != nil {
		s.logger.Error("password reset throttle could not be stored", "error", reserveErr, "request_id", requestID(r.Context()))
		s.writeData(w, http.StatusAccepted, response)
		return
	}
	if !allowed {
		s.writeData(w, http.StatusAccepted, response)
		return
	}
	if s.supabase.Enabled() {
		_ = s.supabase.Recover(r.Context(), input.Email, s.cfg.AuthResetURL)
		s.writeData(w, http.StatusAccepted, response)
		return
	}
	var user model.User
	found := false
	_ = s.store.View(func(state *model.State) error {
		for _, candidate := range state.Users {
			if normalizeEmail(candidate.Email) == input.Email {
				user, found = candidate, true
			}
		}
		return nil
	})
	if found {
		opaqueToken, err := security.RandomToken(32)
		if err == nil {
			rawToken := localPasswordResetPrefix + opaqueToken
			now := time.Now().UTC()
			reset := model.PasswordReset{ID: newID("rst_"), UserID: user.ID, TokenHash: security.HashOpaqueToken(rawToken), ExpiresAt: now.Add(s.cfg.PasswordResetTTL), CreatedAt: now}
			storeErr := s.store.Update(func(state *model.State) error {
				for index := range state.PasswordResets {
					if state.PasswordResets[index].UserID == user.ID && state.PasswordResets[index].UsedAt == nil {
						state.PasswordResets[index].UsedAt = &now
					}
				}
				state.PasswordResets = append(state.PasswordResets, reset)
				return nil
			})
			if storeErr != nil {
				s.logger.Error("password reset request could not be stored", "error", storeErr, "request_id", requestID(r.Context()))
			} else if s.cfg.DemoMode && s.cfg.ExposeResetToken {
				response["demo_reset_token"] = rawToken
			} else if !s.cfg.DemoMode && s.mailer.Enabled() {
				if sendErr := s.mailer.SendPasswordReset(r.Context(), user.Email, user.Name, s.cfg.AuthResetURL, rawToken); sendErr != nil {
					s.logger.Warn("password reset email delivery failed", "error", sendErr, "request_id", requestID(r.Context()))
				}
			}
		}
	}
	s.writeData(w, http.StatusAccepted, response)
}

type resetPasswordRequest struct {
	Token    string `json:"token,omitempty"`
	Password string `json:"password"`
}

func (s *Server) resetPassword(w http.ResponseWriter, r *http.Request) {
	var input resetPasswordRequest
	if !s.decodeJSON(w, r, &input) {
		return
	}
	if len(input.Password) < 8 || len(input.Password) > 256 {
		s.writeError(w, r, http.StatusUnprocessableEntity, "validation_failed", "Password must contain 8 to 256 characters", nil)
		return
	}
	rawToken := strings.TrimSpace(input.Token)
	if s.supabase.Enabled() && !strings.HasPrefix(rawToken, localPasswordResetPrefix) {
		authorization := r.Header.Get("Authorization")
		recoveryToken := rawToken
		if strings.HasPrefix(strings.ToLower(authorization), "bearer ") {
			recoveryToken = strings.TrimSpace(authorization[7:])
		}
		if recoveryToken == "" {
			s.writeError(w, r, http.StatusUnauthorized, "recovery_session_required", "A Supabase recovery access token is required", nil)
			return
		}
		if err := s.supabase.UpdatePassword(r.Context(), recoveryToken, input.Password); err != nil {
			s.writeError(w, r, http.StatusUnauthorized, "invalid_reset_token", "The recovery session is invalid or expired", nil)
			return
		}
		s.writeData(w, http.StatusOK, map[string]string{"message": "Password updated"})
		return
	}
	passwordHash, err := security.HashPassword(input.Password)
	if err != nil {
		s.writeError(w, r, http.StatusUnprocessableEntity, "validation_failed", err.Error(), nil)
		return
	}
	if rawToken == "" {
		s.writeError(w, r, http.StatusUnprocessableEntity, "invalid_reset_token", "The password reset token is invalid or expired", nil)
		return
	}
	tokenHash := security.HashOpaqueToken(rawToken)
	updated := false
	err = s.store.Update(func(state *model.State) error {
		now := time.Now().UTC()
		for index := range state.PasswordResets {
			reset := &state.PasswordResets[index]
			if reset.UsedAt == nil && reset.ExpiresAt.After(now) && constantStringEqual(reset.TokenHash, tokenHash) {
				user, ok := findUser(state, reset.UserID)
				if !ok {
					return nil
				}
				user.PasswordHash = passwordHash
				user.AuthVersion++
				user.UpdatedAt = now
				for resetIndex := range state.PasswordResets {
					if state.PasswordResets[resetIndex].UserID == user.ID && state.PasswordResets[resetIndex].UsedAt == nil {
						state.PasswordResets[resetIndex].UsedAt = &now
					}
				}
				activeRefresh := state.RefreshSessions[:0]
				for _, session := range state.RefreshSessions {
					if session.UserID != user.ID {
						activeRefresh = append(activeRefresh, session)
					}
				}
				state.RefreshSessions = activeRefresh
				updated = true
				break
			}
		}
		return nil
	})
	if err != nil {
		s.storageFailure(w, r, err)
		return
	}
	if !updated {
		s.writeError(w, r, http.StatusUnprocessableEntity, "invalid_reset_token", "The password reset token is invalid or expired", nil)
		return
	}
	s.writeData(w, http.StatusOK, map[string]string{"message": "Password updated"})
}

func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	identity := identityFrom(r.Context())
	var user model.User
	var account model.Account
	var subscription model.Subscription
	var onboarding *model.Onboarding
	found := false
	_ = s.store.View(func(state *model.State) error {
		if candidate, ok := findUser(state, identity.UserID); ok {
			user, found = *candidate, true
		}
		if candidate, ok := findAccount(state, identity.AccountID); ok {
			account = *candidate
		}
		for _, candidate := range state.Subscriptions {
			if candidate.AccountID == identity.AccountID {
				subscription = candidate
			}
		}
		for _, candidate := range state.Onboarding {
			if candidate.AccountID == identity.AccountID {
				copy := candidate.Clone()
				onboarding = &copy
			}
		}
		return nil
	})
	if !found {
		s.writeError(w, r, http.StatusNotFound, "account_not_found", "Account membership was not found", nil)
		return
	}
	onboardingStatus := map[string]any{"status": "not_started", "completed_at": nil, "answered": 0, "required": 4}
	if onboarding != nil {
		answered := onboardingAnswered(*onboarding)
		onboardingStatus = map[string]any{"status": "in_progress", "completed_at": onboarding.CompletedAt, "answered": answered, "required": 4}
		if onboarding.CompletedAt != nil {
			onboardingStatus["status"] = "completed"
		}
	}
	subscriptionPayload := s.subscriptionView(account, subscription, s.hasEntitlement(identity.AccountID))
	organization := map[string]any{"id": account.ID, "name": account.Name, "role": user.Role}
	s.writeData(w, http.StatusOK, map[string]any{
		"user": safeUser(user), "organization": organization, "organizations": []any{organization},
		"subscription": subscriptionPayload, "onboarding": onboardingStatus,
	})
}

func (s *Server) issueToken(user model.User) (string, error) {
	now := time.Now().UTC()
	return security.SignJWT([]byte(s.cfg.JWTSecret), security.Claims{
		Subject: user.ID, AccountID: user.AccountID, Email: user.Email, Role: user.Role, AuthVersion: user.AuthVersion,
		IssuedAt: now.Unix(), ExpiresAt: now.Add(s.cfg.AccessTokenTTL).Unix(),
	})
}

func (s *Server) newLocalSession(user model.User, now time.Time) (string, string, model.RefreshSession, error) {
	accessToken, err := s.issueToken(user)
	if err != nil {
		return "", "", model.RefreshSession{}, err
	}
	opaqueRefresh, err := security.RandomToken(32)
	if err != nil {
		return "", "", model.RefreshSession{}, err
	}
	rawRefresh := localRefreshPrefix + opaqueRefresh
	refreshID := newID("rfs_")
	refresh := model.RefreshSession{
		ID: refreshID, FamilyID: refreshID, UserID: user.ID, TokenHash: security.HashOpaqueToken(rawRefresh),
		ExpiresAt: now.Add(s.refreshTokenTTL()), CreatedAt: now,
	}
	return accessToken, rawRefresh, refresh, nil
}

func (s *Server) refreshTokenTTL() time.Duration {
	if s.cfg.RefreshTokenTTL > 0 {
		return s.cfg.RefreshTokenTTL
	}
	return 30 * 24 * time.Hour
}

func pruneRefreshSessions(state *model.State, now time.Time) {
	familyExpires := make(map[string]time.Time, len(state.RefreshSessions))
	for _, session := range state.RefreshSessions {
		familyID := session.FamilyID
		if familyID == "" {
			familyID = session.ID
		}
		if session.ExpiresAt.After(familyExpires[familyID]) {
			familyExpires[familyID] = session.ExpiresAt
		}
	}
	active := state.RefreshSessions[:0]
	for _, session := range state.RefreshSessions {
		familyID := session.FamilyID
		if familyID == "" {
			familyID = session.ID
		}
		// Keep used ancestors while any descendant in their family remains
		// valid, so replay detection can revoke a stolen rotated token.
		if session.ExpiresAt.After(now) || familyExpires[familyID].After(now) {
			active = append(active, session)
		}
	}
	state.RefreshSessions = active
}

func slugify(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	var builder strings.Builder
	dash := false
	for _, character := range value {
		if character >= 'a' && character <= 'z' || character >= '0' && character <= '9' {
			builder.WriteRune(character)
			dash = false
		} else if !dash && builder.Len() > 0 {
			builder.WriteByte('-')
			dash = true
		}
	}
	result := strings.Trim(builder.String(), "-")
	if result == "" {
		result = "workspace"
	}
	return result + "-" + strings.ToLower(newID("")[0:6])
}
