-- #2763 — Close the real coverage gap on the directory surface (Feature #1128).
--
-- Real completion: 6 of the 41 `surface = 'directory' AND availability =
-- 'available_now' AND check_coverage_count = 0` resources (live-queried
-- 2026-09-04; matches the issue's own 41). Every endpoint below was confirmed
-- with a real GET against the testbed tenant (mccawsoft2.onmicrosoft.com,
-- tenants.id=1, app-only, MT_APP_CLIENT_ID/SECRET) this session, and every
-- mapping/severity_rules field is a field genuinely observed on the real
-- returned objects (not declared-but-unobserved, not fabricated). See
-- build-journal/2763.md for the real probe transcript.
--
-- Real matching-algorithm confirmation (map-monitor-checks.mjs
-- matchEndpointToResource, run directly against the full config_resources
-- table, not hand-computed): all 6 resolve at `high` confidence
-- (graph-path-exact).
--
-- The remaining 35 of the 41 are left for a real follow-up pass, filed as
-- **#2832** (sub-issue of Feature #1128) with the exact per-resource reason
-- breakdown. Summary of why each was NOT covered this pass (all confirmed
-- live, not assumed):
--   - 8 real permission gaps (403/401): certificateBasedApplicationConfigurations,
--     roleManagement/cloudPC (+ its resourceNamespaces/roleDefinitions),
--     roleManagement/defender/resourceNamespaces, roleManagement/deviceManagement
--     (+ resourceNamespaces/roleDefinitions), roleManagement/directory/
--     roleAssignmentApprovals, roleManagement/entitlementManagement/
--     roleAssignmentApprovals, roleManagement/exchange/roleAssignments (+
--     roleDefinitions) — this app registration's granted Graph permissions do
--     not reach these workload-specific RBAC namespaces on this tenant.
--   - roleManagement/defender: 404 (not provisioned on this tenant/SKU).
--   - 2 real Entra ID P2 / Governance license gaps (400 AadPremiumLicenseRequired
--     or the entitlementManagement PIM family's equivalent): roleManagement/
--     directory/roleEligibilityScheduleInstances, and by the same real
--     licensing wall, all 7 roleManagement/entitlementManagement/roleAssignment*
--     and roleEligibility* schedule/request/instance endpoints plus the
--     entitlementManagement/roleManagement container and its resourceNamespaces
--     (both 500 — a real upstream Graph error on this tenant, not modeled here
--     as a license gap since the error body did not confirm it, but consistent
--     with the same PIM-for-Groups premium wall).
--   - roleManagement/directory/transitiveRoleAssignments and
--     roleManagement/entitlementManagement/transitiveRoleAssignments: real
--     400 "TransitiveRoleAssignment requires at least one filter to work" even
--     with ConsistencyLevel:eventual and a real roleDefinitionId filter tried —
--     not a blanket-collection endpoint, needs a per-role or per-principal
--     fan-out design, same class of exclusion as #2762's Get-RoleGroupMember.
--   - roleManagement/enterpriseApps: real 400 Request_InvalidRequestUrl as a
--     standalone collection GET (confirmed graph_entity_type
--     microsoft.graph.rbacApplication — this is a single rbacApplication
--     singleton, not a listable collection; the model's graph_is_collection=true
--     on this row is itself a real config_resources bug, filed in #2832).
--   - roleManagement/exchange, roleManagement/exchange/resourceNamespaces: real
--     400 BadRequest as a standalone GET (Exchange RBAC is not exposed this way
--     via Microsoft Graph on this tenant).
--   - roleManagement (v1.0 top-level singleton), roleManagement/directory
--     (v1.0 container): real 400 Request_InvalidRequestUrl — non-queryable
--     navigation containers, not independently readable.
--   - directoryRoleTemplates (145 items, live 200): real but a static
--     Microsoft-provided role-template catalog with no tenant-controlled state
--     to check — same exclusion class as #2761's conditionalAccess/templates.
--   - directoryObjects: real 400 Request_UnsupportedQuery — the generic
--     polymorphic collection needs a $filter/OData cast or a POST getByIds,
--     not a blanket GET.
--   - schemaExtensions (250 items, live 200, paged): confirmed this is Microsoft
--     Graph's GLOBAL published schema-extension catalog (any app's Available
--     extensions across ALL tenants, not just this one — Microsoft's own docs:
--     "a list of extension definitions available to use", not "applied to this
--     tenant"), so it carries no genuinely tenant-scoped state to score without
--     first knowing this tenant's own app-registration ids to filter by owner —
--     left out rather than faking a filter.
--   - O365AdminAuditLogConfig / O365OrgCustomizationSetting (the 2 m365dsc-origin
--     rows): PowerShell-executor resources needing a live Connect-IPPSSession /
--     MSCommerce-style probe via shaneapp://executeCmdlet, which this session did
--     not use — no dev-server outage this time (unlike #2762), simply out of scope
--     for this Graph-focused pass; a real, cheap follow-up (property_count 1-2
--     each, single Get-AdminAuditLogConfig/Get-OrganizationConfig read).
--
-- All findings above are consolidated into the real follow-up issue #2832
-- rather than re-discovered blind by whoever picks it up next.

BEGIN;

INSERT INTO monitor_checks (
  key, label, description, endpoint, method,
  properties, mapping, severity_rules,
  engines, frequency, requires_customer_script, status, executor_type
) VALUES
(
  'directory:cloud-licensing-allotment-exhausted',
  'Cloud Licensing Allotment Pools Fully Consumed',
  'Partner-driven cloud licensing allotment pools (Microsoft 365 Lighthouse / delegated CSP licensing), checked for pools where every allotted unit is already consumed. Fields (allottedUnits, consumedUnits) are live-observed on real returned objects on the testbed tenant (4 real allotments, GET /admin/cloudLicensing/allotments).',
  '/admin/cloudLicensing/allotments',
  'GET',
  '["id"]'::jsonb,
  '[{"sourceField":"id","targetField":"allotmentCount","transform":"count"},{"sourceField":"id","targetField":"exhaustedAllotments","transform":"countWhere(''{{allottedUnits}} > 0 && {{consumedUnits}} >= {{allottedUnits}}'')"}]'::jsonb,
  '[{"severity":"warning","expression":"{{exhaustedAllotments}} > 0","label":"One or more partner-driven cloud licensing allotment pool(s) is fully consumed (consumedUnits >= allottedUnits) — the next license assignment drawing from this pool will fail until more units are allotted"}]'::jsonb,
  '["licensing","cost"]'::jsonb,
  'daily',
  false,
  'active',
  'graph'
),
(
  'directory:cloud-licensing-assignment-errors',
  'Cloud Licensing Assignment Errors',
  'Errors recorded against partner-driven cloud licensing assignments (a license draw from an allotment pool that failed to apply to the target user/group). This tenant currently has zero recorded errors (real, live-observed, GET /admin/cloudLicensing/assignmentErrors) — the field is real and the check fires the moment one appears.',
  '/admin/cloudLicensing/assignmentErrors',
  'GET',
  '["id"]'::jsonb,
  '[{"sourceField":"id","targetField":"assignmentErrorCount","transform":"count"}]'::jsonb,
  '[{"severity":"warning","expression":"{{assignmentErrorCount}} > 0","label":"One or more cloud licensing assignment error(s) recorded — a partner-driven license assignment to a user or group failed and needs review"}]'::jsonb,
  '["licensing","health"]'::jsonb,
  'daily',
  false,
  'active',
  'graph'
),
(
  'directory:cloud-licensing-assignment-disabled-plans',
  'Cloud Licensing Assignments With Disabled Service Plans',
  'Partner-driven cloud licensing assignments checked for how many have one or more individual service plans explicitly disabled within the assignment. Field (disabledServicePlanIds) is live-observed on real returned objects on the testbed tenant (6 real assignments, GET /admin/cloudLicensing/assignments).',
  '/admin/cloudLicensing/assignments',
  'GET',
  '["id"]'::jsonb,
  '[{"sourceField":"id","targetField":"assignmentCount","transform":"count"},{"sourceField":"id","targetField":"assignmentsWithDisabledPlans","transform":"countWhere(''{{disabledServicePlanIds}} length>0'')"}]'::jsonb,
  '[{"severity":"info","expression":"{{assignmentsWithDisabledPlans}} > 0","label":"One or more cloud licensing assignment(s) has one or more service plans explicitly disabled — review whether the disablement is still intentional"}]'::jsonb,
  '["licensing"]'::jsonb,
  'daily',
  false,
  'active',
  'graph'
),
(
  'directory:service-health-active-incidents',
  'Active Microsoft 365 Service Health Incidents',
  'Microsoft 365 service health issues (the per-incident detail feed, distinct from m365:service-health''s healthOverviews status rollup and m365:message-center''s message-center posts), checked for how many are currently unresolved, and specifically how many are classified as incidents (vs. advisories). Fields (isResolved, classification) are live-observed on real returned objects on the testbed tenant (100 real issues, GET /admin/serviceAnnouncement/issues).',
  '/admin/serviceAnnouncement/issues',
  'GET',
  '["id"]'::jsonb,
  '[{"sourceField":"id","targetField":"activeIssueCount","transform":"countWhere(''{{isResolved}} == false'')"},{"sourceField":"id","targetField":"activeIncidentCount","transform":"countWhere(''{{isResolved}} == false && {{classification}} contains \"incident\"'')"}]'::jsonb,
  '[{"severity":"warning","expression":"{{activeIncidentCount}} > 0","label":"One or more active Microsoft 365 service incident(s) (classification=incident, unresolved) is currently affecting this tenant"},{"severity":"info","expression":"{{activeIssueCount}} > 0","label":"One or more active Microsoft 365 service health issue(s) (incident or advisory) is currently unresolved for this tenant"}]'::jsonb,
  '["health"]'::jsonb,
  'daily',
  false,
  'active',
  'graph'
),
(
  'directory:partner-delegated-admin-relationships',
  'Partner Delegated Administration Relationships',
  'Contract objects representing an active partner/reseller delegated administration relationship into this tenant (Graph /contracts) — checked for whether any exist, since each one is an external company with delegated admin access worth surfacing for review. This tenant currently has zero (real, live-observed, GET /contracts).',
  '/contracts',
  'GET',
  '["id"]'::jsonb,
  '[{"sourceField":"id","targetField":"partnerContractCount","transform":"count"}]'::jsonb,
  '[{"severity":"info","expression":"{{partnerContractCount}} > 0","label":"This tenant has one or more active partner/reseller delegated administration relationship(s) — review who holds delegated admin access via each contract"}]'::jsonb,
  '["security","governance"]'::jsonb,
  'daily',
  false,
  'active',
  'graph'
),
(
  'directory:org-contact-provisioning-errors',
  'Organizational Contacts With Provisioning Errors',
  'Organizational (mail-enabled) contact objects checked for service or on-premises provisioning errors recorded against them — the object exists in the directory but is not syncing/provisioning cleanly. Fields (serviceProvisioningErrors, onPremisesProvisioningErrors) are live-observed on real returned objects on the testbed tenant (2 real contacts, GET /contacts).',
  '/contacts',
  'GET',
  '["id"]'::jsonb,
  '[{"sourceField":"id","targetField":"orgContactCount","transform":"count"},{"sourceField":"id","targetField":"contactsWithProvisioningErrors","transform":"countWhere(''{{serviceProvisioningErrors}} length>0 || {{onPremisesProvisioningErrors}} length>0'')"}]'::jsonb,
  '[{"severity":"warning","expression":"{{contactsWithProvisioningErrors}} > 0","label":"One or more organizational contact(s) has a service or on-premises provisioning error recorded — the contact object is not syncing/provisioning cleanly"}]'::jsonb,
  '["health"]'::jsonb,
  'daily',
  false,
  'active',
  'graph'
);

-- Package wiring mirrors the existing directory/m365-surface precedent
-- (m365:service-health, m365:message-center, identity:pim-eligible-roles),
-- appended after each package's current last sort_order.
INSERT INTO monitoring_package_checks (package_key, check_key, sort_order)
SELECT v.package_key, v.check_key,
  COALESCE((SELECT MAX(mpc2.sort_order) FROM monitoring_package_checks mpc2 WHERE mpc2.package_key = v.package_key), 0)
    + row_number() OVER (PARTITION BY v.package_key ORDER BY v.check_key)
FROM (VALUES
  ('assess:copilot-readiness', 'directory:cloud-licensing-allotment-exhausted'),
  ('core:enhanced-monitoring', 'directory:cloud-licensing-allotment-exhausted'),
  ('core:growth', 'directory:cloud-licensing-allotment-exhausted'),
  ('core:premier', 'directory:cloud-licensing-allotment-exhausted'),
  ('detail:full-item-collection', 'directory:cloud-licensing-allotment-exhausted'),
  ('assess:copilot-readiness', 'directory:cloud-licensing-assignment-errors'),
  ('core:enhanced-monitoring', 'directory:cloud-licensing-assignment-errors'),
  ('core:growth', 'directory:cloud-licensing-assignment-errors'),
  ('core:premier', 'directory:cloud-licensing-assignment-errors'),
  ('detail:full-item-collection', 'directory:cloud-licensing-assignment-errors'),
  ('assess:copilot-readiness', 'directory:cloud-licensing-assignment-disabled-plans'),
  ('core:enhanced-monitoring', 'directory:cloud-licensing-assignment-disabled-plans'),
  ('core:growth', 'directory:cloud-licensing-assignment-disabled-plans'),
  ('core:premier', 'directory:cloud-licensing-assignment-disabled-plans'),
  ('detail:full-item-collection', 'directory:cloud-licensing-assignment-disabled-plans'),
  ('assess:copilot-readiness', 'directory:service-health-active-incidents'),
  ('core:enhanced-monitoring', 'directory:service-health-active-incidents'),
  ('core:growth', 'directory:service-health-active-incidents'),
  ('core:premier', 'directory:service-health-active-incidents'),
  ('detail:full-item-collection', 'directory:service-health-active-incidents'),
  ('assess:copilot-readiness', 'directory:partner-delegated-admin-relationships'),
  ('core:enhanced-monitoring', 'directory:partner-delegated-admin-relationships'),
  ('core:growth', 'directory:partner-delegated-admin-relationships'),
  ('core:premier', 'directory:partner-delegated-admin-relationships'),
  ('detail:full-item-collection', 'directory:partner-delegated-admin-relationships'),
  ('assess:copilot-readiness', 'directory:org-contact-provisioning-errors'),
  ('core:enhanced-monitoring', 'directory:org-contact-provisioning-errors'),
  ('core:growth', 'directory:org-contact-provisioning-errors'),
  ('core:premier', 'directory:org-contact-provisioning-errors'),
  ('detail:full-item-collection', 'directory:org-contact-provisioning-errors')
) AS v(package_key, check_key)
ON CONFLICT DO NOTHING;

-- config_resource_check_coverage is normally recomputed by
-- scripts/config-state/build-resource-model.mjs's full pipeline (not run here,
-- per #2760/#2761/#2762's own precedent — it also re-fetches Graph/m365dsc
-- metadata over the network). The real matchEndpointToResource() result for
-- each of these 6 checks was confirmed by running that function directly
-- against the full config_resources table before writing this migration (see
-- build-journal/2763.md) — inserted directly here, scoped to just these six.
INSERT INTO config_resource_check_coverage (config_resource_id, monitor_check_id, check_key, executor_type, match_basis, confidence, matched_on)
SELECT r.id, c.id, c.key, c.executor_type, 'graph-path-exact', v.confidence, v.matched_on
FROM (VALUES
  ('directory:cloud-licensing-allotment-exhausted', 'graph:beta:/admin/cloudLicensing/allotments', 'high', '/admin/cloudLicensing/allotments'),
  ('directory:cloud-licensing-assignment-errors', 'graph:beta:/admin/cloudLicensing/assignmentErrors', 'high', '/admin/cloudLicensing/assignmentErrors'),
  ('directory:cloud-licensing-assignment-disabled-plans', 'graph:beta:/admin/cloudLicensing/assignments', 'high', '/admin/cloudLicensing/assignments'),
  ('directory:service-health-active-incidents', 'graph:v1.0:/admin/serviceAnnouncement/issues', 'high', '/admin/serviceAnnouncement/issues'),
  ('directory:partner-delegated-admin-relationships', 'graph:v1.0:/contracts', 'high', '/contracts'),
  ('directory:org-contact-provisioning-errors', 'graph:v1.0:/contacts', 'high', '/contacts')
) AS v(check_key, resource_key, confidence, matched_on)
JOIN monitor_checks c ON c.key = v.check_key
JOIN config_resources r ON r.resource_key = v.resource_key
ON CONFLICT DO NOTHING;

UPDATE config_resources r SET check_coverage_count = COALESCE(c.n, 0)
  FROM (SELECT config_resource_id, count(*) n FROM config_resource_check_coverage
        WHERE config_resource_id IS NOT NULL GROUP BY 1) c
 WHERE c.config_resource_id = r.id;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-04-directory-surface-coverage-2763.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
