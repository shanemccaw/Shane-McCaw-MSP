-- ============================================================================
-- #4602 -- sharepoint:inactive-sites: countIfLastSignInOlderThan is hardcoded
-- to test signInActivity.lastSignInDateTime, not the mapping rule's own
-- sourceField (lastModifiedDateTime). Sites carry no signInActivity at all,
-- so every real item fell into the transform's "never signed in counts as
-- stale" branch -- inactiveSiteCount always equalled itemCount (confirmed
-- live against testbed tenant 2080: 143/143, including a site modified one
-- day before the scan ran).
-- ============================================================================
-- Additive, idempotent data fix: a plain UPDATE of one monitor_checks row by
-- key, safe to re-run. Run locally in-session; Replit/Staging carries it via
-- the #1630 release checklist.
--
-- Repoints the mapping's transform from countIfLastSignInOlderThan(90) to the
-- new countIfFieldOlderThan(90) (artifacts/api-server/src/lib/monitor-executor.ts),
-- which compares sourceField's own resolved value against the cutoff instead
-- of a hardcoded signInActivity path. select_params, sourceField, targetField
-- and requireField are unchanged -- this is a transform-semantics fix only.
--
-- countIfLastSignInOlderThan itself is untouched by this migration and by the
-- code change it pairs with -- identity:stale-accounts and
-- governance:guest-staleness keep using it unchanged (both really do read
-- signInActivity).
-- ============================================================================

UPDATE monitor_checks
SET
  mapping        = '[{"sourceField":"lastModifiedDateTime","targetField":"inactiveSiteCount","transform":"countIfFieldOlderThan(90)","requireField":true}]'::jsonb,
  schema_version = schema_version + 1,
  updated_at     = now()
WHERE key = 'sharepoint:inactive-sites'
  AND mapping::text LIKE '%countIfLastSignInOlderThan%';

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-18-sharepoint-inactive-sites-field-transform-4602.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
