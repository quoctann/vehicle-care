-- name: InsertAccountSequenceRow :exec
INSERT INTO account_sequences (account_id, current_seq) VALUES ($1, 0);

-- name: NextSeq :one
UPDATE account_sequences SET current_seq = current_seq + 1 WHERE account_id = $1 RETURNING current_seq;

-- name: CurrentSeq :one
SELECT current_seq FROM account_sequences WHERE account_id = $1;
