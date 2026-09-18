-- name: RegisterDeviceIfAbsent :one
-- Atomic insert-if-absent: returns the row only when this call created it.
-- When it returns sql.ErrNoRows, the device was already registered and the
-- caller must look up its original registered_at with FindDeviceRegisteredAt.
INSERT INTO devices (account_id, device_id, registered_at)
VALUES ($1, $2, $3)
ON CONFLICT (account_id, device_id) DO NOTHING
RETURNING registered_at;

-- name: FindDeviceRegisteredAt :one
SELECT registered_at FROM devices WHERE account_id = $1 AND device_id = $2;

-- name: DeviceRegistered :one
SELECT EXISTS (
    SELECT 1 FROM devices WHERE account_id = $1 AND device_id = $2
);
