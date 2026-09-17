-- ============================================================================
-- #4534 -- identity:ca-device-compliance still had the pre-#4512 shape: an
-- `exists` transform over `grantControls`, so any report-only/disabled policy
-- with any grant cleared it, and a tenant without Entra ID P1 (whose CA policy
-- list comes back as a clean empty 200) scored a warning rather than a
-- license gap. Same defect #4512 fixed on the three CA criticals, found while
-- fixing those but left out of that build's scope. Same mechanism, applied here.
-- ============================================================================
-- Additive, idempotent: one UPDATE of the monitor_checks row by key, one
-- UPDATE of the signal_derivation_rules row by key. No new columns --
-- required_service_plans already exists on monitor_checks (#4512). Safe to
-- re-run.
--
-- ── WHAT WAS WRONG (live, before this migration) ────────────────────────────
--   identity:ca-device-compliance  exists(grantControls) -> caDeviceCompliancePolicyExists
--   Nearly every CA policy has grantControls, so any policy -- report-only,
--   disabled, or enforcing something unrelated like MFA -- cleared the check.
--   No policy had to require compliantDevice. A tenant without Entra ID P1
--   (confirmed live on tenant 2080: HTTP 200, 0 policies, AAD_PREMIUM=false
--   AAD_PREMIUM_P2=false) got a warning instead of a license gap.
--
-- ── WHAT THE CHECK MEASURES NOW ─────────────────────────────────────────────
-- countWhere over the whole policy objects (sourceField "value"; the endpoint
-- returns full objects): state enabled AND grantControls.builtInControls
-- contains compliantDevice -> caDeviceCompliancePolicyEnforcedCount. Only an
-- ENABLED policy that actually requires device compliance clears it --
-- report-only and disabled policies, and policies granting on MFA/block/other
-- controls without compliantDevice, do not.
--
-- ── SECURITY DEFAULTS -> left OFF, deliberately (unlike #4512's three) ──────
-- Security Defaults enforces MFA and blocks legacy auth; it does not enforce
-- device compliance. Gating this check on Security Defaults would clear a
-- real gap, so gate_endpoint/gate_expression stay NULL.
--
-- ── NO ENTRA ID P1 -> license gap (monitor_checks.required_service_plans) ───
-- ["AAD_PREMIUM","AAD_PREMIUM_P2"] -- same two real servicePlanNames #4512
-- gated the three CA criticals on, any one satisfies (required_service_plans
-- is an ANY-OF list -- see license-gate.ts tenantHasRequiredLicense). Device
-- compliance also needs Intune provisioned, which required_service_plans
-- cannot express (it has no ALL-OF form) -- tracked as a separate finding
-- rather than building new gate infrastructure in this pass.
--
-- ── SIGNAL RULE ──────────────────────────────────────────────────────────
-- Rule 2779 (signal.identity.ca-device-compliance, profile_key_falsy) moves
-- source_key to the new count key. profile_key_falsy fires on 0 and ignores
-- an absent key, so profiles written before this migration stay quiet (not
-- falsely fire) until the next scan.
-- ============================================================================

UPDATE monitor_checks
SET
  properties = '["id","displayName","state"]'::jsonb,
  mapping = '[
    {"sourceField":"value","targetField":"caDeviceCompliancePolicyEnforcedCount","transform":"countWhere(\"{{state}} == ''enabled'' && {{grantControls.builtInControls}} contains ''compliantDevice''\")"}
  ]'::jsonb,
  severity_rules = '[
    {"severity":"warning","expression":"caDeviceCompliancePolicyEnforcedCount == 0","label":"No enforced Conditional Access policy requires device compliance"}
  ]'::jsonb,
  description = 'Whether an ENABLED Conditional Access policy requires device compliance in its grant controls (#4534, same mechanism as #4512). '
    || 'Report-only and disabled policies, and policies granting on other controls without compliantDevice, do not count. Reported as a license gap without Entra ID P1. Not suppressed by Security Defaults, which does not enforce device compliance.',
  required_service_plans = '["AAD_PREMIUM","AAD_PREMIUM_P2"]'::jsonb,
  schema_version = schema_version + 1,
  updated_at = now()
WHERE key = 'identity:ca-device-compliance'
  AND required_service_plans IS NULL;

UPDATE signal_derivation_rules SET source_key = 'caDeviceCompliancePolicyEnforcedCount', updated_at = now()
WHERE signal_key = 'signal.identity.ca-device-compliance' AND source_key = 'caDeviceCompliancePolicyExists';

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-17-ca-device-compliance-real-state-4534.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
