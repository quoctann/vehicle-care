CREATE TABLE notification_deliveries (
    id                  bigserial PRIMARY KEY,
    account_id          uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    vehicle_id          uuid NOT NULL,
    reminder_config_id  uuid NOT NULL,
    idempotency_key     text NOT NULL,
    status              text NOT NULL CHECK (status IN ('sent','failed_retryable','failed_permanent')),
    attempted_at        timestamptz NOT NULL DEFAULT now(),
    sent_at             timestamptz NULL,
    error_message       text NULL,
    FOREIGN KEY (account_id, vehicle_id) REFERENCES vehicles(account_id, id),
    FOREIGN KEY (account_id, reminder_config_id) REFERENCES reminder_configs(account_id, id),
    CONSTRAINT notification_deliveries_idempotency_uidx UNIQUE (account_id, idempotency_key)
);
