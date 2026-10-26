package httpapi

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/quoctann/vehicle-care/server/internal/application/user"
	"github.com/quoctann/vehicle-care/server/internal/domain"
	"github.com/quoctann/vehicle-care/server/internal/platform/config"
	"go.uber.org/zap"
)

type resetCookieDependencies struct{ user.IPorts }

func (*resetCookieDependencies) ConsumeToken(context.Context, user.TokenKind, string, time.Time) (string, bool, error) {
	return "account-A:1", true, nil
}
func (*resetCookieDependencies) AccountByID(context.Context, string) (*domain.Account, error) {
	return &domain.Account{ID: "account-A", PasswordHash: []byte("hash"), AuthVersion: 1}, nil
}
func (*resetCookieDependencies) SetPassword(context.Context, string, []byte, int64) error { return nil }
func (*resetCookieDependencies) DeleteAccountSessions(context.Context, string) error      { return nil }
func (*resetCookieDependencies) AllowAuth(context.Context, string, int, time.Duration) (bool, error) {
	return true, nil
}

func TestAuthVersionPublicResetDoesNotOverwriteBrowserCookies(t *testing.T) {
	d := &resetCookieDependencies{}
	s := New(&Service{User: user.NewService(d, time.Hour), AuthLimiter: d}, config.Config{}, zap.NewNop())
	r := googleRequest(s, http.MethodPost, "/auth/password/reset", `{"token":"for-account-A","new_password":"newpassword"}`, &http.Cookie{Name: "sid", Value: "account-B-session"}, &http.Cookie{Name: "csrf_token", Value: "account-B-csrf"})
	if r.Code != http.StatusOK {
		t.Fatalf("reset: %d %s", r.Code, r.Body)
	}
	if got := r.Header().Values("Set-Cookie"); len(got) != 0 {
		t.Fatalf("public reset changed unrelated browser cookies: %v", got)
	}
}
