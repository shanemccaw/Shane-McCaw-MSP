-- #1623: drop invoices.amount_old_numeric
--
-- #1610 migrated invoices.amount from numeric(10,2) decimal dollars to
-- integer cents, renaming the original decimal column to
-- amount_old_numeric (made nullable) so it would survive one release for
-- verification/rollback. That verification is now confirmed: locally,
-- every row's amount_old_numeric * 100 matches amount exactly (0
-- mismatches). No application code references amount_old_numeric or
-- amountOldNumeric outside the #1610 migration file itself and the
-- schema comment. Safe to drop.

BEGIN;

ALTER TABLE invoices DROP COLUMN IF EXISTS amount_old_numeric;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-03-drop-invoices-amount-old-numeric-1623.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
