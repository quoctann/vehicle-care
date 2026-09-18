CREATE TABLE pull_watermarks (
    account_id   uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    token        text NOT NULL,
    upper_bound  bigint NOT NULL,
    expires_at   timestamptz NOT NULL,
    PRIMARY KEY (account_id, token)
);
CREATE INDEX pull_watermarks_expiry_idx ON pull_watermarks (expires_at);
