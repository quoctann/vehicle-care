package redis

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestRateLimitValidation(t *testing.T) {
	s := &Store{}
	for _, tc := range []struct {
		key              string
		capacity, refill int
		window           time.Duration
	}{
		{"", 1, 1, time.Second}, {strings.Repeat("x", 4097), 1, 1, time.Second},
		{"k", 0, 1, time.Second}, {"k", 1, 0, time.Second}, {"k", 1000001, 1, time.Second},
		{"k", 1, 1000001, time.Second}, {"k", 1, 1, 0}, {"k", 1, 1, time.Nanosecond},
		{"k", 1, 1, 25 * time.Hour},
	} {
		ok, retry, err := s.AllowRate(context.Background(), tc.key, tc.capacity, tc.refill, tc.window)
		if ok || retry != 0 || err == nil {
			t.Fatalf("accepted invalid input %+v", tc)
		}
	}
}

func TestRateLimitAtomicRefillExpiryAndNamespace(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	var allowed atomic.Int32
	var wg sync.WaitGroup
	for range 40 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			ok, _, err := s.AllowRate(ctx, "api:private-ip", 5, 1, time.Hour)
			if err != nil {
				t.Error(err)
			}
			if ok {
				allowed.Add(1)
			}
		}()
	}
	wg.Wait()
	if allowed.Load() != 5 {
		t.Fatalf("allowed %d, want 5", allowed.Load())
	}
	keys, err := s.client.Keys(ctx, "ratelimit:v2:*").Result()
	if err != nil || len(keys) != 1 || strings.Contains(keys[0], "private-ip") {
		t.Fatalf("unsafe namespace: %v %v", keys, err)
	}
	if ttl := s.client.PTTL(ctx, keys[0]).Val(); ttl <= 0 || ttl > 5*time.Hour {
		t.Fatalf("TTL %v", ttl)
	}
	if err := s.client.Set(ctx, "auth:limit:old", "999", time.Hour).Err(); err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256([]byte("corrupted"))
	corruptKey := "ratelimit:v2:" + hex.EncodeToString(sum[:])
	if err := s.client.HSet(ctx, corruptKey, "tokens", "invalid", "updated", 1).Err(); err != nil {
		t.Fatal(err)
	}
	if ok, _, err := s.AllowRate(ctx, "corrupted", 1, 1, time.Second); ok || err == nil {
		t.Fatal("corrupt bucket failed open")
	}
	if err := s.client.Del(ctx, corruptKey).Err(); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if ok, err := s.AllowAuth(ctx, "refill", 2, 400*time.Millisecond); !ok || err != nil {
			t.Fatal(ok, err)
		}
	}
	ok, retry, err := s.AllowRate(ctx, "refill", 2, 2, 400*time.Millisecond)
	if ok || err != nil || retry <= 0 || retry > 200*time.Millisecond {
		t.Fatal(ok, retry, err)
	}
	time.Sleep(230 * time.Millisecond)
	if ok, err := s.AllowAuth(ctx, "refill", 2, 400*time.Millisecond); !ok || err != nil {
		t.Fatal("continuous refill", ok, err)
	}
	if ok, err := s.AllowAuth(ctx, "refill", 2, 400*time.Millisecond); ok || err != nil {
		t.Fatal("refilled too much", ok, err)
	}
	time.Sleep(450 * time.Millisecond)
	if keys := s.client.Keys(ctx, "ratelimit:v2:*").Val(); len(keys) != 1 {
		t.Fatalf("idle bucket not cleaned: %v", keys)
	}
	_ = s.client.Close()
	if ok, _, err := s.AllowRate(ctx, "down", 1, 1, time.Second); ok || err == nil {
		t.Fatal("outage failed open")
	}
}
