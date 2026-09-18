CREATE TABLE processed_mutations (
    account_id          uuid NOT NULL,
    device_id           text NOT NULL,
    mutation_id         text NOT NULL,
    entity_type         text NOT NULL,
    entity_id           uuid NOT NULL,
    status              text NOT NULL CHECK (status IN ('applied','duplicate','rejected','retryable_error','conflict_resolved')),
    server_seq          bigint NULL,
    received_at_server  timestamptz NULL,
    error_code          text NULL,
    error_message       text NULL,
    retryable           boolean NULL,
    server_snapshot     jsonb NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (account_id, device_id, mutation_id)
);
