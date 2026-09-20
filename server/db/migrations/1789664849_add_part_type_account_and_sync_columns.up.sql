ALTER TABLE part_types
    ADD COLUMN account_id uuid NULL REFERENCES accounts(id) ON DELETE CASCADE,
    ADD COLUMN server_seq bigint NOT NULL DEFAULT 0,
    ADD COLUMN received_at_server timestamptz NOT NULL DEFAULT now();

CREATE INDEX part_types_account_idx ON part_types (account_id) WHERE account_id IS NOT NULL;
