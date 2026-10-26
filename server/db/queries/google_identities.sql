-- name: GoogleAccountID :one
SELECT account_id FROM auth_identities WHERE provider = 'google' AND subject = $1;

-- name: GoogleLinked :one
SELECT EXISTS(SELECT 1 FROM auth_identities WHERE provider = 'google' AND account_id = $1);

-- name: InsertGoogleIdentity :exec
INSERT INTO auth_identities(account_id, provider, subject) VALUES ($1, 'google', $2);

-- name: LockGoogleSubject :exec
SELECT pg_advisory_xact_lock(hashtextextended('google:' || sqlc.arg(subject)::text, 0));
