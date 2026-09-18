package seed

import (
	"context"
	"database/sql"
	"fmt"
)

const upsertPartType = `
INSERT INTO part_types (id, code, name_vi, display_order, active, seed_version)
VALUES ($1, $2, $3, $4, true, $5)
ON CONFLICT (id) DO UPDATE
  SET name_vi = EXCLUDED.name_vi, display_order = EXCLUDED.display_order, seed_version = EXCLUDED.seed_version
  WHERE part_types.code = EXCLUDED.code;
`

// Seed applies the part_types manifest idempotently: running it repeatedly
// never creates duplicate rows and never changes an existing row's id or
// code. Each entry is applied in its own statement so a single mismatched
// row (code changed for a fixed id) is skipped rather than aborting the
// whole run; ON CONFLICT DO UPDATE ... WHERE keeps that row untouched in
// that case.
func Seed(ctx context.Context, db *sql.DB, manifest []PartTypeSeed) error {
	for _, item := range manifest {
		if _, err := db.ExecContext(ctx, upsertPartType, item.ID, item.Code, item.NameVI, item.DisplayOrder, item.SeedVersion); err != nil {
			return fmt.Errorf("seed part_type %s: %w", item.Code, err)
		}
	}
	return nil
}
