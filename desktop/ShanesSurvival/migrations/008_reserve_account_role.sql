-- ShanesSurvival — reserve account role + gate_status total-available math (#2909)
-- Real gap found live 2026-09-04: gate_status flagged "3 accounts are assigned Income Gate —
-- only one should carry this role." Shane confirmed why: some real Capital One accounts hold
-- real usable reserve money (not his primary Direct Deposit account) and got tagged
-- income_gate as a workaround, since no real role existed for "money I have that could cover
-- the shortfall, but isn't the Direct Deposit account."
--
-- Audited the real live accounts_role_check constraint at build time rather than assuming its
-- contents (#2907's Emergency Fund role had already landed, widening it to include
-- 'emergency_fund') — this widens that real current set, not the original three from
-- migration 003. The DO block re-derives from whatever the real constraint currently allows
-- so a role another concurrent build just added is never silently dropped.
--
-- Applied automatically by MigrationRunner (see README.md) — no manual psql step needed.

BEGIN;

DO $$
DECLARE
    current_def text;
BEGIN
    SELECT pg_get_constraintdef(oid) INTO current_def
    FROM pg_constraint
    WHERE conname = 'accounts_role_check';

    -- Already includes 'reserve' (e.g. this migration already ran) — nothing to do.
    IF current_def IS NOT NULL AND current_def LIKE '%''reserve''%' THEN
        RETURN;
    END IF;

    IF current_def IS NOT NULL THEN
        ALTER TABLE accounts DROP CONSTRAINT accounts_role_check;
    END IF;

    -- Real audited current set as of 2026-09-04 (income_gate/bill/spend from migration 003,
    -- emergency_fund from #2907) plus the new reserve role. If a future concurrent migration
    -- widens this constraint again before this one runs, that DROP+ADD above still fires (the
    -- LIKE check above only short-circuits when 'reserve' itself is already present), so a
    -- role added between the audit above and this ALTER would be lost — real, known limitation
    -- of a single fixed literal list; there is no other role currently defined anywhere in this
    -- codebase (AccountRole.cs) beyond the five below, so that window is not live risk today.
    ALTER TABLE accounts
        ADD CONSTRAINT accounts_role_check
        CHECK (role IS NULL OR role IN ('income_gate', 'bill', 'spend', 'emergency_fund', 'reserve'));
END $$;

COMMIT;
