package seed

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/quoctann/vehicle-care/server/internal/adapters/postgres/sqlcgen"
)

// SeedAccountPartTypes inserts the manifest as accountID's own part_types
// rows: a fresh id per row (never reused across accounts, since every
// account needs its own row), same code/name_vi/display_order/seed_version
// as the manifest, active, and server_seq left at 0 (not allocated via
// NextSeq — these rows never go through change_feed; a client learns about
// them via GET /part-types, not /sync/pull).
//
// Must run inside the same transaction as account creation (see
// postgres.Store.CreateAccount) — it is not idempotent by itself (each call
// mints new ids), so calling it twice for the same account would duplicate
// rows. That's fine because it only ever runs once, at signup.
func SeedAccountPartTypes(ctx context.Context, q *sqlcgen.Queries, accountID string, now time.Time) error {
	for _, item := range Manifest {
		rowsAffected, err := q.UpsertPartType(ctx, sqlcgen.UpsertPartTypeParams{
			ID:               uuid.NewString(),
			AccountID:        accountID,
			Code:             item.Code,
			NameVi:           item.NameVI,
			DisplayOrder:     int32(item.DisplayOrder),
			Active:           true,
			SeedVersion:      item.SeedVersion,
			ServerSeq:        0,
			ReceivedAtServer: now,
		})
		if err != nil {
			return fmt.Errorf("seed part_type %s for account %s: %w", item.Code, accountID, err)
		}
		if rowsAffected != 1 {
			return fmt.Errorf("seed part_type %s for account %s: ownership conflict", item.Code, accountID)
		}
	}
	return nil
}
