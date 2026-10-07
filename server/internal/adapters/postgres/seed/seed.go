package seed

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/quoctann/vehicle-care/server/internal/adapters/postgres/sqlcgen"
	"github.com/quoctann/vehicle-care/server/internal/domain"
)

func SeedAccountPartTypes(ctx context.Context, q *sqlcgen.Queries, accountID string, now time.Time) error {
	for _, item := range Manifest {
		id := uuid.NewString()
		seq, err := q.NextAccountSequence(ctx, accountID)
		if err != nil {
			return fmt.Errorf("allocate part_type sequence for %s: %w", item.Code, err)
		}

		rowsAffected, err := q.UpsertPartType(ctx, sqlcgen.UpsertPartTypeParams{
			ID:             id,
			AccountID:      accountID,
			Code:           item.Code,
			Name:           item.Name,
			DisplayOrder:   int32(item.DisplayOrder),
			Active:         true,
			ServerSeq:      seq,
			ServerSyncedAt: now,
		})
		if err != nil {
			return fmt.Errorf("seed part_type %s for account %s: %w", item.Code, accountID, err)
		}
		if rowsAffected != 1 {
			return fmt.Errorf("seed part_type %s for account %s: ownership conflict", item.Code, accountID)
		}

		payload, err := json.Marshal(map[string]any{
			"code":          item.Code,
			"name":          item.Name,
			"display_order": item.DisplayOrder,
			"active":        true,
		})
		if err != nil {
			return fmt.Errorf("marshal seed part_type %s: %w", item.Code, err)
		}

		if err := q.InsertChange(ctx, sqlcgen.InsertChangeParams{
			AccountID: accountID, ServerSeq: seq, EntityType: string(domain.EntityPartType), EntityID: id,
			Operation: string(domain.OperationCreate), Payload: payload, ServerSyncedAt: now,
		}); err != nil {
			return fmt.Errorf("append seed part_type %s: %w", item.Code, err)
		}
	}

	return nil
}
