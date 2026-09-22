package redis

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"time"

	goredis "github.com/redis/go-redis/v9"
)

// tokenHash returns the hex-encoded sha256 of token, so plaintext one-time
// tokens are never used directly as (or logged as part of) Redis keys.
func tokenHash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// CreateToken stores a one-time auth token, superseding any previous token
// of the same kind for the same account. If expiresAt is already in the
// past, no key is written and the token simply behaves as never-valid on
// the next ConsumeToken call (mirrors CreateToken(kind, "expired", ...)
// composed with an immediate ConsumeToken in the memory-store contract
// tests, which expect no error and ok=false).
func (s *Store) CreateToken(ctx context.Context, kind, token, accountID string, expiresAt time.Time) error {
	ttl := time.Until(expiresAt)
	if ttl <= 0 {
		return nil
	}
	ttlSeconds := int64(ttl.Seconds())
	if ttlSeconds <= 0 {
		ttlSeconds = 1
	}

	indexKey := tokenIndexKey(kind, accountID)
	if err := createTokenScript.Run(ctx, s.client, []string{indexKey}, kind, accountID, tokenHash(token), ttlSeconds).Err(); err != nil {
		return wrapErr("create token", err)
	}
	return nil
}

// ConsumeToken atomically retrieves and deletes a one-time token. Because
// kind is embedded in the key, a mismatched kind naturally misses (the key
// for that kind never existed), matching the memory store's explicit
// kind-mismatch check. Redis's own TTL is the source of truth for
// expiration, so now is unused here — it stays in the signature only to
// satisfy user.TokenStore.
func (s *Store) ConsumeToken(ctx context.Context, kind, token string, _ time.Time) (string, bool, error) {
	key := tokenKey(kind, tokenHash(token))
	accountID, err := s.client.GetDel(ctx, key).Result()
	if errors.Is(err, goredis.Nil) {
		return "", false, nil
	}
	if err != nil {
		return "", false, wrapErr("consume token", err)
	}
	return accountID, true, nil
}
