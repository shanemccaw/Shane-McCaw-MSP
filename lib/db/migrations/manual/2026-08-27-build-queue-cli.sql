-- Add cli column to bt_build_queue (Git #1403)
ALTER TABLE bt_build_queue ADD COLUMN IF NOT EXISTS cli text;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-27-build-queue-cli.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
