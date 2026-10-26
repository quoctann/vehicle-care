package redis

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"time"

	goredis "github.com/redis/go-redis/v9"
)

// Redis owns the clock and atomically refills, consumes and expires each bucket.
// Expiry is the time needed to refill an empty bucket, so forgetting idle state
// never grants tokens sooner than continuous refill would have done.
var tokenBucket = goredis.NewScript(`
local clock = redis.call('TIME')
local now = tonumber(clock[1]) * 1000 + tonumber(clock[2]) / 1000
local capacity, refill, window = tonumber(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3])
local state = redis.call('HMGET', KEYS[1], 'tokens', 'updated')
local tokens, updated = capacity, now
if state[1] or state[2] then
  tokens, updated = tonumber(state[1]), tonumber(state[2])
  if not tokens or not updated or tokens < 0 then
    return redis.error_reply('invalid rate limit state')
  end
end
tokens = math.min(capacity, tokens + math.max(0, now - updated) * refill / window)
local allowed, retry = 0, 0
if tokens >= 1 then
  tokens, allowed = tokens - 1, 1
else
  retry = math.ceil((1 - tokens) * window / refill)
end
redis.call('HSET', KEYS[1], 'tokens', tostring(tokens), 'updated', tostring(math.max(now, updated)))
redis.call('PEXPIRE', KEYS[1], math.max(1, math.ceil(capacity * window / refill)))
return {allowed, retry}
`)

// AllowRate consumes one token. Refill tokens are restored continuously per
// window, up to capacity. Keys are bounded and hashed into a versioned namespace
// separate from legacy fixed-window counters. All errors deny the request.
func (s *Store) AllowRate(ctx context.Context, key string, capacity, refill int, window time.Duration) (bool, time.Duration, error) {
	if len(key) == 0 || len(key) > 4096 || capacity <= 0 || capacity > 1_000_000 || refill <= 0 || refill > 1_000_000 || window < time.Millisecond || window > 24*time.Hour {
		return false, 0, errors.New("invalid rate limit parameters")
	}
	sum := sha256.Sum256([]byte(key))
	result, err := tokenBucket.Run(ctx, s.client, []string{"ratelimit:v2:" + hex.EncodeToString(sum[:])}, capacity, refill, window.Milliseconds()).Int64Slice()
	if err != nil {
		return false, 0, err
	}
	if len(result) != 2 || (result[0] != 0 && result[0] != 1) || result[1] < 0 || result[1] > window.Milliseconds() {
		return false, 0, errors.New("invalid rate limit result")
	}
	return result[0] == 1, time.Duration(result[1]) * time.Millisecond, nil
}

// AllowAuth preserves the application mail/link port and its existing quotas.
func (s *Store) AllowAuth(ctx context.Context, key string, limit int, window time.Duration) (bool, error) {
	allowed, _, err := s.AllowRate(ctx, key, limit, limit, window)
	return allowed, err
}
