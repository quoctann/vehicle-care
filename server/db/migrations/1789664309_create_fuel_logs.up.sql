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
    server_seq          bigint NOT NULL,
    received_at_server  timestamptz NOT NULL,
    PRIMARY KEY (account_id, id),
    FOREIGN KEY (account_id, vehicle_id) REFERENCES vehicles(account_id, id),
    FOREIGN KEY (account_id, odometer_log_id) REFERENCES odometer_logs(account_id, id)
);
CREATE INDEX fuel_logs_vehicle_time_idx ON fuel_logs (account_id, vehicle_id, recorded_at);
