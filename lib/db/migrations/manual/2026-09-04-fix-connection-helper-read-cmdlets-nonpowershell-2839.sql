-- #2839: 64-non-powershell-transport config_resources rows cited
-- Get-MSCloudLoginConnectionProfile as a read_cmdlets entry, the same fake-cmdlet-citation
-- pollution #1896 fixed for powershell-transport rows. That function is Microsoft365DSC's own
-- internal connection-setup helper (called inside Get-TargetResource to establish the session
-- before the resource's real read call) -- not a real exported PowerShell/Graph/Az cmdlet.
--
-- By the time this migration ran, an intervening migration (#1960,
-- 2026-09-04-config-resource-graph-transport-1960.sql) had already reclassified 193 rows from
-- read_transport='graph' to 'powershell' (carrying some polluted read_cmdlets values with
-- them), which changed the live per-transport counts from the issue's original snapshot
-- (graph 49 -> 16; azure-rm/power-platform/sharepoint-admin counts unchanged at 7/6/2). The
-- live query below (the issue's own SQL, re-run against current state) is authoritative: 31
-- non-powershell rows actually need fixing here, not 64. The 34 powershell-transport rows now
-- also citing the helper (a byproduct of #1960's reclassification, distinct from the 12 rows
-- #1896 already fixed) are out of this issue's scope and filed separately as #2872.
--
--   SELECT read_transport, count(*) FROM config_resources
--   WHERE read_cmdlets @> '["Get-MSCloudLoginConnectionProfile"]'::jsonb AND read_transport <> 'powershell'
--   GROUP BY read_transport;
--   -- azure-rm 7, graph 16, power-platform 6, sharepoint-admin 2 (31 total)
--
-- For each row, the real read_cmdlets value was determined by reading the resource's actual
-- Get-TargetResource source in Microsoft365DSC/Microsoft365DSC@f79f297 (the same commit this
-- catalog's source_ref cites -- the repo has since moved from microsoft/Microsoft365DSC to the
-- Microsoft365DSC/Microsoft365DSC org, same commit hashes) and following the call chain past
-- the connection helper to the real cmdlet that performs the read:
--
--   Where a real cmdlet already appeared elsewhere in the row's read_cmdlets array (e.g.
--   Get-Mg*, Get-PnP*, Get-Team*), only the fake helper entry is dropped -- everything else is
--   left as-is (matches #1896's precedent of touching only what's in scope; a locally-defined
--   per-resource helper some of these DSC .psm1 files also export, `Get-CompareParameters`, is
--   NOT a real read cmdlet either -- same shape of pollution, different name, out of THIS
--   issue's literal scope which only queries for the connection-helper citation; filed
--   separately as #2872 alongside the powershell finding above).
--
--   Where the fake helper was the row's ONLY entry (or the only entries left after it were
--   also non-real), the real read cmdlet was traced and the array replaced outright:
--
--   AzureBillingAccountPolicy                    -> Invoke-AzRestMethod (direct GET call)
--   AzureBillingAccountScheduledAction            -> Invoke-AzRestMethod (direct GET call)
--   AzureDiagnosticSettings                       -> Invoke-AzRestMethod (direct GET call)
--   AzureDiagnosticSettingsCustomSecurityAttribute -> Invoke-AzRestMethod (direct GET call)
--   AzureSubscription                             -> Invoke-AzRestMethod (direct GET call)
--   IntuneDiagnosticSettings                      -> Invoke-AzRestMethod (direct GET call)
--   IntuneWindowsDataProcessingSettings           -> Invoke-MgGraphRequest (direct GET call)
--   AADFederationConfiguration                    -> Invoke-MgGraphRequest (direct GET call)
--   PPAdminDLPPolicy                              -> Invoke-WebRequest
--                                                     (Invoke-M365DSCPowerPlatformRESTWebRequest,
--                                                     Modules/WorkloadHelpers/M365DSCPowerPlatformRESTHelper.psm1,
--                                                     wraps Invoke-WebRequest directly)
--   PPPowerAppsEnvironment                        -> Invoke-WebRequest (same helper as above)
--   PPTenantSettings                              -> Invoke-WebRequest (same helper as above)

BEGIN;

-- azure-rm (7)
UPDATE config_resources SET read_cmdlets = '["Invoke-AzRestMethod"]'::jsonb
  WHERE id = 10359 AND resource_key = 'm365dsc:AzureBillingAccountPolicy';

UPDATE config_resources SET read_cmdlets = '["Invoke-AzRestMethod"]'::jsonb
  WHERE id = 10361 AND resource_key = 'm365dsc:AzureBillingAccountScheduledAction';

UPDATE config_resources SET read_cmdlets = '["Invoke-AzRestMethod"]'::jsonb
  WHERE id = 10363 AND resource_key = 'm365dsc:AzureDiagnosticSettings';

UPDATE config_resources SET read_cmdlets = '["Invoke-AzRestMethod"]'::jsonb
  WHERE id = 10364 AND resource_key = 'm365dsc:AzureDiagnosticSettingsCustomSecurityAttribute';

UPDATE config_resources SET read_cmdlets = '["Get-MgBetaDirectoryObjectById", "Get-MgGroup", "Get-MgUser", "Get-CompareParameters"]'::jsonb
  WHERE id = 10368 AND resource_key = 'm365dsc:AzureRoleEligibilityScheduleSettings';

UPDATE config_resources SET read_cmdlets = '["Invoke-AzRestMethod"]'::jsonb
  WHERE id = 10369 AND resource_key = 'm365dsc:AzureSubscription';

UPDATE config_resources SET read_cmdlets = '["Invoke-AzRestMethod"]'::jsonb
  WHERE id = 10554 AND resource_key = 'm365dsc:IntuneDiagnosticSettings';

-- graph (16)
UPDATE config_resources SET read_cmdlets = '["Get-MgBetaDirectoryCertificateAuthorityCertificateBasedApplicationConfiguration", "Get-MgBetaDirectoryCertificateAuthorityCertificateBasedApplicationConfigurationTrustedCertificateAuthority"]'::jsonb
  WHERE id = 10149 AND resource_key = 'graph:beta:/directory/certificateAuthorities/certificateBasedApplicationConfigurations';

UPDATE config_resources SET read_cmdlets = '["Get-MgBetaPolicyMobileAppManagementPolicy", "Get-MgGroup", "Get-CompareParameters"]'::jsonb
  WHERE id = 10179 AND resource_key = 'graph:beta:/policies/mobileAppManagementPolicies';

UPDATE config_resources SET read_cmdlets = '["Get-MgBetaPolicyMobileDeviceManagementPolicy", "Get-MgGroup", "Get-CompareParameters"]'::jsonb
  WHERE id = 10180 AND resource_key = 'graph:beta:/policies/mobileDeviceManagementPolicies';

UPDATE config_resources SET read_cmdlets = '["Get-MgApplication", "Get-MgServicePrincipal", "Get-MgBetaApplication", "Get-MgBetaDirectoryDeletedItemAsApplication", "Get-MgBetaPolicyTokenLifetimePolicy", "Get-MgUser", "Get-CompareParameters"]'::jsonb
  WHERE id = 9241 AND resource_key = 'graph:v1.0:/applications';

UPDATE config_resources SET read_cmdlets = '["Invoke-MgGraphRequest"]'::jsonb
  WHERE id = 9401 AND resource_key = 'graph:v1.0:/deviceManagement';

UPDATE config_resources SET read_cmdlets = '["Get-MgServicePrincipal", "Get-MgGroup", "Get-MgDevice", "Get-MgDirectoryAdministrativeUnit", "Get-MgDirectoryAdministrativeUnitMember", "Get-MgDirectoryAdministrativeUnitScopedRoleMember", "Get-MgDirectoryRole", "Get-MgDirectoryRoleTemplate", "Get-MgUser", "Get-CompareParameters"]'::jsonb
  WHERE id = 9561 AND resource_key = 'graph:v1.0:/directory/administrativeUnits';

UPDATE config_resources SET read_cmdlets = '["Get-MgApplication", "Get-MgServicePrincipal", "Get-MgBetaGroup", "Get-MgBetaGroupLifecyclePolicy", "Get-MgBetaGroupMember", "Get-MgBetaSubscribedSku", "Get-MgBetaRoleManagementDirectoryRoleAssignment", "Get-MgBetaRoleManagementDirectoryRoleDefinition", "Get-MgGroupMember", "Get-MgDevice", "Get-MgUser", "Get-CompareParameters", "Get-MgBetaDirectoryDeletedItemAsGroup"]'::jsonb
  WHERE id = 9564 AND resource_key = 'graph:v1.0:/directory/deletedItems';

UPDATE config_resources SET read_cmdlets = '["Invoke-MgGraphRequest"]'::jsonb
  WHERE id = 9565 AND resource_key = 'graph:v1.0:/directory/federationConfigurations';

UPDATE config_resources SET read_cmdlets = '["Get-MgGroup", "Get-MgGroupMember", "Get-MgGroupOwner", "Get-MgUser"]'::jsonb
  WHERE id = 9251 AND resource_key = 'graph:v1.0:/groups';

UPDATE config_resources SET read_cmdlets = '["Get-MgServicePrincipal", "Get-MgBetaAgreement", "Get-MgBetaIdentityConditionalAccessAuthenticationContextClassReference", "Get-MgBetaIdentityConditionalAccessNamedLocation", "Get-MgBetaIdentityConditionalAccessPolicy", "Get-MgBetaPolicyAuthenticationStrengthPolicy", "Get-MgGroup", "Get-MgDirectoryRoleTemplate", "Get-MgUser"]'::jsonb
  WHERE id = 9395 AND resource_key = 'graph:v1.0:/identity/conditionalAccess/deletedItems/policies';

UPDATE config_resources SET read_cmdlets = '["Get-MgBetaPolicyCrossTenantAccessPolicyDefault", "Get-MgGroup", "Get-MgUser"]'::jsonb
  WHERE id = 9585 AND resource_key = 'graph:v1.0:/policies/crossTenantAccessPolicy/default';

UPDATE config_resources SET read_cmdlets = '["Get-MgBetaPolicyDeviceRegistrationPolicy", "Get-MgGroup", "Get-MgUser"]'::jsonb
  WHERE id = 9579 AND resource_key = 'graph:v1.0:/policies/deviceRegistrationPolicy';

UPDATE config_resources SET read_cmdlets = '["Get-MgBetaRoleManagementDirectoryRoleDefinition", "Get-MgBetaPolicyAdminConsentRequestPolicy", "Get-MgGroup", "Get-MgUser"]'::jsonb
  WHERE id = 9642 AND resource_key = 'graph:v1.0:/roleManagement/directory/roleAssignments';

UPDATE config_resources SET read_cmdlets = '["Get-MgUser", "Get-Team", "Get-TeamUser", "Get-CompareParameters"]'::jsonb
  WHERE id = 9267 AND resource_key = 'graph:v1.0:/teams';

UPDATE config_resources SET read_cmdlets = '["Get-MgBetaSubscribedSku", "Get-MgBetaRoleManagementDirectoryRoleAssignment", "Get-MgBetaRoleManagementDirectoryRoleDefinition", "Get-MgGroup", "Get-MgUser", "Get-CompareParameters", "Get-CustomSecurityAttributes"]'::jsonb
  WHERE id = 9237 AND resource_key = 'graph:v1.0:/users';

UPDATE config_resources SET read_cmdlets = '["Get-MgBetaDeviceManagementAssignmentFilter", "Get-MgBetaDeviceAppManagementMobileApp", "Get-MgBetaDeviceAppManagementMobileAppAssignment", "Get-MgBetaDeviceAppManagementMobileAppCategory", "Get-MgGroup", "Get-CompareParameters"]'::jsonb
  WHERE id = 10586 AND resource_key = 'm365dsc:IntuneMobileAppsWindowsOfficeSuiteApp';

-- power-platform (6)
UPDATE config_resources SET read_cmdlets = '["Invoke-WebRequest"]'::jsonb
  WHERE id = 10637 AND resource_key = 'm365dsc:PPAdminDLPPolicy';

UPDATE config_resources SET read_cmdlets = '["Get-MgContext"]'::jsonb
  WHERE id = 10638 AND resource_key = 'm365dsc:PPDLPPolicyConnectorConfigurations';

UPDATE config_resources SET read_cmdlets = '["Get-MgContext"]'::jsonb
  WHERE id = 10639 AND resource_key = 'm365dsc:PPPowerAppPolicyUrlPatterns';

UPDATE config_resources SET read_cmdlets = '["Invoke-WebRequest"]'::jsonb
  WHERE id = 10640 AND resource_key = 'm365dsc:PPPowerAppsEnvironment';

UPDATE config_resources SET read_cmdlets = '["Get-MgContext", "Get-M365TenantId"]'::jsonb
  WHERE id = 10641 AND resource_key = 'm365dsc:PPTenantIsolationSettings';

UPDATE config_resources SET read_cmdlets = '["Invoke-WebRequest"]'::jsonb
  WHERE id = 10642 AND resource_key = 'm365dsc:PPTenantSettings';

-- sharepoint-admin (2)
UPDATE config_resources SET read_cmdlets = '["Get-PnPSearchConfiguration"]'::jsonb
  WHERE id = 10696 AND resource_key = 'm365dsc:SPOSearchManagedProperty';

UPDATE config_resources SET read_cmdlets = '["Get-MgAdminSharepointSetting", "Get-PnPTenant", "Get-CompareParameters"]'::jsonb
  WHERE id = 10707 AND resource_key = 'm365dsc:SPOTenantSettings';

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-04-fix-connection-helper-read-cmdlets-nonpowershell-2839.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
