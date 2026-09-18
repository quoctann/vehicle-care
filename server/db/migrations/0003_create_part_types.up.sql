CREATE TABLE part_types (
    id             uuid PRIMARY KEY,
    code           text NOT NULL,
    name_vi        text NOT NULL,
    display_order  integer NOT NULL,
    active         boolean NOT NULL DEFAULT true,
    seed_version   text NOT NULL,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT part_types_code_unique UNIQUE (code)
);
