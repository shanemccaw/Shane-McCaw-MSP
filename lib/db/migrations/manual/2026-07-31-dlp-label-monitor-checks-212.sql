-- The Four Real DLP/Label Monitor Checks (#212, parent epic #180 / #208)
-- Manual migration — Shane runs this himself (no DATABASE_URL in the Claude env).
--
-- ── WHAT THIS DOES ───────────────────────────────────────────────────────────────
-- Configures the four real check definitions the PowerShell-backed executor path
-- (#209 design, #210 container, #211 monitor-executor.ts — all live-verified) was
-- built for. NO schema change here — executor_type/ps_cmdlet_key/ps_params already
-- exist on monitor_checks from 2026-07-31-monitor-checks-powershell-executor.sql
-- (#211), which Shane has already run. This is a pure data migration: four
-- INSERTs, each wired to one of the four new $script:CmdletCatalog entries added
-- to services/ps-execution/entrypoint.ps1 in this same session (#212 Part 1).
--
-- ── WHICH CMDLET, AND WHY (researched against current Microsoft Learn docs,
--    2026-07-31 — see entrypoint.ps1's own catalog comments for the full citations) ──
--   compliance:weak-dlp-policies -> get-dlp-policies -> Get-DlpCompliancePolicy.
--     No "V2" cmdlet exists in current docs (the issue floated one as a
--     possibility). PostFilter (container-side, code-owned) narrows to policies
--     not in Mode=Enable or explicitly disabled — "weak" is this session's
--     product read of "not actively enforcing," not a Microsoft-defined term.
--   compliance:dlp-incidents -> get-dlp-incidents -> Export-ActivityExplorerData.
--     Get-DlpIncidentDetailReport ("will be retired") and Get-DlpDetailReport
--     ("This cmdlet is retired") are BOTH explicitly superseded by
--     Export-ActivityExplorerData on Microsoft Learn — confirmed live, not
--     assumed. Graph has no DLP-incident endpoint either (#180's own note), so
--     this genuinely requires the PS path, confirming rather than guessing that
--     premise. StartTime/EndTime/OutputFormat are mandatory on the real cmdlet;
--     StartTime/EndTime use the {NDaysAgo} relative-date placeholder this
--     session ALSO added to monitor-executor.ts's resolvePsParamsPlaceholders()
--     (artifacts/api-server/src/lib/monitor-executor.ts), mirroring the
--     existing Graph-endpoint {NDaysAgo} token — Activity Explorer only
--     retains 30 days regardless of what's requested.
--   compliance:missing-labels -> get-labels -> Get-Label.
--     Get-Label lists label DEFINITIONS, not per-document/per-site label
--     application — there is no Connect-IPPSSession-reachable cmdlet for
--     "documents missing a label" short of Content/Activity Explorer.
--     PostFilter narrows to Disabled=$true labels (defined but not currently
--     protecting anything) as the closest honest proxy available from this
--     cmdlet. FLAGGED: this is not literally "items missing sensitivity
--     labels" (copilot-readiness.ts's own docstring language) — it's the
--     nearest real signal Get-Label can produce. If Shane wants true per-item
--     label-application coverage, that needs a different data source
--     (Content Explorer export) and is a follow-up, not this issue.
--   compliance:label-errors -> get-label-policies -> Get-LabelPolicy.
--     PostFilter narrows to policies whose DistributionStatus is present and
--     not "Success" (confirmed via real-world usage reports — the Microsoft
--     Learn parameter page doesn't enumerate Get-LabelPolicy's output fields).
--
-- ── WHY _itemCount IS ALREADY THE RIGHT NUMBER, NOT JUST A RAW FETCH COUNT ──────
-- monitor-executor.ts's applyMapping() unconditionally sets
-- `_itemCount = items.length` — there is no post-fetch filtering stage on the
-- api-server side for PS-backed checks (Graph checks get that via
-- filterParams/$filter). So each cmdletKey's container-side PostFilter (see
-- entrypoint.ps1) does the narrowing BEFORE the response leaves the container —
-- `items` arriving at monitor-executor.ts is already the weak/errored/disabled
-- subset, so `_itemCount` is correct without any mapping-side transform.
-- compliance:dlp-incidents is the one exception: it's deliberately NOT scored
-- (metrics.ts declares no smartBands for compliance.dlpIncidentCount — it's
-- `shape: "trend"`, context only per copilot-readiness.ts's own file header),
-- so no PostFilter narrows it — Filter1 in ps_params scopes it to DLP-specific
-- Activity Explorer event types, but every matching event counts.
--
-- ── HOW THIS MAPS TO copilot-readiness.ts (verified by reading the whole file,
--    not guessed) ──────────────────────────────────────────────────────────────
-- computeCopilotReadiness() calls latestCheckProps(tenantId, "<key>") for all
-- four keys below and reads ONLY `_itemCount` via collectedCount() (which also
-- honors `__status === "error"` as "no data", handled automatically by the
-- existing generic error path — nothing to configure for that here). mapping
-- rules below add a couple of named/human-readable properties purely for admin
-- dashboard visibility (mirrors security:insider-risk-alerts' existing
-- pattern) — copilot-readiness.ts does not read them.
--
-- ── metrics.ts already declares these exact sourceKeys (dashboard-registry) ────
-- compliance.weakDlpPolicyCount -> compliance:weak-dlp-policies (smart, RISK_COUNT_BANDS)
-- compliance.dlpIncidentCount   -> compliance:dlp-incidents     (trend, not smart)
-- compliance.missingLabelCount  -> compliance:missing-labels    (smart, RISK_COUNT_BANDS)
-- compliance.labelErrorCount    -> compliance:label-errors      (smart, RISK_COUNT_BANDS)
-- These four keys were already PHANTOM sourceKeys before this migration
-- (2026-07-26-cost-waste-and-heatmap-check-audit.sql PART B) — this migration
-- is what makes them resolve to real monitor_checks rows for the first time.
--
-- ── REAL TESTBED TENANT ──────────────────────────────────────────────────────
-- c4c814d4-3afe-441e-9145-62461d0a4fd3 / mccawsoft2.onmicrosoft.com — domain
-- already populated (fixed during #211's live verification), no data-gap fix
-- needed here.
--
-- ── monitoring_package_checks (package curation) — DELIBERATELY NOT DONE HERE ──
-- Same convention as 2026-07-22-irm-alerts-monitor-check.sql: attaching these
-- four keys to a package (e.g. core:security-baseline) so they run on the
-- normal scheduled cadence is Shane's manual curation call, not something this
-- migration does on his behalf. Until that curation happens, these checks only
-- run when invoked directly (see the end-to-end test snippet at the bottom of
-- this file) — which is sufficient to satisfy #212's acceptance criteria
-- (prove real data flows through to copilot-readiness.ts), but not sufficient
-- for ongoing automatic collection.
--
-- Safe to run repeatedly: every INSERT is ON CONFLICT (key) DO NOTHING.

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
  'compliance:weak-dlp-policies',
  'Weak DLP Policies',
  'Count of Data Loss Prevention policies that are not actively enforcing (Mode is not Enable — i.e. still TestWithNotifications/TestWithoutNotifications/PendingDeletion — or explicitly disabled), via Get-DlpCompliancePolicy over the ps-execution container (#212). "Weak" is a product-level read of "not blocking anything," not a Microsoft-defined classification — filtered container-side (entrypoint.ps1 PostFilter) before this check ever sees the items, so _itemCount is already the weak-policy count.',
  '(unused — executorType=powershell drives dispatch, not endpoint)',
  'GET',
  'powershell',
  'get-dlp-policies',
  '{"Organization":"{organization}"}'::jsonb,
  '[]'::jsonb,
  '[{"sourceField":"Name","targetField":"weakPolicyNames"},{"sourceField":"Mode","targetField":"weakPolicyModes"}]'::jsonb,
  '[{"expression":"_itemCount > 0","severity":"warning","label":"One or more DLP policies are not actively enforcing"},{"expression":"_itemCount >= 3","severity":"critical","label":"Multiple DLP policies are not actively enforcing"}]'::jsonb,
  '["compliance"]'::jsonb,
  'daily',
  false,
  1,
  'active'
),
(
  'compliance:dlp-incidents',
  'DLP Incidents',
  'Count of DLP-related Activity Explorer events (Activity in DLPRuleMatch/DLPRuleEnforce/DLPInfo/DlpClassification) in the last 30 days, via Export-ActivityExplorerData over the ps-execution container (#212) — the current cmdlet; Get-DlpIncidentDetailReport and Get-DlpDetailReport are both retired per Microsoft Learn. Context only (metrics.ts declares no smart bands for compliance.dlpIncidentCount) — not itself scored by copilot-readiness.ts, shown alongside compliance:weak-dlp-policies.',
  '(unused — executorType=powershell drives dispatch, not endpoint)',
  'GET',
  'powershell',
  'get-dlp-incidents',
  '{"Organization":"{organization}","StartTime":"{30DaysAgo}","EndTime":"{0DaysAgo}","OutputFormat":"Json","PageSize":500,"Filter1":["Activity","DLPRuleMatch","DLPRuleEnforce","DLPInfo","DlpClassification"]}'::jsonb,
  '[]'::jsonb,
  '[{"sourceField":"PolicyName","targetField":"dlpIncidentPolicyNames"},{"sourceField":"Activity","targetField":"dlpIncidentActivityTypes"}]'::jsonb,
  '[{"expression":"_itemCount > 0","severity":"info","label":"DLP-related activity observed in the last 30 days"},{"expression":"_itemCount >= 20","severity":"warning","label":"Elevated DLP-related activity in the last 30 days"}]'::jsonb,
  '["compliance"]'::jsonb,
  'daily',
  false,
  1,
  'active'
),
(
  'compliance:missing-labels',
  'Missing Sensitivity Labels',
  'Count of sensitivity labels defined in the org''s taxonomy but currently Disabled (i.e. not protecting anything right now), via Get-Label over the ps-execution container (#212). FLAGGED: Get-Label lists label DEFINITIONS, not per-document/per-site label application — there is no Connect-IPPSSession-reachable cmdlet for true "documents missing a label" coverage short of Content/Activity Explorer. This is the closest honest proxy from Get-Label, not literal per-item coverage — see entrypoint.ps1''s catalog comment and #212 for the full reasoning. Filtered container-side (PostFilter) before this check sees the items.',
  '(unused — executorType=powershell drives dispatch, not endpoint)',
  'GET',
  'powershell',
  'get-labels',
  '{"Organization":"{organization}"}'::jsonb,
  '[]'::jsonb,
  '[{"sourceField":"DisplayName","targetField":"disabledLabelNames"}]'::jsonb,
  '[{"expression":"_itemCount > 0","severity":"warning","label":"One or more sensitivity labels are defined but disabled"},{"expression":"_itemCount >= 3","severity":"critical","label":"Multiple sensitivity labels are defined but disabled"}]'::jsonb,
  '["compliance"]'::jsonb,
  'daily',
  false,
  1,
  'active'
),
(
  'compliance:label-errors',
  'Sensitivity Label Errors',
  'Count of sensitivity label policies whose DistributionStatus is not "Success" (publish/distribution failures), via Get-LabelPolicy over the ps-execution container (#212). Filtered container-side (PostFilter) before this check sees the items, so _itemCount is already the errored-policy count.',
  '(unused — executorType=powershell drives dispatch, not endpoint)',
  'GET',
  'powershell',
  'get-label-policies',
  '{"Organization":"{organization}"}'::jsonb,
  '[]'::jsonb,
  '[{"sourceField":"Name","targetField":"labelErrorPolicyNames"}]'::jsonb,
  '[{"expression":"_itemCount > 0","severity":"warning","label":"One or more sensitivity label policies failed to distribute"},{"expression":"_itemCount >= 3","severity":"critical","label":"Multiple sensitivity label policies failed to distribute"}]'::jsonb,
  '["compliance"]'::jsonb,
  'daily',
  false,
  1,
  'active'
)
ON CONFLICT ("key") DO NOTHING;

COMMIT;


-- ══════════════════════════════════════════════════════════════════════════════════
-- READ-ONLY: verify the four new rows
-- ══════════════════════════════════════════════════════════════════════════════════

SELECT key, executor_type, ps_cmdlet_key, ps_params, status
FROM monitor_checks
WHERE key IN (
  'compliance:weak-dlp-policies',
  'compliance:dlp-incidents',
  'compliance:missing-labels',
  'compliance:label-errors'
)
ORDER BY key;


-- ── HOW TO RUN THE END-TO-END TEST (NOT DONE HERE — needs a live DB + the real
--    container, neither reachable from the Claude Code environment) ─────────────
-- Mirrors the pattern #211's diagnostics:ps-execution-test migration used —
-- direct executeMonitorCheck() calls against the real testbed tenant, then
-- computeCopilotReadiness() to confirm the DLP/Label sub-indicators are no
-- longer null/gap-scored:
--
--   import { executeMonitorCheck } from "./monitor-executor";
--   import { computeCopilotReadiness } from "./copilot-readiness";
--   import { db, monitorChecksTable } from "@workspace/db";
--   import { inArray } from "drizzle-orm";
--
--   const TENANT_ID = "c4c814d4-3afe-441e-9145-62461d0a4fd3";
--   const KEYS = [
--     "compliance:weak-dlp-policies", "compliance:dlp-incidents",
--     "compliance:missing-labels", "compliance:label-errors",
--   ];
--   const checks = await db.select().from(monitorChecksTable).where(inArray(monitorChecksTable.key, KEYS));
--   for (const check of checks) {
--     const result = await executeMonitorCheck({
--       check, tenantId: TENANT_ID, triggerId: "manual-212-smoke-test",
--       skipIdempotency: true, includeItems: true,
--     });
--     console.log(check.key, result.status, result.itemCount, result.extractedProperties);
--   }
--   console.log(await computeCopilotReadiness(TENANT_ID));
--   // Expect: every result.status === "ok" (or a genuine "error" if a given
--   // cmdlet/permission isn't actually available on the testbed tenant — that's
--   // real signal, not a bug, per the platform's no-fabrication principle),
--   // and computeCopilotReadiness()'s .sensitivityLabels/.dlp indicators no
--   // longer null (basis: "risk_bands", real counts in weakPolicies/
--   // unlabeledItems/labelErrors/dlpIncidents).
--
-- Requires PS_EXECUTION_CONTAINER_URL pointed at the live Container App and the
-- ps-execution-bearer-token Key Vault secret reachable from the api-server
-- environment (same Azure creds azure-keyvault.ts already uses) — both already
-- proven live during #210/#211.
