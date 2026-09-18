package memory

import (
	"context"
	"testing"
	"time"

	"github.com/quoctann/vehicle-care/server/internal/domain"
)

func TestApplyMutationsDeduplicatesAndDetectsConflict(t *testing.T) {
	t.Parallel()
	store := NewStore()
	ctx := context.Background()
	baseTime := time.Date(2026, 9, 17, 10, 0, 0, 0, time.UTC)
	first := domain.Mutation{MutationID: "mutation-1", EntityType: "vehicle", Operation: "create", EntityID: "vehicle-1", Payload: map[string]any{"name": "First"}}

	firstResult := store.ApplyMutations(ctx, "account-1", "device-1", []domain.Mutation{first}, baseTime)[0]
	duplicate := store.ApplyMutations(ctx, "account-1", "device-1", []domain.Mutation{first}, baseTime.Add(time.Minute))[0]
	staleSeq := int64(0)
	conflict := store.ApplyMutations(ctx, "account-1", "device-2", []domain.Mutation{{
		MutationID: "mutation-2", EntityType: "vehicle", Operation: "update", EntityID: "vehicle-1",
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

func TestPullKeepsStableWatermark(t *testing.T) {
	t.Parallel()
	store := NewStore()
	ctx := context.Background()
	now := time.Date(2026, 9, 17, 10, 0, 0, 0, time.UTC)
	for index := 1; index <= 2; index++ {
		store.ApplyMutations(ctx, "account-1", "device-1", []domain.Mutation{{
			MutationID: "mutation-" + string(rune('0'+index)), EntityType: "odometer_log", Operation: "create",
			EntityID: "log-" + string(rune('0'+index)), Payload: map[string]any{"odometer_km": index * 100},
		}}, now)
	}

	first, err := store.Pull(ctx, "account-1", 0, 1, "", now)
	if err != nil {
		t.Fatalf("first pull: %v", err)
	}
	store.ApplyMutations(ctx, "account-1", "device-1", []domain.Mutation{{
		MutationID: "mutation-3", EntityType: "odometer_log", Operation: "create", EntityID: "log-3", Payload: map[string]any{"odometer_km": 300},
	}}, now)
	second, err := store.Pull(ctx, "account-1", first.NextCursor, 10, first.Watermark, now)
	if err != nil {
		t.Fatalf("second pull: %v", err)
	}

	if !first.HasMore || len(first.Changes) != 1 {
		t.Fatalf("unexpected first page: %#v", first)
	}
	if second.Watermark != first.Watermark || second.HasMore || len(second.Changes) != 1 || second.Changes[0].ServerSeq != 2 {
		t.Fatalf("new change escaped stable watermark: %#v", second)
	}
	retriedFinal, err := store.Pull(ctx, "account-1", first.NextCursor, 10, first.Watermark, now.Add(time.Minute))
	if err != nil || len(retriedFinal.Changes) != 1 || retriedFinal.Changes[0].ServerSeq != 2 {
		t.Fatalf("final page was not retryable: page=%#v err=%v", retriedFinal, err)
	}
	third, err := store.Pull(ctx, "account-1", second.NextCursor, 10, "", now)
	if err != nil || len(third.Changes) != 1 || third.Changes[0].ServerSeq != 3 {
		t.Fatalf("next pull did not include deferred change: page=%#v err=%v", third, err)
	}
}

func TestTokensExpireAndNewTokenInvalidatesPrevious(t *testing.T) {
	t.Parallel()
	store := NewStore()
	ctx := context.Background()
	now := time.Date(2026, 9, 17, 10, 0, 0, 0, time.UTC)
	if err := store.CreateToken(ctx, "reset", "old-token", "account-1", now.Add(time.Hour)); err != nil {
		t.Fatalf("create old token: %v", err)
	}
	if err := store.CreateToken(ctx, "reset", "new-token", "account-1", now.Add(time.Hour)); err != nil {
		t.Fatalf("create new token: %v", err)
	}
	if _, ok, err := store.ConsumeToken(ctx, "reset", "old-token", now); ok || err != nil {
		t.Fatalf("superseded token remained valid: ok=%v err=%v", ok, err)
	}
	if accountID, ok, err := store.ConsumeToken(ctx, "reset", "new-token", now); !ok || err != nil || accountID != "account-1" {
		t.Fatalf("new token was not valid: account=%q ok=%v err=%v", accountID, ok, err)
	}
	if err := store.CreateToken(ctx, "verification", "expired", "account-1", now); err != nil {
		t.Fatalf("create expired token: %v", err)
	}
	if _, ok, err := store.ConsumeToken(ctx, "verification", "expired", now); ok || err != nil {
		t.Fatalf("expired token remained valid: ok=%v err=%v", ok, err)
	}
}

func TestReminderScopeIsUniqueAcrossConcurrentDevices(t *testing.T) {
	t.Parallel()
	store := NewStore()
	ctx := context.Background()
	now := time.Date(2026, 9, 17, 10, 0, 0, 0, time.UTC)
	results := make(chan domain.MutationResult, 2)
	for index := 1; index <= 2; index++ {
		index := index
		go func() {
			result := store.ApplyMutations(ctx, "account-1", "device-"+string(rune('0'+index)), []domain.Mutation{{
				MutationID: "mutation-" + string(rune('0'+index)), EntityType: "reminder_config", Operation: "create",
				EntityID: "reminder-" + string(rune('0'+index)), Payload: map[string]any{
					"vehicle_id": "vehicle-1", "part_type_id": "engine_oil", "deleted_at": nil,
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
