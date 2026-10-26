package redis

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/quoctann/vehicle-care/server/internal/domain"
)

func TestAuthVersionLegacySessionRejected(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	raw := `{"account_id":"a","csrf_token":"csrf","expires_at":"2099-01-01T00:00:00Z"}`
	if err := s.client.Set(ctx, sessionKey("legacy"), raw, time.Hour).Err(); err != nil {
		t.Fatal(err)
	}
	if _, ok, err := s.Session(ctx, "legacy", time.Now()); err != nil || ok {
		t.Fatalf("legacy read: %v %v", ok, err)
	}
	if _, ok, err := s.GetAndRefreshSession(ctx, "legacy", time.Now(), time.Now().Add(time.Hour)); err != nil || ok {
		t.Fatalf("legacy refresh: %v %v", ok, err)
	}
}

func TestAuthVersionRefreshScriptCannotResurrectLogout(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	raw := `{"account_id":"a","csrf_token":"csrf","auth_version":1,"expires_at":"2099-01-01T00:00:00Z"}`
	if err := s.client.Set(ctx, sessionKey("sid"), raw, time.Hour).Err(); err != nil {
		t.Fatal(err)
	}
	// Simulate the exact interleaving: refresh read completed, logout deletes,
	// then the delayed refresh attempts its conditional write.
	if err := s.DeleteSession(ctx, "sid"); err != nil {
		t.Fatal(err)
	}
	got, err := refreshSessionScript.Run(ctx, s.client, []string{sessionKey("sid"), accountSessionsKey("a")}, raw, raw, 3600000, time.Now().Unix(), "sid", 7200000).Int()
	if err != nil || got != 0 {
		t.Fatalf("refresh: %d %v", got, err)
	}
	if n, err := s.client.Exists(ctx, sessionKey("sid")).Result(); err != nil || n != 0 {
		t.Fatalf("resurrected: %d %v", n, err)
	}
}

func TestAuthVersionResetReplacementIndexStableAcrossVersions(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	if err := s.CreateToken(ctx, "reset", "old", "account:1", time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if err := s.CreateToken(ctx, "reset", "new", "account:2", time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if _, ok, err := s.ConsumeToken(ctx, "reset", "old", time.Now()); err != nil || ok {
		t.Fatalf("old token: %v %v", ok, err)
	}
	if subject, ok, err := s.ConsumeToken(ctx, "reset", "new", time.Now()); err != nil || !ok || subject != "account:2" {
		t.Fatalf("new token: %s %v %v", subject, ok, err)
	}
}

func TestAuthVersionConcurrentRefreshPreservesSession(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	if err := s.CreateSession(ctx, "sid", domain.Session{AccountID: "a", AuthVersion: 9, CSRFToken: "csrf", ExpiresAt: time.Now().Add(time.Hour)}); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	for range 16 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			got, ok, err := s.GetAndRefreshSession(ctx, "sid", time.Now(), time.Now().Add(time.Hour))
			if err != nil || !ok || got == nil || got.AuthVersion != 9 {
				t.Errorf("concurrent refresh: %#v %v %v", got, ok, err)
			}
		}()
	}
	wg.Wait()
}

func TestAuthVersionCorruptSessionsFailClosed(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	for _, raw := range []string{`{`, `{"auth_version":1,"expires_at":"invalid"}`} {
		if err := s.client.Set(ctx, sessionKey("bad"), raw, time.Hour).Err(); err != nil {
			t.Fatal(err)
		}
		if _, ok, err := s.Session(ctx, "bad", time.Now()); err == nil || ok {
			t.Fatalf("corrupt session accepted: %q", raw)
		}
	}
	if err := s.client.Set(ctx, sessionKey("bad"), `{`, time.Hour).Err(); err != nil {
		t.Fatal(err)
	}
	if _, ok, err := s.GetAndRefreshSession(ctx, "bad", time.Now(), time.Now().Add(time.Hour)); err == nil || ok {
		t.Fatal("corrupt refresh accepted")
	}
	if _, ok, err := s.GetAndRefreshSession(ctx, "sid", time.Now(), time.Now().Add(-time.Hour)); err != nil || ok {
		t.Fatal("past expiry refreshed")
	}
}

func TestAuthVersionSessionStoreFailuresFailClosed(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	if err := s.client.Close(); err != nil {
		t.Fatal(err)
	}
	if _, ok, err := s.Session(ctx, "sid", time.Now()); err == nil || ok {
		t.Fatal("failed read accepted")
	}
	if _, ok, err := s.GetAndRefreshSession(ctx, "sid", time.Now(), time.Now().Add(time.Hour)); err == nil || ok {
		t.Fatal("failed refresh accepted")
	}
	if err := s.DeleteSession(ctx, "sid"); err == nil {
		t.Fatal("failed delete reported success")
	}
	if err := s.CreateSession(ctx, "sid", domain.Session{AccountID: "a", AuthVersion: 1, ExpiresAt: time.Now().Add(time.Hour)}); err == nil {
		t.Fatal("failed create reported success")
	}
}
