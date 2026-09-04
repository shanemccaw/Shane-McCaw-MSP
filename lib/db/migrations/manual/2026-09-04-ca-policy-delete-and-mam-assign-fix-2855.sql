-- 2026-09-04-ca-policy-delete-and-mam-assign-fix-2855.sql
-- Git #2855 — two stored write-pack templates called endpoints/methods Microsoft
-- Graph does not expose. Both were invisible before #1901 because the endpoints
-- were simply unmapped in graph-write-permissions.ts.
--
-- 1. action.delete-ca-policy stored PUT, and Graph exposes no PUT on Conditional
--    Access policies — only DELETE (conditionalaccesspolicy-delete) and PATCH
--    (conditionalaccesspolicy-update). The template's name and empty {} body both
--    indicate DELETE was meant. https://learn.microsoft.com/en-us/graph/api/conditionalaccesspolicy-delete
--
-- 2. action.assign-app-protection-policy targeted
--    /deviceAppManagement/managedAppPolicies/{id}/assign — managedAppPolicy is
--    Microsoft's ABSTRACT BASE TYPE for MAM policies and carries no assign action.
--    The real v1.0 path for this assignment is
--    /deviceAppManagement/targetedManagedAppConfigurations/{id}/assign.
--    https://learn.microsoft.com/en-us/graph/api/intune-mam-targetedmanagedappconfiguration-assign
--
-- The derived Graph permission is unchanged for either fix (see
-- graph-write-permissions.ts's PUT-conditionalAccess-policies and
-- POST-managedAppPolicies-assign rules, updated alongside this migration) —
-- this migration only corrects the stored method/endpoint so the calls actually
-- resolve at runtime.

BEGIN;

UPDATE baseline_action_templates
SET
  method = 'DELETE',
  updated_at = now()
WHERE template_id = 'action.delete-ca-policy'
  AND method = 'PUT'
  AND endpoint = '/identity/conditionalAccess/policies/{{policyId}}';

UPDATE baseline_action_templates
SET
  endpoint = '/deviceAppManagement/targetedManagedAppConfigurations/{{policyId}}/assign',
  updated_at = now()
WHERE template_id = 'action.assign-app-protection-policy'
  AND method = 'POST'
  AND endpoint = '/deviceAppManagement/managedAppPolicies/{{policyId}}/assign';

-- Self-mark this migration as run (Simulator Studio Migrations tree, #497).
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-04-ca-policy-delete-and-mam-assign-fix-2855.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
