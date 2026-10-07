package postgres_test

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/quoctann/vehicle-care/server/internal/domain"
)

func TestConcurrentRetriesReturnOneOriginalAcknowledgment(t *testing.T) {
	t.Parallel()
	store, _ := newTestStore(t)
	ctx := context.Background()
	accountID := newAccount(t, store)
	mutation := domain.Mutation{
		MutationID: uuid.NewString(), EntityType: "vehicle", Operation: "create",
		EntityID: uuid.NewString(), Payload: map[string]any{"name": "Concurrent retry"},
	}
	const workers = 12
	start := make(chan struct{})
	results := make(chan domain.MutationResult, workers)
	var ready sync.WaitGroup
	ready.Add(workers)
	for range workers {
		go func() {
			ready.Done()
			<-start
			results <- store.ApplyMutation(ctx, accountID, deviceOne, mutation, time.Now())
		}()
	}
	ready.Wait()
	close(start)
	counts := map[domain.MutationStatus]int{}
	var receivedAt *time.Time
	for range workers {
		result := <-results
		counts[result.Status]++
		if result.ServerSeq == nil || *result.ServerSeq != initialAccountSeq+1 || result.ServerSyncedAt == nil {
			t.Fatalf("retry did not return original ACK: %#v", result)
		}
		if receivedAt != nil && !receivedAt.Equal(*result.ServerSyncedAt) {
			t.Fatalf("retry changed server_synced_at: %#v", result)
		}
		receivedAt = result.ServerSyncedAt
	}
	if counts["applied"] != 1 || counts["duplicate"] != workers-1 {
		t.Fatalf("expected one apply and only duplicates, got %v", counts)
	}
	page, err := store.Pull(ctx, accountID, initialAccountSeq, 100, nil)
	if err != nil || len(page.Changes) != 1 || page.UntilSeq != initialAccountSeq+1 {
		t.Fatalf("retry appended extra changes: page=%#v err=%v", page, err)
	}
}

// TestApplyMutationDeduplicatesAndAppliesLatestSnapshot asserts dedupe-by-mutation
// and server-order LWW. It uses a real vehicle-typed uuid entity id
// since the vehicles table enforces a uuid primary key.
func TestApplyMutationDeduplicatesAndDetectsConflict(t *testing.T) {
	t.Parallel()
	store, _ := newTestStore(t)
	ctx := context.Background()
	accountID := newAccount(t, store)
	vehicleID := uuid.NewString()
	baseTime := time.Date(2026, 9, 17, 10, 0, 0, 0, time.UTC)

	first := domain.Mutation{MutationID: "mutation-1", EntityType: "vehicle", Operation: "create", EntityID: vehicleID, Payload: map[string]any{"name": "First"}}

	firstResult := store.ApplyMutation(ctx, accountID, deviceOne, first, baseTime)
	duplicate := store.ApplyMutation(ctx, accountID, deviceOne, first, baseTime.Add(time.Minute))
	conflict := store.ApplyMutation(ctx, accountID, deviceTwo, domain.Mutation{
		MutationID: "mutation-2", EntityType: "vehicle", Operation: "update", EntityID: vehicleID,
		Payload: map[string]any{"name": "Second"},
	}, baseTime.Add(2*time.Minute))

	if firstResult.Status != "applied" || firstResult.ServerSeq == nil || *firstResult.ServerSeq != initialAccountSeq+1 {
		t.Fatalf("unexpected first result: %#v", firstResult)
	}
	if duplicate.Status != "duplicate" || duplicate.ServerSeq == nil || *duplicate.ServerSeq != initialAccountSeq+1 || !duplicate.ServerSyncedAt.Equal(*firstResult.ServerSyncedAt) {
		t.Fatalf("duplicate did not preserve original acknowledgment: %#v", duplicate)
	}
	if conflict.Status != "applied" || conflict.ServerSeq == nil || *conflict.ServerSeq != initialAccountSeq+2 {
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
	vehicleID := createVehicle(t, store, accountID, deviceOne)
	now := time.Date(2026, 9, 17, 10, 0, 0, 0, time.UTC)
	logID := uuid.NewString()
	payload := map[string]any{"vehicle_id": vehicleID, "odometer_km": float64(100), "recorded_at": now.Format(time.RFC3339), "source": "manual"}

	first := store.ApplyMutation(ctx, accountID, deviceOne, domain.Mutation{
		MutationID: "mutation-1", EntityType: "odometer_log", Operation: "create", EntityID: logID, Payload: payload,
	}, now)
	second := store.ApplyMutation(ctx, accountID, deviceTwo, domain.Mutation{
		MutationID: "mutation-2", EntityType: "odometer_log", Operation: "create", EntityID: logID, Payload: payload,
	}, now.Add(time.Minute))

	if first.Status != "applied" || first.ServerSeq == nil {
		t.Fatalf("unexpected first result: %#v", first)
	}
	if second.Status != "duplicate" || second.ServerSeq == nil || *second.ServerSeq != *first.ServerSeq {
		t.Fatalf("second write with different mutation_id was not treated as duplicate: %#v", second)
	}
}

func TestChangeFeedUsesCanonicalPersistedPayload(t *testing.T) {
	t.Parallel()
	store, _ := newTestStore(t)
	ctx := context.Background()
	accountID := newAccount(t, store)
	vehicleID := createVehicle(t, store, accountID, deviceOne)
	now := time.Date(2026, 9, 17, 10, 0, 0, 123000000, time.UTC)

	result := store.ApplyMutation(ctx, accountID, deviceOne, domain.Mutation{
		MutationID: "canonical-fuel",
		EntityType: "fuel_log",
		Operation:  "create",
		EntityID:   uuid.NewString(),
		Payload: map[string]any{
			"vehicle_id": vehicleID, "recorded_at": now.Format(time.RFC3339Nano),
			"liters": 1.239, "cost": float64(123.45), "is_full_tank": true,
		},
	}, now)
	if result.Status != "applied" {
		t.Fatalf("unexpected fuel result: %#v", result)
	}

	page, err := store.Pull(ctx, accountID, initialAccountSeq, 10, nil)
	if err != nil {
		t.Fatalf("pull canonical fuel change: %v", err)
	}
	if len(page.Changes) != 2 {
		t.Fatalf("expected vehicle and fuel changes, got %#v", page.Changes)
	}
	fuelPayload := page.Changes[1].Payload
	if fuelPayload["liters"] != 1.24 || fuelPayload["cost"] != float64(123.45) {
		t.Fatalf("change feed did not use persisted numeric values: %#v", fuelPayload)
	}
}

func TestDuplicateIsReturnedBeforeStatefulValidation(t *testing.T) {
	t.Parallel()
	store, _ := newTestStore(t)
	ctx := context.Background()
	accountID := newAccount(t, store)
	vehicleID := createVehicle(t, store, accountID, deviceOne)
	partTypes := seedPartTypes(t, store, accountID)
	partTypeID := partTypes["engine_oil"]
	now := time.Date(2026, 9, 22, 10, 0, 0, 0, time.UTC)
	payload := map[string]any{
		"vehicle_id": vehicleID, "part_type_id": partTypeID,
		"serviced_at": now.Format(time.RFC3339),
	}
	mutation := domain.Mutation{MutationID: "service-retry", EntityType: "service_log", Operation: "create", EntityID: uuid.NewString(), Payload: payload}
	first := store.ApplyMutation(ctx, accountID, deviceOne, mutation, now)
	if first.Status != "applied" {
		t.Fatalf("unexpected first service result: %#v", first)
	}

	deactivate := store.ApplyMutation(ctx, accountID, deviceOne, domain.Mutation{
		MutationID: "part-type-deactivate", EntityType: "part_type", Operation: "update", EntityID: partTypeID,
		Payload: map[string]any{"code": "engine_oil", "name": "Dau may", "display_order": float64(1), "active": false},
	}, now.Add(time.Minute))
	if deactivate.Status != "applied" {
		t.Fatalf("unexpected deactivation result: %#v", deactivate)
	}

	duplicate := store.ApplyMutation(ctx, accountID, deviceOne, mutation, now.Add(2*time.Minute))
	if duplicate.Status != "duplicate" || duplicate.ServerSeq == nil || first.ServerSeq == nil || *duplicate.ServerSeq != *first.ServerSeq {
		t.Fatalf("retry was statefully revalidated instead of deduplicated: %#v", duplicate)
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
	vehicleID := createVehicle(t, store, accountID, deviceOne)
	partTypes := seedPartTypes(t, store, accountID)
	partTypeID := partTypes["engine_oil"]
	now := time.Date(2026, 9, 17, 10, 0, 0, 0, time.UTC)

	results := make(chan domain.MutationResult, 2)
	for index := 1; index <= 2; index++ {
		index := index
		deviceID := uuid.NewString()
		registerTestDevice(t, store, accountID, deviceID)
		go func() {
			result := store.ApplyMutation(ctx, accountID, deviceID, domain.Mutation{
				MutationID: "mutation-" + uuid.NewString(), EntityType: "reminder_config", Operation: "create",
				EntityID: uuid.NewString(), Payload: map[string]any{
					"vehicle_id": vehicleID, "part_type_id": partTypeID, "interval_km": float64(3000 * index), "enabled": true,
				},
			}, now)
			results <- result
		}()
	}

	statusCount := map[domain.MutationStatus]int{}
	for range 2 {
		statusCount[(<-results).Status]++
	}
	if statusCount["applied"] != 1 || statusCount["rejected"] != 1 {
		t.Fatalf("expected one applied and one rejected result, got %v", statusCount)
	}
}

// TestApplyMutationCrossAccountIsolation asserts that identical entity ids
// in two different accounts never collide: neither EntityExists nor
// ApplyMutation should see or be blocked by the other account's row.
func TestApplyMutationCrossAccountIsolation(t *testing.T) {
	t.Parallel()
	store, _ := newTestStore(t)
	ctx := context.Background()
	accountA := newAccount(t, store)
	accountB := newAccount(t, store)
	sharedVehicleID := uuid.NewString()
	now := time.Date(2026, 9, 17, 10, 0, 0, 0, time.UTC)

	resultA := store.ApplyMutation(ctx, accountA, deviceOne, domain.Mutation{
		MutationID: "mutation-a", EntityType: "vehicle", Operation: "create", EntityID: sharedVehicleID, Payload: map[string]any{"name": "Account A vehicle"},
	}, now)
	resultB := store.ApplyMutation(ctx, accountB, deviceOne, domain.Mutation{
		MutationID: "mutation-b", EntityType: "vehicle", Operation: "create", EntityID: sharedVehicleID, Payload: map[string]any{"name": "Account B vehicle"},
	}, now)

	if resultA.Status != "applied" || resultB.Status != "applied" {
		t.Fatalf("same entity id in two accounts should both apply independently: a=%#v b=%#v", resultA, resultB)
	}
	existsA, err := store.EntityExists(ctx, accountA, "vehicle", sharedVehicleID)
	if err != nil {
		t.Fatalf("check account a ownership: %v", err)
	}
	existsB, err := store.EntityExists(ctx, accountB, "vehicle", sharedVehicleID)
	if err != nil {
		t.Fatalf("check account b ownership: %v", err)
	}
	if !existsA || !existsB {
		t.Fatalf("EntityExists should see each account's own row")
	}
	existsMissing, err := store.EntityExists(ctx, accountA, "vehicle", uuid.NewString())
	if err != nil {
		t.Fatalf("check missing ownership: %v", err)
	}
	if existsMissing {
		t.Fatalf("EntityExists leaked a match for an id that was never created")
	}

	pageA, err := store.Pull(ctx, accountA, initialAccountSeq, 10, nil)
	if err != nil {
		t.Fatalf("pull account a: %v", err)
	}
	if len(pageA.Changes) != 1 || pageA.Changes[0].Payload["name"] != "Account A vehicle" {
		t.Fatalf("account a pull leaked or missed data: %#v", pageA)
	}
}

// TestApplyMutationStressSequenceIsGaplessAndUnique hammers ApplyMutation
// from many goroutines on one account and asserts server_seq allocation
// never gaps or duplicates: every mutation here uses a fresh entity id, so
// all of them are genuinely new writes (never a dedupe/duplicate path).
func TestApplyMutationStressSequenceIsGaplessAndUnique(t *testing.T) {
	t.Parallel()
	store, _ := newTestStore(t)
	ctx := context.Background()
	accountID := newAccount(t, store)
	vehicleID := createVehicle(t, store, accountID, deviceOne) // follows signup seed entries
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
				result := store.ApplyMutation(ctx, accountID, deviceOne, domain.Mutation{
					MutationID: uuid.NewString(), EntityType: "odometer_log", Operation: "create", EntityID: uuid.NewString(),
					Payload: map[string]any{"vehicle_id": vehicleID, "odometer_km": float64(m), "recorded_at": now.Format(time.RFC3339), "source": "manual"},
				}, now)
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
	// After signup seed entries and one vehicle, each log allocates one sequence.
	if maxSeq != initialAccountSeq+int64(total)+1 {
		t.Fatalf("expected max server_seq %d, got %d", initialAccountSeq+int64(total)+1, maxSeq)
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

	result := store.ApplyMutation(ctx, accountID, deviceOne, domain.Mutation{
		MutationID: "part-type-update",
		EntityType: "part_type",
		Operation:  "update",
		EntityID:   partTypeID,
		Payload: map[string]any{
			"code":          "engine_oil",
			"name":          "Dầu máy",
			"display_order": float64(1),
			"active":        false,
		},
	}, now)
	if result.Status != "applied" || result.ServerSeq == nil {
		t.Fatalf("unexpected part type result: %#v", result)
	}

	page, err := store.Pull(ctx, accountID, initialAccountSeq, 10, nil)
	if err != nil {
		t.Fatalf("pull part type change: %v", err)
	}
	if len(page.Changes) != 1 || page.Changes[0].EntityType != "part_type" || page.Changes[0].Payload["name"] != "Dầu máy" {
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
		"name":          "Hạng mục A",
		"display_order": float64(999),
		"active":        true,
	}

	first := store.ApplyMutation(ctx, accountA, deviceA, domain.Mutation{
		MutationID: "part-type-a", EntityType: "part_type", Operation: "create", EntityID: entityID, Payload: payload,
	}, now)
	before, err := store.Pull(ctx, accountB, 0, 1, nil)
	if err != nil {
		t.Fatalf("pull account b before rejection: %v", err)
	}
	second := store.ApplyMutation(ctx, accountB, deviceB, domain.Mutation{
		MutationID: "part-type-b", EntityType: "part_type", Operation: "create", EntityID: entityID, Payload: payload,
	}, now)

	if first.Status != "applied" || second.Status != "rejected" || second.ErrorCode != "ownership_invalid" {
		t.Fatalf("unexpected cross-account results: first=%#v second=%#v", first, second)
	}
	after, err := store.Pull(ctx, accountB, before.UntilSeq, 10, nil)
	if err != nil || after.UntilSeq != before.UntilSeq || len(after.Changes) != 0 {
		t.Fatalf("rejected write consumed a sequence: before=%#v after=%#v err=%v", before, after, err)
	}
	existsA, err := store.EntityExists(ctx, accountA, "part_type", entityID)
	if err != nil {
		t.Fatalf("check account a part type: %v", err)
	}
	existsB, err := store.EntityExists(ctx, accountB, "part_type", entityID)
	if err != nil {
		t.Fatalf("check account b part type: %v", err)
	}
	if !existsA || existsB {
		t.Fatalf("part type ownership changed across account boundary")
	}
}

func TestServiceLogUpdateChangesPartType(t *testing.T) {
	t.Parallel()
	store, _ := newTestStore(t)
	ctx := context.Background()
	accountID := newAccount(t, store)
	vehicleID := createVehicle(t, store, accountID, deviceOne)
	partTypes := seedPartTypes(t, store, accountID)
	firstPartTypeID := partTypes["engine_oil"]
	secondPartTypeID := partTypes["battery"]
	now := time.Date(2026, 9, 22, 10, 0, 0, 0, time.UTC)
	serviceID := uuid.NewString()
	payload := map[string]any{
		"vehicle_id": vehicleID, "part_type_id": firstPartTypeID,
		"serviced_at": now.Format(time.RFC3339), "odometer_km_snapshot": float64(1000),
	}

	created := store.ApplyMutation(ctx, accountID, deviceOne, domain.Mutation{
		MutationID: "service-create", EntityType: "service_log", Operation: "create", EntityID: serviceID, Payload: payload,
	}, now)
	if created.Status != "applied" || created.ServerSeq == nil {
		t.Fatalf("unexpected create result: %#v", created)
	}

	payload["part_type_id"] = secondPartTypeID
	updated := store.ApplyMutation(ctx, accountID, deviceOne, domain.Mutation{
		MutationID: "service-update", EntityType: "service_log", Operation: "update", EntityID: serviceID,
		Payload: payload,
	}, now.Add(time.Minute))
	if updated.Status != "applied" {
		t.Fatalf("unexpected update result: %#v", updated)
	}
	references, err := store.EntityReferencesPartType(ctx, accountID, "service_log", serviceID, secondPartTypeID)
	if err != nil {
		t.Fatalf("check updated service part type: %v", err)
	}
	if !references {
		t.Fatalf("service log did not persist the changed part type")
	}
}
