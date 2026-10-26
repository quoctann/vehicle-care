package user

import (
	"context"
	"testing"
)

func TestAuthVersionGoogleLinkResetBeforeCallback(t *testing.T) {
	s, f := googleFixture(t)
	ctx := context.Background()
	key, err := s.Begin(ctx, "browser", "link", "sid", "account", "password123")
	if err != nil {
		t.Fatal(err)
	}
	if f.states[key].AuthVersion != 1 {
		t.Fatal("OAuth state lacks credential generation")
	}
	// Even a same-ID session rewritten with the new version cannot reuse an
	// OAuth transaction authorized with the previous password.
	f.account.AuthVersion++
	if _, err := s.Complete(ctx, key, "browser", "code", false, "sid"); GoogleErrorCode(err) != "expired" || f.linkCalls != 0 {
		t.Fatalf("stale link: %v calls=%d", err, f.linkCalls)
	}
}
