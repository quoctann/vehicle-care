package postgres_test

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/quoctann/vehicle-care/server/internal/application/user"
	"github.com/quoctann/vehicle-care/server/internal/domain"
)

func TestAuthVersionConcurrentResetCAS(t *testing.T) {
	s, _ := newTestStore(t)
	ctx := context.Background()
	id := uuid.NewString()
	if err := s.CreateAccount(ctx, domain.Account{ID: id, Email: id + "@example.test", Timezone: "UTC+07:00", PasswordHash: []byte("old")}); err != nil {
		t.Fatal(err)
	}
	before, err := s.AccountByID(ctx, id)
	if err != nil || before.AuthVersion != 1 {
		t.Fatalf("initial version: %#v %v", before, err)
	}
	results := make(chan error, 2)
	var wg sync.WaitGroup
	for _, password := range []string{"first", "second"} {
		wg.Add(1)
		go func() { defer wg.Done(); results <- s.SetPassword(ctx, id, []byte(password), 1) }()
	}
	wg.Wait()
	close(results)
	successes, stale := 0, 0
	for err := range results {
		if err == nil {
			successes++
		} else if errors.Is(err, user.ErrAuthVersionChanged) {
			stale++
		} else {
			t.Fatal(err)
		}
	}
	if successes != 1 || stale != 1 {
		t.Fatalf("success=%d stale=%d", successes, stale)
	}
	after, err := s.AccountByID(ctx, id)
	if err != nil || after.AuthVersion != 2 || string(after.PasswordHash) == "old" {
		t.Fatalf("atomic update: %#v %v", after, err)
	}
	if err := s.LinkGoogle(ctx, id, "stale-google-link", 1); !errors.Is(err, user.ErrAuthVersionChanged) {
		t.Fatalf("stale link: %v", err)
	}
	if linked, err := s.GoogleLinked(ctx, id); err != nil || linked {
		t.Fatalf("stale identity inserted: %v %v", linked, err)
	}
	if err := s.LinkGoogle(ctx, id, "fresh-google-link", 2); err != nil {
		t.Fatal(err)
	}
	updated, err := s.UpdateAccountTimezone(ctx, id, "UTC+00:00")
	if err != nil || updated.AuthVersion != 2 {
		t.Fatalf("timezone version: %#v %v", updated, err)
	}
	byEmail, err := s.AccountByEmail(ctx, before.Email)
	if err != nil || byEmail.AuthVersion != 2 {
		t.Fatalf("email version: %#v %v", byEmail, err)
	}
}

func TestAuthVersionPasswordlessCannotReset(t *testing.T) {
	s, _ := newTestStore(t)
	id := newAccount(t, s)
	if err := s.SetPassword(context.Background(), id, []byte("new"), 1); !errors.Is(err, user.ErrAuthVersionChanged) {
		t.Fatalf("passwordless reset: %v", err)
	}
}
