-- #2046 — Remediation knowledge base: the adoption: domain, authored & published.
--
-- Populates remediation_knowledge_base with verified content for every active
-- adoption: check (10 rows). Authoring standard: #1924 (identity: domain reference
-- implementation: 2026-08-31-remediation-kb-identity-domain-1924.sql).
--
-- These checks are a different SHAPE from identity:'s misconfiguration findings —
-- every adoption: check is a Microsoft 365 admin center USAGE REPORT or a live Graph
-- collection read (per-user email/Teams/SharePoint/Viva Engage activity, Microsoft 365
-- Apps platform activation, Planner plans in a group, Viva Engage communities, Teams
-- Phone provisioning), and the "finding" is low/zero measured adoption, not a
-- misconfigured control. So the authored content here is deliberately NOT a
-- Conditional-Access-style "flip this setting" script for every row — for the seven
-- report-backed checks, it's the real, Microsoft-documented explanation of what the
-- report measures, the real non-adoption causes to rule out first (report data lag,
-- license assignment, the tenant-wide concealed-names setting), and the real
-- Microsoft-endorsed lever to drive adoption once those are ruled out. For the three
-- feature-provisioning checks (Planner, Teams Phone, Viva Engage communities) the fix
-- is the real provisioning path — Microsoft 365 Group creation policy, Teams Phone
-- Enterprise Voice enablement, and Viva Engage community creation, respectively.
--
-- AUTHORING STANDARD (see #1924):
--   * Every row is verified against real Microsoft Learn / official Microsoft Graph
--     docs actually fetched in THIS build session (2026-09-02). The URLs in
--     source_urls are those pages.
--   * verified_by is an HONEST AGENT attribution — never a human name.
--   * Tenant-specific values use angle-bracket placeholders, never a fabricated value.
--   * fix_route_capability is the finding-side CEILING (#1539): you_must_run when a
--     real customer-runnable fix script is authored; admin_center_only when the real
--     fix is portal-only (true for most of this domain — usage-report interpretation
--     and Viva Engage community creation currently lack a stable v1.0/non-preview
--     Graph write surface this session could verify). NEVER we_can_run here.
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
-- CLUSTER: Exchange / overall / SharePoint / Teams usage-report trends
-- ─────────────────────────────────────────────────────────────────────────────

(
  'adoption:email-activity-trend',
  $ttl$Investigate and raise zero/low Exchange email activity$ttl$,
  $sum$No licensed user shows any send/read email activity in the monitored window. Because the Exchange email activity report only includes mailboxes with an assigned license, a genuine zero almost always means one of three things: the report is still within its normal data-availability lag (Microsoft states data typically appears within 24–72 hours of a service starting to report, but can take several days), the licenses driving this check are assigned to accounts that aren't real active mailboxes yet (a new tenant or a bulk-onboarding batch), or the organization is licensed for Exchange but genuinely isn't using it as the primary mail path (e.g. mail still flows on-premises or through a third party). Left uninvestigated, this is either a false alarm from data lag or a sign the customer is paying for Exchange licenses nobody uses — both are worth resolving, for different reasons.$sum$,
  jsonb_build_array(
    $prq$Reports Reader (or Global Administrator, Exchange Administrator, Usage Summary Reports Reader) to view the Email activity report$prq$,
    $prq$Global Administrator only if concealed user/group/site names in reports need to be turned off to see real usernames$prq$
  ),
  $apath$Microsoft 365 admin center → Reports → Usage → Exchange → Email activity tab$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Confirm the report isn't simply still warming up: usage reports "typically become available within 24 to 72 hours, but might sometimes take several days" after a mailbox starts reporting. Re-check after that window before treating a brand-new tenant/mailbox as a real finding.$stp$),
    jsonb_build_object('text', $stp$Cross-check against Users → Active users that the accounts expected to be mailboxes actually hold an Exchange-enabling license (Exchange Online Plan 1/2, or a Microsoft 365/Office 365 suite SKU) and aren't disabled/blocked sign-in.$stp$),
    jsonb_build_object('text', $stp$If usernames appear anonymized ("User 1", "User 2" …) and real identities are needed to follow up with specific people, a Global Administrator can turn off concealment tenant-wide: Settings → Org Settings → Services tab → Reports → uncheck "Conceal user, group, and site names in all reports" → Save. This only changes display, never the underlying activity counts.$stp$),
    jsonb_build_object('text', $stp$If licenses are correctly assigned and the window has passed and email activity is still genuinely zero, this is an adoption/communication problem, not a technical one: confirm with the customer whether Exchange Online is actually their mail path (vs. on-premises Exchange or a third-party mail provider co-existing with the license), and if it should be, run a short internal communication/training push before re-scanning.$stp$)
  ),
  $eo$The Email activity report shows non-zero Send/Read/Receive activity for licensed users within the monitored window, or the customer has confirmed Exchange Online genuinely isn't their active mail path (a business fact, not a fixable technical gap).$eo$,
  $vs$Re-open the Email activity report after the data-lag window and after any communication push, and confirm licensed users now show non-zero Send actions/Read actions with a recent Last activity date.$vs$,
  NULL,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/microsoft-365/admin/activity-reports/activity-reports?view=o365-worldwide$url$,
    $url$https://learn.microsoft.com/en-us/microsoft-365/admin/activity-reports/email-activity-ww?view=o365-worldwide$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2046) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'admin_center_only',
  $note$No validation_command: this is a Graph reports read (getEmailActivityUserDetail), not a settable control — there is nothing to script "on". The only real script-shaped lever (concealment toggle) is captured as a remediation step, not the top-level fix, because it changes display only.$note$
),

(
  'adoption:overall-active-rate',
  $ttl$Investigate and raise a zero/low overall Microsoft 365 active-user rate$ttl$,
  $sum$No users show any active usage across Microsoft 365 (Exchange, OneDrive, SharePoint, Viva Engage, Teams combined) in the monitored window — the broadest possible adoption signal, and the bluntest. A genuine tenant-wide zero after the report's normal data-availability lag (Microsoft states 24–72 hours, sometimes longer) means either licenses are assigned but the tenant hasn't actually onboarded onto Microsoft 365 as its daily-work platform yet, or licenses are provisioned ahead of a planned rollout that hasn't started. This is the one check where "zero" is rarely a config bug — it is almost always a rollout/adoption-timeline fact worth surfacing to the customer plainly rather than treated as something to silently re-scan.$sum$,
  jsonb_build_array(
    $prq$Reports Reader (or Global Administrator, Exchange Administrator, Usage Summary Reports Reader) to view the Active Users report$prq$,
    $prq$Global Administrator only if concealed names need to be turned off$prq$
  ),
  $apath$Microsoft 365 admin center → Reports → Usage → Microsoft 365 apps → Active users tab$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Confirm the tenant is past the report's normal data-availability lag (24–72 hours, sometimes several days for a brand-new tenant) before treating a fresh onboarding as a real finding.$stp$),
    jsonb_build_object('text', $stp$Review the report's per-service breakdown (Exchange, OneDrive, SharePoint, Viva Engage, Microsoft Teams) rather than only the combined number — a tenant can be fully dark on one service while active elsewhere, which changes the remediation from "nobody uses Microsoft 365" to "nobody uses this one service".$stp$),
    jsonb_build_object('text', $stp$Confirm with the customer whether this reflects a rollout not yet started (licenses purchased ahead of a planned go-live) versus a completed rollout with genuinely low adoption. These require different responses: a scheduling conversation for the former, a training/communication push and possibly a re-evaluation of which licenses are actually needed for the latter.$stp$),
    jsonb_build_object('text', $stp$Where usernames are anonymized and real follow-up is needed: Settings → Org Settings → Services → Reports → uncheck "Conceal user, group, and site names in all reports" → Save (Global Administrator only; display-only change).$stp$)
  ),
  $eo$The Active Users report shows real, non-zero usage across at least the services the customer intends to use day to day, or the customer has confirmed and dated a not-yet-started rollout (a scheduling fact, not an outstanding technical gap).$eo$,
  $vs$Re-open the Active Users report after the rollout/communication timeline and confirm non-zero per-service active counts.$vs$,
  NULL,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/microsoft-365/admin/activity-reports/activity-reports?view=o365-worldwide$url$,
    $url$https://learn.microsoft.com/en-us/microsoft-365/admin/activity-reports/active-users-ww?view=o365-worldwide$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2046) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'admin_center_only',
  $note$No validation_command: getOffice365ActiveUserDetail is a reports read, not a settable control. Pair with the per-service checks (email-activity-trend, sharepoint-onedrive-trend, teams-activity-trend, viva-engage-user-activity) to localize which service is actually dark.$note$
),

(
  'adoption:sharepoint-onedrive-trend',
  $ttl$Investigate and raise zero/low SharePoint/OneDrive site activity$ttl$,
  $sum$No SharePoint or OneDrive site shows active-file, sync, sharing, or page-view activity in the monitored window (the SharePoint Site usage report's Last activity date tracks five specific audit-log event groups: ActiveFiles, AnonymousLinkShared, CompanyLinkShared, FilesSynced, PagesViewed — a real zero means none of those five fired on any site). Because this report is per-SITE rather than per-user, a zero can mean either genuinely no one is storing/opening files in SharePoint/OneDrive yet, or that the sites being measured are system/template sites (e.g. a search center, a newly provisioned but unused team site) rather than the ones people actually work in.$sum$,
  jsonb_build_array(
    $prq$Reports Reader (or Global Administrator, SharePoint Administrator, Usage Summary Reports Reader) to view the SharePoint Site usage report$prq$,
    $prq$Global Administrator only if concealed site URLs/owners need to be turned off$prq$
  ),
  $apath$Microsoft 365 admin center → Reports → Usage → SharePoint → Site usage tab$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Export the Site usage report (Choose columns → include Root Web Template) and filter out system/template sites so the finding reflects real collaboration sites, not search centers or unused provisioning artifacts.$stp$),
    jsonb_build_object('text', $stp$Confirm the report's normal data lag has passed (24–72 hours, sometimes longer for newly created sites) before treating a brand-new site as a real finding.$stp$),
    jsonb_build_object('text', $stp$If genuinely zero-activity sites remain after filtering, check whether OneDrive provisioning itself has completed for those users (OneDrive is a per-user site that must be provisioned before it can show activity) via the OneDrive usage report or SharePoint admin center → Active sites.$stp$),
    jsonb_build_object('text', $stp$Where real activity should exist but doesn't, this is a training/communication gap: point users at the specific team site/library they should be using, since a common root cause is people saving files locally or to a personal OneDrive account instead of the org's SharePoint.$stp$)
  ),
  $eo$The SharePoint Site usage report shows a non-zero Active files/Page views count and a recent Last activity date (UTC) for the tenant's real collaboration sites, once system/template sites are excluded from the read.$eo$,
  $vs$Re-open the Site usage report, re-filter to real collaboration sites, and confirm Active files and Last activity date have moved.$vs$,
  NULL,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/microsoft-365/admin/activity-reports/activity-reports?view=o365-worldwide$url$,
    $url$https://learn.microsoft.com/en-us/microsoft-365/admin/activity-reports/sharepoint-site-usage-ww?view=o365-worldwide$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2046) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'admin_center_only',
  $note$No validation_command: getSharePointSiteUsageDetail is a reports read. Distinct from adoption:sharepoint-user-activity, which reads the per-USER getSharePointActivityUserDetail report instead of this per-SITE one — pair the two when localizing whether the gap is site-level or user-level.$note$
),

(
  'adoption:sharepoint-user-activity',
  $ttl$Investigate and raise zero/low per-user SharePoint file activity$ttl$,
  $sum$No licensed SharePoint user appears in the per-user SharePoint activity report — nobody has viewed, edited, synced, or shared a file in the monitored window. This is the per-USER counterpart to the site-level SharePoint/OneDrive trend check: a site can look active (files exist, storage is consumed from an initial migration) while the per-user activity report is genuinely empty, which specifically points at people not opening/editing files themselves rather than at SharePoint being unprovisioned.$sum$,
  jsonb_build_array(
    $prq$Reports Reader (or Global Administrator, SharePoint Administrator, Usage Summary Reports Reader) to view the SharePoint Activity report$prq$,
    $prq$Global Administrator only if concealed usernames need to be turned off$prq$
  ),
  $apath$Microsoft 365 admin center → Reports → Usage → SharePoint → Activity tab$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Confirm the report's normal data lag has passed (24–72 hours, sometimes longer) and that the users being measured hold a SharePoint-enabling license (this report only includes licensed SharePoint users).$stp$),
    jsonb_build_object('text', $stp$Cross-check against the per-site SharePoint Site usage report (adoption:sharepoint-onedrive-trend) — files existing and being viewed by a service account or via sync only, with zero real per-user "Files viewed or edited" activity, points at a migration that landed content but never got users onto SharePoint as their working location.$stp$),
    jsonb_build_object('text', $stp$If genuinely no one is opening files, this is a training/adoption gap: confirm with the customer where people are actually working today (local drives, a personal OneDrive, a legacy file server) and run a migration/communication push to move real daily work onto the licensed SharePoint site.$stp$)
  ),
  $eo$The SharePoint Activity report shows a non-zero "Files viewed or edited" count and a recent Last activity date (UTC) for licensed users.$eo$,
  $vs$Re-open the SharePoint Activity report after the communication/migration push and confirm licensed users now show non-zero file activity.$vs$,
  NULL,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/microsoft-365/admin/activity-reports/activity-reports?view=o365-worldwide$url$,
    $url$https://learn.microsoft.com/en-us/microsoft-365/admin/activity-reports/sharepoint-activity-ww?view=o365-worldwide$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2046) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'admin_center_only',
  $note$No validation_command: getSharePointActivityUserDetail is a reports read. Pair with adoption:sharepoint-onedrive-trend (the per-site report) to tell a "no one uses SharePoint at all" finding apart from a "SharePoint has content but no one opens it" finding.$note$
),

(
  'adoption:teams-activity-trend',
  $ttl$Investigate and raise zero/low Microsoft Teams activity$ttl$,
  $sum$No licensed user shows any Teams messaging, call, or meeting activity in the monitored window. Because Microsoft Teams is normally the customer's primary real-time collaboration and calling surface, a genuine zero after the report's data lag has passed is a strong adoption signal — either the tenant hasn't rolled Teams out as the daily communication tool yet (a competing tool like Slack/Zoom/Skype is still primary), or Teams licenses were assigned ahead of a planned cutover that hasn't happened.$sum$,
  jsonb_build_array(
    $prq$Reports Reader (or Global Administrator, Teams Administrator, Teams Communications Administrator, Usage Summary Reports Reader) to view the Teams user activity report$prq$,
    $prq$Global Administrator only if concealed usernames need to be turned off$prq$
  ),
  $apath$Microsoft 365 admin center → Reports → Usage → Microsoft Teams → User activity tab$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Confirm the report's normal data lag has passed. Microsoft also runs a daily data-validation pass over the last three days that can retroactively fill gaps — a recent zero can still resolve itself without any action within that window.$stp$),
    jsonb_build_object('text', $stp$Confirm the users being measured are licensed for Teams ("Is licensed" column) and check whether they're still primarily using an alternative tool (Skype for Business on-premises, Zoom, Slack) that a migration/cutover hasn't fully retired yet.$stp$),
    jsonb_build_object('text', $stp$If genuinely no one is using Teams and it should be the primary tool, this is an adoption/change-management gap rather than a technical one: schedule end-user training and a formal cutover date away from any legacy tool still in use, then re-scan after that date.$stp$)
  ),
  $eo$The Teams user activity report shows non-zero channel/chat messages, calls, or meetings for licensed users with a recent Last activity date (UTC).$eo$,
  $vs$Re-open the Teams user activity report after the cutover/training window and confirm licensed users now show non-zero Teams activity.$vs$,
  NULL,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/microsoft-365/admin/activity-reports/activity-reports?view=o365-worldwide$url$,
    $url$https://learn.microsoft.com/en-us/microsoft-365/admin/activity-reports/microsoft-teams-user-activity-preview?view=o365-worldwide$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2046) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'admin_center_only',
  $note$No validation_command: getTeamsUserActivityUserDetail is a reports read. Distinct from adoption:teams-phone-provisioning, which is about Enterprise Voice/calling-plan provisioning rather than general Teams chat/meeting usage.$note$
),

-- ─────────────────────────────────────────────────────────────────────────────
-- CLUSTER: Microsoft 365 Apps / mobile
-- ─────────────────────────────────────────────────────────────────────────────

(
  'adoption:m365-mobile-app-usage',
  $ttl$Drive Microsoft 365 Apps mobile activation and usage$ttl$,
  $sum$No user in the Microsoft 365 Apps usage report shows activity on the mobile platform column, meaning nobody has activated or used Outlook/Word/Excel/PowerPoint/Teams on a phone or tablet in the monitored window. Mobile usage typically lags desktop/web adoption because it requires an extra, easy-to-skip step — installing the app and signing in on a personal or corporate device — and because unmanaged personal devices are a real (if often unstated) data-security concern for admins who haven't set up mobile app management, which can itself suppress adoption if IT is quietly discouraging BYOD mobile use without a policy to make it safe.$sum$,
  jsonb_build_array(
    $prq$Reports Reader (or Global Administrator, Usage Summary Reports Reader) to view the Microsoft 365 Apps usage report$prq$,
    $prq$Microsoft 365 Apps for business/enterprise licensing that includes mobile apps, assigned to the users in question$prq$,
    $prq$Intune licensing plus an Intune Administrator (or equivalent) role, only if deploying app protection policies to make mobile use safe for unmanaged devices$prq$
  ),
  $apath$Microsoft 365 admin center → Reports → Usage → Microsoft 365 apps → Usage tab (Platforms chart); Intune admin center → Apps → App protection policies, to create a policy$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Confirm the report's normal data lag has passed (data usually covers up to the last two days, with a minor refresh every six days) and that the users being measured hold a Microsoft 365 Apps license that includes mobile.$stp$),
    jsonb_build_object('text', $stp$If mobile use is being discouraged informally because unmanaged personal devices are a security concern, close that gap directly rather than leaving mobile usage at zero: create an Intune app protection policy (App Protection Policies, "APP"/MAM) so corporate data in Outlook/Word/Excel/PowerPoint/Teams mobile is protected (PIN, encryption, block copy-paste to personal apps, selective wipe) WITHOUT requiring full device enrollment — this is specifically designed for BYOD.$stp$),
    jsonb_build_object('text', $stp$Communicate to users that the mobile apps are approved and protected once the policy above is live, and point them at installing Outlook mobile / the Microsoft 365 (Office) mobile app and signing in with their work account.$stp$)
  ),
  $eo$The Microsoft 365 Apps usage report's Platforms chart shows non-zero active users on Mobile, with "Activity on mobile" = true for a meaningful share of licensed users, and — if BYOD was the blocker — an Intune app protection policy is live protecting corporate data on those devices.$eo$,
  $vs$Re-open the Microsoft 365 Apps usage report's Platforms chart after the app protection policy goes live and the adoption communication goes out, and confirm mobile active-user counts move off zero.$vs$,
  NULL,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/microsoft-365/admin/activity-reports/microsoft365-apps-usage-ww?view=o365-worldwide$url$,
    $url$https://learn.microsoft.com/en-us/intune/app-management/protection/overview$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2046) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'admin_center_only',
  $note$getM365AppUserDetail is a reports read with no settable control of its own; the one genuinely scriptable lever here (the Intune app protection policy) is authored as an admin-centre fix because creating one is a multi-decision policy-design exercise (which apps, which platforms, which protection level), not a single safe default command to hand a customer to run blind.$note$
),

-- ─────────────────────────────────────────────────────────────────────────────
-- CLUSTER: Planner / Teams Phone / Viva Engage — feature provisioning
-- ─────────────────────────────────────────────────────────────────────────────

(
  'adoption:planner-usage',
  $ttl$Investigate zero Planner plans in a Microsoft 365 Group$ttl$,
  $sum$A Microsoft 365 Group has zero Planner plans. Planner plans live inside Microsoft 365 Groups, so this can mean either that the group's members genuinely haven't adopted Planner for task tracking (a real adoption gap, since a workspace with no shared task list usually means work is being tracked informally or in a tool outside the platform), or — less obviously — that Microsoft 365 Group creation itself has been restricted tenant-wide and this group's members can't create a plan even if they wanted to, which is a policy fact rather than a usage habit.$sum$,
  jsonb_build_array(
    $prq$Global Administrator, Groups Administrator, or Exchange/SharePoint/Teams Service Administrator to check/adjust Microsoft 365 Group creation policy$prq$,
    $prq$Microsoft Entra ID P1 or P2 (or Entra Basic EDU) license on the admin AND on members of the group-creators security group, only if group-creation restriction needs adjusting$prq$,
    $prq$Microsoft Graph PowerShell SDK (Microsoft.Graph.Beta.Identity.DirectoryManagement, Microsoft.Graph.Beta.Groups) if adjusting the policy via PowerShell$prq$
  ),
  $apath$Microsoft 365 admin center → Groups → Active groups (to inspect the group); Planner for the web (New Plan) to create a plan inside the group$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Confirm whether Microsoft 365 Group creation is restricted tenant-wide: if a "Group Creators" security group and an EnableGroupCreation=False directory setting exist, only its members (plus certain admin roles) can create a group or a Planner plan inside one — a member of this specific group who isn't in that allow-list will hit a blocked message rather than being able to add a plan at all.$stp$, 'code', $cod$Connect-MgGraph -Scopes 'Directory.Read.All'
(Get-MgBetaDirectorySetting | Where-Object DisplayName -eq 'Group.Unified').Values | Where-Object Name -in @('EnableGroupCreation','GroupCreationAllowedGroupId')$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$If creation is restricted and this group's members should be able to use Planner, add them to the designated group-creators security group (or, if none is intended, confirm with the customer and adjust EnableGroupCreation/GroupCreationAllowedGroupId via the Microsoft Graph Beta PowerShell module).$stp$),
    jsonb_build_object('text', $stp$If group creation is unrestricted and the group simply hasn't adopted Planner, this is a training/communication gap: have a group member create a plan (Planner → New Plan, or from the group's Teams tab) and seed it with the group's real, current tasks so it starts as a working list rather than an empty shell nobody opens.$stp$)
  ),
  $eo$The group has at least one real, actively-updated Planner plan, and — if group creation was restricted — the group's members are confirmed to be within the allowed group-creators population so the gap wasn't policy-driven.$eo$,
  $vs$Re-query the group's Planner plans and confirm at least one exists with tasks that have been created or modified recently.$vs$,
  $vc$Connect-MgGraph -Scopes 'Group.Read.All'
Get-MgGroupPlannerPlan -GroupId "<GroupId>"$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/microsoft-365/enterprise/manage-creation-of-groups?view=o365-worldwide$url$,
    $url$https://learn.microsoft.com/en-us/microsoft-365/admin/activity-reports/planner-activity?view=o365-worldwide$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02; Microsoft Graph PowerShell SDK (Microsoft.Graph.Beta.Groups)$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2046) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'admin_center_only',
  $note$This check reads /groups/{itemId}/planner/plans directly (a live Graph collection), not a usage report — severity_rules is empty in monitor_checks as of this session, so there's currently no defined threshold distinguishing "this group genuinely doesn't need Planner" from a real gap; treat a single quiet group as a mild signal, not a hard finding, until a real severity rule is authored. fix_route_capability is admin_center_only because both real fixes (group-creation policy, or a human creating and seeding a plan) are portal-driven judgment calls, not a safe blind script.$note$
),

(
  'adoption:teams-phone-provisioning',
  $ttl$Provision Teams Phone (Enterprise Voice) for users who need calling$ttl$,
  $sum$No user in the tenant is provisioned for Teams Phone — nobody is both Enterprise Voice–enabled and has an assigned line URI, meaning Teams cannot be used to make or receive PSTN phone calls for anyone. Unlike the usage-report checks in this domain, a zero here is often a legitimate business fact rather than a gap: many tenants deliberately don't buy Teams Phone (calling plan/direct routing/operator connect all cost extra per-user licensing on top of a Teams license), so this check should be read as "confirm this is a deliberate choice", not "immediately provision phones for everyone".$sum$,
  jsonb_build_array(
    $prq$A Teams Phone-enabling license (Teams Phone Standard, or Microsoft 365/Office 365 E5, which includes it) assigned to each user who needs calling$prq$,
    $prq$A chosen PSTN connectivity option already in place: Microsoft Calling Plan, Operator Connect, Teams Phone Mobile, or Direct Routing (each has its own separate setup)$prq$,
    $prq$Teams Administrator role (or equivalent) to assign phone numbers and enable Enterprise Voice$prq$,
    $prq$Microsoft Teams PowerShell module if automating, cmdlet Set-CsPhoneNumberAssignment$prq$
  ),
  $apath$Microsoft Teams admin center → Users → Manage users → (select user) → Account tab → Assigned phone number → Enterprise Voice$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$First confirm with the customer whether Teams Phone was ever intended to be purchased and configured for anyone — if it wasn't, this is a confirmed non-finding, not a gap to close.$stp$),
    jsonb_build_object('text', $stp$If it should exist: buy and assign a Teams Phone-enabling license to the users who need calling, and choose a PSTN connectivity option (Calling Plan, Operator Connect, Teams Phone Mobile, or Direct Routing) if one isn't already in place — this is a licensing/carrier decision, not something to script blind.$stp$),
    jsonb_build_object('text', $stp$Assign a phone number and enable Enterprise Voice per user. In the Teams admin center: Users → Manage users → select the user → Account tab → Assigned phone number → set Phone number type and turn Enterprise Voice On → Save. Equivalent PowerShell, once a connectivity option and number are chosen (Direct Routing example — assigning a number auto-enables Enterprise Voice):$stp$, 'code', $cod$Connect-MicrosoftTeams
Set-CsPhoneNumberAssignment -Identity "<UserPrincipalName>" -PhoneNumber "<E.164PhoneNumber>" -PhoneNumberType DirectRouting

# If the number is managed on-premises and only Enterprise Voice needs enabling online:
Set-CsPhoneNumberAssignment -Identity "<UserPrincipalName>" -EnterpriseVoiceEnabled $true$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Assign the user "Teams Only" upgrade mode (TeamsUpgradePolicy = UpgradeToTeams) so inbound calls land in the Teams client, and set up an emergency calling location for the number before go-live.$stp$)
  ),
  $eo$Users who genuinely need calling are Enterprise Voice–enabled with a real assigned phone number (LineURI populated), confirmed against a deliberate PSTN connectivity choice — or the customer has explicitly confirmed Teams Phone isn't part of their deployment.$eo$,
  $vs$Query Teams users for Enterprise Voice enablement and a non-empty line URI, and confirm the count matches the customer's stated calling population (zero is only a pass if the customer confirmed no one needs Teams Phone).$vs$,
  $vc$Connect-MicrosoftTeams
Get-CsOnlineUser | Where-Object { $_.EnterpriseVoiceEnabled -eq $true -and $_.LineURI -ne $null } | Select-Object UserPrincipalName, LineURI$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/microsoftteams/setting-up-your-phone-system$url$,
    $url$https://learn.microsoft.com/en-us/microsoftteams/direct-routing-enable-users$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02; Microsoft Teams PowerShell module$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2046) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$This session could not reach a live Teams/Graph tenant to verify Set-CsPhoneNumberAssignment end to end (matches the ps-execution gap monitor_checks.description already flags for this check: the app-only cert needs a Teams administrative role grant before the check itself can run). Do not run this against a tenant that hasn't deliberately budgeted for Teams Phone licensing and PSTN connectivity — unlike the identity: domain's CA policies, provisioning calling for users who don't need it is a real, ongoing cost, not a free security control.$note$
),

(
  'adoption:viva-engage-health',
  $ttl$Establish or revive Viva Engage communities$ttl$,
  $sum$The tenant has zero Viva Engage communities (or none with real activity) — there is no shared space for cross-team, tenant-wide conversation outside of Teams channels and SharePoint sites, which are both scoped to a specific team/project rather than the whole organization. Viva Engage communities are Microsoft's purpose-built surface for company-wide culture/knowledge-sharing content (leadership AMAs, all-hands follow-up discussion, cross-department Q&A); a tenant with the license but zero communities is paying for a capability nobody has switched on.$sum$,
  jsonb_build_array(
    $prq$One of: Microsoft 365 Global Administrator, Viva Engage Network admin, Engage admin, or Verified admin, to open the Viva Engage admin center and/or create the first community$prq$,
    $prq$A Viva Engage license (bundled in most Microsoft 365/Office 365 suites) assigned to the users who should be able to create/join communities$prq$,
    $prq$Community.ReadWrite.All delegated or application permission if creating a community via Microsoft Graph instead of the UI$prq$
  ),
  $apath$Viva Engage admin center (engage.cloud.microsoft/main/admin, via the Settings gear icon → Admin center) to configure the network; Viva Engage web/Teams client → Communities → Create community for the first community itself$apath$,
  $aurl$https://engage.cloud.microsoft/main/admin$aurl$,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Confirm the Viva Engage network itself is set up and licensed (Viva Engage admin center is reachable and shows the tenant's network) before treating zero communities as an adoption gap rather than a setup gap.$stp$),
    jsonb_build_object('text', $stp$Create at least one real, named community with a clear purpose (not a placeholder) via Viva Engage → Communities → Create community, or via Microsoft Graph:$stp$, 'code', $cod$POST https://graph.microsoft.com/beta/employeeExperience/communities
Content-Type: application/json

{
  "displayName": "<Real community name, e.g. Company All-Hands>",
  "description": "<Real, specific purpose>",
  "privacy": "public"
}$cod$, 'codeLanguage', $lng$http$lng$),
    jsonb_build_object('text', $stp$Assign real owners/admins to the new community (not left to whoever happened to create it) and seed it with an initial post so it doesn't read as empty on first visit, then communicate its existence to the intended audience.$stp$)
  ),
  $eo$At least one real, actively-owned Viva Engage community exists with genuine posts, and the tenant's Viva Engage network is confirmed licensed and reachable.$eo$,
  $vs$List communities via Microsoft Graph or the Viva Engage admin center and confirm at least one exists with recent posts, not merely a created-and-abandoned shell.$vs$,
  NULL,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/viva/engage/eac-overview$url$,
    $url$https://learn.microsoft.com/en-us/graph/api/employeeexperience-post-communities?view=graph-rest-beta$url$,
    $url$https://learn.microsoft.com/en-us/microsoft-365/admin/activity-reports/viva-engage-activity-report-ww?view=o365-worldwide$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02; Microsoft Graph beta (employeeExperience/communities)$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2046) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'admin_center_only',
  $note$The create-community write path is documented only under Microsoft Graph BETA as of 2026-09-02, not v1.0 — treat the HTTP snippet as a reference, not a stable production integration point, and prefer the UI path for a customer-facing fix. fix_route_capability is admin_center_only rather than you_must_run because naming/scoping a community meaningfully is a judgment call, not a safe blind script.$note$
),

(
  'adoption:viva-engage-user-activity',
  $ttl$Investigate and raise zero/low per-user Viva Engage activity$ttl$,
  $sum$No user appears in the Viva Engage per-user activity report — nobody has posted, read, or liked a message in the monitored window. This is the per-USER counterpart to adoption:viva-engage-health (which measures community existence/count, a different question): a tenant can have real, well-named communities that simply nobody is visiting, which points specifically at an awareness/habit problem rather than a missing feature.$sum$,
  jsonb_build_array(
    $prq$Reports Reader (or Global Administrator, Usage Summary Reports Reader) to view the Viva Engage Activity report$prq$,
    $prq$Viva Engage license assigned to the users being measured$prq$,
    $prq$Global Administrator only if concealed usernames need to be turned off$prq$
  ),
  $apath$Microsoft 365 admin center → Reports → Usage → Viva Engage → Activity tab$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Confirm the report's normal data lag has passed and that the users being measured are licensed for Viva Engage and in an Activated (not Pending/Suspended) user state — pending users can't post, read, or like, and won't count even once they eventually activate.$stp$),
    jsonb_build_object('text', $stp$Cross-check against adoption:viva-engage-health — if the tenant also has zero real communities, fix that first (there's nowhere for users to be active); if real communities exist but per-user activity is still zero, the gap is genuinely about awareness/habit, not availability.$stp$),
    jsonb_build_object('text', $stp$Where communities exist but sit unused, drive activity directly: have a recognized leader post the first few real updates, link the community from a channel/email people already check, and consider Viva Engage's built-in engagement nudges (e.g. leadership corner, storyline prompts) rather than leaving it to organic discovery.$stp$)
  ),
  $eo$The Viva Engage Activity report shows non-zero Posted/Read/Liked counts and a recent Last activity date (UTC) for licensed, activated users.$eo$,
  $vs$Re-open the Viva Engage Activity report after the awareness push and confirm licensed users now show non-zero posted/read/liked activity.$vs$,
  NULL,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/microsoft-365/admin/activity-reports/activity-reports?view=o365-worldwide$url$,
    $url$https://learn.microsoft.com/en-us/microsoft-365/admin/activity-reports/viva-engage-activity-report-ww?view=o365-worldwide$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2046) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'admin_center_only',
  $note$No validation_command: getYammerActivityUserDetail is a reports read. Always pair with adoption:viva-engage-health before recommending an engagement push — driving traffic toward zero real communities wastes the effort.$note$
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
VALUES ('2026-09-02-remediation-kb-adoption-domain-2046.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;

-- Verify: how many adoption: rows are published after this migration.
SELECT
  count(*) FILTER (WHERE check_key LIKE 'adoption:%') AS adoption_rows,
  count(*) FILTER (WHERE check_key LIKE 'adoption:%' AND status = 'published') AS adoption_published,
  count(*) AS total_rows
FROM remediation_knowledge_base;
