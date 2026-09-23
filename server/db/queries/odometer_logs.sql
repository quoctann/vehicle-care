-- name: OdometerLogExists :one
SELECT EXISTS (
    SELECT 1 FROM odometer_logs WHERE account_id = $1 AND id = $2
);

-- name: CanonicalOdometerLogPayload :one
SELECT jsonb_build_object(
    'vehicle_id', vehicle_id,
    'odometer_km', odometer_km,
    'recorded_at', recorded_at,
    'source', source,
    'note', note
)
FROM odometer_logs
WHERE account_id = $1 AND id = $2;

-- name: FindOdometerLog :one
-- A sql.ErrNoRows result means this append-only log has not been applied
-- yet (not a duplicate).
SELECT server_seq, received_at_server FROM odometer_logs WHERE account_id = $1 AND id = $2;

-- name: InsertOdometerLog :exec
INSERT INTO odometer_logs (account_id, id, vehicle_id, odometer_km, recorded_at, source, note, server_seq, received_at_server)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9);
