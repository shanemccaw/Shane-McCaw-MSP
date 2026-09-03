-- ============================================================================
-- #2187 — copilot: domain monitor_checks query/label mismatches
-- ============================================================================
-- Manual migration, run by the agent session itself against local
-- DATABASE_URL (per CLAUDE.md's additive-DDL/DML rule) — not by Shane.
-- Idempotent: every UPDATE is guarded on the DEFECTIVE mapping it replaces, so
-- re-running this file after it has applied is a no-op.
--
-- ── SCOPE, per the issue body's own 4 findings ──────────────────────────────
--
--   1. copilot:active-usage-rate    — FIXED here (severity_rules added).
--   2. copilot:usage-by-app         — FIXED here (mapping + severity_rules).
--   3. copilot:license-vs-total-users — PARTIALLY fixed here: the mapping bug
--      (see Part C) is real and independent of the "vs total users" framing,
--      and is fixed. The true active/total or license/total RATIO is NOT
--      addable here — see the note in Part C and the filed finding.
--   4. copilot:data-exposure-risk   — ALREADY FIXED. Confirmed live below still
--      carries fan_out_source = '/sites/getAllSites' from migration
--      2026-08-08-copilot-data-exposure-risk-real-signal-553.sql. No action.
--
-- ── WHY NO CHECK HERE COMPUTES A TRUE PERCENTAGE ────────────────────────────
-- Confirmed by reading applyMapping() and evaluateRule() in full
-- (artifacts/api-server/src/lib/monitor-executor.ts,
-- artifacts/api-server/src/lib/tenant-signals.ts): neither the mapping
-- transform vocabulary (KNOWN_TRANSFORMS — count/first/groupByCount/
-- countWhere/valueWhere/etc.) nor the condition grammar evalConditionGrammar
-- used by BOTH severity_rules and signal_derivation_rules supports division,
-- multiplication or any two-field arithmetic combination — confirmed by
-- reading evalClause's full operator list (==, !=, >, <, >=, <=, contains,
-- length>, olderThanDays/newerThanDays; no "/", "*", "+", "-"). Every
-- existing "-rate"/"utilization" check in this platform (adoption:overall-
-- active-rate, exchange:archive-mailbox-rate, security:dlp-true-positive-
-- rate, cost:utilization-by-sku) already has this same structural gap — a
-- numerator-only count with no true ratio. This is a platform-wide engine
-- limitation, not something specific to copilot's checks, and not something
-- a DB-only migration can add. Filed as its own finding (see completion
-- comment on #2187) rather than invented ad hoc here.
--
-- What IS achievable within the existing grammar, and is what this migration
-- does: comparison-only severity_rules using two fields the check ALREADY
-- has (e.g. "active count == 0 AND licensed count > 0" — a real, meaningful,
-- zero-arithmetic threshold), same pattern identity:global-admin-count and
-- appgov:cert-secret-expiration already use for their own severity_rules.
-- ============================================================================


-- ══════════════════════════════════════════════════════════════════════════════
-- PART A — READ-ONLY: what exists today (run first, keep the output)
-- ══════════════════════════════════════════════════════════════════════════════

SELECT key, label, endpoint, mapping, severity_rules, properties, fan_out_source
FROM monitor_checks
WHERE key IN (
  'copilot:active-usage-rate',
  'copilot:usage-by-app',
  'copilot:license-vs-total-users',
  'copilot:data-exposure-risk'
)
ORDER BY key;


-- ══════════════════════════════════════════════════════════════════════════════
-- PART B — copilot:active-usage-rate — add real severity_rules
-- ══════════════════════════════════════════════════════════════════════════════
-- The mapping itself is already correct: getMicrosoft365CopilotUsageUserDetail
-- only ever returns rows for LICENSED users (Microsoft's own documented
-- contract, cited in the issue body), so `count` over non-null
-- `lastActivityDate` genuinely is "users who used Copilot in the window" and
-- `_itemCount` genuinely is "users licensed for Copilot" — the numerator and
-- denominator of the intended ratio are both real and both already present
-- in this check's own extracted data. The one real defect is
-- severity_rules: [], which the issue's own words call out — "never fires a
-- finding." Fixed by adding real, comparison-only thresholds.

UPDATE monitor_checks
SET
  severity_rules = '[
    {
      "label": "Copilot is licensed for {{_itemCount}} user(s) on this tenant, but none of them used it in any app over the last 7 days — the org is paying for adoption that is not happening",
      "severity": "critical",
      "expression": "{{copilotActiveUserCount}} == 0 && {{_itemCount}} > 0"
    },
    {
      "label": "The Copilot usage report returned no licensed users for the last 7 days — either no Copilot licenses are assigned yet or usage reporting has not populated for this tenant",
      "severity": "info",
      "expression": "{{_itemCount}} == 0"
    }
  ]'::jsonb,
  updated_at = now()
WHERE key = 'copilot:active-usage-rate'
  AND severity_rules = '[]'::jsonb;


-- ══════════════════════════════════════════════════════════════════════════════
-- PART C — copilot:usage-by-app — real mapping against the real v1.0 shape
-- ══════════════════════════════════════════════════════════════════════════════
-- Confirmed live 2026-09-03 against learn.microsoft.com's own documented v1.0
-- example response for
--   GET /copilot/reports/getMicrosoft365CopilotUserCountTrend(period='D7')
-- (copilotreportroot-getmicrosoft365copilotusercounttrend, v1 zone):
--
--   Report Refresh Date,Report Date,Microsoft Teams Enabled Users,
--   Microsoft Teams Active Users,Word Enabled Users,Word Active Users,
--   PowerPoint Enabled Users,PowerPoint Active Users,Outlook Enabled Users,
--   Outlook Active Users,Excel Enabled Users,Excel Active Users,
--   OneNote Enabled Users,OneNote Active Users,Loop Enabled Users,
--   Loop Active Users,Any App Enabled Users,Any App Active Users,
--   Copilot Chat Enabled Users,Copilot Chat Active Users,Report Period
--
-- Per Content-Type octet-stream/text-csv (v1.0 is a CSV report, same family
-- as getOffice365ActiveUserDetail etc.) — the executor's own CSV path
-- (isCsvReportResponse / parseCsvReport, monitor-executor.ts:624-676) already
-- parses this into row objects KEYED BY THESE LITERAL HEADER STRINGS
-- (including the spaces), and resolvePathInData already handles spaced keys
-- as single literal identifiers (see its own comment re: "Last Activity
-- Date"). There is no "appActivity" field anywhere in this shape — the
-- current mapping's groupByCount over it produces an empty object on every
-- run. Replaced with one "first" rule per real column, reading the report's
-- one row for the period.

UPDATE monitor_checks
SET
  properties = '[]'::jsonb,
  mapping = '[
    {"transform": "first", "sourceField": "Report Date", "targetField": "copilotUsageReportDate"},
    {"transform": "first", "sourceField": "Microsoft Teams Enabled Users", "targetField": "copilotTeamsEnabledUsers"},
    {"transform": "first", "sourceField": "Microsoft Teams Active Users", "targetField": "copilotTeamsActiveUsers"},
    {"transform": "first", "sourceField": "Word Enabled Users", "targetField": "copilotWordEnabledUsers"},
    {"transform": "first", "sourceField": "Word Active Users", "targetField": "copilotWordActiveUsers"},
    {"transform": "first", "sourceField": "PowerPoint Enabled Users", "targetField": "copilotPowerPointEnabledUsers"},
    {"transform": "first", "sourceField": "PowerPoint Active Users", "targetField": "copilotPowerPointActiveUsers"},
    {"transform": "first", "sourceField": "Outlook Enabled Users", "targetField": "copilotOutlookEnabledUsers"},
    {"transform": "first", "sourceField": "Outlook Active Users", "targetField": "copilotOutlookActiveUsers"},
    {"transform": "first", "sourceField": "Excel Enabled Users", "targetField": "copilotExcelEnabledUsers"},
    {"transform": "first", "sourceField": "Excel Active Users", "targetField": "copilotExcelActiveUsers"},
    {"transform": "first", "sourceField": "OneNote Enabled Users", "targetField": "copilotOneNoteEnabledUsers"},
    {"transform": "first", "sourceField": "OneNote Active Users", "targetField": "copilotOneNoteActiveUsers"},
    {"transform": "first", "sourceField": "Loop Enabled Users", "targetField": "copilotLoopEnabledUsers"},
    {"transform": "first", "sourceField": "Loop Active Users", "targetField": "copilotLoopActiveUsers"},
    {"transform": "first", "sourceField": "Any App Enabled Users", "targetField": "copilotAnyAppEnabledUsers"},
    {"transform": "first", "sourceField": "Any App Active Users", "targetField": "copilotAnyAppActiveUsers"},
    {"transform": "first", "sourceField": "Copilot Chat Enabled Users", "targetField": "copilotChatEnabledUsers"},
    {"transform": "first", "sourceField": "Copilot Chat Active Users", "targetField": "copilotChatActiveUsers"}
  ]'::jsonb,
  severity_rules = '[
    {
      "label": "{{copilotAnyAppEnabledUsers}} user(s) are enabled for Microsoft 365 Copilot across all apps, but {{copilotAnyAppActiveUsers}} of them used it in any app over the last 7 days",
      "severity": "critical",
      "expression": "{{copilotAnyAppEnabledUsers}} > 0 && {{copilotAnyAppActiveUsers}} == 0"
    },
    {
      "label": "{{copilotChatEnabledUsers}} user(s) are enabled for Copilot Chat, but none of them used it over the last 7 days",
      "severity": "warning",
      "expression": "{{copilotChatEnabledUsers}} > 0 && {{copilotChatActiveUsers}} == 0"
    }
  ]'::jsonb,
  updated_at = now()
WHERE key = 'copilot:usage-by-app'
  AND mapping = '[{"transform": "groupByCount", "sourceField": "appActivity", "targetField": "copilotUsageByApp"}]'::jsonb;


-- ══════════════════════════════════════════════════════════════════════════════
-- PART D — copilot:license-vs-total-users — fix the real extraction bug
-- ══════════════════════════════════════════════════════════════════════════════
-- THE DEFECT, independent of the ratio framing: mapping was
--   [{"transform": "first", "sourceField": "consumedUnits", "targetField": "copilotLicenseCount"}]
-- `first` takes the FIRST non-null consumedUnits value across ALL SKUs
-- returned by /subscribedSkus, in whatever order Graph returns them — NOT
-- specifically the Microsoft_365_Copilot SKU's consumedUnits. On any tenant
-- where a different SKU sorts first, copilotLicenseCount reports THAT SKU's
-- seat count, not Copilot's. This is wrong data, not just a coarse ratio.
--
-- Fixed via #2187's own engine change to applyMapping's `valueWhere`
-- transform (artifacts/api-server/src/lib/monitor-executor.ts): sourceField
-- as a WHOLE_ITEM_SOURCE_FIELDS sentinel ("value") now means "match/extract
-- against the fetched items themselves", not only a nested name/value array —
-- /subscribedSkus' items already ARE {skuPartNumber, consumedUnits} objects
-- directly. No stored check used valueWhere before this widening, so it
-- changes no other check's behavior (confirmed: `grep mapping::text ILIKE
-- '%valueWhere%'` against live monitor_checks returned zero rows pre-change).
--
-- The genuine "vs total users" RATIO is NOT added here — see the file
-- header. What's fixed is that copilotLicenseCount now reliably names the
-- Copilot SKU's own real consumedUnits, and a seat-capacity field
-- (prepaidUnits.enabled) is added alongside it so "seats purchased" is also
-- a real, available number for a future ratio computed at the cross-check
-- tenant-signals layer (which DOES already have access to both this check's
-- copilotLicenseCount and identity:department-directory's totalUserCount,
-- via the merged tenant profile) rather than within this single check.

UPDATE monitor_checks
SET
  mapping = '[
    {"transform": "valueWhere(''skuPartNumber'', ''Microsoft_365_Copilot'', ''consumedUnits'')", "sourceField": "value", "targetField": "copilotLicenseCount"},
    {"transform": "valueWhere(''skuPartNumber'', ''Microsoft_365_Copilot'', ''prepaidUnits.enabled'')", "sourceField": "value", "targetField": "copilotLicensedSeatCapacity"}
  ]'::jsonb,
  properties = '["skuPartNumber", "consumedUnits", "prepaidUnits"]'::jsonb,
  severity_rules = '[
    {
      "label": "This tenant has a Microsoft 365 Copilot subscription, but zero of its licenses are currently consumed — a likely stalled or reverted rollout",
      "severity": "warning",
      "expression": "{{copilotLicenseCount}} == 0"
    },
    {
      "label": "No Microsoft 365 Copilot SKU (Microsoft_365_Copilot) was found in this tenant''s subscribedSkus — Copilot has not been purchased",
      "severity": "info",
      "expression": "{{copilotLicenseCount}} == null"
    }
  ]'::jsonb,
  updated_at = now()
WHERE key = 'copilot:license-vs-total-users'
  AND mapping = '[{"transform": "first", "sourceField": "consumedUnits", "targetField": "copilotLicenseCount"}]'::jsonb;


-- ══════════════════════════════════════════════════════════════════════════════
-- PART E — VERIFY (run last)
-- ══════════════════════════════════════════════════════════════════════════════

SELECT key, mapping, severity_rules, properties
FROM monitor_checks
WHERE key IN ('copilot:active-usage-rate', 'copilot:usage-by-app', 'copilot:license-vs-total-users')
ORDER BY key;


-- ══════════════════════════════════════════════════════════════════════════════
-- Self-marking run record (Simulator Studio Migrations tree, Git #497)
-- ══════════════════════════════════════════════════════════════════════════════
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-03-copilot-domain-check-query-fixes-2187.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
