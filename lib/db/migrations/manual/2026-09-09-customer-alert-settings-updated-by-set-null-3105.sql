-- Git #3105: customer_alert_settings.updated_by_user_id's FK into users(id) was
-- NO ACTION while every sibling attribution column of the same shape (nullable
-- FK into users(id) recording who last touched a row) is ON DELETE SET NULL.
-- #2984 found this the hard way — it blocked a user hard delete outright — and
-- worked around it in code with an explicit UPDATE before the users DELETE.
-- This migration fixes the constraint itself so the DB handles it like every
-- sibling column does; the code workaround in user-hard-delete.ts is removed
-- in the same commit.
--
-- Additive/non-destructive: DROP CONSTRAINT + re-ADD is not a data-losing
-- operation (no column, table, or row is dropped) — no @migration-gate header
-- required per CLAUDE.md's destructive-migration-gate definition.

BEGIN;

ALTER TABLE "customer_alert_settings"
  DROP CONSTRAINT "customer_alert_settings_updated_by_user_id_fkey";

ALTER TABLE "customer_alert_settings"
  ADD CONSTRAINT "customer_alert_settings_updated_by_user_id_fkey"
  FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-09-customer-alert-settings-updated-by-set-null-3105.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
