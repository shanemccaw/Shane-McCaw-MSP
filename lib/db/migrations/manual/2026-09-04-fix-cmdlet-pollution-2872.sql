-- #2872: two more instances of the fake-cmdlet-citation pollution class #1896/#2839 fixed.
--
-- (1) 34 powershell-transport config_resources rows cite Get-MSCloudLoginConnectionProfile.
--     These are NOT the 12 rows #1896 fixed nor the 31 rows #2839 fixed -- confirmed distinct
--     resource_keys. They exist because #1960's migration
--     (2026-09-04-config-resource-graph-transport-1960.sql, commit 9c79b3174) reclassified 193
--     rows from read_transport='graph' to 'powershell', carrying their already-polluted
--     read_cmdlets values along with the transport change. Same root pollution as #1896/#2839:
--     Get-MSCloudLoginConnectionProfile is Microsoft365DSC's own internal connection-setup
--     helper, not a real read cmdlet. Live query, run 2026-09-04:
--
--       SELECT count(*) FROM config_resources
--       WHERE read_cmdlets @> '["Get-MSCloudLoginConnectionProfile"]'::jsonb
--         AND read_transport = 'powershell';
--       -- 34
--
--     Every one of the 34 rows already carries at least one real cmdlet elsewhere in its
--     read_cmdlets array (verified individually against the live data), so per #1896/#2839's own
--     precedent (only drop the fake entry when a real cmdlet already appears elsewhere) the fix
--     is a plain removal of the fake element -- no row needed a full-array replacement.
--
-- (2) Get-CompareParameters (and Get-M365TenantId) are also fake read-cmdlet citations.
--     Get-CompareParameters is a locally-defined, Export-ModuleMember'd helper every M365DSC
--     resource's Test-TargetResource uses purely for property comparison -- it is never called
--     from Get-TargetResource and performs no read. Confirmed generically (same shape across
--     every resource that defines it) and spot-verified against several resources' real
--     Get-TargetResource bodies at Microsoft365DSC/Microsoft365DSC@f79f297 (the commit this
--     catalog's source_ref cites). Get-M365TenantId (PPTenantIsolationSettings only) is a
--     locally-defined helper in that resource's own .psm1 used inside Get-TargetResource only to
--     translate a TenantName string to a GUID for result formatting/comparison, not to read the
--     resource itself -- same shape of pollution.
--
--     123 rows cite Get-CompareParameters (azure-rm 7, graph 25, powershell 85,
--     sharepoint-admin 6); 1 row (PPTenantIsolationSettings) cites Get-M365TenantId. Of those,
--     118 (Get-CompareParameters) + 1 (Get-M365TenantId) already carry a real cmdlet elsewhere
--     and just have the fake entry dropped. 5 rows had Get-CompareParameters as their ONLY
--     entry; each was traced to its real Get-TargetResource read call at the cited commit:
--
--       AzureBillingAccountsAssociatedTenant  -> Invoke-AzRestMethod
--         (Get-M365DSCAzureBillingAccount[sAssociatedTenant] in
--         Modules/Microsoft365DSC/Modules/WorkloadHelpers/M365DSCAzureHelper.psm1 wraps
--         Invoke-AzRestMethod directly -- same helper #2839 already traced for the sibling
--         AzureBillingAccountPolicy/AzureBillingAccountScheduledAction resources)
--       IntuneDeviceControlPolicySetting      -> Invoke-MgGraphRequest (direct GET call)
--       IntuneEpmCertificatePolicySetting     -> Invoke-MgGraphRequest (direct GET call)
--       IntuneFirewallPolicySetting           -> Invoke-MgGraphRequest (direct GET call)
--       DefenderDeviceAuthenticatedScanDefinition -> Invoke-WebRequest
--         (Invoke-M365DSCDefenderREST, Modules/Microsoft365DSC/Modules/WorkloadHelpers/
--         M365DSCDefenderHelper.psm1, wraps Invoke-WebRequest directly)
--
-- Both bulk drops use the jsonb `-` operator (removes a matching scalar array element by value)
-- rather than retyping each row's full array by hand -- lower risk of a transcription error
-- across ~150 affected rows than #1896/#2839's per-row literal-array approach, and verified
-- beforehand that removing all three fake names from every targeted row's array never leaves it
-- empty except for the 5 rows handled explicitly below.

BEGIN;

-- (1) 34 powershell-transport rows citing the connection helper -- drop the fake entry only.
UPDATE config_resources
SET read_cmdlets = read_cmdlets - 'Get-MSCloudLoginConnectionProfile'
WHERE read_cmdlets @> '["Get-MSCloudLoginConnectionProfile"]'::jsonb
  AND read_transport = 'powershell';

-- (2a) Get-CompareParameters -- drop the fake entry where a real cmdlet already exists.
UPDATE config_resources
SET read_cmdlets = read_cmdlets - 'Get-CompareParameters'
WHERE read_cmdlets @> '["Get-CompareParameters"]'::jsonb
  AND read_cmdlets <> '["Get-CompareParameters"]'::jsonb;

-- (2b) Get-M365TenantId -- drop the fake entry (PPTenantIsolationSettings already has Get-MgContext).
UPDATE config_resources
SET read_cmdlets = read_cmdlets - 'Get-M365TenantId'
WHERE read_cmdlets @> '["Get-M365TenantId"]'::jsonb
  AND read_cmdlets <> '["Get-M365TenantId"]'::jsonb;

-- (2c) The 5 rows where Get-CompareParameters was the ONLY entry -- replace with the real
-- traced read cmdlet.
UPDATE config_resources SET read_cmdlets = '["Invoke-AzRestMethod"]'::jsonb
  WHERE id = 10360 AND resource_key = 'm365dsc:AzureBillingAccountsAssociatedTenant';

UPDATE config_resources SET read_cmdlets = '["Invoke-MgGraphRequest"]'::jsonb
  WHERE id = 10544 AND resource_key = 'm365dsc:IntuneDeviceControlPolicySetting';

UPDATE config_resources SET read_cmdlets = '["Invoke-MgGraphRequest"]'::jsonb
  WHERE id = 10562 AND resource_key = 'm365dsc:IntuneEpmCertificatePolicySetting';

UPDATE config_resources SET read_cmdlets = '["Invoke-MgGraphRequest"]'::jsonb
  WHERE id = 10566 AND resource_key = 'm365dsc:IntuneFirewallPolicySetting';

UPDATE config_resources SET read_cmdlets = '["Invoke-WebRequest"]'::jsonb
  WHERE id = 10372 AND resource_key = 'm365dsc:DefenderDeviceAuthenticatedScanDefinition';

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-04-fix-cmdlet-pollution-2872.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
