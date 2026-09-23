package postgres_test

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/quoctann/vehicle-care/server/internal/adapters/postgres"
	"github.com/quoctann/vehicle-care/server/internal/adapters/postgres/pgtest"
	"github.com/quoctann/vehicle-care/server/internal/adapters/postgres/seed"
	"github.com/quoctann/vehicle-care/server/internal/domain"
)

var initialAccountSeq = int64(len(seed.Manifest))

// newTestStore starts an ephemeral, migrated PostgreSQL container and opens
// a Store against it. It skips the test (via pgtest.StartDSN) when Docker
// is unavailable. The DSN is also returned for tests that need a second,
// direct *sql.DB connection.
func newTestStore(t *testing.T) (*postgres.Store, string) {
	t.Helper()
	dsn := pgtest.StartDSN(t)
	store, err := postgres.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return store, dsn
}

// newAccount creates a fresh account (and its account_sequences row via
// CreateAccount) and returns its ID.
func newAccount(t *testing.T, store *postgres.Store) string {
	t.Helper()
	id := uuid.NewString()
	err := store.CreateAccount(context.Background(), domain.Account{
		ID: id, Email: id + "@example.test", Timezone: "Asia/Ho_Chi_Minh",
	})
	if err != nil {
		t.Fatalf("create account: %v", err)
	}
	for _, deviceID := range []string{"device-1", "device-2", "device-a", "device-b"} {
		registerTestDevice(t, store, id, deviceID)
	}
	return id
}

func registerTestDevice(t *testing.T, store *postgres.Store, accountID, deviceID string) {
	t.Helper()
	if _, err := store.RegisterDevice(context.Background(), accountID, deviceID); err != nil {
		t.Fatalf("register test device: %v", err)
	}
}

// createVehicle applies a "create vehicle" mutation and returns the new
// vehicle's ID, for tests that need a real vehicle row to satisfy the
// vehicle_id foreign key on other entities.
func createVehicle(t *testing.T, store *postgres.Store, accountID, deviceID string) string {
	t.Helper()
	vehicleID := uuid.NewString()
	results := store.ApplyMutations(context.Background(), accountID, deviceID, []domain.Mutation{{
		MutationID: uuid.NewString(), EntityType: "vehicle", Operation: "create", EntityID: vehicleID,
		Payload: map[string]any{"name": "Test Vehicle"},
	}}, time.Now().UTC())
	if len(results) != 1 || results[0].Status != "applied" {
		t.Fatalf("create vehicle: unexpected result: %#v", results)
	}
	return vehicleID
}

// seedPartTypes returns the code -> id map for accountID's own part_types
// rows, already created automatically by CreateAccount (see
// postgres/seed.SeedAccountPartTypes), for tests that need a real
// part_type_id to satisfy foreign keys on reminder_configs/service_logs.
func seedPartTypes(t *testing.T, store *postgres.Store, accountID string) map[string]string {
	t.Helper()
	partTypes, err := store.ListPartTypes(context.Background(), accountID)
	if err != nil {
		t.Fatalf("list part types: %v", err)
	}
	byCode := make(map[string]string, len(partTypes))
	for _, partType := range partTypes {
		byCode[partType.Code] = partType.ID
	}
	return byCode
}
