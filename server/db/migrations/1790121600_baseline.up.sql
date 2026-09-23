-- Unix timestamp version, consistent with cmd/migrate create.
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE accounts (
    id              uuid PRIMARY KEY,
    email           citext NOT NULL,
    name            text NULL,
    timezone        text NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
    email_verified  boolean NOT NULL DEFAULT false,
    password_hash   bytea NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT accounts_email_unique UNIQUE (email)
);

CREATE TABLE devices (
    account_id     uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    device_id      text NOT NULL CHECK (char_length(device_id) BETWEEN 1 AND 200),
    platform       text NULL,
    app_version    text NULL,
    registered_at  timestamptz NOT NULL,
    last_seen_at   timestamptz NULL,
    PRIMARY KEY (account_id, device_id)
);

CREATE TABLE account_sequences (
    account_id   uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
    current_seq  bigint NOT NULL DEFAULT 0 CHECK (current_seq >= 0)
);

CREATE TABLE part_types (
    id                  uuid PRIMARY KEY,
    account_id          uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    code                text NOT NULL CHECK (char_length(code) BETWEEN 1 AND 500),
    name_vi             text NOT NULL CHECK (char_length(name_vi) BETWEEN 1 AND 500),
    display_order       integer NOT NULL CHECK (display_order >= 0),
    active              boolean NOT NULL DEFAULT true,
    seed_version        text NOT NULL CHECK (char_length(seed_version) BETWEEN 1 AND 500),
    server_seq          bigint NOT NULL CHECK (server_seq > 0),
    received_at_server  timestamptz NOT NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (account_id, code),
    UNIQUE (account_id, id)
);
CREATE INDEX part_types_account_idx ON part_types (account_id);

CREATE TABLE vehicles (
    account_id          uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    id                  uuid NOT NULL,
    name                text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 500),
    plate_number        text NULL CHECK (plate_number IS NULL OR char_length(plate_number) <= 2000),
    archived_at         timestamptz NULL,
    deleted_at          timestamptz NULL,
    due_soon_ratio      numeric(4,3) NULL CHECK (due_soon_ratio IS NULL OR (due_soon_ratio > 0 AND due_soon_ratio <= 1)),
    server_seq          bigint NOT NULL CHECK (server_seq > 0),
    received_at_server  timestamptz NOT NULL,
    PRIMARY KEY (account_id, id)
);
CREATE INDEX vehicles_account_active_idx ON vehicles (account_id) WHERE deleted_at IS NULL;

CREATE TABLE reminder_configs (
    account_id            uuid NOT NULL,
    id                    uuid NOT NULL,
    vehicle_id            uuid NOT NULL,
    part_type_id          uuid NOT NULL,
    interval_km           numeric(10,2) NULL CHECK (interval_km IS NULL OR interval_km > 0),
    interval_days         integer NULL CHECK (interval_days IS NULL OR interval_days > 0),
    baseline_odometer_km  numeric(10,2) NULL CHECK (baseline_odometer_km IS NULL OR baseline_odometer_km >= 0),
    baseline_date         date NULL,
    enabled               boolean NOT NULL,
    deleted_at            timestamptz NULL,
    server_seq            bigint NOT NULL CHECK (server_seq > 0),
    received_at_server    timestamptz NOT NULL,
    PRIMARY KEY (account_id, id),
    FOREIGN KEY (account_id, vehicle_id) REFERENCES vehicles(account_id, id),
    FOREIGN KEY (account_id, part_type_id) REFERENCES part_types(account_id, id),
    CONSTRAINT reminder_configs_interval_required CHECK (interval_km IS NOT NULL OR interval_days IS NOT NULL)
);
CREATE UNIQUE INDEX reminder_configs_active_scope_uidx
    ON reminder_configs (account_id, vehicle_id, part_type_id)
    WHERE deleted_at IS NULL;
CREATE INDEX reminder_configs_lookup_idx
    ON reminder_configs (account_id, vehicle_id, part_type_id);

CREATE TABLE odometer_logs (
    account_id          uuid NOT NULL,
    id                  uuid NOT NULL,
    vehicle_id          uuid NOT NULL,
    odometer_km         numeric(10,2) NOT NULL CHECK (odometer_km >= 0),
    recorded_at         timestamptz NOT NULL,
    source              text NOT NULL CHECK (source IN ('manual', 'fuel')),
    note                text NULL CHECK (note IS NULL OR char_length(note) <= 2000),
    server_seq          bigint NOT NULL CHECK (server_seq > 0),
    received_at_server  timestamptz NOT NULL,
    PRIMARY KEY (account_id, id),
    FOREIGN KEY (account_id, vehicle_id) REFERENCES vehicles(account_id, id)
);
CREATE INDEX odometer_logs_vehicle_time_idx
    ON odometer_logs (account_id, vehicle_id, recorded_at);

CREATE TABLE fuel_logs (
    account_id          uuid NOT NULL,
    id                  uuid NOT NULL,
    vehicle_id          uuid NOT NULL,
    recorded_at         timestamptz NOT NULL,
    liters              numeric(6,2) NULL CHECK (liters IS NULL OR liters > 0),
    cost_vnd            bigint NULL CHECK (cost_vnd IS NULL OR cost_vnd >= 0),
    shop                text NULL CHECK (shop IS NULL OR char_length(shop) <= 2000),
    note                text NULL CHECK (note IS NULL OR char_length(note) <= 2000),
    odometer_log_id     uuid NULL,
    is_full_tank        boolean NOT NULL,
    deleted_at          timestamptz NULL,
    server_seq          bigint NOT NULL CHECK (server_seq > 0),
    received_at_server  timestamptz NOT NULL,
    PRIMARY KEY (account_id, id),
    FOREIGN KEY (account_id, vehicle_id) REFERENCES vehicles(account_id, id),
    FOREIGN KEY (account_id, odometer_log_id) REFERENCES odometer_logs(account_id, id)
);
CREATE INDEX fuel_logs_vehicle_time_idx
    ON fuel_logs (account_id, vehicle_id, recorded_at);

CREATE TABLE service_logs (
    account_id          uuid NOT NULL,
    id                  uuid NOT NULL,
    vehicle_id          uuid NOT NULL,
    part_type_id        uuid NOT NULL,
    serviced_at         timestamptz NOT NULL,
    odometer_km_snapshot numeric(10,2) NULL CHECK (odometer_km_snapshot IS NULL OR odometer_km_snapshot >= 0),
    cost_vnd            bigint NULL CHECK (cost_vnd IS NULL OR cost_vnd >= 0),
    note                text NULL CHECK (note IS NULL OR char_length(note) <= 2000),
    deleted_at          timestamptz NULL,
    server_seq          bigint NOT NULL CHECK (server_seq > 0),
    received_at_server  timestamptz NOT NULL,
    PRIMARY KEY (account_id, id),
    FOREIGN KEY (account_id, vehicle_id) REFERENCES vehicles(account_id, id),
    FOREIGN KEY (account_id, part_type_id) REFERENCES part_types(account_id, id)
);
CREATE INDEX service_logs_vehicle_part_time_idx
    ON service_logs (account_id, vehicle_id, part_type_id, serviced_at);

CREATE TABLE change_feed (
    row_id              bigserial PRIMARY KEY,
    account_id          uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    server_seq          bigint NOT NULL CHECK (server_seq > 0),
    entity_type         text NOT NULL CHECK (entity_type IN ('vehicle', 'reminder_config', 'odometer_log', 'fuel_log', 'service_log', 'part_type')),
    entity_id           uuid NOT NULL,
    operation           text NOT NULL CHECK (operation IN ('create', 'update')),
    payload             jsonb NOT NULL,
    received_at_server  timestamptz NOT NULL,
    UNIQUE (account_id, server_seq)
);

CREATE TABLE processed_mutations (
    account_id          uuid NOT NULL,
    device_id           text NOT NULL,
    mutation_id         text NOT NULL CHECK (char_length(mutation_id) BETWEEN 1 AND 200),
    entity_type         text NOT NULL CHECK (entity_type IN ('vehicle', 'reminder_config', 'odometer_log', 'fuel_log', 'service_log', 'part_type')),
    entity_id           uuid NOT NULL,
    status              text NOT NULL CHECK (status IN ('applied', 'duplicate', 'rejected')),
    server_seq          bigint NULL,
    received_at_server  timestamptz NULL,
    error_code          text NULL,
    error_message       text NULL,
    retryable           boolean NULL,
    server_snapshot     jsonb NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (account_id, device_id, mutation_id),
    FOREIGN KEY (account_id, device_id) REFERENCES devices(account_id, device_id) ON DELETE CASCADE
);

CREATE TABLE notification_deliveries (
    id                  bigserial PRIMARY KEY,
    account_id          uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    vehicle_id          uuid NOT NULL,
    reminder_config_id  uuid NOT NULL,
    idempotency_key     text NOT NULL,
    status              text NOT NULL CHECK (status IN ('sent', 'failed_retryable', 'failed_permanent')),
    attempted_at        timestamptz NOT NULL DEFAULT now(),
    sent_at             timestamptz NULL,
    error_message       text NULL,
    FOREIGN KEY (account_id, vehicle_id) REFERENCES vehicles(account_id, id),
    FOREIGN KEY (account_id, reminder_config_id) REFERENCES reminder_configs(account_id, id),
    UNIQUE (account_id, idempotency_key)
);
