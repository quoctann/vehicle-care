-- name: VehicleExists :one
SELECT EXISTS (
    SELECT 1 FROM vehicles WHERE account_id = $1 AND id = $2
);

-- name: LockVehicleForUpdate :one
-- Row lock used to serialize concurrent mutations of the same vehicle. A
-- sql.ErrNoRows result means the vehicle has no current snapshot yet.
SELECT server_seq FROM vehicles WHERE account_id = $1 AND id = $2 FOR UPDATE;

-- name: UpsertVehicle :exec
INSERT INTO vehicles (account_id, id, name, plate_number, archived_at, deleted_at, due_soon_ratio, server_seq, received_at_server)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
ON CONFLICT (account_id, id) DO UPDATE
  SET name = EXCLUDED.name,
      plate_number = EXCLUDED.plate_number,
      archived_at = EXCLUDED.archived_at,
      deleted_at = EXCLUDED.deleted_at,
      due_soon_ratio = EXCLUDED.due_soon_ratio,
      server_seq = EXCLUDED.server_seq,
      received_at_server = EXCLUDED.received_at_server;
