-- #1896: 12 powershell-transport config_resources rows cited
-- Get-MSCloudLoginConnectionProfile as a read_cmdlets entry. That function is
-- Microsoft365DSC's own internal connection-setup helper (called inside
-- Get-TargetResource to establish the session before the resource's real read
-- call) -- not a real exported PowerShell session cmdlet. It cannot appear in
-- a real capability survey or catalog match.
--
-- For each row below, the real read_cmdlets value was determined by reading
-- the resource's actual Get-TargetResource source in
-- microsoft/Microsoft365DSC@f79f297 (the same commit this catalog's
-- source_ref cites) and following the call chain past the connection helper
-- to the real cmdlet that performs the read:
--
--   AADIdentityProtectionPolicySettings           -> Invoke-MgGraphRequest (direct GET call)
--   AADOnPremisesPublishingProfilesSettings        -> Invoke-MgGraphRequest (direct GET call)
--   AADVerifiedIdAuthority                         -> Invoke-WebRequest (Invoke-M365DSCVerifiedIdWebRequest
--                                                      wraps Invoke-WebRequest directly, no exported
--                                                      intermediate cmdlet)
--   AADVerifiedIdAuthorityContract                 -> Invoke-WebRequest (same helper as above)
--   AzureVerifiedIdFaceCheck                       -> Get-AzResourceGroup (already correct, kept) +
--                                                      Invoke-AzRestMethod (real Az.Accounts cmdlet,
--                                                      replaces the connection helper)
--   CommerceSelfServicePurchase                    -> Invoke-WebRequest (Invoke-M365DSCLicensingWebRequest,
--                                                      Modules/WorkloadHelpers/M365DSCLicensingHelper.psm1,
--                                                      wraps Invoke-WebRequest directly)
--   DefenderRoleDefinition                         -> Invoke-MgGraphRequest (direct GET call)
--   FabricAdminTenantSettings                      -> Invoke-WebRequest (Invoke-M365DSCFabricWebRequest,
--                                                      Modules/WorkloadHelpers/M365DSCFabricHelper.psm1,
--                                                      wraps Invoke-WebRequest directly)
--   IntuneCorporateDeviceIdentifier                -> Invoke-MgGraphRequest (direct GET call)
--   IntuneDeviceManagementComplianceSettings       -> Invoke-MgGraphRequest (direct GET call)
--   IntuneDeviceManagementDeviceDiagnosticSettings -> Invoke-MgGraphRequest (direct GET call)
--   SHSpaceUser                                    -> Invoke-WebRequest (Invoke-M365DSCServicesHubWebRequest,
--                                                      Modules/WorkloadHelpers/M365DSCServicesHubHelper.psm1,
--                                                      wraps Invoke-WebRequest directly)
--
-- Note: EXOManagementRoleAssignment (id 10430) also cited the connection helper
-- alongside real cmdlets, but its notes already show it was reconciled against
-- #1793's survey via Get-ManagementRoleAssignment -- out of scope for this fix.

BEGIN;

UPDATE config_resources SET read_cmdlets = '["Invoke-MgGraphRequest"]'::jsonb
  WHERE id = 10333 AND resource_key = 'm365dsc:AADIdentityProtectionPolicySettings';

UPDATE config_resources SET read_cmdlets = '["Invoke-MgGraphRequest"]'::jsonb
  WHERE id = 10340 AND resource_key = 'm365dsc:AADOnPremisesPublishingProfilesSettings';

UPDATE config_resources SET read_cmdlets = '["Invoke-WebRequest"]'::jsonb
  WHERE id = 10353 AND resource_key = 'm365dsc:AADVerifiedIdAuthority';

UPDATE config_resources SET read_cmdlets = '["Invoke-WebRequest"]'::jsonb
  WHERE id = 10354 AND resource_key = 'm365dsc:AADVerifiedIdAuthorityContract';

UPDATE config_resources SET read_cmdlets = '["Get-AzResourceGroup", "Invoke-AzRestMethod"]'::jsonb
  WHERE id = 10370 AND resource_key = 'm365dsc:AzureVerifiedIdFaceCheck';

UPDATE config_resources SET read_cmdlets = '["Invoke-WebRequest"]'::jsonb
  WHERE id = 10371 AND resource_key = 'm365dsc:CommerceSelfServicePurchase';

UPDATE config_resources SET read_cmdlets = '["Invoke-MgGraphRequest"]'::jsonb
  WHERE id = 10373 AND resource_key = 'm365dsc:DefenderRoleDefinition';

UPDATE config_resources SET read_cmdlets = '["Invoke-WebRequest"]'::jsonb
  WHERE id = 10473 AND resource_key = 'm365dsc:FabricAdminTenantSettings';

UPDATE config_resources SET read_cmdlets = '["Invoke-MgGraphRequest"]'::jsonb
  WHERE id = 10501 AND resource_key = 'm365dsc:IntuneCorporateDeviceIdentifier';

UPDATE config_resources SET read_cmdlets = '["Invoke-MgGraphRequest"]'::jsonb
  WHERE id = 10550 AND resource_key = 'm365dsc:IntuneDeviceManagementComplianceSettings';

UPDATE config_resources SET read_cmdlets = '["Invoke-MgGraphRequest"]'::jsonb
  WHERE id = 10551 AND resource_key = 'm365dsc:IntuneDeviceManagementDeviceDiagnosticSettings';

UPDATE config_resources SET read_cmdlets = '["Invoke-WebRequest"]'::jsonb
  WHERE id = 10687 AND resource_key = 'm365dsc:SHSpaceUser';

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-04-fix-connection-helper-read-cmdlets-1896.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
