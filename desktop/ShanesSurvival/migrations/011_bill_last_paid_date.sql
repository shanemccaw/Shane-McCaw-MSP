-- ShanesSurvival — bill last_paid_date, "already paid this cycle" tracking (#2912)
-- Real bug found live 2026-09-04: pay_period_due_status listed H2 Rent as "due tomorrow,
-- $2,200" when Shane had already paid it — real overcount of $2,200 on a real short-runway
-- number. bill_status's $0.00 real balance on a just-paid bill looks identical to a genuinely
-- neglected bill, and pay_period_due_status had no way to tell the difference either. This
-- adds accounts.last_paid_date (date, nullable) — only meaningful for role = 'bill', same
-- convention as target_amount/due_day (migrations 003/007). NULL until Claude Desktop's
-- mark_bill_paid tool sets it. Additive only — does not touch the existing bill_status/
-- gate_status shortfall math, which stays keyed off target_amount vs. current_balance.
-- Applied automatically by MigrationRunner (see README.md) — no manual psql step needed.

BEGIN;

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS last_paid_date DATE;

COMMIT;
