-- ============================================================================
-- Populate monitoring_package_checks for core:enhanced-monitoring
-- ============================================================================
-- WHAT THE PRIOR FIX REVEALED (2026-07-21-repopulate-monitoring-package-checks.sql)
--   monitoring_package_checks was found empty for EVERY package, not just
--   core:security-baseline. That fix curated 29 entry-tier checks for
--   core:security-baseline (the free/assessment first-look scan) and
--   deliberately left every other package untouched.
--
--   core:enhanced-monitoring is confirmed to already exist as a real package
--   row and to already resolve correctly for the highest-tier monitoring
--   customers (includedEngines: ["monitoring","live_monitor"] per the
--   catalog). But because monitoring_package_checks has zero rows for it,
--   every real scan run under this package still reports checks_total = 0 —
--   package resolution works, check linkage does not.
--
-- WHAT THIS MIGRATION DOES
--   Links the FULL/BROAD set of real, active monitor_checks to
--   core:enhanced-monitoring — not another narrow curated subset like
--   security-baseline's 29. This package is the top/enterprise monitoring
--   tier, so it is expected to cover the whole real check catalog rather
--   than one attack-surface slice.
--
--   Scope: all monitor_checks rows where status = 'active'. This
--   intentionally INCLUDES checks with requires_customer_script = true —
--   the enhanced/enterprise tier is the one tier where the broader,
--   script-dependent checks are expected to run; a customer on this tier
--   without the prerequisite script simply gets a per-check error/skip
--   result for that item (real data), not a smaller catalog.
--
-- NOT touched: core:security-baseline's existing 29-check set is untouched
--   (this migration only inserts rows with package_key = 'core:enhanced-monitoring').
--   The 10 cat-* dashboard containers stay check-less by design.
-- Idempotent: ON CONFLICT DO NOTHING; safe to re-run.
-- ============================================================================

-- ── 1. Confirm the package already exists (informational; does not create it) ──
--   SELECT key, label, status, engines, required_plan_feature
--   FROM monitoring_packages WHERE key = 'core:enhanced-monitoring';
--   (Per task context this row already exists and already resolves correctly
--   for top-tier customers — this migration does not touch monitoring_packages.)

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
