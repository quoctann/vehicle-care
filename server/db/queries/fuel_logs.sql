-- name: FuelLogExists :one
SELECT EXISTS (
    SELECT 1 FROM fuel_logs WHERE account_id = $1 AND id = $2
);

-- name: FindFuelLog :one
-- A sql.ErrNoRows result means this append-only log has not been applied
-- yet (not a duplicate).
SELECT server_seq, received_at_server FROM fuel_logs WHERE account_id = $1 AND id = $2;

-- name: InsertFuelLog :exec
INSERT INTO fuel_logs (account_id, id, vehicle_id, recorded_at, liters, cost_vnd, shop, note, odometer_log_id, is_full_tank, server_seq, received_at_server)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12);
