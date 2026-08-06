-- Fix: identity:risky-signins pointed at the SAME endpoint as identity:risky-users
-- Manual migration -- review and run by hand (do not run drizzle-kit push/push --force).
--
-- ── THE BUG (Git #492) ──────────────────────────────────────────────────────────
-- `identity:risky-signins` and `identity:risky-users` both resolve to
-- `/identityProtection/riskyUsers`. Confirmed live via `docs/endpoints.json`
-- (a generated snapshot of monitor_checks) -- both rows show the identical
-- endpoint string, method GET. The two checks are supposed to measure different
-- things (sign-in risk vs. user risk) but risky-signins is really just a
-- duplicate of risky-users under a different name and key.
--
-- ── SOURCE OF TRUTH: monitor_checks IS DB-RESIDENT, NO EXISTING SEED ────────────
-- Grepped every migration under lib/db/migrations/manual and every seed script
-- under scripts/src: no file INSERTs or fully defines these two rows'
-- endpoint/mapping/properties/severity_rules. Both rows (like the other ~116 in
-- the catalog) are DB-resident only -- 2026-07-21-repopulate-monitoring-package-
-- checks.sql says so explicitly ("The 118 monitor_checks themselves are correct
-- ... This migration does NOT touch monitor_checks."). So this file cannot edit
-- an existing INSERT/UPDATE in place -- it is a fresh UPDATE, following the same
-- pattern as 2026-07-23-monitor-check-endpoint-corrections.sql and
-- 2026-07-24-cae-check-reframe.sql (which is the closer precedent, since this
-- also changes mapping + severity_rules, not just the endpoint string).
--
-- ── THE CORRECT GRAPH ENDPOINT (verified against CURRENT learn.microsoft.com
--    docs, not training-data memory -- this API has had real naming/version
--    churn: /identityProtection/riskDetections is the resource, not
--    "riskySignIns" or "riskyDetections") ───────────────────────────────────────
-- learn.microsoft.com/en-us/graph/api/resources/identityprotection-overview
--   lists the identity-protection resources as: riskDetection, riskyUsers,
--   signIn (for users), plus servicePrincipalRiskDetection/riskyServicePrincipals
--   (for service principals). There is no "riskySignIns" resource in v1.0 or
--   beta -- that name does not exist in the current API surface.
-- learn.microsoft.com/en-us/graph/api/resources/riskdetection
--   riskDetection is explicitly "both user and sign-in linked risk detections",
--   distinguished by the `activity` property (activityType: signin | user).
-- learn.microsoft.com/en-us/graph/api/riskdetection-list
--   GET /identityProtection/riskDetections, supports $filter and $select.
--   The documented example response shows a real row with "activity": "signin".
--   Permission: IdentityRiskEvent.Read.All (Application) -- distinct from
--   IdentityRiskyUser.Read.All which risky-users already needs. NOT currently
--   confirmed present in REQUIRED_MT_SCOPES -- flagged below, not silently added.
--
-- Scoped with `$filter=activity eq 'signin'` so the check measures sign-in risk
-- only, not user risk -- otherwise this fix would still overlap risky-users on
-- every user-linked detection riskDetections also returns.
--
-- ── RESPONSE SHAPE CHANGE (why mapping + severity_rules must change too) ────────
-- riskyUsers rows: { riskLevel, riskState, riskDetail, userDisplayName, ... } --
-- one row per AT-RISK USER (offline-computed, no `activity` property).
-- riskDetections rows (this fix): { riskEventType, riskLevel, riskState,
-- riskDetail, activity, detectedDateTime, userPrincipalName, ... } -- one row
-- per DETECTED EVENT (a single user can have many). Same riskLevel/riskState
-- enum values (low/medium/high and none/atRisk/confirmedCompromised/
-- confirmedSafe/remediated/dismissed respectively) so the severity grammar
-- carries over unchanged in shape, just evaluated against event rows now
-- instead of user rows.
--
-- targetField kept as `riskySignInCount` deliberately -- it is already the
-- source_key docs/signals.json's generated signal.identity.risky-signins entry
-- names, and it is what identity.highRiskSigninCount
-- (lib/dashboard-registry/src/metrics.ts) fuzzy-matches via pickMappedValueField
-- (dashboard-resolvers.ts) against checkKey tokens "risky"/"signins". Keeping the
-- name means the dashboard metric and any existing signal_derivation_rules row
-- keyed on that source_key need NO change -- PART A.2 below reads that table so
-- the assumption is on the record, not just assumed.
--
-- ── SEVERITY DIRECTION: high-is-bad on the detection count, tiered by risk level
--    and remediation state ─────────────────────────────────────────────────────
-- Three tiers, most severe first (classifySeverity in monitor-executor.ts is
-- first-match-wins, so order matters):
--   1. high    -- any UNREMEDIATED high-risk sign-in (riskLevel=high AND
--                 riskState=atRisk/confirmedCompromised) -- the only tier that
--                 combines both level and live state, because a high-risk
--                 detection that was already confirmedSafe/remediated/dismissed
--                 is not an open risk.
--   2. medium  -- any other still-open (atRisk/confirmedCompromised) sign-in
--                 risk detection, regardless of level.
--   3. low     -- any sign-in risk detection exists at all (including already-
--                 remediated ones) -- visibility floor, not an action item.
--
-- ── NOT DONE HERE, FLAGGED FOR SHANE ─────────────────────────────────────────────
-- IdentityRiskEvent.Read.All is a DIFFERENT Graph Application permission than
-- IdentityRiskyUser.Read.All (which risky-users already relies on and which is
-- presumably in REQUIRED_MT_SCOPES). This migration does not touch scopes -- if
-- the tenant's existing consent grant doesn't already cover
-- IdentityRiskEvent.Read.All, this check will 403 until re-consent happens. Scope
-- changes force re-consent on every tenant and belong to their own task, per the
-- same policy 2026-07-23-monitor-check-endpoint-corrections.sql and the CAE
-- reframe both followed.
--
-- ── HOW TO RUN ────────────────────────────────────────────────────────────────
-- No DATABASE_URL is available to Claude Code sessions in this repo, so nothing
-- below is verified against live rows. PART A is read-only and prints the
-- current check + any existing derivation rule so the before/after is on the
-- record. Review PART A first, then run PART B (transactioned, RETURNING
-- receipt). After COMMIT, run a fresh scan and confirm identity:risky-signins
-- and identity:risky-users report genuinely different extractedProperties for
-- the same tenant/run.


-- ════════════════════════════════════════════════════════════════════════════════
-- PART A -- READ-ONLY: current state before anything changes
-- ════════════════════════════════════════════════════════════════════════════════

-- A.1 -- both checks side by side, to put the duplicate-endpoint bug on the record.
SELECT key, label, endpoint, method, properties, mapping, severity_rules, schema_version, status
FROM monitor_checks
WHERE key IN ('identity:risky-signins', 'identity:risky-users')
ORDER BY key;

-- A.2 -- any derivation rule keyed off risky-signins, so a multi-rule group or an
--        unexpected source_key is visible before PART B assumes 'riskySignInCount'
--        needs no change. If this shows a source_key other than 'riskySignInCount'
--        (or 'identity:risky-signins' for an old threshold-style rule), STOP and
--        adjust the target field name in PART B to match instead of the reverse --
--        the rule is what's wired into the signal, don't orphan it.
SELECT id, signal_key, group_id, rule_type, source_key, compare_value, msp_id, description, updated_at
FROM signal_derivation_rules
WHERE signal_key = 'signal.identity.risky-signins'
   OR source_key IN ('riskySignInCount', 'identity:risky-signins')
ORDER BY msp_id NULLS FIRST, id;


-- ════════════════════════════════════════════════════════════════════════════════
-- PART B -- CORRECTION (transactioned). Review PART A output first.
-- ════════════════════════════════════════════════════════════════════════════════

BEGIN;

UPDATE monitor_checks
SET
  endpoint = '/identityProtection/riskDetections?$filter=activity eq ''signin''',
  label = 'Risky Sign-Ins',
  description = 'Reports on Microsoft Entra ID Protection risk DETECTIONS linked to sign-in activity '
    || '(riskDetection resource, activity=''signin''), distinct from identity:risky-users which reads the '
    || 'separate riskyUsers resource (offline-computed per-user risk). Previously this check was wrongly '
    || 'pointed at the SAME /identityProtection/riskyUsers endpoint as risky-users -- see Git #492. Counts '
    || 'total sign-in risk detections, how many remain unremediated (riskState IN atRisk/confirmedCompromised), '
    || 'and how many of those are high-risk-level. Requires IdentityRiskEvent.Read.All -- NOT yet confirmed '
    || 'present in REQUIRED_MT_SCOPES; may 403 until re-consent (flagged, not fixed here).',
  properties = '["id","riskEventType","riskLevel","riskState","riskDetail","activity","detectedDateTime","userPrincipalName"]'::jsonb,
  mapping = '[
    {"sourceField":"id","targetField":"riskySignInCount","transform":"count"},
    {"sourceField":"value","targetField":"openRiskSignInCount","transform":"countWhere(''{{riskState}} == \"atRisk\" || {{riskState}} == \"confirmedCompromised\"'')"},
    {"sourceField":"value","targetField":"highRiskOpenSignInCount","transform":"countWhere(''({{riskState}} == \"atRisk\" || {{riskState}} == \"confirmedCompromised\") && {{riskLevel}} == \"high\"'')"}
  ]'::jsonb,
  severity_rules = '[
    {"expression":"{{highRiskOpenSignInCount}} > 0","severity":"high","label":"One or more high-risk sign-ins are unremediated (Identity Protection risk detection, activity=signin)"},
    {"expression":"{{openRiskSignInCount}} > 0","severity":"medium","label":"One or more sign-in risk detections remain unremediated"},
    {"expression":"{{riskySignInCount}} > 0","severity":"low","label":"Sign-in risk detections exist for this tenant"}
  ]'::jsonb,
  schema_version = schema_version + 1,
  updated_at = now()
WHERE key = 'identity:risky-signins'
RETURNING key, label, endpoint, properties, mapping, severity_rules, schema_version;

-- ── RECEIPT expectations ─────────────────────────────────────────────────────────
-- Exactly 1 row (identity:risky-signins). identity:risky-users is intentionally
-- untouched -- out of scope per the issue.
-- If the receipt looks right:  COMMIT;
-- If anything looks wrong:     ROLLBACK;


INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-06-risky-signins-endpoint-fix-492.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
COMMIT;
