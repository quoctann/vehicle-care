package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/quoctann/vehicle-care/server/internal/adapters/postgres/sqlcgen"
	"github.com/quoctann/vehicle-care/server/internal/domain"
)

// The account sequence lock already serializes cooperating writers. These
// per-row locks also make the current snapshot explicit inside the transaction.
func lockCurrentSnapshot(ctx context.Context, queries *sqlcgen.Queries, accountID string, mutation domain.Mutation) error {
	var err error
	switch domain.EntityType(mutation.EntityType) {
	case domain.EntityVehicle:
		_, err = queries.LockVehicleForUpdate(ctx, sqlcgen.LockVehicleForUpdateParams{AccountID: accountID, ID: mutation.EntityID})
	case domain.EntityReminderConfig:
		_, err = queries.LockReminderConfigForUpdate(ctx, sqlcgen.LockReminderConfigForUpdateParams{AccountID: accountID, ID: mutation.EntityID})
	case domain.EntityFuelLog:
		_, err = queries.LockFuelLogForUpdate(ctx, sqlcgen.LockFuelLogForUpdateParams{AccountID: accountID, ID: mutation.EntityID})
	case domain.EntityServiceLog:
		_, err = queries.LockServiceLogForUpdate(ctx, sqlcgen.LockServiceLogForUpdateParams{AccountID: accountID, ID: mutation.EntityID})
	case domain.EntityPartType:
		_, err = queries.LockPartTypeForUpdate(ctx, sqlcgen.LockPartTypeForUpdateParams{AccountID: accountID, ID: mutation.EntityID})
	default:
		return fmt.Errorf("unsupported mutable entity type %q", mutation.EntityType)
	}
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("lock current %s: %w", mutation.EntityType, err)
	}
	return nil
}

// writeMutableSnapshot only writes the entity; its caller owns the transaction,
// change feed and processed-mutation ACK.
func writeMutableSnapshot(ctx context.Context, queries *sqlcgen.Queries, accountID string, mutation domain.Mutation, seq int64, receivedAt time.Time) (domain.MutationResult, bool, error) {
	var err error
	switch domain.EntityType(mutation.EntityType) {
	case domain.EntityReminderConfig:
		return domain.MutationResult{}, false, writeReminderSnapshot(ctx, queries, accountID, mutation, seq, receivedAt)
	case domain.EntityPartType:
		return writePartTypeSnapshot(ctx, queries, accountID, mutation, seq, receivedAt)
	case domain.EntityVehicle:
		params, buildErr := buildUpsertVehicleParams(accountID, mutation.EntityID, mutation.Payload, seq, receivedAt)
		if buildErr != nil {
			return domain.MutationResult{}, false, buildErr
		}
		err = queries.UpsertVehicle(ctx, params)
	case domain.EntityFuelLog:
		params, buildErr := buildUpsertFuelLogParams(accountID, mutation.EntityID, mutation.Payload, seq, receivedAt)
		if buildErr != nil {
			return domain.MutationResult{}, false, buildErr
		}
		err = queries.UpsertFuelLog(ctx, params)
	case domain.EntityServiceLog:
		params, buildErr := buildUpsertServiceLogParams(accountID, mutation.EntityID, mutation.Payload, seq, receivedAt)
		if buildErr != nil {
			return domain.MutationResult{}, false, buildErr
		}
		err = queries.UpsertServiceLog(ctx, params)
	default:
		return domain.MutationResult{}, false, fmt.Errorf("unsupported mutable entity type %q", mutation.EntityType)
	}
	if err != nil {
		return domain.MutationResult{}, false, fmt.Errorf("upsert %s: %w", mutation.EntityType, err)
	}
	return domain.MutationResult{}, false, nil
}

func writeReminderSnapshot(ctx context.Context, queries *sqlcgen.Queries, accountID string, mutation domain.Mutation, seq int64, receivedAt time.Time) error {
	params, err := buildUpsertReminderConfigParams(accountID, mutation.EntityID, mutation.Payload, seq, receivedAt)
	if err != nil {
		return err
	}
	if err := queries.UpsertReminderConfig(ctx, params); err != nil {
		return fmt.Errorf("upsert reminder_config: %w", err)
	}
	return nil
}

func writePartTypeSnapshot(ctx context.Context, queries *sqlcgen.Queries, accountID string, mutation domain.Mutation, seq int64, receivedAt time.Time) (domain.MutationResult, bool, error) {
	params, err := buildUpsertPartTypeParams(accountID, mutation.EntityID, mutation.Payload, seq, receivedAt)
	if err != nil {
		return domain.MutationResult{}, false, err
	}
	rowsAffected, err := queries.UpsertPartType(ctx, params)
	if err != nil {
		return domain.MutationResult{}, false, fmt.Errorf("upsert part_type: %w", err)
	}
	if rowsAffected != 1 {
		return rejectedResult(mutation.MutationID, "ownership_invalid", "Part type does not belong to this account."), true, nil
	}
	return domain.MutationResult{}, false, nil
}
