// Package config loads environment-first server configuration.
package config

import (
	"fmt"
	"net/url"
	"time"

	"github.com/caarlos0/env/v11"
	"github.com/joho/godotenv"
)

// Database holds PostgreSQL connection parameters. The connection string is
// built from these fields (see DSN) instead of being read as a single
// preassembled URL from the environment.
type Database struct {
	Host     string `env:"DB_HOST,required"`
	Port     int    `env:"DB_PORT" envDefault:"5432"`
	User     string `env:"DB_USER,required"`
	Password string `env:"DB_PASSWORD,required"`
	Name     string `env:"DB_NAME,required"`
	SSLMode  string `env:"DB_SSLMODE" envDefault:"disable"`
}

// DSN builds the postgres:// connection string pgx/database-sql expects.
func (d Database) DSN() string {
	u := url.URL{
		Scheme: "postgres",
		User:   url.UserPassword(d.User, d.Password),
		Host:   fmt.Sprintf("%s:%d", d.Host, d.Port),
		Path:   "/" + d.Name,
	}
	q := u.Query()
	q.Set("sslmode", d.SSLMode)
	u.RawQuery = q.Encode()
	return u.String()
}

// Config contains runtime settings for the API process.
type Config struct {
	Environment         string        `env:"APP_ENV" envDefault:"development"`
	HTTPHost            string        `env:"HTTP_HOST" envDefault:"0.0.0.0"`
	HTTPPort            string        `env:"HTTP_PORT" envDefault:"8080"`
	FrontendOrigin      string        `env:"FRONTEND_ORIGIN" envDefault:"http://localhost:5173"`
	FrontendRedirectURL string        `env:"FRONTEND_REDIRECT_URL" envDefault:"http://localhost:5173"`
	CookieSecure        bool          `env:"COOKIE_SECURE" envDefault:"false"`
	CookieDomain        string        `env:"COOKIE_DOMAIN"`
	SessionTTL          time.Duration `env:"SESSION_TTL" envDefault:"720h"`
	SyncMaxBatchSize    int           `env:"SYNC_MAX_BATCH_SIZE" envDefault:"100"`
	SyncMaxPageSize     int           `env:"SYNC_MAX_PAGE_SIZE" envDefault:"100"`

	Database Database

	RedisAddr         string        `env:"REDIS_ADDR" envDefault:"localhost:6379"`
	RedisPassword     string        `env:"REDIS_PASSWORD"`
	RedisDB           int           `env:"REDIS_DB" envDefault:"0"`
	RedisTLSEnabled   bool          `env:"REDIS_TLS_ENABLED" envDefault:"false"`
	RedisDialTimeout  time.Duration `env:"REDIS_DIAL_TIMEOUT" envDefault:"5s"`
	RedisReadTimeout  time.Duration `env:"REDIS_READ_TIMEOUT" envDefault:"3s"`
	RedisWriteTimeout time.Duration `env:"REDIS_WRITE_TIMEOUT" envDefault:"3s"`
	RedisPoolSize     int           `env:"REDIS_POOL_SIZE" envDefault:"20"`
	RedisMinIdleConns int           `env:"REDIS_MIN_IDLE_CONNS" envDefault:"5"`
	RedisMaxRetries   int           `env:"REDIS_MAX_RETRIES" envDefault:"3"`
}

// Load reads an optional local .env without overriding injected environment
// variables, then parses and validates the environment into Config.
func Load() (Config, error) {
	_ = godotenv.Load(".env", "../.env")
	var cfg Config
	if err := env.Parse(&cfg); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

// Address returns the configured listen address.
func (c Config) Address() string { return c.HTTPHost + ":" + c.HTTPPort }
