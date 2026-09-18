// Package application coordinates domain use cases through storage ports.
package application

import (
	"context"
	"errors"
	"net/mail"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/quoctann/vehicle-care/server/internal/domain"
	"github.com/quoctann/vehicle-care/server/internal/ports"
	"golang.org/x/crypto/bcrypt"
)

const (
	verificationTokenTTL = 24 * time.Hour
	resetTokenTTL        = 30 * time.Minute
	maxPasswordBytes     = 72
)

// Error identifies an application failure that the HTTP adapter can map safely.
type Error struct {
	Code    string
	Message string
}

func (e *Error) Error() string { return e.Message }

// Service implements authentication, device registration, and sync use cases.
type Service struct {
	store      ports.Store
	sessionTTL time.Duration
	batchLimit int
	pageLimit  int
	now        func() time.Time
}

// NewService creates the application service.
func NewService(store ports.Store, sessionTTL time.Duration, batchLimit, pageLimit int) *Service {
	return &Service{store: store, sessionTTL: sessionTTL, batchLimit: batchLimit, pageLimit: pageLimit, now: time.Now}
}

// SeedDemoAccount creates the documented local demo account if it is absent.
func (s *Service) SeedDemoAccount(ctx context.Context) error {
	if _, found := s.store.AccountByEmail(ctx, "demo@vehicle.app"); found {
		return nil
	}
	passwordHash, err := bcrypt.GenerateFromPassword([]byte("demo12345"), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	name := "Demo User"
	return s.store.CreateAccount(ctx, domain.Account{
		ID: uuid.NewString(), Email: "demo@vehicle.app", Name: &name,
		Timezone: "Asia/Ho_Chi_Minh", EmailVerified: true, PasswordHash: passwordHash,
	})
}

// Signup creates an account, verification token, and immediate login session.
func (s *Service) Signup(ctx context.Context, email, password string, name *string) (domain.Account, string, string, string, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	if !validEmail(email) || !validPassword(password) {
		return domain.Account{}, "", "", "", validation("Invalid email or password (password must be 8 to 72 bytes).")
	}
	if _, found := s.store.AccountByEmail(ctx, email); found {
		return domain.Account{}, "", "", "", &Error{Code: "conflict", Message: "Email is already registered."}
	}
	passwordHash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return domain.Account{}, "", "", "", err
	}
	account := domain.Account{ID: uuid.NewString(), Email: email, Name: name, Timezone: "Asia/Ho_Chi_Minh", PasswordHash: passwordHash}
	if err := s.store.CreateAccount(ctx, account); err != nil {
		if errors.Is(err, ports.ErrAccountExists) {
			return domain.Account{}, "", "", "", &Error{Code: "conflict", Message: "Email is already registered."}
		}
		return domain.Account{}, "", "", "", err
	}
	verificationToken := uuid.NewString()
	if err := s.store.CreateToken(ctx, "verification", verificationToken, account.ID, s.now().Add(verificationTokenTTL)); err != nil {
		return domain.Account{}, "", "", "", err
	}
	sessionID, csrfToken, err := s.createSession(ctx, account.ID)
	return account, sessionID, csrfToken, verificationToken, err
}

// Login validates credentials and creates a new session.
func (s *Service) Login(ctx context.Context, email, password string) (domain.Account, string, string, error) {
	account, found := s.store.AccountByEmail(ctx, strings.TrimSpace(email))
	if !found || bcrypt.CompareHashAndPassword(account.PasswordHash, []byte(password)) != nil {
		return domain.Account{}, "", "", &Error{Code: "auth_invalid", Message: "Invalid email or password."}
	}
	sessionID, csrfToken, err := s.createSession(ctx, account.ID)
	return account, sessionID, csrfToken, err
}

// LoginGoogleDemo creates or logs in the fixed local Google demo account.
func (s *Service) LoginGoogleDemo(ctx context.Context) (string, string, error) {
	const email = "demo.google@gmail.com"
	account, found := s.store.AccountByEmail(ctx, email)
	if !found {
		name := "Google Demo"
		account = domain.Account{ID: uuid.NewString(), Email: email, Name: &name, Timezone: "Asia/Ho_Chi_Minh", EmailVerified: true}
		if err := s.store.CreateAccount(ctx, account); err != nil && !errors.Is(err, ports.ErrAccountExists) {
			return "", "", err
		}
		account, _ = s.store.AccountByEmail(ctx, email)
	}
	return s.createSession(ctx, account.ID)
}

// VerifyEmail consumes a verification token and marks its account verified.
func (s *Service) VerifyEmail(ctx context.Context, token string) error {
	accountID, ok, err := s.store.ConsumeToken(ctx, "verification", token, s.now())
	if err != nil {
		return &Error{Code: "internal_error", Message: "Token store is unavailable."}
	}
	if !ok {
		return validation("Verification token is invalid or expired.")
	}
	return s.store.SetEmailVerified(ctx, accountID)
}

// CreateVerificationToken creates a token when an account exists.
func (s *Service) CreateVerificationToken(ctx context.Context, email string) (string, bool, error) {
	account, found := s.store.AccountByEmail(ctx, strings.TrimSpace(email))
	if !found {
		return "", false, nil
	}
	token := uuid.NewString()
	return token, true, s.store.CreateToken(ctx, "verification", token, account.ID, s.now().Add(verificationTokenTTL))
}

// CreateResetToken creates a password reset token when an account exists.
func (s *Service) CreateResetToken(ctx context.Context, email string) (string, bool, error) {
	account, found := s.store.AccountByEmail(ctx, strings.TrimSpace(email))
	if !found {
		return "", false, nil
	}
	token := uuid.NewString()
	return token, true, s.store.CreateToken(ctx, "reset", token, account.ID, s.now().Add(resetTokenTTL))
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
	accountID, ok, err := s.store.ConsumeToken(ctx, "reset", token, s.now())
	if err != nil {
		return &Error{Code: "internal_error", Message: "Token store is unavailable."}
	}
	if !ok {
		return validation("Password reset token is invalid or expired.")
	}
	if err := s.store.SetPassword(ctx, accountID, passwordHash); err != nil {
		return err
	}
	return s.store.DeleteAccountSessions(ctx, accountID)
}

// ResolveSession returns the session and account represented by an opaque ID.
func (s *Service) ResolveSession(ctx context.Context, sessionID string) (domain.Session, domain.Account, error) {
	session, found, err := s.store.GetAndRefreshSession(ctx, sessionID, s.now(), s.now().Add(s.sessionTTL))
	if err != nil {
		return domain.Session{}, domain.Account{}, &Error{Code: "internal_error", Message: "Session store is unavailable."}
	}
	if !found {
		return domain.Session{}, domain.Account{}, &Error{Code: "session_expired", Message: "Session expired or missing."}
	}
	account, found := s.store.AccountByID(ctx, session.AccountID)
	if !found {
		return domain.Session{}, domain.Account{}, &Error{Code: "session_expired", Message: "Session expired or missing."}
	}
	return session, account, nil
}

// Logout deletes the current session.
func (s *Service) Logout(ctx context.Context, sessionID string) error {
	return s.store.DeleteSession(ctx, sessionID)
}

// RegisterDevice associates a validated device with the current account.
func (s *Service) RegisterDevice(ctx context.Context, accountID, deviceID string) (time.Time, error) {
	if strings.TrimSpace(deviceID) == "" {
		return time.Time{}, validation("device_id is required.")
	}
	return s.store.RegisterDevice(ctx, accountID, deviceID)
}

// Push validates and applies a mutation batch in request order.
func (s *Service) Push(ctx context.Context, accountID, deviceID, apiVersion string, mutations []domain.Mutation) ([]domain.MutationResult, error) {
	if apiVersion != "1" {
		return nil, &Error{Code: "unsupported_version", Message: "Unsupported API version."}
	}
	if !s.store.DeviceRegistered(ctx, accountID, deviceID) {
		return nil, &Error{Code: "ownership_invalid", Message: "Device is not registered to this account."}
	}
	if len(mutations) > s.batchLimit {
		return nil, validation("Mutation batch exceeds the configured limit.")
	}
	results := make([]domain.MutationResult, 0, len(mutations))
	for _, mutation := range mutations {
		if code, message := s.validateMutation(ctx, accountID, mutation); message != "" {
			results = append(results, rejected(mutation.MutationID, code, message))
			continue
		}
		results = append(results, s.store.ApplyMutations(ctx, accountID, deviceID, []domain.Mutation{mutation}, s.now())...)
	}
	return results, nil
}

// Pull reads one stable-watermark changefeed page.
func (s *Service) Pull(ctx context.Context, accountID string, afterSeq int64, limit int, watermark string) (domain.PullPage, error) {
	if afterSeq < 0 || limit < 1 {
		return domain.PullPage{}, validation("after_seq and limit are invalid.")
	}
	if limit > s.pageLimit {
		limit = s.pageLimit
	}
	page, err := s.store.Pull(ctx, accountID, afterSeq, limit, watermark, s.now())
	if err != nil {
		return domain.PullPage{}, validation("Watermark is invalid or expired.")
	}
	return page, nil
}

func (s *Service) createSession(ctx context.Context, accountID string) (string, string, error) {
	sessionID := uuid.NewString()
	csrfToken := uuid.NewString()
	err := s.store.CreateSession(ctx, sessionID, domain.Session{
		AccountID: accountID, CSRFToken: csrfToken, ExpiresAt: s.now().Add(s.sessionTTL),
	})
	return sessionID, csrfToken, err
}

func validEmail(value string) bool {
	address, err := mail.ParseAddress(value)
	return err == nil && address.Address == value
}

func validPassword(value string) bool { return len(value) >= 8 && len(value) <= maxPasswordBytes }

func rejected(mutationID, code, message string) domain.MutationResult {
	retryable := false
	return domain.MutationResult{MutationID: mutationID, Status: "rejected", ErrorCode: code, ErrorMessage: message, Retryable: &retryable}
}

func validation(message string) error {
	return &Error{Code: "validation_failed", Message: message}
}

// AsError unwraps a known application error.
func AsError(err error) (*Error, bool) {
	var appErr *Error
	if !errors.As(err, &appErr) {
		return nil, false
	}
	return appErr, true
}
