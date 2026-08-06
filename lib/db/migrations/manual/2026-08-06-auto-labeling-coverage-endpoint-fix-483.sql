-- ============================================================================
-- governance:auto-labeling-coverage — still-dead Graph endpoint (#483)
-- Manual — run by hand, not drizzle-kit. No DATABASE_URL in this environment.
-- ============================================================================
--
-- BACKGROUND: #343 (2026-08-04, commit a05c883d) already wrote a manual
-- migration repointing this check's endpoint from the dead
-- /security/informationProtection/policy/labels to
-- /security/dataSecurityAndGovernance/sensitivityLabels
-- (lib/db/migrations/manual/2026-08-04-auto-labeling-coverage-endpoint-fix-343.sql).
-- #483 reports every collection through 2026-08-06T15:54Z, including today's
-- rescan, is STILL returning the old 400 "'informationProtection'" error —
-- i.e. that #343 SQL file was written but never actually run against the live
-- DB. This migration re-issues the same UPDATE (idempotent — a no-op if it
-- somehow already applied) rather than assuming the earlier file's endpoint
-- string is still correct.
--
-- STEP 1 — confirm the live endpoint before trusting it. Run this first and
-- read the @odata.context of the most recent successful row for each of the
-- two sibling checks that #483 says were already fixed and now succeed:
--   copilot:sensitivity-labels-exist
--   governance:sensitivity-label-adoption
-- (#470, 2026-08-06, independently confirmed both fetch real Graph data
-- successfully against this same tenant — see
-- lib/db/migrations/manual/2026-08-06-sensitivity-label-severity-rules-470.sql).
-- The @odata.context should read
-- ".../$metadata#security/dataSecurityAndGovernance/sensitivityLabels" or
-- equivalent. If it does not match what STEP 2 below sets, STOP — do not run
-- STEP 2 — and repoint auto-labeling-coverage to whatever this query actually
-- shows instead.

SELECT
  tmp.check_key,
  tmp.status,
  tmp.collected_at,
  tmp.raw_response ->> '@odata.context' AS odata_context
FROM tenant_monitor_profiles tmp
WHERE tmp.tenant_id = 'c4c814d4-3afe-441e-9145-62461d0a4fd3'
  AND tmp.check_key IN ('copilot:sensitivity-labels-exist', 'governance:sensitivity-label-adoption')
  AND tmp.status = 'ok'
ORDER BY tmp.check_key, tmp.collected_at DESC
LIMIT 6;

-- STEP 1b — for comparison, the current (still-broken) stored endpoint and
-- most recent error for auto-labeling-coverage itself:

SELECT key, endpoint, mapping FROM monitor_checks WHERE key = 'governance:auto-labeling-coverage';

SELECT status, collected_at, error_message
FROM tenant_monitor_profiles
WHERE tenant_id = 'c4c814d4-3afe-441e-9145-62461d0a4fd3'
  AND check_key = 'governance:auto-labeling-coverage'
ORDER BY collected_at DESC
LIMIT 5;

-- STEP 2 — only run once STEP 1's @odata.context confirms the path below.
-- The exists/id mapping is left untouched, same reasoning as #343: both the
-- old and new endpoints return a collection of label-shaped objects each
-- carrying an `id` field, so "does any returned item have a non-null id"
-- still means the same thing.

UPDATE monitor_checks
SET endpoint = '/security/dataSecurityAndGovernance/sensitivityLabels',
    updated_at = now()
WHERE key = 'governance:auto-labeling-coverage';

-- Verify: expect the new endpoint, mapping unchanged, status still active.
SELECT key, label, status, method, endpoint, mapping
FROM monitor_checks
WHERE key = 'governance:auto-labeling-coverage';

-- STEP 3 — after running STEP 2, trigger a fresh collection for tenant
-- c4c814d4-3afe-441e-9145-62461d0a4fd3 (e.g. via the admin panel's re-scan
-- action or the scan-trigger route) and confirm the newest
-- tenant_monitor_profiles row for governance:auto-labeling-coverage has
-- status = 'ok' with a real extracted autoLabelingPolicyExists value, not
-- another error:

SELECT status, collected_at, error_message, extracted_properties ->> 'autoLabelingPolicyExists' AS auto_labeling_policy_exists
FROM tenant_monitor_profiles
WHERE tenant_id = 'c4c814d4-3afe-441e-9145-62461d0a4fd3'
  AND check_key = 'governance:auto-labeling-coverage'
ORDER BY collected_at DESC
LIMIT 1;
