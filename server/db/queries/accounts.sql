-- name: InsertAccount :exec
INSERT INTO accounts (id, email, name, timezone, email_verified, password_hash)
VALUES ($1, $2, $3, $4, $5, $6);

-- name: AccountByEmail :one
SELECT id, email, name, timezone, email_verified, password_hash
FROM accounts
WHERE email = $1;

-- name: AccountByID :one
SELECT id, email, name, timezone, email_verified, password_hash
FROM accounts
WHERE id = $1;

-- name: SetEmailVerified :exec
UPDATE accounts SET email_verified = true, updated_at = now() WHERE id = $1;

-- name: SetPassword :exec
UPDATE accounts SET password_hash = $2, updated_at = now() WHERE id = $1;
