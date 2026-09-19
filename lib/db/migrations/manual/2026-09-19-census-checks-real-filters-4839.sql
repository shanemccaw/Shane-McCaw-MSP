-- ============================================================================
-- #4839 -- four census checks stored their TOTAL as the flagged count.
-- ============================================================================
-- Additive-in-effect data fix (UPDATE of four monitor_checks rows by key). Run against
-- local DATABASE_URL by the build session; Replit/Staging is a release-time step tracked
-- on #1630. Idempotent -- a plain UPDATE by key, safe to re-run (schema_version bumps each run).
--
-- BEFORE (all four): mapping = [{"transform":"count","sourceField":"id", ...}] over an
-- endpoint (Graph /sites or /teams) whose items carry NO filterable signal, so the "flagged"
-- count could only ever equal _itemCount:
--   sharepoint:site-label-coverage   sitesWithLabelCount        99 of 99
--   sharepoint:storage-near-limit    sitesNearStorageLimitCount 99 of 99
--   teams:inactive-teams             inactiveTeamCount          18 of 18
--   teams:guest-membership           teamsWithGuestsCount       18 of 18
-- (sitesWithLabelCount = 99 contradicted governance:sensitivity-label-adoption = 0.)
--
-- AFTER:
--   * the two SharePoint checks read the code-owned sharepoint-admin operation 'site-inventory'
--     (CSOM Tenant.GetSitePropertiesFromSharePoint: label + storage per site collection) and
--     countWhere over its derived hasSensitivityLabel / storageUsedPercent fields;
--   * the two Teams checks read Graph's getTeamsTeamActivityDetail(period='D90') usage report
--     (CSV, already parsed by the executor) and countWhere over Is Deleted / Last Activity Date /
--     Guests.
-- targetField names are unchanged, so pillar-signal-specs.ts and portal-governance-areas.ts
-- need no edit. requireField=true makes a missing column fail closed rather than report 0.
-- "Near limit" = 90 % of the site's own storage quota (the number lives in the mapping).
-- "Inactive" = not deleted AND Active Users == 0 in the 90-day Teams activity report. (Deliberately
-- not a Last Activity Date olderThanDays test: the report lags the wall clock by days, so a team
-- last active 86 days before the report's own refresh date would be miscounted as inactive.)
-- ============================================================================

BEGIN;

UPDATE monitor_checks
SET
  endpoint = '(unused — executor_type=sharepoint-admin drives dispatch, not endpoint)',
  executor_type = 'sharepoint-admin',
  sp_operation = 'site-inventory',
  properties = '[]'::jsonb,
  mapping = $j$[{"transform":"countWhere('{{hasSensitivityLabel}} == true')","sourceField":"hasSensitivityLabel","targetField":"sitesWithLabelCount","requireField":true}]$j$::jsonb,
  description = 'Count of SharePoint site collections carrying a sensitivity label (#4839). Read from the SharePoint admin '
    || 'host (Tenant.GetSitePropertiesFromSharePoint), because Graph /sites does not expose a site''s label. _itemCount is the '
    || 'number of site collections the admin host returned, so the sub-text "of N sites" is the real denominator.',
  schema_version = schema_version + 1,
  updated_at = now()
WHERE key = 'sharepoint:site-label-coverage'
RETURNING key, executor_type, sp_operation, mapping, schema_version;

UPDATE monitor_checks
SET
  endpoint = '(unused — executor_type=sharepoint-admin drives dispatch, not endpoint)',
  executor_type = 'sharepoint-admin',
  sp_operation = 'site-inventory',
  properties = '[]'::jsonb,
  mapping = $j$[{"transform":"countWhere('{{storageUsedPercent}} >= 90')","sourceField":"storageUsedPercent","targetField":"sitesNearStorageLimitCount","requireField":true}]$j$::jsonb,
  description = 'Count of SharePoint site collections at or above 90 % of their own storage quota (#4839), from StorageUsage / '
    || 'StorageMaximumLevel on the SharePoint admin host. Graph /sites carries no storage figures. A site whose quota is not a '
    || 'positive number is not counted (its percent is null, never 0).',
  schema_version = schema_version + 1,
  updated_at = now()
WHERE key = 'sharepoint:storage-near-limit'
RETURNING key, executor_type, sp_operation, mapping, schema_version;

UPDATE monitor_checks
SET
  endpoint = '/reports/getTeamsTeamActivityDetail(period=''D90'')',
  properties = '[]'::jsonb,
  mapping = $j$[{"transform":"countWhere('{{Is Deleted}} == \"False\" && {{Active Users}} == 0')","sourceField":"Active Users","targetField":"inactiveTeamCount","requireField":true}]$j$::jsonb,
  description = 'Teams (not deleted) with no active users in the last 90 days (#4839), from the Active Users column of the '
    || '90-day Teams activity report -- Microsoft''s own count of users active in the window, so there is no clock arithmetic '
    || 'against a report that lags by a few days. Graph /teams carries no activity data. A team created inside the window '
    || 'that has not been used yet counts as inactive. Requires Reports.Read.All.',
  schema_version = schema_version + 1,
  updated_at = now()
WHERE key = 'teams:inactive-teams'
RETURNING key, endpoint, mapping, schema_version;

UPDATE monitor_checks
SET
  endpoint = '/reports/getTeamsTeamActivityDetail(period=''D90'')',
  properties = '[]'::jsonb,
  mapping = $j$[{"transform":"countWhere('{{Is Deleted}} == \"False\" && {{Guests}} > 0')","sourceField":"Guests","targetField":"teamsWithGuestsCount","requireField":true}]$j$::jsonb,
  description = 'Teams (not deleted) with one or more guest members (#4839), from the Guests column of the Teams activity '
    || 'report. Graph /teams carries no membership data. Requires Reports.Read.All.',
  schema_version = schema_version + 1,
  updated_at = now()
WHERE key = 'teams:guest-membership'
RETURNING key, endpoint, mapping, schema_version;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-19-census-checks-real-filters-4839.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
