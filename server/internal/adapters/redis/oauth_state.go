package redis

import (
	"context"
	"errors"
	"time"

	goredis "github.com/redis/go-redis/v9"
)

// CreateState stores an OAuth CSRF state token with the given TTL.
func (s *Store) CreateState(ctx context.Context, state string, ttl time.Duration) error {
	if ttl <= 0 {
		return wrapErr("create oauth state", errors.New("ttl must be positive"))
	}
	if err := s.client.Set(ctx, oauthStateKey(state), "1", ttl).Err(); err != nil {
		return wrapErr("create oauth state", err)
	}
	return nil
}

// ConsumeState atomically checks and deletes an OAuth CSRF state token, so
// it can only ever be used once.
func (s *Store) ConsumeState(ctx context.Context, state string) (bool, error) {
	_, err := s.client.GetDel(ctx, oauthStateKey(state)).Result()
	if errors.Is(err, goredis.Nil) {
		return false, nil
	}
	if err != nil {
		return false, wrapErr("consume oauth state", err)
	}
	return true, nil
}
