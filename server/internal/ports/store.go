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

// Store is the persistence boundary used by the current application services.
// Its methods are use-case oriented so SQL and Redis adapters can replace the
// in-memory implementation independently in a later phase.
type Store interface {
	CreateAccount(ctx context.Context, account domain.Account) error
	AccountByEmail(ctx context.Context, email string) (domain.Account, bool)
	AccountByID(ctx context.Context, id string) (domain.Account, bool)
	SetEmailVerified(ctx context.Context, accountID string) error
	SetPassword(ctx context.Context, accountID string, passwordHash []byte) error

	CreateToken(ctx context.Context, kind, token, accountID string, expiresAt time.Time) error
	ConsumeToken(ctx context.Context, kind, token string, now time.Time) (string, bool)
	CreateSession(ctx context.Context, sessionID string, session domain.Session) error
	Session(ctx context.Context, sessionID string, now time.Time) (domain.Session, bool)
	RefreshSession(ctx context.Context, sessionID string, expiresAt time.Time) error
	DeleteSession(ctx context.Context, sessionID string) error
	DeleteAccountSessions(ctx context.Context, accountID string) error

	RegisterDevice(ctx context.Context, accountID, deviceID string) (time.Time, error)
	DeviceRegistered(ctx context.Context, accountID, deviceID string) bool
	EntityExists(ctx context.Context, accountID, entityType, entityID string) bool
	ApplyMutations(ctx context.Context, accountID, deviceID string, mutations []domain.Mutation, now time.Time) []domain.MutationResult
	Pull(ctx context.Context, accountID string, afterSeq int64, limit int, watermark string, now time.Time) (domain.PullPage, error)
}
