-- 2026-09-04-mfa-reregistration-real-endpoint-1899.sql
-- Git #1899 — mfa-enforcement-v1 step 1's real Graph mechanism.
--
-- action.require-security-info-reregistration previously stored
-- `POST /users/{{userId}}/authentication/methods`, which is not a real, writable
-- Graph v1.0 collection (confirmed against Microsoft Learn: authenticationmethods-
-- overview, phoneauthenticationmethod-delete, softwareoathauthenticationmethod-delete,
-- microsoftauthenticatorauthenticationmethod-delete). This was already flagged as a
-- known defect in graph-write-permissions.ts's #1875 permission table ("the endpoint
-- defect filed alongside #1875"), never fixed.
--
-- The real, documented mechanism — the same one the Entra admin center's own
-- "Require re-register MFA" button uses — is a fan-out: list the user's current
-- authentication methods, then DELETE each phone / Microsoft Authenticator /
-- software OATH method individually. Once none remain, Entra prompts the user to
-- register a new method at next sign-in requiring strong auth. FIDO2, Windows
-- Hello for Business, certificate-based auth and the password method are
-- deliberately left alone.
--
-- baseline_action_templates' {endpoint, method, bodyTemplate} row model executes
-- as exactly ONE Graph call (see workflow-executor.ts's runBaselineTemplateAgainstTenant),
-- so this fan-out cannot be expressed as a single stored row. It is now special-cased
-- in code: runForceMfaReregistrationAgainstTenant(), keyed off this exact template_id.
-- This migration updates the row's endpoint/method/description so what's STORED and
-- PREVIEWED (Simulator Studio's confirm step, resolveBaselineTemplateRequest) matches
-- the real first call the fan-out makes — a GET listing the user's methods — rather
-- than the fictitious POST, and documents the deletes that follow it in the
-- description text since they cannot be expressed as endpoint/method/body fields.

BEGIN;

UPDATE baseline_action_templates
SET
  endpoint = '/users/{{userId}}/authentication/methods',
  method = 'GET',
  body_template = '{}'::jsonb,
  description =
    'Forces MFA re-registration the real way: lists the user''s current authentication ' ||
    'methods (GET /users/{id}/authentication/methods), then DELETEs each phone, Microsoft ' ||
    'Authenticator and software OATH method individually — the same mechanism the Entra ' ||
    'admin center''s own "Require re-register MFA" button uses. FIDO2, Windows Hello for ' ||
    'Business, certificate-based auth and the password method are left alone. This is a ' ||
    'fan-out (one GET + N DELETEs), executed by runForceMfaReregistrationAgainstTenant() ' ||
    'in workflow-executor.ts rather than a single templated call — see Git #1899.',
  success_criteria = '{"expectStatus": 200}'::jsonb,
  updated_at = now()
WHERE template_id = 'action.require-security-info-reregistration';

-- Self-mark this migration as run (Simulator Studio Migrations tree, #497).
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-04-mfa-reregistration-real-endpoint-1899.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
