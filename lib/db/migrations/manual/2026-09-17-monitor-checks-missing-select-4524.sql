-- ============================================================================
-- #4524 -- Eight monitor checks silently report 0 (false healthy): the mapped
-- count-family field was never $selected (or, for one check, read the wrong
-- casing entirely), so `sourceField_count` was 0 on every real item and the
-- check reported "clean" when it had never actually looked.
-- ============================================================================
-- Additive, idempotent data fix: a plain UPDATE of eight monitor_checks rows by
-- key, safe to re-run. Run locally in-session; Replit/Staging carries it via the
-- #1630 release checklist.
--
-- ── METHOD (from the issue, applied to the full active catalog) ────────────
-- For every active `monitor_checks` row with a count/countTruthy/countFalse/
-- countEquals/countIfLastSignInOlderThan mapping rule, checked the real scan
-- evidence (tenant 2080, tenant-scans/2026-09-17-testbed-full-scan.json, run
-- d1dc0ffe-db89-403a-91b9-d94b77d873b6) for `_itemCount > 0` alongside
-- `<sourceField>_count === 0`. The 5 checks named in #4524 plus 3 more real
-- instances of the identical defect class came back:
--
--   key                                   endpoint          sourceField          itemCount
--   governance:guest-count                /users            userType             27
--   cost:underutilized-premium            /users            assignedLicenses     27
--   cost:group-based-licensing-adoption   /groups           assignedLicenses     104
--   governance:dynamic-group-usage        /groups           membershipRule       104
--   exchange:distribution-list-count      /groups?$filter=… Name (PS-cased;      17
--                                                            Graph has no
--                                                            "Name" property --
--                                                            fixed to displayName)
--   sharepoint:inactive-sites             /sites            lastModifiedDateTime 99
--   identity:stale-accounts               /users            signInActivity       27
--   governance:guest-staleness            /users            signInActivity       27
--
-- All eight had `select_params` NULL. Graph v1.0's default projection for
-- `/users` and `/groups` carries none of these fields (confirmed convention
-- elsewhere in this catalog: `onedrive:departed-user-access` already fetches
-- `signInActivity` via an explicit `$select=id,accountEnabled,signInActivity`
-- on the same `/users` endpoint and it works).
--
-- `cost:group-based-licensing-adoption` and `governance:dynamic-group-usage`
-- were flagged "likely, not proven" in the issue -- `count` skips null, so a
-- tenant with no group-based licensing or dynamic groups legitimately yields 0.
-- Adding the real $select (this migration) settles that ambiguity going
-- forward; `requireField: true` on both means a *future* regression back to
-- missing $select surfaces as a check `error`, not a silent 0, while a real
-- empty tenant still reports a clean 0 (requireField treats explicit null as
-- present -- see #4511's migration and MappingRule.requireField).
--
-- ── NOT FIXED HERE (different defect class, filed separately) ──────────────
-- `governance:guest-staleness` has no guest scoping at all -- no $filter, and
-- its one mapping rule reads signInActivity across the WHOLE /users
-- population, not just userType=='Guest'. That is a missing-filter logic bug,
-- not a missing-$select bug; fixing the $select here makes it evaluable
-- (fails closed instead of reporting 0) but does not make it count guests
-- specifically. Filed as its own issue, parented under #1489.
--
-- ── FAIL CLOSED ─────────────────────────────────────────────────────────────
-- Every mapping rule below carries "requireField": true (MappingRule.requireField
-- in artifacts/api-server/src/lib/monitor-executor.ts, #4511). If the endpoint
-- ever again returns items but the required field is absent from every one, the
-- check ends in status `error` rather than reporting a fabricated 0 (or a
-- fabricated clean/ok severity).
-- ============================================================================

UPDATE monitor_checks
SET
  select_params  = 'id,userType',
  properties     = '["id","userType"]'::jsonb,
  mapping        = '[{"sourceField":"userType","targetField":"guestAccountCount","transform":"countEquals(''Guest'')","requireField":true}]'::jsonb,
  schema_version = schema_version + 1,
  updated_at     = now()
WHERE key = 'governance:guest-count'
  AND (select_params IS DISTINCT FROM 'id,userType' OR mapping::text NOT LIKE '%requireField%');

UPDATE monitor_checks
SET
  select_params  = 'id,assignedLicenses',
  properties     = '["id","assignedLicenses"]'::jsonb,
  mapping        = '[{"sourceField":"assignedLicenses","targetField":"underutilizedPremiumLicenseCount","transform":"count","requireField":true}]'::jsonb,
  schema_version = schema_version + 1,
  updated_at     = now()
WHERE key = 'cost:underutilized-premium'
  AND (select_params IS DISTINCT FROM 'id,assignedLicenses' OR mapping::text NOT LIKE '%requireField%');

UPDATE monitor_checks
SET
  select_params  = 'id,assignedLicenses',
  properties     = '["id","assignedLicenses"]'::jsonb,
  mapping        = '[{"sourceField":"assignedLicenses","targetField":"groupBasedLicensingGroupCount","transform":"count","requireField":true}]'::jsonb,
  schema_version = schema_version + 1,
  updated_at     = now()
WHERE key = 'cost:group-based-licensing-adoption'
  AND (select_params IS DISTINCT FROM 'id,assignedLicenses' OR mapping::text NOT LIKE '%requireField%');

UPDATE monitor_checks
SET
  select_params  = 'id,groupTypes,membershipRule',
  properties     = '["id","groupTypes","membershipRule"]'::jsonb,
  mapping        = '[{"sourceField":"membershipRule","targetField":"dynamicGroupCount","transform":"count","requireField":true}]'::jsonb,
  schema_version = schema_version + 1,
  updated_at     = now()
WHERE key = 'governance:dynamic-group-usage'
  AND (select_params IS DISTINCT FROM 'id,groupTypes,membershipRule' OR mapping::text NOT LIKE '%requireField%');

UPDATE monitor_checks
SET
  select_params  = 'id,displayName',
  properties     = '["id","displayName"]'::jsonb,
  mapping        = '[{"sourceField":"displayName","targetField":"distributionListCount","transform":"count","requireField":true}]'::jsonb,
  schema_version = schema_version + 1,
  updated_at     = now()
WHERE key = 'exchange:distribution-list-count'
  AND (select_params IS DISTINCT FROM 'id,displayName' OR mapping::text NOT LIKE '%requireField%');

UPDATE monitor_checks
SET
  select_params  = 'id,lastModifiedDateTime',
  properties     = '["id","lastModifiedDateTime"]'::jsonb,
  mapping        = '[{"sourceField":"lastModifiedDateTime","targetField":"inactiveSiteCount","transform":"countIfLastSignInOlderThan(90)","requireField":true}]'::jsonb,
  schema_version = schema_version + 1,
  updated_at     = now()
WHERE key = 'sharepoint:inactive-sites'
  AND (select_params IS DISTINCT FROM 'id,lastModifiedDateTime' OR mapping::text NOT LIKE '%requireField%');

UPDATE monitor_checks
SET
  select_params  = 'id,signInActivity',
  properties     = '["id","signInActivity"]'::jsonb,
  mapping        = '[{"sourceField":"signInActivity","targetField":"staleAccountCount","transform":"countIfLastSignInOlderThan(90)","requireField":true}]'::jsonb,
  schema_version = schema_version + 1,
  updated_at     = now()
WHERE key = 'identity:stale-accounts'
  AND (select_params IS DISTINCT FROM 'id,signInActivity' OR mapping::text NOT LIKE '%requireField%');

UPDATE monitor_checks
SET
  select_params  = 'id,userType,signInActivity',
  properties     = '["id","userType","signInActivity"]'::jsonb,
  mapping        = '[{"sourceField":"signInActivity","targetField":"staleGuestCount","transform":"countIfLastSignInOlderThan(90)","requireField":true}]'::jsonb,
  schema_version = schema_version + 1,
  updated_at     = now()
WHERE key = 'governance:guest-staleness'
  AND (select_params IS DISTINCT FROM 'id,userType,signInActivity' OR mapping::text NOT LIKE '%requireField%');

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-17-monitor-checks-missing-select-4524.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
