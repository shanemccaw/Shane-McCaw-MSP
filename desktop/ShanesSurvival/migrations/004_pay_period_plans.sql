-- ShanesSurvival — Pay-Period Plan (#2892)
-- Real allocation plan Shane creates via Claude Desktop's MCP write tools when he gets paid:
-- "here's how this paycheck splits across real bill/spend accounts." Shane executes each real
-- transfer manually in his own bank's app (no programmatic transfer capability exists for Navy
-- Federal via Plaid — confirmed 2026-09-04), checking off `executed` as he goes. Applied
-- automatically by MigrationRunner (see README.md) — no manual psql step needed.

BEGIN;

CREATE TABLE IF NOT EXISTS pay_period_plans (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pay_date       DATE NOT NULL,
    income_amount  NUMERIC(14, 2) NOT NULL,
    status         TEXT NOT NULL DEFAULT 'active',
    notes          TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'pay_period_plans_status_check'
    ) THEN
        ALTER TABLE pay_period_plans
            ADD CONSTRAINT pay_period_plans_status_check
            CHECK (status IN ('proposed', 'active', 'completed'));
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS pay_period_plan_allocations (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id      UUID NOT NULL REFERENCES pay_period_plans (id) ON DELETE CASCADE,
    account_id   UUID NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    amount       NUMERIC(14, 2) NOT NULL,
    reason       TEXT,
    executed     BOOLEAN NOT NULL DEFAULT false,
    executed_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pay_period_plan_allocations_plan_id
    ON pay_period_plan_allocations (plan_id);

CREATE INDEX IF NOT EXISTS idx_pay_period_plans_status_created_at
    ON pay_period_plans (status, created_at DESC);

COMMIT;
