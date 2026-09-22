package datasync

import (
	"context"
	"time"

	"github.com/quoctann/vehicle-care/server/internal/domain"
)

// IDependencies is the storage port datasync.Service requires. It is owned by
// the PostgreSQL adapter.
type IDependencies interface {
	DeviceRegistered(ctx context.Context, accountID, deviceID string) bool
	EntityExists(ctx context.Context, accountID, entityType, entityID string) bool
	PartTypeActive(ctx context.Context, accountID, partTypeID string) bool
	EntityReferencesPartType(ctx context.Context, accountID, entityType, entityID, partTypeID string) bool
	ApplyMutations(ctx context.Context, accountID, deviceID string, mutations []domain.Mutation, now time.Time) []domain.MutationResult
	Pull(ctx context.Context, accountID string, afterSeq int64, limit int, watermark string, now time.Time) (domain.PullPage, error)
	// ListPartTypes returns accountID's catalog. It is the single source of
	// truth clients reconcile against instead of hardcoding UUIDs.
	ListPartTypes(ctx context.Context, accountID string) ([]domain.PartType, error)
}
