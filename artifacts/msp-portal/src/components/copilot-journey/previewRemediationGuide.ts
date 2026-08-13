/**
 * previewRemediationGuide.ts — document 8 of 9, the Full Remediation Guide.
 *
 * This one is not a report. It is a runbook the customer works through:
 * twenty-eight steps in dependency order, every one of them carrying the exact
 * PowerShell to run, what to watch for, and how to confirm the step actually
 * worked. The viewer lets them tick each one off.
 *
 * Steps 24 and 25 (workflow-per-department, persona training) were removed in
 * #757: they are adoption/deployment rollout guidance that belongs to
 * White-Glove Copilot Adoption (#350/#668), not this remediation runbook. The
 * remaining step ids are deliberately NOT renumbered — s26–s30 keep their own
 * numbers, leaving a gap where 24/25 were, so the tracker's stored ids, the
 * pillar-based phase/pricing logic and every "Step N" cross-reference in the
 * prose all stay valid untouched.
 *
 * WHY THE SCRIPTS ARE DATA AND NOT MARKUP
 * ---------------------------------------
 * Every `code.script` below is transcribed byte-for-byte from
 * `Design/Document Viewer.dc.html` and is meant to be copied into a real shell
 * against a real tenant. That makes it the one kind of string in this journey
 * where a well-meaning reflow — re-wrapping a line, smartening a quote,
 * collapsing a blank line — is a defect rather than a tidy-up. It lives in a
 * `.ts` as opaque data, is rendered inside `<pre>` with `white-space: pre`, and
 * must never be hand-edited. If a command is wrong, fix it in the design and
 * re-extract.
 *
 * The same reasoning as `previewDocumentBodies.ts` applies to everything else
 * here: seat counts, site counts and durations are the design's worked example
 * for the stand-in tenant, reachable only behind `?preview=design`.
 *
 * NOTHING HERE RUNS ANYTHING. The guide is read-only in both senses — the
 * platform holds no write consent for these operations on a customer tenant
 * (see the Graph write-app split), and the viewer offers copy, never execute.
 */

import type { PillarKey } from "./journeyTokens.ts";

/** One console command block, shown with its own copy affordance. */
export interface RemediationCode {
  /** "PowerShell · SharePoint Online" — the header strip above the block. */
  readonly language: string;
  /** Verbatim. Rendered in a `<pre>`; newlines and spacing are load-bearing. */
  readonly script: string;
}

/** The design's "Blast radius" card: what happens if this step goes right, wrong, or is done the slow safe way instead. */
export interface RemediationBlastRadius {
  readonly goesRight: string;
  readonly goesWrong: string;
  readonly tradeOff: string;
}

export interface RemediationStep {
  /** "s1" … "s30" — the design's own ids, and the key progress is stored under. */
  readonly id: string;
  /** "Step 1". Kept as copy rather than derived, so a reordering cannot silently renumber. */
  readonly label: string;
  /** Which pillar's remediation section this step sits in. */
  readonly pillar: PillarKey;
  /** "SharePoint Admin · 15 min" — the role needed and how long it takes. */
  readonly meta: string;
  readonly title: string;
  /** Where in the admin centres to do it, when there is a console path. */
  readonly where?: string;
  readonly code?: RemediationCode;
  /** The amber note. Present only where doing this carelessly causes real damage. */
  readonly caution?: string;
  /** The green note: how to prove it worked. */
  readonly verify?: string;
  /** #731 (Phase B): the design's real per-step risk guidance. Every step has one. */
  readonly blastRadius: RemediationBlastRadius;
}


export const REMEDIATION_STEPS: readonly RemediationStep[] = [
  {
    id: "s1",
    label: "Step 1",
    pillar: "governance",
    meta: "SharePoint Admin · 15 min",
    title: "Close org-wide sharing on the four sensitive sites",
    where: "SharePoint admin center → Sites → Active sites → [site] → Sharing",
    code: { language: "PowerShell · SharePoint Online", script: "$sites = @(\n  \"https://haldenmaterials.sharepoint.com/sites/CompRev2026\",\n  \"https://haldenmaterials.sharepoint.com/sites/RedundancyPlanning\",\n  \"https://haldenmaterials.sharepoint.com/sites/BoardPackQ2\",\n  \"https://haldenmaterials.sharepoint.com/sites/PayrollRecon\"\n)\n\nforeach ($s in $sites) {\n    Set-SPOSite -Identity $s -SharingCapability Disabled\n    Write-Host \"Closed: $s\" -ForegroundColor Green\n}" },
    verify: "Get-SPOSite -Identity $s | Select Url,SharingCapability returns Disabled for all four.",
    blastRadius: { goesRight: "Four sensitive sites stop being readable by 1,240 people. The single largest exposure in the assessment closes in fifteen minutes.", goesWrong: "Close the wrong site and a live project loses access mid-week. Set them to \"Only people in your organisation\" instead of \"Specific people\" and they stay exposed to everyone internally — which is the actual finding.", tradeOff: "Four teams need re-granting individually. Accept a day of access requests to close a tenant-wide exposure." },
  },
  {
    id: "s2",
    label: "Step 2",
    pillar: "governance",
    meta: "SharePoint Admin · 30 min",
    title: "Export the remaining 208 org-wide sites and route them to owners",
    where: "PowerShell only — the admin center cannot export this view",
    code: { language: "PowerShell · SharePoint Online", script: "Get-SPOSite -Limit All -IncludePersonalSite:$false |\n    Where-Object { $_.SharingCapability -ne \"Disabled\" } |\n    Select-Object Url, Owner, SharingCapability, LastContentModifiedDate |\n    Sort-Object LastContentModifiedDate |\n    Export-Csv .\\orgwide-sites.csv -NoTypeInformation" },
    caution: "Do not bulk-close these. 208 sites closed without warning generates 208 access tickets in one morning. Send the CSV to owners with a 10-working-day attestation deadline, then close whatever comes back unclaimed.",
    verify: "The CSV holds 208 rows once the four from Step 1 are excluded.",
    blastRadius: { goesRight: "You get a real inventory and owners make informed decisions about their own content.", goesWrong: "Bulk-closing all 208 generates 208 access tickets in one morning and turns the whole programme into the thing that broke SharePoint.", tradeOff: "Three weeks of attestation instead of one afternoon of scripting. Slower, and the only version that survives contact with users." },
  },
  {
    id: "s3",
    label: "Step 3",
    pillar: "governance",
    meta: "SharePoint Admin · 5 min",
    title: "Expire all future anonymous links",
    where: "SharePoint admin center → Policies → Sharing → Choose expiration",
    code: { language: "PowerShell · SharePoint Online", script: "Set-SPOTenant -RequireAnonymousLinksExpireInDays 30 -DefaultSharingLinkType Internal\nSet-SPOTenant -FileAnonymousLinkType View -FolderAnonymousLinkType View" },
    caution: "This governs links created from now on. The 2,940 existing links keep working until Step 4 revokes them.",
    verify: "Get-SPOTenant | Select RequireAnonymousLinksExpireInDays returns 30.",
    blastRadius: { goesRight: "Every link created from today expires in 30 days. Exposure stops growing while you work through the backlog.", goesWrong: "Nothing breaks. This is the safest task in the guide.", tradeOff: "Genuinely long-lived supplier links now need re-issuing every 30 days. Real friction, small." },
  },
  {
    id: "s4",
    label: "Step 4",
    pillar: "governance",
    meta: "SharePoint Admin · 45 min",
    title: "Revoke the 2,940 existing anonymous links",
    where: "PowerShell only",
    code: { language: "PowerShell · PnP.PowerShell", script: "foreach ($site in (Get-SPOSite -Limit All).Url) {\n    Connect-PnPOnline -Url $site -Interactive\n    Get-PnPFileSharingLink -Identity * -ErrorAction SilentlyContinue |\n        Where-Object { $_.Scope -eq \"Anonymous\" } |\n        ForEach-Object { Remove-PnPFileSharingLink -Identity $_.Id -Force }\n}" },
    caution: "Pilot this on one site first. Anonymous links are often embedded in supplier email threads — revoking all 2,940 is correct, but Communications should know the day it happens.",
    verify: "Re-run the loop with the Remove line commented out. It should return nothing.",
    blastRadius: { goesRight: "2,940 live links stop working, including the one from 2021 nobody remembers creating.", goesWrong: "Supplier and client links embedded in old email threads die without warning. Expect inbound calls the same day.", tradeOff: "Pilot on one site first and warn Communications. Unannounced, this is the task most likely to reach your CEO." },
  },
  {
    id: "s5",
    label: "Step 5",
    pillar: "governance",
    meta: "Entra ID · 20 min",
    title: "Put a 12-month lifecycle policy on Groups, Teams and SharePoint",
    where: "Entra admin center → Groups → Expiration",
    code: { language: "PowerShell · Microsoft Graph", script: "New-MgGroupLifecyclePolicy -GroupLifetimeInDays 365 -ManagedGroupTypes All\n    -AlternateNotificationEmails \"m365-governance@haldenmaterials.com\"" },
    verify: "Owners of the 148 inactive sites receive a renewal notice within 24 hours.",
    blastRadius: { goesRight: "Dormant containers get an owner or get disposed of. 148 stale sites stop appearing in Copilot answers as current content.", goesWrong: "Auto-deleting on inactivity destroys archived project records someone still needs. Renewal notices to unmonitored mailboxes silently expire real content.", tradeOff: "Owners get renewal emails they will ignore at first. Chase, do not automate the deletion." },
  },
  {
    id: "s6",
    label: "Step 6",
    pillar: "governance",
    meta: "Entra ID · 25 min",
    title: "Put Teams creation behind a request",
    where: "Entra admin center → Groups → General → Users can create M365 groups",
    code: { language: "PowerShell · Microsoft Graph", script: "$tpl = Get-MgBetaDirectorySettingTemplate |\n    Where-Object { $_.DisplayName -eq \"Group.Unified\" }\n\n$setting = @{ templateId = $tpl.Id; values = @(\n    @{ name = \"EnableGroupCreation\";        value = \"false\" },\n    @{ name = \"GroupCreationAllowedGroupId\"; value = \"<sg-team-requesters-id>\" }\n) }\n\nNew-MgBetaDirectorySetting -BodyParameter $setting" },
    caution: "Create and populate the requesters group before running this, or you lock out legitimate team creation on a Friday afternoon.",
    verify: "A user outside the group sees \"Contact your admin\" when creating a team.",
    blastRadius: { goesRight: "Sprawl stops at the source. Every new team arrives with a stated purpose and a named owner.", goesWrong: "Skip creating the requesters group first and legitimate team creation is locked out tenant-wide — usually discovered on a Friday afternoon.", tradeOff: "A request step where there was none. Unpopular for a fortnight, then invisible." },
  },
  {
    id: "s7",
    label: "Step 7",
    pillar: "security",
    meta: "Entra ID · 30 min",
    title: "Audit and fix MFA on the 11 admin accounts",
    where: "Entra admin center → Users → [user] → Authentication methods",
    code: { language: "PowerShell · Microsoft Graph", script: "$ga = Get-MgDirectoryRole | Where-Object { $_.DisplayName -eq \"Global Administrator\" }\n\nGet-MgDirectoryRoleMember -DirectoryRoleId $ga.Id | ForEach-Object {\n    $u = Get-MgUser -UserId $_.Id -Property DisplayName,UserPrincipalName,SignInActivity\n    [PSCustomObject]@{\n        Name       = $u.DisplayName\n        UPN        = $u.UserPrincipalName\n        LastSignIn = $u.SignInActivity.LastSignInDateTime\n        Methods    = (Get-MgUserAuthenticationMethod -UserId $u.Id).\n                       AdditionalProperties[\"@odata.type\"] -join \", \"\n    }\n} | Sort-Object LastSignIn | Format-Table -AutoSize" },
    verify: "Every row shows a method beyond password, or the account has been removed.",
    blastRadius: { goesRight: "Four privileged accounts get a second factor, and two dormant admin accounts disappear entirely.", goesWrong: "Enforce MFA on an account with no registered method and its owner is locked out. Register first, enforce second.", tradeOff: "A short window of admin inconvenience. Nothing else in the guide reduces risk this much this fast." },
  },
  {
    id: "s8",
    label: "Step 8",
    pillar: "security",
    meta: "Entra ID · 45 min",
    title: "Scope a Conditional Access policy to privileged roles",
    where: "Entra admin center → Protection → Conditional Access → New policy",
    code: { language: "PowerShell · Microsoft Graph", script: "$params = @{\n    displayName = \"CA04 - Require MFA for privileged roles\"\n    state       = \"enabledForReportingButNotEnforced\"\n    conditions  = @{\n        users = @{ includeRoles = @(\n            \"62e90394-69f5-4237-9190-012177145e10\",   # Global Administrator\n            \"194ae4cb-b126-40b2-bd5b-6091b380977d\",   # Security Administrator\n            \"729827e3-9c14-49f7-bb1b-9608f156bbb8\"    # Helpdesk Administrator\n        ) }\n        applications = @{ includeApplications = @(\"All\") }\n    }\n    grantControls = @{ operator = \"OR\"; builtInControls = @(\"mfa\") }\n}\n\nNew-MgIdentityConditionalAccessPolicy -BodyParameter $params" },
    caution: "Create it in report-only, watch the sign-in logs for 48 hours, then enable. Never create an admin-scoped CA policy already enabled — you can lock every administrator out of the tenant, including yourself.",
    verify: "Sign-in logs, filtered to CA04, show \"Report-only: success\" for admin sign-ins. Then set State to enabled.",
    blastRadius: { goesRight: "Privileged access requires MFA. The clearest gate blocker in the assessment closes.", goesWrong: "Create it enabled rather than report-only and you can lock every administrator out of the tenant, including yourself. This is the single highest-risk action in the guide.", tradeOff: "48 hours in report-only before enforcement. Do not shortcut it — break-glass accounts exist precisely because people do." },
  },
  {
    id: "s9",
    label: "Step 9",
    pillar: "security",
    meta: "Entra ID · 15 min",
    title: "Re-enable CA01 and remove the 14 June exclusion",
    where: "Entra admin center → Protection → Conditional Access",
    code: { language: "PowerShell · Microsoft Graph", script: "Get-MgIdentityConditionalAccessPolicy |\n    Select-Object DisplayName, State,\n        @{ N=\"Excluded\"; E={ $_.Conditions.Users.ExcludeGroups -join \",\" } } |\n    Format-Table -AutoSize\n\n# on the policy holding the 44-member exclusion:\nUpdate-MgIdentityConditionalAccessPolicy -ConditionalAccessPolicyId <id>\n    -Conditions @{ users = @{ excludeGroups = @() } }" },
    verify: "No policy excludes any group other than your two break-glass accounts.",
    blastRadius: { goesRight: "The baseline holds again and the 44-member exclusion stops quietly bypassing policy.", goesWrong: "Removing the exclusion without knowing why it was added can break a legitimate service account or an unmanaged-device workflow.", tradeOff: "Find out who added it on 14 June and why, before you remove it." },
  },
  {
    id: "s10",
    label: "Step 10",
    pillar: "security",
    meta: "Exchange Online · 1 week elapsed",
    title: "Disable legacy authentication",
    where: "Exchange admin center → Settings → Modern authentication",
    code: { language: "PowerShell · Graph, then Exchange Online", script: "# 1. what is actually using legacy auth\nGet-MgAuditLogSignIn -Top 999 |\n    Where-Object { $_.ClientAppUsed -notin @(\"Browser\",\n                     \"Mobile Apps and Desktop clients\") } |\n    Group-Object ClientAppUsed, AppDisplayName |\n    Sort-Object Count -Descending | Format-Table Count, Name\n\n# 2. once migrated, disable per protocol\nSet-TransportConfig -SmtpClientAuthenticationDisabled $true\nGet-CASMailboxPlan -Filter { ImapEnabled -eq $true -or PopEnabled -eq $true } |\n    Set-CASMailboxPlan -ImapEnabled $false -PopEnabled $false" },
    caution: "1,106 legacy sign-ins in 30 days means something real still uses it. Find and migrate those two line-of-business clients first — disabling this cold will break them.",
    verify: "Legacy sign-in count reaches zero across a 7-day window.",
    blastRadius: { goesRight: "1,106 legacy sign-ins a month stop. The oldest identity gap in the tenant closes.", goesWrong: "Disable it before migrating the two line-of-business mail clients and both break immediately, with no graceful failure.", tradeOff: "A week of coordination with those application owners. Not optional — legacy auth bypasses Conditional Access entirely." },
  },
  {
    id: "s11",
    label: "Step 11",
    pillar: "security",
    meta: "Entra ID · 2 hours",
    title: "Reduce 11 standing Global Admins to 2 break-glass accounts",
    where: "Entra admin center → Identity Governance → Privileged Identity Management",
    code: { language: "PowerShell · Microsoft Graph", script: "$params = @{\n    action           = \"adminUpdate\"\n    principalId      = \"<user-object-id>\"\n    roleDefinitionId = \"62e90394-69f5-4237-9190-012177145e10\"\n    directoryScopeId = \"/\"\n    scheduleInfo     = @{\n        startDateTime = Get-Date\n        expiration    = @{ type = \"noExpiration\" }\n    }\n}\n\nNew-MgRoleManagementDirectoryRoleEligibilityScheduleRequest -BodyParameter $params" },
    caution: "Keep exactly two break-glass accounts: cloud-only, excluded from Conditional Access, hardware-key MFA, credentials sealed. Document them before removing anything else.",
    verify: "PIM → Global Administrator shows 2 permanent and 9 eligible.",
    blastRadius: { goesRight: "Standing privilege drops from eleven accounts to two. Blast radius shrinks from 1,847 sites to a documented pair of emergency accounts.", goesWrong: "Remove standing access without configuring PIM and your administrators cannot elevate when something breaks at 2am. Lose both break-glass accounts and nobody can get in at all.", tradeOff: "Administrators activate a role instead of holding it. Mildly irritating daily, decisive in a breach." },
  },
  {
    id: "s12",
    label: "Step 12",
    pillar: "security",
    meta: "Defender · 10 min",
    title: "Reinstate the Safe Links policy disabled on 14 June",
    where: "Defender portal → Policies & rules → Threat policies → Safe Links",
    code: { language: "PowerShell · Exchange Online", script: "Get-SafeLinksPolicy | Select-Object Name, IsEnabled, WhenChangedUTC\n\nSet-SafeLinksPolicy -Identity \"Finance - Safe Links\" -IsEnabled $true\nGet-SafeLinksRule  -Identity \"Finance - Safe Links\" | Enable-SafeLinksRule" },
    verify: "IsEnabled reads True.",
    blastRadius: { goesRight: "Safe Links protection returns to the group most targeted by phishing.", goesWrong: "No downside. It was disabled on 14 June and nothing depended on it being off.", tradeOff: "A handful of legitimate links get rewritten and take an extra moment to resolve." },
  },
  {
    id: "s13",
    label: "Step 13",
    pillar: "security",
    meta: "Intune · 3 days",
    title: "Take device compliance out of report-only",
    where: "Intune admin center → Devices → Compliance policies",
    code: { language: "PowerShell · Microsoft Graph", script: "Get-MgDeviceManagementManagedDevice -All |\n    Where-Object { $_.ComplianceState -ne \"compliant\" } |\n    Select-Object DeviceName, UserPrincipalName, ComplianceState,\n                  OperatingSystem, OSVersion |\n    Export-Csv .\\noncompliant-devices.csv -NoTypeInformation" },
    caution: "88 devices currently fail the baseline. Promote the policy and those 88 users lose access. Triage first — 61 need disk encryption, 34 need an OS update, and most overlap.",
    verify: "The CSV falls below 10 rows before you add device compliance as a CA grant control.",
    blastRadius: { goesRight: "Non-compliant devices stop reaching corporate data. 88 devices come up to baseline.", goesWrong: "Promote the policy before triaging and 88 users lose access at once — with encryption and OS updates being the fixes, some take hours.", tradeOff: "Three days of device remediation before enforcement. Enforce first and you own a helpdesk queue instead." },
  },
  {
    id: "s14",
    label: "Step 14",
    pillar: "compliance",
    meta: "Purview · 1 hour",
    title: "Publish a mandatory baseline sensitivity label set",
    where: "Microsoft Purview → Information protection → Labels",
    code: { language: "PowerShell · Purview (Connect-IPPSSession)", script: "New-Label -Name \"Internal\" -DisplayName \"Internal\"\n    -Tooltip \"Standard business content. Not for external sharing.\"\n\nNew-Label -Name \"Confidential\" -DisplayName \"Confidential\"\n    -Tooltip \"Financial, HR or contractual content.\"\n    -EncryptionEnabled $true -EncryptionProtectionType Template\n    -EncryptionRightsDefinitions \"AllStaff@haldenmaterials.com:VIEW,EDIT,PRINT\"\n\nNew-LabelPolicy -Name \"Baseline\" -Labels \"Internal\",\"Confidential\"\n    -ExchangeLocation All -SharePointLocation All -OneDriveLocation All\n    -AdvancedSettings @{ MandatoryLabel = \"true\"; DefaultLabelId = \"Internal\" }" },
    caution: "Encryption on Confidential means external recipients lose access to anything carrying it. Confirm with Legal which external parties receive contract documents before publishing.",
    verify: "A new Word document prompts for a label before it can be saved.",
    blastRadius: { goesRight: "Nothing can be saved unlabelled. Copilot finally has an instruction it obeys.", goesWrong: "Encryption on the Confidential label removes external access to anything carrying it — including contracts already shared with clients.", tradeOff: "Users see a label prompt on every new document. Confirm the external-access consequence with Legal before publishing." },
  },
  {
    id: "s15",
    label: "Step 15",
    pillar: "compliance",
    meta: "Purview · 2 hours",
    title: "Auto-label regulated content instead of asking 1,240 people",
    where: "Microsoft Purview → Information protection → Auto-labeling",
    code: { language: "PowerShell · Purview", script: "New-AutoSensitivityLabelPolicy -Name \"Auto - Confidential\"\n    -ApplySensitivityLabel \"Confidential\"\n    -SharePointLocation All -OneDriveLocation All -ExchangeLocation All\n    -Mode TestWithoutNotifications          # simulation only\n\nNew-AutoSensitivityLabelRule -Name \"Financial and HR identifiers\"\n    -Policy \"Auto - Confidential\"\n    -ContentContainsSensitiveInformation @(\n        @{ Name = \"Credit Card Number\";             mincount = \"1\" },\n        @{ Name = \"U.K. National Insurance Number\"; mincount = \"1\" },\n        @{ Name = \"International Banking Account Number (IBAN)\"; mincount = \"1\" }\n    )" },
    verify: "Simulation results after 48 hours show a plausible match count, then switch Mode to Enable.",
    blastRadius: { goesRight: "61% of content gets labelled without asking 1,240 people to do it manually.", goesWrong: "Enable it live and mislabelled content gets encrypted at scale. Reversing that across an estate is days of work.", tradeOff: "Run simulation for a full cycle first. Slower to start, and the only safe way to do this." },
  },
  {
    id: "s16",
    label: "Step 16",
    pillar: "compliance",
    meta: "Purview · 1 hour",
    title: "Extend DLP to Teams chat and OneDrive — in review mode",
    where: "Microsoft Purview → Data loss prevention → Policies",
    code: { language: "PowerShell · Purview", script: "New-DlpCompliancePolicy -Name \"DLP - Teams and OneDrive\"\n    -TeamsLocation All -OneDriveLocation All -SharePointLocation All\n    -Mode TestWithNotifications     # review mode: alerts, does not block\n\nNew-DlpComplianceRule -Name \"Regulated identifiers\"\n    -Policy \"DLP - Teams and OneDrive\"\n    -ContentContainsSensitiveInformation @(\n        @{ Name = \"U.K. National Insurance Number\"; mincount = \"1\" },\n        @{ Name = \"Credit Card Number\";             mincount = \"1\" }\n    )\n    -NotifyUser Owner, LastModifier\n    -GenerateIncidentReport SiteAdmin -IncidentReportContent All" },
    caution: "Leave it in TestWithNotifications for two weeks minimum. Read the incident reports, tune against real false positives, then move to Enable. Blocking on day one is how DLP gets switched off permanently.",
    verify: "Purview → DLP → Alerts shows matches within 24 hours and no user is blocked.",
    blastRadius: { goesRight: "Regulated data moving through Teams chat becomes visible. The DLP gap that blocks the gate closes.", goesWrong: "Enforce on day one and false positives block real work within hours. That is how DLP gets switched off permanently and never reinstated.", tradeOff: "Two weeks in review mode reading incident reports. Alerts without blocking, then tune, then enforce." },
  },
  {
    id: "s17",
    label: "Step 17",
    pillar: "compliance",
    meta: "Purview · 45 min",
    title: "Extend retention to the six uncovered workloads",
    where: "Microsoft Purview → Data lifecycle management → Retention policies",
    code: { language: "PowerShell · Purview", script: "New-RetentionCompliancePolicy -Name \"Retention - Full workload coverage\"\n    -TeamsChatLocation All -TeamsChannelLocation All\n    -OneDriveLocation All -ModernGroupLocation All\n\nNew-RetentionComplianceRule -Name \"Seven year retain\"\n    -Policy \"Retention - Full workload coverage\"\n    -RetentionDuration 2555 -RetentionComplianceAction Keep" },
    caution: "Retention on Teams chat is irreversible for content already captured. Confirm the duration with Legal — 2,555 days is a placeholder, not a recommendation.",
    verify: "Policy status reads On across all six previously uncovered locations.",
    blastRadius: { goesRight: "Six uncovered workloads come under retention. Teams chat, OneDrive and Planner stop being a records gap.", goesWrong: "Retention on Teams chat cannot be undone for content already captured. Set the wrong duration and you have created a discovery liability.", tradeOff: "Storage grows and deletion becomes harder. Confirm the duration with Legal — 2,555 days is a placeholder." },
  },
  {
    id: "s18",
    label: "Step 18",
    pillar: "compliance",
    meta: "Purview · 10 min",
    title: "Raise audit log retention above the 90-day floor",
    where: "Microsoft Purview → Audit → Audit retention policies",
    code: { language: "PowerShell · Purview", script: "New-UnifiedAuditLogRetentionPolicy -Name \"Extended - privileged activity\"\n    -RecordTypes AzureActiveDirectory, ExchangeAdmin, SharePointSharingOperation\n    -RetentionDuration TenYears -Priority 100" },
    caution: "Ten-year retention across all record types needs E5 or an add-on. Scope it to privileged and sharing activity first — that is what an investigation actually needs.",
    verify: "Get-UnifiedAuditLogRetentionPolicy lists the policy as enabled.",
    blastRadius: { goesRight: "Investigations reaching back beyond 90 days become possible for the first time.", goesWrong: "Nothing breaks. The only risk is scoping it so broadly that the licensing cost surprises you.", tradeOff: "Ten-year retention across all record types needs E5 or an add-on. Scope to privileged and sharing activity first." },
  },
  {
    id: "s19",
    label: "Step 19",
    pillar: "licensing",
    meta: "Entra ID · 20 min",
    title: "Identify the 22 dormant Copilot seats",
    where: "PowerShell — the licensing blade does not show last activity",
    code: { language: "PowerShell · Microsoft Graph", script: "$copilot = \"639dec6b-bb19-468b-871c-c5c441c4b0cb\"   # Copilot for M365\n\nGet-MgUser -All -Property DisplayName,UserPrincipalName,AssignedLicenses,SignInActivity |\n    Where-Object { $_.AssignedLicenses.SkuId -contains $copilot } |\n    Select-Object DisplayName, UserPrincipalName,\n        @{ N=\"LastSignIn\"; E={ $_.SignInActivity.LastSignInDateTime } } |\n    Sort-Object LastSignIn |\n    Export-Csv .\\copilot-dormant.csv -NoTypeInformation" },
    caution: "Sign-in activity is not Copilot usage. Cross-check against the Copilot usage report in the M365 admin center before reclaiming anyone.",
    verify: "The CSV shows 22 users with no Copilot activity in 30 days.",
    blastRadius: { goesRight: "You find out which 22 of the 60 Copilot seats are genuinely unused.", goesWrong: "Reading sign-in activity as Copilot usage reclaims a seat from someone who uses Copilot weekly but signs in rarely.", tradeOff: "Cross-check against the Copilot usage report. One extra step, avoids one very awkward conversation." },
  },
  {
    id: "s20",
    label: "Step 20",
    pillar: "licensing",
    meta: "Entra ID · 15 min",
    title: "Reclaim them after a 14-day notice",
    where: "Entra admin center → Billing → Licenses",
    code: { language: "PowerShell · Microsoft Graph", script: "Import-Csv .\\copilot-dormant-confirmed.csv | ForEach-Object {\n    Set-MgUserLicense -UserId $_.UserPrincipalName\n        -RemoveLicenses @(\"639dec6b-bb19-468b-871c-c5c441c4b0cb\")\n        -AddLicenses @()\n    Write-Host \"Reclaimed: $($_.UserPrincipalName)\"\n}" },
    caution: "Send the notice first. Reclaiming a licence someone was about to start using is the fastest way to lose goodwill for the whole programme.",
    verify: "Billing → Licenses shows 22 Copilot seats available.",
    blastRadius: { goesRight: "$7,920 a year returns immediately, with no purchase and no negotiation.", goesWrong: "Reclaim without notice and you take a licence from someone who was about to start. That story travels further than the saving.", tradeOff: "A 14-day notice delays the saving by two weeks and protects goodwill for the whole programme." },
  },
  {
    id: "s21",
    label: "Step 21",
    pillar: "licensing",
    meta: "Entra ID · 2 hours",
    title: "Reconcile the 47 mismatched SKU assignments",
    where: "Entra admin center → Groups → Licenses",
    code: { language: "PowerShell · Microsoft Graph", script: "$skus = Get-MgSubscribedSku\n\nGet-MgUser -All -Property DisplayName,Department,JobTitle,AssignedLicenses |\n    Select-Object DisplayName, Department, JobTitle,\n        @{ N=\"SKUs\"; E={ ($_.AssignedLicenses.SkuId | ForEach-Object {\n            ($skus | Where-Object SkuId -eq $_).SkuPartNumber }) -join \",\" } } |\n    Sort-Object Department, SKUs |\n    Export-Csv .\\sku-by-department.csv -NoTypeInformation" },
    verify: "Every row matches a defined role template, or sits on a documented exception list.",
    blastRadius: { goesRight: "47 mismatched assignments come onto a defined role pattern. Licensing becomes predictable.", goesWrong: "Downgrade someone from E5 to E3 without checking and they lose the very Purview or CA features another task just relied on.", tradeOff: "Reconciliation takes a couple of hours of real judgement. Not a script you run unattended." },
  },
  {
    id: "s22",
    label: "Step 22",
    pillar: "licensing",
    meta: "Entra ID · 3 hours",
    title: "Move to group-based licensing and retire the three legacy groups",
    where: "Entra admin center → Groups → New group → Dynamic User",
    code: { language: "PowerShell · Microsoft Graph", script: "New-MgGroup -DisplayName \"LIC-E5-Finance\" -MailEnabled:$false\n    -SecurityEnabled -MailNickname \"lic-e5-finance\"\n    -GroupTypes \"DynamicMembership\" -MembershipRuleProcessingState \"On\"\n    -MembershipRule (\n        \"(user.department -eq \" + [char]34 + \"Finance\" + [char]34 + \")\" +\n        \" -and (user.accountEnabled -eq true)\"\n    )" },
    caution: "Assign the licence to the new group and confirm membership resolves before removing the legacy group. Overlapping assignment is safe; a gap is not.",
    verify: "A new Finance starter receives E5 within 24 hours of their HR record appearing.",
    blastRadius: { goesRight: "New starters land on the right SKU automatically. Seat drift stops recurring.", goesWrong: "Remove the legacy group before the dynamic group resolves and users briefly hold no licence at all — mailboxes go into a 30-day grace state.", tradeOff: "Overlap the two assignments deliberately. Paying twice for a day beats a licensing gap." },
  },
  {
    id: "s23",
    label: "Step 23",
    pillar: "adoption",
    meta: "Reports · 20 min",
    title: "Pull the real usage baseline before planning any training",
    where: "M365 admin center → Reports → Usage",
    code: { language: "PowerShell · Microsoft Graph", script: "Get-MgReportTeamUserActivityUserDetail    -Period D30 -OutFile .\\teams-d30.csv\nGet-MgReportOneDriveUsageAccountDetail    -Period D30 -OutFile .\\onedrive-d30.csv\nGet-MgReportSharePointSiteUsageDetail     -Period D30 -OutFile .\\spo-d30.csv" },
    verify: "The Teams export shows 412 users with zero activity, matching the assessment.",
    blastRadius: { goesRight: "You plan training against real usage rather than assumption.", goesWrong: "No risk. The only failure mode is not doing it and training the wrong departments.", tradeOff: "Twenty minutes of work before any enablement spend." },
  },
  {
    id: "s26",
    label: "Step 26",
    pillar: "adoption",
    meta: "Process · ongoing",
    title: "Stop attaching documents to email by default",
    where: "SharePoint admin center → Policies → Sharing → Default link type",
    code: { language: "PowerShell · SharePoint Online", script: "Set-SPOTenant -DefaultSharingLinkType Internal -DefaultLinkPermission Edit" },
    verify: "Attachment share of document traffic falls below 20% over two quarters.",
    blastRadius: { goesRight: "44% of document traffic becomes visible to Copilot and gains real version control.", goesWrong: "Nothing breaks technically. People who prefer attachments will route around it if nobody explains why.", tradeOff: "Users lose the habit of sending copies. Some will need telling twice." },
  },
  {
    id: "s27",
    label: "Step 27",
    pillar: "health",
    meta: "All workloads · 1 hour",
    title: "Capture a signed configuration baseline",
    where: "PowerShell — run this before Phase 1 begins, not after",
    code: { language: "PowerShell · multi-module", script: "$stamp = Get-Date -Format \"yyyy-MM-dd\"\n$dir   = \".\\baseline-$stamp\"\nNew-Item -ItemType Directory -Path $dir -Force | Out-Null\n\nGet-MgIdentityConditionalAccessPolicy | ConvertTo-Json -Depth 10 |\n    Out-File \"$dir\\conditional-access.json\"\nGet-SPOTenant           | ConvertTo-Json | Out-File \"$dir\\spo-tenant.json\"\nGet-OrganizationConfig  | ConvertTo-Json | Out-File \"$dir\\exo-org.json\"\nGet-DlpCompliancePolicy | ConvertTo-Json -Depth 6 | Out-File \"$dir\\dlp.json\"\n\nGet-FileHash \"$dir\\*\" | Export-Csv \"$dir\\hashes.csv\" -NoTypeInformation" },
    verify: "The folder holds four JSON files and a hash manifest. Store a copy outside the tenant.",
    blastRadius: { goesRight: "You gain something to measure drift against. Every later change becomes visible.", goesWrong: "Skip it and the 37-unreviewed-changes problem simply continues, invisibly, on top of freshly remediated configuration.", tradeOff: "An hour before Phase 1 begins. Run it after remediation and you have baselined the fix, not the starting point." },
  },
  {
    id: "s28",
    label: "Step 28",
    pillar: "health",
    meta: "OneDrive · 1 week",
    title: "Resolve the 214 OneDrive sync errors",
    where: "M365 admin center → Health → OneDrive sync reports",
    code: { language: "PowerShell · Microsoft Graph", script: "Get-MgReportOneDriveUsageAccountDetail -Period D30 -OutFile .\\od.csv\n\nImport-Csv .\\od.csv |\n    Where-Object { $_.\"Last Activity Date\" -eq \"\" -and $_.\"Is Deleted\" -eq \"False\" } |\n    Select-Object \"Owner Principal Name\", \"Site URL\"" },
    caution: "Most sync errors are a stale client rather than a service fault. Push the current OneDrive build to the 34 out-of-date devices before investigating individually.",
    verify: "Sync error count falls below 20 in the admin center health report.",
    blastRadius: { goesRight: "214 users get reliable file sync, and OneDrive becomes dependable enough for Copilot to ground on.", goesWrong: "Little risk. Chasing 214 users individually instead of pushing the client update wastes a week.", tradeOff: "Most resolve with a single client update. Investigate only what remains." },
  },
  {
    id: "s29",
    label: "Step 29",
    pillar: "health",
    meta: "SharePoint · 3 weeks",
    title: "Attest and dispose of 148 inactive sites and 19 orphaned channels",
    where: "SharePoint admin center → Sites → sort by Last activity",
    code: { language: "PowerShell · Microsoft Graph", script: "Get-MgGroup -All -Property DisplayName,Id,CreatedDateTime | ForEach-Object {\n    $owners = Get-MgGroupOwner -GroupId $_.Id -ErrorAction SilentlyContinue\n    if (-not $owners) {\n        [PSCustomObject]@{ Group = $_.DisplayName; Created = $_.CreatedDateTime }\n    }\n} | Export-Csv .\\orphaned-groups.csv -NoTypeInformation" },
    caution: "Never delete on inactivity alone. Assign an owner, ask them to confirm, and dispose only of what comes back unclaimed after the notice period.",
    verify: "Orphaned group count reaches zero and every remaining site has a named owner.",
    blastRadius: { goesRight: "Stale content stops surfacing in Copilot answers as current. Ownership is restored across the estate.", goesWrong: "Delete on inactivity alone and you destroy archived records with real retention obligations attached.", tradeOff: "Three weeks of attestation. Assign an owner, ask, then dispose of what comes back unclaimed." },
  },
  {
    id: "s30",
    label: "Step 30",
    pillar: "health",
    meta: "Ongoing · monthly",
    title: "Put drift telemetry on the tenant",
    where: "Schedule this against the baseline captured in Step 27",
    code: { language: "PowerShell · scheduled monthly", script: "$all  = Get-ChildItem .\\baseline-* -Directory | Sort-Object Name\n$prev = $all[-2].FullName\n$cur  = $all[-1].FullName\n\nCompare-Object (Get-Content \"$prev\\conditional-access.json\") `\n               (Get-Content \"$cur\\conditional-access.json\") |\n    Where-Object { $_.SideIndicator -ne \"==\" } |\n    Export-Csv \".\\drift-$(Get-Date -Format yyyy-MM).csv\" -NoTypeInformation" },
    verify: "The first monthly run produces a drift report with zero unexplained differences.",
    blastRadius: { goesRight: "The 27 points you just earned stay earned. Drift becomes visible the month it happens.", goesWrong: "Skip it and remediation quietly undoes itself inside two quarters — the same 37 unreviewed changes, on better configuration.", tradeOff: "A monthly review that someone has to actually read. This is the task that protects the other twenty-nine." },
  },
];

/** How many of the twenty-eight steps ship a command to run. Derived, never restated. */
export const REMEDIATION_SCRIPTED_COUNT = REMEDIATION_STEPS.filter((s) => s.code !== undefined).length;

/** The one-off module install and sign-in every scripted step assumes. */
export const REMEDIATION_PRELUDE = {
  heading: "Before you start · connect once",
  blurb:
    "Every script below assumes these modules and one authenticated session. Run this first and leave the window open.",
  code: {
    language: "PowerShell 7 · run once",
    script: `Install-Module Microsoft.Graph -Scope CurrentUser -Force
Install-Module Microsoft.Online.SharePoint.PowerShell -Scope CurrentUser -Force
Install-Module ExchangeOnlineManagement -Scope CurrentUser -Force
Install-Module PnP.PowerShell -Scope CurrentUser -Force

Connect-MgGraph -Scopes "Directory.Read.All","Policy.Read.All",
  "Policy.ReadWrite.ConditionalAccess","RoleManagement.ReadWrite.Directory",
  "User.Read.All","Reports.Read.All"
Connect-SPOService -Url https://haldenmaterials-admin.sharepoint.com
Connect-IPPSSession   # Purview: labels, DLP, retention
Connect-ExchangeOnline`,
  },
  footnote:
    "Use an account with Global Reader plus the specific role each step names. Nothing here requires standing Global Administrator — and Step 12 removes most of yours.",
} as const;

export const REMEDIATION_GUIDE = {
  kicker: "Full remediation guide · Copilot Gate clearance plan",
  headline: "Every step required to clear the Copilot Gate",
  standfirst:
    "This is a runbook. Twenty-eight steps, every one of them scripted, with the exact console path, the PowerShell to run, what to watch for, and how to confirm each one worked. Tick them off as you go — your progress is kept while this page is open.",
  scope: {
    eyebrow: "The scope",
    headline: "28 steps. 14 weeks. 6 findings holding it below the threshold.",
    sub: "Everything below is yours to run, in dependency order, with the script and the verification for each.",
  },

  overview: {
    heading: "Remediation Overview",
    blurb:
      "This guide is a runbook, not a summary. Every step is a real action against your tenant, with the exact console path or PowerShell to run it, what to watch out for, and how to confirm it worked. Tick each one off as you go. Work top to bottom — the order is the dependency order.",
    rows: [
      { label: "Total findings requiring remediation", tone: "attention", value: "41 across six pillars" },
      { label: "Not safe yets", tone: "critical", value: "6 — Governance 2 · Security 2 · Compliance 2" },
      /**
       * DELIBERATELY DERIVED, NOT VERBATIM. The design's own copy reads "26, of
       * which 22 are scripted" while the guide beneath it now holds twenty-eight
       * steps, every one of them scripted (Steps 24 and 25, the only two
       * unscripted steps, were removed in #757). Reproducing a hardcoded count
       * that the page then contradicts two screens later is worse than deriving
       * it, so this row is built from the array.
       */
      { label: "Steps in this guide", tone: "healthy", derived: "stepCount" },
      { label: "Critical path duration", tone: "attention", value: "14 weeks to certification · 12 weeks to enablement" },
      { label: "Expected improvement", tone: "healthy", value: "41 to 68 (+27) on the scoped programme" },
    ],
  },

  /** The six per-pillar groups, in the order the guide works through them. */
  groups: [
    { pillar: "governance", heading: "Governance Remediation" },
    { pillar: "security", heading: "Security Remediation" },
    { pillar: "compliance", heading: "Compliance Remediation" },
    { pillar: "licensing", heading: "Licensing Remediation" },
    { pillar: "adoption", heading: "Adoption Remediation" },
    { pillar: "health", heading: "Health Remediation" },
  ],

  sequence: {
    heading: "Remediation Sequence (Critical Path)",
    phases: [
      { label: "Phase 1", when: "Weeks 1–4", steps: "Steps 1–13", title: "Governance & Security" },
      { label: "Phase 2", when: "Weeks 3–7", steps: "Steps 14–22", title: "Compliance & Licensing" },
      { label: "Phase 3", when: "Weeks 6–10", steps: "Steps 23–30", title: "Adoption & Health" },
      { label: "Phase 4", when: "Weeks 10–12", steps: "Pilot cohort first", title: "Copilot Enablement" },
      { label: "Phase 5", when: "Week 13", steps: "Re-scan and confirm", title: "Gate Validation" },
      { label: "Phase 6", when: "Week 14", steps: "Signed baseline", title: "Readiness Certification" },
    ],
    note:
      "Phases 1–3 overlap deliberately: Compliance labelling can begin while the Governance sharing work is still running, since both touch the same sites. Phases 4–6 are strictly sequential — enablement cannot precede validation, and certification cannot precede either.",
  },

  checklist: {
    heading: "Gate Validation Checklist",
    rows: [
      "All governance blockers resolved — 2 open (Steps 1, 4)",
      "All security blockers resolved — 2 open (Steps 7, 8)",
      "All compliance blockers resolved — 2 open (Steps 14, 16)",
      "All licensing blockers resolved — none open",
      "All adoption blockers resolved — none open",
      "All health blockers resolved — none open",
      "Copilot blast radius reduced to safe threshold — 212 sites currently reachable",
      "Readiness score at or above 82 — currently 41, projected 68 on this scope",
    ],
    note:
      "The 28 steps above take readiness to 68. The remaining 14 points to the 82 threshold come from adoption enablement — training moves Adoption from 46 to an estimated 61 on its own, which is what carries the tenant across rather than up to the line.",
  },

  closing: [
    "Clearing the Copilot Gate requires coordinated remediation across governance, security, compliance, licensing, adoption and health. This guide is the whole of it: 28 steps, every one of them scripted, on a 14-week critical path.",
    "Phase 1 is the identity and sharing work that must land before Copilot is enabled for anyone. The licensing waste already identified funds a meaningful share of the programme. Drift telemetry in Step 30 is what keeps the result once it is earned — without it, this guide is something you run again in two quarters.",
  ],

  handoff: {
    heading: "If you would rather not run this yourself",
    blurb:
      "Every step here is yours to keep and run at your own pace. The proposal covers the same 28 steps delivered by Shane McCaw, with the gate validation and signed baseline included.",
    cta: "Open the statement of work",
  },
} as const;
