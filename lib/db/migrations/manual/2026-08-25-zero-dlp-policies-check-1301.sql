-- Zero-DLP-policies critical finding check (#1301)
-- Manual migration — Shane runs this himself (schema/data changes are hand-written
-- per the standing rule, never drizzle-kit push).
--
-- ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
-- A deliberately-broken tenant (no Conditional Access, no DLP) produced a real
-- critical CA finding (identity:ca-policy-count's `caPolicyCount == 0` rule fires
-- end-to-end, confirmed in msp_diagnostic_findings) but NO DLP finding at all.
-- The only DLP severity check, compliance:weak-dlp-policies, counts the
-- WEAK/non-enforcing SUBSET (container-side PostFilter in entrypoint.ps1) — so a
-- tenant with ZERO DLP policies has nothing for it to count and it produces
-- `_itemCount == 0`, which is indistinguishable from a healthy tenant whose
-- policies all actively enforce. That is the real coverage hole #1301 documents.
--
-- ── HOW THIS MIRRORS THE CA CHECK (the pattern the issue asks to match) ───────
-- identity:ca-policy-count is a raw count -> eq-0 -> critical:
--     mapping        = count(id) -> caPolicyCount
--     severity_rules = [{ caPolicyCount == 0 -> critical }]
-- This check is the DLP-domain equivalent. DLP has no Graph endpoint (unlike CA's
-- /identity/conditionalAccess/policies), so it goes through the ps-execution
-- container via Get-DlpCompliancePolicy — but through a NEW cmdletKey
-- `get-all-dlp-policies` (added to services/ps-execution/entrypoint.ps1 in this
-- same change) that has NO PostFilter, so `_itemCount`/`dlpPoliciesCount` is the
-- TOTAL policy count, not the weak subset:
--     mapping        = count(Name) -> dlpPoliciesCount
--     severity_rules = [{ dlpPoliciesCount == 0 -> critical }]
--
-- ── WHY EXTENDING compliance:weak-dlp-policies WAS NOT VIABLE ─────────────────
-- The issue offered "extend the existing check's severity rules" as an
-- alternative. It is not usable here: weak-dlp's container-side PostFilter
-- narrows to weak policies BEFORE the count reaches the api-server, so an
-- `_itemCount == 0` critical rule there would FALSE-FIRE on a healthy tenant with
-- zero WEAK policies (all actively enforcing). A separate unfiltered check is the
-- only honest way to distinguish "zero policies total" from "zero weak policies".
--
-- ── SAFETY: an errored/unlicensed DLP collection never fakes a critical ───────
-- Confirmed against real profile rows: an errored PS DLP check persists
-- status="error", severity_matched=NULL, extracted_properties=NULL (and
-- diagnostics-runner.classifyCheckSeverity forces status="error" -> "info"
-- regardless of any severity match). So a container/permission failure surfaces
-- as an informational "couldn't complete", NEVER a false "0 policies" critical,
-- and never writes a false dlpPoliciesCount=0 to tenant_monitor_profiles. The
-- critical only fires on a genuine status="ok" run that really found zero.
--
-- ── SIDE BENEFIT toward the #1301 "single source of truth" goal ──────────────
-- The mapping's targetField is `dlpPoliciesCount` on purpose: that is the exact
-- profile key the SOW-signal rules (custom_signals adj:security-compliance /
-- hasDLPGaps, "dlpPoliciesCount == 0") already reference but which NO producer
-- ever wrote (tenant-signals.ts bridgeLegacyProfileKeys deliberately does NOT
-- fabricate it). This check becomes that key's first real producer, so the
-- SOW DLP-gap signal reads real data instead of a phantom — a concrete first
-- step of the "router" convergence #1301 envisions. This ADDS a real producer
-- to previously-dead logic; it removes nothing. See the issue comment's router
-- proposal.
--
-- Safe to run repeatedly: INSERT ... ON CONFLICT DO NOTHING.

BEGIN;

INSERT INTO "monitor_checks" (
  "key", "label", "description",
  "endpoint", "method",
  "executor_type", "ps_cmdlet_key", "ps_params",
  "properties", "mapping", "severity_rules",
  "engines", "frequency", "requires_customer_script",
  "schema_version", "status"
) VALUES (
  'compliance:zero-dlp-policies',
  'DLP Policy Coverage',
  'Count of ALL Data Loss Prevention policies in the tenant (Get-DlpCompliancePolicy, UNFILTERED) via the ps-execution container. Zero DLP policies means data loss prevention is absent entirely — a critical gap that compliance:weak-dlp-policies (which only counts the weak/non-enforcing subset) structurally cannot detect. Mirrors identity:ca-policy-count''s existing raw-count -> eq-0 -> critical pattern.',
  '(unused — executorType=powershell drives dispatch, not endpoint)',
  'GET',
  'powershell',
  'get-all-dlp-policies',
  '{"Organization":"{organization}"}'::jsonb,
  '[]'::jsonb,
  '[{"transform":"count","sourceField":"Name","targetField":"dlpPoliciesCount"}]'::jsonb,
  '[{"expression":"dlpPoliciesCount == 0","severity":"critical","label":"No DLP policies exist — data loss prevention is absent on this tenant"}]'::jsonb,
  '["compliance"]'::jsonb,
  'daily',
  false,
  1,
  'active'
)
ON CONFLICT ("key") DO NOTHING;

-- Package membership: mirror compliance:weak-dlp-policies' exact footprint so the
-- new check runs on the same cadence, for the same tiers, as its sibling DLP
-- check (assess:copilot-readiness, core:growth, core:premier,
-- detail:full-item-collection). sort_order 0 is fine — package order is not
-- severity order.
INSERT INTO "monitoring_package_checks" ("package_key", "check_key", "sort_order")
SELECT pk, 'compliance:zero-dlp-policies', 0
FROM (VALUES
  ('assess:copilot-readiness'),
  ('core:growth'),
  ('core:premier'),
  ('detail:full-item-collection')
) AS t(pk)
ON CONFLICT DO NOTHING;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-25-zero-dlp-policies-check-1301.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;

-- ── READ-ONLY verification ───────────────────────────────────────────────────
SELECT key, executor_type, ps_cmdlet_key, mapping, severity_rules, status
FROM monitor_checks WHERE key = 'compliance:zero-dlp-policies';

SELECT package_key, check_key FROM monitoring_package_checks
WHERE check_key = 'compliance:zero-dlp-policies' ORDER BY package_key;
