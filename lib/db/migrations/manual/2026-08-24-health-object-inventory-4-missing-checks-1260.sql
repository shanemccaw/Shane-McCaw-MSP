-- ============================================================================
-- Health page stale-object inventory: the 4 missing checks (#1260, follow-up
-- from #1229's investigation)
-- ============================================================================
-- Manual migration -- self-executed via shaneapp://executeSql / direct local
-- Postgres per current CLAUDE.md. Idempotent: every INSERT is
-- ON CONFLICT (key) DO NOTHING / ON CONFLICT (package_key, check_key) DO
-- NOTHING; safe to re-run.
--
-- ── SCOPE, PER #1260's OWN "FIX" SECTION ─────────────────────────────────────
-- #1229 found 4 of the Health page's 9 stale-object-inventory fixture rows
-- (hltDashboardData.ts HLT_OBJECTS) already backed by a real check:
-- identity:disabled-accounts, identity:stale-accounts, appgov:cert-secret-
-- expiration (both credential fields) and appgov:stale-app-registrations
-- (both age-band fields). The other 5 rows -- stale device records, duplicate
-- device records, service principals with no sign-in, empty security groups,
-- unassigned Intune profiles -- had no backing check at all, and #1229
-- deliberately left the whole section on fixture rather than half-filling it
-- (see useLivePillarHero.ts's own "kept unbacked sections whole" precedent).
--
-- This migration adds the 4 missing CHECKS (one check answers both the stale
-- AND duplicate device-record rows, same two-targetField-per-check shape as
-- appgov:stale-app-registrations' own two age bands). It does NOT wire
-- hltDashboardData.ts / portal-v2-health.tsx to them -- #1260's own text is
-- explicit: "Once all 9 rows have real backing, wire the full section -- not
-- before". Wiring is separate, follow-up scope, same split #1253 used for its
-- own three new collectors the same day.
--
-- ── WHAT THIS ADDS ───────────────────────────────────────────────────────────
-- 1. devices:stale-duplicate-records -- GET /devices (Directory.Read.All,
--    already in REQUIRED_MT_SCOPES). staleDeviceRecordCount:
--    countWhere('{{approximateLastSignInDateTime}} == null ||
--    {{approximateLastSignInDateTime}} olderThanDays 90') on the device
--    resource's own approximateLastSignInDateTime (a real v1.0 property --
--    confirmed against learn.microsoft.com/en-us/graph/api/resources/device,
--    2026-08-24 -- unlike /applications, which has NO such field, the reason
--    #551 had to fall back to age-based staleness for app registrations).
--    duplicateDeviceRecordCount: countDuplicates on deviceId (the hardware
--    identifier Azure Device Registration Service sets at registration --
--    exactly the "2 records for the same hardware ID" the fixture row
--    describes).
-- 2. devices:unassigned-intune-profiles -- GET /deviceManagement/
--    deviceConfigurations?$expand=assignments($select=id)
--    (DeviceManagementConfiguration.Read.All, already in REQUIRED_MT_SCOPES;
--    same endpoint devices:update-rings-config and devices:kfm-configuration
--    already read, per #1253). unassignedIntuneProfileCount: countEmptyArray
--    on the expanded assignments collection -- the exact idiom
--    monitor-executor.ts's own countEmptyArray docstring names as its
--    reference case ("GET /groups?$expand=owners(...)"), applied here to
--    deviceConfiguration's assignments relationship instead of a group's
--    owners.
-- 3. governance:empty-security-groups -- GET /groups?$filter=securityEnabled
--    eq true and mailEnabled eq false&$expand=members($select=id)
--    (Directory.Read.All; ConsistencyLevel: eventual is added automatically
--    by graphFetchPaginated whenever the URL contains "$filter="). Filtered to
--    securityEnabled/not-mailEnabled so this counts pure security groups only
--    -- not Microsoft 365 groups or distribution lists, matching the fixture
--    row's own label. emptySecurityGroupCount: countEmptyArray on the
--    expanded members collection.
-- 4. appgov:dormant-service-principals -- GET /servicePrincipals?$expand=
--    appRoleAssignedTo($select=id)&$select=id,displayName,accountEnabled,
--    servicePrincipalType (Directory.Read.All). See the HONESTY NOTE below --
--    this is NOT a sign-in-activity check. It could not be one.
--
-- ── HONESTY NOTE ON CHECK 4 -- READ BEFORE RENAMING OR "FIXING" THIS LATER ──
-- The fixture row's copy is "Service principals with no sign-in", and Health
-- design copy is locked (CLAUDE.md: "Copy is final. Do not rewrite, shorten
-- or improve any user-facing string"). But Microsoft Graph v1.0 has NO
-- sign-in-activity signal for service principals at all -- confirmed directly
-- against learn.microsoft.com/en-us/graph/api/resources/serviceprincipal
-- (2026-08-24): no signInActivity property, no createdDateTime property
-- either (unlike device or application), so there is not even an age-based
-- fallback of #551's kind available. The only real usage-report surface,
-- GET /reports/servicePrincipalSignInActivities, remains beta-only as of
-- 2026-08-24 (confirmed via Microsoft Learn + the beta-only
-- servicePrincipalSignInActivity resource page) -- the exact same "Option 2,
-- explicitly not this build" beta dependency #551's own migration ruled out
-- for app registrations. useSecEvidenceOauthLive.ts (#1233) independently
-- reached the identical conclusion for the OAuth page's "Dormant apps" card
-- and left it on fixture rather than fake it.
--
-- So appgov:dormant-service-principals measures the closest REAL, v1.0,
-- non-beta proxy available: whether any principal (user, group, or another
-- service principal) has ever been assigned an app role on this service
-- principal (appRoleAssignedTo). A service principal with zero assignments
-- has nothing provisioned to sign in through it at all -- "no sign-in" is
-- true of it in the strongest available sense (no access exists to sign in
-- WITH), but this is a provisioning-state signal, not an observed-activity
-- signal, and an app that uses app-only client-credentials auth without any
-- role assignment would be invisible to it. The check's own label and
-- description say this plainly (see PART E), the same transparency #551 used
-- when it renamed appgov:stale-app-registrations off "stale" rather than
-- silently mislabeling an age check as a usage check. Whoever wires this into
-- hltDashboardData.ts / the Security OAuth page next should read this note
-- before assuming the number means literal "no sign-in event observed".
--
-- Docs checked (2026-08-24, this session):
--   learn.microsoft.com/en-us/graph/api/resources/device
--   learn.microsoft.com/en-us/graph/api/resources/serviceprincipal
--   learn.microsoft.com/en-us/graph/api/intune-deviceconfig-deviceconfiguration-list
--   learn.microsoft.com/en-us/graph/api/resources/serviceprincipalsigninactivity (beta)
-- The deviceConfiguration list endpoint's own doc page does not explicitly
-- demonstrate $expand=assignments in its example (only a bare list), though
-- $expand=assignments is the standard, widely-documented Intune Graph pattern
-- for every deviceConfiguration/deviceCompliancePolicy sibling resource. Not
-- independently verified against a live tenant sample from this environment
-- (no live Graph reachability here) -- flagged the same way #1253's own
-- migration flagged its unverified column-name assumptions the same day:
-- countEmptyArray's own warning path (monitor-executor.ts) logs loudly if
-- "assignments" turns out to be the wrong expand name for this shape, so a
-- wrong assumption here fails loud on the next real scan, not silently.
-- ============================================================================


-- ══════════════════════════════════════════════════════════════════════════════
-- PART A — READ-ONLY: confirm none of these four keys exist yet
-- ══════════════════════════════════════════════════════════════════════════════

SELECT key, label, status
FROM monitor_checks
WHERE key IN ('devices:stale-duplicate-records', 'devices:unassigned-intune-profiles',
              'governance:empty-security-groups', 'appgov:dormant-service-principals');


-- ══════════════════════════════════════════════════════════════════════════════
-- PART B — devices:stale-duplicate-records
-- ══════════════════════════════════════════════════════════════════════════════

BEGIN;

INSERT INTO "monitor_checks" (
  "key", "label", "description",
  "endpoint", "method",
  "properties", "mapping", "severity_rules",
  "engines", "frequency", "requires_customer_script",
  "schema_version", "status"
) VALUES (
  'devices:stale-duplicate-records',
  'Stale & Duplicate Device Records',
  '#1260 -- GET /devices, Directory.Read.All (already in REQUIRED_MT_SCOPES). staleDeviceRecordCount counts device records whose approximateLastSignInDateTime (a real v1.0 property on the device resource, unlike application) is null or more than 90 days old -- a null last-sign-in is treated as stale rather than excluded, per the platform''s "{{x}} == null || {{x}} olderThanDays N" idiom (evalClause fails a bare olderThanDays closed on null, so this composes explicitly). duplicateDeviceRecordCount counts device records sharing the same deviceId (the hardware identifier Azure Device Registration Service sets at registration) via countDuplicates -- the real "2 records for the same hardware ID from a re-enrolled device" signal. 90 days is Shane''s call as a starting point, same posture as #551''s age cutoffs; raise it here if it proves noisy against real tenants.',
  '/devices?$select=id,displayName,deviceId,approximateLastSignInDateTime,operatingSystem,trustType',
  'GET',
  '["id","displayName","deviceId","approximateLastSignInDateTime"]'::jsonb,
  '[{"sourceField":"approximateLastSignInDateTime","targetField":"staleDeviceRecordCount","transform":"countWhere(''{{approximateLastSignInDateTime}} == null || {{approximateLastSignInDateTime}} olderThanDays 90'')"},
    {"sourceField":"deviceId","targetField":"duplicateDeviceRecordCount","transform":"countDuplicates"}]'::jsonb,
  '[{"severity":"warning","expression":"{{staleDeviceRecordCount}} > 0","label":"{{staleDeviceRecordCount}} device record(s) with no sign-in in 90+ days (or never signed in) -- no cleanup rule exists, so these accumulate indefinitely"},
    {"severity":"warning","expression":"{{duplicateDeviceRecordCount}} > 0","label":"{{duplicateDeviceRecordCount}} device record(s) share a hardware ID with another record -- likely re-enrolled devices that left the old record behind, which double-counts in compliance reporting"}]'::jsonb,
  '["health"]'::jsonb,
  'daily',
  false,
  1,
  'active'
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-24-health-object-inventory-4-missing-checks-1260.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
COMMIT;


-- ══════════════════════════════════════════════════════════════════════════════
-- PART C — devices:unassigned-intune-profiles
-- ══════════════════════════════════════════════════════════════════════════════

BEGIN;

INSERT INTO "monitor_checks" (
  "key", "label", "description",
  "endpoint", "method",
  "properties", "mapping", "severity_rules",
  "engines", "frequency", "requires_customer_script",
  "schema_version", "status"
) VALUES (
  'devices:unassigned-intune-profiles',
  'Unassigned Intune Configuration Profiles',
  '#1260 -- GET /deviceManagement/deviceConfigurations?$expand=assignments($select=id), DeviceManagementConfiguration.Read.All (already in REQUIRED_MT_SCOPES; same endpoint devices:update-rings-config and devices:kfm-configuration already read, per #1253). unassignedIntuneProfileCount uses countEmptyArray on the expanded assignments collection -- monitor-executor.ts''s own countEmptyArray docstring names exactly this shape ("this group has no owners" via $expand=owners) as its reference case; applied here to a configuration profile''s assignments instead. A profile with an empty assignments array targets nothing -- it exists but affects no device, which is the fixture row''s own description ("Profiles that exist and target nothing"). intuneProfileCount is the raw scanned-profile count for context, matching the sibling devices:* checks'' own raw/flagged pairing.',
  '/deviceManagement/deviceConfigurations?$expand=assignments($select=id)&$select=id,displayName,lastModifiedDateTime',
  'GET',
  '["id","displayName"]'::jsonb,
  '[{"sourceField":"assignments","targetField":"unassignedIntuneProfileCount","transform":"countEmptyArray"},
    {"sourceField":"id","targetField":"intuneProfileCount","transform":"count"}]'::jsonb,
  '[{"severity":"warning","expression":"{{unassignedIntuneProfileCount}} > 0","label":"{{unassignedIntuneProfileCount}} Intune configuration profile(s) exist but target no device or group"}]'::jsonb,
  '["health"]'::jsonb,
  'daily',
  false,
  1,
  'active'
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-24-health-object-inventory-4-missing-checks-1260.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
COMMIT;


-- ══════════════════════════════════════════════════════════════════════════════
-- PART D — governance:empty-security-groups
-- ══════════════════════════════════════════════════════════════════════════════

BEGIN;

INSERT INTO "monitor_checks" (
  "key", "label", "description",
  "endpoint", "method",
  "properties", "mapping", "severity_rules",
  "engines", "frequency", "requires_customer_script",
  "schema_version", "status"
) VALUES (
  'governance:empty-security-groups',
  'Empty Security Groups',
  '#1260 -- GET /groups, filtered to securityEnabled eq true and mailEnabled eq false (pure security groups only -- excludes Microsoft 365 groups and distribution lists, matching the fixture row''s own label), $expand=members($select=id). Directory.Read.All (already in REQUIRED_MT_SCOPES); graphFetchPaginated adds the required ConsistencyLevel: eventual header automatically for any GET whose URL contains "$filter=". emptySecurityGroupCount uses countEmptyArray on the expanded members collection -- exactly the reference case in monitor-executor.ts''s own countEmptyArray docstring ("this group has no owners" via $expand=owners), applied to members instead of owners. securityGroupCount is the raw scanned-group count for context.',
  '/groups?$filter=securityEnabled eq true and mailEnabled eq false&$select=id,displayName,createdDateTime&$expand=members($select=id)',
  'GET',
  '["id","displayName","createdDateTime"]'::jsonb,
  '[{"sourceField":"members","targetField":"emptySecurityGroupCount","transform":"countEmptyArray"},
    {"sourceField":"id","targetField":"securityGroupCount","transform":"count"}]'::jsonb,
  '[{"severity":"warning","expression":"{{emptySecurityGroupCount}} > 0","label":"{{emptySecurityGroupCount}} security group(s) have zero members -- some may still be referenced in Conditional Access exclusions, so verify before deleting"}]'::jsonb,
  '["governance"]'::jsonb,
  'daily',
  false,
  1,
  'active'
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-24-health-object-inventory-4-missing-checks-1260.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
COMMIT;


-- ══════════════════════════════════════════════════════════════════════════════
-- PART E — appgov:dormant-service-principals (see the HONESTY NOTE above)
-- ══════════════════════════════════════════════════════════════════════════════

BEGIN;

INSERT INTO "monitor_checks" (
  "key", "label", "description",
  "endpoint", "method",
  "properties", "mapping", "severity_rules",
  "engines", "frequency", "requires_customer_script",
  "schema_version", "status"
) VALUES (
  'appgov:dormant-service-principals',
  'Service Principals With No Assigned Access',
  '#1260 -- GET /servicePrincipals?$expand=appRoleAssignedTo($select=id), Directory.Read.All (already in REQUIRED_MT_SCOPES). DOES NOT MEASURE SIGN-IN ACTIVITY: the servicePrincipal resource has no signInActivity property and no createdDateTime property in v1.0 (confirmed against learn.microsoft.com/en-us/graph/api/resources/serviceprincipal, 2026-08-24) -- there is no age-based fallback of the #551 kind available here, and GET /reports/servicePrincipalSignInActivities remains beta-only. dormantServicePrincipalCount uses countEmptyArray on the expanded appRoleAssignedTo collection: a service principal with zero app role assignments has no user, group, or other service principal provisioned to use it at all, which is the closest real, non-beta v1.0 proxy for "nothing signs in through this" -- a provisioning-state signal, not an observed-activity one. Read the migration file''s own HONESTY NOTE before wiring this to any "no sign-in" or "dormant apps" UI copy. servicePrincipalCount is the raw scanned-principal count for context.',
  '/servicePrincipals?$expand=appRoleAssignedTo($select=id)&$select=id,displayName,accountEnabled,servicePrincipalType',
  'GET',
  '["id","displayName","accountEnabled","servicePrincipalType"]'::jsonb,
  '[{"sourceField":"appRoleAssignedTo","targetField":"dormantServicePrincipalCount","transform":"countEmptyArray"},
    {"sourceField":"id","targetField":"servicePrincipalCount","transform":"count"}]'::jsonb,
  '[{"severity":"warning","expression":"{{dormantServicePrincipalCount}} > 0","label":"{{dormantServicePrincipalCount}} service principal(s) have no assigned users, groups, or principals -- nothing is provisioned to use them, and dormant service principals keep whatever grants they already hold"}]'::jsonb,
  '["governance"]'::jsonb,
  'daily',
  false,
  1,
  'active'
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-24-health-object-inventory-4-missing-checks-1260.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
COMMIT;


-- ══════════════════════════════════════════════════════════════════════════════
-- PART F — wire all four new checks into the same 4 packages their devices:*/
-- appgov:* siblings already run in (core:enhanced-monitoring, core:growth,
-- core:premier, detail:full-item-collection -- same confirmed-live package
-- set #1253 used the same day for its own new devices:* check).
-- ══════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  chk text;
  pkg text;
BEGIN
  FOREACH chk IN ARRAY ARRAY['devices:stale-duplicate-records', 'devices:unassigned-intune-profiles',
                              'governance:empty-security-groups', 'appgov:dormant-service-principals']
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
-- PART G — READ-ONLY: verify the catalog + package wiring
-- ══════════════════════════════════════════════════════════════════════════════

SELECT key, label, endpoint, engines, status
FROM monitor_checks
WHERE key IN ('devices:stale-duplicate-records', 'devices:unassigned-intune-profiles',
              'governance:empty-security-groups', 'appgov:dormant-service-principals')
ORDER BY key;

SELECT package_key, check_key, sort_order
FROM monitoring_package_checks
WHERE check_key IN ('devices:stale-duplicate-records', 'devices:unassigned-intune-profiles',
                     'governance:empty-security-groups', 'appgov:dormant-service-principals')
ORDER BY check_key, package_key;


-- ══════════════════════════════════════════════════════════════════════════════
-- FOLLOW-UP — DELIBERATELY NOT DONE HERE
-- ══════════════════════════════════════════════════════════════════════════════
--   * hltDashboardData.ts / portal-v2-health.tsx are NOT touched by this
--     migration. Per #1260's own scoping, wiring the stale-object-inventory
--     section to live data is separate follow-up work, to be done only once
--     all 9 rows are confirmed backed (this migration is what makes that
--     true -- 4 already were, per #1229; these 4 close the gap).
--   * The dashboard-registry metrics for these 4 checks are added in the same
--     commit as this file (lib/dashboard-registry/src/metrics.ts) so a future
--     wiring session has a real metric key to resolve against, matching how
--     #1122/#1233's checks got their metrics.ts entries in the same build
--     that added the underlying check.
-- ============================================================================
