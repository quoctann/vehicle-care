// Command migrate applies, rolls back, and reports the status of PostgreSQL
// schema migrations, and scaffolds new migration files. It is a standalone
// tool: the API process never runs migrations on startup. part_types are no
// longer seeded globally — each account gets its own copy at signup (see
// internal/adapters/postgres/seed.SeedAccountPartTypes).
//
// Usage:
//
//	go run ./cmd/migrate up
//	go run ./cmd/migrate down [N]
//	go run ./cmd/migrate status
//	go run ./cmd/migrate create <name>
//
// DB_HOST, DB_USER, DB_PASSWORD, and DB_NAME must be set for up|down|status.
// create does not touch the database and works offline.
package main

import (
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/caarlos0/env/v11"
	"github.com/golang-migrate/migrate/v4"
	"github.com/golang-migrate/migrate/v4/database/postgres"
	"github.com/golang-migrate/migrate/v4/source/iofs"
	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/joho/godotenv"

	"github.com/quoctann/vehicle-care/server/db/migrations"
	"github.com/quoctann/vehicle-care/server/internal/platform/config"
)

// migrationsDir is relative to the server module root, matching where
// `go run ./cmd/migrate` is invoked from (see Makefile: `cd server && ...`).
const migrationsDir = "db/migrations"

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "migrate:", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	if len(args) == 0 {
		return errors.New("usage: migrate up|down [N]|status|create <name>")
	}

	if args[0] == "create" {
		return runCreate(args[1:])
	}

	_ = godotenv.Load(".env", "../.env")
	var dbCfg config.Database
	if err := env.Parse(&dbCfg); err != nil {
		return err
	}

	db, err := sql.Open("pgx", dbCfg.DSN())
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
	default:
		return fmt.Errorf("unknown subcommand %q (want up|down|status|create)", args[0])
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
	if err := migrations.Up(db); err != nil {
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

func runCreate(args []string) error {
	if len(args) == 0 || args[0] == "" {
		return errors.New("usage: migrate create <name>")
	}

	name := sanitizeMigrationName(args[0])
	if name == "" {
		return fmt.Errorf("migration name %q has no usable characters after sanitizing to snake_case", args[0])
	}

	ts := time.Now().Unix()
	upPath := filepath.Join(migrationsDir, fmt.Sprintf("%d_%s.up.sql", ts, name))
	downPath := filepath.Join(migrationsDir, fmt.Sprintf("%d_%s.down.sql", ts, name))

	if err := os.MkdirAll(migrationsDir, 0o755); err != nil {
		return fmt.Errorf("create migrations directory: %w", err)
	}
	if err := writeIfAbsent(upPath, fmt.Sprintf("-- +migrate up\n-- %s\n", name)); err != nil {
		return err
	}
	if err := writeIfAbsent(downPath, fmt.Sprintf("-- +migrate down\n-- %s\n", name)); err != nil {
		return err
	}

	fmt.Printf("migrate: created %s\n", upPath)
	fmt.Printf("migrate: created %s\n", downPath)
	return nil
}

func writeIfAbsent(path, content string) error {
	if _, err := os.Stat(path); err == nil {
		return fmt.Errorf("refusing to overwrite existing file %s", path)
	} else if !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("stat %s: %w", path, err)
	}

	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		return fmt.Errorf("write %s: %w", path, err)
	}

	return nil
}

// sanitizeMigrationName lowercases the input and keeps only [a-z0-9_],
// collapsing spaces/dashes/other separators into single underscores so the
// generated filename stays a valid, greppable snake_case identifier.
func sanitizeMigrationName(raw string) string {
	var b strings.Builder
	lower := strings.ToLower(raw)
	lastUnderscore := false

	for _, r := range lower {
		switch {
		case r >= 'a' && r <= 'z' || r >= '0' && r <= '9':
			b.WriteRune(r)
			lastUnderscore = false
		default:
			if !lastUnderscore && b.Len() > 0 {
				b.WriteRune('_')
				lastUnderscore = true
			}
		}
	}

	return strings.Trim(b.String(), "_")
}
