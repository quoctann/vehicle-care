-- name: FindProcessedMutationForUpdate :one
SELECT entity_type, entity_id, status, server_seq, received_at_server, error_code, error_message, retryable, server_snapshot
FROM processed_mutations
WHERE account_id = $1 AND device_id = $2 AND mutation_id = $3
FOR UPDATE;

-- name: InsertProcessedMutation :exec
INSERT INTO processed_mutations (
    account_id, device_id, mutation_id, entity_type, entity_id, status,
    server_seq, received_at_server, error_code, error_message, retryable, server_snapshot
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12);
