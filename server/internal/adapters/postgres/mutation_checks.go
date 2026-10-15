package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/quoctann/vehicle-care/server/internal/adapters/postgres/sqlcgen"
	"github.com/quoctann/vehicle-care/server/internal/domain"
	conv "github.com/quoctann/vehicle-care/server/pkg/conversion"
)

// Check row-dependent rules after deduplication, inside the write transaction.
// Moving these reads into the application layer would separate them from the
// write and make ownership/scope decisions susceptible to concurrent changes.
func validateCurrentState(ctx context.Context, queries *sqlcgen.Queries, accountID string, mutation domain.Mutation) (domain.MutationErrorCode, string, error) {
	// Update part type, check ownership of part type
	if mutation.EntityType == domain.EntityPartType && mutation.Operation == domain.OperationUpdate {
		exists, err := queries.PartTypeExists(ctx, sqlcgen.PartTypeExistsParams{
			AccountID: accountID,
			ID:        mutation.EntityID,
		})
		if err != nil {
			return "", "", fmt.Errorf("check part type ownership: %w", err)
		}
		if !exists {
			return domain.MutationErrorOwnership, "Part type does not belong to this account.", nil
		}
	}

	// Mutate reminder, check ownership of vehicle first
	if mutation.EntityType != domain.EntityVehicle && mutation.EntityType != domain.EntityPartType {
		exists, err := queries.VehicleExists(ctx, sqlcgen.VehicleExistsParams{
			AccountID: accountID,
			ID:        conv.Value[string](mutation.Payload, "vehicle_id"),
		})
		if err != nil {
			return "", "", fmt.Errorf("check vehicle ownership: %w", err)
		}
		if !exists {
			return domain.MutationErrorOwnership, "Vehicle does not belong to this account.", nil
		}
	}

	// Mutate reminder or service log, check ownership of part type first
	// Inactive but exists part types are still valid historical references.
	if mutation.EntityType == domain.EntityReminderConfig || mutation.EntityType == domain.EntityServiceLog {
		exists, err := queries.PartTypeExists(ctx, sqlcgen.PartTypeExistsParams{
			ID:        conv.Value[string](mutation.Payload, "part_type_id"),
			AccountID: accountID,
		})
		if err != nil {
			return "", "", fmt.Errorf("check part type ownership: %w", err)
		}
		if !exists {
			return domain.MutationErrorOwnership, "Part type does not belong to this account.", nil
		}
	}

	// Mutate fuel log, check ownership of odometer log first
	if mutation.EntityType == domain.EntityFuelLog {
		if odometerID := conv.Value[string](mutation.Payload, "odometer_log_id"); odometerID != "" {
			exists, err := queries.OdometerLogByVehicleID(ctx, sqlcgen.OdometerLogByVehicleIDParams{
				ID:        odometerID,
				AccountID: accountID,
				VehicleID: conv.Value[string](mutation.Payload, "vehicle_id"),
			})
			if err != nil {
				return "", "", fmt.Errorf("check fuel odometer vehicle: %w", err)
			}
			if !exists {
				return domain.MutationErrorValidation, "Odometer reading does not belong to this vehicle.", nil
			}
		}
	}

	// Create reminder, check for active reminder scope conflict
	if mutation.EntityType == domain.EntityReminderConfig && mutation.Payload["deleted_at"] == nil {
		_, err := queries.FindActiveReminderConflict(ctx, sqlcgen.FindActiveReminderConflictParams{
			ID:         mutation.EntityID,
			AccountID:  accountID,
			PartTypeID: conv.Value[string](mutation.Payload, "part_type_id"),
			VehicleID:  conv.Value[string](mutation.Payload, "vehicle_id"),
		})
		if err == nil {
			return domain.MutationErrorValidation, "An active reminder already exists for this vehicle and part type.", nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return "", "", fmt.Errorf("find active reminder conflict: %w", err)
		}
	}

	return "", "", nil
}
