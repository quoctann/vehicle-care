package seed

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/quoctann/vehicle-care/server/internal/adapters/postgres/sqlcgen"
)

// SeedAccountPartTypes inserts the manifest as accountID's own part_types
// rows: a fresh id per row (never reused across accounts, since every
// account needs its own row), same code/name_vi/display_order/seed_version
// as the manifest. Seed rows are regular changefeed entries so a new device
// can rebuild the complete account through the normal pull pipeline.
//
// Must run inside the same transaction as account creation (see
// postgres.Store.CreateAccount) — it is not idempotent by itself (each call
// mints new ids), so calling it twice for the same account would duplicate
// rows. That's fine because it only ever runs once, at signup.
func SeedAccountPartTypes(ctx context.Context, q *sqlcgen.Queries, accountID string, now time.Time) error {
	for _, item := range Manifest {
		id := uuid.NewString()
		seq, err := q.NextSeq(ctx, accountID)
		if err != nil {
			return fmt.Errorf("allocate part_type sequence for %s: %w", item.Code, err)
		}
		rowsAffected, err := q.UpsertPartType(ctx, sqlcgen.UpsertPartTypeParams{
			ID:               id,
			AccountID:        accountID,
			Code:             item.Code,
			NameVi:           item.NameVI,
			DisplayOrder:     int32(item.DisplayOrder),
			Active:           true,
			SeedVersion:      item.SeedVersion,
			ServerSeq:        seq,
			ReceivedAtServer: now,
		})
		if err != nil {
			return fmt.Errorf("seed part_type %s for account %s: %w", item.Code, accountID, err)
		}
		if rowsAffected != 1 {
			return fmt.Errorf("seed part_type %s for account %s: ownership conflict", item.Code, accountID)
		}
		payload, err := json.Marshal(map[string]any{
			"code": item.Code, "name_vi": item.NameVI, "display_order": item.DisplayOrder,
			"active": true, "seed_version": item.SeedVersion,
		})
		if err != nil {
			return fmt.Errorf("marshal seed part_type %s: %w", item.Code, err)
		}
		if err := q.InsertChange(ctx, sqlcgen.InsertChangeParams{
			AccountID: accountID, ServerSeq: seq, EntityType: "part_type", EntityID: id,
			Operation: "create", Payload: payload, ReceivedAtServer: now,
		}); err != nil {
			return fmt.Errorf("append seed part_type %s: %w", item.Code, err)
		}
	}
	return nil
}
