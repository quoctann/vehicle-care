package user

import (
	"context"
	"errors"
	"time"

	"github.com/quoctann/vehicle-care/server/internal/domain"
)

var ErrAccountExists = errors.New("account already exists")

var ErrAccountNotFound = errors.New("account not found")

// IAccountStore persists account identity and credentials. It is owned by the
// PostgreSQL adapter.
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

// ISessionStore persists login sessions. It is owned by the Redis adapter.
//
// GetAndRefreshSession and ConsumeToken return an error distinct from "not
// found" so callers can tell an expired/missing session apart from a
// backing-store failure (the latter must not be reported to clients as
// session_expired).
type ISessionStore interface {
	CreateSession(ctx context.Context, sessionID string, session domain.Session) error
	// GetAndRefreshSession atomically reads a session and slides its expiry
	// to newExpiresAt in a single round-trip to the backing store. It replaces
	// separate Session + RefreshSession calls on the request hot path.
	GetAndRefreshSession(ctx context.Context, sessionID string, now, newExpiresAt time.Time) (domain.Session, bool, error)
	Session(ctx context.Context, sessionID string, now time.Time) (domain.Session, bool, error)
	RefreshSession(ctx context.Context, sessionID string, expiresAt time.Time) error
	DeleteSession(ctx context.Context, sessionID string) error
	DeleteAccountSessions(ctx context.Context, accountID string) error
}

// ITokenStore persists one-time auth tokens (email verification, password
// reset). It is owned by the Redis adapter.
type ITokenStore interface {
	CreateToken(ctx context.Context, kind TokenKind, token, accountID string, expiresAt time.Time) error
	ConsumeToken(ctx context.Context, kind TokenKind, token string, now time.Time) (string, bool, error)
}

// IDependencies is the full storage port user.Service requires, composed from
// the adapter-owned pieces above.
type IDependencies interface {
	IAccountStore
	ISessionStore
	ITokenStore
}
