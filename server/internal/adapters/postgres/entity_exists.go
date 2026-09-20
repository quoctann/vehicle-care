package postgres

import (
	"context"

	"github.com/quoctann/vehicle-care/server/internal/adapters/postgres/sqlcgen"
)

// EntityExists reports whether an entity snapshot belongs to an account. It
// is used by application.Service to validate vehicle ownership before a
// mutation is applied, so an unexpected database error is treated as "does
// not exist" (fail closed) rather than surfaced, matching this method's
// bool-only signature in ports.SyncStore.
func (s *Store) EntityExists(ctx context.Context, accountID, entityType, entityID string) bool {
	switch entityType {
	case "vehicle":
		exists, err := s.queries.VehicleExists(ctx, sqlcgen.VehicleExistsParams{AccountID: accountID, ID: entityID})
		return err == nil && exists
	case "reminder_config":
		exists, err := s.queries.ReminderConfigExists(ctx, sqlcgen.ReminderConfigExistsParams{AccountID: accountID, ID: entityID})
		return err == nil && exists
	case "odometer_log":
		exists, err := s.queries.OdometerLogExists(ctx, sqlcgen.OdometerLogExistsParams{AccountID: accountID, ID: entityID})
		return err == nil && exists
	case "fuel_log":
		exists, err := s.queries.FuelLogExists(ctx, sqlcgen.FuelLogExistsParams{AccountID: accountID, ID: entityID})
		return err == nil && exists
	case "service_log":
		exists, err := s.queries.ServiceLogExists(ctx, sqlcgen.ServiceLogExistsParams{AccountID: accountID, ID: entityID})
		return err == nil && exists
	case "part_type":
		exists, err := s.queries.PartTypeOwnedByAccount(ctx, sqlcgen.PartTypeOwnedByAccountParams{ID: entityID, AccountID: &accountID})
		return err == nil && exists
	default:
		return false
	}
}
