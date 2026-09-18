package ports

import (
	"context"
	"time"
)

// OAuthStateStore is a transport-level CSRF-safety helper for the Google
// OAuth redirect flow. It has no account context and is injected directly
// into the httpapi adapter, not into application.Service.
type OAuthStateStore interface {
	CreateState(ctx context.Context, state string, ttl time.Duration) error
	ConsumeState(ctx context.Context, state string) (bool, error)
}
