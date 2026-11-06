package user

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/quoctann/vehicle-care/server/internal/domain"
	"golang.org/x/crypto/bcrypt"
)

type authVersionFake struct {
	IPorts
	account        domain.Account
	session        domain.Session
	subject        string
	cleanupErr     error
	beforeSession  func()
	beforePassword func()
	afterPassword  func()
}

func (f *authVersionFake) AccountByEmail(context.Context, string) (*domain.Account, error) {
	a := f.account
	return &a, nil
}
func (f *authVersionFake) AccountByID(context.Context, string) (*domain.Account, error) {
	a := f.account
	return &a, nil
}
func (f *authVersionFake) CreateToken(_ context.Context, _ TokenKind, _, subject string, _ time.Time) error {
	f.subject = subject
	return nil
}
func (f *authVersionFake) ConsumeToken(context.Context, TokenKind, string, time.Time) (string, bool, error) {
	return f.subject, true, nil
}
func (f *authVersionFake) SetPassword(_ context.Context, _ string, hash []byte, expected int64) error {
	if f.beforePassword != nil {
		f.beforePassword()
	}
	if f.account.AuthVersion != expected {
		return ErrAuthVersionChanged
	}
	f.account = domain.Account{ID: f.account.ID, PasswordHash: hash, AuthVersion: expected + 1}
	if f.afterPassword != nil {
		f.afterPassword()
	}
	return nil
}
func (f *authVersionFake) DeleteAccountSessions(context.Context, string) error {
	f.session = domain.Session{}
	return f.cleanupErr
}
func (f *authVersionFake) CreateSession(_ context.Context, _ string, session domain.Session) error {
	if f.beforeSession != nil {
		f.beforeSession()
	}
	f.session = session
	return nil
}
func (f *authVersionFake) GetAndRefreshSession(context.Context, string, time.Time, time.Time) (*domain.Session, bool, error) {
	return &f.session, true, nil
}

func TestAuthVersionResetSurvivesCleanupFailureAndRejectsStaleReset(t *testing.T) {
	f := &authVersionFake{account: domain.Account{ID: "account", PasswordHash: []byte("existing"), AuthVersion: 4}, cleanupErr: errors.New("redis cleanup down")}
	s := NewService(f, time.Hour)
	if _, ok, err := s.CreateResetToken(context.Background(), "a@example.test"); err != nil || !ok {
		t.Fatalf("issue: %v %v", ok, err)
	}
	f.session = domain.Session{AccountID: "account", AuthVersion: 4}
	if err := s.ResetPassword(context.Background(), "token", "newpassword"); err != nil {
		t.Fatal(err)
	}
	if f.account.AuthVersion != 5 || bcrypt.CompareHashAndPassword(f.account.PasswordHash, []byte("newpassword")) != nil {
		t.Fatal("password and version not changed together")
	}
	if _, _, err := s.ResolveSession(context.Background(), "old"); err == nil {
		t.Fatal("old session accepted after cleanup failed")
	}
	if err := s.ResetPassword(context.Background(), "other-token-issued-at-version-4", "stale-password"); err == nil {
		t.Fatal("stale reset accepted")
	}
	if f.account.AuthVersion != 5 {
		t.Fatal("stale reset changed version")
	}
}

func TestAuthVersionLoginDoesNotPromoteStaleCredentials(t *testing.T) {
	hash, err := bcrypt.GenerateFromPassword([]byte("oldpassword"), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	f := &authVersionFake{account: domain.Account{ID: "account", PasswordHash: hash, AuthVersion: 7}}
	f.beforeSession = func() { f.account.AuthVersion = 8 }
	s := NewService(f, time.Hour)
	if _, _, _, err := s.Login(context.Background(), "a@example.test", "oldpassword"); err != nil {
		t.Fatal(err)
	}
	if f.session.AuthVersion != 7 {
		t.Fatal("session not bound to checked credentials")
	}
	if _, _, err := s.ResolveSession(context.Background(), "stale-login"); err == nil {
		t.Fatal("login racing reset remained authenticated")
	}
}

func TestAuthVersionResetPreservesFreshLoginAfterPasswordCommit(t *testing.T) {
	f := &authVersionFake{account: domain.Account{ID: "account", PasswordHash: []byte("old"), AuthVersion: 1}, subject: "account:1"}
	s := NewService(f, time.Hour)
	f.afterPassword = func() {
		if _, _, _, err := s.Login(context.Background(), "a@example.test", "newpassword"); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.ResetPassword(context.Background(), "token", "newpassword"); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.ResolveSession(context.Background(), "fresh-login"); err != nil {
		t.Fatalf("reset cleanup revoked a fresh login: %v", err)
	}
}

func TestAuthVersionRejectsLegacySession(t *testing.T) {
	f := &authVersionFake{account: domain.Account{ID: "account", AuthVersion: 1}, session: domain.Session{AccountID: "account"}}
	if _, _, err := NewService(f, time.Hour).ResolveSession(context.Background(), "legacy"); err == nil {
		t.Fatal("legacy session accepted")
	}
}

func TestAuthVersionResetDetectsConcurrentChangeAtWrite(t *testing.T) {
	f := &authVersionFake{account: domain.Account{ID: "account", PasswordHash: []byte("old"), AuthVersion: 1}, subject: "account:1"}
	f.beforePassword = func() { f.account.AuthVersion = 2; f.account.PasswordHash = []byte("concurrent-password") }
	if err := NewService(f, time.Hour).ResetPassword(context.Background(), "token", "stale-password"); err == nil {
		t.Fatal("concurrent reset overwrote newer password")
	}
	if string(f.account.PasswordHash) != "concurrent-password" {
		t.Fatal("password overwritten")
	}
}

func TestAuthVersionResetSubjectValidation(t *testing.T) {
	for _, subject := range []string{"legacy-account", "account:0", "account:-1", "account:garbage", ":1", "account:9223372036854775808", "account:1:2"} {
		if _, _, ok := parseResetSubject(subject); ok {
			t.Fatalf("accepted %q", subject)
		}
	}
	if id, version, ok := parseResetSubject(resetSubject(domain.Account{ID: "account", AuthVersion: 42})); !ok || id != "account" || version != 42 {
		t.Fatalf("roundtrip: %s %d %v", id, version, ok)
	}
}
