package datasync

import (
	"context"
	"testing"
	"time"

	"github.com/quoctann/vehicle-care/server/internal/domain"
)

type testDependencies struct {
	entities   map[string]bool
	active     map[string]bool
	references map[string]bool
	applied    int
}

func (d *testDependencies) DeviceRegistered(context.Context, string, string) bool { return true }
func (d *testDependencies) EntityExists(_ context.Context, accountID, entityType, entityID string) bool {
	return d.entities[accountID+":"+entityType+":"+entityID]
}
func (d *testDependencies) PartTypeActive(_ context.Context, accountID, partTypeID string) bool {
	return d.active[accountID+":"+partTypeID]
}
func (d *testDependencies) EntityReferencesPartType(_ context.Context, accountID, entityType, entityID, partTypeID string) bool {
	return d.references[accountID+":"+entityType+":"+entityID+":"+partTypeID]
}
func (d *testDependencies) ApplyMutations(_ context.Context, _ string, _ string, mutations []domain.Mutation, _ time.Time) []domain.MutationResult {
	d.applied++
	return []domain.MutationResult{{MutationID: mutations[0].MutationID, Status: "applied"}}
}
func (d *testDependencies) Pull(context.Context, string, int64, int, string, time.Time) (domain.PullPage, error) {
	return domain.PullPage{}, nil
}
func (d *testDependencies) ListPartTypes(context.Context, string) ([]domain.PartType, error) {
	return nil, nil
}

func TestPushRejectsPartTypeReferenceFromAnotherAccount(t *testing.T) {
	for _, entityType := range []string{"reminder_config", "service_log"} {
		t.Run(entityType, func(t *testing.T) {
			deps := &testDependencies{entities: map[string]bool{
				"account-1:vehicle:vehicle-1": true,
				"account-2:part_type:part-1":  true,
			}, active: map[string]bool{}, references: map[string]bool{}}
			service := NewService(deps, 10, 10)
			payload := map[string]any{
				"vehicle_id":   "vehicle-1",
				"part_type_id": "part-1",
			}
			if entityType == "reminder_config" {
				payload["interval_km"] = float64(5000)
				payload["enabled"] = true
			} else {
				payload["serviced_at"] = "2026-09-22T00:00:00Z"
			}

			results, err := service.Push(context.Background(), "account-1", "device-1", "1", []domain.Mutation{{
				MutationID: "mutation-1",
				EntityType: entityType,
				Operation:  "create",
				EntityID:   "entity-1",
				Payload:    payload,
			}})
			if err != nil {
				t.Fatalf("Push returned an error: %v", err)
			}
			if len(results) != 1 || results[0].Status != "rejected" || results[0].ErrorCode != "ownership_invalid" {
				t.Fatalf("expected ownership rejection, got %#v", results)
			}
			if deps.applied != 0 {
				t.Fatalf("rejected mutation reached storage")
			}
		})
	}
}

func TestPushRejectsInactivePartTypeForNewMaintenanceRecords(t *testing.T) {
	deps := &testDependencies{
		entities: map[string]bool{
			"account-1:vehicle:vehicle-1": true,
			"account-1:part_type:part-1":  true,
		},
		active:     map[string]bool{"account-1:part-1": false},
		references: map[string]bool{},
	}
	service := NewService(deps, 10, 10)
	results, err := service.Push(context.Background(), "account-1", "device-1", "1", []domain.Mutation{{
		MutationID: "mutation-1",
		EntityType: "service_log",
		Operation:  "create",
		EntityID:   "service-1",
		Payload: map[string]any{
			"vehicle_id": "vehicle-1", "part_type_id": "part-1", "serviced_at": "2026-09-22T00:00:00Z",
		},
	}})
	if err != nil {
		t.Fatalf("Push returned an error: %v", err)
	}
	if len(results) != 1 || results[0].Status != "rejected" || results[0].ErrorCode != "validation_failed" {
		t.Fatalf("expected inactive part type rejection, got %#v", results)
	}
}

func TestPushAllowsExistingInactiveReferenceButRejectsChangingToIt(t *testing.T) {
	baseEntities := map[string]bool{
		"account-1:vehicle:vehicle-1": true,
		"account-1:part_type:part-1":  true,
	}
	payload := map[string]any{
		"vehicle_id": "vehicle-1", "part_type_id": "part-1", "serviced_at": "2026-09-22T00:00:00Z",
	}

	t.Run("keeps existing reference", func(t *testing.T) {
		deps := &testDependencies{
			entities: baseEntities,
			active:   map[string]bool{"account-1:part-1": false},
			references: map[string]bool{
				"account-1:service_log:service-1:part-1": true,
			},
		}
		results, err := NewService(deps, 10, 10).Push(context.Background(), "account-1", "device-1", "1", []domain.Mutation{{
			MutationID: "mutation-keep", EntityType: "service_log", Operation: "update", EntityID: "service-1", Payload: payload,
		}})
		if err != nil || len(results) != 1 || results[0].Status != "applied" {
			t.Fatalf("expected existing inactive reference to remain valid, got results=%#v err=%v", results, err)
		}
	})

	t.Run("changes reference", func(t *testing.T) {
		deps := &testDependencies{
			entities:   baseEntities,
			active:     map[string]bool{"account-1:part-1": false},
			references: map[string]bool{},
		}
		results, err := NewService(deps, 10, 10).Push(context.Background(), "account-1", "device-1", "1", []domain.Mutation{{
			MutationID: "mutation-change", EntityType: "service_log", Operation: "update", EntityID: "service-1", Payload: payload,
		}})
		if err != nil || len(results) != 1 || results[0].Status != "rejected" {
			t.Fatalf("expected inactive reference change to be rejected, got results=%#v err=%v", results, err)
		}
	})
}
