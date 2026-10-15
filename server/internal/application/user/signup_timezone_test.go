package user

import (
	"context"
	"testing"
	"time"

	"github.com/quoctann/vehicle-care/server/internal/domain"
)

type signupTimezoneDependencies struct {
	IPorts
	account domain.Account
}

func (d *signupTimezoneDependencies) AccountByEmail(context.Context, string) (*domain.Account, error) {
	return nil, ErrAccountNotFound
}

func (d *signupTimezoneDependencies) CreateAccount(_ context.Context, account domain.Account) error {
	d.account = account
	return nil
}

func (d *signupTimezoneDependencies) CreateToken(context.Context, TokenKind, string, string, time.Time) error {
	return nil
}

func (d *signupTimezoneDependencies) CreateSession(context.Context, string, domain.Session) error {
	return nil
}

func TestSignupDefaultTimezone(t *testing.T) {
	deps := &signupTimezoneDependencies{}
	account, _, _, _, err := NewService(deps, time.Hour).Signup(context.Background(), "new@example.test", "password123", nil)
	if err != nil || account.Timezone != "UTC+07:00" || deps.account.Timezone != "UTC+07:00" {
		t.Fatalf("signup timezone: returned=%q persisted=%q err=%v", account.Timezone, deps.account.Timezone, err)
	}
}
