package postgres_test

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/quoctann/vehicle-care/server/internal/domain"
)

// TestPullKeepsStableWatermark asserts the same stable-watermark pagination
// behavior as the ApplyMutations/Pull contract. odometer_logs must reference
// a real vehicle row, so a vehicle-create mutation runs first and consumes
// server_seq 1; every literal sequence number below is shifted by that +1.
func TestPullKeepsStableWatermark(t *testing.T) {
	t.Parallel()
	store, _ := newTestStore(t)
	ctx := context.Background()
	accountID := newAccount(t, store)
	vehicleID := createVehicle(t, store, accountID, "device-1") // consumes server_seq 1
	now := time.Date(2026, 9, 17, 10, 0, 0, 0, time.UTC)

	for index := 1; index <= 2; index++ {
		store.ApplyMutations(ctx, accountID, "device-1", []domain.Mutation{{
			MutationID: uuid.NewString(), EntityType: "odometer_log", Operation: "create", EntityID: uuid.NewString(),
			Payload: map[string]any{"vehicle_id": vehicleID, "odometer_km": float64(index * 100), "recorded_at": now.Format(time.RFC3339), "source": "manual"},
		}}, now)
	}

	first, err := store.Pull(ctx, accountID, 1, 1, "", now)
	if err != nil {
		t.Fatalf("first pull: %v", err)
	}
	store.ApplyMutations(ctx, accountID, "device-1", []domain.Mutation{{
		MutationID: uuid.NewString(), EntityType: "odometer_log", Operation: "create", EntityID: uuid.NewString(),
		Payload: map[string]any{"vehicle_id": vehicleID, "odometer_km": float64(300), "recorded_at": now.Format(time.RFC3339), "source": "manual"},
	}}, now)
	second, err := store.Pull(ctx, accountID, first.NextCursor, 10, first.Watermark, now)
	if err != nil {
		t.Fatalf("second pull: %v", err)
	}

	if !first.HasMore || len(first.Changes) != 1 || first.Changes[0].ServerSeq != 2 {
		t.Fatalf("unexpected first page: %#v", first)
	}
	if second.Watermark != first.Watermark || second.HasMore || len(second.Changes) != 1 || second.Changes[0].ServerSeq != 3 {
		t.Fatalf("new change escaped stable watermark: %#v", second)
	}
	retriedFinal, err := store.Pull(ctx, accountID, first.NextCursor, 10, first.Watermark, now.Add(time.Minute))
	if err != nil || len(retriedFinal.Changes) != 1 || retriedFinal.Changes[0].ServerSeq != 3 {
		t.Fatalf("final page was not retryable: page=%#v err=%v", retriedFinal, err)
	}
	third, err := store.Pull(ctx, accountID, second.NextCursor, 10, "", now)
	if err != nil || len(third.Changes) != 1 || third.Changes[0].ServerSeq != 4 {
		t.Fatalf("next pull did not include deferred change: page=%#v err=%v", third, err)
	}
}

// TestPullWatermarkExpires asserts that a watermark past its 15 minute TTL
// is rejected.
func TestPullWatermarkExpires(t *testing.T) {
	t.Parallel()
	store, _ := newTestStore(t)
	ctx := context.Background()
	accountID := newAccount(t, store)
	now := time.Date(2026, 9, 17, 10, 0, 0, 0, time.UTC)

	first, err := store.Pull(ctx, accountID, 0, 10, "", now)
	if err != nil {
		t.Fatalf("mint watermark: %v", err)
	}
	if _, err := store.Pull(ctx, accountID, first.NextCursor, 10, first.Watermark, now.Add(16*time.Minute)); err == nil {
		t.Fatalf("expected expired watermark to be rejected")
	}
}
