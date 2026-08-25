-- ============================================================================
-- Adoption page missing collectors: mobile app usage, device config (KFM),
-- Teams Phone provisioning (#1253, follow-up from #1219's investigation)
-- ============================================================================
-- Manual migration -- self-executed via shaneapp://executeSql / direct local
-- Postgres per current CLAUDE.md. Idempotent: every INSERT is
-- ON CONFLICT (key) DO NOTHING / ON CONFLICT (package_key, check_key) DO
-- NOTHING; safe to re-run.
--
-- ── TYPE-ENUM QUESTION (#1253 asks this explicitly) ─────────────────────────
-- monitor_checks has no dedicated check-category/type enum column -- only the
-- free-text `engines` jsonb tag array. Confirmed live against this DB: 6 rows
-- already carry engines ["adoption"] (adoption:email-activity-trend,
-- adoption:overall-active-rate, adoption:planner-usage,
-- adoption:sharepoint-onedrive-trend, adoption:teams-activity-trend,
-- adoption:viva-engage-health), and copilot:active-usage-rate /
-- copilot:usage-by-app are already dual-tagged ["copilot","adoption"] -- the
-- tagging convention this issue asks about already exists and already works.
-- DECISION: do not add a new enum column. Tag every check below
-- engines: ["adoption"] (plus "health" for the device-config check, matching
-- devices:update-rings-config's own tag), exactly matching precedent. A
-- dedicated enum would be a disruptive schema migration duplicating
-- information the existing free-text array already encodes for every other
-- subsystem (compliance/governance/cost/security/health/priority) with no
-- demonstrated need.
--
-- ── COPILOT USAGE: ALREADY COLLECTED, NOT ADDED HERE ────────────────────────
-- #1253's issue body states a grep for `getMicrosoft365CopilotUsageUserDetail`
-- found "no hits" and lists it as missing. That is stale: this DB already has
-- `copilot:active-usage-rate` (endpoint
-- /copilot/reports/getMicrosoft365CopilotUsageUserDetail(period='D7'),
-- engines ["copilot","adoption"]) plus copilot:usage-by-app and
-- copilot:licensed-but-inactive on the same report family, all status='active'
-- and already wired into core:enhanced-monitoring. Confirmed via direct query
-- against this local Postgres before writing this file. Nothing added for
-- Copilot -- adding a second, redundant check would just be duplicate
-- collection of the same report.
--
-- ── WHAT THIS ADDS ───────────────────────────────────────────────────────────
-- 1. adoption:m365-mobile-app-usage -- Graph usage report
--    (getM365AppUserDetail(period='D7')), the genuinely-missing mobile-app
--    activation signal named in the issue.
-- 2. devices:kfm-configuration -- Graph deviceManagement/deviceConfigurations,
--    filtered by displayName for a Known Folder Move profile. Same endpoint
--    devices:update-rings-config already reads (Reports.Read.All /
--    DeviceManagementConfiguration.Read.All -- both already in
--    REQUIRED_MT_SCOPES per graph.ts, so no new tenant consent needed); a
--    NEW check because devices:update-rings-config's own mapping just counts
--    every profile with no type filter and answers a different question.
-- 3. adoption:teams-phone-provisioning -- new PowerShell-executor check.
--    Get-CsOnlineUser (module MicrosoftTeams) did not exist in the
--    ps-execution container's cmdlet allowlist or session model before this
--    change -- see services/ps-execution/entrypoint.ps1 and Dockerfile,
--    edited alongside this file, for the new "teams" session branch
--    (Connect-MicrosoftTeams) and the get-cs-online-user /
--    get-cs-teams-meeting-policy catalog entries. Only get-cs-online-user is
--    wired to a monitor_checks row here -- EnterpriseVoiceEnabled + LineURI
--    are the literal "is this user provisioned for Teams Phone" fields the
--    issue itself names. get-cs-teams-meeting-policy is added to the
--    allowlist per the issue's exact endpoint list (so it's available and
--    unblocked for future check authoring) but deliberately left unwired to
--    its own monitor_checks row: Teams meeting-policy fields (recording,
--    lobby bypass, presenter rights, ...) do not cleanly answer "phone
--    provisioning" without a specific product decision on which field is the
--    signal -- flagged for Shane to pick if he had a specific field in mind,
--    same "flagged" posture #491's own catalog entries already use.
--
-- Docs checked (2026-08-24):
--   learn.microsoft.com/en-us/graph/api/reportroot-getm365appuserdetail
--   learn.microsoft.com/en-us/graph/api/deviceappmanagement-configurations
--   learn.microsoft.com/en-us/powershell/module/teams/get-csonlineuser
-- Neither getM365AppUserDetail's per-platform column values (assumed "Yes" /
-- blank below) nor Get-CsOnlineUser's exact returned property casing
-- (assumed "LineURI", matching Microsoft's own PS property name) were
-- independently verified against a live tenant sample from this environment
-- (no live Graph/PS reachability here) -- flagged the same way #1105's own
-- migration flagged its CSV-column assumptions; monitor-executor.ts's
-- countWhere already logs a loud warning if a mapping's field names don't
-- match what actually comes back, so a wrong assumption here fails loud, not
-- silent.
-- ============================================================================


-- ══════════════════════════════════════════════════════════════════════════════
-- PART A — READ-ONLY: confirm none of these three keys exist yet
-- ══════════════════════════════════════════════════════════════════════════════

SELECT key, label, status
FROM monitor_checks
WHERE key IN ('adoption:m365-mobile-app-usage', 'devices:kfm-configuration',
              'adoption:teams-phone-provisioning');


-- ══════════════════════════════════════════════════════════════════════════════
-- PART B — adoption:m365-mobile-app-usage
-- ══════════════════════════════════════════════════════════════════════════════

BEGIN;

INSERT INTO "monitor_checks" (
  "key", "label", "description",
  "endpoint", "method",
  "properties", "mapping", "severity_rules",
  "engines", "frequency", "requires_customer_script",
  "schema_version", "status"
) VALUES (
  'adoption:m365-mobile-app-usage',
  'Microsoft 365 Apps Mobile Activation',
  '#1253 -- GET /reports/getM365AppUserDetail(period=''D7''), the per-user Microsoft 365 Apps activation/usage report. mobileActiveUserCount counts rows where the report''s "Mobile" platform column is "Yes" (assumed value, not independently verified against a live tenant sample -- flagged in this file''s own header); mobileLicensedUserCount is the raw scanned-row count, matching the sibling adoption:* checks'' own licensed/active pairing (see adoption:email-activity-trend). App permission Reports.Read.All only -- already in REQUIRED_MT_SCOPES.',
  '/reports/getM365AppUserDetail(period=''D7'')',
  'GET',
  '[]'::jsonb,
  '[{"sourceField":"value","targetField":"mobileActiveUserCount","transform":"countWhere(''{{Mobile}} == \"Yes\"'')"},
    {"sourceField":"User Principal Name","targetField":"mobileLicensedUserCount","transform":"count"}]'::jsonb,
  '[{"severity":"info","expression":"_itemCount == 0","label":"No users appear in the Microsoft 365 Apps usage report -- either no one has activated a Microsoft 365 desktop or mobile app yet, or activity data is unavailable"}]'::jsonb,
  '["adoption"]'::jsonb,
  'daily',
  false,
  1,
  'active'
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-24-adoption-collectors-copilot-mobile-kfm-teamsphone-1253.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
COMMIT;


-- ══════════════════════════════════════════════════════════════════════════════
-- PART C — devices:kfm-configuration
-- ══════════════════════════════════════════════════════════════════════════════

BEGIN;

INSERT INTO "monitor_checks" (
  "key", "label", "description",
  "endpoint", "method",
  "properties", "mapping", "severity_rules",
  "engines", "frequency", "requires_customer_script",
  "schema_version", "status"
) VALUES (
  'devices:kfm-configuration',
  'Known Folder Move (KFM) Configuration Coverage',
  '#1253 -- GET /deviceManagement/deviceConfigurations (same endpoint devices:update-rings-config already reads, DeviceManagementConfiguration.Read.All -- already in REQUIRED_MT_SCOPES). kfmConfiguredProfileCount counts profiles whose admin-set displayName contains "Known Folder Move" or "KFM" -- a name-match proxy, the same class of loose read devices:update-rings-config''s own raw count already uses for this endpoint, since deviceConfigurations'' polymorphic @odata.type does not expose a dedicated KFM resource type to filter on structurally. deviceConfigProfileCount is the raw scanned-profile count for context.',
  '/deviceManagement/deviceConfigurations',
  'GET',
  '[]'::jsonb,
  '[{"sourceField":"value","targetField":"kfmConfiguredProfileCount","transform":"countWhere(''{{displayName}} contains \"Known Folder Move\" || {{displayName}} contains \"KFM\"'')"},
    {"sourceField":"id","targetField":"deviceConfigProfileCount","transform":"count"}]'::jsonb,
  '[{"severity":"warning","expression":"{{kfmConfiguredProfileCount}} == 0","label":"No Intune device configuration profile with Known Folder Move (KFM) in its name was found -- OneDrive known-folder backup (Desktop, Documents, Pictures) is not being centrally enforced for this tenant"}]'::jsonb,
  '["health","adoption"]'::jsonb,
  'daily',
  false,
  1,
  'active'
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-24-adoption-collectors-copilot-mobile-kfm-teamsphone-1253.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
COMMIT;


-- ══════════════════════════════════════════════════════════════════════════════
-- PART D — adoption:teams-phone-provisioning (PowerShell executor, NEW "teams"
-- session type -- see services/ps-execution/entrypoint.ps1 + Dockerfile)
-- ══════════════════════════════════════════════════════════════════════════════

BEGIN;

INSERT INTO "monitor_checks" (
  "key", "label", "description",
  "endpoint", "method",
  "properties", "mapping", "severity_rules",
  "engines", "frequency", "requires_customer_script",
  "executor_type", "ps_cmdlet_key", "ps_params",
  "schema_version", "status"
) VALUES (
  'adoption:teams-phone-provisioning',
  'Teams Phone Provisioning',
  '#1253 -- PowerShell-backed (MicrosoftTeams module, new "teams" ps-execution session type). Get-CsOnlineUser, PostFilter''d in the container to users with EnterpriseVoiceEnabled -eq $true AND a non-empty LineURI -- the literal "is this user provisioned for Teams Phone" signal, matching the exact field names (EnterpriseVoiceEnabled, LineUri) the issue names. Prerequisite this session could not configure or verify (no live Teams/Graph reachability here, same class of gap #491''s Exchange cmdlets flagged): the app-only cert already used for Exchange/Purview must also be granted Teams administrative role access (e.g. Microsoft Teams Administrator / a scoped RBAC role) via Entra -- until then this check will surface as cmdlet_unavailable/auth_failed, an honest already-handled failure, not silently wrong data. get-cs-teams-meeting-policy is separately added to the ps-execution allowlist per the issue''s exact endpoint list but is NOT wired to a check here -- its fields (recording/lobby/presenter policy) do not cleanly answer "phone provisioning" without a specific product decision on which field is the signal; flagged for Shane.',
  '(unused — executorType=powershell drives dispatch, not endpoint)',
  'GET',
  '[]'::jsonb,
  '[{"sourceField":"UserPrincipalName","targetField":"teamsPhoneProvisionedUserPrincipalNames"}]'::jsonb,
  '[{"severity":"info","expression":"_itemCount == 0","label":"No users are provisioned for Teams Phone on this tenant -- Enterprise Voice is not enabled for any user, or Teams Phone has not been configured"}]'::jsonb,
  '["adoption"]'::jsonb,
  'daily',
  false,
  'powershell',
  'get-cs-online-user',
  '{"Organization":"{organization}"}'::jsonb,
  1,
  'active'
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-24-adoption-collectors-copilot-mobile-kfm-teamsphone-1253.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
COMMIT;


-- ══════════════════════════════════════════════════════════════════════════════
-- PART E — wire all three new checks into the same 4 packages their adoption/
-- devices siblings already run in (core:enhanced-monitoring, core:growth,
-- core:premier, detail:full-item-collection -- confirmed live query of
-- devices:update-rings-config / copilot:active-usage-rate / adoption:planner-
-- usage / adoption:viva-engage-health, all 4 identically). Deliberately NOT
-- added to assess:copilot-readiness -- none of adoption:planner-usage /
-- adoption:viva-engage-health are in that package either, same precedent.
-- ══════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  chk text;
  pkg text;
BEGIN
  FOREACH chk IN ARRAY ARRAY['adoption:m365-mobile-app-usage', 'devices:kfm-configuration', 'adoption:teams-phone-provisioning']
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
-- PART F — READ-ONLY: verify the catalog + package wiring
-- ══════════════════════════════════════════════════════════════════════════════

SELECT key, label, endpoint, executor_type, ps_cmdlet_key, engines, status
FROM monitor_checks
WHERE key IN ('adoption:m365-mobile-app-usage', 'devices:kfm-configuration',
              'adoption:teams-phone-provisioning')
ORDER BY key;

SELECT package_key, check_key, sort_order
FROM monitoring_package_checks
WHERE check_key IN ('adoption:m365-mobile-app-usage', 'devices:kfm-configuration',
                     'adoption:teams-phone-provisioning')
ORDER BY check_key, package_key;


-- ══════════════════════════════════════════════════════════════════════════════
-- FOLLOW-UP — DELIBERATELY NOT DONE HERE
-- ══════════════════════════════════════════════════════════════════════════════
--   * The Adoption pillar page's workload list itself (adpDashboardData.ts /
--     portal-v2-adoption.tsx) is NOT wired to these new checks by this
--     migration -- #1253's own "Fix" section scopes this issue to the
--     collectors only ("Once landed, the corresponding rows on the Adoption
--     page's workload list can move off fixture"), and a concurrent session's
--     uncommitted work in this same checkout (touching adpDashboardData.ts /
--     portal-v2-adoption.tsx / metrics.ts / a new useAdpWorkloadsLive.ts,
--     referencing #1252) is already doing exactly that for the 4 checks that
--     already existed before this file -- left untouched, not swept into this
--     migration or this session's commit.
--   * Power BI/E5 usage and "true per-user SharePoint activity" (2 of the
--     original 6 named gaps) are NOT covered by this migration -- #1253's own
--     "What's missing concretely" section does not list a Graph/PowerShell
--     endpoint for either of them; out of this issue's stated scope.
--   * Teams Administrator role-group grant for the app-only cert (Teams
--     session prerequisite) and get-cs-teams-meeting-policy's product-owner
--     field decision are both Shane To-Dos, called out in Part D's own
--     description column.
-- ============================================================================
