package datasync

import (
	"context"
	"time"

	"github.com/quoctann/vehicle-care/server/internal/domain"
)

type IPorts interface {
	DeviceRegistered(ctx context.Context, accountID, deviceID string) (bool, error)
	ApplyMutation(ctx context.Context, accountID, deviceID string, mutation domain.Mutation, now time.Time) *domain.MutationResult
	Pull(ctx context.Context, accountID string, afterSeq int64, limit int, untilSeq *int64) (*domain.PullPage, error)
	ListPartTypes(ctx context.Context, accountID string) ([]*domain.PartType, error)
}
