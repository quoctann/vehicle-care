CREATE TABLE change_feed (
    row_id              bigserial PRIMARY KEY,
    account_id          uuid NOT NULL,
    server_seq          bigint NOT NULL,
    entity_type         text NOT NULL CHECK (entity_type IN ('vehicle','reminder_config','odometer_log','fuel_log','service_log')),
    entity_id           uuid NOT NULL,
    operation           text NOT NULL CHECK (operation IN ('create','update')),
    payload             jsonb NOT NULL,
    received_at_server  timestamptz NOT NULL,
    CONSTRAINT change_feed_account_seq_unique UNIQUE (account_id, server_seq)
);
