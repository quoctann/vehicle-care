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

func NewGoogleBrowserBinding() string { return randomOAuth() }

func (s *GoogleService) Begin(ctx context.Context, browser, purpose, sid, expected, password string) (string, error) {
	if s == nil || s.provider == nil {
		return "", googleError("unavailable")
	}
	st := GoogleState{Browser: browser, Purpose: purpose, SessionID: sid, Nonce: randomOAuth(), Verifier: randomOAuth()}
	if purpose == "link" {
		session, ok, err := s.user.ports.Session(ctx, sid, time.Now())
		if err != nil {
			return "", googleError("unavailable")
		}
		if !ok || session == nil || expected == "" || expected != session.AccountID {
			return "", &app.Error{Code: app.ECConflict, Message: "Account changed. Sign in again."}
		}
		a, err := s.user.ports.AccountByID(ctx, session.AccountID)
		if err != nil {
			return "", googleError("unavailable")
		}
		if a == nil || session.AuthVersion <= 0 || session.AuthVersion != a.AuthVersion || len(password) > 72 || bcrypt.CompareHashAndPassword(a.PasswordHash, []byte(password)) != nil {
			return "", &app.Error{Code: app.ECAuthInvalid, Message: "Invalid credentials."}
		}
		linked, err := s.ports.GoogleLinked(ctx, a.ID)
		if err != nil {
			return "", googleError("unavailable")
		}
		if linked {
			return "", ErrGoogleAlreadyLinked
		}
		st.AccountID = a.ID
		st.AuthVersion = a.AuthVersion
	} else if purpose != "login" {
		return "", googleError("failed")
	}
	// Purpose is only a redirect hint when the Redis record has expired.
	// Authentication always uses the bound, single-use stored transaction.
	state := purpose + "." + randomOAuth()
	if err := s.ports.SaveGoogleState(ctx, state, st, GoogleStateTTL); err != nil {
		return "", googleError("unavailable")
	}
	return s.provider.AuthorizationURL(state, st.Nonce, st.Verifier), nil
}

func (s *GoogleService) Complete(ctx context.Context, key, browser, code string, cancelled bool, sid string) (GoogleResult, error) {
	r := GoogleResult{Purpose: "login"}
	if strings.HasPrefix(key, "link.") {
		r.Purpose = "link"
	}
	if s == nil || s.provider == nil {
		return r, googleError("unavailable")
	}
	if key == "" || len(key) > 256 {
		return r, googleError("expired")
	}
	st, ok, err := s.ports.TakeGoogleState(ctx, key)
	if err != nil {
		return r, googleError("unavailable")
	}
	if !ok {
		return r, googleError("expired")
	}
	if st.Purpose == "link" {
		r.Purpose = "link"
	}
	if browser == "" || subtle.ConstantTimeCompare([]byte(st.Browser), []byte(browser)) != 1 || st.SessionID != sid {
		return r, googleError("expired")
	}
	if cancelled {
		return r, googleError("cancelled")
	}
	if code == "" || len(code) > 8192 {
		return r, googleError("failed")
	}
	if st.Purpose == "link" {
		if err := s.checkLinkSession(ctx, st, sid); err != nil {
			return r, err
		}
	}
	claims, err := s.provider.Verify(ctx, code, st.Nonce, st.Verifier)
	if err != nil {
		return r, googleError("failed")
	}
	if claims.Subject == "" || len(claims.Subject) > 255 || !validEmail(claims.Email) {
		return r, googleError("failed")
	}
	if st.Purpose == "link" {
		if err := s.checkLinkSession(ctx, st, sid); err != nil {
			return r, err
		}
		err := s.ports.LinkGoogle(ctx, st.AccountID, claims.Subject, st.AuthVersion)
		if errors.Is(err, ErrAuthVersionChanged) {
			return r, googleError("expired")
		}
		return r, err
	}
	return s.completeGoogleLogin(ctx, claims, sid)
}

func (s *GoogleService) completeGoogleLogin(ctx context.Context, claims GoogleClaims, sid string) (GoogleResult, error) {
	r := GoogleResult{Purpose: "login"}
	a, err := s.ports.GoogleAccount(ctx, claims.Subject, claims.Email, claims.Name, claims.EmailTrusted)
	if err != nil {
		return r, err
	}
	r.SessionID, r.CSRFToken, err = s.user.createSession(ctx, *a)
	if err != nil {
		return GoogleResult{Purpose: r.Purpose}, googleError("unavailable")
	}
	if sid != "" {
		if err := s.user.ports.DeleteSession(ctx, sid); err != nil {
			_ = s.user.ports.DeleteSession(ctx, r.SessionID)
			return GoogleResult{Purpose: r.Purpose}, googleError("unavailable")
		}
	}
	return r, nil
}

func (s *GoogleService) checkLinkSession(ctx context.Context, st GoogleState, sid string) error {
	session, ok, err := s.user.ports.Session(ctx, sid, time.Now())
	if err != nil {
		return googleError("unavailable")
	}
	if !ok || session == nil || session.AccountID != st.AccountID {
		return googleError("expired")
	}
	a, err := s.user.ports.AccountByID(ctx, session.AccountID)
	if err != nil {
		return googleError("unavailable")
	}
	if a == nil || st.AuthVersion <= 0 || session.AuthVersion != st.AuthVersion || session.AuthVersion != a.AuthVersion {
		return googleError("expired")
	}
	return nil
}

func (s *GoogleService) Status(ctx context.Context, accountID string) (bool, bool, error) {
	a, err := s.user.ports.AccountByID(ctx, accountID)
	if err != nil || a == nil {
		return false, false, googleError("unavailable")
	}
	linked, err := s.ports.GoogleLinked(ctx, accountID)
	return linked, len(a.PasswordHash) > 0, err
}
