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

	// StoreDriver selects the persistence backend: "memory" (process-local,
	// dev-only) or "live" (PostgreSQL + Redis).
	StoreDriver string

	DatabaseURL string

	RedisAddr         string
	RedisPassword     string
	RedisDB           int
	RedisTLSEnabled   bool
	RedisDialTimeout  time.Duration
	RedisReadTimeout  time.Duration
	RedisWriteTimeout time.Duration
	RedisPoolSize     int
	RedisMinIdleConns int
	RedisMaxRetries   int
}

// Load reads an optional local .env without overriding injected environment variables.
func Load() (Config, error) {
	_ = godotenv.Load(".env", "../.env")
	cfg := Config{
		Environment: env("APP_ENV", "development"), HTTPHost: env("HTTP_HOST", "0.0.0.0"), HTTPPort: env("HTTP_PORT", "8080"),
		FrontendOrigin: env("FRONTEND_ORIGIN", "http://localhost:5173"), FrontendRedirectURL: env("FRONTEND_REDIRECT_URL", "http://localhost:5173"),
		CookieDomain:  os.Getenv("COOKIE_DOMAIN"),
		StoreDriver:   env("STORE_DRIVER", "memory"),
		DatabaseURL:   os.Getenv("DATABASE_URL"),
		RedisAddr:     env("REDIS_ADDR", "localhost:6379"),
		RedisPassword: os.Getenv("REDIS_PASSWORD"),
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
	if cfg.RedisDB, err = intEnvAllowZero("REDIS_DB", 0); err != nil {
		return Config{}, err
	}
	if cfg.RedisTLSEnabled, err = boolEnv("REDIS_TLS_ENABLED", false); err != nil {
		return Config{}, err
	}
	if cfg.RedisDialTimeout, err = durationEnv("REDIS_DIAL_TIMEOUT", 5*time.Second); err != nil {
		return Config{}, err
	}
	if cfg.RedisReadTimeout, err = durationEnv("REDIS_READ_TIMEOUT", 3*time.Second); err != nil {
		return Config{}, err
	}
	if cfg.RedisWriteTimeout, err = durationEnv("REDIS_WRITE_TIMEOUT", 3*time.Second); err != nil {
		return Config{}, err
	}
	if cfg.RedisPoolSize, err = intEnv("REDIS_POOL_SIZE", 20); err != nil {
		return Config{}, err
	}
	if cfg.RedisMinIdleConns, err = intEnv("REDIS_MIN_IDLE_CONNS", 5); err != nil {
		return Config{}, err
	}
	if cfg.RedisMaxRetries, err = intEnv("REDIS_MAX_RETRIES", 3); err != nil {
		return Config{}, err
	}
	if cfg.StoreDriver != "memory" && cfg.StoreDriver != "live" {
		return Config{}, fmt.Errorf("STORE_DRIVER must be \"memory\" or \"live\", got %q", cfg.StoreDriver)
	}
	if cfg.StoreDriver == "live" && cfg.DatabaseURL == "" {
		return Config{}, fmt.Errorf("DATABASE_URL is required when STORE_DRIVER=live")
	}
	if cfg.Environment == "production" && cfg.StoreDriver != "live" {
		return Config{}, fmt.Errorf("APP_ENV=production requires STORE_DRIVER=live; the in-memory backend is dev-only")
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

func intEnvAllowZero(key string, fallback int) (int, error) {
	value := os.Getenv(key)
	if value == "" {
		return fallback, nil
	}
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed < 0 {
		return 0, fmt.Errorf("%s must be a non-negative integer", key)
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
