package application

import (
	"context"
	"testing"
	"time"

	"github.com/quoctann/vehicle-care/server/internal/adapters/memory"
)

func TestSessionExpirySlidesOnAuthenticatedUse(t *testing.T) {
	t.Parallel()
	store := memory.NewStore()
	service := NewService(store, time.Hour, 100, 100)
	now := time.Date(2026, 9, 17, 10, 0, 0, 0, time.UTC)
	service.now = func() time.Time { return now }
	if err := service.SeedDemoAccount(context.Background()); err != nil {
		t.Fatalf("seed: %v", err)
	}
	_, sessionID, _, err := service.Login(context.Background(), "demo@vehicle.app", "demo12345")
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	now = now.Add(30 * time.Minute)
	if _, _, err := service.ResolveSession(context.Background(), sessionID); err != nil {
		t.Fatalf("first resolve: %v", err)
	}
	now = now.Add(45 * time.Minute)
	if _, _, err := service.ResolveSession(context.Background(), sessionID); err != nil {
		t.Fatalf("session did not slide: %v", err)
	}
}

func TestSignupRejectsPasswordBeyondBcryptLimit(t *testing.T) {
	t.Parallel()
	service := NewService(memory.NewStore(), time.Hour, 100, 100)
	password := make([]byte, maxPasswordBytes+1)
	for index := range password {
		password[index] = 'a'
	}
	_, _, _, _, err := service.Signup(context.Background(), "user@example.com", string(password), nil)
	appErr, ok := AsError(err)
	if !ok || appErr.Code != "validation_failed" {
		t.Fatalf("unexpected error: %v", err)
	}
}
