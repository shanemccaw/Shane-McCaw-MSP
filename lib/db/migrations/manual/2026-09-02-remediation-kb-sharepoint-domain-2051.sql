-- #2051 — Remediation knowledge base: the sharepoint: domain, authored & published.
--
-- Populates remediation_knowledge_base with verified "this is wrong → here is how
-- to fix it" content for EVERY active sharepoint: check (6 rows). Before this the
-- table held zero rows for this domain, so every sharepoint: finding fell through
-- to the AI fallback.
--
-- AUTHORING STANDARD (see #1924, followed exactly per #2051's instruction):
--   * Every row is verified against real Microsoft Learn / official Microsoft docs
--     that were actually fetched in build session #2051 (2026-09-02). The URLs in
--     source_urls are those pages.
--   * verified_by is an HONEST AGENT attribution — never a human name. The content
--     is agent-authored and awaiting a human spot-check (filed as a Shane To-Do).
--   * Tenant-specific values use angle-bracket placeholders (<SiteUrl>, …), never a
--     fabricated real value.
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
  'sharepoint:inactive-sites',
  $ttl$Govern inactive SharePoint sites with a lifecycle policy$ttl$,
  $sum$A site with no real activity in 90+ days is not a passive cost — it is unreviewed, unmanaged surface: its sharing links, guest access and permissions keep working exactly as they did the day everyone stopped using it, with no owner checking whether that access should still exist. The longer a site sits idle, the more likely its access model has drifted from who actually still needs it, and the harder it is for anyone to notice. Microsoft's own site lifecycle management (part of SharePoint Advanced Management) exists specifically to turn "nobody is watching this" into a tracked, owner-accountable state rather than an indefinite unknown.$sum$,
  jsonb_build_array(
    $prq$SharePoint Administrator (or Global Administrator) to create the policy$prq$,
    $prq$SharePoint Advanced Management (SAM) — inactive site policies are a Site lifecycle management / SAM capability$prq$,
    $prq$A custom domain configured for email notifications from Microsoft 365 admin center if you want to customize the policy's notification emails (optional)$prq$,
    $prq$Outlook Actionable Messages support in the organization so site owners can certify a site directly from the notification email$prq$
  ),
  $apath$SharePoint admin center → Policies → Site lifecycle management → Inactive site policies → Open$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$As a SharePoint Administrator, go to the SharePoint admin center → Policies → Site lifecycle management → Inactive site policies → Open, then select + Create policy.$stp$),
    jsonb_build_object('text', $stp$Set the policy scope (sites at scale, or upload a CSV of up to 10,000 specific site URLs), then configure the inactivity period, who gets notified (site owners and/or site admins), and the enforcement action after three unanswered monthly notifications: Do nothing (report only), Read-only access, or Archive sites after a mandatory read-only period (via Microsoft 365 Archive).$stp$),
    jsonb_build_object('text', $stp$Start the policy in Simulation mode to generate a report without enforcement, review which real sites would be affected, then switch to Active mode (runs monthly with real notifications and enforcement). Site owners keep a site out of scope indefinitely by selecting Certify site in the notification email, which pauses activity checks on that site for one year.$stp$)
  ),
  $eo$Every SharePoint site is covered by an active inactive-site policy: idle sites are surfaced to their owners for certification, and sites that go unanswered are moved to read-only and eventually archived rather than sitting open and unmonitored indefinitely.$eo$,
  $vs$Open the Site lifecycle management → Inactive site policy dashboard and download the policy execution report (.csv); confirm it lists real sites with a Last activity date and an Action status, rather than the policy showing zero sites in scope or not existing at all.$vs$,
  NULL,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/sharepoint/inactive-site-policy$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2051) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'admin_center_only',
  $note$Inactive site policies are configured only through the SharePoint admin center wizard (site lifecycle management) — there is no supported PowerShell cmdlet to create/query the policy itself, hence admin_center_only and no validation_command. Activity is evaluated across SharePoint, Teams, Viva Engage and Exchange, not SharePoint alone, and a document upload or edit resets the inactivity clock — merely visiting a site link in the notification email does not count as activity.$note$
),

(
  'sharepoint:site-count',
  $ttl$Govern SharePoint site sprawl with a site creation policy$ttl$,
  $sum$An unrestricted or unreviewed total site count is a governance signal, not just a number: every additional site is another container with its own permissions, external sharing setting and storage footprint that someone has to keep track of. Left ungoverned — anyone able to spin up new sites from SharePoint, OneDrive, or the REST/PnP API with no naming standard or storage default — the site count grows faster than any admin can review, and abandoned or duplicate sites accumulate real, unmanaged access alongside the ones still in active use. Reviewing the real count against a deliberate site-creation policy is what keeps that growth accountable instead of invisible.$sum$,
  jsonb_build_array(
    $prq$SharePoint Administrator (or above) in Microsoft 365 to view or change the site creation policy$prq$,
    $prq$Decision on whether self-service site creation should remain enabled, and if so, its default storage limit and time zone for new sites$prq$,
    $prq$Microsoft Graph PowerShell SDK (Microsoft.Graph.Sites) or SharePoint Online Management Shell if automating the site count itself$prq$
  ),
  $apath$SharePoint admin center → Settings → Site creation$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Review the current total in SharePoint admin center → Active sites, and cross-check it against what the organization actually expects for its size — a count that keeps climbing without a corresponding review process is the finding, not any single absolute number.$stp$),
    jsonb_build_object('text', $stp$Go to SharePoint admin center → Settings → Site creation. Decide deliberately whether "Users can create SharePoint sites" should stay on — this setting governs site creation from SharePoint, OneDrive, the PnP PowerShell cmdlet and the REST API, though it does not affect Microsoft 365 Group/Teams-driven site creation, which is governed separately (see Manage who can create Microsoft 365 Groups).$stp$),
    jsonb_build_object('text', $stp$If self-service creation stays on, set a sensible default storage limit and time zone for new sites under the same Site creation page rather than leaving new sites unbounded, and review the total again periodically as part of ongoing governance rather than a one-time check.$stp$, 'code', $cod$Connect-MgGraph -Scopes 'Sites.Read.All'
(Get-MgSite -All -Property Id,WebUrl).Count$cod$, 'codeLanguage', $lng$powershell$lng$)
  ),
  $eo$The tenant has a deliberate site-creation policy (self-service on or off by decision, not by default) and a real, current site count that someone reviews periodically rather than an unbounded number nobody is tracking.$eo$,
  $vs$Re-run the site count and compare it against the last reviewed figure; a large unexplained jump since the last review is itself a finding worth investigating (who created the new sites, and why).$vs$,
  $vc$Get-SPOSite -Limit ALL | Measure-Object | Select-Object -ExpandProperty Count$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/sharepoint/manage-site-creation$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02; SharePoint Online Management Shell$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2051) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'admin_center_only',
  $note$Site count alone carries no universal "too high" threshold — the real fix is the governance decision at Settings → Site creation, made in the portal, not a single script. Disabling "Users can create SharePoint sites" does not stop Microsoft 365 Group/Teams-driven site creation, which needs its own separate group-creation policy if the goal is to control total site count at the source.$note$
),

(
  'sharepoint:site-label-coverage',
  $ttl$Increase sensitivity label coverage on SharePoint sites$ttl$,
  $sum$A site with no sensitivity label carries no automatic, container-level protection: no locked privacy setting, no enforced external-sharing ceiling for that specific site, and none of the unmanaged-device or Conditional Access authentication-context controls a label can apply. Item-level labels on individual documents don't fill this gap — a site's own container settings (who can be added as a guest, whether external sharing is even possible, whether unmanaged devices are blocked) are governed by the label applied to the site itself, not by the labels on the files inside it. Low coverage means most sites are relying entirely on whatever the tenant's default sharing settings happen to be, with no site-specific override for the sites that actually hold more sensitive content.$sum$,
  jsonb_build_array(
    $prq$Compliance Administrator / Compliance Data Administrator (or Global Administrator) to enable sensitivity labels for containers, a one-time tenant setup$prq$,
    $prq$Microsoft Purview sensitivity labels already created and published in a label policy, with the label's scope including Groups & sites$prq$,
    $prq$SharePoint Administrator role plus SharePoint Online Management Shell 16.0.19418.12000 or later to apply labels to existing sites in bulk via PowerShell$prq$,
    $prq$Microsoft Purview (Information Protection) licensing that covers container/site-level sensitivity labels$prq$
  ),
  $apath$SharePoint admin center → Active sites → select a site → Policies tab → Edit (Sensitivity); label creation and container-scope configuration is in the Microsoft Purview portal → Information Protection → Labels$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$If not already done tenant-wide, enable sensitivity label support for containers (a one-time setup): follow Microsoft Entra's "Assign sensitivity labels to Microsoft 365 groups" instructions, then run Execute-AzureAdLabelSync in Security & Compliance PowerShell to sync labels to Microsoft Entra ID.$stp$),
    jsonb_build_object('text', $stp$In the Microsoft Purview portal, create or edit a sensitivity label with scope Groups & sites, configure the protection settings you want it to carry (privacy, external user access, external sharing ceiling, unmanaged-device/Conditional Access authentication context), and publish it in a label policy assigned to the users who create/manage sites.$stp$),
    jsonb_build_object('text', $stp$Apply the label to existing unlabeled sites in bulk with SharePoint Online PowerShell (get the label GUID from Get-Label first):$stp$, 'code', $cod$# SharePoint Online Management Shell (Connect-SPOService first)
$Id = [GUID]("<SensitivityLabelGuid>")
$sites = Get-SPOSite -Limit All | Where-Object { -not $_.SensitivityLabel -or $_.SensitivityLabel -eq [GUID]::Empty }
$sites | ForEach-Object { Set-SPOSite -Identity $_.Url -SensitivityLabel $Id }$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$For sites that need a different label than the bulk default, apply it individually rather than in the loop above:$stp$, 'code', $cod$Set-SPOSite -Identity "<SiteUrl>" -SensitivityLabel "<SensitivityLabelGuid>"$cod$, 'codeLanguage', $lng$powershell$lng$)
  ),
  $eo$New sites prompt for a sensitivity label at creation (visible under Advanced settings), and existing sites carry a label visible in the SharePoint admin center's Active sites → Sensitivity column, so site-level protection settings are enforced per-site rather than left to tenant defaults alone.$eo$,
  $vs$In the SharePoint admin center, add the Sensitivity column to Active sites and confirm the proportion of sites showing a real label name rather than blank; spot-check a labeled site to confirm the label's configured settings (privacy, external sharing) are actually in effect.$vs$,
  $vc$Get-SPOSite -Limit ALL -Detailed | Select-Object Url, SensitivityLabel$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/purview/sensitivity-labels-teams-groups-sites$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02; SharePoint Online Management Shell$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2051) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$Container labels (Groups & sites scope) don't apply to items inside the site — enabling item-level labels for SharePoint/OneDrive files is a separate, related setting. Changes to a published label's site/group settings take up to 24 hours to replicate to already-labeled containers. Some label options (external sharing, authentication context) hand site owners the ability to change those settings themselves via the label picker — don't configure those options on a label if that delegation isn't wanted.$note$
),

(
  'sharepoint:storage-near-limit',
  $ttl$Resolve sites approaching their SharePoint storage quota$ttl$,
  $sum$A site nearing its storage quota is close to hitting a hard write failure: once a site with a manually-set storage limit reaches it, uploads and saves to that site start failing outright, which is a real availability incident for whoever is working in it, not merely a housekeeping concern. Because SharePoint calculates usage with up to a 24-48 hour lag, "near limit" today can already be "at limit" in practice by the time anyone notices without proactive alerting — which is exactly what per-site storage notifications and Storage Metrics requests exist to catch before it happens.$sum$,
  jsonb_build_array(
    $prq$SharePoint Administrator (or above) in Microsoft 365 to raise a site's storage limit or switch the tenant's storage management mode$prq$,
    $prq$Enough unallocated tenant-wide storage to grant the increase, if the tenant is on manual per-site storage limits (Automatic pooled storage has no such per-site ceiling)$prq$,
    $prq$SharePoint Online Management Shell if resolving/auditing quotas at scale via PowerShell$prq$
  ),
  $apath$SharePoint admin center → Active sites → select the site → General tab → Storage limit → Edit$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Confirm the tenant's storage management mode at SharePoint admin center → Settings → Site storage limits. If it's set to Automatic, sites draw from a shared pool and don't have an individual hard ceiling to hit — the near-limit condition can only occur under Manual per-site limits, so this is the first thing to check.$stp$),
    jsonb_build_object('text', $stp$Under Manual mode, open the affected site in Active sites → General tab → Storage limit → Edit, and raise the site's storage limit (maximum 25,600 GB per site, bounded by real tenant-wide available storage). Turn on Notifications and set the percent-full threshold so site owners are emailed automatically before the next near-limit event, rather than relying on this check to catch it after the fact.$stp$, 'code', $cod$# SharePoint Online Management Shell (Connect-SPOService first)
# StorageQuota is in MB — e.g. 512000 = 500 GB
Set-SPOSite -Identity "<SiteUrl>" -StorageQuota 512000 -StorageQuotaWarningLevel 460800$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$If the tenant itself is close to its total subscription storage (not just one site), a Global Administrator can add storage space for the subscription; alternatively, switching the tenant to Automatic storage management removes individual site quotas entirely by pooling all storage.$stp$)
  ),
  $eo$Sites previously near their manual storage quota now have headroom (or the tenant is confirmed on Automatic pooled storage with no per-site ceiling), and storage notifications are configured so owners are alerted proactively before the next site approaches its limit rather than after uploads start failing.$eo$,
  $vs$Re-check each previously-flagged site's current usage against its (possibly newly raised) quota, and confirm StorageQuotaWarningLevel is set below the quota so the owner notification actually fires before the limit is hit.$vs$,
  $vc$Get-SPOSite -Limit ALL -Detailed | Select-Object Url, StorageUsageCurrent, StorageQuota, StorageQuotaWarningLevel | Where-Object { $_.StorageQuota -gt 0 -and ($_.StorageUsageCurrent / $_.StorageQuota) -ge 0.9 }$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/sharepoint/manage-site-collection-storage-limits$url$,
    $url$https://learn.microsoft.com/en-us/powershell/module/microsoft.online.sharepoint.powershell/get-sposite?view=sharepoint-ps$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02; SharePoint Online Management Shell$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2051) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$Storage usage figures lag real state by up to 24-48 hours and deleted-item Recycle Bin content doesn't count toward usage, so a site can look closer to its limit than it currently is (or vice versa). StorageQuota/StorageQuotaWarningLevel via Set-SPOSite only take effect under Manual site storage management — if the tenant uses Automatic (pooled) storage, these per-site values have no ceiling effect and site owners should instead use the in-site Storage Metrics → Request more quota flow (routes to Global Administrators) if truly out of pooled room.$note$
),

(
  'sharepoint:storage-utilization',
  $ttl$Address high SharePoint tenant storage utilization$ttl$,
  $sum$SharePoint storage is shared, finite capacity tied to the tenant's licensing — running consistently high against that ceiling isn't just a cost concern, it's a leading indicator for the exact per-site write failures the paired near-limit check flags individually. High tenant-wide utilization with no plan to add storage or reclaim space means every site is one large upload away from starting to hit real quota errors, and by the time a specific site flags as near-limit the tenant itself may already have little headroom left to grant it more.$sum$,
  jsonb_build_array(
    $prq$Global Administrator to add storage space for the subscription (purchase/licensing action) or SharePoint Administrator to review and reclaim usage$prq$,
    $prq$SharePoint Online Management Shell (or the admin center) to view current StorageQuota / StorageQuotaAllocated for the organization$prq$
  ),
  $apath$SharePoint admin center → Active sites (top-right storage bar shows total vs. available); to add storage: Microsoft 365 admin center → Billing → Your products → Add storage space for your subscription$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Confirm the real total-vs-available figures on the Active sites page's storage bar (or via PowerShell below), keeping in mind usage excludes changes from the last 24-48 hours and excludes the Recycle Bin.$stp$, 'code', $cod$# SharePoint Online Management Shell (Connect-SPOService first)
Get-SPOTenant | Select-Object StorageQuota, StorageQuotaAllocated$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Identify the real drivers of usage before buying more space: sort sites by StorageUsageCurrent to find the largest consumers, and review whether any are stale/duplicate content that inactive-site governance (see sharepoint:inactive-sites) or version-history/Recycle-Bin cleanup would reclaim.$stp$, 'code', $cod$Get-SPOSite -Limit ALL -Detailed | Sort-Object StorageUsageCurrent -Descending | Select-Object -First 25 Url, StorageUsageCurrent$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$If utilization is genuinely driven by real, needed content rather than reclaimable waste, a Global Administrator adds storage space for the subscription from the Microsoft 365 admin center's Billing → Your products page.$stp$)
  ),
  $eo$Tenant-wide SharePoint storage utilization is back to a healthy margin below total licensed capacity, either because real additional storage was purchased or because a review reclaimed space from stale/duplicate content — not left to keep climbing unaddressed toward the ceiling.$eo$,
  $vs$Re-run the StorageQuota / StorageQuotaAllocated check and confirm the utilization percentage has real headroom again, and that the largest-consumer list no longer includes content that should have been cleaned up.$vs$,
  $vc$Get-SPOTenant | Select-Object StorageQuota, StorageQuotaAllocated, @{N='PercentUsed';E={[math]::Round(($_.StorageQuotaAllocated/$_.StorageQuota)*100,1)}}$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/sharepoint/manage-site-collection-storage-limits$url$,
    $url$https://learn.microsoft.com/en-us/powershell/module/microsoft.online.sharepoint.powershell/get-spotenant?view=sharepoint-ps$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02; SharePoint Online Management Shell$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2051) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$Get-SPOTenant returns organization-level StorageQuota/StorageQuotaAllocated (both in MB) with no parameters — it always reflects the whole tenant, not a filtered subset. Adding storage space is a real billing/licensing action, so treat it as a decision to hand to whoever owns the Microsoft 365 subscription rather than something to script unattended.$note$
),

(
  'sharepoint:tenant-sharing-capability',
  $ttl$Set the tenant-level SharePoint/OneDrive external sharing capability deliberately$ttl$,
  $sum$The tenant-wide SharingCapability setting is a hard ceiling: whatever it's set to, no individual site can be configured more permissively, only more restrictively — so this single setting bounds every external-sharing decision made at the site level across the whole tenant. External sharing in SharePoint is on by default (ExternalUserAndGuestSharing, which permits anonymous "Anyone" links requiring no sign-in at all), and if that default was never deliberately reviewed and narrowed, the tenant may be carrying far more exposure than the business actually intends — anonymous links in particular can be forwarded freely to anyone, with no directory record of who ultimately has access.$sum$,
  jsonb_build_array(
    $prq$SharePoint Administrator (or Global Administrator) to change the tenant-level setting$prq$,
    $prq$A documented decision on the organization's real external-collaboration needs — Disabled and ExternalUserAndGuestSharing sit at opposite extremes and the right level depends on the business, not a universal default$prq$,
    $prq$SharePoint Online Management Shell (Microsoft.Online.SharePoint.PowerShell module) if reading/setting the value via PowerShell$prq$,
    $prq$Awareness of Microsoft Entra external collaboration settings (guest invite settings, allow/block domain lists), which apply on top of this setting whenever Microsoft Entra B2B integration is used$prq$
  ),
  $apath$SharePoint admin center → Policies → Sharing (organization-level external sharing slider)$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Check the tenant's current setting and decide the right level for the business: Only people in your organization (Disabled — no external sharing at all), Existing guests (ExistingExternalUserSharingOnly — only people already in the directory), New and existing guests (ExternalUserSharingOnly — any external user, but they must sign in / be added to the directory, no anonymous links), or Anyone (ExternalUserAndGuestSharing — permits anonymous, no-sign-in links that can be freely forwarded).$stp$, 'code', $cod$Connect-SPOService -Url https://<tenant>-admin.sharepoint.com
Get-SPOTenant | Select-Object SharingCapability$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Set the deliberate tenant-wide value. Narrowing this setting is always safe to apply immediately (any site currently configured more permissively is automatically capped down to the new tenant ceiling); widening it should be reviewed first since it raises the ceiling every site can potentially use.$stp$, 'code', $cod$Set-SPOTenant -SharingCapability ExistingExternalUserSharingOnly$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Sites can still be independently restricted below this tenant ceiling (but never above it) at SharePoint admin center → Active sites → the site → Settings → More sharing settings — use this to keep sensitive sites tighter than the tenant default rather than relying on one tenant-wide value for every site.$stp$)
  ),
  $eo$The tenant's SharingCapability reflects a deliberate decision matching real business need rather than the unreviewed ExternalUserAndGuestSharing default, and every site's effective sharing level is capped at or below that value.$eo$,
  $vs$Re-run Get-SPOTenant and confirm SharingCapability matches the documented decision; spot-check a few sites' effective SharingCapability (via Get-SPOSite -Detailed) to confirm none exceed the tenant ceiling.$vs$,
  $vc$Get-SPOTenant | Select-Object SharingCapability$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/sharepoint/external-sharing-overview$url$,
    $url$https://learn.microsoft.com/en-us/sharepoint/change-external-sharing-site$url$,
    $url$https://learn.microsoft.com/en-us/powershell/module/microsoft.online.sharepoint.powershell/set-spotenant?view=sharepoint-ps$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02; SharePoint Online Management Shell$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2051) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$This check's own executor reads sharingCapability, sharingCapabilityName, externalSharingEnabled and anonymousSharingEnabled via the SharePoint-admin executor path — the four values above map onto that same SharingCapability enum. A tighter tenant-level value always overrides a more permissive site-level one; only a site-level value equal to or more restrictive than the tenant ceiling has any effect.$note$
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

-- Self-marking row so Simulator Studio's Migrations tree reflects DB reality
-- regardless of which console ran this file.
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-02-remediation-kb-sharepoint-domain-2051.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
