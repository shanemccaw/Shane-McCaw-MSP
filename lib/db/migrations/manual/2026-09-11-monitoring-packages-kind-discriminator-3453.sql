-- Add a real kind discriminator to monitoring_packages (Git #3453)
-- Manual migration — review and run by hand (do NOT run drizzle-kit push/push --force).
--
-- WHAT THIS DOES
-- 10 'active' monitoring_packages rows (the 'cat-*' keys) were seeded by
-- 2026-07-19-customer-dashboard-category-tabs.sql to give the customer-dashboard
-- category-tab feature a key to reuse — not as runnable diagnostics scan bundles.
-- They have zero linked monitoring_package_checks rows, empty `engines`, no
-- `required_plan_feature`, and zero code references to their literal keys anywhere
-- in the repo (confirmed live against local DATABASE_URL, 2026-09-11). Every other
-- 'active' row in this table (core:security-baseline, assess:copilot-readiness, etc.)
-- is a real, runnable package with real linked checks (3-198 each).
--
-- Without a real column, every consumer that lists "active monitoring packages" has
-- to re-derive "is this actually runnable" from a monitoring_package_checks count
-- join (msp-diagnostics.ts's GET /msp/monitoring-packages does exactly that with a
-- HAVING count(...) > 0), and the pre-existing GET /admin/monitoring-packages
-- (admin-monitor-checks.ts) does not do even that, showing all 21 as if they were
-- equivalent scan choices.
--
-- This adds monitoring_packages.kind ('scan_bundle' | 'dashboard_category', default
-- 'scan_bundle') and backfills the 10 known dashboard-tab rows to
-- 'dashboard_category', so every consumer can filter/label correctly without
-- re-deriving anything from a check-count join.

BEGIN;

ALTER TABLE monitoring_packages
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'scan_bundle';

ALTER TABLE monitoring_packages
  DROP CONSTRAINT IF EXISTS monitoring_packages_kind_check;

ALTER TABLE monitoring_packages
  ADD CONSTRAINT monitoring_packages_kind_check
  CHECK (kind IN ('scan_bundle', 'dashboard_category'));

UPDATE monitoring_packages
SET kind = 'dashboard_category'
WHERE key IN (
  'cat-collaboration-sharing', 'cat-compliance-governance', 'cat-configuration-drift',
  'cat-executive', 'cat-identity-access', 'cat-intune-devices', 'cat-licensing-cost',
  'cat-operational-maturity', 'cat-security-posture', 'cat-usage-adoption'
);

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-11-monitoring-packages-kind-discriminator-3453.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
