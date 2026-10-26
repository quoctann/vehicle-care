-- +migrate up
-- google_identities
CREATE TABLE auth_identities (
 account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 provider text NOT NULL CHECK (provider = 'google'),
 subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 255),
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT auth_identities_provider_subject_key UNIQUE(provider, subject),
 CONSTRAINT auth_identities_account_provider_key UNIQUE(account_id, provider)
);
