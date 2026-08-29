-- Git #1610 — Migrate invoices.amount from numeric(10,2) decimal dollars to
-- integer cents, upholding the platform rule that money is integer cents
-- internally, always (single platform Stripe account, no Connect).
--
-- Strategy (per the DECIDED scope on #1610):
--   1. Add the integer-cents column and backfill with ROUND(amount * 100).
--   2. Verify row-for-row that the backfill matches the original decimal BEFORE
--      touching anything — a guard raises and aborts the whole transaction on
--      any mismatch, so a bad backfill can never cut over.
--   3. Cut over by swapping names: the original decimal column is RENAMED to
--      amount_old_numeric (retained, made nullable) rather than dropped, so the
--      old values remain available for verification/rollback. The old column is
--      dropped in a SEPARATE, later migration — never in the same commit as the
--      cutover.
--
-- Run manually (psql "$DATABASE_URL" -f <this file>). Do NOT use drizzle-kit push.

BEGIN;

-- 1. Add the integer-cents column (idempotent).
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS amount_cents integer;

-- 2. Backfill from the existing decimal dollars. ROUND(...*100) lands exact
--    cents; ::integer is safe because numeric(10,2)*100 is a whole number.
UPDATE invoices SET amount_cents = ROUND(amount * 100)::integer;

-- 3. Row-for-row verification guard — abort the migration if ANY row's cents
--    does not equal ROUND(dollars*100), or is NULL. This is the "verify before
--    cutover" gate: on mismatch the RAISE rolls back the whole transaction and
--    nothing is renamed or dropped.
DO $$
DECLARE bad integer;
BEGIN
  SELECT count(*) INTO bad
  FROM invoices
  WHERE amount_cents IS NULL
     OR amount_cents IS DISTINCT FROM ROUND(amount * 100)::integer;
  IF bad > 0 THEN
    RAISE EXCEPTION 'invoices.amount -> amount_cents backfill mismatch on % row(s); aborting cutover', bad;
  END IF;
END $$;

-- 4. Cut over. Keep the schema column name `amount` (now integer cents) so every
--    consumer keeps reading invoicesTable.amount. Retain the old decimal values
--    as a nullable amount_old_numeric column for verification/rollback; a later
--    migration drops it. Drop the old NOT NULL so Drizzle inserts (which now
--    supply only the integer `amount`) don't need to populate the retained column.
ALTER TABLE invoices RENAME COLUMN amount TO amount_old_numeric;
ALTER TABLE invoices RENAME COLUMN amount_cents TO amount;
ALTER TABLE invoices ALTER COLUMN amount SET NOT NULL;
ALTER TABLE invoices ALTER COLUMN amount_old_numeric DROP NOT NULL;

-- Self-mark so Simulator Studio's Migrations tree reflects DB reality (Git #497).
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-29-invoices-amount-to-cents-1610.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
