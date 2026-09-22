-- +migrate up
-- allow_part_type_in_change_feed
--
-- change_feed's entity_type CHECK never included 'part_type', even though
-- part_type became a mutable, sync/push-able entity (see
-- 1789664849_add_part_type_account_and_sync_columns). Any part_type
-- create/update mutation has always failed at InsertChange with a check
-- constraint violation (23514) — this closes that gap.
ALTER TABLE change_feed
    DROP CONSTRAINT change_feed_entity_type_check;

ALTER TABLE change_feed
    ADD CONSTRAINT change_feed_entity_type_check
    CHECK (entity_type IN ('vehicle','reminder_config','odometer_log','fuel_log','service_log','part_type'));
