package logging

import (
	"context"
	"strings"
	"testing"
)

func TestRequestIDContext(t *testing.T) {
	ctx := context.Background()
	if RequestID(ctx) != "" {
		t.Fatal("unexpected request ID")
	}
	if RequestID(WithRequestID(ctx, "req_safe-123")) != "req_safe-123" {
		t.Fatal("missing safe request ID")
	}
	for _, value := range []string{"", "line\nbreak", "person@example.com", strings.Repeat("x", 65)} {
		if RequestID(WithRequestID(ctx, value)) != "" {
			t.Fatal("invalid request ID accepted")
		}
	}
}
