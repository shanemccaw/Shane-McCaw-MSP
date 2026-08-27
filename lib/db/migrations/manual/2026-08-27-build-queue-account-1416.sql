-- Add account column to bt_build_queue (Git #1416 — multi-account routing for Claude Code)
-- A queue build's account is "secondary" (Shane's overflow Pro account, launched with
-- CLAUDE_CONFIG_DIR pointed at the configured secondary config dir) or NULL/"primary"
-- (the default Max 20x account). Sequential overflow only — no concurrency change.
ALTER TABLE bt_build_queue ADD COLUMN IF NOT EXISTS account text;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-27-build-queue-account-1416.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
