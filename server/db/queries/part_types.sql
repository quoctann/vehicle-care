-- name: ListPartTypes :many
-- This account's own part_types rows (seeded at signup plus anything it
-- added itself); seeded rows sort first by display_order, custom rows after
-- in creation order (display_order is a fixed constant for custom rows, see
-- buildUpsertPartTypeParams). Includes server_seq/received_at_server so the
-- client can learn the real server_seq for a bootstrapped row instead of
-- treating it as "never seen from server" (see domain.PartType doc comment).
SELECT id, code, name_vi, display_order, active, seed_version, account_id, server_seq, received_at_server
FROM part_types
WHERE account_id = $1
ORDER BY display_order, created_at;

-- name: CanonicalPartTypePayload :one
SELECT jsonb_build_object(
    'code', code,
    'name_vi', name_vi,
    'display_order', display_order,
    'active', active,
    'seed_version', seed_version
)
FROM part_types
WHERE account_id = $1 AND id = $2;

-- name: LockPartTypeForUpdate :one
-- Row lock scoped to THIS account — a sql.ErrNoRows result means either the
-- row doesn't exist yet, or it exists but is a global/other-account row this
-- account cannot mutate (validateMutation rejects that case separately with
-- ownership_invalid before this is reached for "update").
SELECT server_seq FROM part_types WHERE account_id = $1 AND id = $2 FOR UPDATE;

-- name: UpsertPartType :execrows
INSERT INTO part_types (id, account_id, code, name_vi, display_order, active, seed_version, server_seq, received_at_server)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
ON CONFLICT (id) DO UPDATE
  SET name_vi = EXCLUDED.name_vi,
      active = EXCLUDED.active,
      server_seq = EXCLUDED.server_seq,
      received_at_server = EXCLUDED.received_at_server
  WHERE part_types.account_id = EXCLUDED.account_id;

-- name: PartTypeOwnedByAccount :one
SELECT EXISTS (
    SELECT 1 FROM part_types WHERE id = $1 AND account_id = $2
);

-- name: PartTypeActiveForAccount :one
SELECT EXISTS (
    SELECT 1 FROM part_types WHERE id = $1 AND account_id = $2 AND active
);
