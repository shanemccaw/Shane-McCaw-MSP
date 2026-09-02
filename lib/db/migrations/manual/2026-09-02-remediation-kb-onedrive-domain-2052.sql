-- #2052 — Remediation knowledge base: the onedrive: domain, authored & published.
--
-- Populates remediation_knowledge_base with verified "this is wrong → here is how
-- to fix it" content for EVERY active onedrive: check (6 rows): active-users,
-- departed-user-access, external-sharing-settings, overshared-files,
-- storage-utilization, sync-errors. Follows the #1924 authoring standard exactly
-- (reference: 2026-08-31-remediation-kb-identity-domain-1924.sql).
--
-- AUTHORING STANDARD (see #1924):
--   * Every row is verified against real Microsoft Learn / official Microsoft docs
--     that were actually fetched in build session #2052 (2026-09-02). The URLs in
--     source_urls are those pages.
--   * verified_by is an HONEST AGENT attribution — never a human name. The content
--     is agent-authored and awaiting a human spot-check (filed as a Shane To-Do).
--   * Tenant-specific values use angle-bracket placeholders (<UserObjectId>, …),
--     never a fabricated real value.
--   * fix_route_capability is the finding-side CEILING (#1539): you_must_run when a
--     real customer-runnable fix script is authored in a step's `code`;
--     admin_center_only when the real fix is portal-only. NEVER we_can_run here —
--     that shape requires a live config pack mapped to the check (#1925's job).
--
-- Idempotent: keyed on check_key via ON CONFLICT DO UPDATE, safe to re-run. Additive
-- content only — no schema change (#1539 already built the columns).

BEGIN;

INSERT INTO remediation_knowledge_base (
  check_key, title, summary, prerequisites, admin_center_path, admin_center_url,
  remediation_steps, expected_outcome, validation_step, validation_command,
  source_urls, verified_against, last_verified_at, verified_by, status, fix_route_capability, notes
) VALUES

(
  'onedrive:active-users',
  $ttl$Raise OneDrive active-user adoption$ttl$,
  $sum$A low OneDrive active-user count relative to the tenant's licensed headcount means most people are storing or editing work files outside OneDrive — on local disks, USB drives, personal cloud accounts, or email attachments — none of which sit inside the tenant's OneDrive-anchored data-protection boundary (versioning-based ransomware recovery, retention, DLP, Conditional Access). Microsoft's own usage reports define an "active" account as one that viewed, modified, uploaded, downloaded, shared, or synced a file in the trailing window, so a persistently low count is a real adoption gap, not a reporting artifact — though it can also be inflated by accounts that were only recently deleted or never provisioned, which is why remediation starts with reviewing the underlying detail rows rather than the raw number alone.$sum$,
  jsonb_build_array(
    $prq$Reports Reader (or Global Reader) role to view the usage report in the Microsoft 365 admin center$prq$,
    $prq$Microsoft Graph Reports.Read.All permission for programmatic reads — already in REQUIRED_MT_SCOPES, the same permission onedrive:storage-utilization and onedrive:sync-errors already use against this identical endpoint, so no new tenant consent is needed$prq$,
    $prq$OneDrive sync client deployed to endpoints (via Intune or Group Policy) if driving adoption through Known Folder Move rather than manual training$prq$
  ),
  $apath$Microsoft 365 admin center → Reports → Usage → OneDrive for Business report → Accounts tab$apath$,
  $aurl$https://admin.microsoft.com/Adminportal/Home#/reportsUsage$aurl$,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Review current adoption: Microsoft 365 admin center → Reports → Usage → OneDrive for Business → Accounts tab, and compare the active-account trend against total licensed OneDrive accounts.$stp$),
    jsonb_build_object('text', $stp$Pull the underlying per-account detail to separate genuinely inactive users from accounts that are simply deleted or not yet provisioned — this is the same report this check itself reads:$stp$, 'code', $cod$Connect-MgGraph -Scopes 'Reports.Read.All'
Get-MgReportOneDriveUsageAccountDetail -Period 'D7' -OutFile 'oneDriveUsage7d.csv'
(Import-Csv oneDriveUsage7d.csv | Where-Object { $_.'Is Deleted' -eq 'False' -and [string]::IsNullOrWhiteSpace($_.'Last Activity Date') }) |
  Select-Object 'Owner Principal Name', 'Site URL' | Format-Table$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$For genuinely inactive licensed users, confirm the OneDrive sync client is deployed and Known Folder Move is configured to automatically redirect Desktop/Documents/Pictures into OneDrive — Microsoft's own lowest-friction adoption lever, since it requires no behavior change from the user.$stp$),
    jsonb_build_object('text', $stp$Target remaining low-adoption users with direct communication/training on saving to OneDrive rather than local disk, and re-run the report after rollout.$stp$)
  ),
  $eo$The active-account count over the trailing 7 days rises toward the tenant's total licensed OneDrive accounts, and the accounts still absent from activity are confirmed to be genuinely idle rather than deleted or unprovisioned.$eo$,
  $vs$Re-run the OneDrive usage report after rollout and confirm the active-user count over the trailing 7 days has risen relative to total licensed OneDrive accounts, and that the remaining gap is not simply deleted/unprovisioned accounts.$vs$,
  $vc$Get-MgReportOneDriveUsageAccountDetail -Period 'D7' -OutFile 'oneDriveUsage7d.csv'
(Import-Csv oneDriveUsage7d.csv | Where-Object { $_.'Is Deleted' -eq 'False' -and -not [string]::IsNullOrWhiteSpace($_.'Last Activity Date') }).Count$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/graph/api/reportroot-getonedriveusageaccountdetail?view=graph-rest-1.0$url$,
    $url$https://learn.microsoft.com/en-us/powershell/module/microsoft.graph.reports/get-mgreportonedriveusageaccountdetail?view=graph-powershell-1.0$url$,
    $url$https://learn.microsoft.com/en-us/sharepoint/sync-health$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02; Microsoft Graph PowerShell SDK (Microsoft.Graph.Reports)$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2052) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$This is an adoption/reporting check, not a single misconfiguration — the fix is a program (KFM rollout + training), not a one-shot toggle. Rated you_must_run because the detail-pull PowerShell is a real, customer-runnable diagnostic step that separates true gaps from stale/deleted accounts, which is necessary before any training push is targeted correctly.$note$
),

(
  'onedrive:departed-user-access',
  $ttl$Assign a manager or secondary owner to unhandled departed-user OneDrive accounts$ttl$,
  $sum$When a Microsoft 365 account is deleted, Microsoft automatically grants the deleted user's manager (or a designated secondary owner) access to their OneDrive for the retention window — but only if one was assigned. A disabled account with no manager on record is content nobody was ever eligible to automatically inherit: there is no admin notification, no automatic handoff, and if the account is later hard-deleted, the files become recoverable only within the OneDrive retention window (30 days by default, admin-configurable up to 3650) and only if someone remembers to act. This is a common, low-visibility offboarding gap — the HR/IT offboarding process disables the account and moves on, but the manager-assignment step that makes automatic access work was never done.$sum$,
  jsonb_build_array(
    $prq$User Administrator (or Global Administrator) to view/set a user's manager attribute$prq$,
    $prq$SharePoint Administrator role to grant retroactive access via Manage User Profiles, for accounts already past this point$prq$,
    $prq$Microsoft Graph PowerShell SDK (Microsoft.Graph.Users), scope User.ReadWrite.All or Directory.ReadWrite.All, if automating the manager assignment$prq$
  ),
  $apath$Microsoft Entra admin center → Identity → Users → (select user) → Manager (to assign proactively); Microsoft 365 admin center → Admin centers → SharePoint → More features → User profiles → Manage User Profiles → (find the former employee) → Manage site collection owners (to grant retroactive access)$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$For each disabled account this check flags that is NOT yet hard-deleted, assign a manager now so the automatic OneDrive access grant fires correctly whenever the account is eventually deleted:$stp$, 'code', $cod$Connect-MgGraph -Scopes 'User.ReadWrite.All'
$NewManager = @{ "@odata.id" = "https://graph.microsoft.com/v1.0/users/<ManagerUserObjectId>" }
Set-MgUserManagerByRef -UserId "<DepartedUserObjectId>" -BodyParameter $NewManager$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$For an account already deleted with no manager ever assigned, and still inside the OneDrive retention window, grant access retroactively: Microsoft 365 admin center → SharePoint admin center → More features → User profiles → Manage User Profiles → find the former employee's profile → right-click → Manage site collection owners → add the appropriate person as a site collection administrator. This is the documented portal-only path; there is no PowerShell equivalent for this specific retroactive grant.$stp$),
    jsonb_build_object('text', $stp$Confirm and, if needed, extend the OneDrive retention window for deleted users so there is enough time to complete the handoff: Settings in the SharePoint admin center → Retention → set Days to retain files a deleted user's OneDrive (30–3650).$stp$)
  ),
  $eo$Every disabled account either has a manager assigned (so the automatic access grant will work when it is eventually deleted) or, for accounts already deleted, a specific person has been given site-collection-administrator access to the former user's OneDrive within the retention window.$eo$,
  $vs$Re-run the departed-user check and confirm the flagged disabled/no-manager account count has dropped; for any account past the automatic-grant point, confirm a named person now shows as a site collection administrator on that OneDrive site.$vs$,
  $vc$Get-MgUser -UserId "<DepartedUserObjectId>" -Property Id,DisplayName,AccountEnabled,Manager -ExpandProperty Manager | Select-Object DisplayName, AccountEnabled, @{N='Manager';E={$_.Manager.AdditionalProperties.displayName}}$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/sharepoint/set-retention$url$,
    $url$https://learn.microsoft.com/en-us/microsoft-365/admin/add-users/remove-former-employee-step-5?view=o365-worldwide$url$,
    $url$https://learn.microsoft.com/en-us/powershell/module/microsoft.graph.users/set-mgusermanagerbyref?view=graph-powershell-1.0$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02; Microsoft Graph PowerShell SDK (Microsoft.Graph.Users)$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2052) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$Assigning a manager on an already-deleted account does nothing retroactively — the automatic grant fires only at the moment of deletion. For accounts already past that point, the only real fix is the portal-only "Manage site collection owners" retroactive grant, within the retention window. Does not mean the content is unreachable to an admin — Global/SharePoint admins can always reach it; it means nobody was automatically handed access.$note$
),

(
  'onedrive:external-sharing-settings',
  $ttl$Align OneDrive external sharing with the organization's intended boundary$ttl$,
  $sum$OneDrive's external-sharing level is capped by (but can be more restrictive than) the tenant-wide SharePoint/OneDrive sharing setting — it can never be more permissive. A tenant left at the default "Anyone" level lets any user generate an unauthenticated "Anyone with the link" link to any file in their OneDrive, which can be freely forwarded with zero visibility into who ultimately gains access. This is the single setting most responsible for uncontrolled data leaving the tenant boundary, because it applies globally to every user's OneDrive at once rather than site-by-site.$sum$,
  jsonb_build_array(
    $prq$SharePoint Administrator (or Global Administrator) to change organization-level sharing settings$prq$,
    $prq$SharePoint Online Management Shell (or Microsoft 365 admin center access) to run Set-SPOTenant$prq$,
    $prq$A decision on the organization's real risk tolerance and its legitimate list of external-collaboration domains, before restricting — an overly aggressive change can break in-flight vendor/partner workflows$prq$
  ),
  $apath$SharePoint admin center → Policies → Sharing$apath$,
  $aurl$https://admin.microsoft.com/sharepoint/?page=sharing$aurl$,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Review the current organization-level setting: SharePoint admin center → Policies → Sharing → External sharing. The OneDrive slider can be set independently but only at or below the SharePoint slider's permissiveness.$stp$),
    jsonb_build_object('text', $stp$Move the OneDrive sharing level down from Anyone to at minimum New and existing guests (requires sign-in/verification code) — Existing guests only or Only people in your organization for higher-sensitivity tenants. Do the same review for the SharePoint-wide setting since it is the ceiling OneDrive inherits.$stp$),
    jsonb_build_object('text', $stp$If any external collaboration must remain, enable Limit external sharing by domain under More external sharing settings and add an explicit allow-list rather than leaving sharing open to any domain. PowerShell equivalent for both the sharing level and domain restriction:$stp$, 'code', $cod$# Connect-SPOService -Url https://<tenant>-admin.sharepoint.com
Set-SPOTenant -OneDriveSharingCapability ExistingExternalUserSharingOnly
Set-SPOTenant -SharingDomainRestrictionMode AllowList -SharingAllowedDomainList "<partner1.com>,<partner2.com>"$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Restrict "Anyone" links (if the tenant setting still permits them) to expire after a bounded number of days and to grant View-only permission by default, under Advanced settings for "Anyone" links in the same Sharing page.$stp$)
  ),
  $eo$The tenant's OneDrive sharing level requires at minimum guest sign-in (no unauthenticated "Anyone" links), is bounded by the same-or-more-restrictive SharePoint setting, and — where external collaboration is still needed — is limited to an explicit domain allow-list rather than open to any external party.$eo$,
  $vs$Re-check the SharePoint admin center Sharing page and confirm the OneDrive sharing level and domain restriction reflect the intended, more restrictive setting; confirm existing "Anyone" links created before the change now show the new expiration/permission behavior going forward.$vs$,
  $vc$Get-SPOTenant | Select-Object SharingCapability, OneDriveSharingCapability, SharingDomainRestrictionMode, SharingAllowedDomainList$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/sharepoint/turn-external-sharing-on-or-off$url$,
    $url$https://learn.microsoft.com/en-us/sharepoint/restricted-domains-sharing$url$,
    $url$https://learn.microsoft.com/en-us/sharepoint/change-external-sharing-site$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02; SharePoint Online Management Shell$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2052) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$OneDriveSharingCapability accepts Disabled, ExistingExternalUserSharingOnly, ExternalUserSharingOnly, ExternalUserAndGuestSharing — pick the value at least as restrictive as the tenant-wide SharingCapability, or the command is silently capped. Do not tighten cold in a tenant with active, legitimate external collaborators without first reviewing who currently has active shares — this is a org-wide change with no per-user opt-out.$note$
),

(
  'onedrive:overshared-files',
  $ttl$Remove anonymous and organization-wide sharing links from OneDrive drives$ttl$,
  $sum$A OneDrive drive carrying an anonymous "Anyone with the link" grant, an Everyone/Everyone-except-external-users claim, or an organization-wide link means content the account owner may believe is private is actually reachable by anyone with the link, every authenticated tenant member, or (for the Everyone claim specifically) external guests as well. Microsoft Graph's permission resource exposes exactly this via each permission's link.scope value, which is what lets this be detected and fixed per-file rather than only at the tenant sharing-policy level (onedrive:external-sharing-settings covers the policy ceiling; this check covers content that is already overshared under whatever ceiling exists).$sum$,
  jsonb_build_array(
    $prq$SharePoint Administrator or Global Administrator to remove permissions on another user's OneDrive drive$prq$,
    $prq$Microsoft Graph PowerShell SDK (Microsoft.Graph.Files), scope Sites.ReadWrite.All (Sites.Read.All is sufficient only to detect, not remove)$prq$,
    $prq$SharePoint Advanced Management license for the built-in Data Access Governance sharing-link reports, if available — not required to remediate individual items$prq$
  ),
  $apath$Microsoft 365 admin center → Users → Active users → (select user) → OneDrive tab → View files, or directly in the file/folder's own Manage access panel$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$For each flagged drive item, list its current permissions to identify the specific anonymous, Everyone, or organization-wide link(s):$stp$, 'code', $cod$Connect-MgGraph -Scopes 'Sites.Read.All'
Get-MgDriveItemPermission -DriveId "<DriveId>" -DriveItemId "<ItemId>" |
  Where-Object { $_.Link.Scope -in @('anonymous','organization') -or $_.Link.WebUrl -match 'spo-grid-all-users' } |
  Select-Object Id, @{N='Scope';E={$_.Link.Scope}}, @{N='Type';E={$_.Link.Type}}$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Remove each overshared permission by its id (this deletes the sharing link itself — anyone who had the link loses access immediately):$stp$, 'code', $cod$Remove-MgDriveItemPermission -DriveId "<DriveId>" -DriveItemId "<ItemId>" -PermissionId "<PermissionId>"$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$If the owner still needs to share the item, recreate access with a Specific people link scoped to the named recipients instead, or use the item's Manage access panel in the OneDrive web UI to switch the link type.$stp$),
    jsonb_build_object('text', $stp$To prevent recurrence, lower the default link type users see when sharing (Specific people or Only people in your organization rather than Anyone with the link) under SharePoint admin center → Policies → Sharing → File and folder links — see onedrive:external-sharing-settings for the tenant-wide policy fix.$stp$)
  ),
  $eo$The flagged drives no longer carry an anonymous, Everyone, Everyone-except-external-users, or organization-wide sharing link; any access the owner still needs is granted through named, specific-people permissions instead.$eo$,
  $vs$Re-list permissions on the previously flagged drive items and confirm no remaining permission has link.scope of anonymous or organization, or a grantedToV2 identity resolving to the Everyone/Everyone-except-external-users claim.$vs$,
  $vc$Get-MgDriveItemPermission -DriveId "<DriveId>" -DriveItemId "<ItemId>" | Where-Object { $_.Link.Scope -in @('anonymous','organization') } | Measure-Object | Select-Object -ExpandProperty Count$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/graph/api/resources/permission?view=graph-rest-1.0$url$,
    $url$https://learn.microsoft.com/en-us/sharepoint/turn-external-sharing-on-or-off$url$,
    $url$https://learn.microsoft.com/en-us/sharepoint/restricted-domains-sharing$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02; Microsoft Graph PowerShell SDK (Microsoft.Graph.Files)$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2052) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$The Everyone-except-external-users and Everyone claims aren't literal Graph enum values on link.scope — they surface as specific identity claims inside grantedToV2/grantedToIdentitiesV2 (the eeeu / spo-grid-all-users pattern this check's own collector already classifies in onedrive-sharing.ts). The validation command above only re-checks the two true link.scope values (anonymous, organization); confirming the Everyone/eeeu claims are gone requires inspecting grantedToV2 the same way the collector does.$note$
),

(
  'onedrive:storage-utilization',
  $ttl$Increase OneDrive storage quota before accounts hit read-only$ttl$,
  $sum$Once a OneDrive account's storage used reaches its allocated quota, the account becomes read-only — users can no longer save, sync, or upload new files, which silently breaks their workflow (and can break third-party apps and Teams file uploads that route through OneDrive) until an admin raises the limit. High tenant-wide utilization against the default 1 TB per-user allocation is an early-warning signal, not yet an outage, but it is one that a scheduled monitoring check catches long before the affected user notices and files a ticket.$sum$,
  jsonb_build_array(
    $prq$SharePoint Administrator (or Global Administrator) to change the default or a per-user storage limit$prq$,
    $prq$SharePoint Online Management Shell for the PowerShell path$prq$,
    $prq$For increases beyond 5 TB (up to the 25 TB plan maximum), a Microsoft support request from a Global Administrator — this is not self-service past 5 TB$prq$
  ),
  $apath$SharePoint admin center → Settings → OneDrive → Storage limit (tenant default); Microsoft 365 admin center → Users → Active users → (select user) → OneDrive tab, for a per-user override$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Identify which accounts are near or at quota from this check's own usage-report read, then confirm whether they're on the tenant default limit or already have a per-user override: Microsoft 365 admin center → Users → Active users → select the user → OneDrive tab → look at the max value next to "Storage used".$stp$),
    jsonb_build_object('text', $stp$Raise the tenant-wide default (applies to every user without a specific override) up to the per-license maximum, generally 5 TB self-service:$stp$, 'code', $cod$# Connect-SPOService -Url https://<tenant>-admin.sharepoint.com
Set-SPOTenant -OneDriveStorageQuota 5242880   # value in MB; 5242880 MB = 5 TB$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$For a single user who still needs more than the new default, raise their specific site's quota directly:$stp$, 'code', $cod$Set-SPOSite -Identity "<UserOneDriveUrl>" -StorageQuota 5242880$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$If the required increase exceeds 5 TB (up to the 25 TB Plan 2 ceiling), a Global Administrator must open a Microsoft support request — this cannot be self-served past 5 TB regardless of PowerShell/portal access.$stp$)
  ),
  $eo$Flagged accounts' allocated OneDrive storage exceeds their current usage by a healthy margin, so no account is at risk of going read-only before the next scheduled review; the tenant default is raised (not just the individual accounts) so newly onboarded users don't immediately re-trigger the same finding.$eo$,
  $vs$Re-pull the OneDrive usage report and confirm the previously flagged accounts' Storage Used ÷ Storage Allocated ratio has dropped to a safe margin, and that no account shows Storage Used at or above Storage Allocated.$vs$,
  $vc$Get-MgReportOneDriveUsageAccountDetail -Period 'D7' -OutFile 'oneDriveUsage7d.csv'
Import-Csv oneDriveUsage7d.csv | Where-Object { [double]$_.'Storage Used (Byte)' -ge (0.9 * [double]$_.'Storage Allocated (Byte)') } | Select-Object 'Owner Principal Name'$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/sharepoint/set-default-storage-space$url$,
    $url$https://learn.microsoft.com/en-us/graph/api/reportroot-getonedriveusageaccountdetail?view=graph-rest-1.0$url$,
    $url$https://learn.microsoft.com/en-us/powershell/module/microsoft.graph.reports/get-mgreportonedriveusageaccountdetail?view=graph-powershell-1.0$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02; SharePoint Online Management Shell; Microsoft Graph PowerShell SDK (Microsoft.Graph.Reports)$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2052) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$Set-SPOTenant -OneDriveStorageQuota takes megabytes and rounds down to the nearest GB in the admin center display; a value under 1024 MB is rounded up to 1 GB. Lowering (not relevant here, but noted for reuse) a quota below current usage makes that OneDrive read-only immediately — this check and its fix are strictly about raising headroom.$note$
),

(
  'onedrive:sync-errors',
  $ttl$Resolve stale or broken OneDrive sync clients$ttl$,
  $sum$An account with no recorded OneDrive sync activity in 30 days (and not deleted) is very likely running a stale, broken, or fully stopped sync client — the user may believe their Desktop/Documents/Pictures files are being protected and versioned in OneDrive when in fact nothing has synced in a month. Microsoft Graph has no direct "sync error" API, so this check is an honest proxy for client-side sync health, not a literal fault feed; the real diagnostic surface with per-device error detail is the OneDrive Sync health dashboard in the Microsoft 365 Apps admin center, which reports the actual error codes and last-synced timestamps this check's activity-recency proxy cannot see.$sum$,
  jsonb_build_array(
    $prq$Office Apps Administrator or Microsoft 365 Administrator to initially enable the Sync health dashboard for the tenant; Global Reader, Security Administrator, or Reports Reader to view it afterward$prq$,
    $prq$OneDrive sync app version 22.232 or later on affected Windows/macOS devices, on the Production, Deferred, or Insiders update ring$prq$,
    $prq$Devices able to reach https://clients.config.office.net to send health reports$prq$
  ),
  $apath$Microsoft 365 Apps admin center → Health → OneDrive Sync (dashboard); enable via Health → OneDrive Sync → Setup for the Tenant Association Key and rollout method$apath$,
  $aurl$https://config.office.com/officeSettings/health/onedrivesync$aurl$,
  jsonb_build_array(
    jsonb_build_object('text', $stp$If not already enabled tenant-wide, turn on the Sync health dashboard: Microsoft 365 Apps admin center (config.office.com) → Health → OneDrive Sync → Setup → generate a Tenant Association Key, then roll out EnableSyncAdminReports to devices via Intune Settings Catalog (OneDrive → Enable sync health reporting for OneDrive + Sync Admin Reports) or Group Policy. Reports take up to 3 days to appear after rollout.$stp$),
    jsonb_build_object('text', $stp$Once populated, open the dashboard's Devices tab, filter to "devices with errors", and cross-reference against the accounts this check flagged by stale/blank Last Activity Date to see the real error code and last-synced timestamp per device.$stp$),
    jsonb_build_object('text', $stp$For each affected user: confirm the OneDrive sync app is actually running and signed in (not just installed), is on a current version, and has network access to Microsoft 365; the Issues tab groups affected devices by the specific error message so a bulk-affecting cause (e.g. a proxy blocking Microsoft 365 endpoints) can be fixed once rather than per-device.$stp$),
    jsonb_build_object('text', $stp$Direct the affected user (or remote support) to sign back into the sync client, or reinstall it, if it has stopped entirely; for real content protection in the interim, confirm the user's local Desktop/Documents/Pictures are not silently unsynced by enabling Known Folder Move once the client is healthy again.$stp$)
  ),
  $eo$Devices previously showing sync errors or no sync activity in 30+ days report a current, healthy sync status in the OneDrive Sync health dashboard, and this check's own activity-recency proxy shows a recent Last Activity Date for the affected accounts on the next scheduled run.$eo$,
  $vs$In the OneDrive Sync health dashboard's Devices tab, confirm the previously affected devices no longer show an error state and have a recent "Last synced timestamp"; separately, re-run this check's own usage-report read and confirm the accounts no longer show a blank or 30+-day-stale Last Activity Date.$vs$,
  $vc$Get-MgReportOneDriveUsageAccountDetail -Period 'D30' -OutFile 'oneDriveUsage30d.csv'
Import-Csv oneDriveUsage30d.csv | Where-Object { $_.'Is Deleted' -eq 'False' -and ([string]::IsNullOrWhiteSpace($_.'Last Activity Date') -or ([datetime]$_.'Last Activity Date') -lt (Get-Date).AddDays(-30)) } | Select-Object 'Owner Principal Name'$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/sharepoint/sync-health$url$,
    $url$https://learn.microsoft.com/en-us/graph/api/reportroot-getonedriveusageaccountdetail?view=graph-rest-1.0$url$,
    $url$https://learn.microsoft.com/en-us/powershell/module/microsoft.graph.reports/get-mgreportonedriveusageaccountdetail?view=graph-powershell-1.0$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02; Microsoft Graph PowerShell SDK (Microsoft.Graph.Reports)$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2052) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'admin_center_only',
  $note$Enabling the Sync health dashboard (the real per-device error source) is a one-time tenant rollout done through Intune/GPO plus the Apps admin center, not a single PowerShell one-liner an MSP can run per finding — hence admin_center_only despite the registry-key detail in the docs. Device records expire from the dashboard after 30 days of inactivity and devices must be powered on 5+ hours to be eligible, both of which can mask a genuinely broken client as "no data" rather than "error".$note$
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
VALUES ('2026-09-02-remediation-kb-onedrive-domain-2052.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;

-- Verify: how many onedrive: rows are published after this migration.
SELECT
  count(*) FILTER (WHERE check_key LIKE 'onedrive:%') AS onedrive_rows,
  count(*) FILTER (WHERE check_key LIKE 'onedrive:%' AND status = 'published') AS onedrive_published,
  count(*) AS total_rows
FROM remediation_knowledge_base;
