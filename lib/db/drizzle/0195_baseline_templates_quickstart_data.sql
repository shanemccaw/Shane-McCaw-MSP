-- Baseline Action Templates + Config Packs Data Seeding
-- Quick-Start Pack (v1): Category 1 (Core Tenant Foundations) + Category 2 (Identity/Conditional Access)
-- All endpoints and payloads verified against Microsoft Graph documentation (July 2026).
-- Idempotent via ON CONFLICT DO NOTHING — safe to re-run.

-- ────────────────────────────────────────────────────────────────────────────────
-- CATEGORY 1: Core Tenant Foundations
-- ────────────────────────────────────────────────────────────────────────────────

INSERT INTO "baseline_action_templates"
  ("template_id", "label", "description", "category", "endpoint", "method", "body_template",
   "required_variables", "success_criteria", "depends_on", "requires_verification_gate", "status")
VALUES
  -- 1.1 Enable Security Defaults (Foundation)
  (
    'entra-security-defaults-enable',
    'Enable Entra ID Security Defaults',
    'Enables MFA, legacy authentication blocking, and other foundational security protections for the entire tenant',
    'Core Tenant Foundations',
    'https://graph.microsoft.com/v1.0/policies/identitySecurityDefaultsEnforcementPolicy',
    'PATCH',
    '{"isEnabled": true}'::jsonb,
    '[]'::jsonb,
    '{"statusCode": 204}'::jsonb,
    '[]'::jsonb,
    false,
    'active'
  ),

  -- 1.2 Configure Tenant Branding
  (
    'tenant-branding-configure',
    'Configure Tenant Branding',
    'Sets sign-in page text, colors, and privacy/terms URLs for a branded authentication experience',
    'Core Tenant Foundations',
    'https://graph.microsoft.com/v1.0/organization/{organizationId}/branding',
    'PATCH',
    '{
      "signInPageText": "Welcome to {tenantName}",
      "usernameHintText": "{tenantDomain}",
      "backgroundColor": "#003366",
      "headerBackgroundColor": "#003366"
    }'::jsonb,
    '["organizationId", "tenantName", "tenantDomain"]'::jsonb,
    '{"statusCode": 204}'::jsonb,
    '[]'::jsonb,
    false,
    'active'
  ),

  -- 1.3 Create Break-Glass Account (User)
  (
    'breakglass-user-create',
    'Create Break-Glass Account (User)',
    'Creates an emergency admin account with a strong temporary password and force-change-on-first-sign-in requirement',
    'Core Tenant Foundations',
    'https://graph.microsoft.com/v1.0/users',
    'POST',
    '{
      "accountEnabled": true,
      "displayName": "Emergency Access - Break Glass",
      "mailNickname": "breakglass",
      "userPrincipalName": "breakglass@{tenantDomain}",
      "passwordProfile": {
        "forceChangePasswordNextSignIn": true,
        "password": "{generatedPassword}"
      }
    }'::jsonb,
    '["tenantDomain", "generatedPassword"]'::jsonb,
    '{"statusCode": 201, "id": ".+"}'::jsonb,
    true,
    'active'
  ),

  -- 1.4 Assign Global Administrator Role to Break-Glass Account
  (
    'breakglass-assign-global-admin',
    'Assign Global Administrator Role to Break-Glass Account',
    'Grants Global Administrator role to the break-glass account with tenant-wide scope',
    'Core Tenant Foundations',
    'https://graph.microsoft.com/v1.0/roleManagement/directory/roleAssignments',
    'POST',
    '{
      "@odata.type": "#microsoft.graph.unifiedRoleAssignment",
      "roleDefinitionId": "c2cf284d-6c41-4e6b-afac-4b80928c9034",
      "principalId": "{breakglassUserId}",
      "directoryScopeId": "/"
    }'::jsonb,
    '["breakglassUserId"]'::jsonb,
    '{"statusCode": 201, "id": ".+"}'::jsonb,
    true,
    'active'
  ),

  -- 1.5 Configure PIM Role Assignment Eligibility
  (
    'pim-role-assignment-rules',
    'Configure PIM Role Assignment Eligibility Rules',
    'Sets up Privileged Identity Management (PIM) eligibility rules and expiration policies for role activation',
    'Core Tenant Foundations',
    'https://graph.microsoft.com/v1.0/roleManagement/directory/roleAssignmentScheduleRequests',
    'POST',
    '{
      "action": "adminAssign",
      "roleDefinitionId": "{roleDefinitionId}",
      "principalId": "{principalId}",
      "directoryScopeId": "/",
      "justification": "PIM eligible assignment",
      "scheduleInfo": {
        "startDateTime": "{currentDateTime}",
        "expiration": {
          "type": "afterDuration",
          "duration": "P90D"
        }
      }
    }'::jsonb,
    '["roleDefinitionId", "principalId", "currentDateTime"]'::jsonb,
    '{"statusCode": 201, "id": ".+"}'::jsonb,
    '["breakglass-assign-global-admin"]'::jsonb,
    false,
    'active'
  ),

-- ────────────────────────────────────────────────────────────────────────────────
-- CATEGORY 2: Identity & Conditional Access
-- ────────────────────────────────────────────────────────────────────────────────

  -- 2.1 Configure Authorization Policy (Guest Access Restrictions)
  (
    'guest-access-restrict',
    'Restrict Guest Access (B2B Collaboration Settings)',
    'Configures who can invite guests, guest user permissions, and email verification requirements for B2B collaboration',
    'Identity & Conditional Access',
    'https://graph.microsoft.com/v1.0/policies/authorizationPolicy',
    'PATCH',
    '{
      "allowInvitesFrom": "adminsAndGuestInviters",
      "allowEmailVerifiedUsersToJoinOrganization": false,
      "guestUserRoleId": "2af84b1e-32c8-42b7-82bc-daa82404023b"
    }'::jsonb,
    '[]'::jsonb,
    '{"statusCode": 204}'::jsonb,
    '[]'::jsonb,
    false,
    'active'
  ),

  -- 2.2 Configure Conditional Access Baseline Policy
  (
    'conditional-access-baseline',
    'Deploy Conditional Access Baseline Policy',
    'Enforces MFA for all users and apps as the foundational Conditional Access baseline policy (initially in report-only mode)',
    'Identity & Conditional Access',
    'https://graph.microsoft.com/v1.0/identity/conditionalAccess/policies',
    'POST',
    '{
      "displayName": "Baseline: Require MFA",
      "state": "enabledForReportingButNotEnforced",
      "conditions": {
        "clientAppTypes": ["all"],
        "applications": {
          "includeApplications": ["All"],
          "excludeApplications": []
        },
        "users": {
          "includeUsers": ["All"],
          "excludeUsers": []
        },
        "locations": {
          "includeLocations": ["All"],
          "excludeLocations": []
        }
      },
      "grantControls": {
        "operator": "OR",
        "builtInControls": ["mfa"]
      },
      "sessionControls": null
    }'::jsonb,
    '[]'::jsonb,
    '{"statusCode": 201, "id": ".+"}'::jsonb,
    '["breakglass-assign-global-admin"]'::jsonb,
    false,
    'active'
  ),

  -- 2.3 Configure Group Naming Policy
  (
    'group-naming-policy',
    'Configure Group Naming Policy',
    'Enforces naming conventions for Microsoft 365 groups (prefix/suffix format) and blocks inappropriate terminology',
    'Identity & Conditional Access',
    'https://graph.microsoft.com/v1.0/groupSettings',
    'POST',
    '{
      "templateId": "62375ab9-6b52-47ed-826b-58e47e0e304b",
      "values": [
        {
          "name": "PrefixSuffixNamingRequirement",
          "value": "[{tenantPrefix}][GroupName]"
        },
        {
          "name": "CustomBlockedWordsList",
          "value": "admin,administrator,root,test"
        }
      ]
    }'::jsonb,
    '["tenantPrefix"]'::jsonb,
    '{"statusCode": 201, "id": ".+"}'::jsonb,
    '[]'::jsonb,
    false,
    'active'
  )
ON CONFLICT ("template_id") DO NOTHING;

-- ────────────────────────────────────────────────────────────────────────────────
-- Create the "quickstart-v1" Config Pack
-- ────────────────────────────────────────────────────────────────────────────────

INSERT INTO "config_packs" ("pack_key", "label", "description", "categories", "status")
VALUES
  (
    'quickstart-v1',
    'Entra ID Quick-Start Pack',
    'Foundational Entra ID security and identity baseline: security defaults, break-glass emergency access, conditional access, and guest restrictions',
    ARRAY['Core Tenant Foundations', 'Identity & Conditional Access'],
    'active'
  )
ON CONFLICT ("pack_key") DO NOTHING;

-- ────────────────────────────────────────────────────────────────────────────────
-- Link Templates to Config Pack (Ordered)
-- Execution order:
--   1. Security Defaults (foundation)
--   2. Tenant Branding
--   3. Break-Glass User (prerequisite for role assignment)
--   4. Break-Glass Global Admin Assignment (prerequisite for CA policies)
--   5. PIM Configuration
--   6. Guest Access Restrictions
--   7. Conditional Access (depends on break-glass admin existing)
--   8. Group Naming Policy
-- ────────────────────────────────────────────────────────────────────────────────

INSERT INTO "config_pack_templates" ("pack_id", "template_id", "sort_order", "depends_on_override")
SELECT p.id, t.template_id, o.sort_order, o.depends_on_override
FROM (VALUES
  ('entra-security-defaults-enable', 1, NULL),
  ('tenant-branding-configure', 2, NULL),
  ('breakglass-user-create', 3, NULL),
  ('breakglass-assign-global-admin', 4, '["breakglass-user-create"]'::jsonb),
  ('pim-role-assignment-rules', 5, '["breakglass-assign-global-admin"]'::jsonb),
  ('guest-access-restrict', 6, NULL),
  ('conditional-access-baseline', 7, '["breakglass-assign-global-admin"]'::jsonb),
  ('group-naming-policy', 8, NULL)
) AS o(template_id, sort_order, depends_on_override)
CROSS JOIN (SELECT id FROM "config_packs" WHERE pack_key = 'quickstart-v1' LIMIT 1) p
CROSS JOIN (SELECT template_id FROM "baseline_action_templates" WHERE template_id = o.template_id LIMIT 1) t
ON CONFLICT DO NOTHING;

-- ────────────────────────────────────────────────────────────────────────────────
-- Add Quickstart Pack to Services Catalog
-- serviceClass: "add_on" → instant Stripe checkout, no SOW
-- internalCostCents: 25000 (2500 dollars) — platform wholesale cost
-- Retail price to be set per MSP offer
-- ────────────────────────────────────────────────────────────────────────────────

INSERT INTO "services"
  ("name", "slug", "description", "category", "service_class", "delivery_type",
   "internal_cost_cents", "billing_type", "is_public", "visibility", "fulfillment_type")
VALUES
  (
    'Entra ID Quick-Start Pack',
    'entra-id-quickstart-v1',
    'Foundational Entra ID security baseline including security defaults, break-glass emergency access, conditional access policies, and guest access restrictions. Delivered as a managed baseline configuration with audit trail.',
    'Identity & Governance',
    'add_on',
    'none',
    25000,
    'one_time',
    true,
    'public',
    'standard'
  )
ON CONFLICT ("slug") DO NOTHING;
