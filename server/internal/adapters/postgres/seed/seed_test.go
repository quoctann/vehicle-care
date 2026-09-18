package seed_test

import (
	"context"
	"testing"

	"github.com/quoctann/vehicle-care/server/internal/adapters/postgres/pgtest"
	"github.com/quoctann/vehicle-care/server/internal/adapters/postgres/seed"
)

// TestSeedIsIdempotent runs the seed twice and asserts the second run
// creates no duplicate rows and changes no id or code, per C3 in
// .docs/implementation-plan-section-5.md.
//
// Requires a real Docker daemon (testcontainers). If Docker is unavailable
// in this environment, pgtest.StartDB skips the test rather than failing it.
func TestSeedIsIdempotent(t *testing.T) {
	t.Parallel()
	db := pgtest.StartDB(t)
	ctx := context.Background()

	if err := seed.Seed(ctx, db, seed.Manifest); err != nil {
		t.Fatalf("first seed: %v", err)
	}
	if err := seed.Seed(ctx, db, seed.Manifest); err != nil {
		t.Fatalf("second seed: %v", err)
	}

	var count int
	if err := db.QueryRowContext(ctx, "SELECT count(*) FROM part_types").Scan(&count); err != nil {
		t.Fatalf("count part_types: %v", err)
	}
	if count != len(seed.Manifest) {
		t.Fatalf("expected %d part_types after two seed runs, got %d", len(seed.Manifest), count)
	}

	for _, item := range seed.Manifest {
		var id, code string
		if err := db.QueryRowContext(ctx, "SELECT id, code FROM part_types WHERE id = $1", item.ID).Scan(&id, &code); err != nil {
			t.Fatalf("lookup %s: %v", item.Code, err)
		}
		if id != item.ID || code != item.Code {
			t.Fatalf("seed row drifted: want id=%s code=%s, got id=%s code=%s", item.ID, item.Code, id, code)
		}
	}
}
