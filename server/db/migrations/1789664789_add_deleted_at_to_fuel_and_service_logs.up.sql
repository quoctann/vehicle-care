ALTER TABLE fuel_logs ADD COLUMN deleted_at timestamptz NULL;
ALTER TABLE service_logs ADD COLUMN deleted_at timestamptz NULL;
