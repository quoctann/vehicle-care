package postgres_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/quoctann/vehicle-care/server/internal/domain"
)

// TestApplyMutationsDeduplicatesAndDetectsConflict asserts dedupe-by-mutation
// and LWW-conflict detection. It uses a real vehicle-typed uuid entity id
// since the vehicles table enforces a uuid primary key.
func TestApplyMutationsDeduplicatesAndDetectsConflict(t *testing.T) {
	t.Parallel()
	store, _ := newTestStore(t)
	ctx := context.Background()
	accountID := newAccount(t, store)
	vehicleID := uuid.NewString()
	baseTime := time.Date(2026, 9, 17, 10, 0, 0, 0, time.UTC)

	first := domain.Mutation{MutationID: "mutation-1", EntityType: "vehicle", Operation: "create", EntityID: vehicleID, Payload: map[string]any{"name": "First"}}

	firstResult := store.ApplyMutations(ctx, accountID, "device-1", []domain.Mutation{first}, baseTime)[0]
	duplicate := store.ApplyMutations(ctx, accountID, "device-1", []domain.Mutation{first}, baseTime.Add(time.Minute))[0]
	staleSeq := int64(0)
	conflict := store.ApplyMutations(ctx, accountID, "device-2", []domain.Mutation{{
		MutationID: "mutation-2", EntityType: "vehicle", Operation: "update", EntityID: vehicleID,
		Payload: map[string]any{"name": "Second"}, BaseServerSeq: &staleSeq,
	}}, baseTime.Add(2*time.Minute))[0]

	if firstResult.Status != "applied" || firstResult.ServerSeq == nil || *firstResult.ServerSeq != 1 {
		t.Fatalf("unexpected first result: %#v", firstResult)
	}
	if duplicate.Status != "duplicate" || duplicate.ServerSeq == nil || *duplicate.ServerSeq != 1 || !duplicate.ReceivedAtServer.Equal(*firstResult.ReceivedAtServer) {
		t.Fatalf("duplicate did not preserve original acknowledgment: %#v", duplicate)
	}
	if conflict.Status != "conflict_resolved" || conflict.ServerSeq == nil || *conflict.ServerSeq != 2 || conflict.ServerSnapshot["name"] != "Second" {
		t.Fatalf("unexpected conflict result: %#v", conflict)
	}
}

// TestAppendOnlyDuplicateReturnsOriginalAcknowledgment covers the
// append-only dedupe path (odometer_log/fuel_log/service_log): resubmitting
// the same entity id under a *different* mutation_id (e.g. after a client
// retried with a fresh idempotency key by mistake, or two devices raced to
// create the same locally-generated id) must still return "duplicate" with
// the original server_seq, never a second change_feed row.
func TestAppendOnlyDuplicateReturnsOriginalAcknowledgment(t *testing.T) {
	t.Parallel()
	store, _ := newTestStore(t)
	ctx := context.Background()
	accountID := newAccount(t, store)
	vehicleID := createVehicle(t, store, accountID, "device-1")
	now := time.Date(2026, 9, 17, 10, 0, 0, 0, time.UTC)
	logID := uuid.NewString()
	payload := map[string]any{"vehicle_id": vehicleID, "odometer_km": float64(100), "recorded_at": now.Format(time.RFC3339), "source": "manual"}

	first := store.ApplyMutations(ctx, accountID, "device-1", []domain.Mutation{{
		MutationID: "mutation-1", EntityType: "odometer_log", Operation: "create", EntityID: logID, Payload: payload,
	}}, now)[0]
	second := store.ApplyMutations(ctx, accountID, "device-2", []domain.Mutation{{
		MutationID: "mutation-2", EntityType: "odometer_log", Operation: "create", EntityID: logID, Payload: payload,
	}}, now.Add(time.Minute))[0]

	if first.Status != "applied" || first.ServerSeq == nil {
		t.Fatalf("unexpected first result: %#v", first)
	}
	if second.Status != "duplicate" || second.ServerSeq == nil || *second.ServerSeq != *first.ServerSeq {
		t.Fatalf("second write with different mutation_id was not treated as duplicate: %#v", second)
	}
}

// TestReminderScopeIsUniqueAcrossConcurrentDevices exercises the real
// PostgreSQL race: two goroutines each open their own transaction (via the
// shared Store's connection pool) and race to create the first active
// reminder for the same (vehicle_id, part_type_id) scope.
func TestReminderScopeIsUniqueAcrossConcurrentDevices(t *testing.T) {
	t.Parallel()
	store, _ := newTestStore(t)
	ctx := context.Background()
	accountID := newAccount(t, store)
	vehicleID := createVehicle(t, store, accountID, "device-1")
	partTypes := seedPartTypes(t, store, accountID)
	partTypeID := partTypes["engine_oil"]
	now := time.Date(2026, 9, 17, 10, 0, 0, 0, time.UTC)

	results := make(chan domain.MutationResult, 2)
	for index := 1; index <= 2; index++ {
		index := index
		go func() {
			result := store.ApplyMutations(ctx, accountID, "device-"+uuid.NewString(), []domain.Mutation{{
				MutationID: "mutation-" + uuid.NewString(), EntityType: "reminder_config", Operation: "create",
				EntityID: uuid.NewString(), Payload: map[string]any{
					"vehicle_id": vehicleID, "part_type_id": partTypeID, "interval_km": float64(3000 * index), "enabled": true,
				},
			}}, now)[0]
			results <- result
		}()
	}

	statusCount := map[string]int{}
	for range 2 {
		statusCount[(<-results).Status]++
	}
	if statusCount["applied"] != 1 || statusCount["rejected"] != 1 {
		t.Fatalf("expected one applied and one rejected result, got %v", statusCount)
	}
}

// TestApplyMutationsCrossAccountIsolation asserts that identical entity ids
// in two different accounts never collide: neither EntityExists nor
// ApplyMutations should see or be blocked by the other account's row.
func TestApplyMutationsCrossAccountIsolation(t *testing.T) {
	t.Parallel()
	store, _ := newTestStore(t)
	ctx := context.Background()
	accountA := newAccount(t, store)
	accountB := newAccount(t, store)
	sharedVehicleID := uuid.NewString()
	now := time.Date(2026, 9, 17, 10, 0, 0, 0, time.UTC)

	resultA := store.ApplyMutations(ctx, accountA, "device-1", []domain.Mutation{{
		MutationID: "mutation-a", EntityType: "vehicle", Operation: "create", EntityID: sharedVehicleID, Payload: map[string]any{"name": "Account A vehicle"},
	}}, now)[0]
	resultB := store.ApplyMutations(ctx, accountB, "device-1", []domain.Mutation{{
		MutationID: "mutation-b", EntityType: "vehicle", Operation: "create", EntityID: sharedVehicleID, Payload: map[string]any{"name": "Account B vehicle"},
	}}, now)[0]

	if resultA.Status != "applied" || resultB.Status != "applied" {
		t.Fatalf("same entity id in two accounts should both apply independently: a=%#v b=%#v", resultA, resultB)
	}
	if !store.EntityExists(ctx, accountA, "vehicle", sharedVehicleID) || !store.EntityExists(ctx, accountB, "vehicle", sharedVehicleID) {
		t.Fatalf("EntityExists should see each account's own row")
	}
	if store.EntityExists(ctx, accountA, "vehicle", uuid.NewString()) {
		t.Fatalf("EntityExists leaked a match for an id that was never created")
	}

	pageA, err := store.Pull(ctx, accountA, 0, 10, "", now)
	if err != nil {
		t.Fatalf("pull account a: %v", err)
	}
	if len(pageA.Changes) != 1 || pageA.Changes[0].Payload["name"] != "Account A vehicle" {
		t.Fatalf("account a pull leaked or missed data: %#v", pageA)
	}
}

// TestApplyMutationsStressSequenceIsGaplessAndUnique hammers ApplyMutations
// from many goroutines on one account and asserts server_seq allocation
// never gaps or duplicates: every mutation here uses a fresh entity id, so
// all of them are genuinely new writes (never a dedupe/duplicate path).
func TestApplyMutationsStressSequenceIsGaplessAndUnique(t *testing.T) {
	t.Parallel()
	store, _ := newTestStore(t)
	ctx := context.Background()
	accountID := newAccount(t, store)
	vehicleID := createVehicle(t, store, accountID, "device-1") // consumes seq 1
	now := time.Date(2026, 9, 17, 10, 0, 0, 0, time.UTC)

	const goroutines = 8
	const perGoroutine = 10
	total := goroutines * perGoroutine
	type outcome struct {
		seq int64
		err error
	}
	outcomes := make(chan outcome, total)

	for g := 0; g < goroutines; g++ {
		go func(g int) {
			for m := 0; m < perGoroutine; m++ {
				results := store.ApplyMutations(ctx, accountID, "device-1", []domain.Mutation{{
					MutationID: uuid.NewString(), EntityType: "odometer_log", Operation: "create", EntityID: uuid.NewString(),
					Payload: map[string]any{"vehicle_id": vehicleID, "odometer_km": float64(m), "recorded_at": now.Format(time.RFC3339), "source": "manual"},
				}}, now)
				result := results[0]
				if result.Status != "applied" || result.ServerSeq == nil {
					outcomes <- outcome{err: fmt.Errorf("goroutine %d mutation %d: unexpected result %#v", g, m, result)}
					continue
				}
				outcomes <- outcome{seq: *result.ServerSeq}
			}
		}(g)
	}

	seen := make(map[int64]bool, total)
	var maxSeq int64
	for i := 0; i < total; i++ {
		result := <-outcomes
		if result.err != nil {
			t.Fatalf("stress mutation failed: %v", result.err)
		}
		if seen[result.seq] {
			t.Fatalf("server_seq %d allocated twice", result.seq)
		}
		seen[result.seq] = true
		if result.seq > maxSeq {
			maxSeq = result.seq
		}
	}
	// Vehicle creation consumed seq 1, so the append-only writes must
	// occupy exactly 2..total+1 with no gaps.
	if maxSeq != int64(total)+1 {
		t.Fatalf("expected max server_seq %d, got %d", total+1, maxSeq)
	}
	if len(seen) != total {
		t.Fatalf("expected %d unique server_seq values, got %d", total, len(seen))
	}
}

func TestPartTypeMutationIsWrittenToChangeFeed(t *testing.T) {
	t.Parallel()
	store, _ := newTestStore(t)
	ctx := context.Background()
	accountID := newAccount(t, store)
	partTypes := seedPartTypes(t, store, accountID)
	partTypeID := partTypes["engine_oil"]
	now := time.Date(2026, 9, 22, 10, 0, 0, 0, time.UTC)

	result := store.ApplyMutations(ctx, accountID, "device-1", []domain.Mutation{{
		MutationID: "part-type-update",
		EntityType: "part_type",
		Operation:  "update",
		EntityID:   partTypeID,
		Payload: map[string]any{
			"code":          "engine_oil",
			"name_vi":       "Dầu máy",
			"display_order": float64(1),
			"active":        false,
			"seed_version":  "1",
		},
	}}, now)[0]
	if result.Status != "applied" || result.ServerSeq == nil {
		t.Fatalf("unexpected part type result: %#v", result)
	}

	page, err := store.Pull(ctx, accountID, 0, 10, "", now)
	if err != nil {
		t.Fatalf("pull part type change: %v", err)
	}
	if len(page.Changes) != 1 || page.Changes[0].EntityType != "part_type" || page.Changes[0].Payload["name_vi"] != "Dầu máy" {
		t.Fatalf("part type change missing from feed: %#v", page.Changes)
	}
}

func TestPartTypeUpsertCannotCrossAccountBoundary(t *testing.T) {
	t.Parallel()
	store, _ := newTestStore(t)
	ctx := context.Background()
	accountA := newAccount(t, store)
	accountB := newAccount(t, store)
	entityID := uuid.NewString()
	now := time.Date(2026, 9, 22, 10, 0, 0, 0, time.UTC)
	payload := map[string]any{
		"code":          entityID,
		"name_vi":       "Hạng mục A",
		"display_order": float64(999),
		"active":        true,
		"seed_version":  "0",
	}

	first := store.ApplyMutations(ctx, accountA, "device-a", []domain.Mutation{{
		MutationID: "part-type-a", EntityType: "part_type", Operation: "create", EntityID: entityID, Payload: payload,
	}}, now)[0]
	second := store.ApplyMutations(ctx, accountB, "device-b", []domain.Mutation{{
		MutationID: "part-type-b", EntityType: "part_type", Operation: "create", EntityID: entityID, Payload: payload,
	}}, now)[0]

	if first.Status != "applied" || second.Status != "retryable_error" {
		t.Fatalf("unexpected cross-account results: first=%#v second=%#v", first, second)
	}
	if !store.EntityExists(ctx, accountA, "part_type", entityID) || store.EntityExists(ctx, accountB, "part_type", entityID) {
		t.Fatalf("part type ownership changed across account boundary")
	}
}

func TestServiceLogUpdateChangesPartType(t *testing.T) {
	t.Parallel()
	store, _ := newTestStore(t)
	ctx := context.Background()
	accountID := newAccount(t, store)
	vehicleID := createVehicle(t, store, accountID, "device-1")
	partTypes := seedPartTypes(t, store, accountID)
	firstPartTypeID := partTypes["engine_oil"]
	secondPartTypeID := partTypes["battery"]
	now := time.Date(2026, 9, 22, 10, 0, 0, 0, time.UTC)
	serviceID := uuid.NewString()
	payload := map[string]any{
		"vehicle_id": vehicleID, "part_type_id": firstPartTypeID,
		"serviced_at": now.Format(time.RFC3339), "odometer_km_snapshot": float64(1000),
	}

	created := store.ApplyMutations(ctx, accountID, "device-1", []domain.Mutation{{
		MutationID: "service-create", EntityType: "service_log", Operation: "create", EntityID: serviceID, Payload: payload,
	}}, now)[0]
	if created.Status != "applied" || created.ServerSeq == nil {
		t.Fatalf("unexpected create result: %#v", created)
	}

	payload["part_type_id"] = secondPartTypeID
	updated := store.ApplyMutations(ctx, accountID, "device-1", []domain.Mutation{{
		MutationID: "service-update", EntityType: "service_log", Operation: "update", EntityID: serviceID,
		Payload: payload, BaseServerSeq: created.ServerSeq,
	}}, now.Add(time.Minute))[0]
	if updated.Status != "applied" {
		t.Fatalf("unexpected update result: %#v", updated)
	}
	if !store.EntityReferencesPartType(ctx, accountID, "service_log", serviceID, secondPartTypeID) {
		t.Fatalf("service log did not persist the changed part type")
	}
}
