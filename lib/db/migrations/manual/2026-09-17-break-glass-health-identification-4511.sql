-- ============================================================================
-- #4511 -- identity:break-glass-health was a false critical: it never $selected
-- accountEnabled (always 0) and it counted every user, not break-glass accounts.
-- ============================================================================
-- Additive, idempotent data fix: a plain UPDATE of one monitor_checks row by
-- key, safe to re-run. Run locally in-session (#4511); Replit/Staging carries it
-- via the #1630 release checklist.
--
-- ── WHAT WAS WRONG (live, tenant 2080, run d1dc0ffe-db89-403a-91b9-d94b77d873b6) ──
--   endpoint /users, select_params NULL,
--   mapping [{countTruthy, accountEnabled -> breakGlassAccountsHealthy}]
--   evidence: _itemCount 27, accountEnabled_count 0, breakGlassAccountsHealthy 0
--   -> critical "No enabled break-glass account" on a tenant that HAS two.
--
--   1. Graph v1.0 GET /users does not return accountEnabled without $select, so
--      countTruthy saw undefined on every item and reported 0.
--   2. Nothing identified break-glass accounts. With the $select added, the check
--      would count every enabled user and never fire on any real tenant.
--
-- ── HOW BREAK-GLASS ACCOUNTS ARE IDENTIFIED NOW ─────────────────────────────
-- By the platform's own naming convention, on the user object itself:
--   startswith(userPrincipalName,'breakglass')   -- quickstart-v1.create-break-glass-account
--                                                   creates breakglass-admin@{{domain}};
--                                                   the KB (remediation_knowledge_base id 23)
--                                                   example uses breakglass1@...
--   startswith(displayName,'Emergency Access')   -- the same template's displayName
--                                                   "Emergency Access Admin"; KB uses
--                                                   "Emergency Access 1"
--
-- CANDIDATE CHECKED AND REJECTED -- CA-exclusion-group membership
-- (GET /groups?$filter=displayName eq 'Break-Glass Accounts - CA Exclusion'
--  &$expand=members). Probed live on tenant 2080 on 2026-09-17: BOTH
-- "Break-Glass Accounts - CA Exclusion" groups (19219599-..., 2bf1151a-...)
-- have ZERO members (/groups/{id}/members returns []), while the two
-- breakglass-admin@ accounts exist and are enabled. Group membership would
-- therefore reproduce the exact false critical this migration removes.
--
-- Live probe of the new query (tenant 2080, 2026-09-17), 2 items:
--   breakglass-admin@mccawsoft.com   accountEnabled true
--   breakglass-admin@shanemccaw.com  accountEnabled true
--
-- ── FAIL CLOSED ─────────────────────────────────────────────────────────────
-- Both mapping rules carry "requireField": true (MappingRule.requireField in
-- artifacts/api-server/src/lib/monitor-executor.ts). If the endpoint returns
-- accounts but accountEnabled (or id) is absent from EVERY one -- the original
-- defect's shape -- the check ends in status `error` rather than reporting 0
-- (critical) or a clean result. Zero matching accounts is a real answer and
-- still reports critical.
--
-- targetField breakGlassAccountsHealthy is unchanged on purpose:
-- signal_derivation_rules id 2778 (signal.identity.break-glass-health,
-- profile_key_eq breakGlassAccountsHealthy 0) keys on it.
--
-- WHAT THIS CHECK STILL DOES NOT MEASURE (said in `description`, not hidden):
-- CA exclusion, MFA method, credential validity, Global Administrator role.
-- ============================================================================

UPDATE monitor_checks
SET
  endpoint      = '/users',
  select_params = 'id,accountEnabled,userPrincipalName,displayName',
  filter_params = 'startswith(userPrincipalName,''breakglass'') or startswith(displayName,''Emergency Access'')',
  properties    = '["id","accountEnabled","userPrincipalName"]'::jsonb,
  mapping = '[
    {"sourceField":"id","targetField":"breakGlassAccountCount","transform":"count","requireField":true},
    {"sourceField":"accountEnabled","targetField":"breakGlassAccountsHealthy","transform":"countTruthy","requireField":true}
  ]'::jsonb,
  severity_rules = '[
    {"severity":"critical","expression":"breakGlassAccountCount == 0","label":"No break-glass account found — real risk of total tenant lockout"},
    {"severity":"critical","expression":"breakGlassAccountsHealthy == 0","label":"No enabled break-glass account — real risk of total tenant lockout"}
  ]'::jsonb,
  description = 'Emergency-access (break-glass) accounts exist and at least one is enabled (#4511). '
    || 'Accounts are identified by the platform''s own convention: userPrincipalName starting "breakglass" '
    || '(quickstart-v1.create-break-glass-account creates breakglass-admin@) or displayName starting "Emergency Access". '
    || 'Fails closed (check error, not 0) if accountEnabled is not returned. '
    || 'Does NOT verify CA exclusion, MFA method, credential validity or Global Administrator assignment.',
  schema_version = schema_version + 1,
  updated_at = now()
WHERE key = 'identity:break-glass-health'
  AND (filter_params IS DISTINCT FROM 'startswith(userPrincipalName,''breakglass'') or startswith(displayName,''Emergency Access'')'
       OR mapping::text NOT LIKE '%requireField%');

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-17-break-glass-health-identification-4511.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
