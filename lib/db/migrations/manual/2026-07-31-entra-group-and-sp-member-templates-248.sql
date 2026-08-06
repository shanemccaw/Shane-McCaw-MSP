-- #248 — Graph write actions: create Entra security group + add service
-- principal as member.
-- Manual migration — review and run by hand (do not run drizzle-kit push/push --force).
--
-- Parent: #246 (epic #180). Purview role-group provisioning cannot assign a
-- Service Principal directly — only indirectly via membership in an Entra
-- security group that is itself assigned to the Purview role group. These two
-- templates cover the Graph-write half of that chain (creating the group and
-- adding the service principal to it); the Purview role-group assignment
-- itself is out of scope (needs a PowerShell write path — see #246).
--
-- Follows the exact pattern of 2026-07-20-launch-control-phase3-templates.sql:
-- relative Graph paths (GRAPH_BASE + path, matching graphWriteForTenant()),
-- successCriteria as descriptive-only metadata (the real executor hardcodes
-- expectedStatusCodes [200,201,204] regardless of this column — see
-- write-action-safety.ts and workflow-executor.ts:531).
--
-- dependsOn on 'groups.add_service_principal_member' is ADVISORY ONLY —
-- verified by reading the real code before writing this file:
--   * runBaselineTemplateAgainstTenant / resolveBaselineTemplateRequest
--     (workflow-executor.ts) never reads baseline_action_templates.depends_on
--     at execution time — confirmed by write-action-safety.ts's own doc
--     comment ("The executor does NOT gate on it (it is inert at execution
--     time)").
--   * Its only two real consumers are (1) config-pack-graph.ts's
--     topologicalOrder(), which uses depends_on purely to linearize a config
--     pack's step ORDER, and (2) write-action-safety.ts's
--     resolveDependsOnState(), which only surfaces a standalone-run WARNING
--     in the Simulator Studio confirmation step.
--   * Neither mechanism threads the created group's id from step 1's result
--     into step 2's params automatically. Two real ways to get that value
--     from step 1 to step 2, both already proven elsewhere in this codebase,
--     neither requiring an executor change:
--       (a) Run both as execute_baseline_template nodes wired into a real
--           Workflow Engine graph (e.g. a config pack, or a future #246
--           consent-triggered orchestration) with an edge between them —
--           the executor already merges each node's output.data (the raw
--           Graph response body) into the next node's payload under
--           `steps.<nodeId>.*`, and interp() already supports dotted-path
--           lookups like {{steps.tpl-groups.create_security_group.data.id}}
--           (the exact same pattern used for the break-glass mapping node
--           in config-pack-graph.ts:324).
--       (b) A calling function that invokes
--           runBaselineTemplateAgainstTenant() twice in sequence and
--           manually threads result1.data.id into the payload it passes for
--           step 2 — the same pattern rollbackExecution() already uses for
--           teams.add_member/teams.remove_member's membership-id lookup
--           (workflow-executor.ts:645-666).
-- Deliberately left as plain requiredVariables (groupId, servicePrincipalId)
-- rather than baking a specific node id into the template body — that keeps
-- both templates standalone-testable in Simulator Studio (operator supplies
-- groupId directly, exactly like the existing groups.add_member /
-- groups.remove_member templates) and reusable outside this one chain.
-- Wiring #2's automatic id-threading into a real chain is orchestration work
-- for #246, explicitly out of scope here.
--
-- Idempotent via ON CONFLICT ("template_id") DO NOTHING — safe to re-run.

INSERT INTO "baseline_action_templates"
  ("template_id", "label", "description", "category", "endpoint", "method", "body_template",
   "required_variables", "success_criteria", "depends_on", "requires_verification_gate", "status")
VALUES

  (
    'groups.create_security_group',
    'Create Entra Security Group',
    'Creates a new Microsoft Entra security group with ASSIGNED (non-dynamic) membership. Used as the first step of provisioning a service-principal-carrying group (e.g. for Purview role-group assignment — see #246), but generically reusable for any assigned-membership security group.',
    'Groups',
    '/groups',
    'POST',
    '{"displayName": "{{displayName}}", "mailEnabled": false, "mailNickname": "{{mailNickname}}", "securityEnabled": true, "groupTypes": []}'::jsonb,
    '["displayName", "mailNickname"]'::jsonb,
    '{"statusCode": 201}'::jsonb,
    '[]'::jsonb,
    false,
    'active'
  ),

  (
    'groups.add_service_principal_member',
    'Add Service Principal as Group Member',
    'Adds a Service Principal (application/managed identity) as a member of an Entra security group. Same $ref-membership endpoint as groups.add_member — split into its own template because the directory object being added is a Service Principal, not a user, and this template exists specifically for chaining after groups.create_security_group (e.g. adding mt-app''s service principal to a newly-created group for Purview role-group assignment — see #246). depends_on is advisory only (see migration header comment) — groupId must still be supplied explicitly; it is not threaded automatically unless this template runs as a node in a real Workflow Engine graph downstream of groups.create_security_group.',
    'Groups',
    '/groups/{{groupId}}/members/$ref',
    'POST',
    '{"@odata.id": "https://graph.microsoft.com/v1.0/directoryObjects/{{servicePrincipalId}}"}'::jsonb,
    '["groupId", "servicePrincipalId"]'::jsonb,
    '{"statusCode": 204}'::jsonb,
    '["groups.create_security_group"]'::jsonb,
    false,
    'active'
  )

ON CONFLICT ("template_id") DO NOTHING;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-07-31-entra-group-and-sp-member-templates-248.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
