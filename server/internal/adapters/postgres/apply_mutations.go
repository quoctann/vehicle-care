package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/jmoiron/sqlx"

	"github.com/quoctann/vehicle-care/server/internal/adapters/postgres/sqlcgen"
	"github.com/quoctann/vehicle-care/server/internal/domain"
)

// ErrUnsupportedBatchSize is a caller-contract violation: this adapter only
// supports exactly one mutation per ApplyMutations call. The only real
// caller, application.Service.Push, always calls it that way (see
// service.go, which loops one mutation at a time). Generalizing to N>1
// would require per-mutation SAVEPOINTs; nothing in the codebase needs that
// today (see the architecture plan's "Batch nhiều mutation" decision), so
// violating this assumption is reported back as a retryable error per
// mutation instead of applying anything.
var ErrUnsupportedBatchSize = errors.New("postgres: ApplyMutations only supports exactly one mutation per call")

// ApplyMutations applies exactly one mutation inside a single READ
// COMMITTED transaction: dedupe check, entity lock/seq allocation, table
// upsert/insert, change_feed append, and processed_mutations record. It uses
// real row locks and constraints instead of an in-process mutex.
func (s *Store) ApplyMutations(ctx context.Context, accountID, deviceID string, mutations []domain.Mutation, now time.Time) []domain.MutationResult {
	if len(mutations) != 1 {
		results := make([]domain.MutationResult, len(mutations))
		for i, mutation := range mutations {
			results[i] = retryableErrorResult(mutation.MutationID, ErrUnsupportedBatchSize.Error())
		}
		return results
	}
	mutation := mutations[0]

	result, err := s.applyOneMutation(ctx, accountID, deviceID, mutation, now)
	if err != nil {
		return []domain.MutationResult{retryableErrorResult(mutation.MutationID, err.Error())}
	}
	return []domain.MutationResult{result}
}

func (s *Store) applyOneMutation(ctx context.Context, accountID, deviceID string, mutation domain.Mutation, now time.Time) (domain.MutationResult, error) {
	tx, err := s.db.BeginTxx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return domain.MutationResult{}, fmt.Errorf("begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	queries := sqlcgen.New(tx)

	// Step 1: dedupe by (account_id, device_id, mutation_id). A prior
	// applied write is presented as "duplicate" without
	// touching the stored row.
	existingRow, err := queries.FindProcessedMutationForUpdate(ctx, sqlcgen.FindProcessedMutationForUpdateParams{
		AccountID: accountID, DeviceID: deviceID, MutationID: mutation.MutationID,
	})
	switch {
	case err == nil:
		result, decodeErr := resultFromProcessedRow(mutation.MutationID, existingRow)
		if decodeErr != nil {
			return domain.MutationResult{}, decodeErr
		}
		if result.Status == "applied" {
			result.Status = "duplicate"
		}
		if err := tx.Commit(); err != nil {
			return domain.MutationResult{}, fmt.Errorf("commit dedupe: %w", err)
		}
		return result, nil
	case errors.Is(err, sql.ErrNoRows):
		// Not seen before; continue.
	default:
		return domain.MutationResult{}, fmt.Errorf("find processed mutation: %w", err)
	}

	if result, rejected, err := statefulRejection(ctx, queries, accountID, mutation); err != nil {
		return domain.MutationResult{}, err
	} else if rejected {
		if err := insertProcessedMutation(ctx, queries, accountID, deviceID, mutation, result); err != nil {
			return domain.MutationResult{}, fmt.Errorf("record rejected mutation: %w", err)
		}
		if err := tx.Commit(); err != nil {
			return domain.MutationResult{}, fmt.Errorf("commit rejected mutation: %w", err)
		}
		return result, nil
	}

	payload := mutation.Payload

	// Step 2: reminder scope pre-check (D7 uniqueness), only relevant when
	// this write leaves the reminder active (not a tombstone).
	if mutation.EntityType == "reminder_config" && payload["deleted_at"] == nil {
		vehicleID := stringValue(payload, "vehicle_id")
		partTypeID := stringValue(payload, "part_type_id")
		_, err := queries.FindActiveReminderScopeOwner(ctx, sqlcgen.FindActiveReminderScopeOwnerParams{
			AccountID: accountID, VehicleID: vehicleID, PartTypeID: partTypeID, ID: mutation.EntityID,
		})
		switch {
		case err == nil:
			result := rejectedResult(mutation.MutationID, "validation_failed", "An active reminder already exists for this vehicle and part type.")
			if err := insertProcessedMutation(ctx, queries, accountID, deviceID, mutation, result); err != nil {
				return domain.MutationResult{}, fmt.Errorf("record rejected reminder scope: %w", err)
			}
			if err := tx.Commit(); err != nil {
				return domain.MutationResult{}, fmt.Errorf("commit rejected reminder scope: %w", err)
			}
			return result, nil
		case errors.Is(err, sql.ErrNoRows):
			// No conflicting owner; continue.
		default:
			return domain.MutationResult{}, fmt.Errorf("find active reminder scope owner: %w", err)
		}
	}

	if isMutableEntity(mutation.EntityType) {
		return s.applyMutableMutation(ctx, tx, queries, accountID, deviceID, mutation, now)
	}
	return s.applyAppendOnlyMutation(ctx, queries, accountID, deviceID, mutation, now, tx)
}

// applyMutableMutation locks the current row (if any) to serialize concurrent
// writers on the same entity, allocates a server_seq, then upserts the payload.
func (s *Store) applyMutableMutation(ctx context.Context, tx *sqlx.Tx, queries *sqlcgen.Queries, accountID, deviceID string, mutation domain.Mutation, now time.Time) (domain.MutationResult, error) {
	var err error
	switch mutation.EntityType {
	case "vehicle":
		_, err = queries.LockVehicleForUpdate(ctx, sqlcgen.LockVehicleForUpdateParams{AccountID: accountID, ID: mutation.EntityID})
	case "reminder_config":
		_, err = queries.LockReminderConfigForUpdate(ctx, sqlcgen.LockReminderConfigForUpdateParams{AccountID: accountID, ID: mutation.EntityID})
	case "fuel_log":
		_, err = queries.LockFuelLogForUpdate(ctx, sqlcgen.LockFuelLogForUpdateParams{AccountID: accountID, ID: mutation.EntityID})
	case "service_log":
		_, err = queries.LockServiceLogForUpdate(ctx, sqlcgen.LockServiceLogForUpdateParams{AccountID: accountID, ID: mutation.EntityID})
	case "part_type":
		_, err = queries.LockPartTypeForUpdate(ctx, sqlcgen.LockPartTypeForUpdateParams{AccountID: accountID, ID: mutation.EntityID})
	}
	switch {
	case err == nil:
	case errors.Is(err, sql.ErrNoRows):
	default:
		return domain.MutationResult{}, fmt.Errorf("lock current %s: %w", mutation.EntityType, err)
	}

	newSeq, err := queries.NextSeq(ctx, accountID)
	if err != nil {
		return domain.MutationResult{}, fmt.Errorf("allocate server_seq: %w", err)
	}
	receivedAt := now.UTC()

	status := "applied"

	if mutation.EntityType == "reminder_config" {
		params, buildErr := buildUpsertReminderConfigParams(accountID, mutation.EntityID, mutation.Payload, newSeq, receivedAt)
		if buildErr != nil {
			return domain.MutationResult{}, buildErr
		}
		if _, err := tx.ExecContext(ctx, "SAVEPOINT reminder_upsert"); err != nil {
			return domain.MutationResult{}, fmt.Errorf("savepoint: %w", err)
		}
		if err := queries.UpsertReminderConfig(ctx, params); err != nil {
			if isUniqueViolation(err, "reminder_configs_active_scope_uidx") {
				// Lost a race against another device that inserted the
				// same (vehicle_id, part_type_id) scope after our Step 2
				// pre-check but before this upsert committed.
				if _, rbErr := tx.ExecContext(ctx, "ROLLBACK TO SAVEPOINT reminder_upsert"); rbErr != nil {
					return domain.MutationResult{}, fmt.Errorf("rollback to savepoint: %w", rbErr)
				}
				result := rejectedResult(mutation.MutationID, "validation_failed", "An active reminder already exists for this vehicle and part type.")
				if err := insertProcessedMutation(ctx, queries, accountID, deviceID, mutation, result); err != nil {
					return domain.MutationResult{}, fmt.Errorf("record rejected reminder scope race: %w", err)
				}
				if err := tx.Commit(); err != nil {
					return domain.MutationResult{}, fmt.Errorf("commit rejected reminder scope race: %w", err)
				}
				return result, nil
			}
			return domain.MutationResult{}, fmt.Errorf("upsert reminder_config: %w", err)
		}
		if _, err := tx.ExecContext(ctx, "RELEASE SAVEPOINT reminder_upsert"); err != nil {
			return domain.MutationResult{}, fmt.Errorf("release savepoint: %w", err)
		}
	} else if mutation.EntityType == "vehicle" {
		params, buildErr := buildUpsertVehicleParams(accountID, mutation.EntityID, mutation.Payload, newSeq, receivedAt)
		if buildErr != nil {
			return domain.MutationResult{}, buildErr
		}
		if err := queries.UpsertVehicle(ctx, params); err != nil {
			return domain.MutationResult{}, fmt.Errorf("upsert vehicle: %w", err)
		}
	} else if mutation.EntityType == "fuel_log" {
		params, buildErr := buildUpsertFuelLogParams(accountID, mutation.EntityID, mutation.Payload, newSeq, receivedAt)
		if buildErr != nil {
			return domain.MutationResult{}, buildErr
		}
		if err := queries.UpsertFuelLog(ctx, params); err != nil {
			return domain.MutationResult{}, fmt.Errorf("upsert fuel_log: %w", err)
		}
	} else if mutation.EntityType == "service_log" {
		params, buildErr := buildUpsertServiceLogParams(accountID, mutation.EntityID, mutation.Payload, newSeq, receivedAt)
		if buildErr != nil {
			return domain.MutationResult{}, buildErr
		}
		if err := queries.UpsertServiceLog(ctx, params); err != nil {
			return domain.MutationResult{}, fmt.Errorf("upsert service_log: %w", err)
		}
	} else {
		params, buildErr := buildUpsertPartTypeParams(accountID, mutation.EntityID, mutation.Payload, newSeq, receivedAt)
		if buildErr != nil {
			return domain.MutationResult{}, buildErr
		}
		rowsAffected, err := queries.UpsertPartType(ctx, params)
		if err != nil {
			return domain.MutationResult{}, fmt.Errorf("upsert part_type: %w", err)
		}
		if rowsAffected != 1 {
			result := rejectedResult(mutation.MutationID, "ownership_invalid", "Part type does not belong to this account.")
			if err := insertProcessedMutation(ctx, queries, accountID, deviceID, mutation, result); err != nil {
				return domain.MutationResult{}, fmt.Errorf("record rejected part type ownership: %w", err)
			}
			if err := tx.Commit(); err != nil {
				return domain.MutationResult{}, fmt.Errorf("commit rejected part type ownership: %w", err)
			}
			return result, nil
		}
	}

	canonical, err := canonicalPayload(ctx, queries, accountID, mutation.EntityType, mutation.EntityID)
	if err != nil {
		return domain.MutationResult{}, err
	}
	return s.finishApplied(ctx, queries, accountID, deviceID, mutation, canonical, status, newSeq, receivedAt, tx)
}

// applyAppendOnlyMutation handles "odometer_log": it is immutable once
// created (editing/deleting a reading would shift baseline_odometer_km for
// every reminder — see .docs/20260919-feedback.md Feature #3 scope), so a
// prior snapshot by the same entity ID is always a duplicate, never a
// conflict. fuel_log/service_log used to be handled here too but are now
// mutable (applyMutableMutation) so users can edit/delete them.
func (s *Store) applyAppendOnlyMutation(ctx context.Context, queries *sqlcgen.Queries, accountID, deviceID string, mutation domain.Mutation, now time.Time, tx *sqlx.Tx) (domain.MutationResult, error) {
	existing, err := queries.FindOdometerLog(ctx, sqlcgen.FindOdometerLogParams{AccountID: accountID, ID: mutation.EntityID})
	hasCurrent := true
	switch {
	case err == nil:
	case errors.Is(err, sql.ErrNoRows):
		hasCurrent = false
	default:
		return domain.MutationResult{}, fmt.Errorf("find current %s: %w", mutation.EntityType, err)
	}

	if hasCurrent {
		result := domain.MutationResult{MutationID: mutation.MutationID, Status: "duplicate", ServerSeq: &existing.ServerSeq, ReceivedAtServer: &existing.ReceivedAtServer}
		if err := insertProcessedMutation(ctx, queries, accountID, deviceID, mutation, result); err != nil {
			return domain.MutationResult{}, fmt.Errorf("record duplicate %s: %w", mutation.EntityType, err)
		}
		if err := tx.Commit(); err != nil {
			return domain.MutationResult{}, fmt.Errorf("commit duplicate %s: %w", mutation.EntityType, err)
		}
		return result, nil
	}

	newSeq, err := queries.NextSeq(ctx, accountID)
	if err != nil {
		return domain.MutationResult{}, fmt.Errorf("allocate server_seq: %w", err)
	}
	receivedAt := now.UTC()

	params, buildErr := buildInsertOdometerLogParams(accountID, mutation.EntityID, mutation.Payload, newSeq, receivedAt)
	if buildErr != nil {
		return domain.MutationResult{}, buildErr
	}
	if err := queries.InsertOdometerLog(ctx, params); err != nil {
		return domain.MutationResult{}, fmt.Errorf("insert %s: %w", mutation.EntityType, err)
	}

	canonical, err := canonicalPayload(ctx, queries, accountID, mutation.EntityType, mutation.EntityID)
	if err != nil {
		return domain.MutationResult{}, err
	}
	return s.finishApplied(ctx, queries, accountID, deviceID, mutation, canonical, "applied", newSeq, receivedAt, tx)
}

// statefulRejection performs ownership and current-state checks only after
// mutation-id dedupe has succeeded. These checks share the write transaction,
// so a database error remains retryable instead of becoming ownership_invalid.
func statefulRejection(ctx context.Context, queries *sqlcgen.Queries, accountID string, mutation domain.Mutation) (domain.MutationResult, bool, error) {
	reject := func(code, message string) (domain.MutationResult, bool, error) {
		return rejectedResult(mutation.MutationID, code, message), true, nil
	}

	if mutation.EntityType == "part_type" && mutation.Operation == "update" {
		owned, err := queries.PartTypeOwnedByAccount(ctx, sqlcgen.PartTypeOwnedByAccountParams{ID: mutation.EntityID, AccountID: accountID})
		if err != nil {
			return domain.MutationResult{}, false, fmt.Errorf("check part type ownership: %w", err)
		}
		if !owned {
			return reject("ownership_invalid", "Part type does not belong to this account.")
		}
	}

	if mutation.EntityType != "vehicle" && mutation.EntityType != "part_type" {
		vehicleID := stringValue(mutation.Payload, "vehicle_id")
		exists, err := queries.VehicleExists(ctx, sqlcgen.VehicleExistsParams{AccountID: accountID, ID: vehicleID})
		if err != nil {
			return domain.MutationResult{}, false, fmt.Errorf("check vehicle ownership: %w", err)
		}
		if !exists {
			return reject("ownership_invalid", "Vehicle does not belong to this account.")
		}
	}

	if mutation.EntityType == "reminder_config" || mutation.EntityType == "service_log" {
		partTypeID := stringValue(mutation.Payload, "part_type_id")
		owned, err := queries.PartTypeOwnedByAccount(ctx, sqlcgen.PartTypeOwnedByAccountParams{ID: partTypeID, AccountID: accountID})
		if err != nil {
			return domain.MutationResult{}, false, fmt.Errorf("check part type ownership: %w", err)
		}
		if !owned {
			return reject("ownership_invalid", "Part type does not belong to this account.")
		}

		keepsExistingReference := false
		if mutation.Operation == "update" {
			switch mutation.EntityType {
			case "reminder_config":
				keepsExistingReference, err = queries.ReminderConfigUsesPartType(ctx, sqlcgen.ReminderConfigUsesPartTypeParams{AccountID: accountID, ID: mutation.EntityID, PartTypeID: partTypeID})
			case "service_log":
				keepsExistingReference, err = queries.ServiceLogUsesPartType(ctx, sqlcgen.ServiceLogUsesPartTypeParams{AccountID: accountID, ID: mutation.EntityID, PartTypeID: partTypeID})
			}
			if err != nil {
				return domain.MutationResult{}, false, fmt.Errorf("check existing part type reference: %w", err)
			}
		}
		if !keepsExistingReference {
			active, err := queries.PartTypeActiveForAccount(ctx, sqlcgen.PartTypeActiveForAccountParams{ID: partTypeID, AccountID: accountID})
			if err != nil {
				return domain.MutationResult{}, false, fmt.Errorf("check part type active state: %w", err)
			}
			if !active {
				return reject("validation_failed", "Part type is inactive.")
			}
		}
	}

	return domain.MutationResult{}, false, nil
}

// finishApplied appends the change_feed row, records the processed_mutation
// acknowledgment, and commits.
func (s *Store) finishApplied(ctx context.Context, queries *sqlcgen.Queries, accountID, deviceID string, mutation domain.Mutation, canonical map[string]any, status string, seq int64, receivedAt time.Time, tx *sqlx.Tx) (domain.MutationResult, error) {
	changePayload, err := marshalPayload(canonical)
	if err != nil {
		return domain.MutationResult{}, err
	}
	if err := queries.InsertChange(ctx, sqlcgen.InsertChangeParams{
		AccountID: accountID, ServerSeq: seq, EntityType: mutation.EntityType, EntityID: mutation.EntityID,
		Operation: mutation.Operation, Payload: changePayload, ReceivedAtServer: receivedAt,
	}); err != nil {
		return domain.MutationResult{}, fmt.Errorf("insert change_feed row: %w", err)
	}

	result := domain.MutationResult{MutationID: mutation.MutationID, Status: status, ServerSeq: &seq, ReceivedAtServer: &receivedAt}
	if err := insertProcessedMutation(ctx, queries, accountID, deviceID, mutation, result); err != nil {
		return domain.MutationResult{}, fmt.Errorf("record processed mutation: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return domain.MutationResult{}, fmt.Errorf("commit: %w", err)
	}
	return result, nil
}

func isMutableEntity(entityType string) bool {
	switch entityType {
	case "vehicle", "reminder_config", "fuel_log", "service_log", "part_type":
		return true
	default:
		return false
	}
}

func rejectedResult(mutationID, code, message string) domain.MutationResult {
	retryable := false
	return domain.MutationResult{MutationID: mutationID, Status: "rejected", ErrorCode: code, ErrorMessage: message, Retryable: &retryable}
}

func retryableErrorResult(mutationID, message string) domain.MutationResult {
	retryable := true
	return domain.MutationResult{MutationID: mutationID, Status: "retryable_error", ErrorCode: "internal_error", ErrorMessage: message, Retryable: &retryable}
}

func resultFromProcessedRow(mutationID string, row sqlcgen.FindProcessedMutationForUpdateRow) (domain.MutationResult, error) {
	result := domain.MutationResult{MutationID: mutationID, Status: row.Status}
	if row.ServerSeq.Valid {
		seq := row.ServerSeq.Int64
		result.ServerSeq = &seq
	}
	if row.ReceivedAtServer.Valid {
		receivedAt := row.ReceivedAtServer.Time
		result.ReceivedAtServer = &receivedAt
	}
	if row.ErrorCode.Valid {
		result.ErrorCode = row.ErrorCode.String
	}
	if row.ErrorMessage.Valid {
		result.ErrorMessage = row.ErrorMessage.String
	}
	if row.Retryable.Valid {
		retryable := row.Retryable.Bool
		result.Retryable = &retryable
	}
	return result, nil
}

func insertProcessedMutation(ctx context.Context, queries *sqlcgen.Queries, accountID, deviceID string, mutation domain.Mutation, result domain.MutationResult) error {
	params := sqlcgen.InsertProcessedMutationParams{
		AccountID:  accountID,
		DeviceID:   deviceID,
		MutationID: mutation.MutationID,
		EntityType: mutation.EntityType,
		EntityID:   mutation.EntityID,
		Status:     result.Status,
	}
	if result.ServerSeq != nil {
		params.ServerSeq = sql.NullInt64{Int64: *result.ServerSeq, Valid: true}
	}
	if result.ReceivedAtServer != nil {
		params.ReceivedAtServer = sql.NullTime{Time: *result.ReceivedAtServer, Valid: true}
	}
	if result.ErrorCode != "" {
		params.ErrorCode = sql.NullString{String: result.ErrorCode, Valid: true}
	}
	if result.ErrorMessage != "" {
		params.ErrorMessage = sql.NullString{String: result.ErrorMessage, Valid: true}
	}
	if result.Retryable != nil {
		params.Retryable = sql.NullBool{Bool: *result.Retryable, Valid: true}
	}
	return queries.InsertProcessedMutation(ctx, params)
}
