-- +migrate down
-- part_types_owned_by_account
--
-- Reverses the schema only; does not (cannot) restore truncated data.
DROP INDEX IF EXISTS part_types_account_idx;
CREATE INDEX part_types_account_idx ON part_types (account_id) WHERE account_id IS NOT NULL;

ALTER TABLE reminder_configs
    DROP CONSTRAINT reminder_configs_account_part_type_fkey,
    ADD CONSTRAINT reminder_configs_part_type_id_fkey
        FOREIGN KEY (part_type_id) REFERENCES part_types(id);

ALTER TABLE service_logs
    DROP CONSTRAINT service_logs_account_part_type_fkey,
    ADD CONSTRAINT service_logs_part_type_id_fkey
        FOREIGN KEY (part_type_id) REFERENCES part_types(id);

ALTER TABLE part_types
    DROP CONSTRAINT part_types_account_id_code_key,
    DROP CONSTRAINT part_types_account_id_id_key;

ALTER TABLE part_types
    ADD CONSTRAINT part_types_code_unique UNIQUE (code);

ALTER TABLE part_types
    ALTER COLUMN account_id DROP NOT NULL;
