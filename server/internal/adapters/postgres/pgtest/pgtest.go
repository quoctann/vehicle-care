// Package pgtest starts a real PostgreSQL container (via testcontainers-go)
// and applies migrations, for use by adapter and seed tests that need
// PostgreSQL-only behavior (row locks, unique_violation, SAVEPOINT).
//
// Every test using this package requires a working Docker (or compatible)
// daemon reachable from the test process. If Docker is unavailable, callers
// should skip with t.Skipf rather than fail the whole suite.
package pgtest

import (
	"context"
	"database/sql"
	"fmt"
	"testing"
	"time"

	"github.com/golang-migrate/migrate/v4"
	"github.com/golang-migrate/migrate/v4/database/postgres"
	"github.com/golang-migrate/migrate/v4/source/iofs"
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
// If Docker is not available in the current environment, the test is
// skipped (not failed) with an explanation.
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
	if err := migrateUp(db); err != nil {
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

func migrateUp(db *sql.DB) error {
	sourceDriver, err := iofs.New(migrations.FS, ".")
	if err != nil {
		return fmt.Errorf("load migration source: %w", err)
	}
	dbDriver, err := postgres.WithInstance(db, &postgres.Config{})
	if err != nil {
		return fmt.Errorf("create postgres driver: %w", err)
	}
	m, err := migrate.NewWithInstance("iofs", sourceDriver, "postgres", dbDriver)
	if err != nil {
		return fmt.Errorf("create migrator: %w", err)
	}
	if err := m.Up(); err != nil && err != migrate.ErrNoChange {
		return fmt.Errorf("apply migrations: %w", err)
	}
	return nil
}
