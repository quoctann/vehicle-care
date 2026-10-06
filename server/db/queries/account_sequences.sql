-- Create new sequence with initial value 0 for new account
-- name: CreateAccountSequence :exec
INSERT INTO account_sequences (account_id, current_seq) VALUES ($1, 0);

-- Increase current sequence and return the new value
-- name: NextAccountSequence :one
UPDATE account_sequences SET current_seq = current_seq + 1 WHERE account_id = $1 RETURNING current_seq;

-- name: CurrentAccountSequence :one
SELECT current_seq FROM account_sequences WHERE account_id = $1;
