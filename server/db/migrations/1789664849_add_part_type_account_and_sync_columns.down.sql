DROP INDEX IF EXISTS part_types_account_idx;
ALTER TABLE part_types
    DROP COLUMN received_at_server,
    DROP COLUMN server_seq,
    DROP COLUMN account_id;
