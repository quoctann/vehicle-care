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
