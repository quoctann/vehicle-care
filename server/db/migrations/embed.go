// Package migrations embeds the SQL migration files so they ship inside the
// compiled binary instead of depending on a filesystem path at runtime, and
// exposes Up to apply them — shared by cmd/migrate, cmd/api's optional
// startup auto-migration, and pgtest.
package migrations

import (
	"database/sql"
	"embed"
	"errors"
	"fmt"

	"github.com/golang-migrate/migrate/v4"
	migratepostgres "github.com/golang-migrate/migrate/v4/database/postgres"
	"github.com/golang-migrate/migrate/v4/source/iofs"
)

// FS holds every migration file in this directory.
//
//go:embed *.sql
var FS embed.FS

// Up applies every pending migration against db and is a no-op once the
// schema is already current. golang-migrate's Postgres driver holds a
// session-level advisory lock for the duration of the run, so concurrent
// callers against the same database (e.g. cmd/migrate and an API process
// starting at the same time, or several API replicas) serialize instead of
// racing — safe to call from more than one place.
func Up(db *sql.DB) error {
	sourceDriver, err := iofs.New(FS, ".")
	if err != nil {
		return fmt.Errorf("load migration source: %w", err)
	}

	dbDriver, err := migratepostgres.WithInstance(db, &migratepostgres.Config{})
	if err != nil {
		return fmt.Errorf("create postgres driver: %w", err)
	}

	m, err := migrate.NewWithInstance("iofs", sourceDriver, "postgres", dbDriver)
	if err != nil {
		return fmt.Errorf("create migrator: %w", err)
	}

	if err := m.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		return fmt.Errorf("apply migrations: %w", err)
	}
	return nil
}
