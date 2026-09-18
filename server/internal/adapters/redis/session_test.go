package redis

import (
	"context"
	"testing"
	"time"

	"github.com/quoctann/vehicle-care/server/internal/domain"
)

func TestCreateSessionAndGetAndRefreshSession(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	now := time.Now().UTC()

	session := domain.Session{AccountID: "account-1", CSRFToken: "csrf-1", ExpiresAt: now.Add(time.Hour)}
	if err := store.CreateSession(ctx, "session-1", session); err != nil {
		t.Fatalf("create session: %v", err)
	}

	newExpiresAt := now.Add(2 * time.Hour)
	got, ok, err := store.GetAndRefreshSession(ctx, "session-1", now, newExpiresAt)
	if err != nil || !ok {
		t.Fatalf("get and refresh session: ok=%v err=%v", ok, err)
	}
	if got.AccountID != "account-1" || got.CSRFToken != "csrf-1" {
		t.Fatalf("unexpected session payload: %#v", got)
	}
	if !got.ExpiresAt.Equal(newExpiresAt) {
		t.Fatalf("expiry was not slid to newExpiresAt: got=%v want=%v", got.ExpiresAt, newExpiresAt)
	}

	// A plain read afterwards should observe the refreshed expiry, proving
	// the best-effort value/index rewrite in refreshSessionValue landed.
	reread, ok, err := store.Session(ctx, "session-1", now)
	if err != nil || !ok {
		t.Fatalf("re-read session: ok=%v err=%v", ok, err)
	}
	if !reread.ExpiresAt.Equal(newExpiresAt) {
		t.Fatalf("re-read did not see refreshed expiry: got=%v want=%v", reread.ExpiresAt, newExpiresAt)
	}
}

func TestGetAndRefreshSessionMissingReturnsNotFound(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	now := time.Now().UTC()

	_, ok, err := store.GetAndRefreshSession(ctx, "does-not-exist", now, now.Add(time.Hour))
	if err != nil || ok {
		t.Fatalf("expected not-found for missing session: ok=%v err=%v", ok, err)
	}
}

func TestRefreshSessionErrorsWhenSessionMissing(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	now := time.Now().UTC()

	if err := store.RefreshSession(ctx, "does-not-exist", now.Add(time.Hour)); err == nil {
		t.Fatalf("expected an error refreshing a missing session")
	}
}

func TestDeleteSessionRemovesIt(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	now := time.Now().UTC()

	session := domain.Session{AccountID: "account-1", CSRFToken: "csrf-1", ExpiresAt: now.Add(time.Hour)}
	if err := store.CreateSession(ctx, "session-1", session); err != nil {
		t.Fatalf("create session: %v", err)
	}
	if err := store.DeleteSession(ctx, "session-1"); err != nil {
		t.Fatalf("delete session: %v", err)
	}
	if _, ok, err := store.Session(ctx, "session-1", now); ok || err != nil {
		t.Fatalf("deleted session should be gone: ok=%v err=%v", ok, err)
	}
}

func TestDeleteAccountSessionsRemovesOnlyThatAccount(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	now := time.Now().UTC()

	sessions := map[string]string{
		"session-a1": "account-1",
		"session-a2": "account-1",
		"session-b1": "account-2",
	}
	for sessionID, accountID := range sessions {
		session := domain.Session{AccountID: accountID, CSRFToken: "csrf", ExpiresAt: now.Add(time.Hour)}
		if err := store.CreateSession(ctx, sessionID, session); err != nil {
			t.Fatalf("create session %s: %v", sessionID, err)
		}
	}

	if err := store.DeleteAccountSessions(ctx, "account-1"); err != nil {
		t.Fatalf("delete account sessions: %v", err)
	}

	if _, ok, err := store.Session(ctx, "session-a1", now); ok || err != nil {
		t.Fatalf("session-a1 should have been deleted: ok=%v err=%v", ok, err)
	}
	if _, ok, err := store.Session(ctx, "session-a2", now); ok || err != nil {
		t.Fatalf("session-a2 should have been deleted: ok=%v err=%v", ok, err)
	}
	if _, ok, err := store.Session(ctx, "session-b1", now); !ok || err != nil {
		t.Fatalf("session-b1 (different account) should be unaffected: ok=%v err=%v", ok, err)
	}
}
