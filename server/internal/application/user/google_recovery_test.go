package user

import (
	"context"
	"testing"
	"time"

	"github.com/quoctann/vehicle-care/server/internal/domain"
)

type googleRecoveryFake struct {
	IPorts
	issued, changed int
}

func (f *googleRecoveryFake) AccountByEmail(context.Context, string) (*domain.Account, error) {
	return &domain.Account{ID: "google"}, nil
}
func (f *googleRecoveryFake) AccountByID(context.Context, string) (*domain.Account, error) {
	return &domain.Account{ID: "google"}, nil
}
func (f *googleRecoveryFake) CreateToken(context.Context, TokenKind, string, string, time.Time) error {
	f.issued++
	return nil
}
func (f *googleRecoveryFake) ConsumeToken(context.Context, TokenKind, string, time.Time) (string, bool, error) {
	return "google", true, nil
}
func (f *googleRecoveryFake) SetPassword(context.Context, string, []byte, int64) error {
	f.changed++
	return nil
}
func (f *googleRecoveryFake) DeleteAccountSessions(context.Context, string) error { return nil }
func TestGoogleOnlyPasswordRecoveryDisabled(t *testing.T) {
	f := &googleRecoveryFake{}
	s := NewService(f, time.Hour)
	token, ok, err := s.CreateResetToken(context.Background(), "google@example.test")
	if err != nil || ok || token != "" || f.issued != 0 {
		t.Fatal("issued password reset for Google-only account")
	}
	if err := s.ResetPassword(context.Background(), "preissued", "newpassword"); err == nil || f.changed != 0 {
		t.Fatal("redeemed reset for Google-only account")
	}
}
