package postgres_test

import (
	"context"
	"database/sql"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/quoctann/vehicle-care/server/internal/application/user"
)

type timezoneServicePorts struct {
	user.IAccountStore
	user.ISessionStore
	user.ITokenStore
}

func TestUpdateTimezoneCanonicalPersistence(t *testing.T) {
	store, _ := newTestStore(t)
	id := newAccount(t, store)
	service := user.NewService(timezoneServicePorts{IAccountStore: store}, time.Hour)
	for _, test := range []struct{ input, want string }{
		{"UTC+07:00", "UTC+07:00"},
		{"UTC-05:00", "UTC-05:00"},
		{"UTC+05:45", "UTC+05:45"},
	} {
		t.Run(test.input, func(t *testing.T) {
			updated, err := service.UpdateTimezone(context.Background(), id, test.input)
			if err != nil {
				t.Fatal(err)
			}
			persisted, err := store.AccountByID(context.Background(), id)
			if err != nil || persisted == nil || updated.Timezone != test.want || persisted.Timezone != test.want {
				t.Fatalf("updated=%#v persisted=%#v want=%q err=%v", updated, persisted, test.want, err)
			}
		})
	}
}

func TestUpdateAccountTimezone(t *testing.T) {
	store, _ := newTestStore(t)
	id := newAccount(t, store)
	other := newAccount(t, store)
	ctx := context.Background()
	before, err := store.AccountByID(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	updated, err := store.UpdateAccountTimezone(ctx, id, "UTC+07:00")
	if err != nil {
		t.Fatal(err)
	}
	persisted, err := store.AccountByID(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	if updated.ID != id || updated.Timezone != "UTC+07:00" || persisted.Timezone != updated.Timezone || updated.Email != before.Email || updated.EmailVerified != before.EmailVerified {
		t.Fatalf("unexpected account: %#v persisted=%#v", updated, persisted)
	}
	untouched, err := store.AccountByID(ctx, other)
	if err != nil || untouched.Timezone != "UTC+07:00" {
		t.Fatalf("other account changed: %#v, %v", untouched, err)
	}
	if _, err := store.UpdateAccountTimezone(ctx, uuid.NewString(), "UTC+00:00"); !errors.Is(err, user.ErrAccountNotFound) {
		t.Fatalf("expected missing account, got %v", err)
	}
	for _, zone := range []string{"UTC+07:00", "UTC+05:30", "UTC+05:45", "UTC-03:30", "UTC+00:00", "UTC-12:00", "UTC+14:00"} {
		t.Run(zone, func(t *testing.T) {
			updated, err := store.UpdateAccountTimezone(ctx, id, zone)
			if err != nil {
				t.Fatal(err)
			}
			persisted, err := store.AccountByID(ctx, id)
			if err != nil || updated.Timezone != zone || persisted.Timezone != zone {
				t.Fatalf("canonical string not persisted exactly: updated=%#v persisted=%#v err=%v", updated, persisted, err)
			}
		})
	}
}

func TestAccountTimezoneDatabaseDefault(t *testing.T) {
	store, dsn := newTestStore(t)
	_ = newAccount(t, store)
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var zone string
	id := uuid.NewString()
	err = db.QueryRowContext(context.Background(), "INSERT INTO accounts (id, email) VALUES ($1, $2) RETURNING timezone", id, id+"@example.test").Scan(&zone)
	if err != nil || zone != "UTC+07:00" {
		t.Fatalf("database default=%q err=%v", zone, err)
	}
}
