-- Add filter_params to monitor_checks
ALTER TABLE monitor_checks ADD COLUMN filter_params TEXT;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-07-26-add-filterparams.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
