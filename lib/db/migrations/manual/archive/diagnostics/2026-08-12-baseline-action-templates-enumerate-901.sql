-- Git #901 — read-only enumeration of the real, currently-active baseline_action_templates rows
-- and the testbed customer(s) eligible to run them against.
--
-- Diagnostic only (pure SELECT, no DDL/DML) — not part of the tracked migration set, per
-- CLAUDE.md's "diagnostic/investigation-only files go in archive/diagnostics/" rule. No
-- DATABASE_URL is available in this environment, so this file was never run here — Shane runs
-- it himself in his SQL console to confirm the 10 rows still match
-- lib/db/migrations/manual/2026-07-20-launch-control-phase3-templates.sql byte-for-byte (an admin
-- could have edited endpoint/bodyTemplate/successCriteria via the CRUD routes in
-- artifacts/api-server/src/routes/admin-baseline-templates.ts since that migration ran) before
-- pointing test-manifests/baseline-actions-powershell-verify.json at real object ids.

-- 1. The 10 real, active baseline_action_templates rows this manifest targets.
SELECT
  template_id,
  label,
  category,
  endpoint,
  method,
  body_template,
  required_variables,
  success_criteria,
  requires_verification_gate,
  status,
  schema_version
FROM baseline_action_templates
WHERE template_id IN (
  'users.disable_enable_signin',
  'users.force_password_reset',
  'auth.revoke_signin_sessions',
  'licensing.assign_license',
  'licensing.remove_license',
  'groups.add_member',
  'groups.remove_member',
  'teams.add_member',
  'teams.remove_member',
  'sharepoint.restore_recycle_bin_item'
)
ORDER BY template_id;

-- 2. Testbed customers eligible to run these writes for real — mirrors the exact WHERE clause
--    GET /admin/baseline-templates/testbed-customers uses, plus the write-back gate columns
--    graphWriteForTenant() enforces (Gate 1: msps.write_back_enabled; Gate 2: per-tenant
--    consent->writeBack.status = 'granted') so Shane can see up front whether a candidate
--    testbed customer will actually pass both gates before this manifest's writes hit Graph.
SELECT
  t.id AS customer_id,
  t.customer_name,
  t.tenant_id,
  t.is_testbed,
  t.status AS tenant_status,
  m.write_back_enabled AS msp_write_back_enabled,
  t.consent -> 'writeBack' ->> 'status' AS write_back_consent_status
FROM tenants t
JOIN msps m ON m.id = t.msp_id
WHERE t.is_testbed = true
  AND t.status = 'active'
  AND t.tenant_id IS NOT NULL
ORDER BY t.customer_name;
