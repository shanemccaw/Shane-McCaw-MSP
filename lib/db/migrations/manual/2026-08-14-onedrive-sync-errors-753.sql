-- ============================================================================
-- #753 — New check: OneDrive sync error detection (zero coverage today)
-- ============================================================================
-- Manual migration — self-executed via shaneapp://executeSql per current
-- CLAUDE.md (the old "Shane runs this himself" default is obsolete).
-- Idempotent: ON CONFLICT DO NOTHING throughout; safe to re-run.
--
-- ── WHAT THIS CLOSES ────────────────────────────────────────────────────────
-- Confirmed via #472's platform-wide research pass (2026-08-06, restated in
-- #753's own issue body): no check anywhere in this platform reads OneDrive
-- sync health/error state for any tenant. Remediation Guide Step 28 ("Resolve
-- the 214 OneDrive sync errors") ships with an honest gap disclosure
-- (STEP_CHECK_GAPS in remediationLiveGuide.ts) instead of a fake number
-- because of exactly this absence. This migration adds the real check;
-- 2026-08-14-remediation-live-guide-step28-onedrive-sync-753 (msp-portal
-- code change, same session) moves Step 28 out of the gap list once it lands.
--
-- ── WHY THIS IS A PROXY, NOT A LITERAL "SYNC ERROR" READ — SAID OUT LOUD ────
-- Microsoft Graph has no sync-error/sync-health API. OneDrive sync errors are
-- a CLIENT-side signal (the desktop sync app's own local state) with no
-- server-side Graph surface at all. The only real server-side proxy — and the
-- one this platform's own remediation guide script already documents
-- (previewRemediationGuide.ts s28 / remediationLiveGuide.ts STEP_CHECK_GAPS.s28)
-- — is GET /reports/getOneDriveUsageAccountDetail(period='D30'), filtered to
-- accounts with a BLANK "Last Activity Date" that are NOT marked deleted: an
-- account nobody has synced to in 30 days that still exists is what "sync is
-- broken for this user" looks like from the server side. It is an honest
-- proxy, not a certainty — the check's own description says so, and Shane's
-- existing guide copy already cautions "most sync errors are a stale client
-- rather than a service fault."
-- Docs: learn.microsoft.com/en-us/graph/api/reportroot-getonedriveusageaccountdetail
-- Permission: Reports.Read.All (Application) — already in REQUIRED_MT_SCOPES
-- (graph.ts), same as onedrive:storage-utilization (which already hits this
-- exact endpoint at period='D7' for a different field), so no new tenant
-- consent is needed.
--
-- ── EXECUTION MODEL — REUSED, NOT REINVENTED ────────────────────────────────
-- No fan-out needed: this is a single tenant-wide report call, same shape as
-- adoption:sharepoint-onedrive-trend / onedrive:storage-utilization. Per
-- monitor-executor.ts's documented CSV handling (isCsvReportResponse /
-- parseCsvReport, ~L475-527), the report's CSV rows flow into `items` exactly
-- like Graph JSON items, so the existing `countWhere('<expression>')` mapping
-- transform (the same evalConditionGrammar condition grammar severity_rules
-- already use — #541/#551/#404 precedent) can predicate directly on each row's
-- own "Last Activity Date" / "Is Deleted" columns. `resolvePathInData`'s
-- literal-key-first lookup (~L308-331) resolves a spaced CSV header like
-- "Last Activity Date" as a plain object key, so no renaming/aliasing step is
-- needed between the CSV and the mapping rule.
--
-- ── PACKAGE CURATION — DELIBERATELY NOT DONE HERE ──────────────────────────
-- Same convention as 2026-07-22-irm-alerts-monitor-check.sql,
-- 2026-07-31-dlp-label-monitor-checks-212.sql, and #680's Part E: attaching
-- this key to a scoring package (e.g. core:security-baseline) so it runs on
-- the normal scheduled cadence is Shane's manual curation call, not something
-- this migration makes on his behalf. Part C below links it into
-- detail:full-item-collection ONLY — the per-account item list (Owner
-- Principal Name / Site URL, the exact two columns the guide's own script
-- already selects), no scoring, no severity evaluation gate. Until Shane
-- curates it into a scoring package, the check exists and is directly
-- runnable/testable but does not run on the automatic cadence.
-- ============================================================================


-- ══════════════════════════════════════════════════════════════════════════════
-- PART A — READ-ONLY: what exists today (run first, keep the output)
-- ══════════════════════════════════════════════════════════════════════════════
-- Expect: the four existing onedrive:* checks, and NO row for the new key.
-- If onedrive:sync-errors already exists, Part B is a no-op and you are
-- re-running this file — which is safe.

SELECT key, label, endpoint, engines, status
FROM monitor_checks
WHERE key IN ('onedrive:departed-user-access', 'onedrive:external-sharing-settings',
              'onedrive:storage-utilization', 'onedrive:overshared-files',
              'onedrive:sync-errors')
ORDER BY key;


-- ══════════════════════════════════════════════════════════════════════════════
-- PART B — THE CHECK
-- ══════════════════════════════════════════════════════════════════════════════
-- MAPPING
--   oneDriveStaleSyncAccountCount : countWhere over the WHOLE report row
--     ({{Last Activity Date}} == "" && {{Is Deleted}} == "False") — the exact
--     proxy predicate the guide's own PowerShell script already runs
--     (Where-Object { $_."Last Activity Date" -eq "" -and $_."Is Deleted" -eq "False" }).
--   oneDriveAccountsScanned : plain `count` on "Owner Principal Name" — the
--     real denominator (every account the report returned), so a reader can
--     see coverage, not just the flagged subset.
--
-- SEVERITY THRESHOLDS
--   The 20-account critical threshold is not invented here — it is the exact
--   number the platform's own remediationLiveGuide.ts s28 `liveVerify`/
--   previewRemediationGuide.ts already state as the resolution target
--   ("Sync error count falls below 20 in the admin center health report").
--   Reusing that number keeps the check's severity band and the guide's own
--   "you're done" line in agreement instead of two independently-guessed
--   numbers. Below 20, still worth a warning — Shane's own guide copy already
--   frames any nonzero count as worth a look, just not urgent.

BEGIN;

INSERT INTO "monitor_checks" (
  "key", "label", "description",
  "endpoint", "method",
  "properties", "mapping", "severity_rules",
  "engines", "frequency", "requires_customer_script",
  "schema_version", "status"
) VALUES (
  'onedrive:sync-errors',
  'OneDrive Sync Errors',
  'Real per-tenant OneDrive sync health proxy (#753) -- Graph has no sync-error API, so this reads GET /reports/getOneDriveUsageAccountDetail(period=''D30'') and counts accounts with a BLANK "Last Activity Date" that are NOT marked deleted: an account nobody has synced to in 30 days that still exists, the same proxy the platform''s own remediation guide script (Step 28) already documents and runs by hand (Get-MgReportOneDriveUsageAccountDetail -Period D30 | Where-Object { $_."Last Activity Date" -eq "" -and $_."Is Deleted" -eq "False" }). This is an honest PROXY for client-side sync errors, not a literal read of them -- most flagged accounts are a stale/out-of-date OneDrive client rather than a genuine service fault (see the guide''s own caution line), and this check cannot distinguish the two. App permission Reports.Read.All only -- already in REQUIRED_MT_SCOPES (same permission onedrive:storage-utilization already uses against this identical endpoint at a shorter D7 window), so no new tenant consent is needed. Backs Remediation Guide Step 28 and unblocks #658''s dynamic step selection for that step.',
  '/reports/getOneDriveUsageAccountDetail(period=''D30'')',
  'GET',
  '[]'::jsonb,
  '[{"sourceField":"value","targetField":"oneDriveStaleSyncAccountCount","transform":"countWhere(''{{Last Activity Date}} == \"\" && {{Is Deleted}} == \"False\"'')"},
    {"sourceField":"Owner Principal Name","targetField":"oneDriveAccountsScanned","transform":"count"}]'::jsonb,
  '[{"expression":"{{oneDriveStaleSyncAccountCount}} >= 20","severity":"critical","label":"{{oneDriveStaleSyncAccountCount}} OneDrive account(s) show no recorded sync activity in 30 days and are not marked deleted -- likely stale or broken sync clients"},
    {"expression":"{{oneDriveStaleSyncAccountCount}} > 0","severity":"warning","label":"{{oneDriveStaleSyncAccountCount}} OneDrive account(s) show no recorded sync activity in 30 days and are not marked deleted -- likely stale or broken sync clients"}]'::jsonb,
  '["health"]'::jsonb,
  'daily',
  false,
  1,
  'active'
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-14-onedrive-sync-errors-753.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
COMMIT;


-- ══════════════════════════════════════════════════════════════════════════════
-- PART C — WIRE THE FULL PER-ACCOUNT LIST INTO THE EXISTING DETAIL TABLE
-- ══════════════════════════════════════════════════════════════════════════════
-- No new table, no new runner. detail:full-item-collection (#339) already runs
-- its linked checks with includeItems: true and persists each COMPLETE item
-- list (i.e. every CSV row, not just the flagged ones) to
-- tenant_check_item_details.items -- the same wiring #680 uses.

INSERT INTO monitoring_package_checks (package_key, check_key, sort_order)
SELECT
  'detail:full-item-collection',
  'onedrive:sync-errors',
  COALESCE((SELECT max(sort_order) FROM monitoring_package_checks
             WHERE package_key = 'detail:full-item-collection'), -1) + 1
WHERE EXISTS (SELECT 1 FROM monitoring_packages WHERE key = 'detail:full-item-collection')
ON CONFLICT (package_key, check_key) DO NOTHING;


-- ══════════════════════════════════════════════════════════════════════════════
-- PART D — OPTIONAL: also run it inside the SCORING scan (Shane's call)
-- ══════════════════════════════════════════════════════════════════════════════
-- NOT done automatically -- see the "PACKAGE CURATION" note at the top of this
-- file. core:security-baseline's own curation header explicitly scopes it to
-- security-posture checks (identity/threat-protection/email-security/device-
-- compliance/data-exposure), not operational-health signals like this one, so
-- this is a genuinely separate decision from #680's (which is itself also
-- left commented, for the same reason).
--
-- >>> SHANE: uncomment to add it to the scored baseline (or another package)
--     as well. Note engines is ["health"] on the check above, so doing this
--     makes it recompute health scoring after each scan.
--
-- INSERT INTO monitoring_package_checks (package_key, check_key, sort_order)
-- SELECT 'core:security-baseline', 'onedrive:sync-errors',
--        COALESCE((SELECT max(sort_order) FROM monitoring_package_checks
--                   WHERE package_key = 'core:security-baseline'), -1) + 1
-- ON CONFLICT (package_key, check_key) DO NOTHING;
-- <<<


-- ══════════════════════════════════════════════════════════════════════════════
-- PART E — READ-ONLY: verify
-- ══════════════════════════════════════════════════════════════════════════════
-- Expect one check row, engines = ["health"], and detail_package_rows = 1. If
-- detail_package_rows = 0, the #339 migration has not been run on this
-- database -- run it first, then re-run Part C.

SELECT key, label, endpoint, method, properties, mapping, severity_rules,
       engines, frequency, schema_version, status
FROM monitor_checks
WHERE key = 'onedrive:sync-errors';

SELECT
  (SELECT count(*) FROM monitor_checks
    WHERE key = 'onedrive:sync-errors')                          AS check_rows,
  (SELECT count(*) FROM monitoring_package_checks
    WHERE package_key = 'detail:full-item-collection'
      AND check_key = 'onedrive:sync-errors')                    AS detail_package_rows,
  (SELECT count(*) FROM monitoring_package_checks
    WHERE package_key = 'core:security-baseline'
      AND check_key = 'onedrive:sync-errors')                    AS scoring_package_rows;


-- ── AFTER THE FIRST REAL SCAN (once Part D is curated in) — the honesty check ──

-- SELECT d.tenant_id, d.status, d.item_count, d.items_omitted_reason,
--        s->>'Owner Principal Name'  AS owner,
--        s->>'Site URL'              AS onedrive_url,
--        s->>'Last Activity Date'    AS last_activity,
--        s->>'Is Deleted'            AS is_deleted
-- FROM tenant_check_item_details d
-- CROSS JOIN LATERAL jsonb_array_elements(COALESCE(d.items, '[]'::jsonb)) AS s
-- WHERE d.check_key = 'onedrive:sync-errors'
--   AND (s->>'Last Activity Date') = ''
--   AND (s->>'Is Deleted') = 'False'
-- ORDER BY d.collected_at DESC, s->>'Owner Principal Name';

-- SELECT tenant_id, status, severity_matched, collected_at,
--        extracted_properties->'oneDriveStaleSyncAccountCount'  AS stale_sync_accounts,
--        extracted_properties->'oneDriveAccountsScanned'        AS accounts_scanned
-- FROM tenant_monitor_profiles
-- WHERE check_key = 'onedrive:sync-errors'
-- ORDER BY collected_at DESC
-- LIMIT 20;


-- ══════════════════════════════════════════════════════════════════════════════
-- FOLLOW-UP — DELIBERATELY NOT DONE HERE
-- ══════════════════════════════════════════════════════════════════════════════
-- Same honest gap the check's own description states: this is a proxy for
-- sync errors, not a read of them -- Graph has no client-side sync-error
-- surface at v1.0 or beta. Not wired here (separate follow-up scope):
--   * A metric-registry entry (lib/dashboard-registry/src/metrics.ts).
--   * war_room_pillar_stat_specs coverage for the new check.
--   * Shane's own curation decision on Part D (which scoring package, if any).
-- ============================================================================
