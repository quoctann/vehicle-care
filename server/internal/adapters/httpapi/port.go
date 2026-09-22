package httpapi

import (
	"context"
	"time"
)

// IOAuthStateStore is a transport-level CSRF-safety helper for the Google
// OAuth redirect flow. It has no account context — a state nonce exists
// before we know who the user is — so it is a port this adapter owns
// directly instead of one routed through an application use case.
type IOAuthStateStore interface {
	CreateState(ctx context.Context, state string, ttl time.Duration) error
	ConsumeState(ctx context.Context, state string) (bool, error)
}
