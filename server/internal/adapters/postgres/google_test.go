package postgres_test

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sync"
	"testing"

	"github.com/quoctann/vehicle-care/server/internal/application/user"
)

func TestGoogleAccountIdentityAndSeed(t *testing.T) {
	s, _ := newTestStore(t)
	ctx := context.Background()
	a, err := s.GoogleAccount(ctx, "subject", "google@example.test", "Google User", true)
	if err != nil {
		t.Fatal(err)
	}
	if !a.EmailVerified || len(a.PasswordHash) != 0 {
		t.Fatal("must be verified passwordless")
	}
	if len(seedPartTypes(t, s, a.ID)) != 10 {
		t.Fatal("missing seed")
	}
	b, err := s.GoogleAccount(ctx, "subject", "changed@example.test", "New Name", true)
	if err != nil || a.ID != b.ID {
		t.Fatal("identity not stable", err)
	}
	_, err = s.GoogleAccount(ctx, "other", "google@example.test", "", true)
	if !errors.Is(err, user.ErrGoogleEmailExists) {
		t.Fatal("email must not auto link", err)
	}
	other := newAccount(t, s)
	if err := s.LinkGoogle(ctx, other, "subject", 1); !errors.Is(err, user.ErrGoogleIdentityLinked) {
		t.Fatal(err)
	}
	if err := s.LinkGoogle(ctx, a.ID, "new-subject", 1); !errors.Is(err, user.ErrGoogleAlreadyLinked) {
		t.Fatal(err)
	}
	linked, err := s.GoogleLinked(ctx, a.ID)
	if err != nil || !linked {
		t.Fatal(linked, err)
	}
}

func TestGoogleConcurrentSignup(t *testing.T) {
	s, dsn := newTestStore(t)
	ctx := context.Background()
	var wg sync.WaitGroup
	ids := make(chan string, 8)
	for i := range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			a, err := s.GoogleAccount(ctx, "concurrent", fmt.Sprintf("concurrent%d@example.test", i), "", true)
			if err != nil {
				t.Error(err)
				return
			}
			ids <- a.ID
		}()
	}
	wg.Wait()
	close(ids)
	first := ""
	for id := range ids {
		if first == "" {
			first = id
		}
		if id != first {
			t.Fatal("duplicate accounts")
		}
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	for query, want := range map[string]int{
		"SELECT count(*) FROM accounts":        1,
		"SELECT count(*) FROM auth_identities": 1,
		"SELECT count(*) FROM part_types":      10,
		"SELECT count(*) FROM change_feed":     10,
	} {
		var n int
		if err := db.QueryRowContext(ctx, query).Scan(&n); err != nil || n != want {
			t.Fatalf("%s: %d want %d: %v", query, n, want, err)
		}
	}
}

func TestGoogleSignupRollsBackFailedSeedAndInvalidIdentity(t *testing.T) {
	s, dsn := newTestStore(t)
	ctx := context.Background()
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := s.GoogleAccount(ctx, "", "invalid@example.test", "", false); err == nil {
		t.Fatal("empty subject accepted")
	}
	if _, err := db.ExecContext(ctx, `CREATE FUNCTION reject_google_seed() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test seed failure'; END; $$; CREATE TRIGGER reject_google_seed BEFORE INSERT ON part_types FOR EACH ROW EXECUTE FUNCTION reject_google_seed()`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.GoogleAccount(ctx, "failed-seed", "failed@example.test", "", false); err == nil {
		t.Fatal("seed failure ignored")
	}
	for _, table := range []string{"accounts", "auth_identities", "account_sequences", "part_types", "change_feed"} {
		var count int
		if err := db.QueryRowContext(ctx, "SELECT count(*) FROM "+table).Scan(&count); err != nil || count != 0 {
			t.Fatalf("orphan %s: %d %v", table, count, err)
		}
	}
	if err := s.LinkGoogle(ctx, "00000000-0000-4000-8000-000000000099", "missing-account", 1); err == nil {
		t.Fatal("linked missing account")
	}
	_ = s.Close()
	if _, err := s.GoogleAccount(ctx, "closed", "closed@example.test", "", false); err == nil {
		t.Fatal("ignored database outage")
	}
	if err := s.LinkGoogle(ctx, "00000000-0000-4000-8000-000000000099", "closed", 1); err == nil {
		t.Fatal("ignored database outage")
	}
}
