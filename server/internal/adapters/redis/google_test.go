package redis

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/quoctann/vehicle-care/server/internal/application/user"
)

func TestGoogleStateAtomicPayload(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	payload := user.GoogleState{Nonce: "nonce", Verifier: "pkce", Browser: "browser", Purpose: "link", AccountID: "account", SessionID: "session"}
	if err := s.SaveGoogleState(ctx, "state", payload, time.Minute); err != nil {
		t.Fatal(err)
	}
	var successes atomic.Int32
	var wg sync.WaitGroup
	for range 10 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			p, ok, err := s.TakeGoogleState(ctx, "state")
			if err != nil {
				t.Error(err)
			}
			if ok {
				successes.Add(1)
				if p != payload {
					t.Error("payload mismatch")
				}
			}
		}()
	}
	wg.Wait()
	if successes.Load() != 1 {
		t.Fatal("state must be single use")
	}
	if err := s.SaveGoogleState(ctx, "bad", payload, 0); err == nil {
		t.Fatal("zero TTL accepted")
	}
}

func TestGoogleRateLimit(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	for i := 0; i < 4; i++ {
		ok, err := s.AllowAuth(ctx, "key", 3, time.Minute)
		if err != nil || ok != (i < 3) {
			t.Fatalf("%d: %v %v", i, ok, err)
		}
	}
}

func TestGoogleStateExpiryCorruptionAndOutage(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	payload := user.GoogleState{Browser: "bound"}
	if err := s.SaveGoogleState(ctx, "expiry", payload, time.Millisecond); err != nil {
		t.Fatal(err)
	}
	time.Sleep(10 * time.Millisecond)
	if _, ok, err := s.TakeGoogleState(ctx, "expiry"); ok || err != nil {
		t.Fatal(ok, err)
	}
	if err := s.SaveGoogleState(ctx, "duplicate", payload, time.Minute); err != nil {
		t.Fatal(err)
	}
	if err := s.SaveGoogleState(ctx, "duplicate", payload, time.Minute); err == nil {
		t.Fatal("overwrote existing state")
	}
	if err := s.client.Set(ctx, "google:state:corrupt", "{", time.Minute).Err(); err != nil {
		t.Fatal(err)
	}
	if _, ok, err := s.TakeGoogleState(ctx, "corrupt"); ok || err == nil {
		t.Fatal("accepted corrupted state")
	}
	_ = s.client.Close()
	if err := s.SaveGoogleState(ctx, "offline", payload, time.Minute); err == nil {
		t.Fatal("state write outage ignored")
	}
	if _, ok, err := s.TakeGoogleState(ctx, "offline"); ok || err == nil {
		t.Fatal("state read outage ignored")
	}
	if ok, err := s.AllowAuth(ctx, "offline", 3, time.Minute); ok || err == nil {
		t.Fatal("rate limiter failed open")
	}
}
