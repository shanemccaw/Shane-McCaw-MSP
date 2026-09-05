-- Git #2939: action.assign-autopilot-profile targets a beta-only Graph resource
-- with a body shape the assign action does not accept.
--
-- Two independent defects, same class as #2855's endpoint/method fixes:
--
-- 1. windowsAutopilotDeploymentProfile is documented ONLY on the beta Microsoft
--    Graph moniker (v1.0 redirects to beta; the Methods table lists just Get and
--    assign). The stored row used a v1.0-relative endpoint, which 404s at the
--    transport before any permission is evaluated. Corrected to the absolute
--    beta URL — graphWriteForTenant (artifacts/api-server/src/lib/graph.ts) now
--    accepts an absolute https://graph.microsoft.com/{v1.0,beta}/... URL the
--    same way graphFetchForTenant already did per #1796.
--
-- 2. The `assign` action's only documented parameter is `deviceIds` (String
--    collection) — see
--    https://learn.microsoft.com/en-us/graph/api/intune-enrollment-windowsautopilotdeploymentprofile-assign
--    The stored body was a groupAssignmentTarget shape, which belongs to the
--    profile's `assignments` relationship, not to this action, and would be
--    rejected even against the beta endpoint. Corrected to {"deviceIds": [...]}.
--
-- Additive/corrective data change only, no schema change. Impact today: none at
-- runtime — no Config Pack wires this template (see the issue body).

UPDATE baseline_action_templates
SET
  endpoint = 'https://graph.microsoft.com/beta/deviceManagement/windowsAutopilotDeploymentProfiles/{{profileId}}/assign',
  body_template = '{"deviceIds": ["{{deviceId}}"]}'::jsonb,
  required_variables = '["profileId", "deviceId"]'::jsonb,
  updated_at = now()
WHERE template_id = 'action.assign-autopilot-profile';

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-04-assign-autopilot-profile-endpoint-body-fix-2939.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
