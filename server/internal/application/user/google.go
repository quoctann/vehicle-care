package user

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"strings"
	"time"

	app "github.com/quoctann/vehicle-care/server/internal/application"
	"golang.org/x/crypto/bcrypt"
)

type GoogleService struct {
	user     *Service
	ports    IGooglePorts
	provider IGoogleProvider
}

func NewGoogleService(u *Service, p IGooglePorts, provider IGoogleProvider) *GoogleService {
	return &GoogleService{user: u, ports: p, provider: provider}
}

type GoogleResult struct {
	Purpose   string
	SessionID string
	CSRFToken string
}
type googleError string

func (e googleError) Error() string { return string(e) }

// GoogleErrorCode converts internal failures to the stable public codes used
// by JSON responses and frontend redirects. Unknown errors deliberately collapse
// to "failed" so provider and infrastructure details are not exposed.
func GoogleErrorCode(err error) string {
	var e googleError
	if errors.As(err, &e) {
		return string(e)
	}

	for _, v := range []error{ErrGoogleEmailExists, ErrGoogleIdentityLinked, ErrGoogleAlreadyLinked} {
		if errors.Is(err, v) {
			return v.Error()
		}
	}

	return "failed"
}

func randomOAuth() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic("secure randomness unavailable")
	}

	return base64.RawURLEncoding.EncodeToString(b)
}

// NewGoogleBrowserBinding returns an opaque value stored in both Redis and an
// HttpOnly transaction cookie; it is separate from the OAuth state and session.
func NewGoogleBrowserBinding() string { return randomOAuth() }

// Begin creates the server-side transaction for either login or account link.
// State identifies the transaction, nonce binds the resulting ID token, and the
// verifier stays here while only its PKCE challenge goes to Google. Linking also
// reauthenticates the password and snapshots the exact account/session version.
func (s *GoogleService) Begin(ctx context.Context, browser, purpose, sid, expected, password string) (string, error) {
	if s == nil || s.provider == nil {
		return "", googleError("unavailable")
	}

	gs := GoogleState{
		Browser:   browser,
		Purpose:   purpose,
		SessionID: sid,
		Nonce:     randomOAuth(),
		Verifier:  randomOAuth(),
	}

	if purpose == "link" {
		session, ok, err := s.user.ports.Session(ctx, sid, time.Now())
		if err != nil {
			return "", googleError("unavailable")
		}
		if !ok || session == nil || expected == "" || expected != session.AccountID {
			return "", &app.Error{Code: app.ErrConflict, Message: "Account changed. Sign in again."}
		}

		acc, err := s.user.ports.AccountByID(ctx, session.AccountID)
		if err != nil {
			return "", googleError("unavailable")
		}
		if acc == nil || session.AuthVersion <= 0 ||
			session.AuthVersion != acc.AuthVersion || len(password) > 72 ||
			bcrypt.CompareHashAndPassword(acc.PasswordHash, []byte(password)) != nil {
			return "", &app.Error{Code: app.ErrAuthInvalid, Message: "Invalid credentials."}
		}

		linked, err := s.ports.GoogleLinked(ctx, acc.ID)
		if err != nil {
			return "", googleError("unavailable")
		}
		if linked {
			return "", ErrGoogleAlreadyLinked
		}
		gs.AccountID = acc.ID
		gs.AuthVersion = acc.AuthVersion
	} else if purpose != "login" {
		return "", googleError("failed")
	}

	// Purpose is only a redirect hint when the Redis record has expired.
	// Authentication always uses the bound, single-use stored transaction.
	state := purpose + "." + randomOAuth()
	if err := s.ports.SaveGoogleState(ctx, state, gs, GoogleStateTTL); err != nil {
		return "", googleError("unavailable")
	}

	return s.provider.AuthorizationURL(state, gs.Nonce, gs.Verifier), nil
}

// Complete consumes state before any provider work, then validates the browser
// and matching starting sid cookie. The state's purpose prefix is only a
// destination hint when no record remains; the stored record authorizes the
// operation. Link sessions are checked on both sides of the provider exchange
// to close races with logout, replacement, and auth-version changes.
func (s *GoogleService) Complete(ctx context.Context, key, browser, code string, cancelled bool, sid string) (GoogleResult, error) {
	rs := GoogleResult{Purpose: "login"}
	if strings.HasPrefix(key, "link.") {
		rs.Purpose = "link"
	}
	if s == nil || s.provider == nil {
		return rs, googleError("unavailable")
	}
	if key == "" || len(key) > 256 {
		return rs, googleError("expired")
	}

	gs, ok, err := s.ports.TakeGoogleState(ctx, key)
	if err != nil {
		return rs, googleError("unavailable")
	}
	if !ok {
		return rs, googleError("expired")
	}
	if gs.Purpose == "link" {
		rs.Purpose = "link"
	}
	if browser == "" || subtle.ConstantTimeCompare([]byte(gs.Browser), []byte(browser)) != 1 || gs.SessionID != sid {
		return rs, googleError("expired")
	}
	if cancelled {
		return rs, googleError("cancelled")
	}
	if code == "" || len(code) > 8192 {
		return rs, googleError("failed")
	}
	if gs.Purpose == "link" {
		if err := s.checkLinkSession(ctx, gs, sid); err != nil {
			return rs, err
		}
	}

	claims, err := s.provider.Verify(ctx, code, gs.Nonce, gs.Verifier)
	if err != nil {
		return rs, googleError("failed")
	}
	if claims.Subject == "" || len(claims.Subject) > 255 || !validEmail(claims.Email) {
		return rs, googleError("failed")
	}

	if gs.Purpose == "link" {
		if err := s.checkLinkSession(ctx, gs, sid); err != nil {
			return rs, err
		}
		err := s.ports.LinkGoogle(ctx, gs.AccountID, claims.Subject, gs.AuthVersion)
		if errors.Is(err, ErrAuthVersionChanged) {
			return rs, googleError("expired")
		}
		return rs, err
	}

	return s.completeGoogleLogin(ctx, claims, sid)
}

// completeGoogleLogin resolves the local account before creating the ordinary
// opaque application session. It then rotates any starting session; if old
// session deletion fails, it attempts to delete the new session before returning
// unavailable. PostgreSQL account creation and Redis session writes are not atomic.
func (s *GoogleService) completeGoogleLogin(ctx context.Context, claims GoogleClaims, sid string) (GoogleResult, error) {
	rs := GoogleResult{Purpose: "login"}
	acc, err := s.ports.GoogleAccount(ctx, claims.Subject, claims.Email, claims.Name, claims.EmailTrusted)
	if err != nil {
		return rs, err
	}

	rs.SessionID, rs.CSRFToken, err = s.user.createSession(ctx, *acc)
	if err != nil {
		return GoogleResult{Purpose: rs.Purpose}, googleError("unavailable")
	}

	if sid != "" {
		if err := s.user.ports.DeleteSession(ctx, sid); err != nil {
			_ = s.user.ports.DeleteSession(ctx, rs.SessionID)
			return GoogleResult{Purpose: rs.Purpose}, googleError("unavailable")
		}
	}

	return rs, nil
}

// checkLinkSession proves that the exact session reauthenticated in Begin is
// still active for the same account and auth version. AuthVersion binds the
// link to that credential generation, not merely to a still-valid account ID.
func (s *GoogleService) checkLinkSession(ctx context.Context, st GoogleState, sid string) error {
	session, ok, err := s.user.ports.Session(ctx, sid, time.Now())
	if err != nil {
		return googleError("unavailable")
	}
	if !ok || session == nil || session.AccountID != st.AccountID {
		return googleError("expired")
	}

	acc, err := s.user.ports.AccountByID(ctx, session.AccountID)
	if err != nil {
		return googleError("unavailable")
	}
	if acc == nil || st.AuthVersion <= 0 || session.AuthVersion != st.AuthVersion || session.AuthVersion != acc.AuthVersion {
		return googleError("expired")
	}

	return nil
}

// Status reports identity linkage and whether password reauthentication is
// possible. The HTTP layer separately adds whether Google OAuth is enabled.
func (s *GoogleService) Status(ctx context.Context, accountID string) (bool, bool, error) {
	a, err := s.user.ports.AccountByID(ctx, accountID)
	if err != nil || a == nil {
		return false, false, googleError("unavailable")
	}
	linked, err := s.ports.GoogleLinked(ctx, accountID)
	return linked, len(a.PasswordHash) > 0, err
}
