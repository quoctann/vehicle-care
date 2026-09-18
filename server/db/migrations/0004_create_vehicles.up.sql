CREATE TABLE vehicles (
    account_id          uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    id                  uuid NOT NULL,
    name                text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 500),
    plate_number        text NULL CHECK (plate_number IS NULL OR char_length(plate_number) <= 2000),
    archived_at         timestamptz NULL,
    deleted_at          timestamptz NULL,
    server_seq          bigint NOT NULL,
    received_at_server  timestamptz NOT NULL,
    PRIMARY KEY (account_id, id)
);
CREATE INDEX vehicles_account_active_idx ON vehicles (account_id) WHERE deleted_at IS NULL;
