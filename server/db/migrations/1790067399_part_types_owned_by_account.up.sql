-- +migrate up
-- part_types_owned_by_account
--
-- part_types loses its global/shared tier: every row now belongs to exactly
-- one account from creation, fully owned/mutable by that account (no more
-- account_id IS NULL rows). Zero real users exist yet, so this is a
-- destructive reset, not a backfill. TRUNCATE ... CASCADE also empties
-- reminder_configs, service_logs, and (transitively) notification_deliveries,
-- since those tables FK into part_types(id) with no meaningful way to remap
-- old rows onto new per-account part_type ids.
TRUNCATE TABLE part_types CASCADE;

ALTER TABLE part_types
    ALTER COLUMN account_id SET NOT NULL;

ALTER TABLE part_types
    DROP CONSTRAINT part_types_code_unique;

ALTER TABLE part_types
    ADD CONSTRAINT part_types_account_id_code_key UNIQUE (account_id, code);

ALTER TABLE part_types
    ADD CONSTRAINT part_types_account_id_id_key UNIQUE (account_id, id);

ALTER TABLE reminder_configs
    DROP CONSTRAINT reminder_configs_part_type_id_fkey,
    ADD CONSTRAINT reminder_configs_account_part_type_fkey
        FOREIGN KEY (account_id, part_type_id) REFERENCES part_types(account_id, id);

ALTER TABLE service_logs
    DROP CONSTRAINT service_logs_part_type_id_fkey,
    ADD CONSTRAINT service_logs_account_part_type_fkey
        FOREIGN KEY (account_id, part_type_id) REFERENCES part_types(account_id, id);

DROP INDEX IF EXISTS part_types_account_idx;
CREATE INDEX part_types_account_idx ON part_types (account_id);
