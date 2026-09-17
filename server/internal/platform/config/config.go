// Package config loads environment-first server configuration.
package config

import (
	"fmt"
	"os"
	"strconv"
	"time"

	"github.com/joho/godotenv"
)

// Config contains runtime settings for the API process.
type Config struct {
	Environment         string
	HTTPHost            string
	HTTPPort            string
	FrontendOrigin      string
	FrontendRedirectURL string
	CookieSecure        bool
	CookieDomain        string
	SessionTTL          time.Duration
	SyncMaxBatchSize    int
	SyncMaxPageSize     int
	MockAuthEnabled     bool
}

// Load reads an optional local .env without overriding injected environment variables.
func Load() (Config, error) {
	_ = godotenv.Load(".env", "../.env")
	cfg := Config{
		Environment: env("APP_ENV", "development"), HTTPHost: env("HTTP_HOST", "0.0.0.0"), HTTPPort: env("HTTP_PORT", "8080"),
		FrontendOrigin: env("FRONTEND_ORIGIN", "http://localhost:5173"), FrontendRedirectURL: env("FRONTEND_REDIRECT_URL", "http://localhost:5173"),
		CookieDomain: os.Getenv("COOKIE_DOMAIN"),
	}
	var err error
	if cfg.CookieSecure, err = boolEnv("COOKIE_SECURE", false); err != nil {
		return Config{}, err
	}
	if cfg.MockAuthEnabled, err = boolEnv("MOCK_AUTH_ENABLED", true); err != nil {
		return Config{}, err
	}
	if cfg.SessionTTL, err = durationEnv("SESSION_TTL", 30*24*time.Hour); err != nil {
		return Config{}, err
	}
	if cfg.SyncMaxBatchSize, err = intEnv("SYNC_MAX_BATCH_SIZE", 100); err != nil {
		return Config{}, err
	}
	if cfg.SyncMaxPageSize, err = intEnv("SYNC_MAX_PAGE_SIZE", 100); err != nil {
		return Config{}, err
	}
	if cfg.Environment == "production" {
		return Config{}, fmt.Errorf("APP_ENV=production is not supported by the in-memory backend; configure persistent adapters first")
	}
	return cfg, nil
}

// Address returns the configured listen address.
func (c Config) Address() string { return c.HTTPHost + ":" + c.HTTPPort }

func env(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func boolEnv(key string, fallback bool) (bool, error) {
	value := os.Getenv(key)
	if value == "" {
		return fallback, nil
	}
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return false, fmt.Errorf("parse %s: %w", key, err)
	}
	return parsed, nil
}

func intEnv(key string, fallback int) (int, error) {
	value := os.Getenv(key)
	if value == "" {
		return fallback, nil
	}
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed < 1 {
		return 0, fmt.Errorf("%s must be a positive integer", key)
	}
	return parsed, nil
}

func durationEnv(key string, fallback time.Duration) (time.Duration, error) {
	value := os.Getenv(key)
	if value == "" {
		return fallback, nil
	}
	parsed, err := time.ParseDuration(value)
	if err != nil || parsed <= 0 {
		return 0, fmt.Errorf("%s must be a positive duration", key)
	}
	return parsed, nil
}
