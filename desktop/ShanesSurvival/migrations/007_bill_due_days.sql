-- ShanesSurvival — per-bill due days (#2904)
-- Shane doesn't budget monthly, he tracks "what's due between this paycheck and the next
-- one." accounts.due_day is the real calendar day-of-month a bill account's payment is due
-- (from an old budgeting app export Shane pasted, confirmed accurate 2026-09-04) — only
-- meaningful for role = 'bill', same convention as target_amount/is_gate from migration 003.
-- NULL until Claude Desktop's set_bill_due_day tool sets it. Additive only — does not touch
-- the existing bill_status/gate_status shortfall math, which stays keyed off target_amount.
-- Applied automatically by MigrationRunner (see README.md) — no manual psql step needed.

BEGIN;

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS due_day INTEGER;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'accounts_due_day_check'
    ) THEN
        ALTER TABLE accounts
            ADD CONSTRAINT accounts_due_day_check
            CHECK (due_day IS NULL OR (due_day BETWEEN 1 AND 31));
    END IF;
END $$;

COMMIT;
