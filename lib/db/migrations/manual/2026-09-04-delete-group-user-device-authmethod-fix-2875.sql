-- 2026-09-04-delete-group-user-device-authmethod-fix-2875.sql
-- Git #2875 — follow-up to #2855: four more `baseline_action_templates` rows stored
-- PUT where Microsoft Graph exposes only DELETE. None of the four is wired into a
-- Config Pack yet, so none fails at runtime today — but each would the moment it's
-- wired in, the same way #2855's two rows did.
--
-- 1. action.delete-group stored PUT /groups/{id}. Graph exposes no PUT on a group
--    resource for this shape — only DELETE. https://learn.microsoft.com/en-us/graph/api/group-delete
--
-- 2. action.delete-user stored PUT /users/{id}. Same shape — Graph exposes DELETE,
--    not PUT, to remove a user. https://learn.microsoft.com/en-us/graph/api/user-delete
--
-- 3. action.unenroll-device stored PUT /deviceManagement/managedDevices/{id}. Graph
--    exposes DELETE to retire/remove a managedDevice record, not PUT.
--    https://learn.microsoft.com/en-us/graph/api/intune-devices-manageddevice-delete
--
-- 4. action.remove-auth-method stored PUT /users/{id}/authentication/methods/{id}.
--    Confirmed (same class of gap #1899 fixed for action.require-security-info-
--    reregistration): there is no v1.0 collection-level DELETE on the generic
--    /authentication/methods/{id} path — a method can only be deleted through its
--    real TYPED collection (phoneMethods, microsoftAuthenticatorMethods,
--    softwareOathMethods — see phoneauthenticationmethod-delete,
--    microsoftauthenticatorauthenticationmethod-delete,
--    softwareoathauthenticationmethod-delete). Unlike #1899's fan-out (which deletes
--    ALL of a user's re-registerable methods), this template targets exactly ONE
--    already-known {{methodId}}, so the real mechanism is: GET the specific method
--    (authenticationmethod-get, a real generic-path v1.0 GET that returns the
--    polymorphic @odata.type) to learn its type, then DELETE through that type's
--    real collection. This migration updates the stored row's endpoint/method to the
--    real first call (the GET) and documents the typed DELETE that follows it, since
--    it can't be expressed as a single {endpoint,method,body} row — the actual
--    fan-out is implemented in code as runRemoveAuthMethodAgainstTenant()
--    (workflow-executor.ts), keyed off this exact template_id, mirroring
--    runForceMfaReregistrationAgainstTenant() from #1899.
--
-- Note action.update-manager (PUT /users/{id}/manager/$ref) is explicitly NOT part
-- of this class — PUT is genuinely correct there for a single-valued navigation
-- property reference — and is untouched by this migration.
--
-- None of the four currently has a graph-write-permissions.ts rule (unmapped, same
-- as #2855's two rows were before #1901), so no permission-table rule change is
-- required by this migration.

BEGIN;

UPDATE baseline_action_templates
SET
  method = 'DELETE',
  updated_at = now()
WHERE template_id = 'action.delete-group'
  AND method = 'PUT'
  AND endpoint = '/groups/{{groupId}}';

UPDATE baseline_action_templates
SET
  method = 'DELETE',
  updated_at = now()
WHERE template_id = 'action.delete-user'
  AND method = 'PUT'
  AND endpoint = '/users/{{userId}}';

UPDATE baseline_action_templates
SET
  method = 'DELETE',
  updated_at = now()
WHERE template_id = 'action.unenroll-device'
  AND method = 'PUT'
  AND endpoint = '/deviceManagement/managedDevices/{{deviceId}}';

UPDATE baseline_action_templates
SET
  endpoint = '/users/{{userId}}/authentication/methods/{{methodId}}',
  method = 'GET',
  body_template = '{}'::jsonb,
  description =
    'Removes one specific authentication method the real way: GETs the method ' ||
    '(GET /users/{id}/authentication/methods/{id}) to learn its real @odata.type, ' ||
    'then DELETEs it through that type''s real typed collection (phoneMethods, ' ||
    'microsoftAuthenticatorMethods or softwareOathMethods) -- there is no v1.0 ' ||
    'collection-level DELETE on the generic /authentication/methods/{id} path. This ' ||
    'is a fan-out (one GET + one typed DELETE), executed by ' ||
    'runRemoveAuthMethodAgainstTenant() in workflow-executor.ts rather than a single ' ||
    'templated call -- see Git #2875, same class of gap #1899 fixed.',
  success_criteria = '{"expectStatus": 200}'::jsonb,
  updated_at = now()
WHERE template_id = 'action.remove-auth-method'
  AND method = 'PUT'
  AND endpoint = '/users/{{userId}}/authentication/methods/{{methodId}}';

-- Self-mark this migration as run (Simulator Studio Migrations tree, #497).
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-04-delete-group-user-device-authmethod-fix-2875.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
