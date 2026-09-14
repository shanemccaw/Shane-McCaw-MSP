-- 2026-09-14-per-user-mfa-beta-endpoint-fix-3951.sql
-- Git #3951 (Feature #2494) -- action.enforce-per-user-mfa / action.disable-per-user-mfa
-- (paired by #3939) live-400 against the real testbed tenant because
-- PATCH /users/{{userId}}/authentication/requirements does not exist on Graph
-- v1.0 -- confirmed against Microsoft's own current documentation (Entra admin
-- docs, updated Feb 2026: "You can manage per-user MFA settings by using the
-- Microsoft Graph REST API Beta") that the resource IS real, but ONLY under
-- https://graph.microsoft.com/beta -- the template was just pointed at the
-- wrong API version, not a genuinely nonexistent resource as #3939 concluded.
--
-- Code-side check (this session, before writing this migration): graphWriteForTenant
-- (artifacts/api-server/src/lib/graph.ts:1102-1110) ALREADY passes an absolute
-- https://graph.microsoft.com/... URL straight through unmodified when
-- endpoint.startsWith(GRAPH_HOST_PREFIX) -- the identical passthrough #3800 added
-- to the read path (graphFetchForTenant, graph.ts:832-837). No code change needed;
-- runBaselineTemplateAgainstTenant (workflow-executor.ts:1254) already forwards the
-- template's resolved `endpoint` column verbatim into graphWriteForTenant. This
-- migration only needs to change what that column actually holds.
--
-- Live-tested this session against the real testbed tenant
-- (c4c814d4-3afe-441e-9145-62461d0a4fd3), target: the sanctioned Git #2840
-- synthetic identity zz-test-graphwrite-01@mccawsoft2.onmicrosoft.com
-- (objectId bdb21dc3-146a-4d97-a128-a2b8ff618d35), via
-- POST /api/admin/write-actions/action.enforce-per-user-mfa/execute and
-- .../action.disable-per-user-mfa/execute (the real runBaselineTemplateAgainstTenant()
-- engine) AFTER the endpoint UPDATEs below ran manually:
--   - enforce: 204, audit log id 53, endpoint
--     https://graph.microsoft.com/beta/users/bdb21dc3.../authentication/requirements
--   - disable: 204, audit log id 54, same endpoint
--   - Follow-up GET (graphReadForTenantWithWriteToken against the same beta URL,
--     via a temporary scratch script, deleted after use) confirmed the REAL state
--     change both directions: perUserMfaState "enforced" after the enforce call,
--     then "disabled" after the disable call -- not just a 2xx status code.
-- Both directions verify clean, so row 115 is promoted to execution_ready below.
--
-- Idempotent: plain UPDATEs by template_id / id, safe to re-run.

BEGIN;

UPDATE baseline_action_templates
SET endpoint = 'https://graph.microsoft.com/beta/users/{{userId}}/authentication/requirements',
    updated_at = now()
WHERE template_id = 'action.enforce-per-user-mfa';

UPDATE baseline_action_templates
SET endpoint = 'https://graph.microsoft.com/beta/users/{{userId}}/authentication/requirements',
    updated_at = now()
WHERE template_id = 'action.disable-per-user-mfa';

-- Row 115: both directions live-verified clean against the real testbed tenant
-- (200/204 + a follow-up read confirming the actual state change) -- promote from
-- blocked_no_workaround to execution_ready, matching this migration's #3939 sibling
-- pattern of using the same id + domain + action_name guard.
UPDATE write_action_catalog
SET status = 'execution_ready',
    blocked_reason = NULL
WHERE id = 115
  AND domain = 'Auth/MFA'
  AND action_name = 'Enable/disable per-user MFA (legacy)';

-- Self-mark this migration as run (Simulator Studio Migrations tree, #497).
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-14-per-user-mfa-beta-endpoint-fix-3951.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
