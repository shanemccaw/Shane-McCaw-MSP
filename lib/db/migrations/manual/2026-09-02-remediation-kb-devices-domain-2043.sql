-- #2043 — Remediation knowledge base: the devices: domain, authored & published.
--
-- Populates remediation_knowledge_base with verified "this is wrong → here is how
-- to fix it" content for EVERY active devices: check (12 rows). Follows the
-- authoring standard set by #1924 (see the identity: domain migration,
-- 2026-08-31-remediation-kb-identity-domain-1924.sql, commit 5d850839b) exactly.
--
-- AUTHORING STANDARD (see #1924, applied to the devices: domain by #2043):
--   * Every row is verified against real Microsoft Learn / official Microsoft docs
--     that were actually fetched in build session #2043 (2026-09-02). The URLs in
--     source_urls are those pages. Research was split across 4 parallel agents,
--     each fetching real Microsoft Learn/Graph docs for 3 checks; this file was
--     authored from their fetched findings.
--   * verified_by is an HONEST AGENT attribution — never a human name. The content
--     is agent-authored and awaiting a human spot-check (filed as a Shane To-Do).
--   * Tenant-specific values use angle-bracket placeholders (<PolicyDisplayName>, …),
--     never a fabricated real value.
--   * fix_route_capability is the finding-side CEILING (#1539). Unlike Conditional
--     Access policies (identity: domain), most Intune device-configuration/compliance
--     objects require a SEPARATE group-assignment step after creation before they
--     have any real effect — an unassigned profile fixes nothing. Where the authored
--     script only creates the object and a genuine, unverified assignment step still
--     stands between it and a real fix, this file honestly uses admin_center_only
--     rather than overclaiming you_must_run. devices:stale-duplicate-records is the
--     one row where the authored script is a complete, self-contained fix (disable →
--     grace period → delete, no separate assignment concept applies) and is marked
--     you_must_run accordingly — flagged there as destructive.
--
-- KNOWN FINDING (not fixed here, out of scope for a KB-content issue): the
-- devices:kfm-configuration check's own detection query, GET
-- /deviceManagement/deviceConfigurations, cannot structurally return a Known Folder
-- Move policy — real KFM objects live under /deviceManagement/groupPolicyConfigurations
-- (Administrative Templates) or /deviceManagement/configurationPolicies (Settings
-- Catalog), confirmed against Microsoft's own Graph resource docs and a real,
-- fetched Microsoft tutorial. See the row's own notes field, and the filed GitHub
-- issue referenced in build-journal/2043.md.
--
-- Idempotent: keyed on check_key via ON CONFLICT DO UPDATE, safe to re-run. Additive
-- content only — no schema change (#1539 already built the columns).

BEGIN;

INSERT INTO remediation_knowledge_base (
  check_key, title, summary, prerequisites, admin_center_path, admin_center_url,
  remediation_steps, expected_outcome, validation_step, validation_command,
  source_urls, verified_against, last_verified_at, verified_by, status, fix_route_capability, notes
) VALUES

-- ─────────────────────────────────────────────────────────────────────────────
-- CLUSTER: App/device provisioning coverage
-- ─────────────────────────────────────────────────────────────────────────────

(
  'devices:app-protection-coverage',
  $ttl$Deploy Intune app protection (MAM) policies to protect corporate data on mobile apps$ttl$,
  $sum$No app protection policies exist in Intune, so no mobile app on any device — enrolled or not — has any control over how corporate data is accessed, copied, or shared. App protection policy is the only mechanism that protects data on BYOD/unenrolled personal devices, since device-level (MDM) controls simply don't apply there. Without a policy, a user could open a work email attachment on a personal phone and freely copy or forward that data into a personal app, with no PIN requirement, no encryption, and no ability to selectively wipe just the corporate data if the phone is lost.$sum$,
  jsonb_build_array(
    $prq$Application Manager Intune RBAC role (or Intune Administrator)$prq$,
    $prq$A Microsoft Intune license assigned to each targeted user; for Microsoft 365 Apps targets, Microsoft 365 Apps for business/enterprise and (where OneDrive is the save location) a OneDrive for work or school account$prq$,
    $prq$Intune Company Portal app installed on the device — required on Android to receive policy at all$prq$,
    $prq$Microsoft Graph PowerShell SDK module Microsoft.Graph.Devices.CorporateManagement, scope DeviceManagementApps.ReadWrite.All, if automating$prq$
  ),
  $apath$Microsoft Intune admin center → Apps → Protection → Create policy → select iOS/iPadOS or Android$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Decide platform scope (iOS/iPadOS and/or Android) and which apps the policy targets (All apps, Microsoft apps, Core Microsoft apps, or selected apps).$stp$),
    jsonb_build_object('text', $stp$Create the protection object itself via Graph PowerShell (Android example; an equivalent New-MgDeviceAppManagementIosManagedAppProtection exists for iOS/iPadOS):$stp$, 'code', $cod$Import-Module Microsoft.Graph.Devices.CorporateManagement
Connect-MgGraph -Scopes 'DeviceManagementApps.ReadWrite.All'
$params = @{
  displayName = "<PolicyDisplayName>"
  periodOfflineBeforeWipeIsEnforced = "P90D"
  pinRequired = $true
  allowedInboundDataTransferSources = "managedApps"
  allowedOutboundDataTransferDestinations = "managedApps"
  saveAsBlocked = $true
  dataBackupBlocked = $true
}
New-MgDeviceAppManagementAndroidManagedAppProtection -BodyParameter $params$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$The cmdlet above creates the protection rules but not app targeting or group assignment — those require nested Graph schema objects impractical to hand-build reliably in PowerShell, so complete the policy in the admin center: Apps → Protection → Create policy walks through Apps, Data protection, Access requirements, Conditional launch and Assignments in one guided flow.$stp$),
    jsonb_build_object('text', $stp$Assign the policy to a group containing users (app protection policies target user groups, not device groups) and confirm IsAssigned = true.$stp$)
  ),
  $eo$At least one app protection policy exists, targets real apps, and is assigned to a user group, so PIN/encryption/data-transfer restrictions apply to corporate data inside those apps regardless of whether the device itself is enrolled in Intune.$eo$,
  $vs$Confirm a managed app policy exists and is assigned, then confirm on a real device that the targeted app now prompts for a PIN when accessing the work account.$vs$,
  $vc$Get-MgDeviceAppManagementManagedAppPolicy$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/intune/app-management/protection/overview$url$,
    $url$https://learn.microsoft.com/en-us/intune/app-management/protection/create-policy$url$,
    $url$https://learn.microsoft.com/en-us/powershell/module/microsoft.graph.devices.corporatemanagement/new-mgdeviceappmanagementandroidmanagedappprotection?view=graph-powershell-1.0$url$,
    $url$https://learn.microsoft.com/en-us/powershell/module/microsoft.graph.devices.corporatemanagement/get-mgdeviceappmanagementmanagedapppolicy?view=graph-powershell-1.0$url$
  ),
  $vag$Microsoft Graph PowerShell SDK v1.0 GA (Microsoft.Graph.Devices.CorporateManagement), Microsoft Learn, fetched 2026-09-02$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2043) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'admin_center_only',
  $note$App protection is independent of MDM enrollment and is the only real data-loss-prevention layer available on unenrolled/BYOD devices. Windows app protection uses a different settings model than iOS/Android and is not covered by the cmdlet above. The legacy tenant-wide OneDrive/SharePoint "Global policy" at admin.onedrive.com is no longer updated by Microsoft — do not recommend it as the fix.$note$
),

(
  'devices:autopilot-coverage',
  $ttl$Create and assign a Windows Autopilot deployment profile for automated device provisioning$ttl$,
  $sum$No Windows Autopilot deployment profiles exist, so new devices registered to this tenant have nothing to provision them automatically. If a device is registered in Autopilot but no profile is assigned, it receives Microsoft's factory-default profile rather than the org's configured OOBE and security posture; a device not registered at all falls back to a fully manual out-of-box setup where whoever unboxes the machine chooses account type, join type and privacy settings themselves — the exact zero-touch gap Autopilot exists to close, including forcing Microsoft Entra join and hiding the "Change account" escape hatch used to bypass company branding.$sum$,
  jsonb_build_array(
    $prq$Any qualifying license: Microsoft 365 Business Premium, M365 F1/F3, M365 A1/A3/A5, M365 E3/E5, EMS E3/E5, Intune for Education, or Microsoft Entra ID P1/P2 + Microsoft Intune — plus an Intune license assigned to each enrolling user$prq$,
    $prq$Policy and Profile Manager Intune RBAC role (or Intune Administrator)$prq$,
    $prq$Target devices already registered as Autopilot devices (hardware hash uploaded or OEM-registered) — a deployment profile has nothing to attach to otherwise$prq$,
    $prq$Microsoft Entra ID P1 if using dynamic device groups for profile assignment$prq$
  ),
  $apath$Microsoft Intune admin center → Devices → Windows → Enrollment → Windows Autopilot → Deployment Profiles → Create Profile → Windows PC$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Confirm the target devices are already registered with Windows Autopilot (a separate prerequisite from profile creation).$stp$),
    jsonb_build_object('text', $stp$Create the profile in the admin center — Devices → Windows → Enrollment → Windows Autopilot → Deployment Profiles → Create Profile → Windows PC — and set Deployment mode (User-driven or Self-deploying), Join type (Microsoft Entra joined), and out-of-box-experience options (EULA, privacy, account type, device naming template).$stp$),
    jsonb_build_object('text', $stp$Assign the profile to the device group containing the registered Autopilot devices.$stp$),
    jsonb_build_object('text', $stp$A Graph SDK cmdlet for this resource, New-MgBetaDeviceManagementWindowsAutopilotDeploymentProfile, exists only in the beta module Microsoft.Graph.Beta.DeviceManagement.Enrollment — confirmed against the full GA (v1.0) module index that no equivalent exists there. Treat the beta cmdlet as an optional advanced path only for tenants that already accept beta Graph SDK cmdlets in production:$stp$, 'code', $cod$Import-Module Microsoft.Graph.Beta.DeviceManagement.Enrollment
Connect-MgGraph -Scopes 'DeviceManagementServiceConfig.ReadWrite.All'
$params = @{
  "@odata.type" = "#microsoft.graph.azureADWindowsAutopilotDeploymentProfile"
  displayName = "<ProfileDisplayName>"
  deviceNameTemplate = "<DeviceNameTemplate>"
  outOfBoxExperienceSetting = @{
    deviceUsageType = "singleUser"
    userType = "standard"
    eulaHidden = $true
    hidePrivacySettings = $true
  }
}
New-MgBetaDeviceManagementWindowsAutopilotDeploymentProfile -BodyParameter $params$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Confirm rollout by watching each device's Profile Status move from Unassigned → Assigning → Assigned under Windows Autopilot → Devices; allow up to 48 hours for newly-registered devices to pick up the assignment.$stp$)
  ),
  $eo$At least one Autopilot deployment profile exists, is assigned to a device group, and registered Autopilot devices show Profile Status = Assigned.$eo$,
  $vs$Open the profile in the admin center and confirm it exists and is assigned; check Windows Autopilot → Devices for Profile Status = Assigned on the target devices.$vs$,
  NULL,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/autopilot/profiles$url$,
    $url$https://learn.microsoft.com/en-us/autopilot/requirements$url$,
    $url$https://learn.microsoft.com/en-us/powershell/module/microsoft.graph.devicemanagement.enrollment/?view=graph-powershell-1.0$url$,
    $url$https://learn.microsoft.com/en-us/powershell/module/microsoft.graph.beta.devicemanagement.enrollment/new-mgbetadevicemanagementwindowsautopilotdeploymentprofile?view=graph-powershell-beta$url$
  ),
  $vag$Microsoft Graph PowerShell SDK v1.0 GA module index for Microsoft.Graph.DeviceManagement.Enrollment (confirmed no deployment-profile cmdlet exists at GA) versus Microsoft.Graph.Beta.DeviceManagement.Enrollment, Microsoft Learn, fetched 2026-09-02$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2043) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'admin_center_only',
  $note$No GA (v1.0) cmdlet exists to list deployment profiles either — only the beta Get-MgBetaDeviceManagementWindowsAutopilotDeploymentProfile does, hence no validation_command rather than an unverified one. Up to 350 deployment profiles are allowed per tenant. Deprecated beta properties EnableWhiteGlove/ExtractHardwareHash/Language were replaced by PreprovisioningAllowed/HardwareHashExtractionEnabled/Locale in May 2024 — use the new names if the beta cmdlet is ever used.$note$
),

(
  'devices:compliance-policy-coverage',
  $ttl$Create device compliance policies so Intune can enforce and report device health$ttl$,
  $sum$No device compliance policies exist, meaning Intune has no defined bar for what counts as a healthy device — every enrolled device silently reports Not evaluated, not merely "unknown." If the org later turns on Conditional Access requiring compliant devices, access would be blocked tenant-wide until policies exist, because that grant checks Intune's compliance verdict and the verdict currently has no rules to evaluate against. Compliance policies are also what let noncompliance trigger automatic actions — notify the user, lock, or retire the device.$sum$,
  jsonb_build_array(
    $prq$Policy and Profile Manager Intune RBAC role (or Endpoint Security Manager, which covers compliance as part of its broader scope)$prq$,
    $prq$Microsoft Intune subscription; Microsoft Entra ID P1 or P2 if the policy will be enforced via Conditional Access$prq$,
    $prq$Devices must already be enrolled in Intune — compliance can only be evaluated for enrolled devices$prq$,
    $prq$Microsoft Graph PowerShell SDK module Microsoft.Graph.DeviceManagement, scope DeviceManagementConfiguration.ReadWrite.All, if automating$prq$
  ),
  $apath$Microsoft Intune admin center → Devices → Compliance → Create policy → select platform$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Pick the platform(s) actually present in the fleet — Windows 10/11, iOS/iPadOS, Android Enterprise, macOS and Linux are separately-typed policies, so one policy per platform in use is normal.$stp$),
    jsonb_build_object('text', $stp$The compliance-rule object itself can be created via Graph PowerShell, confirmed against the module's own documented parameter set (Windows example; the cmdlet requires exactly one block scheduled action):$stp$, 'code', $cod$Import-Module Microsoft.Graph.DeviceManagement
Connect-MgGraph -Scopes 'DeviceManagementConfiguration.ReadWrite.All'
$params = @{
  "@odata.type" = "#microsoft.graph.windows10CompliancePolicy"
  displayName = "<CompliancePolicyDisplayName>"
  passwordRequired = $true
  passwordMinimumLength = 6
  osMinimumVersion = "<MinimumOSVersion>"
  bitLockerEnabled = $true
  scheduledActionsForRule = @(
    @{
      ruleName = "PasswordRequired"
      scheduledActionConfigurations = @(
        @{ actionType = "block"; gracePeriodHours = 0 }
      )
    }
  )
}
New-MgDeviceManagementDeviceCompliancePolicy -BodyParameter $params$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$This creates the rule object but not group assignment, a separate Graph call not independently confirmed as a clean cmdlet path in this session — an unassigned compliance policy evaluates no devices, so complete the rollout in the admin center: Devices → Compliance → Create policy walks through Compliance settings, Actions for noncompliance, and Assignments in one guided flow.$stp$),
    jsonb_build_object('text', $stp$Pair the policy with a Conditional Access policy requiring "Device marked as compliant" if the goal is real enforcement rather than reporting only — that's a separate policy, not part of this remediation.$stp$)
  ),
  $eo$At least one compliance policy exists per platform in use, is assigned to a device/user group, and enrolled devices evaluate to Compliant/NonCompliant/InGracePeriod instead of Not evaluated.$eo$,
  $vs$Confirm the policy shows a nonzero assigned-device count in the admin center, then confirm a real enrolled device's compliance status changes from Not evaluated to an actual value after its next check-in.$vs$,
  $vc$Get-MgDeviceManagementDeviceCompliancePolicy -ExpandProperty Assignments$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/intune/device-security/compliance/create-policy$url$,
    $url$https://learn.microsoft.com/en-us/powershell/module/microsoft.graph.devicemanagement/new-mgdevicemanagementdevicecompliancepolicy?view=graph-powershell-1.0$url$,
    $url$https://learn.microsoft.com/en-us/powershell/module/microsoft.graph.devicemanagement/get-mgdevicemanagementdevicecompliancepolicy?view=graph-powershell-1.0$url$
  ),
  $vag$Microsoft Graph PowerShell SDK v1.0 GA (Microsoft.Graph.DeviceManagement), Microsoft Learn, fetched 2026-09-02$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2043) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'admin_center_only',
  $note$Custom compliance settings (JSON + detection script) are a separate, more advanced configuration not covered by this base policy. Android Device Administrator (legacy DA) compliance policies are deprecated for GMS-capable devices — do not recommend that platform type in new policy.$note$
),

-- ─────────────────────────────────────────────────────────────────────────────
-- CLUSTER: Compliance state, encryption, patch currency
-- ─────────────────────────────────────────────────────────────────────────────

(
  'devices:compliant-vs-noncompliant',
  $ttl$Investigate and drive down the non-compliant device count$ttl$,
  $sum$Real enrolled devices are failing one or more compliance policy rules. A noncompliant device is not just a dashboard number — every compliance policy's default action is "Mark device noncompliant" scheduled at zero days, and a tenant using Conditional Access with "require device compliant" can then block that device from organizational resources immediately. Left uninvestigated, the noncompliant count either represents users silently losing access, or a tenant-wide setting problem: by default Intune treats devices with no compliance policy assigned as compliant, which can mask real gaps unless changed.$sum$,
  jsonb_build_array(
    $prq$Policy and Profile Manager or Endpoint Security Manager Intune RBAC role$prq$,
    $prq$Microsoft Intune subscription; Microsoft Entra ID P1/P2 if Conditional Access will act on the compliance signal$prq$,
    $prq$Microsoft Graph PowerShell SDK module Microsoft.Graph.DeviceManagement, scope DeviceManagementManagedDevices.Read.All$prq$
  ),
  $apath$Microsoft Intune admin center → Devices → Compliance → Monitor → Device compliance status (Noncompliant devices tile); tenant-wide default at Endpoint security → Device compliance → Compliance policy settings$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Rule out a false signal first — open Endpoint security → Device compliance → Compliance policy settings and check "Mark devices with no compliance policy assigned as." If it is still the default Compliant, devices with zero assigned policy are hiding inside the compliant count; set it to Not compliant if Conditional Access is or will be in use.$stp$),
    jsonb_build_object('text', $stp$Open Devices → Compliance → Monitor → Device compliance status and drill into the Noncompliant devices tile for the real device list, then use each policy's Per-setting status view to see which specific setting is failing and how many devices fail it.$stp$),
    jsonb_build_object('text', $stp$Check each noncompliant device's Last contacted / check-in recency — a device that hasn't checked in past the tenant's Compliance status validity period (default 30 days, configurable 1-120) is automatically marked noncompliant, a stale-device problem rather than a real configuration gap.$stp$),
    jsonb_build_object('text', $stp$Pull the real noncompliant list programmatically for tracking:$stp$, 'code', $cod$Import-Module Microsoft.Graph.DeviceManagement
Connect-MgGraph -Scopes 'DeviceManagementManagedDevices.Read.All'
Get-MgDeviceManagementManagedDevice -Filter "complianceState eq 'noncompliant'" -All$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Fix each real (non-stale) failure at its source — an OS-version failure needs the device updated (see devices:os-patch-compliance), a password-policy failure needs a compliant PIN, an encryption failure needs a disk-encryption policy (see devices:encryption-status) — then add a scheduled Send email to end user action under the policy's Actions for noncompliance so users get a warning before Conditional Access can block them.$stp$)
  ),
  $eo$Every managed device has at least one compliance policy assigned, the tenant-wide default correctly marks unpolicied devices as noncompliant rather than hiding them, and the noncompliant count reflects real, attributable, actively-tracked issues rather than stale check-ins.$eo$,
  $vs$Reopen Devices → Compliance → Monitor → Device compliance status and confirm the Noncompliant tile count has dropped to the expected remaining cohort; spot-check a previously-noncompliant device's Per-setting status entry to confirm it now reports Compliant.$vs$,
  $vc$Get-MgDeviceManagementManagedDevice -Filter "complianceState eq 'noncompliant'" -All -CountVariable nonCompliantCount$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/intune/device-security/compliance/overview$url$,
    $url$https://learn.microsoft.com/en-us/intune/device-security/compliance/monitor-policy$url$,
    $url$https://learn.microsoft.com/en-us/intune/device-security/compliance/configure-noncompliance-actions$url$,
    $url$https://learn.microsoft.com/en-us/graph/api/resources/intune-devices-manageddevice?view=graph-rest-1.0$url$
  ),
  $vag$Microsoft Graph REST v1.0 managedDevice resource, Microsoft.Graph.DeviceManagement PowerShell SDK, Microsoft Learn, fetched 2026-09-02$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2043) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'admin_center_only',
  $note$Investigating why a specific device is noncompliant and remediating it (policy edit, user action, OS upgrade) is inherently an admin/device-level workflow — a script can enumerate noncompliant devices but cannot itself force one into compliance.$note$
),

(
  'devices:encryption-status',
  $ttl$Enforce disk encryption (BitLocker / FileVault) on unencrypted managed devices$ttl$,
  $sum$Managed devices exist without disk encryption enabled. This is specifically about the policy that mandates encryption be ON — distinct from devices:bitlocker-key-escrow, which checks that an already-encrypted device's recovery key was actually backed up. An unencrypted device is a full data-exposure risk the moment it's lost or stolen: BitLocker exists specifically to encrypt the operating system volume and confirm a computer hasn't been tampered with even if left unattended, lost, or stolen.$sum$,
  jsonb_build_array(
    $prq$Endpoint Security Manager Intune RBAC role for policy creation; an RBAC role with Remote tasks → "Rotate BitLockerKeys (preview)" granted for per-device remote rotation$prq$,
    $prq$Windows edition/licensing tier that supports BitLocker management (Pro/Enterprise/Education, not Home); macOS 10.13+ for FileVault$prq$,
    $prq$TPM chip present on Windows devices for encryption readiness$prq$
  ),
  $apath$Microsoft Intune admin center → Endpoint security → Disk encryption → Create Policy (Platform Windows → Profile BitLocker, or Platform macOS → Profile FileVault); status via Devices → Monitor → Encryption report$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Open the encryption report and review Encryption readiness per device — Ready (TPM present, OS meets minimum version), Not ready (missing TPM activation or below minimum), or Not applicable.$stp$),
    jsonb_build_object('text', $stp$For Ready devices with no encryption profile applied, create one at Endpoint security → Disk encryption → Create Policy (Platform Windows, Profile BitLocker); configure the encryption method for OS/fixed/removable drives and TPM startup authentication, then assign to the target device group. For macOS, use Platform macOS, Profile FileVault, and set FileVault = Enable.$stp$),
    jsonb_build_object('text', $stp$For silent (no user-interaction) enforcement, set Require Device Encryption = Enabled and Allow Warning For Other Disk Encryption = Disabled — but first audit for third-party encryption software via device inventory, since silent BitLocker skips the warning that normally protects against a conflicting encryption product and can cause boot failure or data loss if one is present.$stp$),
    jsonb_build_object('text', $stp$Also require encryption at the compliance layer, not just the configuration layer, so an unencrypted device is flagged noncompliant and can trigger Conditional Access: in the Windows compliance policy, set storageRequireEncryption = true ("Require encryption on Windows devices").$stp$),
    jsonb_build_object('text', $stp$For devices reporting Not ready, read the per-device Status details field in the encryption report for the specific blocking reason — TPM not available/disabled in firmware, Windows Recovery Environment not configured (fix via reagentc), or the OS volume reporting unprotected — and resolve that root cause rather than re-pushing the same policy.$stp$)
  ),
  $eo$Every Ready managed device carries an assigned BitLocker/FileVault policy and reports Encrypted; Not ready devices have a documented, actionable reason rather than silently sitting unencrypted; the compliance policy's storageRequireEncryption setting enforces this at the Conditional Access layer too.$eo$,
  $vs$Reopen the encryption report and confirm the previously-unencrypted device now shows Encryption status Encrypted with its assigned profile at Success; optionally confirm locally on a Windows device via manage-bde -status.$vs$,
  $vc$Get-MgDeviceManagementManagedDevice -Filter "isEncrypted eq false" -All$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/intune/device-configuration/endpoint-security/encrypt-bitlocker-windows$url$,
    $url$https://learn.microsoft.com/en-us/intune/device-configuration/endpoint-security/disk-encryption$url$,
    $url$https://learn.microsoft.com/en-us/intune/device-management/monitor-encryption$url$,
    $url$https://learn.microsoft.com/en-us/graph/api/resources/intune-devices-manageddevice?view=graph-rest-1.0$url$
  ),
  $vag$Microsoft Graph REST v1.0 managedDevice (isEncrypted) and windows10CompliancePolicy (storageRequireEncryption) resources, Microsoft Learn, fetched 2026-09-02$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2043) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'admin_center_only',
  $note$Encryption status can take up to 24 hours to report back to Intune after policy deployment, so devices flagged right after a rollout may just be in flight, not truly gapped.$note$
),

(
  'devices:os-patch-compliance',
  $ttl$Enroll devices and enforce a minimum supported OS build via update rings and compliance policy$ttl$,
  $sum$No devices are enrolled in Intune, so OS patch compliance can't be measured or enforced at all — the tenant has no visibility into whether its fleet is running supported, patched operating systems. Windows 10 reached end of support on 2025-10-14 and no longer receives quality or feature updates; a fleet with no enrollment has no mechanism to even detect a device still running an unsupported build, let alone push it current.$sum$,
  jsonb_build_array(
    $prq$Microsoft Intune Plan 1 license (stated licensing requirement for update ring policies)$prq$,
    $prq$Policy and Profile Manager Intune RBAC role$prq$,
    $prq$Windows Pro/Pro Education/Enterprise/Education/IoT Enterprise editions for full update-ring support (LTSC is quality-update-only)$prq$,
    $prq$The Microsoft Account Sign-In Assistant service (wlidsvc) running on the device, or feature updates will not be offered at all$prq$
  ),
  $apath$Microsoft Intune admin center → Devices → Windows → Manage updates → Windows updates → Update rings → Create profile; minimum-OS enforcement at Devices → Compliance → Create policy → Windows 10 and later → Compliance settings$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Confirm the underlying gap first — if genuinely zero devices are enrolled, MDM enrollment itself (see devices:enrollment-status) is the real blocker; patch compliance can't be measured before that's fixed.$stp$),
    jsonb_build_object('text', $stp$Create a Windows Update ring at Devices → Windows → Manage updates → Windows updates → Update rings → Create profile, staged as at least a pilot ring (short deferral, e.g. 0-3 days quality / 0-7 days feature) and a broad ring (real deferral up to 30 days) rather than one tenant-wide ring.$stp$),
    jsonb_build_object('text', $stp$Set Use deadline settings = Allow with a Deadline for quality updates and Deadline for feature updates (2-30 days each) and a Grace period (0-7 days), plus Auto reboot before deadline = Yes, so updates install automatically after a bounded delay instead of deferring indefinitely.$stp$),
    jsonb_build_object('text', $stp$Assign the pilot ring to a small IT/early-adopter device group first and the broad ring to the remaining population, excluding the pilot group from the broad ring.$stp$),
    jsonb_build_object('text', $stp$Layer a minimum OS version compliance policy on top — in a Windows compliance policy, set Minimum OS version (format major.minor.build.revision) so Intune reports any device below that build as noncompliant and can surface the upgrade path to the end user.$stp$)
  ),
  $eo$A Windows Update ring is assigned to every Windows device group with a bounded deferral and an enforced deadline rather than indefinite "notify only," and a minimum-OS-version compliance policy flags any device that falls behind.$eo$,
  $vs$In the update ring's Device and user check-in status report, confirm devices show a successful check-in and applied policy; in the compliance policy's Per-setting status view for the minimum-OS rule, confirm the noncompliant count trends toward zero.$vs$,
  $vc$Get-MgDeviceManagementManagedDevice -Property "deviceName,osVersion,operatingSystem" -All | Where-Object { $_.OperatingSystem -eq "Windows" }$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/intune/device-updates/manage-os-versions$url$,
    $url$https://learn.microsoft.com/en-us/intune/device-updates/windows/manage-update-rings$url$,
    $url$https://learn.microsoft.com/en-us/intune/device-updates/windows/ref-update-ring-settings$url$,
    $url$https://learn.microsoft.com/en-us/graph/api/resources/intune-deviceconfig-windows10compliancepolicy?view=graph-rest-1.0$url$
  ),
  $vag$Microsoft Intune Learn docs (manage-os-versions, manage-update-rings, ref-update-ring-settings), Graph REST v1.0 windows10CompliancePolicy resource, fetched 2026-09-02$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2043) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'admin_center_only',
  $note$No Graph PowerShell SDK cmdlet for creating a Windows Update ring specifically (the windowsUpdateForBusinessConfiguration resource) was independently confirmed with a Microsoft-published example in this session, so this remediation is authored admin-center-first rather than claiming an unverified script.$note$
),

-- ─────────────────────────────────────────────────────────────────────────────
-- CLUSTER: Enrollment, OneDrive KFM, update ring configuration
-- ─────────────────────────────────────────────────────────────────────────────

(
  'devices:enrollment-status',
  $ttl$Turn on and configure automatic MDM enrollment in Microsoft Intune$ttl$,
  $sum$No devices are enrolled, so Intune is not actually managing any endpoint in this tenant — no compliance policies, no configuration profiles, no remote wipe/lock, no visibility into patch or encryption state are being enforced anywhere, even if profiles exist on paper. An MDM authority must be explicitly set before any device can enroll at all, and automatic enrollment is a separate, additional step — devices don't self-enroll just because a tenant has Intune licensing. This is the single most fundamental device-management gap: everything else in this domain is inert until it's fixed.$sum$,
  jsonb_build_array(
    $prq$Microsoft Entra ID Global Administrator role to set the MDM authority and configure automatic enrollment$prq$,
    $prq$Active Intune subscription plus Microsoft Entra ID P1 or P2 (or the free Premium trial) — automatic MDM enrollment is a Microsoft Entra premium feature and the toggle is unavailable without it$prq$,
    $prq$Microsoft Graph PowerShell SDK module Microsoft.Graph.DeviceManagement for verification only — no SDK cmdlet exists for either the MDM-authority switch or the automatic-enrollment scope, both are tenant-level admin-center settings$prq$
  ),
  $apath$Microsoft Intune admin center → Tenant administration → Tenant status (confirm MDM authority); Devices → Enrollment → Windows → Automatic Enrollment (set MDM user scope)$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Confirm or set the MDM authority to Intune at first sign-in or under Tenant administration → Tenant status — this cannot be reverted to Unknown once set, so confirm before changing.$stp$),
    jsonb_build_object('text', $stp$Go to Devices → Enrollment → Windows → Automatic Enrollment and set MDM user scope to All (or Some with a defined pilot group) so devices auto-enroll on Microsoft Entra join/register.$stp$),
    jsonb_build_object('text', $stp$Set WIP user scope to None unless Windows Information Protection is separately in use — Microsoft's own guidance is that MDM and WIP scopes should not overlap the same users.$stp$),
    jsonb_build_object('text', $stp$Save and allow up to 8 hours for the change to propagate to already-online devices. There is no Graph/PowerShell SDK cmdlet for either setting — both are Entra/Intune tenant-wide configuration, not deviceConfiguration objects, so this remediation is portal-only end to end.$stp$),
    jsonb_build_object('text', $stp$For an existing fleet needing bulk onboarding rather than pure Entra-join auto-enrollment, Windows Autopilot (new, organization-owned devices) and Group Policy enrollment (Entra hybrid-joined devices) are the documented alternate mechanisms — both still require automatic enrollment to be turned on first.$stp$)
  ),
  $eo$New Microsoft Entra-joined/registered Windows devices enroll in Intune automatically with no manual Company Portal step, and GET /deviceManagement/managedDevices returns a growing, non-zero device count as the fleet checks in.$eo$,
  $vs$Confirm Tenant administration → Tenant status shows MDM authority = Intune, then check Devices → All devices for a non-zero, growing count after a pilot device signs in with its work account.$vs$,
  $vc$Get-MgDeviceManagementManagedDevice -All | Measure-Object$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/intune/fundamentals/setup-mdm-authority$url$,
    $url$https://learn.microsoft.com/en-us/intune/device-enrollment/windows/enable-automatic-mdm$url$,
    $url$https://learn.microsoft.com/en-us/intune/device-enrollment/windows/guide$url$
  ),
  $vag$Microsoft Intune Learn docs (setup-mdm-authority, enable-automatic-mdm, enrollment guide), Microsoft.Graph.DeviceManagement PowerShell SDK, fetched 2026-09-02$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2043) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'admin_center_only',
  $note$If the tenant is on Microsoft Entra ID Free, this remediation is blocked on a licensing purchase decision, not something to script around.$note$
),

(
  'devices:kfm-configuration',
  $ttl$Deploy an Intune profile to silently redirect Known Folders (Desktop, Documents, Pictures) to OneDrive$ttl$,
  $sum$No Intune device configuration profile has "Known Folder Move" or "KFM" in its name, so Desktop, Documents and Pictures are not being centrally redirected into OneDrive for backup — if a device is lost, stolen, or fails, any files kept in those local folders are gone. Redirecting them lets users keep working in the folders they already know while giving them cloud backup and access to their files from any device; Microsoft recommends pairing the redirect with a policy that blocks users from opting back out.$sum$,
  jsonb_build_array(
    $prq$Intune admin center access with permission to create configuration profiles (Policy and Profile Manager or Intune Administrator)$prq$,
    $prq$Intune subscription; Windows devices running a OneDrive sync client build that supports Known Folder Move$prq$,
    $prq$The tenant's real Microsoft Entra tenant ID as a required input value in the policy itself$prq$,
    $prq$Microsoft Graph permission DeviceManagementConfiguration.ReadWrite.All if automating$prq$
  ),
  $apath$Microsoft Intune admin center → Devices → Configuration → Create → Platform: Windows 10 and later → Profile type: Settings catalog → add the OneDrive setting category$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Create a Settings catalog profile at Devices → Configuration → Create (Platform Windows 10 and later, Profile type Settings catalog), name it clearly, and add the OneDrive settings.$stp$),
    jsonb_build_object('text', $stp$Set "Silently move Windows known folders to OneDrive" = Enabled with Desktop, Documents and Pictures all = True, and Tenant ID = the tenant's real Entra tenant ID.$stp$),
    jsonb_build_object('text', $stp$Set "Prevent users from redirecting their Windows known folders to their PC" = Enabled so users can't opt back out, and optionally enable "Prompt users to move Windows known folders to OneDrive" as a fallback nudge if the silent move fails for a given user.$stp$),
    jsonb_build_object('text', $stp$Assign to a device group rather than a user group — computer-config Settings Catalog settings like this one apply regardless of who is signed in, which is cleaner targeting for this policy.$stp$),
    jsonb_build_object('text', $stp$Roll out staged rather than tenant-wide at once — Microsoft documents a hard cap on the silent-move policy of 1,000 existing devices per day and no more than 4,000 per week (combined Windows+macOS), so batch a large fleet across groups rather than assigning everyone simultaneously.$stp$),
    jsonb_build_object('text', $stp$A Graph API path exists (POST /beta/deviceManagement/configurationPolicies, or the PowerShell cmdlet New-MgBetaDeviceManagementConfigurationPolicy in module Microsoft.Graph.Beta.DeviceManagement) but requires exact settingDefinitionId strings that are long and easy to get subtly wrong, and is beta-only with no GA equivalent — the admin center Settings Catalog UI is the reliable, low-risk path to hand a customer.$stp$)
  ),
  $eo$Desktop, Documents and Pictures on enrolled Windows devices are silently redirected into OneDrive, users can no longer opt out, and new or changed files there are continuously backed up to the cloud.$eo$,
  $vs$On a pilot device, after check-in, confirm in File Explorer that Desktop/Documents/Pictures show the OneDrive cloud-sync icon; in the admin center, open the profile's Device status report and confirm devices report Succeeded.$vs$,
  NULL,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/sharepoint/redirect-known-folders$url$,
    $url$https://learn.microsoft.com/en-us/sharepoint/configure-sync-intune$url$,
    $url$https://learn.microsoft.com/en-us/intune/solutions/education/tutorial-school-deployment/ref-onedrive-knownfoldermove-settings-windows$url$,
    $url$https://learn.microsoft.com/en-us/graph/api/resources/intune-grouppolicy-grouppolicyconfiguration$url$
  ),
  $vag$Microsoft SharePoint/OneDrive Learn docs, Intune Education tutorial (real worked Graph Explorer POST body), Graph beta groupPolicyConfiguration resource, fetched 2026-09-02$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2043) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'admin_center_only',
  $note$FINDING FOR THE CHECK OWNER, not part of this remediation content: this check's own detection query, GET /deviceManagement/deviceConfigurations, cannot structurally return a Known Folder Move policy — real KFM objects live under /deviceManagement/groupPolicyConfigurations (Administrative Templates) or /deviceManagement/configurationPolicies (Settings Catalog), confirmed against Microsoft's own Graph resource docs and a real, fetched Microsoft tutorial. As implemented, this check will always fire the "no KFM policy found" finding regardless of tenant configuration — filed as its own GitHub issue rather than fixed here, since correcting the check's Graph query is outside this KB-authoring issue's scope.$note$
),

(
  'devices:update-rings-config',
  $ttl$Create Windows Update rings in Intune to centrally manage update rollout$ttl$,
  $sum$No Windows Update for Business deployment rings are configured, so Windows devices fall back to default, ungoverned Windows Update behavior — no control over when feature/quality updates land, no staged pilot-before-broad rollout, no deferral, no enforced restart deadlines. Update rings control client-side update behavior such as deferral periods, restart settings, deadlines, active hours and user notifications, and are commonly used to create test/pilot/production deployment stages. Without them, a bad update ships to the entire fleet simultaneously with no organizational buffer.$sum$,
  jsonb_build_array(
    $prq$Microsoft Intune Plan 1 license (stated licensing requirement for update ring policies)$prq$,
    $prq$Policy and Profile Manager Intune RBAC role$prq$,
    $prq$Windows Pro/Pro Education/Enterprise/Education/IoT Enterprise editions (LTSC is quality-update-only, several feature-update controls unsupported there)$prq$,
    $prq$The Microsoft Account Sign-In Assistant service (wlidsvc) running on the device, or feature updates will not be offered$prq$
  ),
  $apath$Microsoft Intune admin center → Devices → Windows → Manage updates → Windows updates → Update rings → Create profile$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Create at least two rings under a staged strategy — a pilot ring targeting a small IT/early-adopter device group with short or no deferral, and a broad/production ring for the remaining population with real deferral.$stp$),
    jsonb_build_object('text', $stp$On the broad ring, set Quality update deferral period (0-30 days) and Feature update deferral period (0-365 days) to the organization's real testing tolerance, then set Use deadline settings = Allow with a Deadline for quality updates and Deadline for feature updates (2-30 days each) and a Grace period (0-7 days) so updates install automatically after a bounded delay.$stp$),
    jsonb_build_object('text', $stp$Set Automatic update behavior to "Auto install at maintenance time" or "Auto install and restart at a scheduled time" with Active hours configured, and Auto reboot before deadline = Yes, so restarts land outside active use rather than being forced mid-work.$stp$),
    jsonb_build_object('text', $stp$Assign the pilot ring to its device group and the broad ring to the remaining population, excluding the pilot group from the broad ring so devices aren't double-targeted.$stp$),
    jsonb_build_object('text', $stp$The ring object itself can be created via Graph PowerShell using the generic device-configuration cmdlet with the windowsUpdateForBusinessConfiguration type, confirmed against the resource's real documented property set. Assignment to a group is a separate follow-up call not included here — an unassigned ring reaches no device, so complete the assignment in the admin center:$stp$, 'code', $cod$Import-Module Microsoft.Graph.DeviceManagement
Connect-MgGraph -Scopes 'DeviceManagementConfiguration.ReadWrite.All'
$params = @{
  "@odata.type" = "#microsoft.graph.windowsUpdateForBusinessConfiguration"
  displayName = "<UpdateRingDisplayName>"
  qualityUpdatesDeferralPeriodInDays = 7
  featureUpdatesDeferralPeriodInDays = 30
  deadlineForQualityUpdatesInDays = 7
  deadlineForFeatureUpdatesInDays = 14
  deadlineGracePeriodInDays = 2
  automaticUpdateMode = "autoInstallAndRebootAtScheduledTime"
}
New-MgDeviceManagementDeviceConfiguration -BodyParameter $params$cod$, 'codeLanguage', $lng$powershell$lng$)
  ),
  $eo$At least a pilot and a broad Windows Update ring exist, are assigned to real device groups, and enforce deferral plus a real deadline instead of leaving devices on default, ungoverned Windows Update behavior.$eo$,
  $vs$Open the ring's overview page and confirm assigned device/group counts are non-zero; check the Device and user check-in status report and confirm devices report in against the policy rather than "Not applicable."$vs$,
  $vc$Get-MgDeviceManagementDeviceConfiguration -Filter "isof('microsoft.graph.windowsUpdateForBusinessConfiguration')"$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/intune/device-updates/windows/manage-update-rings$url$,
    $url$https://learn.microsoft.com/en-us/graph/api/resources/intune-deviceconfig-windowsupdateforbusinessconfiguration?view=graph-rest-1.0$url$,
    $url$https://learn.microsoft.com/en-us/powershell/module/microsoft.graph.devicemanagement/new-mgdevicemanagementdeviceconfiguration?view=graph-powershell-1.0$url$
  ),
  $vag$Microsoft Intune Learn manage-update-rings doc, Graph REST v1.0 windowsUpdateForBusinessConfiguration resource, Microsoft.Graph.DeviceManagement PowerShell SDK, fetched 2026-09-02$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2043) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'admin_center_only',
  $note$Creating the ring object alone accomplishes nothing until it is assigned to a device group — that assignment step needs a separate Graph call not independently verified in this session, so the customer-facing fix route is authored as admin-center-complete rather than claiming a fully automated script.$note$
),

-- ─────────────────────────────────────────────────────────────────────────────
-- CLUSTER: Device records, BitLocker escrow, unassigned profiles
-- ─────────────────────────────────────────────────────────────────────────────

(
  'devices:bitlocker-key-escrow',
  $ttl$Force BitLocker recovery key backup to Microsoft Entra ID$ttl$,
  $sum$BitLocker being "enabled" on a device and BitLocker having a recoverable key are two different facts. BitLocker recovery passwords are written to Microsoft Entra ID (or on-prem AD DS for hybrid-joined devices) only at the moment the password is set or reset — a device can show Encrypted while its actual recovery key was never escrowed, for instance if it was encrypted before enrollment or before the backup policy applied. If that device is later lost, stolen, or hits a BitLocker recovery prompt, there is no real recovery path and the data is functionally gone.$sum$,
  jsonb_build_array(
    $prq$One of: Cloud Device Administrator, Helpdesk Administrator, Intune Service Administrator, Security Administrator, or Global Reader (least-privileged roles Graph accepts for reading BitLocker recovery keys)$prq$,
    $prq$To remotely rotate/re-escrow a key from Intune, an Intune RBAC role with Remote tasks → "Rotate BitLockerKeys (preview)" granted — built into Help Desk Operator or Endpoint Security Manager$prq$,
    $prq$Microsoft Graph permission BitlockerKey.ReadBasic.All (or BitlockerKey.Read.All)$prq$,
    $prq$Microsoft Graph PowerShell SDK module Microsoft.Graph.Identity.SignIns for Get-MgInformationProtectionBitlockerRecoveryKey$prq$
  ),
  $apath$Microsoft Intune admin center → Endpoint security → Disk encryption → Create Policy (Platform: Windows, Profile: BitLocker); per-device recovery status at Devices → All devices → [device] → Monitor → Recovery keys$apath$,
  $aurl$https://intune.microsoft.com/#view/Microsoft_Intune_DeviceSettings/DiskEncryptionMenu$aurl$,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Create or edit the BitLocker disk encryption policy at Endpoint security → Disk encryption → Create Policy (Platform Windows, Profile BitLocker), and set Save BitLocker recovery information to Microsoft Entra ID = Enabled and Store recovery information in Microsoft Entra ID before enabling BitLocker = Required. The Required setting structurally prevents this gap from recurring — it blocks BitLocker from turning on until the recovery password has actually escrowed.$stp$),
    jsonb_build_object('text', $stp$Also enable Client-driven recovery password rotation for Microsoft Entra joined (and hybrid joined, if applicable) devices, and assign the policy to the same groups already covered by the existing BitLocker enablement policy.$stp$),
    jsonb_build_object('text', $stp$For devices already encrypted before this policy existed — the actual population this check flags — don't wait for the next policy evaluation cycle: open the device under Devices → All devices → [device] and run the BitLocker key rotation remote action, which immediately regenerates and escrows a fresh recovery password to Entra ID for that device.$stp$),
    jsonb_build_object('text', $stp$To find the affected population directly, cross-reference managed devices reporting encryption on against GET /informationProtection/bitlocker/recoveryKeys filtered by each device's deviceId — any device with encryption on and zero matching recovery-key rows is a real gap:$stp$, 'code', $cod$Import-Module Microsoft.Graph.Identity.SignIns
Connect-MgGraph -Scopes 'BitlockerKey.ReadBasic.All'
Get-MgInformationProtectionBitlockerRecoveryKey -Filter "deviceId eq '<EntraDeviceId>'"$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$For hybrid Microsoft Entra-joined devices, confirm the on-premises Configuration Manager / AD DS backup path separately, since Active Directory escrow is a distinct destination from Microsoft Entra ID.$stp$)
  ),
  $eo$Every device Intune reports as BitLocker-encrypted has at least one matching row in GET /informationProtection/bitlocker/recoveryKeys for its deviceId; new encryptions cannot complete without a successful key escrow; previously-affected devices have had their keys rotated and escrowed via the remote action.$eo$,
  $vs$For a sample of previously-flagged devices, confirm the Graph call returns a non-empty result, and confirm the device's Monitor → Recovery keys view in the admin center shows a real key rather than "No BitLocker key found for this device."$vs$,
  $vc$Get-MgInformationProtectionBitlockerRecoveryKey -Filter "deviceId eq '<EntraDeviceId>'"$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/graph/api/bitlocker-list-recoverykeys?view=graph-rest-1.0&tabs=http$url$,
    $url$https://learn.microsoft.com/en-us/intune/device-configuration/endpoint-security/encrypt-bitlocker-windows$url$
  ),
  $vag$Microsoft Graph API v1.0 (bitlocker-list-recoverykeys), Microsoft Intune Learn docs, fetched 2026-09-02$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2043) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'admin_center_only',
  $note$Microsoft Entra ID supports a maximum of 200 BitLocker recovery keys per device; silent encryption fails outright if that cap is hit. Deleting a stale/duplicate Entra device object (see devices:stale-duplicate-records) that still holds a live BitLocker key destroys that key permanently — check for an escrowed key before removing a device record.$note$
),

(
  'devices:stale-duplicate-records',
  $ttl$Clean up stale and duplicate Entra ID device records$ttl$,
  $sum$Device records in Microsoft Entra ID exist that either haven't signed in for 90+ days (or have never signed in), or share the same underlying hardware deviceId as another record — typically from a device being re-enrolled or reimaged, leaving the old object behind. Left unmanaged this makes it hard for helpdesk to tell which device object is actually active, inflates the device count with unnecessary Microsoft Entra Connect sync overhead, and works against basic compliance hygiene.$sum$,
  jsonb_build_array(
    $prq$Cloud Device Administrator or Intune Administrator role — the two roles documented as able to update a device object in Microsoft Entra ID$prq$,
    $prq$Microsoft Graph PowerShell SDK module Microsoft.Graph.Identity.DirectoryManagement (Get-MgDevice, Update-MgDevice, Remove-MgDevice) — distinct from Microsoft.Graph.DeviceManagement, which is Intune-managed-device-specific and does not apply to Entra device objects$prq$,
    $prq$Microsoft Graph permission Device.ReadWrite.All$prq$
  ),
  $apath$Microsoft Entra admin center → Identity → Devices → All devices (view only — Microsoft's own guidance recommends PowerShell over the portal for the actual cleanup)$apath$,
  $aurl$https://entra.microsoft.com/#view/Microsoft_AAD_Devices/DevicesMenuBlade/~/Devices$aurl$,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Pull the stale candidate list matching this check's own 90-day/null definition:$stp$, 'code', $cod$Connect-MgGraph -Scopes 'Device.ReadWrite.All'
$cutoff = (Get-Date).AddDays(-90)
Get-MgDevice -All | Where-Object { $_.ApproximateLastSignInDateTime -le $cutoff -or $_.ApproximateLastSignInDateTime -eq $null } |
  Select-Object DisplayName, DeviceId, TrustType, OperatingSystem, ApproximateLastSignInDateTime$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Before touching anything, exclude any device that is Autopilot-registered (check via Get-MgDeviceManagementWindowsAutopilotDeviceIdentity) — Autopilot-associated device objects should never be deleted this way, since once deleted they can't be reprovisioned.$stp$),
    jsonb_build_object('text', $stp$Disable rather than delete immediately — deletion cannot be undone, so give a grace period:$stp$, 'code', $cod$$params = @{ accountEnabled = $false }
foreach ($device in $staleDevices) { Update-MgDevice -DeviceId $device.Id -BodyParameter $params }$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$After the grace period (120 days total is a documented worked example), delete the devices that are still disabled and still stale:$stp$, 'code', $cod$$cutoff2 = (Get-Date).AddDays(-120)
$toDelete = Get-MgDevice -All | Where-Object { $_.ApproximateLastSignInDateTime -le $cutoff2 -and $_.AccountEnabled -eq $false }
foreach ($device in $toDelete) { Remove-MgDevice -DeviceId $device.Id }$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$For duplicate records, group the pulled list by DeviceId (the hardware identifier, not the object Id) — any group with more than one row is a duplicate; keep the object with the newest ApproximateLastSignInDateTime as the active re-enrollment and route the older sibling(s) through the same disable-then-delete flow.$stp$),
    jsonb_build_object('text', $stp$Hybrid Microsoft Entra-joined devices (TrustType = ServerAd) must be cleaned up in on-premises Active Directory first, letting Microsoft Entra Connect sync the removal — deleting only the Entra ID side re-syncs the device back in a Pending state requiring re-registration.$stp$),
    jsonb_build_object('text', $stp$Before deleting any device with BitLocker in use, confirm whether it holds an escrowed recovery key (see devices:bitlocker-key-escrow) — deleting the device object permanently destroys any BitLocker key stored on it, with no recovery possible afterward.$stp$)
  ),
  $eo$Entra ID's device list contains no records with a null/90-day+ stale ApproximateLastSignInDateTime that aren't legitimately mid-grace-period, and no DeviceId value appears on more than one enabled device object.$eo$,
  $vs$Re-run the detection query and confirm the flagged counts have dropped to reflect only genuinely current devices; spot-check a few previously-flagged deviceId values to confirm only one enabled object remains per hardware ID.$vs$,
  $vc$Get-MgDevice -All | Group-Object DeviceId | Where-Object { $_.Count -gt 1 }$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/entra/identity/devices/manage-stale-devices$url$,
    $url$https://learn.microsoft.com/en-us/graph/api/resources/device?view=graph-rest-1.0$url$
  ),
  $vag$Microsoft Entra ID Learn doc manage-stale-devices, Graph REST v1.0 device resource, Microsoft.Graph.Identity.DirectoryManagement PowerShell SDK, fetched 2026-09-02$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2043) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$DESTRUCTIVE — Remove-MgDevice gives no warning and deleted devices cannot be recovered. This script is authored disable-first with an explicit grace period specifically because of that; do not skip straight to Remove-MgDevice on a first pass. approximateLastSignInDateTime only updates when the delta since its last value exceeds roughly 14 days (+/- 5 days), so a genuinely active device can occasionally show an older timestamp — a 90-day+null threshold is the conservative, correct bar rather than anything tighter. No native Entra ID auto-expire-stale-devices setting exists — this has to be run as a deliberate script, not toggled on.$note$
),

(
  'devices:unassigned-intune-profiles',
  $ttl$Assign or remove unused Intune configuration profiles$ttl$,
  $sum$An Intune configuration profile exists with an empty assignments collection — it reaches zero devices or users and has no real effect while consuming admin attention and audit surface. Several sections in Intune do not display assignment status in a list view, making it genuinely hard to spot these by clicking through the console one profile at a time; this check surfaces what the console itself doesn't. An unassigned profile is either a fix someone believes was deployed but never actually applied, or dead configuration debris left over from a decommissioned pilot.$sum$,
  jsonb_build_array(
    $prq$Intune RBAC role able to assign policies/profiles (Intune Administrator or Policy and Profile Manager)$prq$,
    $prq$Microsoft Graph permission DeviceManagementConfiguration.Read.All (to list) or .ReadWrite.All (to assign)$prq$,
    $prq$Microsoft Graph PowerShell SDK module Microsoft.Graph.DeviceManagement$prq$
  ),
  $apath$Microsoft Intune admin center → Devices → Configuration → [select the flagged profile] → Properties → Assignments → Edit$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Pull the real unassigned set directly from Graph rather than clicking through every profile in the console:$stp$, 'code', $cod$Import-Module Microsoft.Graph.DeviceManagement
Connect-MgGraph -Scopes 'DeviceManagementConfiguration.Read.All'
Get-MgDeviceManagementDeviceConfiguration -ExpandProperty Assignments -All |
  Where-Object { $_.Assignments.Count -eq 0 } | Select-Object Id, DisplayName$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$For each flagged profile, decide with the customer whether it's a fix meant to go live but never actually deployed, or stale debris from a decommissioned pilot — do not default to deleting without that confirmation.$stp$),
    jsonb_build_object('text', $stp$If it's meant to be live, open the profile at Devices → Configuration → [profile] → Properties → Assignments → Edit, add the intended group(s) under Included groups (or "Add all devices"/"Add all users" if genuinely tenant-wide), then Review + Save and the final Save — Review + Save alone does not commit the assignment.$stp$),
    jsonb_build_object('text', $stp$If it's stale, delete the profile from the same Configuration list rather than leaving an assignment-less, zero-effect object in the tenant.$stp$),
    jsonb_build_object('text', $stp$At scale, assignment can also be scripted once the target group is confirmed — POST /deviceManagement/deviceConfigurations/{id}/assignments with a groupAssignmentTarget body — but picking the correct target group is a judgment call about what the profile was originally meant to reach, which is why this remains an admin-driven decision rather than a blind automated fix.$stp$)
  ),
  $eo$Every device configuration profile in the tenant has a non-empty assignments array — every profile that exists is either actively targeting real devices/users or has been removed.$eo$,
  $vs$Re-run the detection query and confirm the previously-flagged profile IDs now return a populated assignments collection (or no longer exist, if deleted); in the admin center, confirm the intended group(s) show under Included groups.$vs$,
  $vc$Get-MgDeviceManagementDeviceConfigurationAssignment -DeviceConfigurationId "<ProfileId>"$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/graph/api/intune-deviceconfig-deviceconfiguration-list?view=graph-rest-1.0$url$,
    $url$https://learn.microsoft.com/en-us/intune/device-configuration/assign-device-profile$url$
  ),
  $vag$Microsoft Graph REST v1.0 deviceConfiguration list operation, Intune Learn assign-device-profile doc, fetched 2026-09-02$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2043) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'admin_center_only',
  $note$Present both the "assign it" and "delete it" options to the customer rather than assuming either — an unassigned profile could be a deliberately-staged draft awaiting a planned rollout as easily as it could be stale debris.$note$
)

ON CONFLICT (check_key) DO UPDATE SET
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  prerequisites = EXCLUDED.prerequisites,
  admin_center_path = EXCLUDED.admin_center_path,
  admin_center_url = EXCLUDED.admin_center_url,
  remediation_steps = EXCLUDED.remediation_steps,
  expected_outcome = EXCLUDED.expected_outcome,
  validation_step = EXCLUDED.validation_step,
  validation_command = EXCLUDED.validation_command,
  source_urls = EXCLUDED.source_urls,
  verified_against = EXCLUDED.verified_against,
  last_verified_at = EXCLUDED.last_verified_at,
  verified_by = EXCLUDED.verified_by,
  status = EXCLUDED.status,
  fix_route_capability = EXCLUDED.fix_route_capability,
  notes = EXCLUDED.notes,
  updated_at = now();

-- Self-mark this migration as run (Git #497 — Simulator Studio Migrations tree).
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-02-remediation-kb-devices-domain-2043.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;

-- Verify: how many devices: rows are published after this migration.
SELECT
  count(*) FILTER (WHERE check_key LIKE 'devices:%') AS devices_rows,
  count(*) FILTER (WHERE check_key LIKE 'devices:%' AND status = 'published') AS devices_published,
  count(*) AS total_rows
FROM remediation_knowledge_base;
