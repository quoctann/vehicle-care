package config

import (
	"strings"
	"testing"
)

func setDatabaseEnv(t *testing.T) {
	t.Helper()
	t.Setenv("DB_HOST", "localhost")
	t.Setenv("DB_USER", "user")
	t.Setenv("DB_PASSWORD", "pass")
	t.Setenv("DB_NAME", "vehicle_care")
}

func TestRequiresDatabaseHost(t *testing.T) {
	_, err := Load()
	if err == nil || !strings.Contains(err.Error(), "DB_HOST") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestLoadsWithDatabaseEnv(t *testing.T) {
	setDatabaseEnv(t)
	cfg, err := Load()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.Database.Host == "" || cfg.Database.User == "" || cfg.Database.Password == "" || cfg.Database.Name == "" {
		t.Fatalf("unexpected config: %#v", cfg.Database)
	}
	if cfg.Database.Port != 5432 || cfg.Database.SSLMode != "disable" {
		t.Fatalf("unexpected database defaults: %#v", cfg.Database)
	}
}

func TestDatabaseDSN(t *testing.T) {
	d := Database{Host: "localhost", Port: 5432, User: "user", Password: "pass", Name: "vehicle_care", SSLMode: "disable"}
	want := "postgres://user:pass@localhost:5432/vehicle_care?sslmode=disable"
	if got := d.DSN(); got != want {
		t.Fatalf("DSN() = %q, want %q", got, want)
	}
}
