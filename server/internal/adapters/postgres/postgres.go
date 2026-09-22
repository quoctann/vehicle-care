// Package postgres implements the account and sync storage ports (see
// application/user.Dependencies and application/datasync.Dependencies) on
// top of PostgreSQL. sqlx owns connection setup and transaction orchestration;
// sqlc (internal/adapters/postgres/sqlcgen) owns typed, generated queries
// that never cross this package boundary.
package postgres

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib" // registers the "pgx" database/sql driver
	"github.com/jmoiron/sqlx"

	"github.com/quoctann/vehicle-care/server/internal/adapters/postgres/sqlcgen"
	"github.com/quoctann/vehicle-care/server/internal/application/datasync"
	"github.com/quoctann/vehicle-care/server/internal/application/user"
)

// Pool tuning defaults. These are conservative values for a single API
// replica talking to a small managed PostgreSQL instance; they are not
// mandated by the plan and can be revisited once real load is observed.
const (
	defaultMaxOpenConns    = 25
	defaultMaxIdleConns    = 25
	defaultConnMaxLifetime = 30 * time.Minute
	defaultConnMaxIdleTime = 5 * time.Minute
)

// Store implements the account and sync storage ports consumed by the user
// and datasync application services.
type Store struct {
	db      *sqlx.DB
	queries *sqlcgen.Queries
}

var (
	_ user.IAccountStore     = (*Store)(nil)
	_ datasync.IDependencies = (*Store)(nil)
)

// New opens a PostgreSQL connection pool for dsn and verifies connectivity
// with a ping before returning.
func New(ctx context.Context, dsn string) (*Store, error) {
	sqlDB, err := sql.Open("pgx", dsn)
	if err != nil {
		return nil, fmt.Errorf("postgres: open: %w", err)
	}
	sqlDB.SetMaxOpenConns(defaultMaxOpenConns)
	sqlDB.SetMaxIdleConns(defaultMaxIdleConns)
	sqlDB.SetConnMaxLifetime(defaultConnMaxLifetime)
	sqlDB.SetConnMaxIdleTime(defaultConnMaxIdleTime)

	db := sqlx.NewDb(sqlDB, "pgx")

	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := db.PingContext(pingCtx); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("postgres: ping: %w", err)
	}

	return &Store{db: db, queries: sqlcgen.New(db)}, nil
}

// Ping reports whether the database is reachable.
func (s *Store) Ping(ctx context.Context) error {
	if err := s.db.PingContext(ctx); err != nil {
		return fmt.Errorf("postgres: ping: %w", err)
	}
	return nil
}

// Close releases the underlying connection pool.
func (s *Store) Close() error {
	return s.db.Close()
}
