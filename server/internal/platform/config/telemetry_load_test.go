package config

import (
	"testing"

	"github.com/caarlos0/env/v11"
)

func TestTelemetryConfigEnvironment(t *testing.T) {
	for _, key := range []string{"DB_HOST", "DB_USER", "DB_PASSWORD", "DB_NAME"} {
		t.Setenv(key, "test")
	}
	t.Setenv("OTEL_ENABLED", "true")
	t.Setenv("OTEL_SERVICE_NAME", "test-api")
	t.Setenv("LOG_FILE", "test.json")
	var cfg Config
	if err := env.Parse(&cfg); err != nil {
		t.Fatal(err)
	}
	if !cfg.Observability.Enabled || cfg.Observability.ServiceName != "test-api" || cfg.LogFile != "test.json" {
		t.Fatal("telemetry configuration not loaded")
	}
}
