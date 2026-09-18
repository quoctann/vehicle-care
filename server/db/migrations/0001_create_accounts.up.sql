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
