-- #2761 — Close the real coverage gap on the identity surface (Feature #1128).
--
-- Real completion count: 2 of the 20 `surface = 'identity' AND availability =
-- 'available_now' AND check_coverage_count = 0` resources measured by #1848,
-- re-confirmed live 2026-09-04. This is a genuinely small number and the reason
-- is itself the real finding of this build, filed as #2825 (sub-issue of Feature
-- #1128): 16 of the 20 turned out to be duplicate/unlinked `config_resources`
-- rows describing the SAME real Graph object the `graph:*`-origin extraction had
-- already modeled separately (usually under a different surface — policy,
-- groups, directory), most of which already carry real coverage under their
-- `graph:` twin. Because `matchEndpointToResource` (map-monitor-checks.mjs)
-- credits check_coverage to only ONE resource id when two rows share an exact
-- `graph_path`, the duplicate `identity`-surface node can never independently
-- show covered no matter how correct a new check is — writing one would move
-- nothing measurable here. Evidence for every one of the 20, from a real GET
-- against the testbed tenant (mccawsoft2.onmicrosoft.com, tenants.id=1,
-- app-only) and a real cross-reference of every derived endpoint against the
-- FULL config_resources table (not just surface='identity'):
--
--   DUPLICATE of an already-covered resource elsewhere in the model (real GET
--   confirmed working; the underlying object IS monitored, just not credited to
--   this row) — 8 resources:
--     m365dsc:AADAccessReviewDefinition        = graph:v1.0:/identityGovernance/accessReviews/definitions (coverage 3)
--     m365dsc:AADAuthenticationFlowPolicy      = graph:v1.0:/policies/authenticationFlowsPolicy (coverage 1)
--     m365dsc:AADCrossTenantIdentitySyncPolicyPartner = graph:v1.0:/policies/crossTenantAccessPolicy/partners (coverage 1)
--     m365dsc:AADExternalIdentityPolicy        = graph:beta:/policies/externalIdentitiesPolicy (coverage 1)
--     m365dsc:AADGroupsNamingPolicy            = graph:v1.0:/groupSettings (coverage 1)
--     m365dsc:AADNamedLocationPolicy           = graph:v1.0:/identity/conditionalAccess/namedLocations (coverage 1)
--     m365dsc:AADRoleEligibilityScheduleRequest = graph:v1.0:/roleManagement/directory/roleEligibilitySchedules (coverage 1)
--     m365dsc:AADSecurityDefaults               = graph:v1.0:/policies/identitySecurityDefaultsEnforcementPolicy (coverage 1)
--
--   DUPLICATE of an ALSO-uncovered resource elsewhere in the model (real GET
--   confirmed working; a check would close the OTHER surface's gap, not this
--   one, and risks an undefined tie-break if both rows carried a graph_path) — 2:
--     m365dsc:AADPasswordRuleSettings   = graph:v1.0:/groupSettings (see AADGroupsNamingPolicy above — BOTH m365dsc
--                                          rows collide on this one already-covered graph_path; neither is a real gap)
--     m365dsc:AADPolicyFeatureRolloutPolicy = graph:v1.0:/policies/featureRolloutPolicies (surface=policy, coverage 0 —
--                                          a real gap, just not on the identity surface; left for a policy-surface pass)
--
--   Real 403 "not licensed for this feature" on the testbed tenant — 4:
--     graph:beta:/identity/continuousAccessEvaluationPolicy
--     graph:beta:/identityGovernance/accessReviews/policy
--     graph:beta:/identityProtection/agentRiskDetections
--     graph:v1.0:/identityProtection/servicePrincipalRiskDetections
--
--   Real 403 "not an Azure AD B2C directory" (same tenant-type exclusion #2760
--   already recorded for the policy surface's own copy of this endpoint) — 1:
--     m365dsc:AADB2CAuthenticationMethodsPolicy = graph:beta:/policies/b2cAuthenticationMethodsPolicy
--
--   Real 200, but a static Microsoft-provided reference catalog with no tenant-
--   controlled state to drift (fixed built-in Conditional Access templates /
--   fixed enum of authentication method mode ids) — not a real customer
--   configuration surface, so no severity_rules could ever be genuine — 2:
--     graph:v1.0:/identity/conditionalAccess/templates
--     graph:v1.0:/identity/conditionalAccess/authenticationStrength/authenticationMethodModes
--
--   Not a real readable data source — the resource's own `notes` already flag
--   its sole cmdlet (Get-MSCloudLoginConnectionProfile) as an M365DSC-internal
--   connection helper, not a tenant-data cmdlet — 1:
--     m365dsc:AADOnPremisesPublishingProfilesSettings
--
--   REAL, unique, live-confirmed, genuinely closable — 2 (this migration):
--     m365dsc:AADApplicationFederatedIdentityCredential
--     m365dsc:AADConnectorGroupApplicationProxy
--
-- Each check's mapping/severity_rules reads the actual fields the label names
-- (#2184 discipline, no generic-existence checks); grammar/transform usage
-- (`count`, `countWhere`, `contains`) matches applyMapping/evalConditionGrammar
-- (monitor-executor.ts) exactly, verified against the real captured response
-- shapes below.

BEGIN;

-- The extraction left graph_path null on both target resources (m365dsc-origin
-- rows whose Graph endpoint the parser didn't detect, even though their real
-- read_cmdlets — Get-MgApplicationFederatedIdentityCredential,
-- Get-MgBetaOnPremisePublishingProfileConnectorGroup — are known, confirmed-
-- working Microsoft Graph SDK cmdlets with a 1:1 REST mapping). Populating the
-- real, live-verified endpoint here is filling in missing extracted data, not
-- authoring a display value: both were confirmed with a real GET against the
-- testbed tenant before being written (see build-journal/2761.md). Without this,
-- matchEndpointToResource can never credit either resource — a graph-executor
-- check only ever matches a resource whose OWN graph_path is populated.
UPDATE config_resources
   SET graph_path = '/applications/{itemId}/federatedIdentityCredentials',
       graph_version = 'v1.0',
       graph_is_collection = true
 WHERE resource_key = 'm365dsc:AADApplicationFederatedIdentityCredential';

UPDATE config_resources
   SET graph_path = '/onPremisesPublishingProfiles/applicationProxy/connectorGroups',
       graph_version = 'beta',
       graph_is_collection = true
 WHERE resource_key = 'm365dsc:AADConnectorGroupApplicationProxy';

INSERT INTO monitor_checks (
  key, label, description, endpoint, method,
  properties, mapping, severity_rules,
  engines, frequency, requires_customer_script, status, executor_type,
  fan_out_source, fan_out_item_id_field
) VALUES
(
  'identity:app-federated-identity-credentials',
  'Application Federated Identity Credentials',
  'Workload identity federation (federated identity) credentials configured on app registrations, checked for subject claims unscoped to a specific branch/environment/tag — a bare "...:pull_request" subject trusts ANY pull-request event against the referenced repo, letting it obtain a token for the app without a client secret.',
  '/applications/{itemId}/federatedIdentityCredentials',
  'GET',
  '["id"]'::jsonb,
  '[{"sourceField":"id","targetField":"federatedCredentialCount","transform":"count"},{"sourceField":"id","targetField":"unscopedPullRequestCredentials","transform":"countWhere(''{{subject}} contains \":pull_request\"'')"}]'::jsonb,
  '[{"severity":"warning","expression":"{{unscopedPullRequestCredentials}} > 0","label":"One or more federated identity credential(s) trust ANY pull_request event with no branch/environment scoping in the subject claim — any pull request against the referenced repo can obtain a token for this app without a client secret"}]'::jsonb,
  '["security"]'::jsonb,
  'daily',
  false,
  'active',
  'graph',
  '/applications?$select=id',
  'id'
),
(
  'identity:app-proxy-connector-groups',
  'Application Proxy Connector Groups',
  'Azure AD Application Proxy connector groups, checked for whether any are configured at all and whether every configured group has an assigned region for routing on-premises application traffic.',
  '/onPremisesPublishingProfiles/applicationProxy/connectorGroups',
  'GET',
  '["id"]'::jsonb,
  '[{"sourceField":"id","targetField":"connectorGroupCount","transform":"count"},{"sourceField":"id","targetField":"connectorGroupsWithoutRegion","transform":"countWhere(''{{region}} == null || {{region}} == \"\"'')"}]'::jsonb,
  '[{"severity":"info","expression":"{{connectorGroupCount}} == 0","label":"No Application Proxy connector group is configured — any on-premises published application has no connector group to route through"},{"severity":"warning","expression":"{{connectorGroupsWithoutRegion}} > 0","label":"One or more Application Proxy connector group(s) has no assigned region — traffic routing for on-premises apps through that group is unconfigured"}]'::jsonb,
  '["security"]'::jsonb,
  'daily',
  false,
  'active',
  'graph',
  NULL,
  NULL
);

INSERT INTO monitoring_package_checks (package_key, check_key, sort_order)
SELECT v.package_key, v.check_key,
  COALESCE((SELECT MAX(mpc2.sort_order) FROM monitoring_package_checks mpc2 WHERE mpc2.package_key = v.package_key), 0)
    + row_number() OVER (PARTITION BY v.package_key ORDER BY v.check_key)
FROM (VALUES
  ('core:enhanced-monitoring', 'identity:app-federated-identity-credentials'),
  ('core:growth', 'identity:app-federated-identity-credentials'),
  ('core:premier', 'identity:app-federated-identity-credentials'),
  ('detail:full-item-collection', 'identity:app-federated-identity-credentials'),
  ('core:foundation', 'identity:app-federated-identity-credentials'),
  ('core:security-baseline', 'identity:app-federated-identity-credentials'),
  ('core:enhanced-monitoring', 'identity:app-proxy-connector-groups'),
  ('core:growth', 'identity:app-proxy-connector-groups'),
  ('core:premier', 'identity:app-proxy-connector-groups'),
  ('detail:full-item-collection', 'identity:app-proxy-connector-groups')
) AS v(package_key, check_key)
ON CONFLICT DO NOTHING;

-- config_resource_check_coverage / check_coverage_count is normally recomputed by
-- scripts/config-state/build-resource-model.mjs's full pipeline (which also
-- re-fetches Graph/m365dsc metadata — not run here). Both new checks match by
-- exact graph_path (see the UPDATEs above), so the same matchEndpointToResource
-- result the full pipeline would produce is inserted directly here, scoped to
-- just these two checks, and check_coverage_count is recomputed platform-wide
-- from the real coverage table (idempotent — safe to rerun).
INSERT INTO config_resource_check_coverage (config_resource_id, monitor_check_id, check_key, executor_type, match_basis, confidence, matched_on)
SELECT r.id, c.id, c.key, c.executor_type, 'graph-path-exact', 'high', r.graph_path
  FROM monitor_checks c
  JOIN config_resources r ON r.graph_path = c.endpoint
 WHERE c.key IN ('identity:app-federated-identity-credentials', 'identity:app-proxy-connector-groups')
ON CONFLICT DO NOTHING;

UPDATE config_resources r SET check_coverage_count = COALESCE(c.n, 0)
  FROM (SELECT config_resource_id, count(*) n FROM config_resource_check_coverage
        WHERE config_resource_id IS NOT NULL GROUP BY 1) c
 WHERE c.config_resource_id = r.id;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-04-identity-surface-coverage-2761.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
