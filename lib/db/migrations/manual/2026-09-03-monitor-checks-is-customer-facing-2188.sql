-- #2188 — monitor_checks has no is_internal flag: appgov:enterprise-app-registration-list
-- counted as a customer-facing 'active' check
--
-- Real gap: monitor_checks.status = 'active' is used as the sole scoping query for
-- customer-facing check catalogs (remediation KB fan-out, portal check listings), but
-- 'active' conflates two different kinds of check:
--   1. Real customer governance findings.
--   2. Platform-internal self-tests/diagnostics that happen to run against a
--      customer's tenant, but produce nothing a customer should ever see.
--
-- Two checks already carry this classification informally — see
-- 2026-08-17-foundation-growth-premier-tiers-1134.sql's header comment
-- ("INTERNAL / DIAGNOSTIC (never in any customer tier)"):
--   - appgov:enterprise-app-registration-list — checks the customer's tenant for a
--     service principal literally named 'ShaneMcCawConsulting' (this platform's own
--     multi-tenant app registration) as a connectivity/health self-test, not a
--     customer governance finding. No mapping, no severity_rules, blank description.
--   - diagnostics:ps-execution-test — a PowerShell execution-path diagnostic.
--
-- This migration makes that classification a real, queryable column instead of
-- something every future status='active' query has to rediscover by hand per check.

BEGIN;

ALTER TABLE monitor_checks
  ADD COLUMN IF NOT EXISTS is_customer_facing boolean NOT NULL DEFAULT true;

-- Backfill the two known internal/diagnostic checks. Every other existing 'active'
-- check is untouched (stays at the column default, true).
UPDATE monitor_checks
SET is_customer_facing = false
WHERE key IN (
  'appgov:enterprise-app-registration-list',
  'diagnostics:ps-execution-test'
);

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-03-monitor-checks-is-customer-facing-2188.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
