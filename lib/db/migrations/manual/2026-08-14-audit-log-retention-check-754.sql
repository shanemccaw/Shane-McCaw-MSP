-- Real audit log retention diagnostic check (#754, parent epic per #472's research pass)
--
-- ── WHAT THIS DOES ───────────────────────────────────────────────────────────────
-- Remediation Guide Step 18 ("Extend audit log retention beyond 90 days") has had
-- zero coverage platform-wide (confirmed absent by #472, 2026-08-06) and ships with
-- an honest gap disclosure (STEP_CHECK_GAPS.s18 in remediationLiveGuide.ts) instead
-- of a fabricated figure. This migration is the missing check: one new
-- `monitor_checks` row, `compliance:audit-log-retention`, backed by the
-- PowerShell-executor path (#209/#210/#211 — same mechanism the #212 DLP/label
-- checks use) via a new `get-audit-retention-policy` catalog entry added to
-- services/ps-execution/entrypoint.ps1 in this same session. NO schema change
-- (executor_type/ps_cmdlet_key/ps_params already exist on monitor_checks). Once
-- this row exists and is invoked, it reports into msp_diagnostic_findings through
-- the exact same generic pipeline (diagnostics-runner.ts's per-check loop ->
-- classifyCheckSeverity/buildFindingTitle/buildFindingDescription) every other
-- check already uses — no new TypeScript code needed, matching the #212 precedent.
--
-- ── WHICH CMDLET, AND WHY (researched against current Microsoft Learn docs,
--    2026-08-14) ──────────────────────────────────────────────────────────────
-- Get-UnifiedAuditLogRetentionPolicy is the current, non-retired Security &
-- Compliance cmdlet for reading a tenant's EXPLICITLY configured unified audit
-- log retention policies (RetentionDuration/RecordTypes/Enabled/Priority/etc. per
-- policy). No Graph REST equivalent exists — this genuinely requires the PS path,
-- same class of gap #212's DLP/label checks were built to close. No parameters are
-- required to list every policy in the org.
--
-- ── WHY THIS CHECK DOES NOT (AND CANNOT HONESTLY) TREAT "NO POLICY" AS "TOO
--    SHORT" ────────────────────────────────────────────────────────────────────
-- Get-UnifiedAuditLogRetentionPolicy only returns policies an admin explicitly
-- created. A tenant with zero custom policies is not automatically
-- non-compliant — Microsoft applies its own built-in default retention (1 year
-- with Purview Audit (Premium)/E5, 90 days without it), and this cmdlet carries
-- no signal about which licensing tier applies. Fabricating a "critical" verdict
-- for an empty list would misreport plenty of genuinely-compliant E5 tenants.
-- So the severity_rules below only fire "critical" on a REAL, explicitly
-- configured policy whose RetentionDuration enum value is unambiguously under 90
-- days (TwoWeeks/OneMonth) — a real, un-fabricated signal — and report the
-- zero-policy case as "info" (an honest "we cannot confirm either way from this
-- cmdlet alone" gap disclosure, not a clean "ok" and not a scary "critical").
-- RetentionDuration values are joined into `retentionDurations` (mapping's
-- `join` transform) so the severity_rules' `contains` grammar can read them as a
-- comma-joined string — the same joined-string-contains pattern classifySeverity
-- already supports (monitor-executor.ts's evalConditionGrammar).
--
-- FLAGGED (same spirit as #491/#212's own flagged gaps): "UserDefined" custom
-- retention (a per-day figure in the policy's own `Duration` property, not the
-- RetentionDuration enum) is NOT resolved to a day count by this check's
-- severity_rules — the generic condition grammar has no arithmetic step for that,
-- and building one would be new engine work out of #754's scope. It is still
-- captured for admin visibility via the `customRetentionDurations` mapping rule
-- below (raw Duration values, joined). If a tenant genuinely relies on
-- UserDefined and Shane wants that judged too, that is a follow-up.
--
-- ── HOW THIS MAPS TO copilot-readiness.ts / dashboard-registry ──────────────────
-- Deliberately NOT wired into metrics.ts's dashboard sourceKeys or
-- remediationLiveGuide.ts's STEP_CHECK_KEYS/STEP_CHECK_GAPS here — #754's own
-- issue text states it blocks #658 ("Remediation Guide real dynamic
-- personalization rebuild"), i.e. wiring Step 18's gap removal into the live
-- guide is #658's job once this check exists, not this migration's.
--
-- ── monitoring_package_checks (package curation) — DELIBERATELY NOT DONE HERE ──
-- Same convention as 2026-07-31-dlp-label-monitor-checks-212.sql: attaching this
-- key to a package (e.g. core:security-baseline) so it runs on the normal
-- scheduled cadence is Shane's manual curation call. Until that happens, this
-- check only runs when invoked directly (Simulator Studio / admin-monitor-checks
-- manual run) — sufficient to prove #754's real signal flows through to
-- msp_diagnostic_findings, not sufficient for ongoing automatic collection.
--
-- ── DEPLOYMENT NOTE ──────────────────────────────────────────────────────────
-- The new `get-audit-retention-policy` cmdletKey only takes effect once the
-- ps-execution Container App is redeployed with this session's
-- services/ps-execution/entrypoint.ps1 change — Shane controls that deploy
-- (CLAUDE.md). Until then, invoking this check returns `unknown_cmdlet`.
--
-- Safe to run repeatedly: the INSERT is ON CONFLICT (key) DO NOTHING.

BEGIN;

INSERT INTO "monitor_checks" (
  "key", "label", "description",
  "endpoint", "method",
  "executor_type", "ps_cmdlet_key", "ps_params",
  "properties", "mapping", "severity_rules",
  "engines", "frequency", "requires_customer_script",
  "schema_version", "status"
) VALUES
(
  'compliance:audit-log-retention',
  'Audit Log Retention Policy',
  'Reads the tenant''s explicitly configured Microsoft Purview unified audit log retention policies via Get-UnifiedAuditLogRetentionPolicy over the ps-execution container (#754) — no Graph REST equivalent exists. Backs Remediation Guide Step 18 ("Extend audit log retention beyond 90 days"). FLAGGED: this cmdlet only reports EXPLICIT custom policies, not Microsoft''s implicit license-tier-dependent default (1 year with Purview Audit (Premium)/E5, 90 days without) — a tenant with zero custom policies is reported as an honest gap (info), never fabricated as critical or clean. "UserDefined" custom-duration policies are captured for visibility only (customRetentionDurations); their day count is not arithmetically evaluated by severity_rules — see this file''s own header.',
  '(unused — executorType=powershell drives dispatch, not endpoint)',
  'GET',
  'powershell',
  'get-audit-retention-policy',
  '{"Organization":"{organization}"}'::jsonb,
  '[]'::jsonb,
  '[{"sourceField":"Name","targetField":"retentionPolicyNames"},{"sourceField":"RetentionDuration","targetField":"retentionDurations"},{"sourceField":"Duration","targetField":"customRetentionDurations"}]'::jsonb,
  '[{"expression":"{{retentionDurations}} contains ''TwoWeeks'' || {{retentionDurations}} contains ''OneMonth''","severity":"critical","label":"An audit log retention policy on this tenant explicitly retains records for under 90 days"},{"expression":"_itemCount == 0","severity":"info","label":"No custom audit log retention policy is configured — audit records fall back to Microsoft''s built-in default retention, which is only 90 days without Purview Audit (Premium)/E5 licensing"}]'::jsonb,
  '["compliance"]'::jsonb,
  'daily',
  false,
  1,
  'active'
)
ON CONFLICT ("key") DO NOTHING;


INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-14-audit-log-retention-check-754.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
COMMIT;


-- ══════════════════════════════════════════════════════════════════════════════════
-- READ-ONLY: verify the new row
-- ══════════════════════════════════════════════════════════════════════════════════

SELECT key, executor_type, ps_cmdlet_key, ps_params, severity_rules, status
FROM monitor_checks
WHERE key = 'compliance:audit-log-retention';


-- ── HOW TO RUN THE END-TO-END TEST (NOT DONE HERE — needs the ps-execution
--    container redeployed with this session's entrypoint.ps1 change first) ──────
--   import { executeMonitorCheck } from "./monitor-executor";
--   import { db, monitorChecksTable } from "@workspace/db";
--   import { eq } from "drizzle-orm";
--
--   const TENANT_ID = "c4c814d4-3afe-441e-9145-62461d0a4fd3"; // mccawsoft2.onmicrosoft.com
--   const [check] = await db.select().from(monitorChecksTable).where(eq(monitorChecksTable.key, "compliance:audit-log-retention"));
--   const result = await executeMonitorCheck({
--     check, tenantId: TENANT_ID, triggerId: "manual-754-smoke-test",
--     skipIdempotency: true, includeItems: true,
--   });
--   console.log(result.status, result.itemCount, result.extractedProperties, result.severityMatched);
--   // Expect: status "ok" with real retentionDurations/retentionPolicyNames (or a
--   // genuine "error"/"cmdlet_unavailable" if the tenant's app-only identity isn't
--   // yet a member of the required Purview role group — real signal, not a bug).
