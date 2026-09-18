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
	validTypes := map[string]bool{"vehicle": true, "reminder_config": true, "odometer_log": true, "fuel_log": true, "service_log": true}
	if !validTypes[mutation.EntityType] || (mutation.Operation != "create" && mutation.Operation != "update") {
		return "validation_failed", "Mutation entity_type or operation is invalid."
	}
	if !isMutable(mutation.EntityType) && mutation.Operation != "create" {
		return "validation_failed", "Append-only entities only support create."
	}
	if message := validatePayload(mutation.EntityType, mutation.Payload); message != "" {
		return "validation_failed", message
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
	return entityType == "vehicle" || entityType == "reminder_config"
}

func validatePayload(entityType string, payload map[string]any) string {
	switch entityType {
	case "vehicle":
		if !requiredString(payload, "name") || !nullableString(payload, "plate_number") || !nullableTime(payload, "archived_at") || !nullableTime(payload, "deleted_at") {
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
		if !requiredString(payload, "vehicle_id") || !requiredTime(payload, "recorded_at") || !nullableNumber(payload, "liters", true) || !nullableNumber(payload, "cost_vnd", false) || !nullableString(payload, "shop") || !nullableString(payload, "note") || !nullableString(payload, "odometer_log_id") || !requiredBool(payload, "is_full_tank") {
			return "Fuel log payload is invalid."
		}
	case "service_log":
		if !requiredString(payload, "vehicle_id") || !requiredString(payload, "part_type_id") || !requiredTime(payload, "serviced_at") || !nullableNumber(payload, "odometer_km_snapshot", false) || !nullableNumber(payload, "cost_vnd", false) || !nullableString(payload, "note") {
			return "Service log payload is invalid."
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
