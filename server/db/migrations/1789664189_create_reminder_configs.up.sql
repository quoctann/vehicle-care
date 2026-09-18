CREATE TABLE reminder_configs (
    account_id            uuid NOT NULL,
    id                    uuid NOT NULL,
    vehicle_id            uuid NOT NULL,
    part_type_id          uuid NOT NULL REFERENCES part_types(id),
    interval_km           numeric(10,2) NULL CHECK (interval_km IS NULL OR interval_km > 0),
    interval_days         integer NULL CHECK (interval_days IS NULL OR interval_days > 0),
    baseline_odometer_km  numeric(10,2) NULL CHECK (baseline_odometer_km IS NULL OR baseline_odometer_km >= 0),
    baseline_date         date NULL,
    enabled               boolean NOT NULL,
    deleted_at            timestamptz NULL,
    server_seq            bigint NOT NULL,
    received_at_server    timestamptz NOT NULL,
    PRIMARY KEY (account_id, id),
    FOREIGN KEY (account_id, vehicle_id) REFERENCES vehicles(account_id, id),
    CONSTRAINT reminder_configs_interval_required CHECK (interval_km IS NOT NULL OR interval_days IS NOT NULL)
);
CREATE UNIQUE INDEX reminder_configs_active_scope_uidx ON reminder_configs (account_id, vehicle_id, part_type_id) WHERE deleted_at IS NULL;
CREATE INDEX reminder_configs_lookup_idx ON reminder_configs (account_id, vehicle_id, part_type_id);
