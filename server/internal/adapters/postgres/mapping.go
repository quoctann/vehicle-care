package postgres

import (
	"context"
	"database/sql"
	"fmt"
	"strconv"
	"time"

	"github.com/quoctann/vehicle-care/server/internal/adapters/postgres/sqlcgen"
	"github.com/quoctann/vehicle-care/server/internal/domain"
	conv "github.com/quoctann/vehicle-care/server/pkg/conversion"
)

func nullString(payload map[string]any, key string) sql.NullString {
	text, ok := conv.ValueOK[string](payload, key)
	if !ok {
		return sql.NullString{}
	}
	return sql.NullString{String: text, Valid: true}
}

// Nullable string field as *string, matching the generated Go type for nullable
// uuid columns (see sqlc.yaml overrides).
func nullStringPtr(payload map[string]any, key string) *string {
	text, ok := conv.ValueOK[string](payload, key)
	if !ok {
		return nil
	}
	return &text
}

// Formats a float64 the way a numeric(p,s) column parameter must be sent as
// text over the wire; PostgreSQL applies the column's own scale when storing
// it.
func numericString(value float64) string {
	return strconv.FormatFloat(value, 'f', -1, 64)
}

func requiredNumericString(payload map[string]any, key string) string {
	return numericString(conv.Value[float64](payload, key))
}

func nullNumericString(payload map[string]any, key string) sql.NullString {
	number, ok := conv.ValueOK[float64](payload, key)
	if !ok {
		return sql.NullString{}
	}
	return sql.NullString{String: numericString(number), Valid: true}
}

func nullInt32FromNumber(payload map[string]any, key string) sql.NullInt32 {
	number, ok := conv.ValueOK[float64](payload, key)
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
		AccountID:      accountID,
		ID:             entityID,
		Name:           conv.Value[string](payload, "name"),
		PlateNumber:    nullString(payload, "plate_number"),
		ArchivedAt:     archivedAt,
		DeletedAt:      deletedAt,
		DueSoonRatio:   nullNumericString(payload, "due_soon_ratio"),
		ServerSeq:      seq,
		ServerSyncedAt: receivedAt,
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
		ID:             entityID,
		AccountID:      accountID,
		Code:           conv.Value[string](payload, "code"),
		Name:           conv.Value[string](payload, "name"),
		DisplayOrder:   int32(conv.Value[float64](payload, "display_order")),
		Active:         conv.Value[bool](payload, "active"),
		ServerSeq:      seq,
		ServerSyncedAt: receivedAt,
	}, nil
}

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
		VehicleID:          conv.Value[string](payload, "vehicle_id"),
		PartTypeID:         conv.Value[string](payload, "part_type_id"),
		IntervalKm:         nullNumericString(payload, "interval_km"),
		IntervalDays:       nullInt32FromNumber(payload, "interval_days"),
		BaselineOdometerKm: nullNumericString(payload, "baseline_odometer_km"),
		BaselineDate:       baselineDate,
		Enabled:            conv.Value[bool](payload, "enabled"),
		DeletedAt:          deletedAt,
		ServerSeq:          seq,
		ServerSyncedAt:     receivedAt,
	}, nil
}

func buildInsertOdometerLogParams(accountID, entityID string, payload map[string]any, seq int64, receivedAt time.Time) (sqlcgen.InsertOdometerLogParams, error) {
	recordedAt, err := requiredTime(payload, "recorded_at")
	if err != nil {
		return sqlcgen.InsertOdometerLogParams{}, err
	}

	return sqlcgen.InsertOdometerLogParams{
		AccountID:      accountID,
		ID:             entityID,
		VehicleID:      conv.Value[string](payload, "vehicle_id"),
		OdometerKm:     requiredNumericString(payload, "odometer_km"),
		RecordedAt:     recordedAt,
		Source:         conv.Value[string](payload, "source"),
		Note:           nullString(payload, "note"),
		ServerSeq:      seq,
		ServerSyncedAt: receivedAt,
	}, nil
}

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
		AccountID:      accountID,
		ID:             entityID,
		VehicleID:      conv.Value[string](payload, "vehicle_id"),
		RecordedAt:     recordedAt,
		Liters:         nullNumericString(payload, "liters"),
		Cost:           nullNumericString(payload, "cost"),
		Note:           nullString(payload, "note"),
		OdometerLogID:  nullStringPtr(payload, "odometer_log_id"),
		IsFullTank:     conv.Value[bool](payload, "is_full_tank"),
		DeletedAt:      deletedAt,
		ServerSeq:      seq,
		ServerSyncedAt: receivedAt,
	}, nil
}

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
		VehicleID:          conv.Value[string](payload, "vehicle_id"),
		PartTypeID:         conv.Value[string](payload, "part_type_id"),
		ServicedAt:         servicedAt,
		OdometerKmSnapshot: nullNumericString(payload, "odometer_km_snapshot"),
		Cost:               nullNumericString(payload, "cost"),
		Note:               nullString(payload, "note"),
		DeletedAt:          deletedAt,
		ServerSeq:          seq,
		ServerSyncedAt:     receivedAt,
	}, nil
}

func canonicalPayload(ctx context.Context, queries *sqlcgen.Queries, accountID string, entityType domain.EntityType, entityID string) (map[string]any, error) {
	var (
		data []byte
		err  error
	)

	switch entityType {
	case domain.EntityVehicle:
		data, err = queries.CanonicalVehiclePayload(ctx, sqlcgen.CanonicalVehiclePayloadParams{AccountID: accountID, ID: entityID})

	case domain.EntityReminderConfig:
		data, err = queries.CanonicalReminderConfigPayload(ctx, sqlcgen.CanonicalReminderConfigPayloadParams{AccountID: accountID, ID: entityID})

	case domain.EntityOdometerLog:
		data, err = queries.CanonicalOdometerLogPayload(ctx, sqlcgen.CanonicalOdometerLogPayloadParams{AccountID: accountID, ID: entityID})

	case domain.EntityFuelLog:
		data, err = queries.CanonicalFuelLogPayload(ctx, sqlcgen.CanonicalFuelLogPayloadParams{AccountID: accountID, ID: entityID})

	case domain.EntityServiceLog:
		data, err = queries.CanonicalServiceLogPayload(ctx, sqlcgen.CanonicalServiceLogPayloadParams{AccountID: accountID, ID: entityID})

	case domain.EntityPartType:
		data, err = queries.CanonicalPartTypePayload(ctx, sqlcgen.CanonicalPartTypePayloadParams{AccountID: accountID, ID: entityID})

	default:
		return nil, fmt.Errorf("postgres: canonical payload for unsupported entity type %q", entityType)
	}

	if err != nil {
		return nil, fmt.Errorf("postgres: read canonical %s payload: %w", entityType, err)
	}

	payload, err := conv.Unmarshal(data)
	if err != nil {
		return nil, fmt.Errorf("postgres: decode payload: %w", err)
	}
	return payload, nil
}
