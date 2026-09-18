package redis

import (
	"context"
	"testing"
	"time"

	goredis "github.com/redis/go-redis/v9"
	tcredis "github.com/testcontainers/testcontainers-go/modules/redis"
)

// newTestStore starts a real Redis container via testcontainers-go and
// returns a Store connected to it. It skips the test (rather than failing
// it) when the container cannot be started, since that almost always means
// the environment running the test has no Docker daemon available, not
// that the adapter code is broken.
func newTestStore(t *testing.T) *Store {
	t.Helper()
	ctx := context.Background()

	container, err := tcredis.Run(ctx, "redis:7-alpine")
	if err != nil {
		t.Skipf("skipping: could not start redis test container (likely no Docker daemon available): %v", err)
	}
	t.Cleanup(func() {
		_ = container.Terminate(context.Background())
	})

	connString, err := container.ConnectionString(ctx)
	if err != nil {
		t.Fatalf("get connection string: %v", err)
	}

	redisOpts, err := goredis.ParseURL(connString)
	if err != nil {
		t.Fatalf("parse connection string: %v", err)
	}
	client := goredis.NewClient(redisOpts)
	t.Cleanup(func() {
		_ = client.Close()
	})

	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := client.Ping(pingCtx).Err(); err != nil {
		t.Fatalf("ping redis container: %v", err)
	}

	return NewStore(client)
}
