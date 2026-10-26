CREATE TABLE
  auth_identities (
    account_id uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    provider text NOT NULL,
    subject text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now (),
    CONSTRAINT auth_identities_provider_subject_key UNIQUE (provider, subject),
    CONSTRAINT auth_identities_account_provider_key UNIQUE (account_id, provider)
  );