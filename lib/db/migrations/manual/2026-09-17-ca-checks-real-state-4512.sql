-- ============================================================================
-- #4512 -- the three Conditional Access criticals only tested whether A policy
-- existed. Policy state, grant controls and conditions were never evaluated,
-- Security Defaults was ignored, and a tenant without Entra ID P1 scored critical.
-- ============================================================================
-- Additive, idempotent: one new nullable column, plus UPDATEs of three
-- monitor_checks rows and three signal_derivation_rules rows by key. Safe to
-- re-run. Run locally in-session (#4512); Replit/Staging carries it via the
-- #1630 release checklist.
--
-- ── WHAT WAS WRONG (live, tenant 2080, run d1dc0ffe-db89-403a-91b9-d94b77d873b6) ──
--   identity:ca-mfa-coverage      exists(grantControls) -> caMfaPolicyExists
--   identity:ca-legacy-auth-block exists(conditions)    -> caLegacyAuthBlockExists
--   identity:ca-policy-count      count(id)             -> caPolicyCount
--   1. A single report-only or disabled policy with any grant cleared all three.
--      Every CA template the remediation packs create is report-only, so running
--      the remediation flipped three criticals to OK while enforcing nothing.
--   2. Tenant 2080 has securityDefaultsEnabled = true (MFA enforced, legacy auth
--      blocked) and no Entra ID P1 (ENTERPRISEPACK, FLOW_FREE, POWER_BI_STANDARD,
--      Power_Pages_vTrial_for_Makers). GET /identity/conditionalAccess/policies
--      answers that tenant with a clean 200 and zero policies, not a 403, so all
--      three reported critical.
--
-- ── WHAT EACH CHECK MEASURES NOW ────────────────────────────────────────────
-- Predicates run through countWhere (the executor's condition grammar) over the
-- whole policy objects (sourceField "value"; the endpoint returns full objects).
--   ca-mfa-coverage       state enabled, includeUsers All, includeApplications All,
--                         grant builtInControls contains mfa OR an
--                         authenticationStrength is set
--                         -> caMfaEnforcedPolicyCount
--   ca-legacy-auth-block  state enabled, includeUsers All, clientAppTypes contains
--                         exchangeActiveSync AND other, grant contains block
--                         -> caLegacyAuthBlockEnforcedPolicyCount
--   ca-policy-count       caPolicyCount (all), caPolicyCountEnabled,
--                         caPolicyCountReportOnly; critical keys on ENABLED only
-- includeApplications All (MFA) and includeUsers All (legacy block) go slightly
-- beyond the issue's wording on purpose: a policy scoped to one app or one pilot
-- group does not cover standard sign-in. A legacy-auth block split across two
-- policies (one exchangeActiveSync, one other) is NOT recognised -- Microsoft's
-- own template uses one policy.
--
-- ── SECURITY DEFAULTS -> suppressed (monitor_checks.gate_*, #4503) ────────────
-- gate_endpoint  /policies/identitySecurityDefaultsEnforcementPolicy
-- gate_expression {{isEnabled}} != true
-- Security Defaults on: the check's own endpoint is not fetched, no severity is
-- evaluated, the row persists status ok with _gateSkipped + isEnabled true as
-- evidence. "!= true" rather than "== false" so a response missing isEnabled
-- runs the check instead of suppressing it.
--
-- ── NO ENTRA ID P1 -> license gap (monitor_checks.required_service_plans, NEW) ──
-- ["AAD_PREMIUM","AAD_PREMIUM_P2"] -- real servicePlanNames, any one satisfies.
-- Service plans rather than skuPartNumbers because P1 ships inside SPE_E3,
-- SPE_E5, SPB and EMS under other SKU names. Evaluated AFTER the gate, live from
-- /subscribedSkus; when none is provisioned the executor raises the existing
-- LicenseGapError path: status license_gap, "Requires Microsoft Entra ID P1 or
-- P2", hasAADP1orP2 false. A failed license read runs the check as before.
--
-- ── SIGNAL RULES ────────────────────────────────────────────────────────────
-- source_key moves to the new count keys. The rule types still hold:
-- profile_key_falsy fires on 0 and ignores an absent key; profile_key_eq 0 on
-- caPolicyCountEnabled. Profiles written before this migration carry the old
-- keys, so these signals stay quiet (not falsely fire) until the next scan.
-- ============================================================================

ALTER TABLE monitor_checks ADD COLUMN IF NOT EXISTS required_service_plans jsonb;

UPDATE monitor_checks
SET
  properties = '["id","displayName","state"]'::jsonb,
  mapping = '[
    {"sourceField":"value","targetField":"caMfaEnforcedPolicyCount","transform":"countWhere(\"{{state}} == ''enabled'' && {{conditions.users.includeUsers}} contains ''All'' && {{conditions.applications.includeApplications}} contains ''All'' && {{grantControls.builtInControls}} contains ''mfa'' || {{state}} == ''enabled'' && {{conditions.users.includeUsers}} contains ''All'' && {{conditions.applications.includeApplications}} contains ''All'' && {{grantControls.authenticationStrength.id}} != null\")"}
  ]'::jsonb,
  severity_rules = '[
    {"severity":"critical","expression":"caMfaEnforcedPolicyCount == 0","label":"No enforced Conditional Access policy requires MFA for all users"}
  ]'::jsonb,
  description = 'Whether an ENABLED Conditional Access policy requires MFA (or an authentication strength) for all users on all cloud apps (#4512). '
    || 'Report-only and disabled policies do not count. Suppressed when Security Defaults is on; reported as a license gap without Entra ID P1.',
  gate_endpoint = '/policies/identitySecurityDefaultsEnforcementPolicy',
  gate_expression = '{{isEnabled}} != true',
  required_service_plans = '["AAD_PREMIUM","AAD_PREMIUM_P2"]'::jsonb,
  schema_version = schema_version + 1,
  updated_at = now()
WHERE key = 'identity:ca-mfa-coverage'
  AND required_service_plans IS NULL;

UPDATE monitor_checks
SET
  properties = '["id","displayName","state"]'::jsonb,
  mapping = '[
    {"sourceField":"value","targetField":"caLegacyAuthBlockEnforcedPolicyCount","transform":"countWhere(\"{{state}} == ''enabled'' && {{conditions.users.includeUsers}} contains ''All'' && {{conditions.clientAppTypes}} contains ''exchangeActiveSync'' && {{conditions.clientAppTypes}} contains ''other'' && {{grantControls.builtInControls}} contains ''block''\")"}
  ]'::jsonb,
  severity_rules = '[
    {"severity":"critical","expression":"caLegacyAuthBlockEnforcedPolicyCount == 0","label":"No enforced Conditional Access policy blocks legacy authentication — MFA can be bypassed entirely"}
  ]'::jsonb,
  description = 'Whether an ENABLED Conditional Access policy blocks legacy authentication (exchangeActiveSync and other clients) for all users (#4512). '
    || 'Report-only and disabled policies do not count. Suppressed when Security Defaults is on; reported as a license gap without Entra ID P1.',
  gate_endpoint = '/policies/identitySecurityDefaultsEnforcementPolicy',
  gate_expression = '{{isEnabled}} != true',
  required_service_plans = '["AAD_PREMIUM","AAD_PREMIUM_P2"]'::jsonb,
  schema_version = schema_version + 1,
  updated_at = now()
WHERE key = 'identity:ca-legacy-auth-block'
  AND required_service_plans IS NULL;

UPDATE monitor_checks
SET
  properties = '["id","displayName","state"]'::jsonb,
  mapping = '[
    {"sourceField":"id","targetField":"caPolicyCount","transform":"count"},
    {"sourceField":"value","targetField":"caPolicyCountEnabled","transform":"countWhere(\"{{state}} == ''enabled''\")"},
    {"sourceField":"value","targetField":"caPolicyCountReportOnly","transform":"countWhere(\"{{state}} == ''enabledForReportingButNotEnforced''\")"}
  ]'::jsonb,
  severity_rules = '[
    {"severity":"critical","expression":"caPolicyCountEnabled == 0 && caPolicyCountReportOnly > 0","label":"No Conditional Access policy is enforced — report-only policies ({{caPolicyCountReportOnly}}) challenge no one"},
    {"severity":"critical","expression":"caPolicyCountEnabled == 0","label":"No Conditional Access policy is enforced — zero Zero Trust enforcement on this tenant"}
  ]'::jsonb,
  description = 'Conditional Access policies configured, counted separately as enabled and report-only (#4512). '
    || 'Only enabled policies clear the critical. Suppressed when Security Defaults is on; reported as a license gap without Entra ID P1.',
  gate_endpoint = '/policies/identitySecurityDefaultsEnforcementPolicy',
  gate_expression = '{{isEnabled}} != true',
  required_service_plans = '["AAD_PREMIUM","AAD_PREMIUM_P2"]'::jsonb,
  schema_version = schema_version + 1,
  updated_at = now()
WHERE key = 'identity:ca-policy-count'
  AND required_service_plans IS NULL;

UPDATE signal_derivation_rules SET source_key = 'caMfaEnforcedPolicyCount', updated_at = now()
WHERE signal_key = 'signal.identity.ca-mfa-coverage' AND source_key = 'caMfaPolicyExists';

UPDATE signal_derivation_rules SET source_key = 'caLegacyAuthBlockEnforcedPolicyCount', updated_at = now()
WHERE signal_key = 'signal.identity.ca-legacy-auth-block' AND source_key = 'caLegacyAuthBlockExists';

UPDATE signal_derivation_rules SET source_key = 'caPolicyCountEnabled', updated_at = now()
WHERE signal_key = 'signal.identity.ca-policy-count' AND source_key = 'caPolicyCount';

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-17-ca-checks-real-state-4512.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
