-- #1130 — Graph write action: assign a built-in Entra directory role to a
-- service principal, tenant-wide, via the WRITE app's elevated consent.
--
-- Parent: #1128 (v1.1 Monitoring & Launch Control). Prerequisite for adopting
-- the orphaned checks #1129 found: two of them need Global Reader-level
-- directory read that the READ app registration (MT_APP_CLIENT_ID) does not
-- have. This template is the executable half of granting it — it assigns the
-- built-in Global Reader role to the READ app's service principal inside each
-- customer tenant. The role is READ-ONLY (Global Reader cannot modify
-- anything); the WRITE app is used only because assigning a directory role
-- requires RoleManagement.ReadWrite.Directory, which the READ app must not
-- carry.
--
-- Follows the exact pattern of
-- 2026-07-31-entra-group-and-sp-member-templates-248.sql:
--   * relative Graph path (GRAPH_BASE + path, matching graphWriteForTenant()),
--   * successCriteria as descriptive-only metadata (the real executor
--     hardcodes expectedStatusCodes [200,201,204] regardless of this column —
--     see write-action-safety.ts and workflow-executor.ts),
--   * plain requiredVariables so the template stays standalone-testable in
--     Simulator Studio and reusable for ANY built-in directory role, not just
--     Global Reader (the caller supplies the roleDefinitionId + scope).
--
-- Uses the modern unified role-assignment endpoint
-- (/roleManagement/directory/roleAssignments) rather than the legacy
-- /directoryRoles(...)/members/$ref one deliberately: the unified endpoint is a
-- single idempotent POST that takes directoryScopeId directly and needs no
-- prior "activate the directoryRole" step. For a built-in role the
-- roleDefinitionId is the same GUID as the roleTemplateId — Global Reader is
-- f2ef992c-3afb-46b9-b7cf-a126ee74c451 (confirmed in
-- global-admin-count-role-members-551.test.ts). directoryScopeId "/" = the
-- whole tenant directory (Global Reader is inherently tenant-wide read).
--
-- The provisioning caller (global-reader-role-provisioning.ts) resolves the
-- READ app's per-tenant service principal object id and passes it as
-- principalId, then treats a 409 / "conflicting object" as an idempotent
-- already-assigned no-op (the same attempt-and-classify approach the DLP
-- member-add step uses for its own duplicate case).
--
-- Idempotent via ON CONFLICT ("template_id") DO NOTHING — safe to re-run.

INSERT INTO "baseline_action_templates"
  ("template_id", "label", "description", "category", "endpoint", "method", "body_template",
   "required_variables", "success_criteria", "depends_on", "requires_verification_gate", "status")
VALUES
  (
    'roleManagement.assign_directory_role',
    'Assign Built-in Directory Role to Principal',
    'Assigns a built-in Microsoft Entra directory role (by roleDefinitionId) to a directory principal (user, group, or service principal) at a given directory scope, via the modern unified role-assignment endpoint. Used by #1130 to grant the READ app''s service principal the Global Reader role (roleDefinitionId f2ef992c-3afb-46b9-b7cf-a126ee74c451, directoryScopeId "/") so orphaned monitoring checks that need Global Reader-level directory read can run — but generically reusable for any built-in role. Requires the write app to hold RoleManagement.ReadWrite.Directory.',
    'Directory Roles',
    '/roleManagement/directory/roleAssignments',
    'POST',
    '{"principalId": "{{principalId}}", "roleDefinitionId": "{{roleDefinitionId}}", "directoryScopeId": "{{directoryScopeId}}"}'::jsonb,
    '["principalId", "roleDefinitionId", "directoryScopeId"]'::jsonb,
    '{"statusCode": 201}'::jsonb,
    '[]'::jsonb,
    false,
    'active'
  )
ON CONFLICT ("template_id") DO NOTHING;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-18-global-reader-role-assignment-template-1130.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
