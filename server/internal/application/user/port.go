package user

import (
	"context"
	"errors"
	"time"

	"github.com/quoctann/vehicle-care/server/internal/domain"
)

var ErrAccountExists = errors.New("account already exists")

var ErrAccountNotFound = errors.New("account not found")

type IAccountStore interface {
	CreateAccount(ctx context.Context, account domain.Account) error
	AccountByEmail(ctx context.Context, email string) (*domain.Account, error)
	AccountByID(ctx context.Context, id string) (*domain.Account, error)
	SetEmailVerified(ctx context.Context, accountID string) error
	SetPassword(ctx context.Context, accountID string, passwordHash []byte) error
	RegisterDevice(ctx context.Context, accountID, deviceID string) (time.Time, error)
}

type TokenKind string

const (
	TokenKindVerification TokenKind = "verification"
	TokenKindReset        TokenKind = "reset"
)

type ISessionStore interface {
	CreateSession(ctx context.Context, sessionID string, session domain.Session) error
	GetAndRefreshSession(ctx context.Context, sessionID string, now, newExpiresAt time.Time) (domain.Session, bool, error)
	Session(ctx context.Context, sessionID string, now time.Time) (domain.Session, bool, error)
	RefreshSession(ctx context.Context, sessionID string, expiresAt time.Time) error
	DeleteSession(ctx context.Context, sessionID string) error
	DeleteAccountSessions(ctx context.Context, accountID string) error
}

type ITokenStore interface {
	CreateToken(ctx context.Context, kind TokenKind, token, accountID string, expiresAt time.Time) error
	ConsumeToken(ctx context.Context, kind TokenKind, token string, now time.Time) (string, bool, error)
}

type IPorts interface {
	IAccountStore
	ISessionStore
	ITokenStore
}
