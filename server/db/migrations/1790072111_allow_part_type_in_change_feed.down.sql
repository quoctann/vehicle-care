-- +migrate down
-- allow_part_type_in_change_feed
ALTER TABLE change_feed
    DROP CONSTRAINT change_feed_entity_type_check;

ALTER TABLE change_feed
    ADD CONSTRAINT change_feed_entity_type_check
    CHECK (entity_type IN ('vehicle','reminder_config','odometer_log','fuel_log','service_log'));
