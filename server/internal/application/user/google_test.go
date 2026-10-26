package user

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/quoctann/vehicle-care/server/internal/domain"
	"golang.org/x/crypto/bcrypt"
)

type googleFake struct {
	IPorts
	IGooglePorts
	states           map[string]GoogleState
	account          domain.Account
	linked           bool
	linkCalls        int
	created, deleted []string
	createdVersion   int64
	sessionOK        bool
	fail             string
}

func (f *googleFake) SaveGoogleState(_ context.Context, k string, s GoogleState, _ time.Duration) error {
	if f.fail == "save" {
		return errors.New("redis down")
	}
	f.states[k] = s
	return nil
}
func (f *googleFake) TakeGoogleState(_ context.Context, k string) (GoogleState, bool, error) {
	if f.fail == "take" {
		return GoogleState{}, false, errors.New("redis down")
	}
	s, ok := f.states[k]
	delete(f.states, k)
	return s, ok, nil
}
func (f *googleFake) GoogleLinked(context.Context, string) (bool, error) {
	if f.fail == "linked" {
		return false, errors.New("db down")
	}
	return f.linked, nil
}
func (f *googleFake) AccountByID(context.Context, string) (*domain.Account, error) {
	if f.fail == "account" {
		return nil, errors.New("db down")
	}
	return &f.account, nil
}
func (f *googleFake) Session(context.Context, string, time.Time) (*domain.Session, bool, error) {
	if f.fail == "session" {
		return nil, false, errors.New("redis down")
	}
	return &domain.Session{AccountID: f.account.ID, AuthVersion: f.account.AuthVersion}, f.sessionOK, nil
}
func (f *googleFake) GoogleAccount(context.Context, string, string, string, bool) (*domain.Account, error) {
	if f.fail == "email_exists" {
		return nil, ErrGoogleEmailExists
	}
	return &f.account, nil
}
func (f *googleFake) LinkGoogle(context.Context, string, string, int64) error {
	f.linkCalls++
	return nil
}
func (f *googleFake) CreateSession(_ context.Context, id string, session domain.Session) error {
	if f.fail == "create" {
		return errors.New("redis down")
	}
	f.created = append(f.created, id)
	f.createdVersion = session.AuthVersion
	return nil
}
func (f *googleFake) DeleteSession(_ context.Context, id string) error {
	f.deleted = append(f.deleted, id)
	if f.fail == "delete" {
		return errors.New("redis down")
	}
	return nil
}

func TestGoogleFailurePaths(t *testing.T) {
	ctx := context.Background()
	var disabled *GoogleService
	if _, err := disabled.Begin(ctx, "browser", "login", "", "", ""); GoogleErrorCode(err) != "unavailable" {
		t.Fatal(err)
	}
	if _, err := disabled.Complete(ctx, "state", "browser", "code", false, ""); GoogleErrorCode(err) != "unavailable" {
		t.Fatal(err)
	}
	for _, fail := range []string{"save", "session", "account", "linked"} {
		s, f := googleFixture(t)
		f.fail = fail
		purpose := "link"
		if fail == "save" {
			purpose = "login"
		}
		if _, err := s.Begin(ctx, "browser", purpose, "sid", "account", "password123"); GoogleErrorCode(err) != "unavailable" {
			t.Fatal(fail, err)
		}
	}
	s, f := googleFixture(t)
	f.linked = true
	if _, err := s.Begin(ctx, "browser", "link", "sid", "account", "password123"); !errors.Is(err, ErrGoogleAlreadyLinked) {
		t.Fatal(err)
	}
	if _, err := s.Begin(ctx, "browser", "invalid", "", "", ""); GoogleErrorCode(err) != "failed" {
		t.Fatal(err)
	}
	if _, err := s.Complete(ctx, "", "browser", "code", false, ""); GoogleErrorCode(err) != "expired" {
		t.Fatal(err)
	}
	for _, fail := range []string{"take", "email_exists", "create", "delete"} {
		s, f := googleFixture(t)
		key, err := s.Begin(ctx, "browser", "login", "old", "", "")
		if err != nil {
			t.Fatal(err)
		}
		f.fail = fail
		r, err := s.Complete(ctx, key, "browser", "code", false, "old")
		want := "unavailable"
		if fail == "email_exists" {
			want = fail
		}
		if GoogleErrorCode(err) != want || r.SessionID != "" {
			t.Fatal(fail, r, err)
		}
		if fail == "delete" && len(f.deleted) != 2 {
			t.Fatal("new session not revoked")
		}
	}
	for _, fail := range []string{"", "account"} {
		s, f := googleFixture(t)
		f.fail = fail
		linked, has, err := s.Status(ctx, "account")
		if fail == "" && (err != nil || linked || !has) {
			t.Fatal(linked, has, err)
		}
		if fail != "" && err == nil {
			t.Fatal("status failed open")
		}
	}
	for _, err := range []error{ErrGoogleEmailExists, ErrGoogleIdentityLinked, ErrGoogleAlreadyLinked} {
		if GoogleErrorCode(err) != err.Error() {
			t.Fatal(err)
		}
	}
	if GoogleErrorCode(errors.New("secret")) != "failed" || googleError("failed").Error() != "failed" {
		t.Fatal("unexpected error mapping")
	}
	if len(NewGoogleBrowserBinding()) < 32 {
		t.Fatal("weak browser binding")
	}
}

func TestGoogleLinkSessionExpiresBeforeCallback(t *testing.T) {
	s, f := googleFixture(t)
	ctx := context.Background()
	key, err := s.Begin(ctx, "browser", "link", "sid", "account", "password123")
	if err != nil {
		t.Fatal(err)
	}
	f.sessionOK = false
	r, err := s.Complete(ctx, key, "browser", "code", false, "sid")
	if r.Purpose != "link" || GoogleErrorCode(err) != "expired" || f.linkCalls != 0 {
		t.Fatal(r, err)
	}
}

func TestGoogleExpiredLinkKeepsSettingsDestination(t *testing.T) {
	s, f := googleFixture(t)
	ctx := context.Background()
	key, err := s.Begin(ctx, "browser", "link", "sid", "account", "password123")
	if err != nil {
		t.Fatal(err)
	}
	delete(f.states, key)
	r, err := s.Complete(ctx, key, "browser", "code", false, "sid")
	if r.Purpose != "link" || GoogleErrorCode(err) != "expired" {
		t.Fatal(r, err)
	}
}

type providerFake struct{ bad bool }

func (providerFake) AuthorizationURL(state, nonce, verifier string) string { return state }
func (p providerFake) Verify(context.Context, string, string, string) (GoogleClaims, error) {
	if p.bad {
		return GoogleClaims{}, errors.New("bad token")
	}
	return GoogleClaims{Subject: "sub", Email: "a@example.test"}, nil
}
func googleFixture(t *testing.T) (*GoogleService, *googleFake) {
	t.Helper()
	hash, _ := bcrypt.GenerateFromPassword([]byte("password123"), bcrypt.MinCost)
	f := &googleFake{states: map[string]GoogleState{}, account: domain.Account{ID: "account", PasswordHash: hash, AuthVersion: 1}, sessionOK: true}
	return NewGoogleService(NewService(f, time.Hour), f, providerFake{}), f
}

func TestGoogleLoginSingleUseAndRotation(t *testing.T) {
	s, f := googleFixture(t)
	ctx := context.Background()
	key, err := s.Begin(ctx, "browser", "login", "old", "", "")
	if err != nil {
		t.Fatal(err)
	}
	r, err := s.Complete(ctx, key, "browser", "code", false, "old")
	if err != nil || r.SessionID == "" || r.Purpose != "login" {
		t.Fatal(r, err)
	}
	if len(f.created) != 1 || len(f.deleted) != 1 || f.deleted[0] != "old" {
		t.Fatal("session not rotated")
	}
	if f.createdVersion != f.account.AuthVersion {
		t.Fatal("Google session version missing")
	}
	if _, err := s.Complete(ctx, key, "browser", "code", false, "old"); GoogleErrorCode(err) != "expired" {
		t.Fatal(err)
	}
}

func TestGoogleLinkReauthenticationAndSessionBinding(t *testing.T) {
	ctx := context.Background()
	s, f := googleFixture(t)
	for _, v := range []struct{ expected, password string }{{"other", "password123"}, {"account", "wrong"}, {"account", ""}} {
		if _, err := s.Begin(ctx, "browser", "link", "sid", v.expected, v.password); err == nil {
			t.Fatal("accepted invalid reauthentication")
		}
	}
	key, err := s.Begin(ctx, "browser", "link", "sid", "account", "password123")
	if err != nil {
		t.Fatal(err)
	}
	r, err := s.Complete(ctx, key, "browser", "code", false, "different")
	if r.Purpose != "link" || GoogleErrorCode(err) != "expired" || f.linkCalls != 0 {
		t.Fatal(r, err)
	}
	key, err = s.Begin(ctx, "browser", "link", "sid", "account", "password123")
	if err != nil {
		t.Fatal(err)
	}
	r, err = s.Complete(ctx, key, "browser", "code", false, "sid")
	if err != nil || r.Purpose != "link" || f.linkCalls != 1 || len(f.created) != 0 {
		t.Fatal(r, err)
	}
}

func TestGoogleInvalidBrowserCancellationAndProvider(t *testing.T) {
	for _, tc := range []struct {
		browser     string
		cancel, bad bool
		want        string
	}{{"other", false, false, "expired"}, {"browser", true, false, "cancelled"}, {"browser", false, true, "failed"}} {
		s, f := googleFixture(t)
		s.provider = providerFake{bad: tc.bad}
		key, err := s.Begin(context.Background(), "browser", "login", "", "", "")
		if err != nil {
			t.Fatal(err)
		}
		_, err = s.Complete(context.Background(), key, tc.browser, "code", tc.cancel, "")
		if GoogleErrorCode(err) != tc.want || len(f.created) != 0 {
			t.Fatal(err)
		}
	}
}
