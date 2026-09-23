-- name: FuelLogExists :one
SELECT EXISTS (
    SELECT 1 FROM fuel_logs WHERE account_id = $1 AND id = $2
);

-- name: CanonicalFuelLogPayload :one
SELECT jsonb_build_object(
    'vehicle_id', vehicle_id,
    'recorded_at', recorded_at,
    'liters', liters,
    'cost_vnd', cost_vnd,
    'shop', shop,
    'note', note,
    'odometer_log_id', odometer_log_id,
    'is_full_tank', is_full_tank,
    'deleted_at', deleted_at
)
FROM fuel_logs
WHERE account_id = $1 AND id = $2;

-- name: LockFuelLogForUpdate :one
-- Row lock used to serialize concurrent mutations of the same fuel log. A
-- sql.ErrNoRows result means the log has no current snapshot yet.
SELECT server_seq FROM fuel_logs WHERE account_id = $1 AND id = $2 FOR UPDATE;

-- name: UpsertFuelLog :exec
INSERT INTO fuel_logs (account_id, id, vehicle_id, recorded_at, liters, cost_vnd, shop, note, odometer_log_id, is_full_tank, deleted_at, server_seq, received_at_server)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
ON CONFLICT (account_id, id) DO UPDATE
  SET vehicle_id = EXCLUDED.vehicle_id,
      recorded_at = EXCLUDED.recorded_at,
      liters = EXCLUDED.liters,
      cost_vnd = EXCLUDED.cost_vnd,
      shop = EXCLUDED.shop,
      note = EXCLUDED.note,
      odometer_log_id = EXCLUDED.odometer_log_id,
      is_full_tank = EXCLUDED.is_full_tank,
      deleted_at = EXCLUDED.deleted_at,
      server_seq = EXCLUDED.server_seq,
      received_at_server = EXCLUDED.received_at_server;
