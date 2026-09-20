package application

import (
	"context"
	"time"

	"github.com/quoctann/vehicle-care/server/internal/domain"
)

func (s *Service) validateMutation(ctx context.Context, accountID string, mutation domain.Mutation) (string, string) {
	if mutation.MutationID == "" || mutation.EntityID == "" || len(mutation.MutationID) > 200 || len(mutation.EntityID) > 200 || mutation.Payload == nil {
		return "validation_failed", "Mutation identifiers and payload are required and must not exceed 200 characters."
	}
	validTypes := map[string]bool{"vehicle": true, "reminder_config": true, "odometer_log": true, "fuel_log": true, "service_log": true, "part_type": true}
	if !validTypes[mutation.EntityType] || (mutation.Operation != "create" && mutation.Operation != "update") {
		return "validation_failed", "Mutation entity_type or operation is invalid."
	}
	if !isMutable(mutation.EntityType) && mutation.Operation != "create" {
		return "validation_failed", "Append-only entities only support create."
	}
	if message := validatePayload(mutation.EntityType, mutation.Payload); message != "" {
		return "validation_failed", message
	}
	// part_type has no vehicle_id (it isn't vehicle-scoped) and part_types.id
	// is a single-column PK (unlike every other mutable entity's composite
	// (account_id, id) PK), so ownership can't be inferred structurally —
	// check it explicitly instead of falling into the generic vehicle_id
	// check below. "code" doubling as the row's own id (enforced here) is
	// what keeps the global UNIQUE(code) constraint collision-free for
	// custom rows without a schema change (see .docs/20260919-feedback.md
	// Feature #2).
	if mutation.EntityType == "part_type" {
		code, _ := mutation.Payload["code"].(string)
		if code != mutation.EntityID {
			return "validation_failed", "part_type code must equal its id for custom entries."
		}
		if mutation.Operation == "update" && !s.store.EntityExists(ctx, accountID, "part_type", mutation.EntityID) {
			return "ownership_invalid", "Part type does not belong to this account."
		}
		return "", ""
	}
	if mutation.EntityType != "vehicle" {
		vehicleID, _ := mutation.Payload["vehicle_id"].(string)
		if !s.store.EntityExists(ctx, accountID, "vehicle", vehicleID) {
			return "ownership_invalid", "Vehicle does not belong to this account."
		}
	}
	return "", ""
}

func isMutable(entityType string) bool {
	switch entityType {
	case "vehicle", "reminder_config", "fuel_log", "service_log", "part_type":
		return true
	default:
		return false
	}
}

func validatePayload(entityType string, payload map[string]any) string {
	switch entityType {
	case "vehicle":
		if !requiredString(payload, "name") || !nullableString(payload, "plate_number") || !nullableTime(payload, "archived_at") || !nullableTime(payload, "deleted_at") || !nullableRatio(payload, "due_soon_ratio") {
			return "Vehicle payload is invalid."
		}
	case "reminder_config":
		intervalKM, validKM := nullablePositiveNumber(payload, "interval_km")
		intervalDays, validDays := nullablePositiveNumber(payload, "interval_days")
		if !requiredString(payload, "vehicle_id") || !requiredString(payload, "part_type_id") || !validKM || !validDays || (intervalKM == nil && intervalDays == nil) || !nullableNumber(payload, "baseline_odometer_km", false) || !nullableDate(payload, "baseline_date") || !requiredBool(payload, "enabled") || !nullableTime(payload, "deleted_at") {
			return "Reminder config payload is invalid."
		}
	case "odometer_log":
		source, _ := payload["source"].(string)
		if !requiredString(payload, "vehicle_id") || !requiredNumber(payload, "odometer_km", false) || !requiredTime(payload, "recorded_at") || !nullableString(payload, "note") || (source != "manual" && source != "fuel") {
			return "Odometer log payload is invalid."
		}
	case "fuel_log":
		if !requiredString(payload, "vehicle_id") || !requiredTime(payload, "recorded_at") || !nullableNumber(payload, "liters", true) || !nullableNumber(payload, "cost_vnd", false) || !nullableString(payload, "shop") || !nullableString(payload, "note") || !nullableString(payload, "odometer_log_id") || !requiredBool(payload, "is_full_tank") || !nullableTime(payload, "deleted_at") {
			return "Fuel log payload is invalid."
		}
	case "service_log":
		if !requiredString(payload, "vehicle_id") || !requiredString(payload, "part_type_id") || !requiredTime(payload, "serviced_at") || !nullableNumber(payload, "odometer_km_snapshot", false) || !nullableNumber(payload, "cost_vnd", false) || !nullableString(payload, "note") || !nullableTime(payload, "deleted_at") {
			return "Service log payload is invalid."
		}
	case "part_type":
		if !requiredString(payload, "code") || !requiredString(payload, "name_vi") || !requiredNumber(payload, "display_order", false) || !requiredBool(payload, "active") || !requiredString(payload, "seed_version") {
			return "Part type payload is invalid."
		}
	}
	return ""
}

func requiredString(payload map[string]any, key string) bool {
	value, ok := payload[key].(string)
	return ok && value != "" && len(value) <= 500
}

func nullableString(payload map[string]any, key string) bool {
	value, exists := payload[key]
	if !exists || value == nil {
		return true
	}
	text, ok := value.(string)
	return ok && len(text) <= 2000
}

func requiredBool(payload map[string]any, key string) bool {
	_, ok := payload[key].(bool)
	return ok
}

func requiredNumber(payload map[string]any, key string, positive bool) bool {
	value, ok := payload[key].(float64)
	return ok && value >= 0 && (!positive || value > 0)
}

func nullableNumber(payload map[string]any, key string, positive bool) bool {
	value, exists := payload[key]
	if !exists || value == nil {
		return true
	}
	number, ok := value.(float64)
	return ok && number >= 0 && (!positive || number > 0)
}

// nullableRatio validates a ratio field in (0, 1] — used for
// vehicle.due_soon_ratio, where 0 would mean "always due" and values above 1
// are meaningless (ratio of interval already consumed).
func nullableRatio(payload map[string]any, key string) bool {
	value, exists := payload[key]
	if !exists || value == nil {
		return true
	}
	number, ok := value.(float64)
	return ok && number > 0 && number <= 1
}

func nullablePositiveNumber(payload map[string]any, key string) (*float64, bool) {
	value, exists := payload[key]
	if !exists || value == nil {
		return nil, true
	}
	number, ok := value.(float64)
	if !ok || number <= 0 {
		return nil, false
	}
	return &number, true
}

func requiredTime(payload map[string]any, key string) bool {
	value, ok := payload[key].(string)
	if !ok {
		return false
	}
	_, err := time.Parse(time.RFC3339, value)
	return err == nil
}

func nullableTime(payload map[string]any, key string) bool {
	value, exists := payload[key]
	if !exists || value == nil {
		return true
	}
	text, ok := value.(string)
	if !ok {
		return false
	}
	_, err := time.Parse(time.RFC3339, text)
	return err == nil
}

func nullableDate(payload map[string]any, key string) bool {
	value, exists := payload[key]
	if !exists || value == nil {
		return true
	}
	text, ok := value.(string)
	if !ok {
		return false
	}
	_, err := time.Parse("2006-01-02", text)
	return err == nil
}
