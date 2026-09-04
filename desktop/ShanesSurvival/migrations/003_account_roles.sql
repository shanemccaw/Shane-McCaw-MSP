-- ShanesSurvival — account role tagging + GATE severity + bill targets
-- Adds what the dashboard needs on top of the raw Plaid-synced accounts table (see
-- Data/MigrationRunner.cs — applied automatically, no manual psql step):
--   role           — Shane-assigned, never inferred from Plaid's account name/type:
--                    'income_gate' (the one Direct Deposit account everything lands in),
--                    'bill' (one of the ~10+ real bill accounts), or
--                    'spend' (one of the 2 household spend accounts). NULL = not yet assigned.
--   target_amount  — only meaningful for role = 'bill': the real monthly bill figure Shane
--                    enters once. NULL until he sets it.
--   is_gate        — true for the two real GATE-tier bill accounts (mortgage, Tesla), which
--                    get distinct always-visible treatment on the dashboard separate from the
--                    other ~8 bill accounts. Only meaningful when role = 'bill'.

BEGIN;

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS role TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS target_amount NUMERIC(14, 2);
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS is_gate BOOLEAN NOT NULL DEFAULT false;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'accounts_role_check'
    ) THEN
        ALTER TABLE accounts
            ADD CONSTRAINT accounts_role_check
            CHECK (role IS NULL OR role IN ('income_gate', 'bill', 'spend'));
    END IF;
END $$;

-- Real-world convention (exactly one income_gate account, ~10+ bill accounts, 2 spend
-- accounts) is enforced by the role-assignment UI, not by a DB constraint here — a hard
-- DB constraint would make the app crash mid-reassignment instead of showing a clear
-- validation message while Shane is briefly between states.

CREATE INDEX IF NOT EXISTS idx_accounts_role ON accounts (role);

COMMIT;
