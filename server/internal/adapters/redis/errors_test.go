package redis

import (
	"context"
	"strings"
	"testing"
	"time"
)

// TestErrorsDoNotLeakPlaintextSecrets forces backing-store failures (by
// closing the connection out from under the Store) and checks that the
// resulting error strings never contain the plaintext token/OTP value that
// was passed in. wrapErr only ever interpolates a fixed operation label, but
// this test guards the invariant at the call sites too, in case that
// changes later.
func TestErrorsDoNotLeakPlaintextSecrets(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	now := time.Now().UTC()

	const secretToken = "super-secret-plaintext-value-should-never-appear-in-logs"

	// Establish a real value first so a failure is due to the connection,
	// not a legitimate not-found.
	if err := store.CreateToken(ctx, "reset", secretToken, "account-1", now.Add(time.Hour)); err != nil {
		t.Fatalf("create token: %v", err)
	}

	if err := store.client.Close(); err != nil {
		t.Fatalf("close client: %v", err)
	}

	_, _, err := store.ConsumeToken(ctx, "reset", secretToken, now)
	if err == nil {
		t.Fatalf("expected an error once the connection is closed")
	}
	if strings.Contains(err.Error(), secretToken) {
		t.Fatalf("error message leaked the plaintext token: %v", err)
	}

	if err := store.CreateToken(ctx, "reset", secretToken, "account-1", now.Add(time.Hour)); err == nil {
		t.Fatalf("expected an error once the connection is closed")
	} else if strings.Contains(err.Error(), secretToken) {
		t.Fatalf("error message leaked the plaintext token: %v", err)
	}
}
