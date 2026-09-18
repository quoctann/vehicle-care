CREATE TABLE odometer_logs (
    account_id          uuid NOT NULL,
    id                  uuid NOT NULL,
    vehicle_id          uuid NOT NULL,
    odometer_km         numeric(10,2) NOT NULL CHECK (odometer_km >= 0),
    recorded_at         timestamptz NOT NULL,
    source              text NOT NULL CHECK (source IN ('manual','fuel')),
    note                text NULL CHECK (note IS NULL OR char_length(note) <= 2000),
    server_seq          bigint NOT NULL,
    received_at_server  timestamptz NOT NULL,
    PRIMARY KEY (account_id, id),
    FOREIGN KEY (account_id, vehicle_id) REFERENCES vehicles(account_id, id)
);
CREATE INDEX odometer_logs_vehicle_time_idx ON odometer_logs (account_id, vehicle_id, recorded_at);
