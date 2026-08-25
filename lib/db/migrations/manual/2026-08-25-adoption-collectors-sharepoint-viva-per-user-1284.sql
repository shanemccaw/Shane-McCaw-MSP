-- ============================================================================
-- Adoption page remaining collectors: true per-user SharePoint activity and
-- true per-user Viva Engage activity (#1284, follow-up from #1253)
-- ============================================================================
-- Manual migration -- self-executed via direct local Postgres connection per
-- current CLAUDE.md. Idempotent: every INSERT is ON CONFLICT (key) DO NOTHING
-- / ON CONFLICT (package_key, check_key) DO NOTHING; safe to re-run.
--
-- ── #1284's OWN PREMISE IS PARTLY STALE, SAME CLASS OF ISSUE #1253 HIT ──────
-- #1284 names 4 rows as having "zero backing implementation anywhere":
-- Copilot weekly-active usage, Planner/Tasks, Viva Engage, true per-user
-- SharePoint activity. Confirmed live against this DB before writing this
-- file:
--
--   * Copilot weekly-active usage -- ALREADY COLLECTED.
--     `copilot:active-usage-rate` (GET
--     /copilot/reports/getMicrosoft365CopilotUsageUserDetail(period='D7'))
--     is active, engines ["copilot","adoption"], wired into all 4 monitoring
--     packages. `copilot:license-vs-total-users` (GET /subscribedSkus) gives
--     the licensed-seat denominator. Nothing added for Copilot here --
--     wiring the Adoption page's Copilot row off these two existing checks
--     is a frontend-only change in this same commit, not a new collector.
--   * Planner/Tasks -- ALREADY COLLECTED, but answers a different question
--     than the Adoption page's fixture line ("N of 1,240 have an assigned
--     task"). `adoption:planner-usage` (fan-out over /groups ->
--     /groups/{itemId}/planner/plans) counts PLANS across the tenant, not
--     per-user task assignments -- Planner's REST surface has no tenant-wide
--     "tasks assigned to user X" enumeration; getting real per-user
--     assignment counts would need a SECOND fan-out level (each plan's own
--     /planner/plans/{planId}/tasks), which the current single-level
--     fan-out executor (see monitor-executor.ts's runFanOutCheck) does not
--     support. Extending fan-out to nested levels is a real infra change
--     out of proportion to this issue -- left on fixture, same posture as
--     the page's own already-documented Teams channels/Power BI/Teams Phone
--     rows, flagged for Shane if a plan-count-based framing (rather than
--     user-count) is an acceptable substitute.
--   * Viva Engage -- a check exists (`adoption:viva-engage-health`, GET
--     /employeeExperience/communities) but it counts COMMUNITIES, not
--     per-user activity -- a different metric than "N of 1,240 posted or
--     read". This migration adds the genuinely missing per-user collector
--     below.
--   * True per-user SharePoint activity -- genuinely missing, confirmed:
--     `adoption:sharepoint-onedrive-trend` reads
--     getSharePointSiteUsageDetail, which is per-SITE (already flagged in
--     that check's own description and in metrics.ts's usage.sharePointActiveCount
--     comment). This migration adds the real per-user collector below.
--
-- ── WHAT THIS ADDS ───────────────────────────────────────────────────────────
-- 1. adoption:sharepoint-user-activity -- GET
--    /reports/getSharePointActivityUserDetail(period='D7'), the per-USER
--    SharePoint file view/edit report (distinct from the per-SITE report
--    adoption:sharepoint-onedrive-trend already reads). Same CSV column
--    convention as the sibling D7 active-user checks (adoption:email-activity-trend
--    / adoption:teams-activity-trend / onedrive:active-users): "Last Activity
--    Date" + "Is Deleted" for the active-count countWhere, "User Principal
--    Name" for the scanned/licensed count. Reports.Read.All only -- already
--    in REQUIRED_MT_SCOPES, no new tenant consent needed. This is literally
--    the endpoint the Adoption page's own design fixture already names for
--    this row (adpDashboardData.ts's SharePoint row `src` field).
-- 2. adoption:viva-engage-user-activity -- GET
--    /reports/getYammerActivityUserDetail(period='D7'), the per-user
--    Viva Engage/Yammer activity report (posted/read/liked). Same CSV
--    column convention and countWhere shape as the siblings above. Also
--    literally the endpoint the Adoption page's own design fixture already
--    names for the Viva Engage row. Reports.Read.All only.
--
-- Neither report's exact CSV column casing was independently verified
-- against a live tenant sample from this environment (no live Graph
-- reachability here) -- flagged the same way #1253's own migration flagged
-- its CSV-column assumptions; monitor-executor.ts's countWhere already logs
-- a loud warning if a mapping's field names don't match what actually comes
-- back, so a wrong assumption here fails loud, not silent.
--
-- Docs checked (2026-08-25):
--   learn.microsoft.com/en-us/graph/api/reportroot-getsharepointactivityuserdetail
--   learn.microsoft.com/en-us/graph/api/reportroot-getyammeractivityuserdetail
-- ============================================================================


-- ══════════════════════════════════════════════════════════════════════════════
-- PART A — READ-ONLY: confirm neither key exists yet
-- ══════════════════════════════════════════════════════════════════════════════

SELECT key, label, status
FROM monitor_checks
WHERE key IN ('adoption:sharepoint-user-activity', 'adoption:viva-engage-user-activity');


-- ══════════════════════════════════════════════════════════════════════════════
-- PART B — adoption:sharepoint-user-activity
-- ══════════════════════════════════════════════════════════════════════════════

BEGIN;

INSERT INTO "monitor_checks" (
  "key", "label", "description",
  "endpoint", "method",
  "properties", "mapping", "severity_rules",
  "engines", "frequency", "requires_customer_script",
  "schema_version", "status"
) VALUES (
  'adoption:sharepoint-user-activity',
  'SharePoint Per-User Activity',
  '#1284 -- GET /reports/getSharePointActivityUserDetail(period=''D7''), the real per-USER SharePoint file view/edit report. Distinct from adoption:sharepoint-onedrive-trend, which reads the per-SITE getSharePointSiteUsageDetail report -- that check''s storage/file-count columns are also consumed by cost tracking elsewhere so it was deliberately left alone (see metrics.ts''s usage.sharePointActiveCount comment); this is a NEW, additive check rather than a repoint. sharepointUserActiveCount counts rows where "Last Activity Date" is within the last 7 days and "Is Deleted" is "False", matching the exact countWhere shape adoption:email-activity-trend / adoption:teams-activity-trend / onedrive:active-users already use. sharepointUsersScannedCount is the raw scanned-row count for the "N of M" denominator. App permission Reports.Read.All only -- already in REQUIRED_MT_SCOPES.',
  '/reports/getSharePointActivityUserDetail(period=''D7'')',
  'GET',
  '[]'::jsonb,
  '[{"sourceField":"value","targetField":"sharepointUserActiveCount","transform":"countWhere(''{{Last Activity Date}} newerThanDays 7 && {{Is Deleted}} == \"False\"'')"},
    {"sourceField":"User Principal Name","targetField":"sharepointUsersScannedCount","transform":"count"}]'::jsonb,
  '[{"severity":"info","expression":"_itemCount == 0","label":"No users appear in the SharePoint per-user activity report -- either no one has viewed or edited a SharePoint file yet, or activity data is unavailable"}]'::jsonb,
  '["adoption"]'::jsonb,
  'daily',
  false,
  1,
  'active'
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-25-adoption-collectors-sharepoint-viva-per-user-1284.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
COMMIT;


-- ══════════════════════════════════════════════════════════════════════════════
-- PART C — adoption:viva-engage-user-activity
-- ══════════════════════════════════════════════════════════════════════════════

BEGIN;

INSERT INTO "monitor_checks" (
  "key", "label", "description",
  "endpoint", "method",
  "properties", "mapping", "severity_rules",
  "engines", "frequency", "requires_customer_script",
  "schema_version", "status"
) VALUES (
  'adoption:viva-engage-user-activity',
  'Viva Engage Per-User Activity',
  '#1284 -- GET /reports/getYammerActivityUserDetail(period=''D7''), the real per-user Viva Engage/Yammer posted/read/liked activity report. Distinct from adoption:viva-engage-health, which reads /employeeExperience/communities (a COMMUNITY count, not per-user activity) -- a different question, so this is a NEW, additive check rather than a repoint. vivaEngageUserActiveCount counts rows where "Last Activity Date" is within the last 7 days and "Is Deleted" is "False", matching the exact countWhere shape the sibling D7 active-user checks already use. vivaEngageUsersScannedCount is the raw scanned-row count for the "N of M" denominator. App permission Reports.Read.All only -- already in REQUIRED_MT_SCOPES.',
  '/reports/getYammerActivityUserDetail(period=''D7'')',
  'GET',
  '[]'::jsonb,
  '[{"sourceField":"value","targetField":"vivaEngageUserActiveCount","transform":"countWhere(''{{Last Activity Date}} newerThanDays 7 && {{Is Deleted}} == \"False\"'')"},
    {"sourceField":"User Principal Name","targetField":"vivaEngageUsersScannedCount","transform":"count"}]'::jsonb,
  '[{"severity":"info","expression":"_itemCount == 0","label":"No users appear in the Viva Engage per-user activity report -- either no one has posted or read on Viva Engage yet, or activity data is unavailable"}]'::jsonb,
  '["adoption"]'::jsonb,
  'daily',
  false,
  1,
  'active'
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-25-adoption-collectors-sharepoint-viva-per-user-1284.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
COMMIT;


-- ══════════════════════════════════════════════════════════════════════════════
-- PART D — wire both new checks into the same 4 packages their adoption
-- siblings already run in (core:enhanced-monitoring, core:growth,
-- core:premier, detail:full-item-collection -- same precedent #1253's own
-- migration confirmed for its own 3 new checks).
-- ══════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  chk text;
  pkg text;
BEGIN
  FOREACH chk IN ARRAY ARRAY['adoption:sharepoint-user-activity', 'adoption:viva-engage-user-activity']
  LOOP
    FOREACH pkg IN ARRAY ARRAY['core:enhanced-monitoring', 'core:growth', 'core:premier', 'detail:full-item-collection']
    LOOP
      INSERT INTO monitoring_package_checks (package_key, check_key, sort_order)
      SELECT pkg, chk,
             COALESCE((SELECT max(sort_order) FROM monitoring_package_checks WHERE package_key = pkg), -1) + 1
      WHERE EXISTS (SELECT 1 FROM monitoring_packages WHERE key = pkg)
      ON CONFLICT (package_key, check_key) DO NOTHING;
    END LOOP;
  END LOOP;
END $$;


-- ══════════════════════════════════════════════════════════════════════════════
-- PART E — READ-ONLY: verify the catalog + package wiring
-- ══════════════════════════════════════════════════════════════════════════════

SELECT key, label, endpoint, engines, status
FROM monitor_checks
WHERE key IN ('adoption:sharepoint-user-activity', 'adoption:viva-engage-user-activity')
ORDER BY key;

SELECT package_key, check_key, sort_order
FROM monitoring_package_checks
WHERE check_key IN ('adoption:sharepoint-user-activity', 'adoption:viva-engage-user-activity')
ORDER BY check_key, package_key;


-- ══════════════════════════════════════════════════════════════════════════════
-- FOLLOW-UP — DELIBERATELY NOT DONE HERE
-- ══════════════════════════════════════════════════════════════════════════════
--   * Planner per-user task-assignment collection needs a second fan-out
--     level (plans -> tasks) the executor doesn't support today -- flagged
--     above and in the frontend comment this same commit adds to
--     adpDashboardData.ts. A Shane To-Do / product decision, not built here.
--   * Frontend wiring of the Adoption page's Copilot, SharePoint and Viva
--     Engage workload rows off these (and the pre-existing Copilot) checks
--     is done in this same commit's TypeScript changes, not this migration.
-- ============================================================================
