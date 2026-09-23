package postgres

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strconv"
	"time"

	"github.com/quoctann/vehicle-care/server/internal/adapters/postgres/sqlcgen"
)

// marshalPayload encodes a mutation payload for storage in a jsonb column.
// A nil payload is stored as an empty JSON object rather than SQL NULL,
// matching the NOT NULL change_feed.payload column.
func marshalPayload(payload map[string]any) ([]byte, error) {
	if payload == nil {
		payload = map[string]any{}
	}
	return json.Marshal(payload)
}

// unmarshalPayload decodes a jsonb column back into a payload map. It
// returns nil for an empty/NULL column.
func unmarshalPayload(data []byte) (map[string]any, error) {
	if len(data) == 0 {
		return nil, nil
	}
	var out map[string]any
	if err := json.Unmarshal(data, &out); err != nil {
		return nil, fmt.Errorf("postgres: decode payload: %w", err)
	}
	return out, nil
}

func stringValue(payload map[string]any, key string) string {
	value, _ := payload[key].(string)
	return value
}

func boolValue(payload map[string]any, key string) bool {
	value, _ := payload[key].(bool)
	return value
}

func numberValue(payload map[string]any, key string) float64 {
	value, _ := payload[key].(float64)
	return value
}

func nullString(payload map[string]any, key string) sql.NullString {
	value, exists := payload[key]
	if !exists || value == nil {
		return sql.NullString{}
	}
	text, ok := value.(string)
	if !ok {
		return sql.NullString{}
	}
	return sql.NullString{String: text, Valid: true}
}

// nullStringPtr renders a nullable string field as *string, matching the
// generated Go type for nullable uuid columns (see sqlc.yaml overrides).
func nullStringPtr(payload map[string]any, key string) *string {
	value, exists := payload[key]
	if !exists || value == nil {
		return nil
	}
	text, ok := value.(string)
	if !ok {
		return nil
	}
	return &text
}

// numericString formats a float64 the way a numeric(p,s) column parameter
// must be sent as text over the wire; PostgreSQL applies the column's own
// scale when storing it.
func numericString(value float64) string {
	return strconv.FormatFloat(value, 'f', -1, 64)
}

func requiredNumericString(payload map[string]any, key string) string {
	return numericString(numberValue(payload, key))
}

func nullNumericString(payload map[string]any, key string) sql.NullString {
	value, exists := payload[key]
	if !exists || value == nil {
		return sql.NullString{}
	}
	number, ok := value.(float64)
	if !ok {
		return sql.NullString{}
	}
	return sql.NullString{String: numericString(number), Valid: true}
}

func nullInt64FromNumber(payload map[string]any, key string) sql.NullInt64 {
	value, exists := payload[key]
	if !exists || value == nil {
		return sql.NullInt64{}
	}
	number, ok := value.(float64)
	if !ok {
		return sql.NullInt64{}
	}
	return sql.NullInt64{Int64: int64(number), Valid: true}
}

func nullInt32FromNumber(payload map[string]any, key string) sql.NullInt32 {
	value, exists := payload[key]
	if !exists || value == nil {
		return sql.NullInt32{}
	}
	number, ok := value.(float64)
	if !ok {
		return sql.NullInt32{}
	}
	return sql.NullInt32{Int32: int32(number), Valid: true}
}

func requiredTime(payload map[string]any, key string) (time.Time, error) {
	text, ok := payload[key].(string)
	if !ok {
		return time.Time{}, fmt.Errorf("postgres: payload field %q is missing or not a string", key)
	}
	value, err := time.Parse(time.RFC3339, text)
	if err != nil {
		return time.Time{}, fmt.Errorf("postgres: payload field %q is not RFC3339: %w", key, err)
	}
	return value, nil
}

func nullTime(payload map[string]any, key string) (sql.NullTime, error) {
	value, exists := payload[key]
	if !exists || value == nil {
		return sql.NullTime{}, nil
	}
	text, ok := value.(string)
	if !ok {
		return sql.NullTime{}, fmt.Errorf("postgres: payload field %q is not a string", key)
	}
	parsed, err := time.Parse(time.RFC3339, text)
	if err != nil {
		return sql.NullTime{}, fmt.Errorf("postgres: payload field %q is not RFC3339: %w", key, err)
	}
	return sql.NullTime{Time: parsed, Valid: true}, nil
}

func nullDate(payload map[string]any, key string) (sql.NullTime, error) {
	value, exists := payload[key]
	if !exists || value == nil {
		return sql.NullTime{}, nil
	}
	text, ok := value.(string)
	if !ok {
		return sql.NullTime{}, fmt.Errorf("postgres: payload field %q is not a string", key)
	}
	parsed, err := time.Parse("2006-01-02", text)
	if err != nil {
		return sql.NullTime{}, fmt.Errorf("postgres: payload field %q is not a date: %w", key, err)
	}
	return sql.NullTime{Time: parsed, Valid: true}, nil
}

// buildUpsertVehicleParams decodes a validated vehicle payload (see
// validatePayload in internal/application/service.go) into UPSERT
// parameters.
func buildUpsertVehicleParams(accountID, entityID string, payload map[string]any, seq int64, receivedAt time.Time) (sqlcgen.UpsertVehicleParams, error) {
	archivedAt, err := nullTime(payload, "archived_at")
	if err != nil {
		return sqlcgen.UpsertVehicleParams{}, err
	}
	deletedAt, err := nullTime(payload, "deleted_at")
	if err != nil {
		return sqlcgen.UpsertVehicleParams{}, err
	}
	return sqlcgen.UpsertVehicleParams{
		AccountID:        accountID,
		ID:               entityID,
		Name:             stringValue(payload, "name"),
		PlateNumber:      nullString(payload, "plate_number"),
		ArchivedAt:       archivedAt,
		DeletedAt:        deletedAt,
		DueSoonRatio:     nullNumericString(payload, "due_soon_ratio"),
		ServerSeq:        seq,
		ReceivedAtServer: receivedAt,
	}, nil
}

// buildUpsertPartTypeParams decodes a validated part_type payload into UPSERT
// parameters. Unlike other entities, the payload IS the full snapshot the
// client itself built (code == entityID, enforced in validateMutation) —
// nothing here is server-derived, so change_feed replay to other devices
// reconstructs the full row from the payload alone (see
// .docs/20260919-feedback.md Feature #2).
func buildUpsertPartTypeParams(accountID, entityID string, payload map[string]any, seq int64, receivedAt time.Time) (sqlcgen.UpsertPartTypeParams, error) {
	return sqlcgen.UpsertPartTypeParams{
		ID:               entityID,
		AccountID:        accountID,
		Code:             stringValue(payload, "code"),
		NameVi:           stringValue(payload, "name_vi"),
		DisplayOrder:     int32(numberValue(payload, "display_order")),
		Active:           boolValue(payload, "active"),
		SeedVersion:      stringValue(payload, "seed_version"),
		ServerSeq:        seq,
		ReceivedAtServer: receivedAt,
	}, nil
}

// buildUpsertReminderConfigParams decodes a validated reminder_config
// payload into UPSERT parameters.
func buildUpsertReminderConfigParams(accountID, entityID string, payload map[string]any, seq int64, receivedAt time.Time) (sqlcgen.UpsertReminderConfigParams, error) {
	baselineDate, err := nullDate(payload, "baseline_date")
	if err != nil {
		return sqlcgen.UpsertReminderConfigParams{}, err
	}
	deletedAt, err := nullTime(payload, "deleted_at")
	if err != nil {
		return sqlcgen.UpsertReminderConfigParams{}, err
	}
	return sqlcgen.UpsertReminderConfigParams{
		AccountID:          accountID,
		ID:                 entityID,
		VehicleID:          stringValue(payload, "vehicle_id"),
		PartTypeID:         stringValue(payload, "part_type_id"),
		IntervalKm:         nullNumericString(payload, "interval_km"),
		IntervalDays:       nullInt32FromNumber(payload, "interval_days"),
		BaselineOdometerKm: nullNumericString(payload, "baseline_odometer_km"),
		BaselineDate:       baselineDate,
		Enabled:            boolValue(payload, "enabled"),
		DeletedAt:          deletedAt,
		ServerSeq:          seq,
		ReceivedAtServer:   receivedAt,
	}, nil
}

// buildInsertOdometerLogParams decodes a validated odometer_log payload
// into INSERT parameters.
func buildInsertOdometerLogParams(accountID, entityID string, payload map[string]any, seq int64, receivedAt time.Time) (sqlcgen.InsertOdometerLogParams, error) {
	recordedAt, err := requiredTime(payload, "recorded_at")
	if err != nil {
		return sqlcgen.InsertOdometerLogParams{}, err
	}
	return sqlcgen.InsertOdometerLogParams{
		AccountID:        accountID,
		ID:               entityID,
		VehicleID:        stringValue(payload, "vehicle_id"),
		OdometerKm:       requiredNumericString(payload, "odometer_km"),
		RecordedAt:       recordedAt,
		Source:           stringValue(payload, "source"),
		Note:             nullString(payload, "note"),
		ServerSeq:        seq,
		ReceivedAtServer: receivedAt,
	}, nil
}

// buildUpsertFuelLogParams decodes a validated fuel_log payload into UPSERT
// parameters.
func buildUpsertFuelLogParams(accountID, entityID string, payload map[string]any, seq int64, receivedAt time.Time) (sqlcgen.UpsertFuelLogParams, error) {
	recordedAt, err := requiredTime(payload, "recorded_at")
	if err != nil {
		return sqlcgen.UpsertFuelLogParams{}, err
	}
	deletedAt, err := nullTime(payload, "deleted_at")
	if err != nil {
		return sqlcgen.UpsertFuelLogParams{}, err
	}
	return sqlcgen.UpsertFuelLogParams{
		AccountID:        accountID,
		ID:               entityID,
		VehicleID:        stringValue(payload, "vehicle_id"),
		RecordedAt:       recordedAt,
		Liters:           nullNumericString(payload, "liters"),
		CostVnd:          nullInt64FromNumber(payload, "cost_vnd"),
		Shop:             nullString(payload, "shop"),
		Note:             nullString(payload, "note"),
		OdometerLogID:    nullStringPtr(payload, "odometer_log_id"),
		IsFullTank:       boolValue(payload, "is_full_tank"),
		DeletedAt:        deletedAt,
		ServerSeq:        seq,
		ReceivedAtServer: receivedAt,
	}, nil
}

// buildUpsertServiceLogParams decodes a validated service_log payload into
// UPSERT parameters.
func buildUpsertServiceLogParams(accountID, entityID string, payload map[string]any, seq int64, receivedAt time.Time) (sqlcgen.UpsertServiceLogParams, error) {
	servicedAt, err := requiredTime(payload, "serviced_at")
	if err != nil {
		return sqlcgen.UpsertServiceLogParams{}, err
	}
	deletedAt, err := nullTime(payload, "deleted_at")
	if err != nil {
		return sqlcgen.UpsertServiceLogParams{}, err
	}
	return sqlcgen.UpsertServiceLogParams{
		AccountID:          accountID,
		ID:                 entityID,
		VehicleID:          stringValue(payload, "vehicle_id"),
		PartTypeID:         stringValue(payload, "part_type_id"),
		ServicedAt:         servicedAt,
		OdometerKmSnapshot: nullNumericString(payload, "odometer_km_snapshot"),
		CostVnd:            nullInt64FromNumber(payload, "cost_vnd"),
		Note:               nullString(payload, "note"),
		DeletedAt:          deletedAt,
		ServerSeq:          seq,
		ReceivedAtServer:   receivedAt,
	}, nil
}

func canonicalPayload(ctx context.Context, queries *sqlcgen.Queries, accountID, entityType, entityID string) (map[string]any, error) {
	var (
		data []byte
		err  error
	)
	switch entityType {
	case "vehicle":
		data, err = queries.CanonicalVehiclePayload(ctx, sqlcgen.CanonicalVehiclePayloadParams{AccountID: accountID, ID: entityID})
	case "reminder_config":
		data, err = queries.CanonicalReminderConfigPayload(ctx, sqlcgen.CanonicalReminderConfigPayloadParams{AccountID: accountID, ID: entityID})
	case "odometer_log":
		data, err = queries.CanonicalOdometerLogPayload(ctx, sqlcgen.CanonicalOdometerLogPayloadParams{AccountID: accountID, ID: entityID})
	case "fuel_log":
		data, err = queries.CanonicalFuelLogPayload(ctx, sqlcgen.CanonicalFuelLogPayloadParams{AccountID: accountID, ID: entityID})
	case "service_log":
		data, err = queries.CanonicalServiceLogPayload(ctx, sqlcgen.CanonicalServiceLogPayloadParams{AccountID: accountID, ID: entityID})
	case "part_type":
		data, err = queries.CanonicalPartTypePayload(ctx, sqlcgen.CanonicalPartTypePayloadParams{AccountID: accountID, ID: entityID})
	default:
		return nil, fmt.Errorf("postgres: canonical payload for unsupported entity type %q", entityType)
	}
	if err != nil {
		return nil, fmt.Errorf("postgres: read canonical %s payload: %w", entityType, err)
	}
	return unmarshalPayload(data)
}
