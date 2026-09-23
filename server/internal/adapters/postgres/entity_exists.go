package postgres

import (
	"context"
	"fmt"

	"github.com/quoctann/vehicle-care/server/internal/adapters/postgres/sqlcgen"
)

// EntityExists reports whether an entity snapshot belongs to an account.
func (s *Store) EntityExists(ctx context.Context, accountID, entityType, entityID string) (bool, error) {
	switch entityType {
	case "vehicle":
		exists, err := s.queries.VehicleExists(ctx, sqlcgen.VehicleExistsParams{AccountID: accountID, ID: entityID})
		return exists, wrapExistsError(entityType, err)
	case "reminder_config":
		exists, err := s.queries.ReminderConfigExists(ctx, sqlcgen.ReminderConfigExistsParams{AccountID: accountID, ID: entityID})
		return exists, wrapExistsError(entityType, err)
	case "odometer_log":
		exists, err := s.queries.OdometerLogExists(ctx, sqlcgen.OdometerLogExistsParams{AccountID: accountID, ID: entityID})
		return exists, wrapExistsError(entityType, err)
	case "fuel_log":
		exists, err := s.queries.FuelLogExists(ctx, sqlcgen.FuelLogExistsParams{AccountID: accountID, ID: entityID})
		return exists, wrapExistsError(entityType, err)
	case "service_log":
		exists, err := s.queries.ServiceLogExists(ctx, sqlcgen.ServiceLogExistsParams{AccountID: accountID, ID: entityID})
		return exists, wrapExistsError(entityType, err)
	case "part_type":
		exists, err := s.queries.PartTypeOwnedByAccount(ctx, sqlcgen.PartTypeOwnedByAccountParams{ID: entityID, AccountID: accountID})
		return exists, wrapExistsError(entityType, err)
	default:
		return false, fmt.Errorf("postgres: unsupported entity type %q", entityType)
	}
}

func (s *Store) PartTypeActive(ctx context.Context, accountID, partTypeID string) (bool, error) {
	active, err := s.queries.PartTypeActiveForAccount(ctx, sqlcgen.PartTypeActiveForAccountParams{ID: partTypeID, AccountID: accountID})
	return active, err
}

func (s *Store) EntityReferencesPartType(ctx context.Context, accountID, entityType, entityID, partTypeID string) (bool, error) {
	switch entityType {
	case "reminder_config":
		references, err := s.queries.ReminderConfigUsesPartType(ctx, sqlcgen.ReminderConfigUsesPartTypeParams{
			AccountID: accountID, ID: entityID, PartTypeID: partTypeID,
		})
		return references, err
	case "service_log":
		references, err := s.queries.ServiceLogUsesPartType(ctx, sqlcgen.ServiceLogUsesPartTypeParams{
			AccountID: accountID, ID: entityID, PartTypeID: partTypeID,
		})
		return references, err
	default:
		return false, fmt.Errorf("postgres: unsupported entity type %q", entityType)
	}
}

func wrapExistsError(entityType string, err error) error {
	if err == nil {
		return nil
	}
	return fmt.Errorf("postgres: check %s ownership: %w", entityType, err)
}
