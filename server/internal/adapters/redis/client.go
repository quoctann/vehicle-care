// Package redis provides the Redis-backed implementation of
// user.SessionStore, user.TokenStore, and httpapi.OAuthStateStore.
package redis

import (
	"context"
	"crypto/tls"
	"fmt"
	"time"

	goredis "github.com/redis/go-redis/v9"
)

// Options configures the Redis client used by the Store.
type Options struct {
	Addr         string
	Password     string
	DB           int
	DialTimeout  time.Duration
	ReadTimeout  time.Duration
	WriteTimeout time.Duration
	PoolSize     int
	MinIdleConns int
	MaxRetries   int
	TLSEnabled   bool
}

// NewClient builds a go-redis client from opts and fails fast if the server
// is unreachable, so misconfiguration surfaces at startup rather than on the
// first request.
func NewClient(opts Options) (*goredis.Client, error) {
	redisOpts := &goredis.Options{
		Addr:         opts.Addr,
		Password:     opts.Password,
		DB:           opts.DB,
		DialTimeout:  opts.DialTimeout,
		ReadTimeout:  opts.ReadTimeout,
		WriteTimeout: opts.WriteTimeout,
		PoolSize:     opts.PoolSize,
		MinIdleConns: opts.MinIdleConns,
		MaxRetries:   opts.MaxRetries,
	}
	if opts.TLSEnabled {
		redisOpts.TLSConfig = &tls.Config{MinVersion: tls.VersionTLS12}
	}

	client := goredis.NewClient(redisOpts)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := client.Ping(ctx).Err(); err != nil {
		_ = client.Close()
		return nil, fmt.Errorf("redis: connect to %s: %w", opts.Addr, err)
	}
	return client, nil
}
