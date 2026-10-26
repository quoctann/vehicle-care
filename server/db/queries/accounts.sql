-- name: InsertAccount :exec
INSERT INTO accounts (id, email, name, timezone, email_verified, password_hash)
VALUES ($1, $2, $3, $4, $5, $6);

-- name: AccountByEmail :one
SELECT id, email, name, timezone, email_verified, password_hash, auth_version
FROM accounts
WHERE email = $1;

-- name: AccountByID :one
SELECT id, email, name, timezone, email_verified, password_hash, auth_version
FROM accounts
WHERE id = $1;

-- name: LockAccountAuthVersion :one
SELECT auth_version FROM accounts WHERE id = $1 FOR UPDATE;

-- name: SetEmailVerified :exec
UPDATE accounts SET email_verified = true, updated_at = now() WHERE id = $1;

-- name: SetPassword :execrows
UPDATE accounts SET password_hash = $2, auth_version = auth_version + 1, updated_at = now()
WHERE id = $1 AND auth_version = $3 AND password_hash IS NOT NULL;

-- name: UpdateAccountTimezone :one
UPDATE accounts SET timezone = $2, updated_at = now() WHERE id = $1
RETURNING id, email, name, timezone, email_verified, password_hash, auth_version;
