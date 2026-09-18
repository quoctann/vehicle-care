// Command migrate applies, rolls back, and reports the status of PostgreSQL
// schema migrations, and seeds the fixed part_types catalog. It is a
// standalone tool: the API process never runs migrations on startup.
//
// Usage:
//
//	go run ./cmd/migrate up
//	go run ./cmd/migrate down [N]
//	go run ./cmd/migrate status
//	go run ./cmd/migrate seed
//
// DATABASE_URL must be set to a PostgreSQL connection string.
package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"strconv"

	"github.com/golang-migrate/migrate/v4"
	"github.com/golang-migrate/migrate/v4/database/postgres"
	"github.com/golang-migrate/migrate/v4/source/iofs"
	_ "github.com/jackc/pgx/v5/stdlib"

	"github.com/quoctann/vehicle-care/server/db/migrations"
	"github.com/quoctann/vehicle-care/server/internal/adapters/postgres/seed"
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "migrate:", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	if len(args) == 0 {
		return errors.New("usage: migrate up|down [N]|status|seed")
	}

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		return errors.New("DATABASE_URL environment variable is required")
	}

	db, err := sql.Open("pgx", dsn)
	if err != nil {
		return fmt.Errorf("open database: %w", err)
	}
	defer db.Close()

	if err := db.Ping(); err != nil {
		return fmt.Errorf("ping database: %w", err)
	}

	switch args[0] {
	case "up":
		return runUp(db)
	case "down":
		return runDown(db, args[1:])
	case "status":
		return runStatus(db)
	case "seed":
		return runSeed(db)
	default:
		return fmt.Errorf("unknown subcommand %q (want up|down|status|seed)", args[0])
	}
}

func newMigrator(db *sql.DB) (*migrate.Migrate, error) {
	sourceDriver, err := iofs.New(migrations.FS, ".")
	if err != nil {
		return nil, fmt.Errorf("load migration source: %w", err)
	}
	dbDriver, err := postgres.WithInstance(db, &postgres.Config{})
	if err != nil {
		return nil, fmt.Errorf("create postgres driver: %w", err)
	}
	m, err := migrate.NewWithInstance("iofs", sourceDriver, "postgres", dbDriver)
	if err != nil {
		return nil, fmt.Errorf("create migrator: %w", err)
	}
	return m, nil
}

func runUp(db *sql.DB) error {
	m, err := newMigrator(db)
	if err != nil {
		return err
	}
	if err := m.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		return fmt.Errorf("migrate up: %w", err)
	}
	fmt.Println("migrate: up to date")
	return runStatus(db)
}

func runDown(db *sql.DB, rest []string) error {
	m, err := newMigrator(db)
	if err != nil {
		return err
	}
	if len(rest) == 0 {
		if err := m.Down(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
			return fmt.Errorf("migrate down: %w", err)
		}
		fmt.Println("migrate: rolled back all migrations")
		return nil
	}
	steps, err := strconv.Atoi(rest[0])
	if err != nil || steps <= 0 {
		return fmt.Errorf("invalid step count %q: must be a positive integer", rest[0])
	}
	if err := m.Steps(-steps); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		return fmt.Errorf("migrate down %d: %w", steps, err)
	}
	fmt.Printf("migrate: rolled back %d migration(s)\n", steps)
	return runStatus(db)
}

func runStatus(db *sql.DB) error {
	m, err := newMigrator(db)
	if err != nil {
		return err
	}
	version, dirty, err := m.Version()
	if errors.Is(err, migrate.ErrNilVersion) {
		fmt.Println("migrate: no migrations applied yet")
		return nil
	}
	if err != nil {
		return fmt.Errorf("read migration status: %w", err)
	}
	fmt.Printf("migrate: version=%d dirty=%t\n", version, dirty)
	return nil
}

func runSeed(db *sql.DB) error {
	ctx := context.Background()
	if err := seed.Seed(ctx, db, seed.Manifest); err != nil {
		return fmt.Errorf("seed part types: %w", err)
	}
	fmt.Printf("migrate: seeded %d part type(s)\n", len(seed.Manifest))
	return nil
}
