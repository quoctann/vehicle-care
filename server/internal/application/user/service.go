package user

import (
	"context"
	"errors"
	"net/mail"
	"strings"
	"time"

	"github.com/google/uuid"
	app "github.com/quoctann/vehicle-care/server/internal/application"
	"github.com/quoctann/vehicle-care/server/internal/domain"
	"golang.org/x/crypto/bcrypt"
)

const (
	verificationTokenTTL = 24 * time.Hour
	resetTokenTTL        = 30 * time.Minute
	maxPasswordBytes     = 72
)

type Service struct {
	deps       IDependencies
	sessionTTL time.Duration
	now        func() time.Time
}

func NewService(deps IDependencies, sessionTTL time.Duration) *Service {
	return &Service{deps: deps, sessionTTL: sessionTTL, now: time.Now}
}

// Login validates credentials and creates a new session.
func (s *Service) Login(ctx context.Context, email, password string) (domain.Account, string, string, error) {
	account, found := s.deps.AccountByEmail(ctx, strings.TrimSpace(email))
	if !found || bcrypt.CompareHashAndPassword(account.PasswordHash, []byte(password)) != nil {
		return domain.Account{}, "", "", &app.Error{Code: "auth_invalid", Message: "Invalid email or password."}
	}
	sessionID, csrfToken, err := s.createSession(ctx, account.ID)
	return account, sessionID, csrfToken, err
}

// VerifyEmail consumes a verification token and marks its account verified.
func (s *Service) VerifyEmail(ctx context.Context, token string) error {
	accountID, ok, err := s.deps.ConsumeToken(ctx, "verification", token, s.now())
	if err != nil {
		return &app.Error{Code: "internal_error", Message: "Token store is unavailable."}
	}
	if !ok {
		return validation("Verification token is invalid or expired.")
	}
	return s.deps.SetEmailVerified(ctx, accountID)
}

// Signup creates an account, verification token, and immediate login session.
func (s *Service) Signup(ctx context.Context, email, password string, name *string) (domain.Account, string, string, string, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	if !validEmail(email) || !validPassword(password) {
		return domain.Account{}, "", "", "", validation("Invalid email or password (password must be 8 to 72 bytes).")
	}
	if _, found := s.deps.AccountByEmail(ctx, email); found {
		return domain.Account{}, "", "", "", &app.Error{Code: "conflict", Message: "Email is already registered."}
	}
	passwordHash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return domain.Account{}, "", "", "", err
	}
	account := domain.Account{ID: uuid.NewString(), Email: email, Name: name, Timezone: "Asia/Ho_Chi_Minh", PasswordHash: passwordHash}
	if err := s.deps.CreateAccount(ctx, account); err != nil {
		if errors.Is(err, ErrAccountExists) {
			return domain.Account{}, "", "", "", &app.Error{Code: "conflict", Message: "Email is already registered."}
		}
		return domain.Account{}, "", "", "", err
	}
	verificationToken := uuid.NewString()
	if err := s.deps.CreateToken(ctx, "verification", verificationToken, account.ID, s.now().Add(verificationTokenTTL)); err != nil {
		return domain.Account{}, "", "", "", err
	}
	sessionID, csrfToken, err := s.createSession(ctx, account.ID)
	return account, sessionID, csrfToken, verificationToken, err
}

// CreateVerificationToken creates a token when an account exists.
func (s *Service) CreateVerificationToken(ctx context.Context, email string) (string, bool, error) {
	account, found := s.deps.AccountByEmail(ctx, strings.TrimSpace(email))
	if !found {
		return "", false, nil
	}
	token := uuid.NewString()
	return token, true, s.deps.CreateToken(ctx, "verification", token, account.ID, s.now().Add(verificationTokenTTL))
}

// CreateResetToken creates a password reset token when an account exists.
func (s *Service) CreateResetToken(ctx context.Context, email string) (string, bool, error) {
	account, found := s.deps.AccountByEmail(ctx, strings.TrimSpace(email))
	if !found {
		return "", false, nil
	}
	token := uuid.NewString()
	return token, true, s.deps.CreateToken(ctx, "reset", token, account.ID, s.now().Add(resetTokenTTL))
}

// ResetPassword consumes a token, changes the password, and revokes all sessions.
func (s *Service) ResetPassword(ctx context.Context, token, password string) error {
	if !validPassword(password) {
		return validation("Password must be 8 to 72 bytes.")
	}
	passwordHash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	accountID, ok, err := s.deps.ConsumeToken(ctx, "reset", token, s.now())
	if err != nil {
		return &app.Error{Code: "internal_error", Message: "Token store is unavailable."}
	}
	if !ok {
		return validation("Password reset token is invalid or expired.")
	}
	if err := s.deps.SetPassword(ctx, accountID, passwordHash); err != nil {
		return err
	}
	return s.deps.DeleteAccountSessions(ctx, accountID)
}

// ResolveSession returns the session and account represented by an opaque ID.
func (s *Service) ResolveSession(ctx context.Context, sessionID string) (domain.Session, domain.Account, error) {
	session, found, err := s.deps.GetAndRefreshSession(ctx, sessionID, s.now(), s.now().Add(s.sessionTTL))
	if err != nil {
		return domain.Session{}, domain.Account{}, &app.Error{Code: "internal_error", Message: "Session store is unavailable."}
	}
	if !found {
		return domain.Session{}, domain.Account{}, &app.Error{Code: "session_expired", Message: "Session expired or missing."}
	}
	account, found := s.deps.AccountByID(ctx, session.AccountID)
	if !found {
		return domain.Session{}, domain.Account{}, &app.Error{Code: "session_expired", Message: "Session expired or missing."}
	}
	return session, account, nil
}

// Logout deletes the current session.
func (s *Service) Logout(ctx context.Context, sessionID string) error {
	return s.deps.DeleteSession(ctx, sessionID)
}

// RegisterDevice associates a validated device with the current account.
func (s *Service) RegisterDevice(ctx context.Context, accountID, deviceID string) (time.Time, error) {
	if strings.TrimSpace(deviceID) == "" {
		return time.Time{}, validation("device_id is required.")
	}
	return s.deps.RegisterDevice(ctx, accountID, deviceID)
}

func (s *Service) createSession(ctx context.Context, accountID string) (string, string, error) {
	sessionID := uuid.NewString()
	csrfToken := uuid.NewString()
	err := s.deps.CreateSession(ctx, sessionID, domain.Session{
		AccountID: accountID, CSRFToken: csrfToken, ExpiresAt: s.now().Add(s.sessionTTL),
	})
	return sessionID, csrfToken, err
}

func validEmail(value string) bool {
	address, err := mail.ParseAddress(value)
	return err == nil && address.Address == value
}

func validPassword(value string) bool {
	return len(value) >= 8 && len(value) <= maxPasswordBytes
}

func validation(message string) error {
	return &app.Error{Code: "validation_failed", Message: message}
}
