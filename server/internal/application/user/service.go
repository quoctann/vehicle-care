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
	mail       *mailDelivery
	ports      IPorts
	sessionTTL time.Duration
	now        func() time.Time
}

func NewService(ports IPorts, sessionTTL time.Duration) *Service {
	return &Service{ports: ports, sessionTTL: sessionTTL, now: time.Now}
}

func (s *Service) Login(ctx context.Context, email, password string) (domain.Account, string, string, error) {
	account, err := s.ports.AccountByEmail(ctx, strings.TrimSpace(email))
	if err != nil {
		if errors.Is(err, ErrAccountNotFound) {
			return domain.Account{}, "", "", &app.Error{Code: app.ECAuthInvalid, Message: "Invalid email or password."}
		}
		return domain.Account{}, "", "", &app.Error{Code: app.ECInternalError, Message: "Account store is unavailable."}
	}

	if account == nil || bcrypt.CompareHashAndPassword(account.PasswordHash, []byte(password)) != nil {
		return domain.Account{}, "", "", &app.Error{Code: app.ECAuthInvalid, Message: "Invalid email or password."}
	}

	sessionID, csrfToken, err := s.createSession(ctx, *account)

	return *account, sessionID, csrfToken, err
}

func (s *Service) VerifyEmail(ctx context.Context, token string) error {
	accountID, ok, err := s.ports.ConsumeToken(ctx, "verification", token, s.now())
	if err != nil {
		return &app.Error{Code: app.ECInternalError, Message: "Token store is unavailable."}
	}
	if !ok {
		return validation("Verification token is invalid or expired.")
	}
	return s.ports.SetEmailVerified(ctx, accountID)
}

// Signup creates an account, verification token, and immediate login session.
func (s *Service) Signup(ctx context.Context, email, password string, name *string) (domain.Account, string, string, string, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	if !validEmail(email) || !validPassword(password) {
		return domain.Account{}, "", "", "", validation("Invalid email or password")
	}

	existing, err := s.ports.AccountByEmail(ctx, email)
	if err == nil && existing != nil {
		return domain.Account{}, "", "", "", &app.Error{Code: app.ECConflict, Message: "Email is already registered."}
	}
	if err != nil && !errors.Is(err, ErrAccountNotFound) {
		return domain.Account{}, "", "", "", &app.Error{Code: app.ECInternalError, Message: "Store is unavailable."}
	}

	passwordHash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return domain.Account{}, "", "", "", err
	}

	account := domain.Account{
		ID:           uuid.NewString(),
		Email:        email,
		Name:         name,
		Timezone:     "UTC+07:00",
		PasswordHash: passwordHash,
		AuthVersion:  1,
	}
	if err := s.ports.CreateAccount(ctx, account); err != nil {
		if errors.Is(err, ErrAccountExists) {
			return domain.Account{}, "", "", "", &app.Error{Code: app.ECConflict, Message: "Email is already registered."}
		}
		return domain.Account{}, "", "", "", err
	}

	verificationToken := uuid.NewString()
	if err := s.ports.CreateToken(ctx, "verification", verificationToken, account.ID, s.now().Add(verificationTokenTTL)); err != nil {
		return domain.Account{}, "", "", "", err
	}
	sessionID, csrfToken, err := s.createSession(ctx, account)

	if err == nil && s.allowMail(ctx, account.Email) {
		s.sendTokenMail(ctx, account.Email, TokenKindVerification, verificationToken)
	}

	return account, sessionID, csrfToken, verificationToken, err
}

// CreateVerificationToken creates a token when an account exists.
func (s *Service) CreateVerificationToken(ctx context.Context, email string) (string, bool, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	if !s.allowMail(ctx, email) {
		return "", false, nil
	}

	account, err := s.ports.AccountByEmail(ctx, email)
	if err != nil {
		if errors.Is(err, ErrAccountNotFound) {
			return "", false, nil
		}
		return "", false, &app.Error{Code: app.ECInternalError, Message: "Account store is unavailable."}
	}

	if account == nil || account.EmailVerified {
		return "", false, nil
	}

	token := uuid.NewString()
	if err := s.ports.CreateToken(ctx, TokenKindVerification, token, account.ID, s.now().Add(verificationTokenTTL)); err != nil {
		return "", false, err
	}
	s.sendTokenMail(ctx, account.Email, TokenKindVerification, token)
	return token, true, nil
}

// CreateResetToken creates a password reset token when an account exists.
func (s *Service) CreateResetToken(ctx context.Context, email string) (string, bool, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	if !s.allowMail(ctx, email) {
		return "", false, nil
	}

	account, err := s.ports.AccountByEmail(ctx, email)
	if err != nil {
		if errors.Is(err, ErrAccountNotFound) {
			return "", false, nil
		}
		return "", false, &app.Error{Code: app.ECInternalError, Message: "Account store is unavailable."}
	}

	// Google-only accounts remain passwordless; forgot-password is still generic.
	if account == nil || len(account.PasswordHash) == 0 {
		return "", false, nil
	}
	token := uuid.NewString()
	if err := s.ports.CreateToken(ctx, TokenKindReset, token, resetSubject(*account), s.now().Add(resetTokenTTL)); err != nil {
		return "", false, err
	}

	s.sendTokenMail(ctx, account.Email, TokenKindReset, token)

	return token, true, nil
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

	subject, ok, err := s.ports.ConsumeToken(ctx, TokenKindReset, token, s.now())
	if err != nil {
		return &app.Error{Code: app.ECInternalError, Message: "Token store is unavailable."}
	}
	if !ok {
		return validation("Password reset token is invalid or expired.")
	}

	accountID, version, ok := parseResetSubject(subject)
	if !ok {
		return validation("Password reset token is invalid or expired.")
	}
	account, err := s.ports.AccountByID(ctx, accountID)
	if err != nil {
		return &app.Error{Code: app.ECInternalError, Message: "Account store is unavailable."}
	}
	if account == nil || len(account.PasswordHash) == 0 || account.AuthVersion != version {
		return validation("Password reset token is invalid or expired.")
	}

	if err := s.ports.SetPassword(ctx, accountID, passwordHash, version); err != nil {
		if errors.Is(err, ErrAuthVersionChanged) {
			return validation("Password reset token is invalid or expired.")
		}
		return err
	}

	// PostgreSQL is the revocation authority. Do not delete every Redis session:
	// a login using the new credentials may already have created a fresh version.
	// Old session records expire through their normal Redis TTL.
	return nil
}

// ResolveSession returns the session and account represented by an opaque ID.
func (s *Service) ResolveSession(ctx context.Context, sessionID string) (domain.Session, domain.Account, error) {
	session, found, err := s.ports.GetAndRefreshSession(ctx, sessionID, s.now(), s.now().Add(s.sessionTTL))
	if err != nil {
		return domain.Session{}, domain.Account{}, &app.Error{Code: app.ECInternalError, Message: "Session store is unavailable."}
	}
	if !found || session == nil {
		return domain.Session{}, domain.Account{}, &app.Error{Code: app.ECSessionExpired, Message: "Session expired or missing."}
	}
	account, err := s.ports.AccountByID(ctx, session.AccountID)
	if err != nil {
		if errors.Is(err, ErrAccountNotFound) {
			return domain.Session{}, domain.Account{}, &app.Error{Code: app.ECSessionExpired, Message: "Session expired or missing."}
		}
		return domain.Session{}, domain.Account{}, &app.Error{Code: app.ECInternalError, Message: "Account store is unavailable."}
	}
	if account == nil || session.AuthVersion <= 0 || session.AuthVersion != account.AuthVersion {
		return domain.Session{}, domain.Account{}, &app.Error{Code: app.ECSessionExpired, Message: "Session expired or missing."}
	}

	return *session, *account, nil
}

// Logout deletes the current session.
func (s *Service) Logout(ctx context.Context, sessionID string) error {
	return s.ports.DeleteSession(ctx, sessionID)
}

// RegisterDevice associates a validated device with the current account.
func (s *Service) RegisterDevice(ctx context.Context, accountID, deviceID string) (time.Time, error) {
	if _, err := uuid.Parse(deviceID); err != nil {
		return time.Time{}, validation("device_id must be a UUID.")
	}
	return s.ports.RegisterDevice(ctx, accountID, deviceID)
}

func (s *Service) createSession(ctx context.Context, account domain.Account) (string, string, error) {
	sessionID := uuid.NewString()
	csrfToken := uuid.NewString()

	err := s.ports.CreateSession(ctx, sessionID, domain.Session{
		AccountID:   account.ID,
		AuthVersion: account.AuthVersion,
		CSRFToken:   csrfToken,
		ExpiresAt:   s.now().Add(s.sessionTTL),
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
	return &app.Error{Code: app.ECValidationFailed, Message: message}
}
