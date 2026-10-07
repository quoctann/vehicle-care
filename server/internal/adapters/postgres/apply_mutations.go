package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jmoiron/sqlx"

	"github.com/quoctann/vehicle-care/server/internal/adapters/postgres/sqlcgen"
	"github.com/quoctann/vehicle-care/server/internal/domain"
)

func (s *Store) ApplyMutation(ctx context.Context, accountID string, deviceID string, mutation domain.Mutation, now time.Time) domain.MutationResult {
	result, err := s.applyOneMutation(ctx, accountID, deviceID, mutation, now)
	if err != nil {
		if isTerminalMutationErr(err) {
			return rejectedResult(mutation.MutationID, domain.MutationErrorValidation, "Mutation violates a database constraint.")
		}
		return retryableResult(mutation.MutationID, "Temporary storage failure. Please retry.")
	}

	return result
}

func isTerminalMutationErr(err error) bool {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		return false
	}

	// An idempotency-key collision is never evidence of an invalid payload.
	// The account lock prevents this race for normal callers; retry if another
	// writer bypassed that protocol so the next lookup returns its saved ACK.
	if pgErr.Code == "23505" && pgErr.ConstraintName == "processed_mutations_pkey" {
		return false
	}
	return len(pgErr.Code) >= 2 && pgErr.Code[:2] == "23"
}

func (s *Store) applyOneMutation(ctx context.Context, accountID string, deviceID string, mutation domain.Mutation, now time.Time) (domain.MutationResult, error) {
	if !mutation.EntityType.IsSupported() {
		return rejectedResult(mutation.MutationID, domain.MutationErrorValidation, "Unsupported entity type."), nil
	}

	tx, err := s.db.BeginTxx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return domain.MutationResult{}, fmt.Errorf("begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	queries := sqlcgen.New(tx)

	// Step 1: lock the sequence for apply mutations between devices
	if _, err := queries.LockAccountSequenceForUpdate(ctx, accountID); err != nil {
		return domain.MutationResult{}, fmt.Errorf("lock account sequence: %w", err)
	}

	// Step 2: find ACK processed for this device request, prevent duplicate
	// writes by returning the prior result
	result, found, err := findProcessedResult(ctx, queries, accountID, deviceID, mutation)
	if err != nil {
		return domain.MutationResult{}, err
	}
	if found {
		return result, tx.Commit()
	}

	// Step 3: check ownership and current-state rules, reject if violated
	code, message, err := validateCurrentState(ctx, queries, accountID, mutation)
	if err != nil {
		return domain.MutationResult{}, err
	}
	if code != "" {
		result = rejectedResult(mutation.MutationID, code, message)
		err = recordRejection(ctx, tx, queries, accountID, deviceID, mutation, result)
		return result, err
	}

	// Step 4: apply the mutation, record the ACK, and commit
	switch mutation.EntityType {
	case domain.EntityOdometerLog:
		return s.applyAppendOnlyMutation(ctx, queries, accountID, deviceID, mutation, now, tx)

	case domain.EntityVehicle, domain.EntityReminderConfig, domain.EntityFuelLog, domain.EntityServiceLog, domain.EntityPartType:
		return s.applyMutableMutation(ctx, tx, queries, accountID, deviceID, mutation, now)

	default:
		return domain.MutationResult{}, fmt.Errorf("unsupported entity type %q", mutation.EntityType)
	}
}

func findProcessedResult(ctx context.Context, queries *sqlcgen.Queries, accountID, deviceID string, mutation domain.Mutation) (domain.MutationResult, bool, error) {
	result := domain.MutationResult{}

	processed, err := queries.FindProcessedMutationForUpdate(ctx,
		sqlcgen.FindProcessedMutationForUpdateParams{
			AccountID:  accountID,
			DeviceID:   deviceID,
			MutationID: mutation.MutationID,
		},
	)
	if err != nil {
		if !errors.Is(err, sql.ErrNoRows) {
			return result, false, nil
		}
		return result, false, fmt.Errorf("find processed mutation: %w", err)
	}

	result.MutationID = mutation.MutationID
	result.Status = domain.MutationStatus(processed.Status)
	if result.Status == domain.StatusApplied {
		result.Status = domain.StatusDuplicate
	}
	if processed.ServerSeq.Valid {
		seq := processed.ServerSeq.Int64
		result.ServerSeq = &seq
	}
	if processed.ServerSyncedAt.Valid {
		receivedAt := processed.ServerSyncedAt.Time
		result.ServerSyncedAt = &receivedAt
	}
	if processed.ErrorCode.Valid {
		result.ErrorCode = domain.MutationErrorCode(processed.ErrorCode.String)
	}
	if processed.ErrorMessage.Valid {
		result.ErrorMessage = processed.ErrorMessage.String
	}
	if processed.Retryable.Valid {
		retryable := processed.Retryable.Bool
		result.Retryable = &retryable
	}

	return result, true, nil
}

func recordRejection(ctx context.Context, tx *sqlx.Tx, queries *sqlcgen.Queries, accountID, deviceID string, mutation domain.Mutation, result domain.MutationResult) error {
	if err := insertProcessedMutation(ctx, queries, accountID, deviceID, mutation, result); err != nil {
		return fmt.Errorf("record rejected mutation: %w", err)
	}
	return tx.Commit()
}

// applyMutableMutation keeps the sequence, row write, feed and ACK in one transaction.
func (s *Store) applyMutableMutation(ctx context.Context, tx *sqlx.Tx, queries *sqlcgen.Queries, accountID, deviceID string, mutation domain.Mutation, now time.Time) (domain.MutationResult, error) {
	if err := lockCurrentSnapshot(ctx, queries, accountID, mutation); err != nil {
		return domain.MutationResult{}, err
	}
	// Writes that can reject after allocating a sequence must restore it before
	// recording the rejection. The entire write is still in one transaction.
	mayReject := mutation.EntityType == domain.EntityReminderConfig || mutation.EntityType == domain.EntityPartType
	if mayReject {
		if _, err := tx.ExecContext(ctx, "SAVEPOINT mutation_write"); err != nil {
			return domain.MutationResult{}, fmt.Errorf("savepoint mutable write: %w", err)
		}
	}
	newSeq, err := queries.NextAccountSequence(ctx, accountID)
	if err != nil {
		return domain.MutationResult{}, fmt.Errorf("allocate server_seq: %w", err)
	}
	// PostgreSQL timestamptz stores microseconds. Return that same precision in
	// the first ACK so a duplicate read from processed_mutations is identical.
	receivedAt := now.UTC().Truncate(time.Microsecond)

	if result, rejected, err := writeMutableSnapshot(ctx, queries, accountID, mutation, newSeq, receivedAt); err != nil {
		if mutation.EntityType == domain.EntityReminderConfig && isUniqueViolation(err, "reminder_configs_active_scope_uidx") {
			if _, rollbackErr := tx.ExecContext(ctx, "ROLLBACK TO SAVEPOINT mutation_write"); rollbackErr != nil {
				return domain.MutationResult{}, fmt.Errorf("rollback reminder conflict: %w", rollbackErr)
			}
			result := rejectedResult(mutation.MutationID, domain.MutationErrorValidation, "An active reminder already exists for this vehicle and part type.")
			return result, recordRejection(ctx, tx, queries, accountID, deviceID, mutation, result)
		}
		return domain.MutationResult{}, err
	} else if rejected {
		if _, err := tx.ExecContext(ctx, "ROLLBACK TO SAVEPOINT mutation_write"); err != nil {
			return domain.MutationResult{}, fmt.Errorf("rollback rejected write: %w", err)
		}
		return result, recordRejection(ctx, tx, queries, accountID, deviceID, mutation, result)
	}
	if mayReject {
		if _, err := tx.ExecContext(ctx, "RELEASE SAVEPOINT mutation_write"); err != nil {
			return domain.MutationResult{}, fmt.Errorf("release mutable write savepoint: %w", err)
		}
	}

	canonical, err := canonicalPayload(ctx, queries, accountID, mutation.EntityType, mutation.EntityID)
	if err != nil {
		return domain.MutationResult{}, err
	}

	return s.finishApplied(ctx, queries, accountID, deviceID, mutation, canonical, newSeq, receivedAt, tx)
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
	if err != nil {
		if !errors.Is(err, sql.ErrNoRows) {
			return domain.MutationResult{}, fmt.Errorf("find current %s: %w", mutation.EntityType, err)
		}
		hasCurrent = false
	}

	if hasCurrent {
		result := domain.MutationResult{
			MutationID:     mutation.MutationID,
			Status:         domain.StatusDuplicate,
			ServerSeq:      &existing.ServerSeq,
			ServerSyncedAt: &existing.ServerSyncedAt,
		}
		if err := insertProcessedMutation(ctx, queries, accountID, deviceID, mutation, result); err != nil {
			return domain.MutationResult{}, fmt.Errorf("record duplicate %s: %w", mutation.EntityType, err)
		}
		return result, tx.Commit()
	}

	newSeq, err := queries.NextAccountSequence(ctx, accountID)
	if err != nil {
		return domain.MutationResult{}, fmt.Errorf("allocate server_seq: %w", err)
	}
	syncedAt := now.UTC().Truncate(time.Microsecond)

	params, buildErr := buildInsertOdometerLogParams(accountID, mutation.EntityID, mutation.Payload, newSeq, syncedAt)
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
	return s.finishApplied(ctx, queries, accountID, deviceID, mutation, canonical, newSeq, syncedAt, tx)
}

// finishApplied appends the change_feed row, records the processed_mutation
// acknowledgment, and commits.
func (s *Store) finishApplied(ctx context.Context, queries *sqlcgen.Queries, accountID, deviceID string, mutation domain.Mutation, canonical map[string]any, seq int64, receivedAt time.Time, tx *sqlx.Tx) (domain.MutationResult, error) {
	changePayload, err := marshalPayload(canonical)
	if err != nil {
		return domain.MutationResult{}, err
	}

	if err := queries.InsertChange(ctx, sqlcgen.InsertChangeParams{
		AccountID:      accountID,
		ServerSeq:      seq,
		EntityType:     string(mutation.EntityType),
		EntityID:       mutation.EntityID,
		Operation:      string(mutation.Operation),
		Payload:        changePayload,
		ServerSyncedAt: receivedAt,
	}); err != nil {
		return domain.MutationResult{}, fmt.Errorf("insert change_feed row: %w", err)
	}

	result := domain.MutationResult{
		MutationID:     mutation.MutationID,
		Status:         domain.StatusApplied,
		ServerSeq:      &seq,
		ServerSyncedAt: &receivedAt,
	}
	if err := insertProcessedMutation(ctx, queries, accountID, deviceID, mutation, result); err != nil {
		return domain.MutationResult{}, fmt.Errorf("record processed mutation: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return domain.MutationResult{}, fmt.Errorf("commit: %w", err)
	}

	return result, nil
}

func rejectedResult(mutationID string, code domain.MutationErrorCode, message string) domain.MutationResult {
	retryable := false
	return domain.MutationResult{MutationID: mutationID, Status: domain.StatusRejected, ErrorCode: code, ErrorMessage: message, Retryable: &retryable}
}

func retryableResult(mutationID, message string) domain.MutationResult {
	retryable := true
	return domain.MutationResult{MutationID: mutationID, Status: domain.StatusRetryableError, ErrorCode: domain.MutationErrorInternal, ErrorMessage: message, Retryable: &retryable}
}

func insertProcessedMutation(ctx context.Context, queries *sqlcgen.Queries, accountID, deviceID string, mutation domain.Mutation, result domain.MutationResult) error {
	params := sqlcgen.InsertProcessedMutationParams{
		AccountID:  accountID,
		DeviceID:   deviceID,
		MutationID: mutation.MutationID,
		EntityType: string(mutation.EntityType),
		EntityID:   mutation.EntityID,
		Status:     string(result.Status),
	}

	if result.ServerSeq != nil {
		params.ServerSeq = sql.NullInt64{Int64: *result.ServerSeq, Valid: true}
	}
	if result.ServerSyncedAt != nil {
		params.ServerSyncedAt = sql.NullTime{Time: *result.ServerSyncedAt, Valid: true}
	}
	if result.ErrorCode != "" {
		params.ErrorCode = sql.NullString{String: string(result.ErrorCode), Valid: true}
	}
	if result.ErrorMessage != "" {
		params.ErrorMessage = sql.NullString{String: result.ErrorMessage, Valid: true}
	}
	if result.Retryable != nil {
		params.Retryable = sql.NullBool{Bool: *result.Retryable, Valid: true}
	}

	return queries.InsertProcessedMutation(ctx, params)
}
