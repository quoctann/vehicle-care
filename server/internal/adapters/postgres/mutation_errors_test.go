package postgres

import (
	"fmt"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

func TestIdempotencyCollisionIsNotTerminal(t *testing.T) {
	err := fmt.Errorf("record mutation: %w", &pgconn.PgError{Code: "23505", ConstraintName: "processed_mutations_pkey"})
	if isTerminalMutationErr(err) {
		t.Fatal("an overlapping retry must not permanently block a committed mutation")
	}
	if !isTerminalMutationErr(&pgconn.PgError{Code: "23514", ConstraintName: "odometer_logs_odometer_km_check"}) {
		t.Fatal("invalid data must still be rejected")
	}
}
