-- ============================================================================
-- devices:kfm-configuration — wrong Graph endpoint, always false-negatives (#2185)
-- Manual — run by hand against local DATABASE_URL, not drizzle-kit.
-- ============================================================================
--
-- SYMPTOM: this check's stored endpoint, /deviceManagement/deviceConfigurations,
-- structurally cannot return a real OneDrive Known Folder Move (KFM) policy.
-- Confirmed against Microsoft's own docs (cited in #2185):
--   - https://learn.microsoft.com/en-us/graph/api/resources/intune-grouppolicy-grouppolicyconfiguration
--   - https://learn.microsoft.com/en-us/intune/solutions/education/tutorial-school-deployment/ref-onedrive-knownfoldermove-settings-windows
-- Real KFM policies live under one of two collections depending on how the
-- admin authored the policy:
--   - /deviceManagement/groupPolicyConfigurations — Administrative Templates
--     (ADMX-backed) profiles
--   - /deviceManagement/configurationPolicies — Settings Catalog profiles,
--     matched by templateReference/settingDefinitionId, not displayName
--
-- FIX CHOICE: switching to groupPolicyConfigurations, keeping the existing
-- `countWhere('{{displayName}} contains "Known Folder Move" || {{displayName}}
-- contains "KFM"')` name-match mapping unchanged. This check's own stored
-- mapping already uses that transform (the same class of loose,
-- displayName-based read #2185 itself calls out as the deciding factor,
-- comparing this fix to sibling devices:update-rings-config's raw-count read
-- of deviceConfigurations). configurationPolicies would require per-policy
-- settings fan-out (matching settingDefinitionId/templateReference), which
-- has no established convention or fan-out wiring in this codebase for that
-- shape, and its real list-response property is "name", not "displayName"
-- (confirmed live below) -- out of scope for this fix.
--
-- REAL, LIVE-VERIFIED CORRECTION TO THE ISSUE'S OWN PREMISE: neither
-- candidate endpoint actually exists on Graph v1.0. Both groupPolicyConfiguration
-- and deviceManagementConfigurationPolicy (configurationPolicies) are beta-only
-- resource types -- confirmed against the live Microsoft Learn doc, whose
-- front-matter reads "monikers: graph-rest-beta" with no v1.0 moniker at all.
-- Live-fired against the real testbed tenant (mccawsoft2.onmicrosoft.com) to
-- rule out a doc-reading mistake:
--   GET v1.0/deviceManagement/groupPolicyConfigurations
--     -> 400 "Resource not found for the segment 'groupPolicyConfigurations'"
--        (the segment does not exist at v1.0 at all)
--   GET beta/deviceManagement/groupPolicyConfigurations
--     -> 503 Intune-service-unavailable -- the SAME error class v1.0
--        deviceConfigurations already returns for this tenant, i.e. the
--        segment resolves correctly at beta and fails for the ordinary
--        Intune-not-provisioned reason, not a routing error.
-- monitor-executor's graphFetchPaginated / graphFetchForTenant already
-- special-cases an ABSOLUTE Graph URL (passed through verbatim instead of
-- appended to the v1.0-only GRAPH_BASE) specifically so a check CAN reach
-- beta -- built in #1796 for exactly this situation, gated to the
-- graph.microsoft.com host so no bearer token can leak elsewhere. No
-- monitor_checks row has used that path yet (0 of 157, per #1796's own
-- comment) -- this is the first, storing the endpoint as the full
-- https://graph.microsoft.com/beta/... URL rather than a bare v1.0-relative
-- path, reusing an already-built, already-sanctioned mechanism.
--
-- groupPolicyConfigurations reads under the same
-- DeviceManagementConfiguration.Read.All application permission already
-- granted and already in REQUIRED_MT_SCOPES -- no scope change needed.
--
-- Not touched: remediation_knowledge_base.check_key = 'devices:kfm-configuration'
-- (#2043) -- its remediation content is correct and untouched by this fix.

UPDATE monitor_checks
SET endpoint = 'https://graph.microsoft.com/beta/deviceManagement/groupPolicyConfigurations',
    description = '#2185 -- GET beta /deviceManagement/groupPolicyConfigurations (Administrative Templates KFM policies; DeviceManagementConfiguration.Read.All -- already in REQUIRED_MT_SCOPES). Stored as an absolute beta URL because groupPolicyConfiguration is a beta-only Graph resource type (confirmed live against the testbed tenant, #2185) -- monitor-executor''s graphFetchForTenant passes an absolute graph.microsoft.com URL through verbatim instead of the v1.0-only GRAPH_BASE (#1796). kfmConfiguredProfileCount counts profiles whose admin-set displayName contains "Known Folder Move" or "KFM" -- a name-match proxy, the same class of loose read devices:update-rings-config''s own raw count already uses for deviceConfigurations, since groupPolicyConfigurations'' displayName is admin-set free text with no dedicated KFM resource type to filter on structurally. deviceConfigProfileCount is the raw scanned-profile count for context. Fixed from the original #1253 deviceConfigurations read (#2185): that endpoint structurally cannot return a KFM policy, since real KFM objects live under groupPolicyConfigurations (Administrative Templates) or configurationPolicies (Settings Catalog), never deviceConfigurations -- and both of those live endpoints are beta-only, not v1.0.',
    updated_at = now()
WHERE key = 'devices:kfm-configuration';

-- Verify: expect the new absolute-beta endpoint, mapping/severity_rules unchanged, status still active.
SELECT key, label, status, method, endpoint, mapping, severity_rules
FROM monitor_checks
WHERE key = 'devices:kfm-configuration';

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-02-kfm-configuration-endpoint-fix-2185.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
