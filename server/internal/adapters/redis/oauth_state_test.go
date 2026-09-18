package redis

import (
	"context"
	"testing"
	"time"
)

func TestOAuthStateIsSingleUse(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()

	if err := store.CreateState(ctx, "state-1", 10*time.Minute); err != nil {
		t.Fatalf("create state: %v", err)
	}

	ok, err := store.ConsumeState(ctx, "state-1")
	if err != nil || !ok {
		t.Fatalf("first consume should succeed: ok=%v err=%v", ok, err)
	}

	ok, err = store.ConsumeState(ctx, "state-1")
	if err != nil || ok {
		t.Fatalf("second consume of the same state must fail (already used): ok=%v err=%v", ok, err)
	}
}

func TestOAuthStateUnknownValueFails(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()

	ok, err := store.ConsumeState(ctx, "never-created")
	if err != nil || ok {
		t.Fatalf("consuming an unknown state should fail cleanly: ok=%v err=%v", ok, err)
	}
}
