package seed_test

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/quoctann/vehicle-care/server/internal/adapters/postgres/pgtest"
	"github.com/quoctann/vehicle-care/server/internal/adapters/postgres/seed"
	"github.com/quoctann/vehicle-care/server/internal/adapters/postgres/sqlcgen"
)

// TestSeedAccountPartTypesInsertsManifestForAccount asserts a single call
// inserts exactly the manifest's rows for the given account, and that two
// different accounts get disjoint ids for the same codes.
func TestSeedAccountPartTypesInsertsManifestForAccount(t *testing.T) {
	t.Parallel()
	db := pgtest.StartDB(t)
	ctx := context.Background()
	now := time.Now().UTC()

	accountA := insertTestAccount(t, db)
	accountB := insertTestAccount(t, db)

	queries := sqlcgen.New(db)
	if err := seed.SeedAccountPartTypes(ctx, queries, accountA, now); err != nil {
		t.Fatalf("seed account a: %v", err)
	}
	if err := seed.SeedAccountPartTypes(ctx, queries, accountB, now); err != nil {
		t.Fatalf("seed account b: %v", err)
	}

	rowsA := selectPartTypesByAccount(t, db, accountA)
	rowsB := selectPartTypesByAccount(t, db, accountB)

	if len(rowsA) != len(seed.Manifest) || len(rowsB) != len(seed.Manifest) {
		t.Fatalf("expected %d part_types per account, got a=%d b=%d", len(seed.Manifest), len(rowsA), len(rowsB))
	}

	for _, item := range seed.Manifest {
		idA, okA := rowsA[item.Code]
		idB, okB := rowsB[item.Code]
		if !okA || !okB {
			t.Fatalf("code %s missing for one of the accounts: a=%v b=%v", item.Code, okA, okB)
		}
		if idA == idB {
			t.Fatalf("code %s got the same id for both accounts: %s", item.Code, idA)
		}
	}
}

func insertTestAccount(t *testing.T, db *sql.DB) string {
	t.Helper()
	id := uuid.NewString()
	_, err := db.Exec(`INSERT INTO accounts (id, email) VALUES ($1, $2); INSERT INTO account_sequences (account_id) VALUES ($1)`, id, id+"@example.test")
	if err != nil {
		t.Fatalf("insert test account: %v", err)
	}
	return id
}

func selectPartTypesByAccount(t *testing.T, db *sql.DB, accountID string) map[string]string {
	t.Helper()
	rows, err := db.Query(`SELECT code, id FROM part_types WHERE account_id = $1`, accountID)
	if err != nil {
		t.Fatalf("select part_types: %v", err)
	}
	defer rows.Close()
	byCode := map[string]string{}
	for rows.Next() {
		var code, id string
		if err := rows.Scan(&code, &id); err != nil {
			t.Fatalf("scan part_type row: %v", err)
		}
		byCode[code] = id
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate part_types: %v", err)
	}
	return byCode
}
