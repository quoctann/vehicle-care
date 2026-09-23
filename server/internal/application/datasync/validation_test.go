package datasync

import (
	"math"
	"testing"

	"github.com/google/uuid"
	"github.com/quoctann/vehicle-care/server/internal/domain"
)

func TestValidateMutationRejectsInvalidUUIDsAndNumbers(t *testing.T) {
	m := validMutation("first")
	m.EntityID = "not-a-uuid"
	if code, message := validateMutation(m); code != "validation_failed" || message == "" {
		t.Fatalf("invalid entity UUID was accepted: %q %q", code, message)
	}

	reminder := domain.Mutation{MutationID: uuid.NewString(), EntityType: "reminder_config", Operation: "create", EntityID: uuid.NewString(), Payload: map[string]any{
		"vehicle_id": uuid.NewString(), "part_type_id": uuid.NewString(), "interval_days": 1.5,
	}}
	if code, _ := validateMutation(reminder); code != "validation_failed" {
		t.Fatal("fractional interval_days was accepted")
	}

	part := domain.Mutation{MutationID: uuid.NewString(), EntityType: "part_type", Operation: "create", EntityID: uuid.NewString(), Payload: map[string]any{
		"code": "custom", "name_vi": "Custom", "display_order": math.NaN(), "active": true, "seed_version": "1",
	}}
	if code, _ := validateMutation(part); code != "validation_failed" {
		t.Fatal("NaN display_order was accepted")
	}

	fuel := domain.Mutation{MutationID: uuid.NewString(), EntityType: "fuel_log", Operation: "create", EntityID: uuid.NewString(), Payload: map[string]any{
		"vehicle_id": uuid.NewString(), "recorded_at": "2026-09-23T00:00:00Z", "cost_vnd": 123.5, "is_full_tank": true,
	}}
	if code, _ := validateMutation(fuel); code != "validation_failed" {
		t.Fatal("fractional cost_vnd was accepted")
	}
}
