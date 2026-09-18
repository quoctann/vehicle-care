CREATE TABLE account_sequences (
    account_id   uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
    current_seq  bigint NOT NULL DEFAULT 0 CHECK (current_seq >= 0)
);
