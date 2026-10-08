package user

import (
	"context"
	"errors"
	"testing"
	"time"

	app "github.com/quoctann/vehicle-care/server/internal/application"
	"github.com/quoctann/vehicle-care/server/internal/domain"
)

type sessionDependencies struct {
	IPorts
	session    *domain.Session
	found      bool
	sessionErr error
	account    *domain.Account
	accountErr error
}

func (d *sessionDependencies) GetAndRefreshSession(context.Context, string, time.Time, time.Time) (*domain.Session, bool, error) {
	return d.session, d.found, d.sessionErr
}

func (d *sessionDependencies) AccountByID(context.Context, string) (*domain.Account, error) {
	return d.account, d.accountErr
}

func TestResolveSessionPointerResults(t *testing.T) {
	for _, test := range []struct {
		name     string
		deps     sessionDependencies
		wantCode string
	}{
		{name: "missing", deps: sessionDependencies{}, wantCode: app.ECSessionExpired},
		{name: "nil found session", deps: sessionDependencies{found: true}, wantCode: app.ECSessionExpired},
		{name: "session store error", deps: sessionDependencies{sessionErr: errors.New("redis down")}, wantCode: app.ECInternalError},
		{name: "missing account", deps: sessionDependencies{found: true, session: &domain.Session{AccountID: "account"}, accountErr: ErrAccountNotFound}, wantCode: app.ECSessionExpired},
		{name: "nil account", deps: sessionDependencies{found: true, session: &domain.Session{AccountID: "account"}}, wantCode: app.ECSessionExpired},
		{name: "account store error", deps: sessionDependencies{found: true, session: &domain.Session{AccountID: "account"}, accountErr: errors.New("postgres down")}, wantCode: app.ECInternalError},
	} {
		t.Run(test.name, func(t *testing.T) {
			_, _, err := NewService(&test.deps, time.Hour).ResolveSession(context.Background(), "session")
			var applicationErr *app.Error
			if !errors.As(err, &applicationErr) || applicationErr.Code != test.wantCode {
				t.Fatalf("expected %s, got %v", test.wantCode, err)
			}
		})
	}

	deps := &sessionDependencies{found: true, session: &domain.Session{AccountID: "account", CSRFToken: "token"}, account: &domain.Account{ID: "account"}}
	session, account, err := NewService(deps, time.Hour).ResolveSession(context.Background(), "session")
	if err != nil || session.CSRFToken != "token" || account.ID != "account" {
		t.Fatalf("expected resolved session and account, session=%#v account=%#v err=%v", session, account, err)
	}
}
