-- ============================================================================
-- #1105 — Adoption Active Users: fix broken active-user mappings + add OneDrive
-- ============================================================================
-- Manual migration — self-executed via shaneapp://executeSql per current
-- CLAUDE.md (the old "Shane runs this himself" default is obsolete).
-- Idempotent: UPDATE + ON CONFLICT DO NOTHING throughout; safe to re-run.
--
-- ── WHAT THIS CLOSES ────────────────────────────────────────────────────────
-- Follow-up from #1100 (part of epic #1045): the Adoption panel's 4
-- `usage.*ActiveCount` metrics (lib/dashboard-registry/src/metrics.ts) have
-- carried the `not_collected:` sentinel since the registry was authored,
-- because #1105's own issue body states "no monitor check has ever been
-- written to collect these, for any tenant."
--
-- Investigating that turned out to be only half true. Three real checks
-- already exist and already run on the normal `core:enhanced-monitoring`
-- cadence for every tenant — `adoption:teams-activity-trend`,
-- `adoption:email-activity-trend`, `adoption:sharepoint-onedrive-trend` (added
-- 2026-07-19, endpoints corrected 2026-07-23) — but every one of them has
-- ALWAYS produced 0, confirmed live against the testbed tenant
-- (c4c814d4-3afe-441e-9145-62461d0a4fd3) via `shaneapp://executeSql` today:
--
--   * Their `mapping.sourceField` is written in camelCase
--     ("lastActivityDate"), but these are CSV usage-report endpoints, and
--     `parseCsvReport` (monitor-executor.ts ~L522-526) keys each row on the
--     LITERAL CSV header text, spaces and all ("Last Activity Date").
--     `resolvePathInData`'s literal-key-first lookup (~L308-331) does an exact
--     match with no case/space normalization, so "lastActivityDate" resolves
--     to `undefined` on every row of every one of these checks, forever. The
--     `count` transform then counts zero non-null values — a confident, silent
--     0, not a crash — and ships that 0 straight into `teamsActiveUserCount` /
--     `sharepointActiveUserCount` / `emailActiveUserCount` /
--     `overallActiveUserCount` on every run since 2026-07-19.
--   * Separately, even a bare presence/absence read of "Last Activity Date"
--     would be WRONG for "active in this period": live captured rows show
--     non-blank dates far older than the check's own D7 window (a SharePoint
--     site in a `period='D7'` report with "Last Activity Date": "2018-12-15";
--     a Teams user with "Last Activity Date": "2026-06-20" against a
--     "Report Refresh Date": "2026-08-15", ~8 weeks apart). Per Microsoft's
--     actual behaviour, "Last Activity Date" in these *Detail reports is the
--     most recent activity EVER recorded, not activity bounded to `period` —
--     `period` only bounds how far back a row is retained at all. Blank vs
--     non-blank was never a valid activity-in-period predicate for these
--     endpoints; that finding is bookmarked for whoever next touches
--     `onedrive:sync-errors` (#753), which makes the same blank-vs-non-blank
--     assumption at `period='D30'` — NOT touched here, different check,
--     different owner call.
--
-- ── THE FIX ─────────────────────────────────────────────────────────────────
-- Every mapping below reads `{{Last Activity Date}} newerThanDays 7` (the
-- existing `evalConditionGrammar` word-operator, monitor-executor.ts ~L614)
-- instead of blank/non-blank — a real "active within the trailing 7 days"
-- predicate, evaluated against `Date.now()` at scan time (close enough to the
-- report's own ~daily "Report Refresh Date" for this purpose) — `&&
-- {{Is Deleted}} == "False"` so a deleted mailbox/site/account showing a stale
-- cached activity date never counts. countWhere with sourceField "value"
-- (whole-item predicate, same shape #753's shipped check already uses) is the
-- existing condition-grammar mechanism this needs — no executor change.
--
-- SharePoint is a known, honest proxy, not a literal "active users" read:
-- `adoption:sharepoint-onedrive-trend` hits `getSharePointSiteUsageDetail`,
-- which is PER-SITE, not per-user (its own name is a misnomer — it has never
-- queried OneDrive at all). Its `sharepointActiveUserCount` field is really
-- "sites with a recent active user", not a deduplicated user count. Left
-- alone rather than repointed at `getSharePointActivityUserDetail` (the real
-- per-user endpoint) because this check's storage-byte/file-count columns are
-- also consumed by cost/storage tracking elsewhere in `core:enhanced-monitoring`
-- (see `onedrive:storage-utilization` sharing the same package) and changing
-- its endpoint would risk that unrelated data, which is out of scope for #1105.
--
-- OneDrive genuinely has no per-account activity check today (confirmed: zero
-- `onedrive:*` check reads `getOneDriveUsageAccountDetail` at `period='D7'` —
-- only #753's `onedrive:sync-errors` reads that endpoint, at `period='D30'`
-- for a different purpose). Part C adds `onedrive:active-users`, same
-- predicate shape, new check row.
--
-- Docs: learn.microsoft.com/en-us/graph/api/reportroot-getteamsuseractivityuserdetail
--       learn.microsoft.com/en-us/graph/api/reportroot-getemailactivityuserdetail
--       learn.microsoft.com/en-us/graph/api/reportroot-getsharepointsiteusagedetail
--       learn.microsoft.com/en-us/graph/api/reportroot-getonedriveusageaccountdetail
-- Permission: Reports.Read.All (Application) for all four — already in
-- REQUIRED_MT_SCOPES (graph.ts); teams/email/sharepoint already run under it
-- today, and #753's onedrive:sync-errors already runs the OneDrive endpoint
-- under it, so no new tenant consent is needed for the new check either.
-- ============================================================================


-- ══════════════════════════════════════════════════════════════════════════════
-- PART A — READ-ONLY: what exists today (run first, keep the output)
-- ══════════════════════════════════════════════════════════════════════════════
-- Expect the 3 existing adoption:* checks with their current (broken) mapping,
-- and NO row for onedrive:active-users.

SELECT key, label, endpoint, mapping, status
FROM monitor_checks
WHERE key IN ('adoption:teams-activity-trend', 'adoption:email-activity-trend',
              'adoption:sharepoint-onedrive-trend', 'onedrive:active-users')
ORDER BY key;


-- ══════════════════════════════════════════════════════════════════════════════
-- PART B — FIX THE 3 EXISTING CHECKS' MAPPING
-- ══════════════════════════════════════════════════════════════════════════════
-- Only `mapping` + `updated_at` change. Endpoint, severity_rules, engines,
-- package membership are all untouched — this is a mapping-correctness fix,
-- not a re-scope.

BEGIN;

UPDATE monitor_checks
SET mapping = '[
  {"sourceField":"value","targetField":"teamsActiveUserCount","transform":"countWhere(''{{Last Activity Date}} newerThanDays 7 && {{Is Deleted}} == \"False\"'')"},
  {"sourceField":"User Principal Name","targetField":"teamsLicensedUserCount","transform":"count"}
]'::jsonb,
    updated_at = now()
WHERE key = 'adoption:teams-activity-trend';

UPDATE monitor_checks
SET mapping = '[
  {"sourceField":"value","targetField":"emailActiveUserCount","transform":"countWhere(''{{Last Activity Date}} newerThanDays 7 && {{Is Deleted}} == \"False\"'')"},
  {"sourceField":"User Principal Name","targetField":"emailLicensedUserCount","transform":"count"}
]'::jsonb,
    updated_at = now()
WHERE key = 'adoption:email-activity-trend';

UPDATE monitor_checks
SET mapping = '[
  {"sourceField":"value","targetField":"sharepointActiveUserCount","transform":"countWhere(''{{Last Activity Date}} newerThanDays 7 && {{Is Deleted}} == \"False\"'')"},
  {"sourceField":"Owner Principal Name","targetField":"sharepointSitesScanned","transform":"count"}
]'::jsonb,
    updated_at = now()
WHERE key = 'adoption:sharepoint-onedrive-trend';

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-17-adoption-active-user-counts-1105.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
COMMIT;


-- ══════════════════════════════════════════════════════════════════════════════
-- PART C — NEW CHECK: OneDrive active users (no existing coverage at all)
-- ══════════════════════════════════════════════════════════════════════════════

BEGIN;

INSERT INTO "monitor_checks" (
  "key", "label", "description",
  "endpoint", "method",
  "properties", "mapping", "severity_rules",
  "engines", "frequency", "requires_customer_script",
  "schema_version", "status"
) VALUES (
  'onedrive:active-users',
  'OneDrive Active Users',
  'Real per-tenant OneDrive active-user count (#1105) -- GET /reports/getOneDriveUsageAccountDetail(period=''D7''), counting accounts with a "Last Activity Date" within the trailing 7 days ({{Last Activity Date}} newerThanDays 7) that are NOT marked deleted. Distinct from #753''s onedrive:sync-errors, which reads the SAME endpoint at period=''D30'' for a different purpose (flagging stale/broken sync via a BLANK Last Activity Date) -- this check is the honest inverse: a real activity-recency count, not a staleness proxy. App permission Reports.Read.All only -- already in REQUIRED_MT_SCOPES (same permission onedrive:storage-utilization and onedrive:sync-errors already use against this identical endpoint), so no new tenant consent is needed.',
  '/reports/getOneDriveUsageAccountDetail(period=''D7'')',
  'GET',
  '[]'::jsonb,
  '[{"sourceField":"value","targetField":"oneDriveActiveUserCount","transform":"countWhere(''{{Last Activity Date}} newerThanDays 7 && {{Is Deleted}} == \"False\"'')"},
    {"sourceField":"Owner Principal Name","targetField":"oneDriveAccountsScanned","transform":"count"}]'::jsonb,
  '[]'::jsonb,
  '["adoption"]'::jsonb,
  'daily',
  false,
  1,
  'active'
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-17-adoption-active-user-counts-1105.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
COMMIT;


-- ══════════════════════════════════════════════════════════════════════════════
-- PART D — WIRE THE NEW CHECK INTO THE SAME PACKAGES ITS 3 SIBLINGS RUN IN
-- ══════════════════════════════════════════════════════════════════════════════
-- adoption:teams-activity-trend / email-activity-trend / sharepoint-onedrive-
-- trend all run in core:enhanced-monitoring (the normal scheduled cadence) and
-- detail:full-item-collection (#339, per-item persistence). onedrive:active-
-- users joins the same two, so it actually collects real data for every
-- tenant going forward, not just on manual trigger. Deliberately NOT added to
-- assess:copilot-readiness -- neither onedrive:storage-utilization nor
-- onedrive:sync-errors are in that package either (same precedent #753 set).

INSERT INTO monitoring_package_checks (package_key, check_key, sort_order)
SELECT 'core:enhanced-monitoring', 'onedrive:active-users',
       COALESCE((SELECT max(sort_order) FROM monitoring_package_checks
                  WHERE package_key = 'core:enhanced-monitoring'), -1) + 1
WHERE EXISTS (SELECT 1 FROM monitoring_packages WHERE key = 'core:enhanced-monitoring')
ON CONFLICT (package_key, check_key) DO NOTHING;

INSERT INTO monitoring_package_checks (package_key, check_key, sort_order)
SELECT 'detail:full-item-collection', 'onedrive:active-users',
       COALESCE((SELECT max(sort_order) FROM monitoring_package_checks
                  WHERE package_key = 'detail:full-item-collection'), -1) + 1
WHERE EXISTS (SELECT 1 FROM monitoring_packages WHERE key = 'detail:full-item-collection')
ON CONFLICT (package_key, check_key) DO NOTHING;


-- ══════════════════════════════════════════════════════════════════════════════
-- PART E — READ-ONLY: verify the catalog state
-- ══════════════════════════════════════════════════════════════════════════════

SELECT key, label, endpoint, mapping, severity_rules, engines, status
FROM monitor_checks
WHERE key IN ('adoption:teams-activity-trend', 'adoption:email-activity-trend',
              'adoption:sharepoint-onedrive-trend', 'onedrive:active-users')
ORDER BY key;

SELECT package_key, check_key, sort_order
FROM monitoring_package_checks
WHERE check_key = 'onedrive:active-users'
ORDER BY package_key;


-- ── AFTER THE NEXT SCAN — the honesty check (real counts, not zeros) ──────────

-- SELECT check_key, tenant_id, status, collected_at,
--        extracted_properties->'teamsActiveUserCount'      AS teams_active,
--        extracted_properties->'emailActiveUserCount'       AS email_active,
--        extracted_properties->'sharepointActiveUserCount'  AS sharepoint_active,
--        extracted_properties->'oneDriveActiveUserCount'    AS onedrive_active
-- FROM tenant_monitor_profiles
-- WHERE check_key IN ('adoption:teams-activity-trend', 'adoption:email-activity-trend',
--                      'adoption:sharepoint-onedrive-trend', 'onedrive:active-users')
-- ORDER BY collected_at DESC
-- LIMIT 20;


-- ══════════════════════════════════════════════════════════════════════════════
-- FOLLOW-UP — DELIBERATELY NOT DONE HERE
-- ══════════════════════════════════════════════════════════════════════════════
--   * onedrive:sync-errors (#753)'s own blank-vs-non-blank "Last Activity Date"
--     assumption at period='D30' looks like the same category of bug this
--     migration just fixed (Last Activity Date is not period-bounded) -- not
--     touched here, different check, needs its own look and its own decision
--     on whether a 30-day newerThanDays/olderThanDays window changes the
--     20-account severity threshold's meaning.
--   * pillar-summary-stats.ts's `adoption: []` (deliberately emptied by #441,
--     with the exact 4 "active X users" stats this migration now makes real
--     sitting in PILLAR_UNPRODUCIBLE_STATS) is the natural next beneficiary
--     of this fix -- left alone here since it is a different resolution path
--     (pillar-summary-stats.ts + its own tests), reported as a follow-up
--     rather than folded into this issue's scope.
-- ============================================================================
