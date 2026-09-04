-- ShanesSurvival — Emergency Fund account role (#2907)
-- Widens accounts_role_check (migrations/003_account_roles.sql) to also allow
-- 'emergency_fund': a real savings account that isn't a bill (nothing's "due" on it) and
-- isn't a spend account (spend_bleed's merchant-grouping view doesn't mean anything for
-- savings) — it gets its own role so bill_status/spend_bleed's existing role-based
-- filtering naturally excludes it, no extra exclusion logic needed.
--
-- target_amount (already on accounts, migrations/003) is reused for the real savings goal —
-- same convention as is_gate being bill-only-meaningful today.

BEGIN;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'accounts_role_check'
    ) THEN
        ALTER TABLE accounts DROP CONSTRAINT accounts_role_check;
    END IF;

    ALTER TABLE accounts
        ADD CONSTRAINT accounts_role_check
        CHECK (role IS NULL OR role IN ('income_gate', 'bill', 'spend', 'emergency_fund'));
END $$;

COMMIT;
