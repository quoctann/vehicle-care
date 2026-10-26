package config

import (
	"github.com/caarlos0/env/v11"
	"testing"
)

func TestRateLimitConfig(t *testing.T) {
	var cfg Config
	values := map[string]string{"DB_HOST": "localhost", "DB_USER": "user", "DB_PASSWORD": "test", "DB_NAME": "test"}
	if err := env.ParseWithOptions(&cfg, env.Options{Environment: values}); err != nil {
		t.Fatal(err)
	}
	if cfg.APIRateLimitPerMinute != 600 || cfg.APIRateLimitBurst != 120 {
		t.Fatalf("defaults %+v", cfg)
	}
	if err := cfg.ValidateRateLimit(); err != nil {
		t.Fatal(err)
	}
	values["API_RATE_LIMIT_PER_MINUTE"], values["API_RATE_LIMIT_BURST"] = "50", "10"
	if err := env.ParseWithOptions(&cfg, env.Options{Environment: values}); err != nil {
		t.Fatal(err)
	}
	if cfg.APIRateLimitPerMinute != 50 || cfg.APIRateLimitBurst != 10 {
		t.Fatal("environment overrides ignored")
	}
	for _, pair := range [][2]int{{0, 120}, {600, 0}, {-1, 1}, {1, -1}, {1000001, 1}, {1, 1000001}} {
		cfg.APIRateLimitPerMinute, cfg.APIRateLimitBurst = pair[0], pair[1]
		if cfg.ValidateRateLimit() == nil {
			t.Fatalf("accepted %v", pair)
		}
	}
}
