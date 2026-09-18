package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/quoctann/vehicle-care/server/internal/adapters/postgres/sqlcgen"
	"github.com/quoctann/vehicle-care/server/internal/domain"
)

// pullWatermarkTTL matches memory.Store.Pull's fixed 15 minute window.
const pullWatermarkTTL = 15 * time.Minute

// Pull returns one stable-watermark changefeed page, mirroring
// memory.Store.Pull: the watermark fixes an upper_bound the first time it
// is minted so a multi-page pull never observes changes written after the
// pull session started.
func (s *Store) Pull(ctx context.Context, accountID string, afterSeq int64, limit int, watermark string, now time.Time) (domain.PullPage, error) {
	tx, err := s.db.BeginTxx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return domain.PullPage{}, fmt.Errorf("postgres: begin pull: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	queries := sqlcgen.New(tx)

	if err := queries.CleanupExpiredWatermarks(ctx, sqlcgen.CleanupExpiredWatermarksParams{AccountID: accountID, ExpiresAt: now}); err != nil {
		return domain.PullPage{}, fmt.Errorf("postgres: cleanup expired watermarks: %w", err)
	}

	var upperBound int64
	if watermark == "" {
		currentSeq, err := queries.CurrentSeq(ctx, accountID)
		if err != nil {
			if !errors.Is(err, sql.ErrNoRows) {
				return domain.PullPage{}, fmt.Errorf("postgres: read current seq: %w", err)
			}
			currentSeq = 0
		}
		watermark = "wm_" + uuid.NewString()
		upperBound = currentSeq
		if err := queries.MintWatermark(ctx, sqlcgen.MintWatermarkParams{
			AccountID: accountID, Token: watermark, UpperBound: upperBound, ExpiresAt: now.Add(pullWatermarkTTL),
		}); err != nil {
			return domain.PullPage{}, fmt.Errorf("postgres: mint watermark: %w", err)
		}
	} else {
		record, err := queries.FindWatermark(ctx, sqlcgen.FindWatermarkParams{AccountID: accountID, Token: watermark})
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return domain.PullPage{}, errors.New("postgres: invalid or expired watermark")
			}
			return domain.PullPage{}, fmt.Errorf("postgres: find watermark: %w", err)
		}
		upperBound = record.UpperBound
	}

	// Fetch one extra row to determine hasMore without a second query.
	rows, err := queries.ListChangesInRange(ctx, sqlcgen.ListChangesInRangeParams{
		AccountID: accountID, ServerSeq: afterSeq, ServerSeq_2: upperBound, Limit: int32(limit + 1),
	})
	if err != nil {
		return domain.PullPage{}, fmt.Errorf("postgres: list changes: %w", err)
	}

	hasMore := len(rows) > limit
	if hasMore {
		rows = rows[:limit]
	}

	changes := make([]domain.Change, 0, len(rows))
	for _, row := range rows {
		payload, err := unmarshalPayload(row.Payload)
		if err != nil {
			return domain.PullPage{}, err
		}
		changes = append(changes, domain.Change{
			ServerSeq:        row.ServerSeq,
			EntityType:       row.EntityType,
			EntityID:         row.EntityID,
			Operation:        row.Operation,
			Payload:          payload,
			ReceivedAtServer: row.ReceivedAtServer,
		})
	}

	nextCursor := afterSeq
	if len(changes) > 0 {
		nextCursor = changes[len(changes)-1].ServerSeq
	}

	if err := tx.Commit(); err != nil {
		return domain.PullPage{}, fmt.Errorf("postgres: commit pull: %w", err)
	}

	return domain.PullPage{Changes: changes, NextCursor: nextCursor, Watermark: watermark, HasMore: hasMore}, nil
}
