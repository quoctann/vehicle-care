-- name: GoogleAccountID :one
SELECT account_id FROM auth_identities WHERE provider = 'google' AND subject = $1;

-- name: GoogleLinked :one
SELECT EXISTS(SELECT 1 FROM auth_identities WHERE provider = 'google' AND account_id = $1);

-- name: InsertGoogleIdentity :exec
INSERT INTO auth_identities(account_id, provider, subject) VALUES ($1, 'google', $2);

-- name: LockGoogleSubject :exec
-- This advisory lock is used to prevent concurrent inserts of the same google
-- subject. Subject is hashed to a 64-bit integer using hashtextextended, which
-- is then used to acquire an exclusive lock for the duration of the
-- transaction. This ensures that only one transaction can insert a given google
-- subject at a time, preventing duplicate entries in table.
SELECT pg_advisory_xact_lock(hashtextextended('google:' || sqlc.arg(subject)::text, 0));
