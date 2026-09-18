CREATE TABLE service_logs (
    account_id             uuid NOT NULL,
    id                     uuid NOT NULL,
    vehicle_id             uuid NOT NULL,
    part_type_id           uuid NOT NULL REFERENCES part_types(id),
    serviced_at            timestamptz NOT NULL,
    odometer_km_snapshot   numeric(10,2) NULL CHECK (odometer_km_snapshot IS NULL OR odometer_km_snapshot >= 0),
    cost_vnd               bigint NULL CHECK (cost_vnd IS NULL OR cost_vnd >= 0),
    note                   text NULL CHECK (note IS NULL OR char_length(note) <= 2000),
    server_seq             bigint NOT NULL,
    received_at_server     timestamptz NOT NULL,
    PRIMARY KEY (account_id, id),
    FOREIGN KEY (account_id, vehicle_id) REFERENCES vehicles(account_id, id)
);
CREATE INDEX service_logs_vehicle_part_time_idx ON service_logs (account_id, vehicle_id, part_type_id, serviced_at);
