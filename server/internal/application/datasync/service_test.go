package datasync

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/quoctann/vehicle-care/server/internal/domain"
)

type testDependencies struct {
	applied   []string
	result    func(domain.Mutation) domain.MutationResult
	pullErr   error
	nilResult bool
	nilPage   bool
	partTypes []*domain.PartType
}

func (d *testDependencies) DeviceRegistered(context.Context, string, string) (bool, error) {
	return true, nil
}

func (d *testDependencies) ApplyMutation(_ context.Context, _ string, _ string, mutation domain.Mutation, _ time.Time) *domain.MutationResult {
	d.applied = append(d.applied, mutation.MutationID)
	if d.nilResult {
		return nil
	}
	result := d.result(mutation)
	return &result
}

func (d *testDependencies) Pull(context.Context, string, int64, int, *int64) (*domain.PullPage, error) {
	if d.nilPage {
		return nil, nil
	}
	return &domain.PullPage{}, d.pullErr
}

func (d *testDependencies) ListPartTypes(context.Context, string) ([]*domain.PartType, error) {
	return d.partTypes, nil
}

func (d *testDependencies) Push(context.Context, string, string, []domain.Mutation) ([]domain.MutationResult, error) {
	return nil, nil
}

func validMutation(id string) domain.Mutation {
	mutationID := map[string]string{"first": "00000000-0000-4000-8000-000000000001", "second": "00000000-0000-4000-8000-000000000002", "third": "00000000-0000-4000-8000-000000000003", "retry": "00000000-0000-4000-8000-000000000004"}[id]
	return domain.Mutation{
		MutationID: mutationID,
		EntityType: "vehicle",
		Operation:  "create",
		EntityID:   uuid.NewString(),
		Payload:    map[string]any{"name": "Vehicle"},
	}
}

func TestPushStopsAtFirstTerminalResult(t *testing.T) {
	deps := &testDependencies{result: func(mutation domain.Mutation) domain.MutationResult {
		if mutation.MutationID == "00000000-0000-4000-8000-000000000002" {
			retryable := false
			return domain.MutationResult{MutationID: mutation.MutationID, Status: "rejected", Retryable: &retryable}
		}
		return domain.MutationResult{MutationID: mutation.MutationID, Status: "applied"}
	}}

	results, err := NewService(deps, 10, 10).Push(context.Background(), "account-1", "00000000-0000-4000-8000-000000000010", []domain.Mutation{
		validMutation("first"), validMutation("second"), validMutation("third"),
	})
	if err != nil {
		t.Fatalf("Push returned an error: %v", err)
	}
	if len(results) != 2 || results[1].Status != "rejected" {
		t.Fatalf("expected processed prefix ending in rejection, got %#v", results)
	}
	if len(deps.applied) != 2 || deps.applied[1] != "00000000-0000-4000-8000-000000000002" {
		t.Fatalf("push did not stop in FIFO order: %#v", deps.applied)
	}
}

func TestPushLeavesStatefulDedupeToStorage(t *testing.T) {
	deps := &testDependencies{result: func(mutation domain.Mutation) domain.MutationResult {
		return domain.MutationResult{MutationID: mutation.MutationID, Status: "duplicate"}
	}}
	results, err := NewService(deps, 10, 10).Push(context.Background(), "account-1", "00000000-0000-4000-8000-000000000010", []domain.Mutation{validMutation("retry")})
	if err != nil || len(results) != 1 || results[0].Status != "duplicate" {
		t.Fatalf("expected duplicate result without stateful validation, results=%#v err=%v", results, err)
	}
}

func TestPushRejectsUnsupportedEntityBeforeStorage(t *testing.T) {
	deps := &testDependencies{result: func(mutation domain.Mutation) domain.MutationResult {
		return domain.MutationResult{MutationID: mutation.MutationID, Status: "applied"}
	}}
	mutation := validMutation("first")
	mutation.EntityType = "unknown"
	results, err := NewService(deps, 10, 10).Push(context.Background(), "account-1", "00000000-0000-4000-8000-000000000010", []domain.Mutation{mutation})
	if err != nil || len(results) != 1 || results[0].Status != "rejected" || len(deps.applied) != 0 {
		t.Fatalf("unsupported type reached storage: results=%#v applied=%#v err=%v", results, deps.applied, err)
	}
}

func TestPullPropagatesDependencyErrors(t *testing.T) {
	want := errors.New("database unavailable")
	deps := &testDependencies{pullErr: want}
	_, err := NewService(deps, 10, 10).Pull(context.Background(), "account-1", 0, 10, nil)
	if !errors.Is(err, want) {
		t.Fatalf("expected pull error to propagate, got %v", err)
	}
}

func TestPushStopsSafelyWhenStorageReturnsNil(t *testing.T) {
	deps := &testDependencies{nilResult: true}
	results, err := NewService(deps, 10, 10).Push(context.Background(), "account-1", "00000000-0000-4000-8000-000000000010", []domain.Mutation{validMutation("first"), validMutation("second")})
	if err != nil || len(results) != 1 || results[0].Status != domain.StatusRetryableError || len(deps.applied) != 1 {
		t.Fatalf("expected one retryable result and stopped batch, results=%#v err=%v", results, err)
	}
}

func TestPullRejectsNilPage(t *testing.T) {
	_, err := NewService(&testDependencies{nilPage: true}, 10, 10).Pull(context.Background(), "account-1", 0, 10, nil)
	if err == nil {
		t.Fatal("expected an error for nil page")
	}
}

func TestListPartTypesPreservesValuesAndRejectsNilEntries(t *testing.T) {
	service := NewService(&testDependencies{partTypes: []*domain.PartType{{Name: "Oil"}}}, 10, 10)
	got, err := service.ListPartTypes(context.Background(), "account-1")
	if err != nil || len(got) != 1 || got[0].Name != "Oil" {
		t.Fatalf("unexpected part types: %#v, %v", got, err)
	}
	_, err = NewService(&testDependencies{partTypes: []*domain.PartType{nil}}, 10, 10).ListPartTypes(context.Background(), "account-1")
	if err == nil {
		t.Fatal("expected error for nil part type")
	}
}
