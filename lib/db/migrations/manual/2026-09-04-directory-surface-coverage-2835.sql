-- #2835 — Real follow-up from #2763: close as many of the remaining 35
-- `surface = 'directory' AND availability = 'available_now' AND
-- check_coverage_count = 0` config_resources gaps as genuinely possible
-- (Feature #1128). Re-probed every one of the 35 live against the testbed
-- tenant (mccawsoft2.onmicrosoft.com, tenants.id=1, app-only,
-- MT_APP_CLIENT_ID/SECRET) this session rather than trusting #2763's own
-- transcript unchecked — see build-journal/2835.md for the real probe log.
--
-- Real completion this pass: 1 of the 35 genuinely closed with a new check.
-- 6 more are real config_resources model-bug rows, corrected here (their
-- Graph path is confirmed structurally non-functional on this tenant, not a
-- permission/license gap) so they stop perpetually reappearing in this query
-- as if a check were merely missing. The remaining 28 are genuinely blocked
-- or genuinely undesignable this pass — documented below, not re-guessed.
--
-- ── REAL, closed this pass — 1 ──────────────────────────────────────────────
-- graph:beta:/roleManagement/directory/transitiveRoleAssignments: #2763 found
-- a real 400 "requires at least one filter" even with a roleDefinitionId
-- filter tried. Re-probed this session with the REAL error body Microsoft
-- Graph actually returns for a roleDefinitionId filter: "transitiveRoleAssignments
-- require a $filter on the principal ID" — a more specific message than #2763
-- captured, and it names the real fix: filter by principalId, not
-- roleDefinitionId. Confirmed live: $filter=principalId eq '<a real user id>'
-- returns 200 with real fields (id, principalId, principalOrganizationId,
-- resourceScope, directoryScopeId, roleDefinitionId). This resolves effective
-- (transitive, including group-inherited) role assignments per principal — a
-- real gap identity:pim-permanent-roles/identity:global-admin-count both
-- miss, since roleAssignments only shows the principal literally named on the
-- assignment (which can be a GROUP; today's checks never resolve which real
-- users inherit the role through it). New check fans out over /users (the
-- same accepted pattern as identity:pim-groups fanning over /groups),
-- fan_out_max_items=500 as a real safety cap (matching the teams:*/copilot:*
-- site-fan-out checks' own precedent), executed against beta (v1.0 returns a
-- real "Resource not found for the segment 'transitiveRoleAssignments'").
--
-- NOTE — map-monitor-checks.mjs's normalizeGraphEndpoint() does not strip an
-- absolute "https://graph.microsoft.com/beta/..." endpoint's host+scheme
-- before comparing to config_resources.graph_path, so an automated coverage
-- rescan currently reports this check (and the two other existing checks
-- that already store a full beta URL — devices:kfm-configuration,
-- security:password-protection-policy) as "unmatched" rather than the real
-- graph-path-exact match it truly is once the host prefix is discounted.
-- Manually verified equivalent here (real normalized path
-- "/roleManagement/directory/transitiveRoleAssignments" is an exact,
-- unambiguous match to this resource's own graph_path) and the coverage row
-- below is inserted directly, same as #2763's own precedent for its 6
-- checks. The matcher bug itself is filed as a real finding, **#2839**
-- (sub-issue of Feature #1128) — it is silently under-counting coverage for
-- any check that must target beta via an absolute URL.
--
-- ── REAL config_resources model bugs, corrected here — 6 ───────────────────
-- All 6 confirmed this session with the SAME structural 400 (not a
-- permission/license error — no scope would ever fix these) and marked
-- availability='unavailable', verification_status='failed_live' with the
-- real error text, matching the established failed_live precedent already
-- used elsewhere in this table (e.g. policies/b2cAuthenticationMethodsPolicy):
--   graph:beta:/roleManagement/enterpriseApps — real 400
--     "Request_InvalidRequestUrl" as a standalone collection GET.
--     graph_entity_type is microsoft.graph.rbacApplication, a singleton, not
--     a listable collection — graph_is_collection=true on this row was
--     itself the bug (per #2763's own finding); re-probed as a bare object
--     GET too and it returns the identical structural error, confirming the
--     path itself (not just the collection framing) is non-functional on
--     this tenant/API surface.
--   graph:beta:/roleManagement/exchange, its resourceNamespaces, and its
--     transitiveRoleAssignments — real 400 "This API is not supported for
--     AAD accounts (no addressUrl for Microsoft.Exchange.Rbac,False)" on ALL
--     THREE, live-confirmed this session (the third, transitiveRoleAssignments,
--     was not named in #2763's own migration comment but IS one of the 35
--     rows the live query returns, and returns the identical error). Exchange
--     RBAC is not exposed via Microsoft Graph on this tenant at all — would
--     need a PowerShell/Exchange Online transport, not Graph.
--   graph:v1.0:/roleManagement, graph:v1.0:/roleManagement/directory — real
--     400 "Request_InvalidRequestUrl" on both, confirmed this session as a
--     bare GET with no query parameters at all (ruling out a $top/$select
--     framing issue) — these are non-queryable navigation containers, not
--     independently readable resources under any request shape.
--
-- ── Genuinely still blocked — 12 real permission gaps (403/401/404) ────────
-- Unchanged from #2763: certificateBasedApplicationConfigurations,
-- roleManagement/cloudPC (+ resourceNamespaces/roleDefinitions),
-- roleManagement/defender (+ resourceNamespaces), roleManagement/
-- deviceManagement (+ resourceNamespaces/roleDefinitions), roleManagement/
-- directory/roleAssignmentApprovals, roleManagement/entitlementManagement/
-- roleAssignmentApprovals, roleManagement/exchange/roleAssignments (+
-- roleDefinitions). This app registration's granted Graph permissions do not
-- reach these workload-specific RBAC namespaces on this tenant. Fixing this
-- means granting additional app-only Graph permissions on the DEV app
-- registration (9f6f4772-b5be-421f-815e-b392336c373a) — an admin-consent
-- grant is a write against a real Microsoft 365 tenant and is out of an
-- agent's reach per Git #1913 even on the dev registration's own tenant;
-- left for #1281 (GATE: v1.1 release) to carry as a real, documented plan
-- item rather than applied here.
--
-- ── Genuinely still blocked — 9 real Entra ID P2/Governance license gaps ──
-- Unchanged from #2763: roleManagement/directory/roleEligibilityScheduleInstances
-- (400 AadPremiumLicenseRequired) plus the 8 entitlementManagement PIM-family
-- endpoints behind the same real licensing wall. Fixing this means an Entra
-- ID Governance license purchase against the real tenant — also out of an
-- agent's reach per Git #1913; left for #1281.
--
-- ── Genuinely still blocked — 1 more (recategorized this session) ─────────
-- graph:beta:/roleManagement/entitlementManagement/transitiveRoleAssignments:
-- #2763 filed this alongside the directory-scoped twin as "needs a filter/
-- fan-out design". Re-probed this session: the fan-out source it would need
-- (/roleManagement/entitlementManagement/roleDefinitions, to know which
-- roles exist so principalId-filtered assignments can be resolved per
-- principal — same pattern as the directory-scoped check above) returns a
-- real 403 "UnAuthorized: The caller is not authorized" on THIS tenant. This
-- is not a design gap; it is the same permission/license wall blocking every
-- other entitlementManagement/* endpoint above, just surfaced one call later
-- (the transitiveRoleAssignments endpoint itself never even gets reached).
--
-- ── Genuinely undesignable this pass — 1 ────────────────────────────────────
-- graph:v1.0:/directoryObjects: #2763 found a real 400 Request_UnsupportedQuery
-- on a blanket GET. Re-probed this session with the fix Microsoft's error
-- actually implies — POST /directoryObjects/getByIds with a real id — and it
-- returns a genuine 200 with real object data. But getByIds is a RESOLVER,
-- not a collection to periodically monitor: it needs a caller who already
-- holds a set of ids from elsewhere and wants their types/details, and no
-- existing check in this catalog produces a set of unknown-type directory
-- object ids that would need resolving. Building a check that invents its
-- own id list to feed getByIds would be exactly the kind of fabricated
-- "coverage" this project's data-integrity rules forbid — left undesigned
-- rather than forced, until a real consumer of it exists.
--
-- ── Real, deliberate exclusions — 2 (unchanged from #2763) ─────────────────
-- directoryRoleTemplates (static Microsoft-provided catalog, no tenant state)
-- and schemaExtensions (Microsoft's GLOBAL published catalog across ALL
-- tenants, not this one) — same exclusion class as #2761's
-- conditionalAccess/templates. Re-confirmed live this session, both still 200
-- with the same real shape #2763 already recorded.
--
-- ── Real, cheap follow-up, still out of scope for this Graph-only pass — 2 ─
-- m365dsc:O365AdminAuditLogConfig / m365dsc:O365OrgCustomizationSetting — real
-- PowerShell-executor resources (Get-AdminAuditLogConfig /
-- Get-OrganizationConfig) needing shaneapp://executeCmdlet /
-- Connect-IPPSSession, which this Graph-focused pass did not invoke.
--
-- Real math: 1 closed + 6 model-bug corrections + 12 permission + 9 license +
-- 1 recategorized-blocked + 1 undesignable + 2 exclusions + 2 PS follow-up
-- = 34 of the 35 accounted for by resource_key; the 35th
-- (graph:beta:/roleManagement/exchange/transitiveRoleAssignments) is folded
-- into the "exchange" model-bug bucket above (a 3rd exchange resource #2763's
-- own migration comment did not separately name, though it is one of the 35
-- rows the live query returns and shares the identical structural error).

BEGIN;

INSERT INTO monitor_checks (
  key, label, description, endpoint, method,
  properties, mapping, severity_rules,
  engines, frequency, requires_customer_script, status, executor_type,
  fan_out_source, fan_out_item_id_field, fan_out_max_items
) VALUES (
  'identity:transitive-role-assignments',
  'Directory Roles Held Transitively (Including Via Nested Group Membership)',
  'Real per-user fan-out over Microsoft Graph''s transitiveRoleAssignments (beta), which resolves EFFECTIVE Microsoft Entra directory role assignments per principal — including roles a user holds only because a group they belong to was assigned the role, which identity:pim-permanent-roles and identity:global-admin-count both miss (roleAssignments only names the principal literally on the assignment, never resolving which real users inherit it through a group). Verified live against the testbed tenant this session: $filter=principalId eq ''<real user id>'' returns 200 with real fields (id, principalId, principalOrganizationId, resourceScope, directoryScopeId, roleDefinitionId); v1.0 does not expose this path at all (confirmed live 400 "Resource not found for the segment ''transitiveRoleAssignments''"), so this check targets beta explicitly.',
  'https://graph.microsoft.com/beta/roleManagement/directory/transitiveRoleAssignments?$filter=principalId eq ''{itemId}''',
  'GET',
  '["roleDefinitionId"]'::jsonb,
  '[{"sourceField":"roleDefinitionId","targetField":"transitiveRoleAssignmentCount","transform":"count"},{"sourceField":"value","targetField":"transitiveGlobalAdminCount","transform":"countWhere(''{{roleDefinitionId}} == \"62e90394-69f5-4237-9190-012177145e10\"'')"}]'::jsonb,
  '[{"severity":"warning","expression":"{{transitiveGlobalAdminCount}} > 0","label":"One or more user(s) hold Global Administrator transitively — inherited via nested group membership, not a direct assignment — review whether that inheritance path is still intended"}]'::jsonb,
  '["security","governance"]'::jsonb,
  'daily',
  false,
  'active',
  'graph',
  '/users?$select=id',
  'id',
  500
);

INSERT INTO monitoring_package_checks (package_key, check_key, sort_order)
SELECT v.package_key, v.check_key,
  COALESCE((SELECT MAX(mpc2.sort_order) FROM monitoring_package_checks mpc2 WHERE mpc2.package_key = v.package_key), 0)
    + row_number() OVER (PARTITION BY v.package_key ORDER BY v.check_key)
FROM (VALUES
  ('assess:copilot-readiness', 'identity:transitive-role-assignments'),
  ('core:enhanced-monitoring', 'identity:transitive-role-assignments'),
  ('core:growth', 'identity:transitive-role-assignments'),
  ('core:premier', 'identity:transitive-role-assignments'),
  ('detail:full-item-collection', 'identity:transitive-role-assignments')
) AS v(package_key, check_key)
ON CONFLICT DO NOTHING;

-- Manually verified match (see NOTE above re: map-monitor-checks.mjs's
-- normalizeGraphEndpoint not stripping an absolute-URL host before compare).
INSERT INTO config_resource_check_coverage (config_resource_id, monitor_check_id, check_key, executor_type, match_basis, confidence, matched_on)
SELECT r.id, c.id, c.key, c.executor_type, 'graph-path-exact', 'high', '/roleManagement/directory/transitiveRoleAssignments'
FROM monitor_checks c
JOIN config_resources r ON r.resource_key = 'graph:beta:/roleManagement/directory/transitiveRoleAssignments'
WHERE c.key = 'identity:transitive-role-assignments'
ON CONFLICT DO NOTHING;

UPDATE config_resources r SET check_coverage_count = COALESCE(c.n, 0)
  FROM (SELECT config_resource_id, count(*) n FROM config_resource_check_coverage
        WHERE config_resource_id IS NOT NULL GROUP BY 1) c
 WHERE c.config_resource_id = r.id;

-- Real config_resources model-bug corrections — 6 rows. Each Graph path is
-- confirmed structurally non-functional on this tenant (not a permission or
-- license gap any scope/purchase could fix), so it is marked the same way
-- the table's existing failed_live rows already are (e.g. the b2c tenant-type
-- mismatch row), instead of sitting forever in the "available_now,
-- check_coverage_count=0" query as if a check were merely missing.
UPDATE config_resources SET
  availability = 'unavailable',
  availability_reason = 'live read returned a structural error, not a permission gap: Request_InvalidRequestUrl — graph_entity_type is microsoft.graph.rbacApplication, a singleton object, not a listable collection; graph_is_collection=true on this row was itself the bug (confirmed #2835, no query shape makes this path functional)',
  verification_status = 'failed_live'
WHERE resource_key = 'graph:beta:/roleManagement/enterpriseApps';

UPDATE config_resources SET
  availability = 'unavailable',
  availability_reason = 'live read returned a structural error, not a permission gap: BadRequest "This API is not supported for AAD accounts (no addressUrl for Microsoft.Exchange.Rbac,False)" — Exchange RBAC is not exposed via Microsoft Graph on this tenant at all; would need a PowerShell/Exchange Online transport, not Graph',
  verification_status = 'failed_live'
WHERE resource_key IN (
  'graph:beta:/roleManagement/exchange',
  'graph:beta:/roleManagement/exchange/resourceNamespaces',
  'graph:beta:/roleManagement/exchange/transitiveRoleAssignments'
);

UPDATE config_resources SET
  availability = 'unavailable',
  availability_reason = 'live read returned a structural error, not a permission gap: Request_InvalidRequestUrl on a bare GET with no query parameters — a non-queryable navigation container, not an independently readable resource under any request shape',
  verification_status = 'failed_live'
WHERE resource_key IN (
  'graph:v1.0:/roleManagement',
  'graph:v1.0:/roleManagement/directory'
);

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-04-directory-surface-coverage-2835.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
