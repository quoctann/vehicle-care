package user

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/quoctann/vehicle-care/server/internal/domain"
)

type mailDependencies struct {
	IPorts
	account  *domain.Account
	err      error
	tokens   int
	tokenErr error
	token    string
}

func (d *mailDependencies) AccountByEmail(context.Context, string) (*domain.Account, error) {
	return d.account, d.err
}
func (d *mailDependencies) CreateToken(_ context.Context, _ TokenKind, token string, _ string, _ time.Time) error {
	d.tokens++
	d.token = token
	return d.tokenErr
}

func (d *mailDependencies) CreateAccount(context.Context, domain.Account) error         { return nil }
func (d *mailDependencies) CreateSession(context.Context, string, domain.Session) error { return nil }

type recordingMailer struct {
	messages []MailMessage
	err      error
}

func (m *recordingMailer) Send(_ context.Context, message MailMessage) error {
	m.messages = append(m.messages, message)
	return m.err
}

type mailLimiter struct {
	allowed bool
	err     error
}

func (l mailLimiter) AllowAuth(context.Context, string, int, time.Duration) (bool, error) {
	return l.allowed, l.err
}

func TestMailDelivery(t *testing.T) {
	for _, kind := range []TokenKind{TokenKindVerification, TokenKindReset} {
		t.Run(string(kind), func(t *testing.T) {
			deps := &mailDependencies{account: &domain.Account{ID: "id", Email: "person@example.com", PasswordHash: []byte("hash")}}
			mailer := &recordingMailer{err: errors.New("SMTP unavailable")}
			svc := NewService(deps, time.Hour).WithMailDelivery(mailer, mailLimiter{allowed: true}, "https://app.example.com", time.Second)
			var err error
			if kind == TokenKindReset {
				_, _, err = svc.CreateResetToken(context.Background(), "person@example.com")
			} else {
				_, _, err = svc.CreateVerificationToken(context.Background(), "person@example.com")
			}
			if err != nil || len(mailer.messages) != 1 || deps.tokens != 1 {
				t.Fatalf("delivery failed: messages=%d tokens=%d err=%v", len(mailer.messages), deps.tokens, err)
			}
			msg := mailer.messages[0]
			path := "/verify-email#token="
			if kind == TokenKindReset {
				path = "/reset-password#token="
			}
			if msg.To != "person@example.com" || !strings.Contains(msg.Text, "https://app.example.com"+path+deps.token) || strings.Contains(msg.Text, "?token=") {
				t.Fatalf("unsafe or missing mail link: %#v", msg)
			}
			if !strings.Contains(msg.HTML, `href="https://app.example.com`+path+deps.token+`"`) {
				t.Fatalf("missing HTML action link: %s", msg.HTML)
			}
		})
	}
}

func TestMailTemplateEscapesHTML(t *testing.T) {
	html, err := renderTokenHTML(`<script>alert(1)</script>`, "https://app.test", `<img src=x onerror=alert(1)>`)
	if err != nil || strings.Contains(html, "<script>") || strings.Contains(html, "<img ") || !strings.Contains(html, "&lt;script&gt;") {
		t.Fatal("template text must be HTML escaped")
	}
	mailer := &recordingMailer{}
	svc := NewService(&mailDependencies{}, time.Hour).WithMailDelivery(mailer, mailLimiter{allowed: true}, "https://app.test", time.Second)
	svc.sendTokenMail(context.Background(), "person@example.com", TokenKindVerification, `"><script>alert(1)</script>`)
	if len(mailer.messages) != 1 || strings.Contains(mailer.messages[0].HTML, "<script>") || !strings.Contains(mailer.messages[0].HTML, "%3Cscript%3E") {
		t.Fatal("HTML template must safely encode untrusted data")
	}
}

func TestMailTokenStoreFailures(t *testing.T) {
	for _, reset := range []bool{false, true} {
		for _, storeError := range []error{ErrAccountNotFound, errors.New("store unavailable")} {
			deps := &mailDependencies{err: storeError}
			svc := NewService(deps, time.Hour)
			var err error
			if reset {
				_, _, err = svc.CreateResetToken(context.Background(), "person@example.com")
			} else {
				_, _, err = svc.CreateVerificationToken(context.Background(), "person@example.com")
			}
			if (err == nil) != errors.Is(storeError, ErrAccountNotFound) {
				t.Fatalf("incorrect store error: %v", err)
			}
		}
		deps := &mailDependencies{account: &domain.Account{Email: "person@example.com", PasswordHash: []byte("hash")}, tokenErr: errors.New("token store down")}
		mailer := &recordingMailer{}
		svc := NewService(deps, time.Hour).WithMailDelivery(mailer, mailLimiter{allowed: true}, "https://app.test", time.Second)
		var err error
		if reset {
			_, _, err = svc.CreateResetToken(context.Background(), "person@example.com")
		} else {
			_, _, err = svc.CreateVerificationToken(context.Background(), "person@example.com")
		}
		if err == nil || len(mailer.messages) != 0 {
			t.Fatal("must not deliver unstored token")
		}
	}
}

func TestSignupKeepsImmediateSessionWhenMailFails(t *testing.T) {
	deps := &mailDependencies{}
	mailer := &recordingMailer{err: errors.New("SMTP unavailable")}
	svc := NewService(deps, time.Hour).WithMailDelivery(mailer, mailLimiter{allowed: true}, "https://app.test", time.Second)
	account, sid, csrf, token, err := svc.Signup(context.Background(), "Person@example.com", "password123", nil)
	if err != nil || sid == "" || csrf == "" || token == "" || account.EmailVerified || len(mailer.messages) != 1 {
		t.Fatalf("signup must retain unverified access: %v", err)
	}
}

func TestMailDeliveryConfigurationAndOptionalConsumer(t *testing.T) {
	deps := &mailDependencies{account: &domain.Account{Email: "person@example.com", PasswordHash: []byte("hash")}}
	plain := NewService(deps, time.Hour)
	if _, ok, err := plain.CreateResetToken(context.Background(), "person@example.com"); !ok || err != nil {
		t.Fatalf("non-delivery consumer changed: %v", err)
	}
	configured := plain.WithMailDelivery(nil, nil, "https://app.test", 0)
	if configured.mail.timeout != 5*time.Second || plain.mail != nil {
		t.Fatal("configuration must copy receiver with bounded default")
	}
	if _, ok, err := configured.CreateResetToken(context.Background(), "person@example.com"); ok || err != nil {
		t.Fatal("configured mail without limiter must fail closed")
	}
	configured.sendTokenMail(context.Background(), "person@example.com", TokenKindReset, "token")
}

func TestMailDeliverySuppression(t *testing.T) {
	for _, test := range []struct {
		name       string
		account    *domain.Account
		allowed    bool
		limiterErr error
		reset      bool
	}{
		{name: "missing", allowed: true},
		{name: "verified", account: &domain.Account{EmailVerified: true}, allowed: true},
		{name: "passwordless", account: &domain.Account{}, allowed: true, reset: true},
		{name: "throttled", account: &domain.Account{PasswordHash: []byte("hash")}},
		{name: "limiter unavailable", account: &domain.Account{}, limiterErr: errors.New("redis down")},
	} {
		t.Run(test.name, func(t *testing.T) {
			deps := &mailDependencies{account: test.account}
			mailer := &recordingMailer{}
			svc := NewService(deps, time.Hour).WithMailDelivery(mailer, mailLimiter{allowed: test.allowed, err: test.limiterErr}, "https://app.example.com", time.Second)
			if test.reset {
				_, _, _ = svc.CreateResetToken(context.Background(), "person@example.com")
			} else {
				_, _, _ = svc.CreateVerificationToken(context.Background(), "person@example.com")
			}
			if len(mailer.messages) != 0 || deps.tokens != 0 {
				t.Fatalf("suppressed request issued token or mail")
			}
		})
	}
}
