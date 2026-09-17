-- #4514 — break-glass-first for identity-ca-hardening-v1, idempotent break-glass
-- creation for quickstart-v1. Data-only: fills baseline_action_templates.resolve_steps
-- (column from #3800) on six existing templates. No DDL.
--
-- 1. identity-ca-hardening-v1. Four of its five CA policies put
--    excludeGroups: ["{{breakGlassGroupId}}"] in the body, and the only source of that
--    GUID was an operator typing it. Nothing checked it was a real group, the
--    exclusion group, or that anyone who could still sign in was in it. Each of the
--    four now resolves it live, before the write, in three reads:
--      a) the group by the quickstart-v1 naming convention (mailNickname
--         breakglass-ca-exclusion or displayName "Break-Glass Accounts - CA
--         Exclusion"). unique: two matches fail closed with both ids — never a guess.
--      b) its enabled user members (transitiveMembers, since CA exclusion of a group
--         covers nested members). None → fail closed.
--      c) an ACTIVE, tenant-wide ("/") Global Administrator assignment
--         (62e90394-69f5-4237-9190-012177145e10) held by one of those members.
--         None → fail closed. PIM-eligible-only does not count: a break-glass account
--         that has to activate a role is not a break-glass account.
--    A failed resolve returns 424 and the policy POST is never sent. The resolved
--    value also replaces anything the operator typed for breakGlassGroupId, and the
--    variable is no longer demanded as operator input (config-pack-orchestrator.ts).
--    action.create-ca-guest-mfa-policy is unchanged: it targets GuestsOrExternalUsers
--    only, which cannot include a member break-glass account.
--
-- 2. quickstart-v1. create-break-glass-account (POST /users) and
--    create-ca-exclusion-group (POST /groups) had no existence check, and the testbed
--    already holds two of each from past runs. Each now looks the resource up by the
--    same convention its own body writes (mailNickname breakglass-admin / UPN
--    breakglass-admin@*, across every domain, not just {{domain}}; the group lookup
--    above) with onMatch "skip-write":
--      none   → the POST fires as before
--      one    → no POST; the existing object is the step's result, so the pack's
--               parameter_mapping ({{steps.<node>.data.id}}) chains onto it
--      two+   → fail closed with every id, no POST
--    A skipped account never received this run's generated password, so the
--    break-glass verification gate now refuses to deliver it (workflow-executor.ts)
--    rather than hand an admin a credential that cannot sign in.
--
-- Graph reads live-verified against the testbed tenant this session (2026-09-17) with
-- the write app token: all three filters return 200 without ConsistencyLevel.

BEGIN;

UPDATE baseline_action_templates
   SET resolve_steps = $json$[
     {
       "subject": "the break-glass CA exclusion group",
       "endpoint": "/groups?$filter=mailNickname%20eq%20'breakglass-ca-exclusion'%20or%20displayName%20eq%20'Break-Glass%20Accounts%20-%20CA%20Exclusion'&$select=id,displayName,mailNickname,securityEnabled",
       "unique": true,
       "assign": { "breakGlassGroupId": "id" }
     },
     {
       "subject": "an enabled user in the break-glass CA exclusion group",
       "endpoint": "/groups/{{breakGlassGroupId}}/transitiveMembers/microsoft.graph.user?$select=id,accountEnabled,userPrincipalName",
       "selectMatch": { "accountEnabled": "true" },
       "collect": { "breakGlassEnabledMemberIds": "id" },
       "assign": {}
     },
     {
       "subject": "an active Global Administrator among the enabled members of the break-glass CA exclusion group",
       "endpoint": "/roleManagement/directory/roleAssignments?$filter=roleDefinitionId%20eq%20'62e90394-69f5-4237-9190-012177145e10'&$select=id,principalId,directoryScopeId",
       "selectMatch": { "principalId": "in:{{breakGlassEnabledMemberIds}}", "directoryScopeId": "/" },
       "assign": { "breakGlassVerifiedAdminId": "principalId" }
     }
   ]$json$::jsonb,
       updated_at = now()
 WHERE template_id IN (
   'action.create-ca-legacy-auth-block-policy',
   'action.create-ca-mfa-all-users-policy',
   'action.create-ca-signin-risk-policy',
   'action.create-ca-user-risk-policy'
 );

UPDATE baseline_action_templates
   SET resolve_steps = $json$[
     {
       "subject": "an existing break-glass account",
       "endpoint": "/users?$filter=mailNickname%20eq%20'breakglass-admin'%20or%20startswith(userPrincipalName,'breakglass-admin@')&$select=id,userPrincipalName,displayName,accountEnabled,mailNickname",
       "onMatch": "skip-write",
       "assign": {}
     }
   ]$json$::jsonb,
       updated_at = now()
 WHERE template_id = 'quickstart-v1.create-break-glass-account';

UPDATE baseline_action_templates
   SET resolve_steps = $json$[
     {
       "subject": "an existing break-glass CA exclusion group",
       "endpoint": "/groups?$filter=mailNickname%20eq%20'breakglass-ca-exclusion'%20or%20displayName%20eq%20'Break-Glass%20Accounts%20-%20CA%20Exclusion'&$select=id,displayName,mailNickname,securityEnabled",
       "onMatch": "skip-write",
       "assign": {}
     }
   ]$json$::jsonb,
       updated_at = now()
 WHERE template_id = 'quickstart-v1.create-ca-exclusion-group';

-- Verification — six rows carry resolve steps.
SELECT template_id, jsonb_array_length(resolve_steps) AS steps
  FROM baseline_action_templates
 WHERE template_id IN (
   'action.create-ca-legacy-auth-block-policy',
   'action.create-ca-mfa-all-users-policy',
   'action.create-ca-signin-risk-policy',
   'action.create-ca-user-risk-policy',
   'quickstart-v1.create-break-glass-account',
   'quickstart-v1.create-ca-exclusion-group'
 )
 ORDER BY template_id;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-17-break-glass-resolve-steps-4514.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
