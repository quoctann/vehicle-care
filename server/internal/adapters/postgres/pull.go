package postgres

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/quoctann/vehicle-care/server/internal/adapters/postgres/sqlcgen"
	"github.com/quoctann/vehicle-care/server/internal/domain"
)

// Pull returns one page bounded by untilSeq. When untilSeq is nil, the current
// account sequence is captured as the bound for the caller's first page.
func (s *Store) Pull(ctx context.Context, accountID string, afterSeq int64, limit int, untilSeq *int64) (domain.PullPage, error) {
	tx, err := s.db.BeginTxx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return domain.PullPage{}, fmt.Errorf("postgres: begin pull: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	queries := sqlcgen.New(tx)

	currentSeq, err := queries.CurrentSeq(ctx, accountID)
	if err != nil {
		return domain.PullPage{}, fmt.Errorf("postgres: read current seq: %w", err)
	}
	upperBound := currentSeq
	if untilSeq != nil && *untilSeq < upperBound {
		upperBound = *untilSeq
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

	return domain.PullPage{Changes: changes, NextCursor: nextCursor, UntilSeq: upperBound, HasMore: hasMore}, nil
}
