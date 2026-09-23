-- name: ServiceLogExists :one
SELECT EXISTS (
    SELECT 1 FROM service_logs WHERE account_id = $1 AND id = $2
);

-- name: CanonicalServiceLogPayload :one
SELECT jsonb_build_object(
    'vehicle_id', vehicle_id,
    'part_type_id', part_type_id,
    'serviced_at', serviced_at,
    'odometer_km_snapshot', odometer_km_snapshot,
    'cost_vnd', cost_vnd,
    'note', note,
    'deleted_at', deleted_at
)
FROM service_logs
WHERE account_id = $1 AND id = $2;

-- name: ServiceLogUsesPartType :one
SELECT EXISTS (
    SELECT 1 FROM service_logs WHERE account_id = $1 AND id = $2 AND part_type_id = $3
);

-- name: LockServiceLogForUpdate :one
-- Row lock used to serialize concurrent mutations of the same service log. A
-- sql.ErrNoRows result means the log has no current snapshot yet.
SELECT server_seq FROM service_logs WHERE account_id = $1 AND id = $2 FOR UPDATE;

-- name: UpsertServiceLog :exec
INSERT INTO service_logs (account_id, id, vehicle_id, part_type_id, serviced_at, odometer_km_snapshot, cost_vnd, note, deleted_at, server_seq, received_at_server)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
ON CONFLICT (account_id, id) DO UPDATE
  SET vehicle_id = EXCLUDED.vehicle_id,
      part_type_id = EXCLUDED.part_type_id,
      serviced_at = EXCLUDED.serviced_at,
      odometer_km_snapshot = EXCLUDED.odometer_km_snapshot,
      cost_vnd = EXCLUDED.cost_vnd,
      note = EXCLUDED.note,
      deleted_at = EXCLUDED.deleted_at,
      server_seq = EXCLUDED.server_seq,
      received_at_server = EXCLUDED.received_at_server;
