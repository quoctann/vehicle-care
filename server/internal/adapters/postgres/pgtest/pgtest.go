// Package pgtest starts a real PostgreSQL container (via testcontainers-go)
// and applies migrations, for use by adapter and seed tests that need
// PostgreSQL-only behavior (row locks, unique_violation, SAVEPOINT).
//
// Every test using this package requires a working Docker (or compatible)
// daemon reachable from the test process. Local runs skip when unavailable;
// REQUIRE_POSTGRES_TESTS=1 makes infrastructure failures fatal for CI/acceptance.
package pgtest

import (
	"context"
	"database/sql"
	"os"
	"testing"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
	tcpostgres "github.com/testcontainers/testcontainers-go/modules/postgres"

	"github.com/quoctann/vehicle-care/server/db/migrations"
)

// StartDSN starts an ephemeral PostgreSQL container, applies every
// migration, and returns its connection string. The container is torn down
// automatically via t.Cleanup. Callers that need their own *sql.DB or
// connection pool (e.g. to construct a postgres.Store) should open it from
// this DSN themselves.
//
// If Docker is not available, skip with an explanation unless the caller sets
// REQUIRE_POSTGRES_TESTS=1 (make test-integration).
func StartDSN(t *testing.T) string {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	container, err := tcpostgres.Run(ctx,
		"postgres:16-alpine",
		tcpostgres.WithDatabase("vehicle_test"),
		tcpostgres.WithUsername("vehicle_test"),
		tcpostgres.WithPassword("vehicle_test"),
		tcpostgres.BasicWaitStrategies(),
	)
	if err != nil {
		if os.Getenv("REQUIRE_POSTGRES_TESTS") == "1" {
			t.Fatalf("pgtest: PostgreSQL integration tests are required, but Docker failed: %v", err)
		}
		t.Skipf("pgtest: docker unavailable, skipping PostgreSQL-backed test: %v", err)
		return ""
	}
	t.Cleanup(func() {
		_ = container.Terminate(context.Background())
	})

	dsn, err := container.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		t.Fatalf("pgtest: connection string: %v", err)
	}

	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatalf("pgtest: open db: %v", err)
	}
	defer db.Close()

	if err := waitForPing(db); err != nil {
		t.Fatalf("pgtest: ping db: %v", err)
	}
	if err := migrations.Up(db); err != nil {
		t.Fatalf("pgtest: migrate up: %v", err)
	}

	return dsn
}

// StartDB starts an ephemeral, migrated PostgreSQL container like StartDSN,
// and returns an open *sql.DB connected to it. The container and connection
// are torn down automatically via t.Cleanup.
func StartDB(t *testing.T) *sql.DB {
	t.Helper()
	dsn := StartDSN(t)
	if dsn == "" {
		return nil // StartDSN already skipped the test.
	}

	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatalf("pgtest: open db: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	if err := waitForPing(db); err != nil {
		t.Fatalf("pgtest: ping db: %v", err)
	}

	return db
}

func waitForPing(db *sql.DB) error {
	deadline := time.Now().Add(30 * time.Second)
	var lastErr error
	for time.Now().Before(deadline) {
		if lastErr = db.Ping(); lastErr == nil {
			return nil
		}
		time.Sleep(200 * time.Millisecond)
	}
	return lastErr
}
