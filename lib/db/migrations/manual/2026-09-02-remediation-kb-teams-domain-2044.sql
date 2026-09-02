-- #2044 — Remediation knowledge base: the teams: domain, authored & published.
--
-- Populates remediation_knowledge_base with verified "this is wrong → here is how
-- to fix it" content for EVERY active teams: check (12 rows, confirmed against
-- local `monitor_checks WHERE status='active' AND key LIKE 'teams:%'`). Before this
-- the table held 29 published identity: rows (#1924) and zero teams: rows, so every
-- teams: finding fell through to the AI fallback.
--
-- AUTHORING STANDARD (see #1924, applied here per #2044):
--   * Every row is verified against real Microsoft Learn / Microsoft Graph /
--     MicrosoftTeams PowerShell module docs that were actually fetched in build
--     session #2044 (2026-09-02). The URLs in source_urls are those pages.
--   * verified_by is an HONEST AGENT attribution — never a human name. The content
--     is agent-authored and awaiting a human spot-check (filed as a Shane To-Do).
--   * Tenant-specific values use angle-bracket placeholders (<TeamId>, …), never a
--     fabricated real value.
--   * fix_route_capability is the finding-side CEILING (#1539): you_must_run when a
--     real customer-runnable fix command is authored in a step's `code` AND was
--     itself verified against a real docs page in this session; admin_center_only
--     when the real fix is portal-only or the only genuinely-documented remediation
--     step requires manual admin-center action. NEVER we_can_run here — that shape
--     requires a live config pack mapped to the check (#1925's job).
--   * This session also queried this repo's own `monitor_checks` table directly
--     (endpoint / mapping / severity_rules columns) to ground each summary in what
--     the check actually measures, rather than guessing from the check label alone.
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
-- CLUSTER: App & external governance
-- ─────────────────────────────────────────────────────────────────────────────

(
  'teams:app-permission-policy',
  $ttl$Govern Teams apps with a custom app permission policy$ttl$,
  $sum$By default Teams ships with the org-wide global app permission policy set to allow every app — Microsoft, third-party, and custom — for every user. Without a deliberate custom policy, any user can install any published Teams app or Copilot agent with no admin review, which is a real data-exposure and phishing surface (malicious/over-permissioned third-party apps requesting broad Graph consent). A custom, allow-listed policy assigned to users is Microsoft's documented way to move off that permissive default without blocking legitimate business apps.$sum$,
  jsonb_build_array(
    $prq$Teams Administrator (or a higher role) to create and assign permission policies$prq$,
    $prq$MicrosoftTeams PowerShell module (Connect-MicrosoftTeams) if scripting the per-user assignment step$prq$,
    $prq$A reviewed list of the third-party/custom apps the organization actually needs, before restricting$prq$
  ),
  $apath$Teams admin center → Teams apps → Permission policies$apath$,
  $aurl$https://admin.teams.microsoft.com/policies/app-permission$aurl$,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Review the current Global (Org-wide default) policy and any existing custom policies under Teams admin center → Teams apps → Permission policies. Note which users currently have no explicit policy (they inherit Global, meaning "allow all").$stp$),
    jsonb_build_object('text', $stp$Select Add to create a custom policy. Under Microsoft apps, Third-party apps, and Custom apps, choose "Allow specific apps and block all others" (or the equivalent block-list) for each category, then add the apps the organization has actually reviewed and approved. This creation/edit step must happen in the Teams admin center — Microsoft does not support creating or editing app permission policies via PowerShell, only assigning an existing policy.$stp$),
    jsonb_build_object('text', $stp$Assign the new custom policy to users. This step can be scripted once the policy exists:$stp$, 'code', $cod$Connect-MicrosoftTeams
Grant-CsTeamsAppPermissionPolicy -Identity "<UserPrincipalName>" -PolicyName "<CustomAppPermissionPolicyName>"$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$If the tenant has migrated to app-centric management (ACM/UAM), permission policies no longer apply — govern per-app access instead under Teams admin center → Teams apps → Manage apps, using app centric management's per-app user/group targeting.$stp$)
  ),
  $eo$Users are covered by an explicit, reviewed custom app permission policy instead of silently inheriting the permissive Global default; only vetted Microsoft/third-party/custom apps and Copilot agents are installable.$eo$,
  $vs$In Teams admin center, go to Users → Manage users, select a sampled user, and open View policies to confirm the assigned app permission policy is the intended custom policy rather than Global (Org-wide default).$vs$,
  NULL,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/microsoftteams/teams-app-permission-policies$url$,
    $url$https://learn.microsoft.com/en-us/powershell/module/microsoftteams/grant-csteamsapppermissionpolicy$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02; MicrosoftTeams PowerShell module$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2044) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'admin_center_only',
  $note$Microsoft's own doc states policy creation/editing must happen in the Teams admin center — Grant-CsTeamsAppPermissionPolicy only assigns an already-created policy, it cannot author one. If the tenant is on app centric management, this whole policy surface is superseded (see step 4); do not treat a missing custom policy as a finding for an ACM tenant.$note$
),

(
  'teams:external-access-settings',
  $ttl$Configure Teams external access (federation) deliberately$ttl$,
  $sum$Teams external access controls whether users can chat and meet with people at other Microsoft 365 organizations, unmanaged Teams (consumer) accounts, and Skype users. The tenant default is "Allow all external domains" — every user can find, message, and meet with anyone at any other Microsoft 365 tenant that also allows it, with no per-domain vetting. Left at the default, this is a broad, un-reviewed trust relationship; a domain allow-list (or a deliberate block-list) is the documented way to scope it to organizations the business actually works with.$sum$,
  jsonb_build_array(
    $prq$Teams Administrator to change organization-wide external access settings and user policies$prq$,
    $prq$MicrosoftTeams PowerShell module (Set-CsTenantFederationConfiguration, Set-CsExternalAccessPolicy) if scripting$prq$,
    $prq$A reviewed list of the specific partner-organization domains the business actually collaborates with, before switching to an allow-list$prq$
  ),
  $apath$Teams admin center → Users → External access$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Review current organization settings: Teams admin center → Users → External access. Note whether "Teams and Skype for Business users in external organizations" is set to Allow all, Allow only specific, Block only specific, or Block all.$stp$),
    jsonb_build_object('text', $stp$Move to an allow-list of reviewed partner domains (or a block-list of specifically disallowed domains, if the business needs broad-but-not-unlimited access). Both can be scripted:$stp$, 'code', $cod$Connect-MicrosoftTeams
# Allow only specific, reviewed partner domains (all other domains become blocked)
Set-CsTenantFederationConfiguration -AllowedDomains (Get-CsAllowedDomain -Identity "<partner1.com>","<partner2.com>")
# To also block all subdomains of a domain that is not explicitly allowed:
Set-CsTenantFederationConfiguration -BlockAllSubdomains $True$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$If some users need broader (or narrower) access than the org-wide setting, assign a custom external access policy rather than changing the org-wide default for everyone:$stp$, 'code', $cod$New-CsExternalAccessPolicy -Identity "<PolicyName>" -EnableFederationAccess $true
Grant-CsExternalAccessPolicy -Identity "<UserPrincipalName>" -PolicyName "<PolicyName>"$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Review and explicitly set the related toggles on the same External access page: communication with Teams accounts not managed by an organization, chat/calls with Skype users, and (if needed) the specific-user blocklist — each defaults to a broad-allow posture and should be a deliberate decision, not an unreviewed default.$stp$)
  ),
  $eo$External access reflects a deliberate, reviewed domain allow-list (or block-list) instead of the unreviewed "allow all external domains" default; users can still be assigned broader/narrower policies where the business genuinely needs it.$eo$,
  $vs$Re-open Teams admin center → Users → External access and confirm the organization setting is no longer the un-reviewed "Allow all external domains" default, or confirm a documented business decision to keep it open.$vs$,
  $vc$Get-CsTenantFederationConfiguration | Select-Object AllowFederatedUsers, AllowedDomains, BlockedDomains, AllowTeamsConsumer$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/microsoftteams/trusted-organizations-external-meetings-chat$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02; MicrosoftTeams PowerShell module$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2044) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$"Allow all external domains" is not inherently wrong for every tenant (some businesses genuinely need open federation) — the finding is the absence of a documented decision, not the setting value itself. External access is distinct from guest access (teams:guest-membership / teams:guest-settings-governance): external access is chat/meet without joining a team; guest access grants membership in a team.$note$
),

-- ─────────────────────────────────────────────────────────────────────────────
-- CLUSTER: Guest governance
-- ─────────────────────────────────────────────────────────────────────────────

(
  'teams:guest-membership',
  $ttl$Review teams that have guest members$ttl$,
  $sum$A guest added to a team gets a real Microsoft Entra ID guest account with access to that team's channels, files, chats, and apps — the same functional surface as an internal member, just clearly labeled "(Guest)". Every team carrying guests is therefore a live external-data-exposure point that needs periodic ownership review; guests accumulate over time as projects end and access is rarely revisited unless something forces the review. Microsoft's own guidance is to track guest additions via Entra ID audit logs and run recurring Entra ID access reviews rather than trusting that owners will clean up guest access unprompted.$sum$,
  jsonb_build_array(
    $prq$Global Administrator, User Administrator, or Identity Governance Administrator to configure Entra ID access reviews$prq$,
    $prq$Microsoft Entra ID P2 (or Microsoft Entra ID Governance) for recurring automated access reviews$prq$,
    $prq$Team owners identified for each team carrying guests, to actually action the review findings$prq$
  ),
  $apath$Microsoft Entra admin center → Identity governance → Access reviews (for recurring guest review); Teams admin center → Teams → Manage teams (to inspect a specific team's guest membership)$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Identify which teams currently carry guest members (Teams admin center → Teams → Manage teams shows a Guests column per team, or use the same Graph query this check runs: GET /teams with each team's members filtered to userType eq 'Guest').$stp$),
    jsonb_build_object('text', $stp$For each team with guests, confirm with the team owner that every guest still has a legitimate, current business reason to be there. Remove any guest whose engagement has ended — team owners do this from within the Teams client, or an admin can remove the guest from the team's underlying Microsoft 365 group.$stp$),
    jsonb_build_object('text', $stp$Put this on a recurring footing rather than a one-time cleanup: in Microsoft Entra ID, create a recurring Access review scoped to guest users in Microsoft 365 groups/teams, with either the team owners or the guests themselves as reviewers.$stp$),
    jsonb_build_object('text', $stp$Track new guest additions going forward via the Entra ID audit log ("Added member to group" activity) rather than relying on manual discovery.$stp$)
  ),
  $eo$Every team carrying guest members has an owner who has recently confirmed each guest still needs access, and a recurring access review exists so this doesn't silently drift again.$eo$,
  $vs$Re-run the guest-membership check and confirm the guest count per team reflects only guests an owner has recently confirmed, not a stale, ever-growing list.$vs$,
  NULL,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/microsoftteams/guest-access$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2044) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'admin_center_only',
  $note$Having guests on a team is not itself a misconfiguration — the finding this check surfaces is exposure surface to periodically re-justify, not a binary pass/fail. Distinct from teams:guest-settings-governance, which governs what a guest is permitted to do once added, not whether they should still be there.$note$
),

(
  'teams:guest-settings-governance',
  $ttl$Restrict what guests can do inside a team (channel create/delete)$ttl$,
  $sum$Independent of whether guest access is enabled at all, each team has its own guestSettings controlling whether guest members can create, rename, or delete channels. Microsoft Graph documents exactly two booleans here — allowCreateUpdateChannels and allowDeleteChannels — and both default to permissive in many tenants. A guest who can delete channels can destroy internal collaboration structure (and the content inside it) with an account the organization does not fully control the lifecycle of; a guest who can create channels can stand up new collaboration surfaces the team owner never approved.$sum$,
  jsonb_build_array(
    $prq$Team ownership or a Teams/Global Administrator with permission to update team settings$prq$,
    $prq$Microsoft Graph PowerShell SDK (Microsoft.Graph.Teams) if automating, delegated scope TeamSettings.ReadWrite.All (or the resource-specific TeamSettings.ReadWrite.Group)$prq$
  ),
  $apath$Teams client → open the team → ⋯ → Manage team → Settings → Guest permissions$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$As the team owner, open the team in Teams → ⋯ (More options) → Manage team → Settings → Guest permissions, and review "Allow guests to create, update, and remove channels" and "Allow guests to delete channels".$stp$),
    jsonb_build_object('text', $stp$Turn off channel create/update and channel delete for guests unless the team has a specific, documented reason to grant it. This can be scripted per team via Microsoft Graph:$stp$, 'code', $cod$Import-Module Microsoft.Graph.Teams
Connect-MgGraph -Scopes "TeamSettings.ReadWrite.All"

$params = @{
  guestSettings = @{
    allowCreateUpdateChannels = $false
    allowDeleteChannels       = $false
  }
}
Update-MgTeam -TeamId "<TeamId>" -BodyParameter $params$cod$, 'codeLanguage', $lng$powershell$lng$)
  ),
  $eo$Guests on the team can view/participate in existing channels per the team's other guest settings, but can no longer create, rename, or delete channels — that capability is reserved for internal owners/members.$eo$,
  $vs$Re-read the team's guestSettings and confirm both allowCreateUpdateChannels and allowDeleteChannels are false unless a documented exception applies.$vs$,
  $vc$Get-MgTeam -TeamId "<TeamId>" -Property "guestSettings" | Select-Object -ExpandProperty GuestSettings$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/graph/api/resources/teamguestsettings$url$,
    $url$https://learn.microsoft.com/en-us/graph/api/team-update$url$
  ),
  $vag$Microsoft Graph API reference v1.0 (learn.microsoft.com), fetched 2026-09-02; Microsoft Graph PowerShell SDK (Microsoft.Graph.Teams)$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2044) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$teamGuestSettings in Graph v1.0 exposes only allowCreateUpdateChannels and allowDeleteChannels — it does not cover guest calling/meeting capability, which is a separate tenant-level Teams guest configuration, not a per-team setting. This check is per-team (fan-out over every team), so remediation is per-team, not a single tenant-wide toggle.$note$
),

-- ─────────────────────────────────────────────────────────────────────────────
-- CLUSTER: Team lifecycle & inventory
-- ─────────────────────────────────────────────────────────────────────────────

(
  'teams:inactive-teams',
  $ttl$Archive or expire teams with no recent activity$ttl$,
  $sum$A team with no member activity for an extended period still carries a live SharePoint site, mailbox, membership list, and (if guests were ever added) external access — none of that goes away on its own. Stale teams accumulate as projects end and nobody remembers to close them out, which is both a data-hygiene problem and, if the team still has guests, an ongoing external-exposure surface with no one actively watching it. Microsoft's documented answer is two-layered: an activity-based Microsoft 365 group expiration policy that auto-renews genuinely active teams and deletes truly abandoned ones, plus manual archiving (read-only, not deleted) for teams the business wants to freeze but keep.$sum$,
  jsonb_build_array(
    $prq$Groups Administrator or User Administrator to configure the Microsoft 365 groups expiration policy$prq$,
    $prq$Microsoft Entra ID P1 (or P2) licenses held for the members of groups the expiration policy applies to$prq$,
    $prq$Teams Administrator (or the team owner) to manually archive an individual stale team$prq$,
    $prq$Microsoft Graph PowerShell SDK (Microsoft.Graph.Groups) and/or MicrosoftTeams PowerShell module if scripting$prq$
  ),
  $apath$Microsoft Entra admin center → Identity → Groups → All groups → Expiration (tenant-wide policy); Teams admin center → Teams → Manage teams → select team → Archive (single team)$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Identify currently-inactive teams: Microsoft 365 admin center → Reports → Usage → Microsoft Teams → Team usage tab shows each team's Last activity date, active users, and active channels for the selected 7/30/90/180-day window.$stp$),
    jsonb_build_object('text', $stp$For teams confirmed stale by their owner, archive rather than delete — this freezes activity (read-only) but preserves content and can be reversed:$stp$, 'code', $cod$Connect-MicrosoftTeams
Set-TeamArchivedState -GroupId "<TeamId>" -Archived:$true$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$For ongoing prevention rather than one-time cleanup, configure the Microsoft 365 groups expiration policy so genuinely-used teams auto-renew (any SharePoint file activity, Outlook group message, or Teams channel visit renews the group) and truly untouched ones are flagged for owner renewal, then deleted if never renewed:$stp$, 'code', $cod$Install-Module Microsoft.Graph -Scope CurrentUser
Connect-MgGraph -Scopes "Directory.ReadWrite.All"

New-MgGroupLifecyclePolicy -GroupLifetimeInDays 365 -ManagedGroupTypes "All" `
  -AlternateNotificationEmails "<ownerless-group-notifications@yourdomain.com>"$cod$, 'codeLanguage', $lng$powershell$lng$)
  ),
  $eo$Teams with no real recent activity are either archived (frozen, content preserved) or, under a group expiration policy, are automatically renewed if genuinely still in use and deleted (after owner notification) if truly abandoned — inactive teams stop silently accumulating.$eo$,
  $vs$Re-run the Team usage report for the same window and confirm the count of teams with no recent activity and no archived/expiration-tracked status has gone down, not up.$vs$,
  $vc$Get-MgGroupLifecyclePolicy$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/microsoft-365/admin/activity-reports/microsoft-teams-usage-activity?view=o365-worldwide$url$,
    $url$https://learn.microsoft.com/en-us/entra/identity/users/groups-lifecycle$url$,
    $url$https://learn.microsoft.com/en-us/powershell/module/microsoftteams/set-teamarchivedstate$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02; Microsoft Graph PowerShell SDK (Microsoft.Graph.Groups); MicrosoftTeams PowerShell module$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2044) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$Only one Microsoft 365 group expiration policy can exist tenant-wide (or scoped to up to 500 selected groups) — check for an existing policy with Get-MgGroupLifecyclePolicy before creating a second one, which will fail. Archiving is reversible (Set-TeamArchivedState -Archived:$false); group expiration deletion is not, though a 30-day restore window applies.$note$
),

(
  'teams:inventory-count',
  $ttl$Restrict who can create teams and review public-team exposure$ttl$,
  $sum$Every Microsoft 365 group with Teams provisioning enabled counts here, and by default any licensed user can create one — a team-creation free-for-all that produces uncontrolled sprawl over time and, worse, defaults new teams to Public visibility unless a creator explicitly chooses Private. A Public team is discoverable and joinable by any tenant member with no owner approval, which is a real exposure path for whatever content lands in that team before anyone notices it was never made private. Microsoft's documented control restricts creation to a designated group while leaving those approved creators unaffected.$sum$,
  jsonb_build_array(
    $prq$Groups Administrator, User Administrator, or Global Administrator to configure the creation restriction$prq$,
    $prq$Microsoft Entra ID P1 or P2 (or Microsoft Entra Basic EDU) held by both the admin configuring the restriction and the members of the group allowed to create$prq$,
    $prq$Microsoft Graph PowerShell Beta module (Microsoft.Graph.Beta.Groups / Microsoft.Graph.Beta.Identity.DirectoryManagement) — this specific directory setting is Beta-only as of 2026-09$prq$
  ),
  $apath$Microsoft 365 admin center → Groups → Groups (to create the allowed-creators group); the creation-restriction toggle itself has no admin-center UI and is set via Microsoft Graph PowerShell$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Create (or designate) one security group whose members should be allowed to create Microsoft 365 groups/Teams — this single group is the only one usable for this restriction; other groups can be nested inside it.$stp$),
    jsonb_build_object('text', $stp$Apply the restriction via the Microsoft Graph Beta directory setting (there is no supported v1.0 or admin-center path for this specific control):$stp$, 'code', $cod$Import-Module Microsoft.Graph.Beta.Identity.DirectoryManagement
Import-Module Microsoft.Graph.Beta.Groups
Connect-MgGraph -Scopes "Directory.ReadWrite.All","Group.Read.All"

$GroupName = "<GroupAllowedToCreateTeams>"
$settingsObjectID = (Get-MgBetaDirectorySetting | Where-Object DisplayName -eq "Group.Unified").Id
$groupId = (Get-MgBetaGroup -All | Where-Object DisplayName -eq $GroupName).Id

$params = @{
  templateId = "62375ab9-6b52-47ed-826b-58e47e0e304b"
  values = @(
    @{ name = "EnableGroupCreation"; value = "False" }
    @{ name = "GroupCreationAllowedGroupId"; value = $groupId }
  )
}
Update-MgBetaDirectorySetting -DirectorySettingId $settingsObjectID -BodyParameter $params$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Separately, review any existing Public teams — a Public team is joinable tenant-wide with no owner approval. Reduce a team's visibility to Private where its content doesn't need to be broadly discoverable:$stp$, 'code', $cod$Connect-MicrosoftTeams
Set-Team -GroupId "<TeamId>" -Visibility Private$cod$, 'codeLanguage', $lng$powershell$lng$)
  ),
  $eo$Only members of the designated group can create new teams (global admins and other privileged roles remain exempt per Microsoft's documented behavior), and existing Public teams have been reviewed with unnecessary ones moved to Private.$eo$,
  $vs$Confirm the Group.Unified directory setting's EnableGroupCreation value is False and GroupCreationAllowedGroupId points at the intended group; separately re-run the inventory check and confirm the public-team count trends down.$vs$,
  $vc$(Get-MgBetaDirectorySetting -DirectorySettingId $settingsObjectID).Values$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/microsoftteams/limits-specifications-teams$url$,
    $url$https://learn.microsoft.com/en-us/powershell/module/microsoftteams/get-team$url$,
    $url$https://learn.microsoft.com/en-us/previous-versions/microsoft-365/solutions/manage-creation-of-groups$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02, including an archived/previous-versions doc whose PowerShell procedure Microsoft has not superseded; MicrosoftTeams PowerShell module; Microsoft Graph Beta PowerShell SDK$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2044) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$The group-creation-restriction source page is archived under learn.microsoft.com/previous-versions — Microsoft has not published a replacement procedure for this specific directory-setting control as of 2026-09, so its Graph Beta script remains the real, current mechanism despite the page's archived status. This check's own mapping also emits publicTeamCount (severity: warning when > 0) from the same /groups query — the two remediation halves above (restrict creation; review Public teams) address the two components of this check's finding.$note$
),

(
  'teams:team-count',
  $ttl$Review overall Teams inventory for sprawl and rationalization$ttl$,
  $sum$This check reports the raw tenant-wide team count with no severity threshold of its own — Microsoft's hard platform ceiling is 500,000 teams per Microsoft 365/Office 365 organization, so no realistic customer tenant is at structural risk from the number alone. The value of tracking it is trend-based: a team count climbing steadily with no corresponding review process is the leading indicator behind the sprawl this domain's other checks (inactive-teams, channel-sprawl, ownerless-teams, inventory-count's public-team component) individually flag. Treat a rising count with no governance process behind it as the finding, not any specific number.$sum$,
  jsonb_build_array(
    $prq$No special role is required simply to view the count; Teams Administrator or Global Administrator to act on what the review finds$prq$,
    $prq$MicrosoftTeams PowerShell module (Get-Team) if pulling the full inventory for a rationalization review$prq$
  ),
  $apath$Teams admin center → Teams → Manage teams (full list with member/channel counts); Microsoft 365 admin center → Reports → Usage → Microsoft Teams → Team usage tab (count trended over time)$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Pull the full team inventory for review rather than relying on the count alone:$stp$, 'code', $cod$Connect-MicrosoftTeams
Get-Team | Select-Object DisplayName, GroupId, Visibility, Archived | Export-Csv teams-inventory.csv -NoTypeInformation$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Cross-reference that inventory against this domain's other findings — inactive teams (teams:inactive-teams), teams with excessive channels (teams:channel-sprawl), ownerless teams (teams:ownerless-teams), and public teams (teams:inventory-count) — since those are the actionable components of overall sprawl, not the raw count.$stp$),
    jsonb_build_object('text', $stp$If no periodic review process exists, establish one (e.g. quarterly), tied to the Team usage report's trend line rather than a one-time cleanup, so the count is actively governed rather than passively growing.$stp$)
  ),
  $eo$The tenant has a documented, periodic team-inventory review process, and the count is tracked as a trend against that process rather than left to grow unobserved. There is no target number to hit — the platform ceiling (500,000 teams) is not a realistic constraint for any customer tenant.$eo$,
  $vs$Confirm a recurring inventory review is in place (e.g. a calendar cadence, or a named owner) and that the trend line in the Team usage report is being actively watched, not just generated.$vs$,
  $vc$(Get-Team).Count$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/microsoftteams/limits-specifications-teams$url$,
    $url$https://learn.microsoft.com/en-us/powershell/module/microsoftteams/get-team$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02; MicrosoftTeams PowerShell module$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2044) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'admin_center_only',
  $note$This check's live severity_rules array is empty (informational, no threshold) — unlike identity:ca-policy-count, which had a documented "Secure foundation" template baseline to compare against, there is no equivalent Microsoft-recommended target team count. Remediation here is a process (review cadence), not a config change, so no single validation_command proves it "fixed"; the command above is inventory-pull, not a pass/fail check.$note$
),

-- ─────────────────────────────────────────────────────────────────────────────
-- CLUSTER: Channels, ownership & policy coverage
-- ─────────────────────────────────────────────────────────────────────────────

(
  'teams:channel-sprawl',
  $ttl$Rationalize teams with a high channel count$ttl$,
  $sum$This check flags any team with more than 25 channels as a governance-review candidate — well short of the platform's hard 1,000-channel-per-team ceiling (standard, private and shared channels combined), but past the point where a team's channel list is still easy for members to navigate. A high channel count is usually the accumulation of stale project/topic channels nobody ever cleaned up, which makes it harder for members to find the channels that matter and increases the odds that a long-abandoned channel is still holding content (and, if it was ever a private/shared channel, its own distinct permission set) nobody is actively reviewing.$sum$,
  jsonb_build_array(
    $prq$Team ownership, or a Teams Administrator acting on the owner's behalf, to delete or consolidate channels$prq$,
    $prq$MicrosoftTeams PowerShell module (Get-TeamChannel, Remove-TeamChannel) if scripting the review/cleanup$prq$
  ),
  $apath$Team → Channels (⋯ next to the team name → Manage team → Channels tab, or open the team and view the channel list directly)$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$List the team's channels for review:$stp$, 'code', $cod$Connect-MicrosoftTeams
Get-TeamChannel -GroupId "<TeamId>" | Select-Object DisplayName, MembershipType$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Work with the team owner to identify channels with no recent posts/activity and no ongoing purpose, and confirm with them before removing anything — content isn't permanently gone immediately (channels are soft-deleted for a time), but the decision to remove should be the owner's.$stp$),
    jsonb_build_object('text', $stp$Remove confirmed-stale channels:$stp$, 'code', $cod$Remove-TeamChannel -GroupId "<TeamId>" -DisplayName "<StaleChannelName>"$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$For overlapping/duplicate channels rather than dead ones, have the owner consolidate related conversations into a single channel and remove the redundant one, instead of leaving both live.$stp$)
  ),
  $eo$The team's channel count is back under the 25-channel governance threshold (or the owner has a documented reason for keeping more), with only channels that are actually in active use remaining.$eo$,
  $vs$Recount the team's channels and confirm the total, or a clear owner-approved justification for the remaining count.$vs$,
  $vc$(Get-TeamChannel -GroupId "<TeamId>").Count$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/microsoftteams/limits-specifications-teams$url$,
    $url$https://learn.microsoft.com/en-us/powershell/module/microsoftteams/get-teamchannel$url$,
    $url$https://learn.microsoft.com/en-us/powershell/module/microsoftteams/remove-teamchannel$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02; MicrosoftTeams PowerShell module$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2044) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$Remove-TeamChannel does not delete content in associated tabs, and the channel is soft-deleted (a name can't be immediately reused) — this is not an instant, irreversible destroy. This check's own severity is "low" (a review candidate, not a hard failure) at > 25 channels; the 1,000-channel platform ceiling is headroom, not the trigger.$note$
),

(
  'teams:ownerless-teams',
  $ttl$Assign an owner to every ownerless team$ttl$,
  $sum$A team with zero owners has no one who can add or remove members, change settings, or approve join requests through the normal Teams experience — day-to-day administration silently falls to whoever in IT notices, rather than someone accountable for the team's actual purpose and membership. This typically happens when a team's sole owner leaves the organization or is converted to a guest/removed without a successor being assigned first. Microsoft's platform allows up to 100 owners per team specifically so a single point of failure here is avoidable.$sum$,
  jsonb_build_array(
    $prq$Teams Administrator, Groups Administrator, or a role with rights to modify group/team membership$prq$,
    $prq$MicrosoftTeams PowerShell module (Add-TeamUser) to assign the new owner$prq$,
    $prq$A candidate owner identified per team — typically the most active current member, or that team's manager/sponsor$prq$
  ),
  $apath$Teams admin center → Teams → Manage teams → select the team → Members tab (an admin can add an owner here even with zero existing owners)$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Identify ownerless teams — this check's own query is the authoritative source (Microsoft 365 groups with Teams provisioning enabled and an empty owners collection); an admin can also enumerate the same condition directly via Microsoft Graph.$stp$),
    jsonb_build_object('text', $stp$For each, pick the most appropriate current member (most active, or the team's sponsoring manager) and assign them as owner. Because the team has zero owners, this specific action must be performed by an admin (Teams/Groups Administrator), not a team member:$stp$, 'code', $cod$Connect-MicrosoftTeams
Add-TeamUser -GroupId "<TeamId>" -User "<NewOwnerUpn>" -Role Owner$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Where no obviously appropriate owner exists (the team is genuinely abandoned), evaluate it instead under teams:inactive-teams for archiving rather than assigning an owner just to close this finding.$stp$),
    jsonb_build_object('text', $stp$Prevent recurrence: when offboarding a user via the standard leaver process, always check whether they were the sole owner of any team and require a successor owner be assigned before their account is disabled — this is a process gap, not a one-time cleanup.$stp$)
  ),
  $eo$Every active team has at least one owner accountable for its membership and settings; no team is left administratively orphaned after its original owner departs.$eo$,
  $vs$Re-run the ownerless-teams query and confirm the team no longer appears — the same Graph shape this check itself evaluates.$vs$,
  $vc$GET https://graph.microsoft.com/v1.0/groups?$filter=resourceProvisioningOptions/Any(x:x eq 'Team')&$expand=owners($select=id) — confirm the "owners" array on the team's group is no longer empty$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/powershell/module/microsoftteams/add-teamuser$url$,
    $url$https://learn.microsoft.com/en-us/graph/api/group-list$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02; MicrosoftTeams PowerShell module; this repo's own monitor_checks.mapping for teams:ownerless-teams (confirmed via direct query against the local monitor_checks table, 2026-09-02) as the ground truth for what "ownerless" means for this specific check$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2044) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$Add-TeamUser changes can take 24–48 hours to appear in the Teams client, so validation should allow for that lag rather than expecting an immediate reflect. A team with zero owners cannot self-service this fix (no owner exists to add one) — it structurally requires an admin action, which is reflected in the steps above.$note$
),

-- ─────────────────────────────────────────────────────────────────────────────
-- CLUSTER: Policy assignment coverage
-- ─────────────────────────────────────────────────────────────────────────────

(
  'teams:meeting-policy-coverage',
  $ttl$Assign a deliberate Teams meeting policy instead of relying on Global$ttl$,
  $sum$Every user in the tenant is governed by a meeting policy — either the Global (Org-wide default) policy, or a custom one an admin explicitly assigned. Meeting policies control real security- and privacy-relevant behavior: who can bypass the meeting lobby, whether meetings can be recorded, and what external/anonymous participants can do. A user with no explicit custom assignment isn't unprotected, but they are running whatever the Global policy currently says — which drifts over time and is rarely reviewed with the same scrutiny as a deliberately-scoped custom policy for a sensitive population (e.g. an executive or finance team that meets on sensitive topics).$sum$,
  jsonb_build_array(
    $prq$Teams Administrator to create and assign meeting policies$prq$,
    $prq$MicrosoftTeams PowerShell module (Grant-CsTeamsMeetingPolicy, Get-CsOnlineUser) if scripting the assignment/audit$prq$
  ),
  $apath$Teams admin center → Meetings → Meeting policies$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Review the current Global meeting policy's settings (lobby bypass, recording, who can present) under Teams admin center → Meetings → Meeting policies → Global (Org-wide default), and decide whether it's an appropriate baseline for every user or too permissive for at least some population.$stp$),
    jsonb_build_object('text', $stp$Create a custom policy for any population that needs different controls (e.g. a stricter lobby-bypass setting for a team handling sensitive discussions), then assign it:$stp$, 'code', $cod$Connect-MicrosoftTeams
Grant-CsTeamsMeetingPolicy -Identity "<UserPrincipalName>" -PolicyName "<CustomMeetingPolicyName>"$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$For a whole department or role rather than individual users, filter and pipe the assignment:$stp$, 'code', $cod$Get-CsOnlineUser -Filter {Department -eq "<DepartmentName>"} | Grant-CsTeamsMeetingPolicy -PolicyName "<CustomMeetingPolicyName>"$cod$, 'codeLanguage', $lng$powershell$lng$)
  ),
  $eo$Users who need behavior different from the Global default (stricter lobby controls, recording restrictions, etc.) are on an explicitly-assigned custom policy reviewed for their specific needs, rather than everyone uniformly inheriting whatever the Global policy currently says.$eo$,
  $vs$Sample users from the population that was meant to receive the custom policy and confirm the assignment took effect.$vs$,
  $vc$Get-CsOnlineUser -Identity "<UserPrincipalName>" -Properties EffectivePolicyAssignments | Select-Object -ExpandProperty EffectivePolicyAssignments$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/microsoftteams/meeting-policies-overview$url$,
    $url$https://learn.microsoft.com/en-us/powershell/module/microsoftteams/grant-csteamsmeetingpolicy$url$,
    $url$https://learn.microsoft.com/en-us/powershell/module/microsoftteams/get-csonlineuser$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02; MicrosoftTeams PowerShell module$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2044) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$This check's own severity_rules array is empty — it's a coverage/inventory signal (are custom policies assigned at all), not a single threshold. A user inheriting Global is not automatically a finding; the real question this raises is whether Global's own settings were deliberately reviewed for every population that inherits it. EffectivePolicyAssignments in Get-CsOnlineUser output requires Teams PowerShell Module 7.1.1 Preview or later.$note$
),

(
  'teams:messaging-policy-coverage',
  $ttl$Assign a deliberate Teams messaging policy instead of relying on Global$ttl$,
  $sum$Messaging policies govern real data-handling and compliance-relevant behavior in Teams chat and channels: whether sent messages can be edited or deleted (affecting eDiscovery/audit trail integrity), whether Giphy/memes/stickers are allowed, and URL preview behavior. As with meeting policies, every user is covered by either the Global default or an explicitly-assigned custom policy — coverage by a custom policy signals a population whose messaging behavior was deliberately reviewed (for example, a compliance-sensitive team where "users can delete sent messages" should be off to preserve an accurate record) rather than left to whatever Global currently allows.$sum$,
  jsonb_build_array(
    $prq$Teams Administrator to create and assign messaging policies$prq$,
    $prq$MicrosoftTeams PowerShell module (Grant-CsTeamsMessagingPolicy) if scripting the assignment$prq$
  ),
  $apath$Teams admin center → Messaging policies$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Review the current Global messaging policy under Teams admin center → Messaging policies → Global (Org-wide default), in particular "Owners can delete sent messages," "Delete sent messages," and "Edit sent messages" for any population where message-record integrity matters.$stp$),
    jsonb_build_object('text', $stp$Create a custom policy for populations that need different controls — e.g. a "Retain sent messages" policy with edit/delete turned off for a compliance-sensitive team — then assign it:$stp$, 'code', $cod$Connect-MicrosoftTeams
Grant-CsTeamsMessagingPolicy -Identity "<UserPrincipalName>" -PolicyName "<CustomMessagingPolicyName>"$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$For a whole department rather than individual users:$stp$, 'code', $cod$Get-CsOnlineUser -Filter {Department -eq "<DepartmentName>"} | Grant-CsTeamsMessagingPolicy -PolicyName "<CustomMessagingPolicyName>"$cod$, 'codeLanguage', $lng$powershell$lng$)
  ),
  $eo$Populations with genuine message-integrity or content-control requirements are on an explicitly-assigned custom messaging policy, rather than uniformly inheriting whatever the Global default currently allows.$eo$,
  $vs$Sample users from the population meant to receive the custom policy and confirm the assignment took effect.$vs$,
  $vc$Get-CsOnlineUser -Identity "<UserPrincipalName>" -Properties EffectivePolicyAssignments | Select-Object -ExpandProperty EffectivePolicyAssignments$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/microsoftteams/messaging-policies-in-teams$url$,
    $url$https://learn.microsoft.com/en-us/powershell/module/microsoftteams/grant-csteamsmessagingpolicy$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02; MicrosoftTeams PowerShell module$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2044) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$Like meeting-policy-coverage, this check's severity_rules is empty — a coverage signal, not a hard fail. "Delete sent messages" being on by default is intentional Teams UX, not a misconfiguration; the finding is the absence of a reviewed exception for populations that need message-record integrity.$note$
),

-- ─────────────────────────────────────────────────────────────────────────────
-- CLUSTER: Teams Rooms devices
-- ─────────────────────────────────────────────────────────────────────────────

(
  'teams:rooms-device-health',
  $ttl$Remediate non-compliant Teams Rooms devices$ttl$,
  $sum$This check reads Intune's managedDevices compliance state and counts Teams Rooms devices reporting non-compliant. A non-compliant room device typically means it's failed a configured Intune compliance policy (out-of-date OS/firmware, missing required configuration) or has lost connectivity/gone offline — either way, it's a meeting-room endpoint that isn't provably meeting the organization's device baseline, which matters because Teams Rooms devices are always-on, always-signed-in shared endpoints sitting on the corporate network. Microsoft's device health status model (Healthy / Non-urgent / Critical / Offline) is designed to be triaged in the Teams admin center or the newer Teams Rooms Pro Management portal, not fixed by a single script.$sum$,
  jsonb_build_array(
    $prq$Teams Administrator or Teams Devices Administrator role to view and act on device health$prq$,
    $prq$Devices already enrolled in Microsoft Intune with at least one compliance policy configured — this check has no signal at all for a tenant that hasn't enrolled its room devices$prq$,
    $prq$Physical or remote access to the room (for hardware-level issues a remote restart/update can't resolve, e.g. a disconnected peripheral)$prq$
  ),
  $apath$Teams admin center → Teams Devices → Teams Rooms on Windows (or the relevant device category) — select the device to open its Health status panel$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Open Teams admin center → Teams Devices, select the affected device category, and find the non-compliant device. Select its health status to open the Health status panel and see the specific Critical/Non-urgent issues driving the state (e.g. a disconnected peripheral, a pending firmware update, a sign-in failure).$stp$),
    jsonb_build_object('text', $stp$For a software/firmware gap: select the device → Update, review available software and firmware updates, and install them (can be scheduled for a specific date/time local to the device to avoid disrupting a room in active use).$stp$),
    jsonb_build_object('text', $stp$For a peripheral-driven Critical status (e.g. a disconnected camera or speaker marked Critical-impact by default): either physically reconnect the peripheral, or — if that peripheral genuinely shouldn't gate the room's overall health — use Manage health impact to reclassify its severity, understanding this can also suppress a real future alert for that peripheral.$stp$),
    jsonb_build_object('text', $stp$For "No connection" (lost link to Teams admin center): restart the device from Teams admin center (Select device → Restart), or physically power-cycle it if remote restart doesn't restore connectivity.$stp$),
    jsonb_build_object('text', $stp$For Teams Rooms Pro-licensed devices, use the Teams Rooms Pro Management portal instead — it's the platform Microsoft is consolidating device monitoring/management into and covers the same health, update, and diagnostic actions.$stp$)
  ),
  $eo$The device's health status returns to Healthy in the Teams admin center (or Teams Rooms Pro Management portal), and Intune reports it compliant against the organization's configured compliance policy.$eo$,
  $vs$Re-open the device's Health status panel and confirm no Critical or Non-urgent issues remain, and confirm Intune's compliance state for the device shows compliant.$vs$,
  NULL,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/microsoftteams/devices/teams-device-health$url$,
    $url$https://learn.microsoft.com/en-us/microsoftteams/devices/device-management$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2044) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'admin_center_only',
  $note$No documented single PowerShell/Graph command remediates a non-compliant device end-to-end — health issues span firmware, peripherals, connectivity and Intune compliance policy, each requiring a different portal action, so this is authored admin_center_only rather than you_must_run. Microsoft is actively moving device management from the classic Teams admin center device pages into the Teams Rooms Pro Management portal (documented deprecation notice on both fetched pages as of 2026-07) — if the tenant hasn't migrated yet, use the classic Teams admin center path above; if it has, use the Pro Management portal instead. This check has zero signal for a tenant that hasn't enrolled its room devices in Intune at all — that absence should be treated as a bigger gap than any individual non-compliant count.$note$
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

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-02-remediation-kb-teams-domain-2044.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
