-- name: CleanupExpiredWatermarks :exec
DELETE FROM pull_watermarks WHERE account_id = $1 AND expires_at <= $2;

-- name: MintWatermark :exec
INSERT INTO pull_watermarks (account_id, token, upper_bound, expires_at)
VALUES ($1, $2, $3, $4);

-- name: FindWatermark :one
SELECT upper_bound, expires_at FROM pull_watermarks WHERE account_id = $1 AND token = $2;
