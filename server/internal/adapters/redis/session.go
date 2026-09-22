package redis

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"time"

	goredis "github.com/redis/go-redis/v9"

	"github.com/quoctann/vehicle-care/server/internal/domain"
)

// sessionJSON is the on-the-wire representation stored at session:<id>.
type sessionJSON struct {
	AccountID string `json:"account_id"`
	CSRFToken string `json:"csrf_token"`
	ExpiresAt string `json:"expires_at"`
}

// errSessionExpired is an internal sentinel distinguishing "not found / not
// worth writing" from a real backing-store failure inside this package. It
// never escapes to callers; exported methods translate it to (false, nil).
var errSessionExpired = errors.New("redis: session expired or not found")

func encodeSession(accountID, csrfToken string, expiresAt time.Time) ([]byte, error) {
	return json.Marshal(sessionJSON{
		AccountID: accountID,
		CSRFToken: csrfToken,
		ExpiresAt: expiresAt.UTC().Format(time.RFC3339Nano),
	})
}

func decodeSession(raw string) (sessionJSON, error) {
	var stored sessionJSON
	if err := json.Unmarshal([]byte(raw), &stored); err != nil {
		return sessionJSON{}, err
	}
	return stored, nil
}

func (stored sessionJSON) toDomain() (domain.Session, error) {
	expiresAt, err := time.Parse(time.RFC3339Nano, stored.ExpiresAt)
	if err != nil {
		return domain.Session{}, err
	}
	return domain.Session{AccountID: stored.AccountID, CSRFToken: stored.CSRFToken, ExpiresAt: expiresAt}, nil
}

// CreateSession stores a login session and records it in the account's
// reverse index (used by DeleteAccountSessions). If the session is already
// expired there is nothing worth persisting, so this is a no-op success
// rather than an error, mirroring the trade-off made in CreateToken.
func (s *Store) CreateSession(ctx context.Context, sessionID string, session domain.Session) error {
	ttl := time.Until(session.ExpiresAt)
	if ttl <= 0 {
		return nil
	}
	payload, err := encodeSession(session.AccountID, session.CSRFToken, session.ExpiresAt)
	if err != nil {
		return wrapErr("create session: encode", err)
	}

	pipe := s.client.Pipeline()
	pipe.Set(ctx, sessionKey(sessionID), payload, ttl)
	pipe.ZAdd(ctx, accountSessionsKey(session.AccountID), goredis.Z{Score: float64(session.ExpiresAt.Unix()), Member: sessionID})
	pipe.Expire(ctx, accountSessionsKey(session.AccountID), ttl+time.Hour)
	if _, err := pipe.Exec(ctx); err != nil {
		return wrapErr("create session: pipeline", err)
	}
	return nil
}

// Session retrieves a session without sliding its expiry. Expiration is
// judged from the expires_at field stored in the JSON value (not solely
// from the Redis key TTL), since this method makes no attempt to keep the
// two in sync the way GetAndRefreshSession/RefreshSession do.
func (s *Store) Session(ctx context.Context, sessionID string, now time.Time) (domain.Session, bool, error) {
	raw, err := s.client.Get(ctx, sessionKey(sessionID)).Result()
	if errors.Is(err, goredis.Nil) {
		return domain.Session{}, false, nil
	}
	if err != nil {
		return domain.Session{}, false, wrapErr("get session", err)
	}
	stored, err := decodeSession(raw)
	if err != nil {
		return domain.Session{}, false, wrapErr("decode session", err)
	}
	session, err := stored.toDomain()
	if err != nil {
		return domain.Session{}, false, wrapErr("decode session", err)
	}
	if !now.Before(session.ExpiresAt) {
		return domain.Session{}, false, nil
	}
	return session, true, nil
}

// refreshSessionValue is the shared implementation behind
// GetAndRefreshSession and RefreshSession: it does the one round trip that
// matters for the auth decision (GETEX, atomically reading the value while
// sliding the key's TTL to newExpiresAt), then best-effort refreshes the
// stored JSON value and the account's reverse index. That second step is
// intentionally not atomic with the GETEX: it only affects the accuracy of
// DeleteAccountSessions (logout-everywhere) bookkeeping, never the
// correctness of the auth decision itself, which is already settled by the
// successful GETEX above. A failure there is not reported to the caller.
func (s *Store) refreshSessionValue(ctx context.Context, sessionID string, newExpiresAt time.Time) (sessionJSON, error) {
	ttl := time.Until(newExpiresAt)
	if ttl <= 0 {
		return sessionJSON{}, errSessionExpired
	}

	raw, err := s.client.GetEx(ctx, sessionKey(sessionID), ttl).Result()
	if errors.Is(err, goredis.Nil) {
		return sessionJSON{}, errSessionExpired
	}
	if err != nil {
		return sessionJSON{}, wrapErr("refresh session: getex", err)
	}
	stored, err := decodeSession(raw)
	if err != nil {
		return sessionJSON{}, wrapErr("refresh session: decode", err)
	}

	updated := sessionJSON{
		AccountID: stored.AccountID,
		CSRFToken: stored.CSRFToken,
		ExpiresAt: newExpiresAt.UTC().Format(time.RFC3339Nano),
	}
	if payload, marshalErr := json.Marshal(updated); marshalErr == nil {
		pipe := s.client.Pipeline()
		pipe.Set(ctx, sessionKey(sessionID), payload, ttl)
		pipe.ZAdd(ctx, accountSessionsKey(stored.AccountID), goredis.Z{Score: float64(newExpiresAt.Unix()), Member: sessionID})
		pipe.Expire(ctx, accountSessionsKey(stored.AccountID), ttl+time.Hour)
		_, _ = pipe.Exec(ctx) // best-effort, see doc comment above
	}

	return stored, nil
}

// GetAndRefreshSession atomically reads a session and slides its expiry to
// newExpiresAt in a single round trip to Redis (via GetEx). now is part of
// the user.SessionStore contract but unused here: Redis's own key TTL is
// the source of truth for expiration, so there is nothing left for a
// separately-passed "now" to check.
func (s *Store) GetAndRefreshSession(ctx context.Context, sessionID string, _ time.Time, newExpiresAt time.Time) (domain.Session, bool, error) {
	stored, err := s.refreshSessionValue(ctx, sessionID, newExpiresAt)
	if errors.Is(err, errSessionExpired) {
		return domain.Session{}, false, nil
	}
	if err != nil {
		return domain.Session{}, false, err
	}
	return domain.Session{AccountID: stored.AccountID, CSRFToken: stored.CSRFToken, ExpiresAt: newExpiresAt}, true, nil
}

// RefreshSession extends an active session's expiry. It errors if the
// session does not exist, matching the memory store's behavior.
func (s *Store) RefreshSession(ctx context.Context, sessionID string, expiresAt time.Time) error {
	_, err := s.refreshSessionValue(ctx, sessionID, expiresAt)
	if errors.Is(err, errSessionExpired) {
		return errors.New("session not found")
	}
	return err
}

// DeleteSession removes one login session. It intentionally does not clean
// up the session's entry in the account's reverse index (account_sessions:
// <id>): a stale member pointing at a deleted session is harmless, since
// Session/GetAndRefreshSession/RefreshSession will simply report the
// session as not found if anything tries to use it, and
// DeleteAccountSessions already tolerates listing sessions that turn out to
// be gone.
func (s *Store) DeleteSession(ctx context.Context, sessionID string) error {
	if err := s.client.Del(ctx, sessionKey(sessionID)).Err(); err != nil {
		return wrapErr("delete session", err)
	}
	return nil
}

// DeleteAccountSessions removes every currently-live session belonging to
// an account, along with the account's reverse index itself.
func (s *Store) DeleteAccountSessions(ctx context.Context, accountID string) error {
	key := accountSessionsKey(accountID)
	nowScore := strconv.FormatInt(time.Now().Unix(), 10)

	ids, err := s.client.ZRangeByScore(ctx, key, &goredis.ZRangeBy{Min: nowScore, Max: "+inf"}).Result()
	if err != nil {
		return wrapErr("delete account sessions: zrangebyscore", err)
	}

	pipe := s.client.Pipeline()
	if len(ids) > 0 {
		sessionKeys := make([]string, len(ids))
		for i, id := range ids {
			sessionKeys[i] = sessionKey(id)
		}
		pipe.Del(ctx, sessionKeys...)
	}
	pipe.Del(ctx, key)
	if _, err := pipe.Exec(ctx); err != nil {
		return wrapErr("delete account sessions: del", err)
	}
	return nil
}
