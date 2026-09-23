package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/quoctann/vehicle-care/server/internal/adapters/postgres/sqlcgen"
)

// RegisterDevice associates an installation with an account, returning its
// original registration time whether this call created it or it already
// existed.
func (s *Store) RegisterDevice(ctx context.Context, accountID, deviceID string) (time.Time, error) {
	registeredAt, err := s.queries.RegisterDeviceIfAbsent(ctx, sqlcgen.RegisterDeviceIfAbsentParams{
		AccountID:    accountID,
		DeviceID:     deviceID,
		RegisteredAt: time.Now().UTC(),
	})
	if err == nil {
		return registeredAt, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return time.Time{}, fmt.Errorf("postgres: register device: %w", err)
	}
	registeredAt, err = s.queries.FindDeviceRegisteredAt(ctx, sqlcgen.FindDeviceRegisteredAtParams{
		AccountID: accountID,
		DeviceID:  deviceID,
	})
	if err != nil {
		return time.Time{}, fmt.Errorf("postgres: find registered device: %w", err)
	}
	return registeredAt, nil
}

// DeviceRegistered reports whether a device belongs to an account.
func (s *Store) DeviceRegistered(ctx context.Context, accountID, deviceID string) (bool, error) {
	registered, err := s.queries.DeviceRegistered(ctx, sqlcgen.DeviceRegisteredParams{
		AccountID: accountID,
		DeviceID:  deviceID,
	})
	if err != nil {
		return false, fmt.Errorf("postgres: check registered device: %w", err)
	}
	return registered, nil
}
