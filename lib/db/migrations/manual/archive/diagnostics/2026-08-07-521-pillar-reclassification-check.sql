-- Git #521 — Findings grouped by check-key domain prefix instead of
-- signal_derivation_rules.pillar — compliance signals cross-homed to
-- Governance/Copilot.
--
-- Diagnostic only — no DDL/DML, exempt from the manual-migration
-- self-marking INSERT convention (archive/diagnostics/).
--
-- This environment has no DATABASE_URL, so the fix (war-room-pillar-stats.ts:
-- warRoomPillarForCheckKey now resolves via signal_derivation_rules.pillar,
-- joined through the same resolveOwningCheckKey hop buildFindingRankWeights
-- already uses, before falling back to WAR_ROOM_PILLAR_CHECK_DOMAINS) is
-- proven only by unit tests here, not against live data. Run both queries
-- below against the real testbed tenant to confirm the two facts the fix
-- depends on:
--   1. These checks' rule rows really do carry pillar = 'compliance' today.
--   2. The tenant's latest run still has a critical/warning finding for the
--      three #521 confirmed-live checks, so the Compliance card actually has
--      something new to show after deploy.
--
-- Tenant: c4c814d4-3afe-441e-9145-62461d0a4fd3 / mccawsoft2.onmicrosoft.com

-- Query 1: current signal_derivation_rules.pillar for the five checks #519/#521
-- name (three confirmed-live, two flagged-but-unconfirmed). `source_key` is
-- the check key directly for a `threshold` rule (the common case for these);
-- `findings_keyword` / `profile_key_*` rows are also shown so the real
-- resolveOwningCheckKey join can be inspected by eye if the raw source_key
-- isn't an exact check-key match.
SELECT
  sdr.source_key,
  sdr.rule_type,
  sdr.signal_key,
  sdr.pillar,
  sdr.msp_id
FROM signal_derivation_rules sdr
WHERE sdr.source_key IN (
  'governance:sensitivity-label-adoption',
  'governance:auto-labeling-coverage',
  'copilot:sensitivity-labels-exist',
  'identity:terms-of-use',
  'exchange:litigation-hold-coverage'
)
ORDER BY sdr.source_key, sdr.sort_order, sdr.id;

-- Query 2: the tenant's latest run's findings for those same check keys —
-- confirms they still fire real critical/warning findings to move onto the
-- Compliance card post-fix.
WITH target_tenant AS (
  SELECT id AS customer_id
  FROM tenants
  WHERE tenant_id = 'c4c814d4-3afe-441e-9145-62461d0a4fd3'
),
latest_run AS (
  SELECT f.run_id
  FROM msp_diagnostic_findings f, target_tenant tt
  WHERE f.customer_id = tt.customer_id
  ORDER BY f.created_at DESC
  LIMIT 1
)
SELECT f.check_key, f.severity, f.check_status, f.title
FROM msp_diagnostic_findings f
JOIN latest_run lr ON lr.run_id = f.run_id
WHERE f.check_key IN (
  'governance:sensitivity-label-adoption',
  'governance:auto-labeling-coverage',
  'copilot:sensitivity-labels-exist',
  'identity:terms-of-use',
  'exchange:litigation-hold-coverage'
)
ORDER BY f.check_key;
