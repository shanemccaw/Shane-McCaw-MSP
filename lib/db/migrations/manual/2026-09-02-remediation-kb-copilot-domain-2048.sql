-- #2048 — Remediation knowledge base: the copilot: domain, authored & published.
--
-- Populates remediation_knowledge_base with verified "this is wrong → here is how
-- to fix it" content for EVERY active copilot: check (8 rows). Before this the table
-- held 81 published rows across identity/devices/governance/security/teams and zero
-- copilot: rows, so every copilot: finding fell through to the AI fallback.
--
-- AUTHORING STANDARD (see #1924, reused verbatim for this domain per #2048):
--   * Every row is verified against real Microsoft Learn / official Microsoft docs
--     that were actually fetched in build session #2048 (2026-09-02). The URLs in
--     source_urls are those pages.
--   * verified_by is an HONEST AGENT attribution — never a human name. The content
--     is agent-authored and awaiting a human spot-check (filed as a Shane To-Do).
--   * Tenant-specific values use angle-bracket placeholders (<GroupObjectId>, …),
--     never a fabricated real value.
--   * fix_route_capability is the finding-side CEILING (#1539): you_must_run when a
--     real customer-runnable fix script is authored in a step's `code`;
--     admin_center_only when the real fix is portal-only or fundamentally a
--     human-judgment triage/tuning workflow rather than a single flip-a-setting
--     script. NEVER we_can_run here — that shape requires a live config pack
--     mapped to the check (#1925's job).
--
-- IMPLEMENTATION NOTE surfaced during authoring (also filed as a Git finding, see
-- #2048's completion comment): several of these 8 live `monitor_checks` definitions
-- are coarser than their labels suggest — copilot:active-usage-rate maps
-- lastActivityDate through a plain "count" transform (counting all rows returned,
-- not genuinely computing an active/total ratio); copilot:usage-by-app maps
-- appActivity via groupByCount against getMicrosoft365CopilotUserCountTrend, whose
-- v1 response shape is a flat per-day adoption object (teamsActiveUsers,
-- wordActiveUsers, etc.), not a groupable "appActivity" field; and
-- copilot:data-exposure-risk's endpoint (/sites/{itemId}/drive/root/permissions)
-- requires a real per-site itemId fan-out that isn't visible in the check's own
-- static endpoint string. The content below documents the REAL Microsoft feature
-- and risk each check key and label name point at — the thing a customer/analyst
-- expects this finding to mean — sourced from genuine Microsoft Learn docs,
-- independent of the current check query's precision. The query/label mismatch
-- itself is a separate engineering gap, out of scope for this content-authoring
-- issue.
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
-- CLUSTER: Licensing & readiness
-- ─────────────────────────────────────────────────────────────────────────────

(
  'copilot:readiness-prerequisite',
  $ttl$Meet Microsoft 365 Copilot's minimum deployment requirements$ttl$,
  $sum$Microsoft 365 Copilot only works for users who meet a fixed set of technical prerequisites — an eligible Microsoft 365/Office 365 subscription plan carrying a Copilot add-on license, a Microsoft Entra ID (Azure AD) account, and a primary mailbox hosted in Exchange Online (Copilot's mailbox grounding — using email, calendar and metadata to draft replies and summaries — is only supported there; on-premises or hybrid mailboxes are not supported for this). A tenant with zero Microsoft 365 Copilot SKUs consumed means no user in the tenant can use Copilot at all yet, regardless of how ready the rest of the environment is — this is the entry gate every other copilot: check assumes has already been cleared.$sum$,
  jsonb_build_array(
    $prq$Global Administrator or License Administrator (Microsoft Entra role) to purchase and assign the add-on license$prq$,
    $prq$A qualifying base subscription — Microsoft 365 Business Basic/Standard/Premium, Microsoft 365 E3/E5/E7, Microsoft 365 F1/F3, Microsoft 365 A3/A5, Office 365 E1/E3/E5/F3, Microsoft Teams Essentials/Enterprise, or the GCC/GCC-High/DoD equivalents$prq$,
    $prq$Users' primary mailbox in Exchange Online (not on-premises/hybrid) and a Microsoft Entra ID account$prq$
  ),
  $apath$Microsoft 365 admin center → Billing → Purchase services (Copilot add-on) → Users → Active users (license assignment); the built-in Microsoft Copilot setup guide walks both steps$apath$,
  $aurl$https://admin.microsoft.com/Adminportal/Home?Q=learndocs#/modernonboarding/microsoft365copilotsetupguide$aurl$,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Confirm the tenant holds a qualifying base subscription (see prerequisites), then purchase the Microsoft 365 Copilot add-on license in the Billing → Purchase services page of the Microsoft 365 admin center.$stp$),
    jsonb_build_object('text', $stp$Assign the purchased Copilot licenses to the intended pilot/rollout users in Users → Active users, or verify current assignment programmatically:$stp$, 'code', $cod$Connect-MgGraph -Scopes 'Organization.Read.All'
Get-MgSubscribedSku | Where-Object { $_.SkuPartNumber -eq 'Microsoft_365_Copilot' } | Select-Object SkuPartNumber, ConsumedUnits, @{n='Enabled';e={$_.PrepaidUnits.Enabled}}$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$For a specific user, use the Copilot License Details diagnostic to verify they meet every requirement (license, mailbox location, Entra account) rather than assuming license assignment alone is sufficient.$stp$)
  ),
  $eo$At least one Microsoft_365_Copilot SKU shows consumedUnits > 0, and every licensed user's primary mailbox is confirmed in Exchange Online with an active Microsoft Entra ID account — Copilot is genuinely usable, not just purchased.$eo$,
  $vs$Re-run the subscribedSkus query and confirm Microsoft_365_Copilot consumedUnits is now greater than zero, then spot-check a licensed user with the Copilot License Details diagnostic.$vs$,
  $vc$Get-MgSubscribedSku | Where-Object { $_.SkuPartNumber -eq 'Microsoft_365_Copilot' } | Select-Object SkuPartNumber, ConsumedUnits$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/copilot/microsoft-365/microsoft-365-copilot-minimum-requirements$url$,
    $url$https://learn.microsoft.com/en-us/microsoft-365/copilot/microsoft-365-copilot-licensing$url$,
    $url$https://learn.microsoft.com/en-us/microsoft-365/copilot/microsoft-365-copilot-setup$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02; Microsoft Graph PowerShell SDK (Microsoft.Graph.Identity.DirectoryManagement)$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2048) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'admin_center_only',
  $note$This check's own live definition (/subscribedSkus, countEquals('Microsoft_365_Copilot') on skuPartNumber) is a real, precise query matching this content — the info-severity rule fires when copilotSkuCount == 0, i.e. no Copilot SKU purchased at all.$note$
),

(
  'copilot:license-vs-total-users',
  $ttl$Right-size Microsoft 365 Copilot license count against total tenant users$ttl$,
  $sum$Copilot is sold as a per-user add-on license, so the gap between total tenant headcount and consumed Copilot licenses (consumedUnits on the Microsoft_365_Copilot SKU) is a direct measure of rollout coverage — a small consumedUnits relative to total users usually means Copilot was purchased for a pilot group and never expanded, or that budget/approval stalled mid-rollout. Tracking this ratio over time is what turns "we bought some Copilot licenses" into a deliberate, measured adoption program rather than a stalled pilot nobody revisits.$sum$,
  jsonb_build_array(
    $prq$License Administrator, User Administrator, or Global Administrator to view/assign licenses; Global Reader or Reports Reader for read-only reporting$prq$,
    $prq$Microsoft Graph PowerShell SDK (Microsoft.Graph.Identity.DirectoryManagement) if automating, scope Organization.Read.All$prq$
  ),
  $apath$Microsoft 365 admin center → Billing → Licenses (per-SKU consumed/available count) and Users → Active users for total tenant headcount$apath$,
  $aurl$https://admin.microsoft.com/Adminportal/Home#/licenses$aurl$,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Pull the current Copilot consumedUnits and compare against total active licensed users to compute real coverage:$stp$, 'code', $cod$Connect-MgGraph -Scopes 'Organization.Read.All','User.Read.All'
$copilotSku = Get-MgSubscribedSku | Where-Object { $_.SkuPartNumber -eq 'Microsoft_365_Copilot' }
$totalUsers = (Get-MgUser -All -Filter "accountEnabled eq true").Count
[PSCustomObject]@{ CopilotLicenses = $copilotSku.ConsumedUnits; TotalActiveUsers = $totalUsers; CoveragePercent = [math]::Round(100 * $copilotSku.ConsumedUnits / $totalUsers, 1) }$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$If coverage is intentionally a pilot, document the target rollout population and timeline; if it's an unintentional stall, purchase and assign additional licenses to the next rollout wave in Billing → Licenses / Users → Active users.$stp$),
    jsonb_build_object('text', $stp$Re-check the license-vs-total-users ratio on a recurring cadence (monthly is typical) so a stalled rollout is caught early rather than discovered a year later.$stp$)
  ),
  $eo$The Copilot license count reflects a deliberate, currently-accurate rollout target — either full coverage, or a documented pilot/phased-rollout population — not an accidental plateau nobody has revisited since initial purchase.$eo$,
  $vs$Re-run the coverage calculation after the next licensing decision and confirm the ratio moved in the direction the rollout plan intended.$vs$,
  $vc$Get-MgSubscribedSku | Where-Object { $_.SkuPartNumber -eq 'Microsoft_365_Copilot' } | Select-Object SkuPartNumber, ConsumedUnits, @{n='Enabled';e={$_.PrepaidUnits.Enabled}}$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/graph/api/subscribedsku-list?view=graph-rest-1.0$url$,
    $url$https://learn.microsoft.com/en-us/microsoft-365/copilot/microsoft-365-copilot-licensing$url$,
    $url$https://learn.microsoft.com/en-us/microsoft-365/admin/manage/assign-licenses-to-users$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02; Microsoft Graph PowerShell SDK (Microsoft.Graph.Identity.DirectoryManagement)$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2048) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'admin_center_only',
  $note$This check's own live definition maps only consumedUnits (transform "first") with no severity_rules and no total-user comparison field — it currently surfaces the raw license count, not a genuine ratio. Content above documents the real coverage-ratio concept the check's key name implies; computing the actual ratio requires pairing this endpoint's output with a total-user count, which the check does not yet do.$note$
),

-- ─────────────────────────────────────────────────────────────────────────────
-- CLUSTER: Usage & adoption
-- ─────────────────────────────────────────────────────────────────────────────

(
  'copilot:active-usage-rate',
  $ttl$Raise a low Copilot active-usage rate among licensed users$ttl$,
  $sum$The Microsoft 365 Copilot usage report tracks, per licensed user, the last date they used Copilot in any app (Teams, Word, Excel, PowerPoint, Outlook, OneNote, Loop, or Copilot Chat) over a rolling window. A low active-usage rate — licenses assigned but lastActivityDate rarely populated within the reporting window — means the organization is paying for adoption that isn't happening, and it is the single clearest signal that a rollout needs enablement (training, champions, use-case communication) rather than more licenses. Microsoft's own usage reports are explicitly the mechanism for catching this before a renewal decision, not after.$sum$,
  jsonb_build_array(
    $prq$Reports Reader, Global Reader, or one of Company Administrator/AI Administrator/Exchange Administrator/SharePoint Administrator/Teams Administrator (limited admin roles authorized to read usage reports) — Microsoft Entra role$prq$,
    $prq$Microsoft Graph PowerShell SDK (Microsoft.Graph.Beta.Reports) or Reports.Read.All delegated/application permission if automating$prq$
  ),
  $apath$Microsoft 365 admin center → Reports → Usage → Microsoft 365 Copilot (per-user last-activity table, filterable by app and date range)$apath$,
  $aurl$https://admin.microsoft.com/Adminportal/Home#/reportsUsage/M365CopilotUsage$aurl$,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Pull the 7-day usage detail report for all Copilot-licensed users and compute the share with a non-blank Last Activity Date — that ratio is the real active-usage rate, not raw license count:$stp$, 'code', $cod$Connect-MgGraph -Scopes 'Reports.Read.All'
Get-MgBetaReportMicrosoft365CopilotUsageUserDetail -Period 'D7' | Select-Object UserPrincipalName, LastActivityDate$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$For users showing no activity, review which specific app they were expected to use Copilot in (Teams meeting recaps, Word drafting, Outlook summarization) and target enablement content to that exact scenario rather than generic "use Copilot" messaging.$stp$),
    jsonb_build_object('text', $stp$Re-pull the same report on a recurring cadence (weekly/monthly) and track the trend, not a single snapshot — a rate that's flat or falling after enablement effort is the signal to revisit the rollout approach itself.$stp$)
  ),
  $eo$A materially higher share of Copilot-licensed users show a recent, non-blank Last Activity Date across at least one app in the reporting window, trending upward release over release rather than flat or declining.$eo$,
  $vs$Re-run the D7/D30 usage detail report after an enablement push and confirm the active-user share has genuinely risen, not just that a few power users used it more.$vs$,
  $vc$Get-MgBetaReportMicrosoft365CopilotUsageUserDetail -Period 'D7' | Where-Object { $_.LastActivityDate } | Measure-Object | Select-Object Count$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/api/admin-settings/reports/copilotreportroot-getmicrosoft365copilotusageuserdetail$url$,
    $url$https://learn.microsoft.com/en-us/microsoft-365/admin/activity-reports/microsoft-365-copilot-usage$url$,
    $url$https://learn.microsoft.com/en-us/graph/reportroot-authorization$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02; Microsoft Graph Beta Reports API$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2048) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'admin_center_only',
  $note$Real implementation gap (see this migration's header and #2048's completion comment): the live check maps lastActivityDate through a plain "count" transform against getMicrosoft365CopilotUsageUserDetail(period='D7') with empty severity_rules — it currently counts rows returned (which this API caps to licensed users only per Microsoft's own docs) rather than computing an active/licensed ratio, and never fires a finding. Content above documents the real active-usage-rate concept the check's key name points at.$note$
),

(
  'copilot:usage-activity',
  $ttl$Review 30-day Copilot usage activity across every app$ttl$,
  $sum$Beyond a single active/inactive flag, the 30-day usage detail report breaks last-activity down per app (Teams, Word, Excel, PowerPoint, Outlook, OneNote, Loop, Copilot Chat), which is what actually shows how Copilot is being used, not just whether it is. A tenant where usage concentrates entirely in Copilot Chat but shows nothing in Word/Excel/PowerPoint, for example, means the document-authoring scenarios Copilot is often purchased for aren't landing — a very different problem (and a different fix) than "nobody uses Copilot at all." Reviewing this monthly is what turns usage data into an actual enablement roadmap instead of a single adoption percentage.$sum$,
  jsonb_build_array(
    $prq$Reports Reader, Global Reader, or one of Company Administrator/AI Administrator/Exchange Administrator/SharePoint Administrator/Teams Administrator — Microsoft Entra role$prq$,
    $prq$Microsoft Graph PowerShell SDK (Microsoft.Graph.Beta.Reports) or Reports.Read.All if automating; use report version v2 for per-app prompt counts in addition to per-app last-activity dates$prq$
  ),
  $apath$Microsoft 365 admin center → Reports → Usage → Microsoft 365 Copilot, per-user detail table with per-app Last Activity Date columns$apath$,
  $aurl$https://admin.microsoft.com/Adminportal/Home#/reportsUsage/M365CopilotUsage$aurl$,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Pull the 30-day usage detail report and review the per-app Last Activity Date columns (Teams, Word, Excel, PowerPoint, Outlook, OneNote, Loop, Copilot Chat) side by side, not just the single overall Last Activity Date:$stp$, 'code', $cod$Connect-MgGraph -Scopes 'Reports.Read.All'
Get-MgBetaReportMicrosoft365CopilotUsageUserDetail -Period 'D30' | Select-Object UserPrincipalName, LastActivityDate, CopilotChatLastActivityDate, MicrosoftTeamsCopilotLastActivityDate, WordCopilotLastActivityDate, ExcelCopilotLastActivityDate, PowerPointCopilotLastActivityDate, OutlookCopilotLastActivityDate$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Identify the apps with the weakest adoption relative to how the organization actually intended to use Copilot, and target scenario-specific enablement (e.g. Outlook email summarization, Excel formula assistance) at those specific gaps rather than generic messaging.$stp$)
  ),
  $eo$Usage activity is reviewed at the per-app level monthly, and the resulting gaps (an app with strong licensing but weak activity) drive specific, targeted enablement content rather than being invisible inside a single blended adoption number.$eo$,
  $vs$Re-pull the 30-day per-app detail report after targeted enablement and confirm the specific previously-weak app now shows a rising share of non-blank Last Activity Date values.$vs$,
  NULL,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/api/admin-settings/reports/copilotreportroot-getmicrosoft365copilotusageuserdetail$url$,
    $url$https://learn.microsoft.com/en-us/microsoft-365/admin/activity-reports/microsoft-365-copilot-usage$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02; Microsoft Graph Beta Reports API$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2048) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'admin_center_only',
  $note$This check's own live definition maps the full report row set through a "raw" transform (sourceField "value", targetField copilotUsageData) with no severity_rules — it is a data-passthrough surface for the UI to render, not itself a binary finding, so no validation_command is authored (there is no single pass/fail state to re-check).$note$
),

(
  'copilot:usage-by-app',
  $ttl$Understand which Microsoft 365 apps are driving (or lagging in) Copilot adoption$ttl$,
  $sum$The Copilot user-count-trend report tracks daily enabled-vs-active user counts per app (Teams, Word, Excel, PowerPoint, Outlook, OneNote, Loop, Copilot Chat), which is the tenant-wide counterpart to the per-user usage detail report — it answers "which app is actually driving adoption across the whole population" rather than "is this one user active." A large gap between an app's enabled-user count and its active-user count for the same app is a concrete, app-specific enablement target: those users already have access, they simply aren't using it in that surface.$sum$,
  jsonb_build_array(
    $prq$Reports Reader, Global Reader, Usage Summary Reports Reader, or one of Company Administrator/AI Administrator/Exchange Administrator/SharePoint Administrator/Teams Administrator — Microsoft Entra role$prq$,
    $prq$Microsoft Graph PowerShell SDK (Microsoft.Graph.Beta.Reports) or Reports.Read.All if automating$prq$
  ),
  $apath$Microsoft 365 admin center → Reports → Usage → Microsoft 365 Copilot (app-level adoption trend chart)$apath$,
  $aurl$https://admin.microsoft.com/Adminportal/Home#/reportsUsage/M365CopilotUsage$aurl$,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Pull the 7-day (or 28-day on v2) user-count trend and compare each app's enabled-vs-active counts to find the largest adoption gaps:$stp$, 'code', $cod$Connect-MgGraph -Scopes 'Reports.Read.All'
Get-MgBetaReportMicrosoft365CopilotUserCountTrend -Period 'D7' | Select-Object -ExpandProperty AdoptionByDate | Select-Object ReportDate, WordEnabledUsers, WordActiveUsers, ExcelEnabledUsers, ExcelActiveUsers, OutlookEnabledUsers, OutlookActiveUsers, MicrosoftTeamsEnabledUsers, MicrosoftTeamsActiveUsers, CopilotChatEnabledUsers, CopilotChatActiveUsers$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$For the app(s) with the widest enabled-minus-active gap, run scenario-specific enablement (e.g. a Word "start from a Copilot draft" walkthrough, an Outlook "summarize this thread" demo) rather than a single blanket "use Copilot" campaign.$stp$)
  ),
  $eo$The enabled-vs-active gap has meaningfully narrowed for the apps that were previously the weakest, and the trend is reviewed regularly enough (e.g. monthly) to catch a new lagging app before it becomes a stale year-old gap.$eo$,
  $vs$Re-pull the user-count trend after enablement and confirm the previously-lagging app's active-user count has risen relative to its enabled-user count.$vs$,
  $vc$Get-MgBetaReportMicrosoft365CopilotUserCountTrend -Period 'D7' | Select-Object -ExpandProperty AdoptionByDate$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/api/admin-settings/reports/copilotreportroot-getmicrosoft365copilotusercounttrend$url$,
    $url$https://learn.microsoft.com/en-us/microsoft-365/admin/activity-reports/microsoft-365-copilot-usage$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02; Microsoft Graph Beta Reports API$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2048) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'admin_center_only',
  $note$Real implementation gap (see this migration's header and #2048's completion comment): the live check maps "appActivity" via a groupByCount transform against getMicrosoft365CopilotUserCountTrend(period='D7'), but that API's real v1 response is a flat per-day adoption object (wordActiveUsers, excelActiveUsers, etc., see the reference doc's example response) with no "appActivity" field to group by — the mapping doesn't match the endpoint's real shape. Content above documents the real per-app enabled-vs-active concept this check's key name points at.$note$
),

(
  'copilot:licensed-but-inactive',
  $ttl$Reclaim or re-engage Microsoft 365 Copilot licenses assigned but never used$ttl$,
  $sum$A user whose Copilot usage report row shows no Last Activity Date at all across the full 30-day window has an assigned license generating zero value — not "low usage," genuinely never-activated. At scale this is a direct, quantifiable cost: every never-active license is either a wasted seat that should be reassigned to someone on a waitlist, or a signal that the assigned user never received onboarding/enablement and the rollout process itself has a gap. Microsoft's own guidance treats a growing never-active population as the clearest trigger to intervene before a renewal cycle locks in wasted spend.$sum$,
  jsonb_build_array(
    $prq$Reports Reader or Global Reader to identify never-active users; License Administrator or User Administrator to reassign licenses$prq$,
    $prq$Microsoft Graph PowerShell SDK (Microsoft.Graph.Beta.Reports and Microsoft.Graph.Users) if automating$prq$
  ),
  $apath$Microsoft 365 admin center → Reports → Usage → Microsoft 365 Copilot, sorted/filtered to blank Last Activity Date; Users → Active users to reassign licenses$apath$,
  $aurl$https://admin.microsoft.com/Adminportal/Home#/reportsUsage/M365CopilotUsage$aurl$,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Pull the 30-day usage detail report and isolate users with a fully blank Last Activity Date — these are the genuinely never-active licenses, distinct from users who are merely infrequent:$stp$, 'code', $cod$Connect-MgGraph -Scopes 'Reports.Read.All'
Get-MgBetaReportMicrosoft365CopilotUsageUserDetail -Period 'D30' | Where-Object { -not $_.LastActivityDate } | Select-Object UserPrincipalName, DisplayName$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$For each never-active user, decide deliberately: re-engage with targeted onboarding (if they're still a good candidate) or unassign the license and return it to the available pool for reassignment:$stp$, 'code', $cod$Set-MgUserLicense -UserId <UserPrincipalName> -RemoveLicenses @('<Microsoft_365_Copilot_SkuId>') -AddLicenses @()$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Re-run the never-active query on a recurring cadence (the check's own current threshold flags this once the count exceeds 20 users) so licenses don't sit unused for months before anyone notices.$stp$)
  ),
  $eo$Every previously never-active licensed user has either shown genuine first activity after re-engagement, or had their license reclaimed and reassigned — no license sits fully unused past a deliberate grace period.$eo$,
  $vs$Re-run the 30-day never-active query and confirm the count of users with a fully blank Last Activity Date has genuinely dropped through real re-engagement or reclamation, not merely a shorter reporting window.$vs$,
  $vc$Get-MgBetaReportMicrosoft365CopilotUsageUserDetail -Period 'D30' | Where-Object { -not $_.LastActivityDate } | Measure-Object | Select-Object Count$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/api/admin-settings/reports/copilotreportroot-getmicrosoft365copilotusageuserdetail$url$,
    $url$https://learn.microsoft.com/en-us/microsoft-365/admin/manage/assign-licenses-to-users$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02; Microsoft Graph Beta Reports API, Microsoft Graph PowerShell SDK (Microsoft.Graph.Users.Actions)$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2048) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$This check's own live definition (countFalse on "value" against getMicrosoft365CopilotUsageUserDetail(period='D30'), targetField neverActiveCount, severity_rules firing medium when neverActiveCount > 20) is a real, reasonably precise query matching this content, though "countFalse" on the raw "value" field is an unusual transform choice worth a follow-on look — noted, not blocking, since the resulting neverActiveCount concept is sound.$note$
),

-- ─────────────────────────────────────────────────────────────────────────────
-- CLUSTER: Data protection & governance for Copilot
-- ─────────────────────────────────────────────────────────────────────────────

(
  'copilot:data-exposure-risk',
  $ttl$Close SharePoint oversharing gaps before Copilot surfaces them$ttl$,
  $sum$Microsoft 365 Copilot retrieves content that the asking user already has permission to access, respecting existing SharePoint/OneDrive permissions exactly as they stand — which means Copilot doesn't create new oversharing risk, it makes existing oversharing risk visible and easy to find for the first time. A site shared with "Anyone" (anonymous, no sign-in required), "Everyone" (includes external guests), or "Everyone except external users" (every internal user, standing access) is content Copilot can now surface in a natural-language answer to whoever can already reach it — content that was previously safe mainly because nobody thought to go looking for it manually. This is precisely the "oversharing" risk Microsoft's own Copilot readiness guidance treats as the first thing to fix before or immediately after rollout.$sum$,
  jsonb_build_array(
    $prq$SharePoint Administrator to configure sharing settings, Restricted Access Control, and Restricted Content Discovery; Global Reader or Security Reader for read-only review of data access governance reports$prq$,
    $prq$SharePoint Advanced Management (included with Microsoft 365 Copilot licenses) for Content Management Assessment, data access governance reports, and Restricted Access Control$prq$,
    $prq$SharePoint Online Management Shell if automating remediation$prq$
  ),
  $apath$SharePoint admin center → Advanced Management → Content Management Assessment (guided oversharing scan); Reports → Data access governance (site permissions baseline, EEEU, sharing links activity reports); Policies → Access control (Restricted Access Control)$apath$,
  $aurl$https://admin.microsoft.com/sharepoint$aurl$,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Run the Content Management Assessment (SharePoint admin center → Advanced Management → Start assessment) to get a guided list of overshared, ownerless, and inactive sites, then review the Data access governance → site permissions baseline and Everyone-except-external-users (EEEU) reports for the specific sites carrying the broadest access.$stp$),
    jsonb_build_object('text', $stp$For each flagged high-risk site, initiate a SharePoint Advanced Management site access review so the site owner removes excess users/groups and company-wide sharing links (including EEEU), and rescopes sharing links to approved users or groups.$stp$),
    jsonb_build_object('text', $stp$For sensitive sites that must remain accessible to their current audience but shouldn't be broadly discoverable by Copilot or org-wide search while remediation is in progress, apply Restricted Content Discovery as an interim control, or Restricted Access Control to scope real access down to a named security group:$stp$, 'code', $cod$Set-SPOTenant -EnableRestrictedAccessControl $true
Set-SPOSite -Identity <siteUrl> -RestrictedAccessControl $true
Set-SPOSite -Identity <siteUrl> -AddRestrictedAccessControlGroups <GroupObjectId>$cod$, 'codeLanguage', $lng$powershell$lng$)
  ),
  $eo$No SharePoint site Copilot can reach carries an anonymous "Anyone" link, an "Everyone"/EEEU grant, or an unreviewed organization-wide sharing link on genuinely sensitive content — the site permissions baseline and EEEU reports no longer flag the previously high-risk sites, and Copilot answers reflect the actual intended access boundary, not an accidental one.$eo$,
  $vs$Re-run the Content Management Assessment and the site permissions baseline / EEEU data access governance reports and confirm the previously-flagged sites no longer appear, or generate a Restricted Access Control insights report to confirm the policy is active where applied.$vs$,
  $vc$Get-SPOSite -Identity <siteUrl> | Select-Object RestrictedAccessControl, RestrictedAccessControlGroups$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/microsoft-365/copilot/configure-secure-governed-data-foundation-microsoft-365-copilot$url$,
    $url$https://learn.microsoft.com/en-us/microsoft-365/copilot/get-ready-copilot-sharepoint-advanced-management$url$,
    $url$https://learn.microsoft.com/en-us/sharepoint/restricted-access-control$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02; SharePoint Online Management Shell$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2048) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$Real implementation gap (see this migration's header and #2048's completion comment): the live check's endpoint (/sites/{itemId}/drive/root/permissions) is written against a single static site rather than the real per-site fan-out this check needs (fan_out_source/fan_out_item_id_field are unset), so as defined it can only ever evaluate one site, not a tenant-wide oversharing sweep. The severity_rules (anonymous/Everyone/EEEU/org-link thresholds) are well-formed and match this content's real risk model — the gap is the missing fan-out wiring, not the finding logic. Content above documents the real oversharing-remediation workflow (Content Management Assessment, data access governance reports, Restricted Access Control) this check's key and label point at.$note$
),

(
  'copilot:sensitivity-labels-exist',
  $ttl$Configure sensitivity labels so Copilot can respect data classification$ttl$,
  $sum$Sensitivity labels are Microsoft Purview's mechanism for classifying and protecting content — and Microsoft 365 Copilot and Copilot agents specifically recognize and use them: when a labeled item applies encryption with defined permissions, Copilot only returns content from that item if the user holds the EXTRACT usage right, and Copilot Chat surfaces the most restrictive applicable label on any response that draws from multiple labeled sources. A tenant with zero sensitivity labels configured has none of this extra protection layer in place — Copilot still respects raw SharePoint/OneDrive permissions, but it has no classification signal at all to add a second layer of judgment on top of "does this user technically have access."$sum$,
  jsonb_build_array(
    $prq$Compliance Administrator, Compliance Data Administrator, or Information Protection Admin (Microsoft Purview RBAC) to create and publish labels$prq$,
    $prq$Microsoft Purview Information Protection — foundational sensitivity labeling is included in Microsoft 365 E3/Office 365 E3 and higher (encryption-based labels typically require E5/Purview add-on for the most advanced scenarios)$prq$,
    $prq$Security & Compliance PowerShell (ExchangePowerShell module) if scripting label/policy creation$prq$
  ),
  $apath$Microsoft Purview portal → Information Protection → Labels (create/manage labels) and Label policies (publish labels to users/groups)$apath$,
  $aurl$https://purview.microsoft.com/informationprotection/labels$aurl$,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Create an initial label taxonomy matching the organization's real data-sensitivity tiers (a small set — Microsoft's own guidance notes effectiveness drops noticeably past roughly five main labels — e.g. Public, General, Confidential, Highly Confidential):$stp$, 'code', $cod$Connect-IPPSSession
New-Label -Name "Confidential" -DisplayName "Confidential" -Tooltip "Business-sensitive content for internal use"
New-Label -Name "HighlyConfidential" -DisplayName "Highly Confidential" -Tooltip "Restricted content — named recipients only"$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Publish the labels to users via a label policy so they actually appear in Office apps, SharePoint, and Copilot's classification surface, and set a default label to establish a baseline rather than leaving new content unlabeled:$stp$, 'code', $cod$New-LabelPolicy -Name "OrgWideLabels" -Labels "Confidential","HighlyConfidential" -ExchangeLocation All$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Once foundational labels are published, extend labeling to containers (Teams, Microsoft 365 Groups, SharePoint sites) so site-level sensitivity — not just individual file sensitivity — feeds into Copilot's classification signal, and consider auto-labeling policies for the highest-value sensitive-data patterns.$stp$)
  ),
  $eo$At least one sensitivity label taxonomy is created, published to users via an active label policy, and beginning to appear on content — Copilot and Copilot Chat responses now carry the classification signal from real applied labels rather than having none to reference.$eo$,
  $vs$Re-query the sensitivity labels endpoint and confirm labelCount is now greater than zero, then spot-check that a labeled document's label is visible in the Office ribbon/ status bar for a published user.$vs$,
  $vc$Connect-IPPSSession
Get-Label | Select-Object Name, DisplayName, Priority$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/purview/sensitivity-labels$url$,
    $url$https://learn.microsoft.com/en-us/purview/get-started-with-sensitivity-labels$url$,
    $url$https://learn.microsoft.com/en-us/powershell/module/exchangepowershell/new-label?view=exchange-ps$url$,
    $url$https://learn.microsoft.com/en-us/powershell/module/exchangepowershell/new-labelpolicy?view=exchange-ps$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02; Security & Compliance PowerShell (ExchangePowerShell)$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2048) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$This check's own live definition (/security/dataSecurityAndGovernance/sensitivityLabels, count transform to labelCount, warning when labelCount == 0) is a real, precise query matching this content directly — this is the one check in this domain with no query/label mismatch.$note$
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
VALUES ('2026-09-02-remediation-kb-copilot-domain-2048.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;

-- Verify: how many copilot: rows are published after this migration.
SELECT
  count(*) FILTER (WHERE check_key LIKE 'copilot:%') AS copilot_rows,
  count(*) FILTER (WHERE check_key LIKE 'copilot:%' AND status = 'published') AS copilot_published,
  count(*) AS total_rows
FROM remediation_knowledge_base;
