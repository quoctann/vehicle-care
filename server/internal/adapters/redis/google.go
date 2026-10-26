package redis

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/quoctann/vehicle-care/server/internal/application/user"
	goredis "github.com/redis/go-redis/v9"
)

func (s *Store) SaveGoogleState(ctx context.Context, key string, state user.GoogleState, ttl time.Duration) error {
	if ttl <= 0 {
		return errors.New("invalid OAuth state TTL")
	}
	b, err := json.Marshal(state)
	if err != nil {
		return err
	}
	ok, err := s.client.SetNX(ctx, "google:state:"+key, b, ttl).Result()
	if err != nil {
		return err
	}
	if !ok {
		return errors.New("OAuth state collision")
	}
	return nil
}

func (s *Store) TakeGoogleState(ctx context.Context, key string) (user.GoogleState, bool, error) {
	var state user.GoogleState
	b, err := s.client.GetDel(ctx, "google:state:"+key).Bytes()
	if errors.Is(err, goredis.Nil) {
		return state, false, nil
	}
	if err != nil {
		return state, false, err
	}
	if err := json.Unmarshal(b, &state); err != nil {
		return state, false, err
	}
	return state, true, nil
}
