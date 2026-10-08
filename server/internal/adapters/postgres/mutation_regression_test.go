package postgres_test

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/quoctann/vehicle-care/server/internal/domain"
)

func TestFuelLogCannotReferenceAnotherVehiclesOdometer(t *testing.T) {
	store, _ := newTestStore(t)
	ctx := context.Background()
	accountID := newAccount(t, store)
	firstVehicle := createVehicle(t, store, accountID, deviceOne)
	secondVehicle := createVehicle(t, store, accountID, deviceOne)
	now := time.Now().UTC().Truncate(time.Second)
	odometerID := uuid.NewString()
	reading := store.ApplyMutation(ctx, accountID, deviceOne, domain.Mutation{
		MutationID: uuid.NewString(), EntityType: "odometer_log", Operation: "create", EntityID: odometerID,
		Payload: map[string]any{"vehicle_id": firstVehicle, "odometer_km": float64(100), "recorded_at": now.Format(time.RFC3339), "source": "manual"},
	}, now)
	if reading.Status != "applied" {
		t.Fatalf("create odometer reading: %#v", reading)
	}
	fuel := store.ApplyMutation(ctx, accountID, deviceOne, domain.Mutation{
		MutationID: uuid.NewString(), EntityType: "fuel_log", Operation: "create", EntityID: uuid.NewString(),
		Payload: map[string]any{"vehicle_id": secondVehicle, "odometer_log_id": odometerID, "recorded_at": now.Format(time.RFC3339), "is_full_tank": true},
	}, now)
	if fuel.Status != "rejected" || fuel.ErrorCode != "validation_failed" {
		t.Fatalf("cross-vehicle reading must be rejected: %#v", fuel)
	}
	page, err := store.Pull(ctx, accountID, *reading.ServerSeq, 10, nil)
	if err != nil || len(page.Changes) != 0 || page.UntilSeq != *reading.ServerSeq {
		t.Fatalf("rejection changed feed or sequence: page=%#v err=%v", page, err)
	}
	valid := store.ApplyMutation(ctx, accountID, deviceOne, domain.Mutation{
		MutationID: uuid.NewString(), EntityType: "fuel_log", Operation: "create", EntityID: uuid.NewString(),
		Payload: map[string]any{"vehicle_id": firstVehicle, "odometer_log_id": odometerID, "recorded_at": now.Format(time.RFC3339), "is_full_tank": true},
	}, now)
	if valid.Status != "applied" || valid.ServerSeq == nil || *valid.ServerSeq != *reading.ServerSeq+1 {
		t.Fatalf("same-vehicle reference should apply without a sequence gap: %#v", valid)
	}
}

func TestUnknownEntityNeverUsesOdometerWritePath(t *testing.T) {
	store, _ := newTestStore(t)
	ctx := context.Background()
	accountID := newAccount(t, store)
	vehicleID := createVehicle(t, store, accountID, deviceOne)
	page, err := store.Pull(ctx, accountID, 0, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	unknown := store.ApplyMutation(ctx, accountID, deviceOne, domain.Mutation{
		MutationID: uuid.NewString(), EntityType: "unknown", Operation: "create", EntityID: uuid.NewString(),
		Payload: map[string]any{"vehicle_id": vehicleID, "odometer_km": float64(100), "recorded_at": time.Now().UTC().Format(time.RFC3339), "source": "manual"},
	}, time.Now())
	if unknown.Status != "rejected" || unknown.ErrorCode != "validation_failed" {
		t.Fatalf("unsupported type must be rejected explicitly: %#v", unknown)
	}
	after, err := store.Pull(ctx, accountID, page.UntilSeq, 10, nil)
	if err != nil || len(after.Changes) != 0 || after.UntilSeq != page.UntilSeq {
		t.Fatalf("unknown type changed feed or sequence: page=%#v err=%v", after, err)
	}
}

func TestReminderScopeRejectionPreservesNextSequence(t *testing.T) {
	store, _ := newTestStore(t)
	ctx := context.Background()
	accountID := newAccount(t, store)
	vehicleID := createVehicle(t, store, accountID, deviceOne)
	partTypeID := seedPartTypes(t, store, accountID)["engine_oil"]
	now := time.Now().UTC()
	payload := map[string]any{"vehicle_id": vehicleID, "part_type_id": partTypeID, "interval_km": float64(1000), "enabled": true}
	first := store.ApplyMutation(ctx, accountID, deviceOne, domain.Mutation{
		MutationID: uuid.NewString(), EntityType: "reminder_config", Operation: "create", EntityID: uuid.NewString(), Payload: payload,
	}, now)
	if first.Status != "applied" {
		t.Fatalf("create first reminder: %#v", first)
	}
	conflict := store.ApplyMutation(ctx, accountID, deviceTwo, domain.Mutation{
		MutationID: uuid.NewString(), EntityType: "reminder_config", Operation: "create", EntityID: uuid.NewString(), Payload: payload,
	}, now)
	if conflict.Status != "rejected" || conflict.ServerSeq != nil {
		t.Fatalf("conflicting reminder should not allocate a sequence: %#v", conflict)
	}
	vehicle := store.ApplyMutation(ctx, accountID, deviceOne, domain.Mutation{
		MutationID: uuid.NewString(), EntityType: "vehicle", Operation: "update", EntityID: vehicleID,
		Payload: map[string]any{"name": "Updated vehicle"},
	}, now)
	if vehicle.Status != "applied" || *vehicle.ServerSeq != *first.ServerSeq+1 {
		t.Fatalf("rejection left a sequence gap: first=%#v next=%#v", first, vehicle)
	}
}

func TestReminderCreateConflictAndUpdateAcknowledgments(t *testing.T) {
	store, _ := newTestStore(t)
	ctx := context.Background()
	accountID := newAccount(t, store)
	vehicleID := createVehicle(t, store, accountID, deviceOne)
	partTypeID := seedPartTypes(t, store, accountID)["engine_oil"]
	now := time.Now().UTC().Truncate(time.Microsecond)
	reminderID := uuid.NewString()
	payload := map[string]any{"vehicle_id": vehicleID, "part_type_id": partTypeID, "interval_km": float64(1000), "enabled": true}
	create := domain.Mutation{MutationID: uuid.NewString(), EntityType: "reminder_config", Operation: "create", EntityID: reminderID, Payload: payload}
	first := store.ApplyMutation(ctx, accountID, deviceOne, create, now)
	if first.Status != domain.StatusApplied || first.ServerSeq == nil || first.ServerSyncedAt == nil {
		t.Fatalf("first active reminder must apply: %#v", first)
	}
	retry := store.ApplyMutation(ctx, accountID, deviceOne, create, now.Add(time.Minute))
	if retry.Status != domain.StatusDuplicate || retry.ServerSeq == nil || retry.ServerSyncedAt == nil || *retry.ServerSeq != *first.ServerSeq || !retry.ServerSyncedAt.Equal(*first.ServerSyncedAt) {
		t.Fatalf("retry must preserve acknowledgment: %#v", retry)
	}
	conflict := domain.Mutation{MutationID: uuid.NewString(), EntityType: "reminder_config", Operation: "create", EntityID: uuid.NewString(), Payload: payload}
	rejected := store.ApplyMutation(ctx, accountID, deviceTwo, conflict, now)
	if rejected.Status != domain.StatusRejected || rejected.ErrorCode != domain.MutationErrorValidation || rejected.ServerSeq != nil {
		t.Fatalf("second active reminder must be rejected: %#v", rejected)
	}
	if again := store.ApplyMutation(ctx, accountID, deviceTwo, conflict, now); again.Status != domain.StatusRejected || again.ErrorCode != rejected.ErrorCode {
		t.Fatalf("rejected acknowledgment must be replayed: %#v", again)
	}
	updatedPayload := map[string]any{"vehicle_id": vehicleID, "part_type_id": partTypeID, "interval_km": float64(2000), "enabled": true}
	updated := store.ApplyMutation(ctx, accountID, deviceOne, domain.Mutation{
		MutationID: uuid.NewString(), EntityType: "reminder_config", Operation: "update", EntityID: reminderID, Payload: updatedPayload,
	}, now.Add(time.Minute))
	if updated.Status != domain.StatusApplied || updated.ServerSeq == nil || *updated.ServerSeq != *first.ServerSeq+1 {
		t.Fatalf("update of same reminder must apply without sequence gap: %#v", updated)
	}
	page, err := store.Pull(ctx, accountID, *first.ServerSeq, 10, nil)
	if err != nil || len(page.Changes) != 1 || page.Changes[0].Payload["interval_km"] != float64(2000) {
		t.Fatalf("update must appear once in feed: page=%#v err=%v", page, err)
	}
}
