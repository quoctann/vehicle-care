CREATE TABLE devices (
    account_id     uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    device_id      text NOT NULL CHECK (char_length(device_id) BETWEEN 1 AND 200),
    platform       text NULL,
    app_version    text NULL,
    registered_at  timestamptz NOT NULL,
    last_seen_at   timestamptz NULL,
    PRIMARY KEY (account_id, device_id)
);
