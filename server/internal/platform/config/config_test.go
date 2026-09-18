package config

import (
	"strings"
	"testing"
)

func TestRequiresDatabaseURL(t *testing.T) {
	_, err := Load()
	if err == nil || !strings.Contains(err.Error(), "DATABASE_URL") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestLoadsWithDatabaseURL(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://user:pass@localhost:5432/vehicle_care?sslmode=disable")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.DatabaseURL == "" {
		t.Fatalf("unexpected config: %#v", cfg)
	}
}
