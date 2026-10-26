package httpapi

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/quoctann/vehicle-care/server/internal/application/user"
	"github.com/quoctann/vehicle-care/server/internal/domain"
	"github.com/quoctann/vehicle-care/server/internal/platform/config"
	"github.com/quoctann/vehicle-care/server/internal/platform/logging"
	"go.uber.org/zap"
)

type mailHTTPDependencies struct {
	user.IPorts
	account   *domain.Account
	storeErr  error
	lookedUp  chan struct{}
	requestID string
}

func (d *mailHTTPDependencies) AccountByEmail(ctx context.Context, _ string) (*domain.Account, error) {
	d.requestID = logging.RequestID(ctx)
	if d.lookedUp != nil {
		close(d.lookedUp)
	}
	return d.account, d.storeErr
}
func (d *mailHTTPDependencies) CreateToken(context.Context, user.TokenKind, string, string, time.Time) error {
	return d.storeErr
}
func (d *mailHTTPDependencies) AllowAuth(context.Context, string, int, time.Duration) (bool, error) {
	return true, nil
}

type failingHTTPMailer struct{}

func (failingHTTPMailer) Send(context.Context, user.MailMessage) error {
	return errors.New("secret SMTP token details")
}

func mailRequest(server *Server, method, path, body string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, path, strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	return response
}

func TestMailRecoveryResponsesAreGeneric(t *testing.T) {
	for _, path := range []string{"/auth/password/forgot", "/auth/verify-email/resend"} {
		for _, state := range []string{"missing", "existing", "store down"} {
			t.Run(path+state, func(t *testing.T) {
				d := &mailHTTPDependencies{}
				switch state {
				case "existing":
					d.account = &domain.Account{ID: "account", Email: "person@example.com", PasswordHash: []byte("hash")}
				case "store down":
					d.storeErr = errors.New("unavailable")
				}
				svc := user.NewService(d, time.Hour).WithMailDelivery(failingHTTPMailer{}, d, "https://app.test", time.Second)
				server := New(&Service{User: svc, AuthLimiter: d}, config.Config{SMTPTimeout: time.Millisecond}, zap.NewNop())
				response := mailRequest(server, http.MethodPost, path, `{"email":"person@example.com"}`)
				if response.Code != http.StatusOK || strings.TrimSpace(response.Body.String()) != "{}" {
					t.Fatalf("non-generic recovery response: %d %s", response.Code, response.Body.String())
				}
				if d.requestID == "" || d.requestID != response.Header().Get("X-Request-ID") {
					t.Fatal("request correlation ID missing from delivery context")
				}
			})
		}
	}
}

type slowHTTPMailer struct{ done chan struct{} }

func (m slowHTTPMailer) Send(ctx context.Context, _ user.MailMessage) error {
	<-ctx.Done()
	close(m.done)
	return ctx.Err()
}

func TestRecoveryTimingBudget(t *testing.T) {
	const budget = 40 * time.Millisecond
	for _, path := range []string{"/auth/password/forgot", "/auth/verify-email/resend"} {
		for _, eligible := range []bool{true, false} {
			d := &mailHTTPDependencies{}
			if eligible {
				d.account = &domain.Account{ID: "account", Email: "person@example.com", PasswordHash: []byte("hash")}
			}
			sender := slowHTTPMailer{done: make(chan struct{})}
			svc := user.NewService(d, time.Hour).WithMailDelivery(sender, d, "https://app.test", time.Second)
			server := New(&Service{User: svc, AuthLimiter: d}, config.Config{SMTPTimeout: budget}, zap.NewNop())
			start := time.Now()
			response := mailRequest(server, http.MethodPost, path, `{"email":"person@example.com"}`)
			elapsed := time.Since(start)
			if response.Code != http.StatusOK || elapsed < budget || elapsed > 500*time.Millisecond {
				t.Fatalf("eligible=%v elapsed=%v status=%d", eligible, elapsed, response.Code)
			}
			if eligible {
				select {
				case <-sender.done:
				default:
					t.Fatal("sender did not inherit handler deadline")
				}
			}
		}
	}
}

func TestRecoveryBudgetEndsOnClientCancellation(t *testing.T) {
	d := &mailHTTPDependencies{lookedUp: make(chan struct{})}
	svc := user.NewService(d, time.Hour)
	server := New(&Service{User: svc}, config.Config{SMTPTimeout: time.Second}, zap.NewNop())
	ctx, cancel := context.WithCancel(context.Background())
	request := httptest.NewRequest(http.MethodPost, "/auth/password/forgot", strings.NewReader(`{"email":"person@example.com"}`)).WithContext(ctx)
	request.Header.Set("Content-Type", "application/json")
	done := make(chan struct{})
	go func() { server.Handler().ServeHTTP(httptest.NewRecorder(), request); close(done) }()
	<-d.lookedUp
	cancel()
	select {
	case <-done:
	case <-time.After(300 * time.Millisecond):
		t.Fatal("client cancellation must end response wait")
	}
}

func TestEmailVerificationRequiresExplicitPost(t *testing.T) {
	server := New(&Service{}, config.Config{}, zap.NewNop())
	response := mailRequest(server, http.MethodGet, "/auth/verify-email?token=secret", "")
	if response.Code != http.StatusNotFound {
		t.Fatalf("GET must not consume verification token: %d", response.Code)
	}
}
