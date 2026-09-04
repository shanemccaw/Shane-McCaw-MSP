-- #2760 — Close the real coverage gap on the policy surface (Feature #1128).
--
-- 18 real monitor_checks rows for config_resources whose surface = 'policy',
-- availability = 'available_now' and check_coverage_count = 0 (measured by #1848,
-- re-confirmed live 2026-09-04). Each check's endpoint/mapping/severity_rules were
-- verified against a real GET to the testbed tenant (mccawsoft2.onmicrosoft.com,
-- tenants.id=1, app-only) before being written here — see build-journal/2760.md for
-- the real observed response shapes. No generic-existence checks (#2184 discipline):
-- every mapping reads the actual fields the label names.
--
-- 3 of the original 21 resources are NOT covered by this migration, for real reasons
-- confirmed live rather than assumed:
--   - graph:beta:/policies/accessReviewPolicy — 403 "does not have a valid license"
--     on the testbed. Real license gap, not a permissions/model problem.
--   - graph:beta:/policies/b2cAuthenticationMethodsPolicy — 403 AADB2C, "not an Azure
--     AD B2C directory". Structurally inapplicable to a non-B2C tenant.
--   - graph:v1.0:/policies/authenticationMethodsPolicy/authenticationMethodConfigurations
--     — the modeled graph_path itself 400s as a standalone collection GET in both
--     v1.0 and beta ("Resource not found for segment"); it is only reachable
--     embedded under the parent authenticationMethodsPolicy response, or per-item by
--     a known method id. policy:authentication-methods-policy below reads the SMS/
--     Voice method states off the parent response via valueWhere(), but that maps
--     coverage onto the PARENT resource_key, not this child one, honestly.
-- All three are filed as findings under #1128 rather than faked.

BEGIN;

INSERT INTO monitor_checks (
  key, label, description, endpoint, method,
  properties, mapping, severity_rules,
  engines, frequency, requires_customer_script, status, executor_type
) VALUES
(
  'policy:external-identities-policy',
  'External Identities Policy',
  'Whether B2B/B2C external identities'' data is automatically removed once the identity is deleted, and whether external identities can self-service leave the organization.',
  '/policies/externalIdentitiesPolicy',
  'GET',
  '[]'::jsonb,
  '[{"sourceField":"allowExternalIdentitiesToLeave","targetField":"externalIdentitiesCanLeave","transform":"first"},{"sourceField":"allowDeletedIdentitiesDataRemoval","targetField":"deletedIdentityDataRemovalEnabled","transform":"first"}]'::jsonb,
  '[{"severity":"warning","expression":"deletedIdentityDataRemovalEnabled == false","label":"Deleted external identities'' data is not automatically removed — retained indefinitely, a data-retention/GDPR exposure"}]'::jsonb,
  '["governance","compliance"]'::jsonb,
  'daily',
  false,
  'active',
  'graph'
),
(
  'policy:terms-of-use-agreements',
  'Terms of Use Agreement Configuration',
  'Published Terms of Use agreements checked for weak acceptance controls: not requiring the user to view the document before accepting, and no periodic re-acceptance requirement.',
  '/agreements?$select=id,displayName,isViewingBeforeAcceptanceRequired,userReacceptRequiredFrequency',
  'GET',
  '["id"]'::jsonb,
  '[{"sourceField":"value","targetField":"agreementsNotRequiringView","transform":"countWhere(''{{isViewingBeforeAcceptanceRequired}} == false'')"},{"sourceField":"value","targetField":"agreementsWithoutReacceptance","transform":"countWhere(''{{userReacceptRequiredFrequency}} == null || {{userReacceptRequiredFrequency}} == \"\"'')"}]'::jsonb,
  '[{"severity":"warning","expression":"{{agreementsNotRequiringView}} > 0","label":"Terms of Use agreement(s) published without requiring the user to view the document before accepting"},{"severity":"info","expression":"{{agreementsWithoutReacceptance}} > 0","label":"Terms of Use agreement(s) published with no periodic re-acceptance requirement"}]'::jsonb,
  '["governance","compliance"]'::jsonb,
  'daily',
  false,
  'active',
  'graph'
),
(
  'policy:activity-based-timeout',
  'Activity-Based Timeout Policy',
  'Whether a tenant-wide Activity-Based Timeout Policy is configured to automatically sign out idle web sessions.',
  '/policies/activityBasedTimeoutPolicies',
  'GET',
  '["id"]'::jsonb,
  '[{"sourceField":"id","targetField":"activityTimeoutPolicyCount","transform":"count"}]'::jsonb,
  '[{"severity":"info","expression":"{{activityTimeoutPolicyCount}} == 0","label":"No Activity-Based Timeout Policy configured — idle web sessions have no enforced automatic sign-out"}]'::jsonb,
  '["security"]'::jsonb,
  'daily',
  false,
  'active',
  'graph'
),
(
  'policy:admin-consent-workflow',
  'Admin Consent Workflow',
  'Whether the Admin Consent Request Workflow is enabled and has reviewers configured, so blocked app-permission requests have a self-service review path instead of a dead end.',
  '/policies/adminConsentRequestPolicy',
  'GET',
  '[]'::jsonb,
  '[{"sourceField":"isEnabled","targetField":"adminConsentWorkflowEnabled","transform":"first"},{"sourceField":"reviewers","targetField":"adminConsentReviewers","transform":"first"}]'::jsonb,
  '[{"severity":"warning","expression":"adminConsentWorkflowEnabled == false","label":"Admin Consent Workflow is disabled — users blocked by an app-permission request have no self-service path to request review, weakening app-consent governance"},{"severity":"critical","expression":"adminConsentWorkflowEnabled == true && {{adminConsentReviewers}} length== 0","label":"Admin Consent Workflow is enabled but has zero configured reviewers — requests can never be actioned"}]'::jsonb,
  '["governance","security"]'::jsonb,
  'daily',
  false,
  'active',
  'graph'
),
(
  'policy:app-management-policies',
  'Per-Application Management Policies',
  'Custom per-application credential/URI restriction policies (appManagementPolicies) that exist but are not enabled, so the restrictions they define are not enforced.',
  '/policies/appManagementPolicies?$select=id,displayName,isEnabled',
  'GET',
  '["id"]'::jsonb,
  '[{"sourceField":"id","targetField":"appManagementPolicyCount","transform":"count"},{"sourceField":"value","targetField":"disabledAppManagementPolicyCount","transform":"countWhere(''{{isEnabled}} == false'')"}]'::jsonb,
  '[{"severity":"warning","expression":"{{disabledAppManagementPolicyCount}} > 0","label":"One or more app management (credential/URI) restriction policies exist but are not enabled — the restrictions they define are not being enforced"}]'::jsonb,
  '["security","governance"]'::jsonb,
  'daily',
  false,
  'active',
  'graph'
),
(
  'policy:authentication-flows',
  'Authentication Flows Policy — Self-Service Sign-Up',
  'Whether self-service sign-up is enabled, letting external users join the directory without administrator provisioning.',
  '/policies/authenticationFlowsPolicy',
  'GET',
  '[]'::jsonb,
  '[{"sourceField":"selfServiceSignUp.isEnabled","targetField":"selfServiceSignUpEnabled","transform":"first"}]'::jsonb,
  '[{"severity":"warning","expression":"selfServiceSignUpEnabled == true","label":"Self-service sign-up is enabled — external users can join the directory without administrator provisioning, a governance and attack-surface risk"}]'::jsonb,
  '["security","governance"]'::jsonb,
  'daily',
  false,
  'active',
  'graph'
),
(
  'policy:authentication-methods-policy',
  'Authentication Methods Policy',
  'The tenant-wide Authentication Methods Policy: migration state off legacy per-user MFA, and whether phishable methods (SMS, Voice) are enabled tenant-wide.',
  '/policies/authenticationMethodsPolicy',
  'GET',
  '[]'::jsonb,
  '[{"sourceField":"policyMigrationState","targetField":"authMethodsPolicyMigrationState","transform":"first"},{"sourceField":"authenticationMethodConfigurations","targetField":"smsMethodState","transform":"valueWhere(''id'',''Sms'',''state'')"},{"sourceField":"authenticationMethodConfigurations","targetField":"voiceMethodState","transform":"valueWhere(''id'',''Voice'',''state'')"}]'::jsonb,
  '[{"severity":"warning","expression":"authMethodsPolicyMigrationState != ''migrationComplete''","label":"Migration from legacy per-user MFA to the Authentication Methods Policy is not complete — legacy per-user MFA settings may still be in effect for some users"},{"severity":"warning","expression":"smsMethodState == ''enabled''","label":"SMS is enabled as an authentication method tenant-wide — SMS-based MFA is phishable and vulnerable to SIM-swap attacks"},{"severity":"warning","expression":"voiceMethodState == ''enabled''","label":"Voice call is enabled as an authentication method tenant-wide — voice-based MFA is phishable and vulnerable to social-engineering/spoofing attacks"}]'::jsonb,
  '["security"]'::jsonb,
  'daily',
  false,
  'active',
  'graph'
),
(
  'policy:authentication-strength-policies',
  'Custom Authentication Strength Policies',
  'Whether any custom Authentication Strength policy exists, so Conditional Access can require an organization-tailored (e.g. phishing-resistant-only) combination rather than only Microsoft''s built-in combinations, which include SMS/Voice as satisfying MFA.',
  '/policies/authenticationStrengthPolicies?$select=id,displayName,policyType',
  'GET',
  '[]'::jsonb,
  '[{"sourceField":"policyType","targetField":"customAuthStrengthPolicyCount","transform":"countWhere(\"{{policyType}} == ''custom''\")"}]'::jsonb,
  '[{"severity":"info","expression":"{{customAuthStrengthPolicyCount}} == 0","label":"No custom Authentication Strength policy defined — Conditional Access can only require Microsoft''s built-in combinations (which include SMS/Voice as satisfying MFA), not an organization-tailored phishing-resistant requirement"}]'::jsonb,
  '["security"]'::jsonb,
  'daily',
  false,
  'active',
  'graph'
),
(
  'policy:claims-mapping-policies',
  'Custom Claims-Mapping Policies',
  'Whether any custom token claims-mapping policy exists — an advanced, rarely-needed feature that alters token contents from Entra ID defaults.',
  '/policies/claimsMappingPolicies?$select=id,displayName',
  'GET',
  '["id"]'::jsonb,
  '[{"sourceField":"id","targetField":"claimsMappingPolicyCount","transform":"count"}]'::jsonb,
  '[{"severity":"info","expression":"{{claimsMappingPolicyCount}} > 0","label":"Custom claims-mapping policy configured — token contents have been altered from Entra ID defaults; verify the mapping doesn''t expose or omit security-relevant claims"}]'::jsonb,
  '["security","governance"]'::jsonb,
  'daily',
  false,
  'active',
  'graph'
),
(
  'policy:cross-tenant-access-default',
  'Cross-Tenant Access Policy — Default',
  'The tenant-wide default cross-tenant access policy: whether inbound B2B collaboration is open to all external users, and whether MFA claims from external tenants are trusted.',
  '/policies/crossTenantAccessPolicy/default',
  'GET',
  '[]'::jsonb,
  '[{"sourceField":"b2bCollaborationInbound.usersAndGroups.accessType","targetField":"b2bInboundAccessType","transform":"first"},{"sourceField":"b2bCollaborationOutbound.usersAndGroups.accessType","targetField":"b2bOutboundAccessType","transform":"first"},{"sourceField":"inboundTrust.isMfaAccepted","targetField":"inboundTrustAcceptsMfaClaim","transform":"first"}]'::jsonb,
  '[{"severity":"warning","expression":"b2bInboundAccessType == ''allowed''","label":"The default cross-tenant access policy allows B2B collaboration inbound from ALL external users and groups, with no restriction"},{"severity":"info","expression":"inboundTrustAcceptsMfaClaim == false","label":"The default cross-tenant access policy does not trust MFA claims from external tenants — B2B guests are re-prompted for MFA instead of inheriting their home tenant''s MFA state"}]'::jsonb,
  '["security","governance"]'::jsonb,
  'daily',
  false,
  'active',
  'graph'
),
(
  'policy:cross-tenant-m365-capabilities',
  'Cross-Tenant Access — Default M365 App Capabilities',
  'Custom Microsoft 365 app cross-tenant capability restrictions (Teams/OneDrive cross-cloud collaboration) that override the tenant default.',
  '/policies/crossTenantAccessPolicy/default/m365Capabilities',
  'GET',
  '["id"]'::jsonb,
  '[{"sourceField":"id","targetField":"m365CapabilityRuleCount","transform":"count"}]'::jsonb,
  '[{"severity":"info","expression":"{{m365CapabilityRuleCount}} > 0","label":"Custom Microsoft 365 cross-tenant capability restriction(s) configured — review them for correctness, since they override the tenant default"}]'::jsonb,
  '["governance"]'::jsonb,
  'daily',
  false,
  'active',
  'graph'
),
(
  'policy:cross-tenant-partners',
  'Cross-Tenant Access — Partner Overrides',
  'Whether any partner-specific cross-tenant access override exists — without one, every external tenant is governed solely by the default policy, with no tightened restriction for a specific partner.',
  '/policies/crossTenantAccessPolicy/partners?$select=tenantId',
  'GET',
  '["tenantId"]'::jsonb,
  '[{"sourceField":"tenantId","targetField":"partnerOverrideCount","transform":"count"}]'::jsonb,
  '[{"severity":"info","expression":"{{partnerOverrideCount}} == 0","label":"No partner-specific cross-tenant access overrides configured — every external tenant is governed solely by the default policy"}]'::jsonb,
  '["governance"]'::jsonb,
  'daily',
  false,
  'active',
  'graph'
),
(
  'policy:cross-tenant-identity-sync-template',
  'Multi-Tenant Org Identity Synchronization Template',
  'The multi-tenant organization identity synchronization template''s default inbound sync setting for new/existing partner tenants.',
  '/policies/crossTenantAccessPolicy/templates/multiTenantOrganizationIdentitySynchronization',
  'GET',
  '[]'::jsonb,
  '[{"sourceField":"userSyncInbound.isSyncAllowed","targetField":"identitySyncInboundAllowed","transform":"first"}]'::jsonb,
  '[{"severity":"warning","expression":"identitySyncInboundAllowed == true","label":"Multi-tenant organization identity synchronization is allowed inbound by template default — partner tenants in the same multi-tenant org can sync identity objects into this directory"}]'::jsonb,
  '["governance","security"]'::jsonb,
  'daily',
  false,
  'active',
  'graph'
),
(
  'policy:default-app-management-policy',
  'Default App Management Policy',
  'Whether the Microsoft-managed tenant-wide default app management policy — the baseline restriction on application/service-principal credential lifetimes — is enabled.',
  '/policies/defaultAppManagementPolicy',
  'GET',
  '[]'::jsonb,
  '[{"sourceField":"isEnabled","targetField":"defaultAppManagementPolicyEnabled","transform":"first"}]'::jsonb,
  '[{"severity":"critical","expression":"defaultAppManagementPolicyEnabled == false","label":"The tenant-wide default app management policy is disabled — Microsoft''s baseline restrictions on application/service-principal credential lifetimes are not being enforced"}]'::jsonb,
  '["security"]'::jsonb,
  'daily',
  false,
  'active',
  'graph'
),
(
  'policy:home-realm-discovery',
  'Home Realm Discovery Policies',
  'Whether any Home Realm Discovery policy exists — these control sign-in domain routing to federated identity providers, and a maliciously altered one can silently redirect authentication for a domain.',
  '/policies/homeRealmDiscoveryPolicies?$select=id,displayName',
  'GET',
  '["id"]'::jsonb,
  '[{"sourceField":"id","targetField":"hrdPolicyCount","transform":"count"}]'::jsonb,
  '[{"severity":"warning","expression":"{{hrdPolicyCount}} > 0","label":"Home Realm Discovery polic(ies) configured — these control sign-in domain routing to federated identity providers; review their rules for legitimacy"}]'::jsonb,
  '["security"]'::jsonb,
  'daily',
  false,
  'active',
  'graph'
),
(
  'policy:security-defaults',
  'Security Defaults',
  'Whether Microsoft''s Security Defaults baseline (MFA enforcement, legacy-auth block, and other basic identity protections) is enabled.',
  '/policies/identitySecurityDefaultsEnforcementPolicy',
  'GET',
  '[]'::jsonb,
  '[{"sourceField":"isEnabled","targetField":"securityDefaultsEnabled","transform":"first"}]'::jsonb,
  '[{"severity":"warning","expression":"securityDefaultsEnabled == false","label":"Security Defaults is disabled — confirm equivalent baseline MFA/legacy-auth-block protection exists via Conditional Access, since none is currently enforced by this policy"}]'::jsonb,
  '["security"]'::jsonb,
  'daily',
  false,
  'active',
  'graph'
),
(
  'policy:token-issuance-policies',
  'Custom Token Issuance Policies',
  'Whether any custom Token Issuance policy exists — an advanced feature that customizes SAML token signing/attributes for specific applications.',
  '/policies/tokenIssuancePolicies?$select=id,displayName',
  'GET',
  '["id"]'::jsonb,
  '[{"sourceField":"id","targetField":"tokenIssuancePolicyCount","transform":"count"}]'::jsonb,
  '[{"severity":"info","expression":"{{tokenIssuancePolicyCount}} > 0","label":"Custom Token Issuance policy configured — SAML token signing/attribute behavior has been customized from Entra ID defaults for specific application(s); verify it doesn''t weaken token security"}]'::jsonb,
  '["security"]'::jsonb,
  'daily',
  false,
  'active',
  'graph'
),
(
  'policy:token-lifetime-policies',
  'Custom Token Lifetime Policies',
  'Whether any custom Token Lifetime policy exists — extended token/refresh-token validity increases the blast radius of a stolen token.',
  '/policies/tokenLifetimePolicies?$select=id,displayName',
  'GET',
  '["id"]'::jsonb,
  '[{"sourceField":"id","targetField":"tokenLifetimePolicyCount","transform":"count"}]'::jsonb,
  '[{"severity":"warning","expression":"{{tokenLifetimePolicyCount}} > 0","label":"Custom Token Lifetime policy configured — an excessively long token/refresh-token lifetime increases the blast radius of a stolen token; review its duration"}]'::jsonb,
  '["security"]'::jsonb,
  'daily',
  false,
  'active',
  'graph'
)
ON CONFLICT (key) DO NOTHING;

-- Wire each new check into the packages that already carry comparable policy-surface
-- identity checks (mirrors identity:cross-tenant-access's real distribution), appended
-- after each package's current last sort_order.
INSERT INTO monitoring_package_checks (package_key, check_key, sort_order)
SELECT v.package_key, v.check_key,
  COALESCE((SELECT MAX(mpc2.sort_order) FROM monitoring_package_checks mpc2 WHERE mpc2.package_key = v.package_key), 0)
    + row_number() OVER (PARTITION BY v.package_key ORDER BY v.check_key)
FROM (VALUES
  ('core:enhanced-monitoring', 'policy:external-identities-policy'),
  ('core:growth', 'policy:external-identities-policy'),
  ('core:premier', 'policy:external-identities-policy'),
  ('detail:full-item-collection', 'policy:external-identities-policy'),
  ('core:enhanced-monitoring', 'policy:terms-of-use-agreements'),
  ('core:growth', 'policy:terms-of-use-agreements'),
  ('core:premier', 'policy:terms-of-use-agreements'),
  ('detail:full-item-collection', 'policy:terms-of-use-agreements'),
  ('core:enhanced-monitoring', 'policy:activity-based-timeout'),
  ('core:growth', 'policy:activity-based-timeout'),
  ('core:premier', 'policy:activity-based-timeout'),
  ('detail:full-item-collection', 'policy:activity-based-timeout'),
  ('core:enhanced-monitoring', 'policy:admin-consent-workflow'),
  ('core:growth', 'policy:admin-consent-workflow'),
  ('core:premier', 'policy:admin-consent-workflow'),
  ('detail:full-item-collection', 'policy:admin-consent-workflow'),
  ('core:foundation', 'policy:admin-consent-workflow'),
  ('core:security-baseline', 'policy:admin-consent-workflow'),
  ('core:enhanced-monitoring', 'policy:app-management-policies'),
  ('core:growth', 'policy:app-management-policies'),
  ('core:premier', 'policy:app-management-policies'),
  ('detail:full-item-collection', 'policy:app-management-policies'),
  ('core:enhanced-monitoring', 'policy:authentication-flows'),
  ('core:growth', 'policy:authentication-flows'),
  ('core:premier', 'policy:authentication-flows'),
  ('detail:full-item-collection', 'policy:authentication-flows'),
  ('core:enhanced-monitoring', 'policy:authentication-methods-policy'),
  ('core:growth', 'policy:authentication-methods-policy'),
  ('core:premier', 'policy:authentication-methods-policy'),
  ('detail:full-item-collection', 'policy:authentication-methods-policy'),
  ('core:enhanced-monitoring', 'policy:authentication-strength-policies'),
  ('core:growth', 'policy:authentication-strength-policies'),
  ('core:premier', 'policy:authentication-strength-policies'),
  ('detail:full-item-collection', 'policy:authentication-strength-policies'),
  ('core:enhanced-monitoring', 'policy:claims-mapping-policies'),
  ('core:growth', 'policy:claims-mapping-policies'),
  ('core:premier', 'policy:claims-mapping-policies'),
  ('detail:full-item-collection', 'policy:claims-mapping-policies'),
  ('core:enhanced-monitoring', 'policy:cross-tenant-access-default'),
  ('core:growth', 'policy:cross-tenant-access-default'),
  ('core:premier', 'policy:cross-tenant-access-default'),
  ('detail:full-item-collection', 'policy:cross-tenant-access-default'),
  ('core:enhanced-monitoring', 'policy:cross-tenant-m365-capabilities'),
  ('core:growth', 'policy:cross-tenant-m365-capabilities'),
  ('core:premier', 'policy:cross-tenant-m365-capabilities'),
  ('detail:full-item-collection', 'policy:cross-tenant-m365-capabilities'),
  ('core:enhanced-monitoring', 'policy:cross-tenant-partners'),
  ('core:growth', 'policy:cross-tenant-partners'),
  ('core:premier', 'policy:cross-tenant-partners'),
  ('detail:full-item-collection', 'policy:cross-tenant-partners'),
  ('core:enhanced-monitoring', 'policy:cross-tenant-identity-sync-template'),
  ('core:growth', 'policy:cross-tenant-identity-sync-template'),
  ('core:premier', 'policy:cross-tenant-identity-sync-template'),
  ('detail:full-item-collection', 'policy:cross-tenant-identity-sync-template'),
  ('core:enhanced-monitoring', 'policy:default-app-management-policy'),
  ('core:growth', 'policy:default-app-management-policy'),
  ('core:premier', 'policy:default-app-management-policy'),
  ('detail:full-item-collection', 'policy:default-app-management-policy'),
  ('core:foundation', 'policy:default-app-management-policy'),
  ('core:security-baseline', 'policy:default-app-management-policy'),
  ('core:enhanced-monitoring', 'policy:home-realm-discovery'),
  ('core:growth', 'policy:home-realm-discovery'),
  ('core:premier', 'policy:home-realm-discovery'),
  ('detail:full-item-collection', 'policy:home-realm-discovery'),
  ('core:enhanced-monitoring', 'policy:security-defaults'),
  ('core:growth', 'policy:security-defaults'),
  ('core:premier', 'policy:security-defaults'),
  ('detail:full-item-collection', 'policy:security-defaults'),
  ('core:foundation', 'policy:security-defaults'),
  ('core:security-baseline', 'policy:security-defaults'),
  ('core:enhanced-monitoring', 'policy:token-issuance-policies'),
  ('core:growth', 'policy:token-issuance-policies'),
  ('core:premier', 'policy:token-issuance-policies'),
  ('detail:full-item-collection', 'policy:token-issuance-policies'),
  ('core:enhanced-monitoring', 'policy:token-lifetime-policies'),
  ('core:growth', 'policy:token-lifetime-policies'),
  ('core:premier', 'policy:token-lifetime-policies'),
  ('detail:full-item-collection', 'policy:token-lifetime-policies')
) AS v(package_key, check_key)
WHERE EXISTS (SELECT 1 FROM monitor_checks c WHERE c.key = v.check_key AND c.status = 'active')
ON CONFLICT (package_key, check_key) DO NOTHING;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-04-policy-surface-coverage-2760.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
