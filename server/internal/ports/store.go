// Package ports defines storage capabilities required by the application.
package ports

import (
	"context"
	"errors"
	"time"

	"github.com/quoctann/vehicle-care/server/internal/domain"
)

// ErrAccountExists is returned when an email uniqueness constraint is violated.
var ErrAccountExists = errors.New("account already exists")

// AccountStore persists account identity and credentials. It is owned by the
// PostgreSQL adapter.
type AccountStore interface {
	CreateAccount(ctx context.Context, account domain.Account) error
	AccountByEmail(ctx context.Context, email string) (domain.Account, bool)
	AccountByID(ctx context.Context, id string) (domain.Account, bool)
	SetEmailVerified(ctx context.Context, accountID string) error
	SetPassword(ctx context.Context, accountID string, passwordHash []byte) error
}

// SyncStore persists devices and the push/pull changefeed, and serves the
// read-only part type catalog. It is owned by the PostgreSQL adapter.
type SyncStore interface {
	RegisterDevice(ctx context.Context, accountID, deviceID string) (time.Time, error)
	DeviceRegistered(ctx context.Context, accountID, deviceID string) bool
	EntityExists(ctx context.Context, accountID, entityType, entityID string) bool
	ApplyMutations(ctx context.Context, accountID, deviceID string, mutations []domain.Mutation, now time.Time) []domain.MutationResult
	Pull(ctx context.Context, accountID string, afterSeq int64, limit int, watermark string, now time.Time) (domain.PullPage, error)
	// ListPartTypes returns the global part-type catalog plus accountID's own
	// custom rows, ordered with globals first. It is the single source of
	// truth clients reconcile against instead of hardcoding their own UUIDs.
	ListPartTypes(ctx context.Context, accountID string) ([]domain.PartType, error)
}

// SessionStore persists login sessions. It is owned by the Redis adapter.
//
// Session and ConsumeToken return an error distinct from "not found" so
// callers can tell an expired/missing session apart from a backing-store
// failure (the latter must not be reported to clients as session_expired).
type SessionStore interface {
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

// TokenStore persists one-time auth tokens (email verification, password
// reset). It is owned by the Redis adapter.
type TokenStore interface {
	CreateToken(ctx context.Context, kind, token, accountID string, expiresAt time.Time) error
	ConsumeToken(ctx context.Context, kind, token string, now time.Time) (string, bool, error)
}

// Store is the full persistence boundary used by the current application
// services. It is composed from smaller, adapter-owned interfaces so the
// PostgreSQL adapter (AccountStore, SyncStore) and the Redis adapter
// (SessionStore, TokenStore) each implement only the part they own; a
// composition-root type embeds both adapters to satisfy Store as a whole.
type Store interface {
	AccountStore
	SyncStore
	SessionStore
	TokenStore
}
