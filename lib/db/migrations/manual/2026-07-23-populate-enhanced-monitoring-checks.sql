-- ============================================================================
-- Create core:enhanced-monitoring package + populate monitoring_package_checks
-- ============================================================================
-- CORRECTION (2026-07-23): the original version of this migration assumed,
-- on the task prompt's word, that core:enhanced-monitoring already existed as
-- a monitoring_packages row and only needed its checks linked. Shane ran
--   SELECT * FROM monitoring_packages WHERE key = 'core:enhanced-monitoring';
-- and it returned ZERO rows — the row does not exist. That assumption was
-- never independently verified (no DB access in this environment) and was
-- wrong. This is the exact same shape of bug the 2026-07-21 security-baseline
-- fix found: executeMonitoringPackage() (monitor-executor.ts) looks up
-- monitoring_packages WHERE key = packageKey AND status = 'active' and
-- returns runStatus "no_checks" if that row is missing — a missing package
-- row and a package row with zero linked checks produce the IDENTICAL
-- checks_total = 0 symptom, which is why this was missed until queried
-- directly. Also: grepping the codebase for "enhanced-monitoring" /
-- "enhanced_monitoring" finds no literal reference anywhere — "Enhanced
-- Monitoring" only appears in code comments as a product/tier NAME (e.g.
-- catalog-pricing.ts, consent-success.tsx), never as a wired packageKey.
-- The literal key 'core:enhanced-monitoring' is this migration's best-guess
-- convention match to core:security-baseline's "core:<name>" pattern — Shane
-- must confirm this is the actual services.type_attributes->>'packageKey'
-- value the real Enhanced Monitoring product/service row uses before running
-- this (see step 0 below). If the real product uses a different key, edit
-- both INSERTs below to match before running.
--
-- WHAT THE PRIOR FIX REVEALED (2026-07-21-repopulate-monitoring-package-checks.sql)
--   monitoring_package_checks was found empty for EVERY package, not just
--   core:security-baseline. That fix curated 29 entry-tier checks for
--   core:security-baseline (the free/assessment first-look scan) and
--   deliberately left every other package untouched.
--
-- WHAT THIS MIGRATION DOES
--   1. Creates the core:enhanced-monitoring monitoring package (idempotent),
--      IF step 0 below confirms this is the correct real key.
--   2. Links the FULL/BROAD set of real, active monitor_checks to it — not
--      another narrow curated subset like security-baseline's 29. This is
--      the top/enterprise monitoring tier (includedEngines:
--      ["monitoring","live_monitor"] per the catalog), so it is expected to
--      cover the whole real check catalog rather than one attack-surface
--      slice.
--
--   Scope: all monitor_checks rows where status = 'active'. This
--   intentionally INCLUDES checks with requires_customer_script = true —
--   the enhanced/enterprise tier is the one tier where the broader,
--   script-dependent checks are expected to run; a customer on this tier
--   without the prerequisite script simply gets a per-check error/skip
--   result for that item (real data), not a smaller catalog.
--
-- NOT touched: core:security-baseline's existing 29-check set is untouched
--   (this migration only writes rows for package_key = 'core:enhanced-monitoring').
--   The 10 cat-* dashboard containers stay check-less by design.
-- Idempotent: ON CONFLICT DO NOTHING on both inserts; safe to re-run.
-- ============================================================================

-- ── 0. SHANE: run this FIRST and confirm before running anything below ─────
--   Find the real product/service row for the Enhanced Monitoring tier and
--   read its packageKey out of type_attributes — do NOT assume it matches
--   this file's guess of 'core:enhanced-monitoring'.
--     SELECT id, name, type_attributes->>'packageKey' AS package_key
--     FROM services
--     WHERE name ILIKE '%enhanced monitoring%' OR type_attributes->>'packageKey' ILIKE '%enhanced%';
--   If that returns a different key than 'core:enhanced-monitoring', replace
--   the literal in both INSERTs below with the real value before running.

-- ── 1. Create the package (idempotent) ──────────────────────────────────────
INSERT INTO monitoring_packages (key, label, description, engines, status, platform_cost_cents)
VALUES (
  'core:enhanced-monitoring',
  'Enhanced Monitoring',
  'Top/enterprise-tier continuous monitoring package — covers the full real monitor_checks catalog rather than a curated entry-tier subset.',
  '["monitoring","live_monitor"]'::jsonb,
  'active',
  0
)
ON CONFLICT (key) DO NOTHING;

-- ── 2. Link every real, active monitor_checks row ───────────────────────────
-- sort_order = c.key alphabetical, so the report renders in a stable,
-- deterministic order without hand-curating 100+ explicit rows.
INSERT INTO monitoring_package_checks (package_key, check_key, sort_order)
SELECT
  'core:enhanced-monitoring',
  c.key,
  row_number() OVER (ORDER BY c.key) - 1
FROM monitor_checks c
WHERE c.status = 'active'
ON CONFLICT (package_key, check_key) DO NOTHING;

-- ============================================================================
-- POST-RUN VERIFICATION
-- ============================================================================
-- 1. Confirm a real, non-zero, substantially-broader-than-29 link count:
--      SELECT count(*) FROM monitoring_package_checks
--      WHERE package_key = 'core:enhanced-monitoring';
--    Expect this to equal the total count of monitor_checks WHERE status='active'
--    (i.e. the same number Q2 in 2026-07-21-monitoring-package-checks-DIAGNOSTIC.sql
--    would have returned), NOT 29.
--
-- 2. Trigger a real scan under this package for a top-tier customer:
--      POST /api/msp/customers/<id>/diagnostics/run  body: {"packageKey":"core:enhanced-monitoring"}
-- 3. Confirm checks_total on the run row now matches the link count from step 1:
--      SELECT run_id, package_key, status, run_status, checks_total, checks_ok,
--             checks_error, checks_requires_script
--      FROM msp_diagnostic_runs
--      WHERE package_key = 'core:enhanced-monitoring'
--      ORDER BY created_at DESC LIMIT 1;
-- 4. Sanity-check core:security-baseline is unaffected:
--      SELECT count(*) FROM monitoring_package_checks
--      WHERE package_key = 'core:security-baseline';
--    Expect unchanged (29 or your prior adjusted count).
-- ============================================================================
