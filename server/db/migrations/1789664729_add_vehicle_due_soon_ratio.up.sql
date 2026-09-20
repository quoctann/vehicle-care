ALTER TABLE vehicles
    ADD COLUMN due_soon_ratio numeric(4,3) NULL
        CHECK (due_soon_ratio IS NULL OR (due_soon_ratio > 0 AND due_soon_ratio <= 1));
