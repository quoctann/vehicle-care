ALTER TABLE accounts
ADD COLUMN auth_version bigint NOT NULL DEFAULT 1 CHECK (auth_version > 0);