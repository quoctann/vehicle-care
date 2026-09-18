package redis

import (
	"context"
	"testing"
	"time"
)

// TestTokensExpireAndNewTokenInvalidatesPrevious ports
// memory.TestTokensExpireAndNewTokenInvalidatesPrevious against the Redis
// adapter, since ports.TokenStore contracts must behave identically
// regardless of backing store.
func TestTokensExpireAndNewTokenInvalidatesPrevious(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	now := time.Now().UTC()

	if err := store.CreateToken(ctx, "reset", "old-token", "account-1", now.Add(time.Hour)); err != nil {
		t.Fatalf("create old token: %v", err)
	}
	if err := store.CreateToken(ctx, "reset", "new-token", "account-1", now.Add(time.Hour)); err != nil {
		t.Fatalf("create new token: %v", err)
	}
	if _, ok, err := store.ConsumeToken(ctx, "reset", "old-token", now); ok || err != nil {
		t.Fatalf("superseded token remained valid: ok=%v err=%v", ok, err)
	}
	if accountID, ok, err := store.ConsumeToken(ctx, "reset", "new-token", now); !ok || err != nil || accountID != "account-1" {
		t.Fatalf("new token was not valid: account=%q ok=%v err=%v", accountID, ok, err)
	}
	if err := store.CreateToken(ctx, "verification", "expired", "account-1", now); err != nil {
		t.Fatalf("create expired token: %v", err)
	}
	if _, ok, err := store.ConsumeToken(ctx, "verification", "expired", now); ok || err != nil {
		t.Fatalf("expired token remained valid: ok=%v err=%v", ok, err)
	}
}

func TestCreateTokenOnlySupersedesSameKindAndAccount(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	now := time.Now().UTC()

	if err := store.CreateToken(ctx, "reset", "account1-reset", "account-1", now.Add(time.Hour)); err != nil {
		t.Fatalf("create account-1 reset token: %v", err)
	}
	if err := store.CreateToken(ctx, "verification", "account1-verify", "account-1", now.Add(time.Hour)); err != nil {
		t.Fatalf("create account-1 verification token: %v", err)
	}
	if err := store.CreateToken(ctx, "reset", "account2-reset", "account-2", now.Add(time.Hour)); err != nil {
		t.Fatalf("create account-2 reset token: %v", err)
	}

	// Creating a second reset token for account-1 must only invalidate the
	// previous reset token for account-1, not the verification token for
	// account-1 nor the reset token for account-2.
	if err := store.CreateToken(ctx, "reset", "account1-reset-2", "account-1", now.Add(time.Hour)); err != nil {
		t.Fatalf("create second account-1 reset token: %v", err)
	}

	if _, ok, err := store.ConsumeToken(ctx, "reset", "account1-reset", now); ok || err != nil {
		t.Fatalf("old account-1 reset token should have been superseded: ok=%v err=%v", ok, err)
	}
	if accountID, ok, err := store.ConsumeToken(ctx, "reset", "account1-reset-2", now); !ok || err != nil || accountID != "account-1" {
		t.Fatalf("new account-1 reset token should be valid: account=%q ok=%v err=%v", accountID, ok, err)
	}
	if accountID, ok, err := store.ConsumeToken(ctx, "verification", "account1-verify", now); !ok || err != nil || accountID != "account-1" {
		t.Fatalf("account-1 verification token should be unaffected: account=%q ok=%v err=%v", accountID, ok, err)
	}
	if accountID, ok, err := store.ConsumeToken(ctx, "reset", "account2-reset", now); !ok || err != nil || accountID != "account-2" {
		t.Fatalf("account-2 reset token should be unaffected: account=%q ok=%v err=%v", accountID, ok, err)
	}
}

func TestConsumeTokenIsSingleUseAndKindSensitive(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	now := time.Now().UTC()

	if err := store.CreateToken(ctx, "verification", "single-use", "account-1", now.Add(time.Hour)); err != nil {
		t.Fatalf("create token: %v", err)
	}

	if _, ok, err := store.ConsumeToken(ctx, "reset", "single-use", now); ok || err != nil {
		t.Fatalf("wrong kind should fail even with the correct token value: ok=%v err=%v", ok, err)
	}
	if accountID, ok, err := store.ConsumeToken(ctx, "verification", "single-use", now); !ok || err != nil || accountID != "account-1" {
		t.Fatalf("correct kind should succeed: account=%q ok=%v err=%v", accountID, ok, err)
	}
	if _, ok, err := store.ConsumeToken(ctx, "verification", "single-use", now); ok || err != nil {
		t.Fatalf("token should not be usable twice: ok=%v err=%v", ok, err)
	}
}
