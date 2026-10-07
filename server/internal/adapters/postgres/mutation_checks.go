package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/quoctann/vehicle-care/server/internal/adapters/postgres/sqlcgen"
	"github.com/quoctann/vehicle-care/server/internal/domain"
)

// Check row-dependent rules after deduplication, inside the write transaction.
// Moving these reads into the application layer would separate them from the
// write and make ownership/scope decisions susceptible to concurrent changes.
func checkMutationState(ctx context.Context, queries *sqlcgen.Queries, accountID string, mutation domain.Mutation) (string, string, error) {
	if mutation.EntityType == "part_type" && mutation.Operation == "update" {
		owned, err := partTypeOwned(ctx, queries, accountID, mutation.EntityID)
		if err != nil {
			return "", "", err
		}
		if !owned {
			return "ownership_invalid", "Part type does not belong to this account.", nil
		}
	}
	if mutation.EntityType != "vehicle" && mutation.EntityType != "part_type" {
		exists, err := queries.VehicleExists(ctx, sqlcgen.VehicleExistsParams{
			AccountID: accountID, ID: stringValue(mutation.Payload, "vehicle_id"),
		})
		if err != nil {
			return "", "", fmt.Errorf("check vehicle ownership: %w", err)
		}
		if !exists {
			return "ownership_invalid", "Vehicle does not belong to this account.", nil
		}
	}
	if mutation.EntityType == "reminder_config" || mutation.EntityType == "service_log" {
		// Inactive but owned part types are still valid historical references.
		owned, err := partTypeOwned(ctx, queries, accountID, stringValue(mutation.Payload, "part_type_id"))
		if err != nil {
			return "", "", err
		}
		if !owned {
			return "ownership_invalid", "Part type does not belong to this account.", nil
		}
	}
	return checkMutationReferences(ctx, queries, accountID, mutation)
}

func partTypeOwned(ctx context.Context, queries *sqlcgen.Queries, accountID, partTypeID string) (bool, error) {
	owned, err := queries.PartTypeOwnedByAccount(ctx, sqlcgen.PartTypeOwnedByAccountParams{ID: partTypeID, AccountID: accountID})
	if err != nil {
		return false, fmt.Errorf("check part type ownership: %w", err)
	}
	return owned, nil
}

func checkMutationReferences(ctx context.Context, queries *sqlcgen.Queries, accountID string, mutation domain.Mutation) (string, string, error) {
	if mutation.EntityType == "fuel_log" {
		if odometerID := stringValue(mutation.Payload, "odometer_log_id"); odometerID != "" {
			matches, err := queries.OdometerLogBelongsToVehicle(ctx, sqlcgen.OdometerLogBelongsToVehicleParams{
				AccountID: accountID, ID: odometerID, VehicleID: stringValue(mutation.Payload, "vehicle_id"),
			})
			if err != nil {
				return "", "", fmt.Errorf("check fuel odometer vehicle: %w", err)
			}
			if !matches {
				return "validation_failed", "Odometer reading does not belong to this vehicle.", nil
			}
		}
	}
	if mutation.EntityType == "reminder_config" && mutation.Payload["deleted_at"] == nil {
		conflict, err := activeReminderScopeConflict(ctx, queries, accountID, mutation)
		if err != nil {
			return "", "", err
		}
		if conflict {
			return "validation_failed", "An active reminder already exists for this vehicle and part type.", nil
		}
	}
	return "", "", nil
}

func activeReminderScopeConflict(ctx context.Context, queries *sqlcgen.Queries, accountID string, mutation domain.Mutation) (bool, error) {
	_, err := queries.FindActiveReminderScopeOwner(ctx, sqlcgen.FindActiveReminderScopeOwnerParams{
		AccountID: accountID, VehicleID: stringValue(mutation.Payload, "vehicle_id"),
		PartTypeID: stringValue(mutation.Payload, "part_type_id"), ID: mutation.EntityID,
	})
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("find active reminder scope owner: %w", err)
	}
	return true, nil
}
