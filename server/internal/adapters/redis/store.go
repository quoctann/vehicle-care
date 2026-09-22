package redis

import (
	"context"
	"fmt"

	goredis "github.com/redis/go-redis/v9"

	"github.com/quoctann/vehicle-care/server/internal/application/user"
)

// Store is the Redis-backed implementation of user.SessionStore,
// user.TokenStore, and httpapi.OAuthStateStore. It doesn't self-check the
// last one: that would make this package import the httpapi adapter, so
// the check lives at the composition root (cmd/api/main.go) instead.
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
	_ user.ISessionStore = (*Store)(nil)
	_ user.ITokenStore   = (*Store)(nil)
)
