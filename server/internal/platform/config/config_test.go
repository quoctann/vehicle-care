package config

import (
	"strings"
	"testing"
)

func TestProductionRejectsInMemoryBackend(t *testing.T) {
	t.Setenv("APP_ENV", "production")
	t.Setenv("COOKIE_SECURE", "true")
	_, err := Load()
	if err == nil || !strings.Contains(err.Error(), "in-memory") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestProductionAllowsLiveStoreDriverWithDatabaseURL(t *testing.T) {
	t.Setenv("APP_ENV", "production")
	t.Setenv("COOKIE_SECURE", "true")
	t.Setenv("STORE_DRIVER", "live")
	t.Setenv("DATABASE_URL", "postgres://user:pass@localhost:5432/vehicle_care?sslmode=disable")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.StoreDriver != "live" || cfg.DatabaseURL == "" {
		t.Fatalf("unexpected config: %#v", cfg)
	}
}

func TestLiveStoreDriverRequiresDatabaseURL(t *testing.T) {
	t.Setenv("STORE_DRIVER", "live")
	_, err := Load()
	if err == nil || !strings.Contains(err.Error(), "DATABASE_URL") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestRejectsUnknownStoreDriver(t *testing.T) {
	t.Setenv("STORE_DRIVER", "bogus")
	_, err := Load()
	if err == nil || !strings.Contains(err.Error(), "STORE_DRIVER") {
		t.Fatalf("unexpected error: %v", err)
	}
}
