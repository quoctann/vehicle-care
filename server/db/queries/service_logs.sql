-- name: ServiceLogExists :one
SELECT EXISTS (
    SELECT 1 FROM service_logs WHERE account_id = $1 AND id = $2
);

-- name: FindServiceLog :one
-- A sql.ErrNoRows result means this append-only log has not been applied
-- yet (not a duplicate).
SELECT server_seq, received_at_server FROM service_logs WHERE account_id = $1 AND id = $2;

-- name: InsertServiceLog :exec
INSERT INTO service_logs (account_id, id, vehicle_id, part_type_id, serviced_at, odometer_km_snapshot, cost_vnd, note, server_seq, received_at_server)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10);
