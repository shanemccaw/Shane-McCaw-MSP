-- ────────────────────────────────────────────────────────────────────────────────
-- 0196: Data correction — baseline_action_templates placeholder syntax
--
-- The 0195 quick-start seed wrote variable placeholders in SINGLE-brace form
-- ({tenantDomain}, {generatedPassword}, ...). The Workflow Engine's template
-- resolver (interp() in workflow-executor.ts, shared by execute_baseline_template
-- and the admin Testing endpoint via runBaselineTemplateAgainstTenant) only
-- substitutes DOUBLE-brace {{variable}} tokens, so the seeded bodies would have
-- been sent to Microsoft Graph with literal "{tenantDomain}" strings.
--
-- This migration rewrites the affected bodies/endpoints to {{variable}} form.
-- Variable names are unchanged, and the two step-output-dependent variables
-- ({{breakglassUserId}}, {{principalId}}) deliberately stay FLAT payload keys:
-- the Config Pack orchestrator stamps them into the run payload from the
-- breakglass-user-create step's output, which keeps the templates usable from
-- the admin Testing endpoint (flat variables) as well.
--
-- Each UPDATE is guarded by a LIKE match on the broken single-brace token so the
-- migration is idempotent and never clobbers a template an admin has already
-- corrected or edited. schema_version is bumped to mirror the PATCH-endpoint
-- behaviour for body/endpoint changes.
-- ────────────────────────────────────────────────────────────────────────────────

-- 1.2 Configure Tenant Branding — endpoint {organizationId}; body {tenantName}, {tenantDomain}
UPDATE "baseline_action_templates"
SET
  "endpoint" = 'https://graph.microsoft.com/v1.0/organization/{{organizationId}}/branding',
  "body_template" = '{
    "signInPageText": "Welcome to {{tenantName}}",
    "usernameHintText": "{{tenantDomain}}",
    "backgroundColor": "#003366",
    "headerBackgroundColor": "#003366"
  }'::jsonb,
  "schema_version" = "schema_version" + 1,
  "updated_at" = NOW()
WHERE "template_id" = 'tenant-branding-configure'
  AND "endpoint" LIKE '%/organization/{organizationId}/branding%';

-- 1.3 Create Break-Glass Account — body {tenantDomain}, {generatedPassword}
UPDATE "baseline_action_templates"
SET
  "body_template" = '{
    "accountEnabled": true,
    "displayName": "Emergency Access - Break Glass",
    "mailNickname": "breakglass",
    "userPrincipalName": "breakglass@{{tenantDomain}}",
    "passwordProfile": {
      "forceChangePasswordNextSignIn": true,
      "password": "{{generatedPassword}}"
    }
  }'::jsonb,
  "schema_version" = "schema_version" + 1,
  "updated_at" = NOW()
WHERE "template_id" = 'breakglass-user-create'
  AND "body_template"::text LIKE '%breakglass@{tenantDomain}%';

-- 1.4 Assign Global Administrator Role — body {breakglassUserId}
UPDATE "baseline_action_templates"
SET
  "body_template" = '{
    "@odata.type": "#microsoft.graph.unifiedRoleAssignment",
    "roleDefinitionId": "62e90394-69f5-4237-9190-012177145e10",
    "principalId": "{{breakglassUserId}}",
    "directoryScopeId": "/"
  }'::jsonb,
  "schema_version" = "schema_version" + 1,
  "updated_at" = NOW()
WHERE "template_id" = 'breakglass-assign-global-admin'
  AND "body_template"::text LIKE '%"{breakglassUserId}"%';

-- 1.5 Configure PIM Role Assignment Eligibility — body {roleDefinitionId}, {principalId}, {currentDateTime}
UPDATE "baseline_action_templates"
SET
  "body_template" = '{
    "action": "adminAssign",
    "roleDefinitionId": "{{roleDefinitionId}}",
    "principalId": "{{principalId}}",
    "directoryScopeId": "/",
    "justification": "PIM eligible assignment",
    "scheduleInfo": {
      "startDateTime": "{{currentDateTime}}",
      "expiration": {
        "type": "afterDuration",
        "duration": "P90D"
      }
    }
  }'::jsonb,
  "schema_version" = "schema_version" + 1,
  "updated_at" = NOW()
WHERE "template_id" = 'pim-role-assignment-rules'
  AND "body_template"::text LIKE '%"{principalId}"%';

-- 2.3 Configure Group Naming Policy — body {tenantPrefix}
UPDATE "baseline_action_templates"
SET
  "body_template" = '{
    "templateId": "62375ab9-6b52-47ed-826b-58e47e0e304b",
    "values": [
      {
        "name": "PrefixSuffixNamingRequirement",
        "value": "[{{tenantPrefix}}][GroupName]"
      },
      {
        "name": "CustomBlockedWordsList",
        "value": "admin,administrator,root,test"
      }
    ]
  }'::jsonb,
  "schema_version" = "schema_version" + 1,
  "updated_at" = NOW()
WHERE "template_id" = 'group-naming-policy'
  AND "body_template"::text LIKE '%[{tenantPrefix}][GroupName]%';

-- entra-security-defaults-enable, guest-access-restrict and
-- conditional-access-baseline contain no placeholders — untouched.
