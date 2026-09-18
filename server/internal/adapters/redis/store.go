package redis

import (
	"context"
	"fmt"

	goredis "github.com/redis/go-redis/v9"

	"github.com/quoctann/vehicle-care/server/internal/ports"
)

// Store is the Redis-backed implementation of ports.SessionStore,
// ports.TokenStore, and ports.OAuthStateStore.
type Store struct {
	client *goredis.Client
}

// NewStore wraps an already-connected Redis client.
func NewStore(client *goredis.Client) *Store {
	return &Store{client: client}
}

// Ping verifies connectivity to the backing Redis server.
func (s *Store) Ping(ctx context.Context) error {
	if err := s.client.Ping(ctx).Err(); err != nil {
		return fmt.Errorf("redis: ping: %w", err)
	}
	return nil
}

var (
	_ ports.SessionStore    = (*Store)(nil)
	_ ports.TokenStore      = (*Store)(nil)
	_ ports.OAuthStateStore = (*Store)(nil)
)
