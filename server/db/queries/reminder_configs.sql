-- name: ReminderConfigExists :one
SELECT EXISTS (
    SELECT 1 FROM reminder_configs WHERE account_id = $1 AND id = $2
);

-- name: LockReminderConfigForUpdate :one
-- Row lock used to serialize concurrent mutations of the same reminder
-- config. A sql.ErrNoRows result means it has no current snapshot yet.
SELECT server_seq FROM reminder_configs WHERE account_id = $1 AND id = $2 FOR UPDATE;

-- name: FindActiveReminderScopeOwner :one
-- Pre-check for the D7 uniqueness rule: an active (non-deleted) reminder
-- already owns this (vehicle_id, part_type_id) scope, and it is not the
-- entity currently being mutated.
SELECT id FROM reminder_configs
WHERE account_id = $1 AND vehicle_id = $2 AND part_type_id = $3 AND deleted_at IS NULL AND id <> $4
LIMIT 1;

-- name: UpsertReminderConfig :exec
INSERT INTO reminder_configs (
    account_id, id, vehicle_id, part_type_id, interval_km, interval_days,
    baseline_odometer_km, baseline_date, enabled, deleted_at, server_seq, received_at_server
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
ON CONFLICT (account_id, id) DO UPDATE
  SET vehicle_id = EXCLUDED.vehicle_id,
      part_type_id = EXCLUDED.part_type_id,
      interval_km = EXCLUDED.interval_km,
      interval_days = EXCLUDED.interval_days,
      baseline_odometer_km = EXCLUDED.baseline_odometer_km,
      baseline_date = EXCLUDED.baseline_date,
      enabled = EXCLUDED.enabled,
      deleted_at = EXCLUDED.deleted_at,
      server_seq = EXCLUDED.server_seq,
      received_at_server = EXCLUDED.received_at_server;
