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
		if isTerminalMutationError(err) {
			return []domain.MutationResult{rejectedResult(mutation.MutationID, "validation_failed", "Mutation violates a database constraint.")}
		}
		return []domain.MutationResult{retryableErrorResult(mutation.MutationID, "Temporary storage failure. Please retry.")}
	}

	return []domain.MutationResult{result}
}

// ApplyMutation is the single-item storage port. ApplyMutations is retained as
// a compatibility shim for older adapter callers while the application uses
// this unambiguous API.
func (s *Store) ApplyMutation(ctx context.Context, accountID, deviceID string, mutation domain.Mutation, now time.Time) domain.MutationResult {
	return s.ApplyMutations(ctx, accountID, deviceID, []domain.Mutation{mutation}, now)[0]
}

func isTerminalMutationError(err error) bool {
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
	if !domain.EntityType(mutation.EntityType).IsSupported() {
		return rejectedResult(mutation.MutationID, "validation_failed", "Unsupported entity type."), nil
	}
	tx, err := s.db.BeginTxx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return domain.MutationResult{}, fmt.Errorf("begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	queries := sqlcgen.New(tx)

	// A missing processed_mutations row cannot be locked. Serialize account
	// writes before deduplication and sequence allocation.
	if _, err := queries.LockAccountSequenceForUpdate(ctx, accountID); err != nil {
		return domain.MutationResult{}, fmt.Errorf("lock account sequence: %w", err)
	}

	if result, found, err := findPreviousResult(ctx, queries, accountID, deviceID, mutation); err != nil {
		return domain.MutationResult{}, err
	} else if found {
		return result, commitMutation(tx)
	}

	if result, rejected, err := statefulRejection(ctx, queries, accountID, mutation); err != nil {
		return domain.MutationResult{}, err
	} else if rejected {
		return result, recordRejection(ctx, tx, queries, accountID, deviceID, mutation, result)
	}

	switch domain.EntityType(mutation.EntityType) {
	case domain.EntityOdometerLog:
		return s.applyAppendOnlyMutation(ctx, queries, accountID, deviceID, mutation, now, tx)
	case domain.EntityVehicle, domain.EntityReminderConfig, domain.EntityFuelLog, domain.EntityServiceLog, domain.EntityPartType:
		return s.applyMutableMutation(ctx, tx, queries, accountID, deviceID, mutation, now)
	default:
		return domain.MutationResult{}, fmt.Errorf("unsupported entity type %q", mutation.EntityType)
	}
}

func findPreviousResult(ctx context.Context, queries *sqlcgen.Queries, accountID, deviceID string, mutation domain.Mutation) (domain.MutationResult, bool, error) {
	existingRow, err := queries.FindProcessedMutationForUpdate(ctx,
		sqlcgen.FindProcessedMutationForUpdateParams{
			AccountID:  accountID,
			DeviceID:   deviceID,
			MutationID: mutation.MutationID,
		},
	)

	switch {
	case err == nil:
		result, decodeErr := resultFromProcessedRow(mutation.MutationID, existingRow)
		if decodeErr != nil {
			return domain.MutationResult{}, false, decodeErr
		}
		if result.Status == "applied" {
			result.Status = "duplicate"
		}
		return result, true, nil
	case errors.Is(err, sql.ErrNoRows):
		return domain.MutationResult{}, false, nil
	default:
		return domain.MutationResult{}, false, fmt.Errorf("find processed mutation: %w", err)
	}
}

func recordRejection(ctx context.Context, tx *sqlx.Tx, queries *sqlcgen.Queries, accountID, deviceID string, mutation domain.Mutation, result domain.MutationResult) error {
	if err := insertProcessedMutation(ctx, queries, accountID, deviceID, mutation, result); err != nil {
		return fmt.Errorf("record rejected mutation: %w", err)
	}
	return commitMutation(tx)
}

func commitMutation(tx *sqlx.Tx) error {
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit mutation: %w", err)
	}
	return nil
}

// applyMutableMutation keeps the sequence, row write, feed and ACK in one transaction.
func (s *Store) applyMutableMutation(ctx context.Context, tx *sqlx.Tx, queries *sqlcgen.Queries, accountID, deviceID string, mutation domain.Mutation, now time.Time) (domain.MutationResult, error) {
	if err := lockCurrentSnapshot(ctx, queries, accountID, mutation); err != nil {
		return domain.MutationResult{}, err
	}
	// Writes that can reject after allocating a sequence must restore it before
	// recording the rejection. The entire write is still in one transaction.
	mayReject := mutation.EntityType == "reminder_config" || mutation.EntityType == "part_type"
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
		if mutation.EntityType == "reminder_config" && isUniqueViolation(err, "reminder_configs_active_scope_uidx") {
			if _, rollbackErr := tx.ExecContext(ctx, "ROLLBACK TO SAVEPOINT mutation_write"); rollbackErr != nil {
				return domain.MutationResult{}, fmt.Errorf("rollback reminder conflict: %w", rollbackErr)
			}
			result := rejectedResult(mutation.MutationID, "validation_failed", "An active reminder already exists for this vehicle and part type.")
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

	return s.finishApplied(ctx, queries, accountID, deviceID, mutation, canonical, "applied", newSeq, receivedAt, tx)
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
		result := domain.MutationResult{MutationID: mutation.MutationID, Status: "duplicate", ServerSeq: &existing.ServerSeq, ServerSyncedAt: &existing.ServerSyncedAt}
		if err := insertProcessedMutation(ctx, queries, accountID, deviceID, mutation, result); err != nil {
			return domain.MutationResult{}, fmt.Errorf("record duplicate %s: %w", mutation.EntityType, err)
		}
		return result, commitMutation(tx)
	}

	newSeq, err := queries.NextAccountSequence(ctx, accountID)
	if err != nil {
		return domain.MutationResult{}, fmt.Errorf("allocate server_seq: %w", err)
	}
	receivedAt := now.UTC().Truncate(time.Microsecond)

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
	code, message, err := checkMutationState(ctx, queries, accountID, mutation)
	if err != nil || code == "" {
		return domain.MutationResult{}, false, err
	}
	return rejectedResult(mutation.MutationID, code, message), true, nil
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
		Operation: mutation.Operation, Payload: changePayload, ServerSyncedAt: receivedAt,
	}); err != nil {
		return domain.MutationResult{}, fmt.Errorf("insert change_feed row: %w", err)
	}

	result := domain.MutationResult{MutationID: mutation.MutationID, Status: status, ServerSeq: &seq, ServerSyncedAt: &receivedAt}
	if err := insertProcessedMutation(ctx, queries, accountID, deviceID, mutation, result); err != nil {
		return domain.MutationResult{}, fmt.Errorf("record processed mutation: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return domain.MutationResult{}, fmt.Errorf("commit: %w", err)
	}
	return result, nil
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
	if row.ServerSyncedAt.Valid {
		receivedAt := row.ServerSyncedAt.Time
		result.ServerSyncedAt = &receivedAt
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
	if result.ServerSyncedAt != nil {
		params.ServerSyncedAt = sql.NullTime{Time: *result.ServerSyncedAt, Valid: true}
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
