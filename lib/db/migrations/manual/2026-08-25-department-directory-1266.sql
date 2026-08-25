-- ============================================================================
-- identity:department-directory -- Entra department attribute at tenant scale
-- (#1266, prerequisite for #1254's Adoption department heat-map)
-- ============================================================================
-- Manual migration -- self-executed via shaneapp://executeSql / direct local
-- Postgres per current CLAUDE.md. Idempotent: every INSERT is
-- ON CONFLICT (key) DO NOTHING / ON CONFLICT (package_key, check_key) DO
-- NOTHING; safe to re-run.
--
-- ── WHAT THIS ADDS ───────────────────────────────────────────────────────────
-- A new check, identity:department-directory, GET
-- /users?$select=id,userPrincipalName,department,accountEnabled&$top=999.
-- Confirmed live against this DB before writing this file: no existing check
-- selects department anywhere in the catalog -- identity:stale-accounts (the
-- only other plain /users-endpoint check) reads endpoint '/users' with
-- properties ["id","signInActivity"], no department. This is exactly the
-- Fix #1266's own issue body scoped: a net-new check, tagged into
-- detail:full-item-collection so real userPrincipalName -> department rows
-- persist per-user to tenant_check_item_details, plus the same
-- core:enhanced-monitoring / core:growth / core:premier package set the
-- #1252/#1253 adoption usage checks it's meant to sit alongside already run
-- in (confirmed live: devices:kfm-configuration / copilot:active-usage-rate /
-- adoption:planner-usage / adoption:viva-engage-health all wired identically
-- to those same 4 packages). engines: ["adoption"] -- this check's whole
-- purpose is feeding the Adoption pillar's department heat-map, matching the
-- plain adoption:* siblings' own single-tag convention (not identity:*'s
-- security/governance convention, which answers a different question).
--
-- ── THE JOIN BLOCKER THIS ISSUE'S OWN FOLLOW-UP COMMENT FOUND -- NOT FIXED HERE, ON PURPOSE ──
-- Shane's 2026-08-25 comment on #1266 found that adding this check alone does
-- NOT unblock #1254's join. The four usage-report endpoints #1252/#1253
-- collect from (getEmailActivityUserDetail / getTeamsUserActivityUserDetail /
-- getSharePointSiteUsageDetail / getOneDriveUsageAccountDetail, and by the
-- same mechanism #1253's getMicrosoft365CopilotUsageUserDetail /
-- getM365AppUserDetail) return ANONYMIZED/HASHED User Principal Name values
-- by default -- the M365 admin center's "Display concealed user, group, and
-- site names in all reports" tenant setting, OFF by default. This check's
-- endpoint (/users, a different Graph API surface) is unaffected and returns
-- real UPNs -- so on a default-configured tenant, this check's real UPNs will
-- never match the hashed UPNs already sitting in tenant_check_item_details
-- for the four usage checks. That mismatch is a data-source characteristic,
-- not something any mapping/transform here can paper over.
--
-- The only real fix for the join itself is requesting
-- displayConcealedNames: true via PATCH /admin/reportSettings
-- (ReportSettings.ReadWrite.All) -- a tenant-wide privacy-posture change
-- (it un-hides real names in every M365 usage report, not just the ones this
-- platform reads) that Shane's own comment says needs explicit sign-off, not
-- something to flip silently from inside a migration. NOT done in this file.
-- This check is still landed on its own because it has real standalone
-- value -- an honest, real per-user department directory read that did not
-- exist in the catalog before -- and because #1266's issue body scoped
-- exactly this check as its Fix, independent of the join question its own
-- follow-up comment raised afterward. #1254 (and this issue) stay open,
-- flagged for Shane to make the displayConcealedNames call; see this
-- session's comment on #1266 for the explicit hand-off.
--
-- Docs checked (2026-08-25):
--   learn.microsoft.com/en-us/graph/api/user-list
--   learn.microsoft.com/en-us/graph/api/resources/user (department property)
-- ============================================================================


-- ══════════════════════════════════════════════════════════════════════════════
-- PART A — READ-ONLY: confirm the key doesn't exist yet
-- ══════════════════════════════════════════════════════════════════════════════

SELECT key, label, status FROM monitor_checks WHERE key = 'identity:department-directory';


-- ══════════════════════════════════════════════════════════════════════════════
-- PART B — identity:department-directory
-- ══════════════════════════════════════════════════════════════════════════════

BEGIN;

INSERT INTO "monitor_checks" (
  "key", "label", "description",
  "endpoint", "method",
  "properties", "mapping", "severity_rules",
  "engines", "frequency", "requires_customer_script",
  "schema_version", "status"
) VALUES (
  'identity:department-directory',
  'Department Directory',
  '#1266 -- GET /users, the tenant''s Entra user directory with the department attribute selected. Prerequisite for #1254''s Adoption department heat-map: no existing check (including identity:stale-accounts, the only other plain /users-endpoint check) selects department. usersMissingDepartmentCount counts users whose department field is null or empty; totalUserCount is the raw scanned-user count for context. NOTE (see this file''s own header): the real userPrincipalName values this check persists via detail:full-item-collection will NOT join cleanly against the four usage-report checks'' own per-user rows on a default-configured tenant, because those reports return hashed UPNs unless displayConcealedNames is explicitly enabled -- a separate, unresolved decision flagged back on #1266/#1254, not something this check can fix on its own. App permission User.Read.All only -- already in REQUIRED_MT_SCOPES.',
  '/users?$select=id,userPrincipalName,department,accountEnabled&$top=999',
  'GET',
  '["id","userPrincipalName","department","accountEnabled"]'::jsonb,
  '[{"sourceField":"value","targetField":"usersMissingDepartmentCount","transform":"countWhere(''{{department}} == null || {{department}} == \"\"'')"},
    {"sourceField":"userPrincipalName","targetField":"totalUserCount","transform":"count"}]'::jsonb,
  '[{"severity":"info","expression":"_itemCount == 0","label":"No users were returned by the tenant directory query -- either the tenant has no users, or the directory read failed silently"}]'::jsonb,
  '["adoption"]'::jsonb,
  'daily',
  false,
  1,
  'active'
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-25-department-directory-1266.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
COMMIT;


-- ══════════════════════════════════════════════════════════════════════════════
-- PART C — wire into the same 4 packages the #1252/#1253 adoption usage
-- checks run in (core:enhanced-monitoring, core:growth, core:premier,
-- detail:full-item-collection), per #1266's own issue body instruction.
-- ══════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  pkg text;
BEGIN
  FOREACH pkg IN ARRAY ARRAY['core:enhanced-monitoring', 'core:growth', 'core:premier', 'detail:full-item-collection']
  LOOP
    INSERT INTO monitoring_package_checks (package_key, check_key, sort_order)
    SELECT pkg, 'identity:department-directory',
           COALESCE((SELECT max(sort_order) FROM monitoring_package_checks WHERE package_key = pkg), -1) + 1
    WHERE EXISTS (SELECT 1 FROM monitoring_packages WHERE key = pkg)
    ON CONFLICT (package_key, check_key) DO NOTHING;
  END LOOP;
END $$;


-- ══════════════════════════════════════════════════════════════════════════════
-- PART D — READ-ONLY: verify the catalog + package wiring
-- ══════════════════════════════════════════════════════════════════════════════

SELECT key, label, endpoint, engines, status
FROM monitor_checks
WHERE key = 'identity:department-directory';

SELECT package_key, check_key, sort_order
FROM monitoring_package_checks
WHERE check_key = 'identity:department-directory'
ORDER BY package_key;


-- ══════════════════════════════════════════════════════════════════════════════
-- FOLLOW-UP — DELIBERATELY NOT DONE HERE
-- ══════════════════════════════════════════════════════════════════════════════
--   * #1254's actual join (tenant_check_item_details rows for this check
--     joined against the four usage checks' own item rows) is NOT built by
--     this migration -- it cannot produce a correct result until the
--     displayConcealedNames decision above is made. Landing this check alone
--     without the join would let #1254 read this data and get it silently
--     wrong (zero matches, or matches against stale hashed values), which is
--     worse than the fixture data it already flagged as fabricated.
--   * The displayConcealedNames: true PATCH /admin/reportSettings call is a
--     Shane To-Do -- a tenant-wide privacy-posture change, not a code change.
--     See this session's comment on #1266 for the explicit ask.
-- ============================================================================
