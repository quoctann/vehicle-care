-- name: InsertChange :exec
INSERT INTO change_feed (account_id, server_seq, entity_type, entity_id, operation, payload, received_at_server)
VALUES ($1, $2, $3, $4, $5, $6, $7);

-- name: ListChangesInRange :many
SELECT server_seq, entity_type, entity_id, operation, payload, received_at_server
FROM change_feed
WHERE account_id = $1 AND server_seq > $2 AND server_seq <= $3
ORDER BY server_seq ASC
LIMIT $4;
