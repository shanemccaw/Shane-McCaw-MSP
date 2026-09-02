-- #2049 — Remediation knowledge base: the compliance: domain, authored & published.
--
-- Populates remediation_knowledge_base with verified "this is wrong → here is how
-- to fix it" content for EVERY active compliance: check (7 rows). Before this the
-- compliance: domain had zero rows, so every compliance finding fell through to the
-- AI fallback (#1539 built the fix-route dimension this content feeds; #1924 set the
-- authoring standard and shipped the identity: domain first; this issue supplies the
-- compliance: content).
--
-- AUTHORING STANDARD (see #1924, followed exactly for this domain):
--   * Every row is verified against real Microsoft Learn / official Microsoft docs
--     that were actually fetched in build session #2049 (2026-09-02). The URLs in
--     source_urls are those pages.
--   * verified_by is an HONEST AGENT attribution — never a human name. The content
--     is agent-authored and awaiting a human spot-check (filed as a Shane To-Do).
--   * Tenant-specific values use angle-bracket placeholders (<SiteName>, …), never a
--     fabricated real value.
--   * fix_route_capability is the finding-side CEILING (#1539): you_must_run when a
--     real customer-runnable fix script is authored in a step's `code`;
--     admin_center_only when the real fix is portal-only OR is a design decision
--     that cannot be reduced to a blind script (e.g. compliance:zero-dlp-policies —
--     which sensitive info types and locations to protect is a per-tenant decision,
--     not a toggle). NEVER we_can_run here — that shape requires a live config pack
--     mapped to the check (#1925's job).
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
-- compliance:audit-log-retention
-- ─────────────────────────────────────────────────────────────────────────────

(
  'compliance:audit-log-retention',
  $ttl$Extend audit log retention beyond the Microsoft default$ttl$,
  $sum$Every Microsoft 365 tenant has an implicit default audit log retention (currently 180 days under Audit Standard for records generated on or after 2023-10-17, or up to one year for Exchange/SharePoint/OneDrive/Entra activity under Audit Premium for E5-licensed users — 180 days for everyone else). With zero explicit custom retention policies, the tenant is relying entirely on that default, which is rarely long enough to satisfy a real breach investigation, litigation hold, or regulatory retention requirement — many of which run three to ten years. Because Get-UnifiedAuditLogRetentionPolicy can only report custom, explicitly-configured policies and not the implicit default, a tenant with none is an honest coverage gap, not proof audit data is currently being lost.$sum$,
  jsonb_build_array(
    $prq$Organization Configuration role in the Microsoft Purview portal (or the equivalent Security & Compliance PowerShell role) to create or modify an audit retention policy$prq$,
    $prq$Microsoft 365 E5, Microsoft Purview Suite (E5 Compliance), or the E5 eDiscovery and Audit add-on for any user whose activity should be retained past the Audit (Standard) default$prq$,
    $prq$A 10-Year Audit Log Retention add-on license (in addition to E5) if any duration beyond one year is required$prq$,
    $prq$Security & Compliance PowerShell (Connect-IPPSSession) if automating instead of using the portal$prq$
  ),
  $apath$Microsoft Purview portal → Audit → Create audit retention policy$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Confirm what the tenant actually needs to retain and for how long (legal/compliance requirement, cyber-insurance requirement, or internal incident-response policy), and check whether the implicit default already covers it before creating a redundant policy.$stp$),
    jsonb_build_object('text', $stp$In the Microsoft Purview portal, open the Audit solution → Create audit retention policy, and set Policy name, the users/record types/activities it should apply to (leave blank for all), Duration, and Priority — a lower Priority number takes precedence, and any custom policy always outranks the implicit default.$stp$),
    jsonb_build_object('text', $stp$PowerShell equivalent, for scripting the rollout or covering a record type not exposed in the portal UI:$stp$, 'code', $cod$Connect-IPPSSession
New-UnifiedAuditLogRetentionPolicy -Name "<PolicyName>" -Description "<Description>" -RetentionDuration OneYear -Priority 100$cod$, 'codeLanguage', $lng$powershell$lng$)
  ),
  $eo$Get-UnifiedAuditLogRetentionPolicy returns at least one custom policy whose RetentionDuration meets the organization's real retention requirement, at a Priority that takes effect ahead of the implicit default for the record types/users it targets.$eo$,
  $vs$List all custom audit log retention policies, sorted by priority, and confirm the intended policy exists with the expected RetentionDuration and scope.$vs$,
  $vc$Get-UnifiedAuditLogRetentionPolicy | Sort-Object -Property Priority -Descending | Format-List Name,RecordTypes,RetentionDuration,Priority$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/purview/audit-log-retention-policies$url$,
    $url$https://learn.microsoft.com/en-us/powershell/module/exchangepowershell/new-unifiedauditlogretentionpolicy?view=exchange-ps$url$,
    $url$https://learn.microsoft.com/en-us/powershell/module/exchangepowershell/get-unifiedauditlogretentionpolicy?view=exchange-ps$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02; Security & Compliance PowerShell (ExchangePowerShell module)$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2049) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$The default retention for Audit (Standard) changed from 90 to 180 days for records generated on/after 2023-10-17 — records from before that date are still only 90 days. Durations beyond one year (3/5/7/10 years) all require the 10-Year Audit Log Retention add-on per Microsoft's own licensing note, not just E5 — confirm licensing before promising a multi-year duration to the customer.$note$
),

-- ─────────────────────────────────────────────────────────────────────────────
-- compliance:dlp-incidents
-- ─────────────────────────────────────────────────────────────────────────────

(
  'compliance:dlp-incidents',
  $ttl$Investigate DLP incident volume in Activity Explorer$ttl$,
  $sum$This is a 30-day volume count of DLP-related activity (rule matches, rule enforcement, informational events, and classification events), not a pass/fail control — the platform deliberately scores no severity band against it. A high count can mean real, ongoing oversharing of sensitive data, or it can mean a policy is miscalibrated and generating noise on content that isn't actually sensitive. Read this number alongside compliance:zero-dlp-policies (do policies exist to generate these events at all) and compliance:weak-dlp-policies (are they actually enforcing, or only auditing) — a rising incident count from an enforcing policy is a very different fact from the same count with every policy still in test mode.$sum$,
  jsonb_build_array(
    $prq$Information Protection Admin, Information Protection Analyst, or Information Protection Investigator role (or the Compliance Administrator / Security Administrator / Security Reader Microsoft 365 role groups) to view Activity Explorer$prq$,
    $prq$Microsoft Purview DLP licensing covering the workloads generating the events (Exchange, SharePoint, OneDrive, Teams, Devices, etc.)$prq$,
    $prq$Exchange Online Management PowerShell V3 (Connect-IPPSSession) if exporting programmatically instead of using the portal UI$prq$
  ),
  $apath$Microsoft Purview portal → Data Loss Prevention → Activity explorer (also reachable from Solutions → Information Protection → Data classification → Activity explorer)$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Open Activity Explorer and filter Activity type to DLPRuleMatch, DLPRuleEnforce, DLPInfo, and DlpClassification for the last 30 days; use the built-in "DLP policies that detected activities" and "DLP rule matched" filter sets to see which policies and rules are driving the volume.$stp$),
    jsonb_build_object('text', $stp$For each high-volume rule, open individual matched items to judge whether matches are genuine sensitive-data exposure (escalate through your incident-response process) or false positives from an over-broad sensitive-info-type condition, count threshold, or scope — tune the rule accordingly rather than leaving it noisy.$stp$),
    jsonb_build_object('text', $stp$Cross-reference matches that also raised a DLP alert in the DLP Alerts dashboard (Microsoft Purview portal or Microsoft Defender portal → Incidents & alerts) and track investigation/resolution there, since Activity Explorer itself has no case-management workflow.$stp$),
    jsonb_build_object('text', $stp$To pull the same 30 days of activity programmatically instead of the portal (also lets you page past the portal's 10,000-row export limit):$stp$, 'code', $cod$Connect-IPPSSession
Export-ActivityExplorerData -StartTime (Get-Date).AddDays(-30) -EndTime (Get-Date) -OutputFormat Json -PageSize 5000$cod$, 'codeLanguage', $lng$powershell$lng$)
  ),
  $eo$The volume and source of DLP incidents in the reporting window is understood and attributed to specific policies/rules; genuine matches are triaged through the DLP Alerts / incident process, and any rule generating disproportionate false-positive noise has been tuned.$eo$,
  $vs$Re-run the same Activity Explorer filters after tuning and confirm the incident volume for the affected rule has dropped, or that remaining matches are confirmed genuine.$vs$,
  NULL,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/purview/data-classification-activity-explorer$url$,
    $url$https://learn.microsoft.com/en-us/purview/dlp-learn-about-dlp$url$,
    $url$https://learn.microsoft.com/en-us/powershell/module/exchangepowershell/export-activityexplorerdata?view=exchange-ps$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02; Exchange Online Management V3 / Security & Compliance PowerShell (ExchangePowerShell module)$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2049) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'admin_center_only',
  $note$There is no single "fix" command for this check the way there is for a misconfigured policy — it is an investigative signal, so fix_route_capability stays admin_center_only even though a real PowerShell export exists, because the export itself doesn't remediate anything on its own. Activity Explorer surfaces up to 30 days of data with a roughly 60-90 minute lag for core services; an empty or low view immediately after a policy change is normal, not evidence the policy isn't working.$note$
),

-- ─────────────────────────────────────────────────────────────────────────────
-- compliance:eeeu-site-sharing
-- ─────────────────────────────────────────────────────────────────────────────

(
  'compliance:eeeu-site-sharing',
  $ttl$Remove broad "Everyone Except External Users" (EEEU) site sharing$ttl$,
  $sum$A SharePoint site permission granted to the EEEU claim, the plain "Everyone" claim, an anonymous (no-sign-in) link, or an organization-wide link means every current and future licensed user in the tenant — or in the anonymous-link case, literally anyone with the URL — can reach that site's content, regardless of whether they have any real business need for it. This is one of the most common oversharing patterns in SharePoint: a site is created, a well-meaning owner adds "Everyone" to make internal collaboration frictionless, and the site quietly becomes readable by the entire company (or the entire internet, for an anonymous link), including any account that is later compromised.$sum$,
  jsonb_build_array(
    $prq$SharePoint Administrator role (or Global Administrator) to change organization- or site-level sharing settings$prq$,
    $prq$Site Owner / Site Collection Administrator access on the specific flagged site to remove the individual broad permission or link$prq$,
    $prq$SharePoint Online Management Shell (Connect-SPOService) if remediating via PowerShell at scale$prq$
  ),
  $apath$SharePoint admin center → Sites → Active sites → (select the flagged site) → Settings → External file sharing (per-site); or Policies → Sharing (organization-wide default)$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Open the flagged site in the SharePoint admin center → Active sites, and under Permissions, identify and remove the specific broad grant: an EEEU or "Everyone" claim in a site/library/item permission, an anonymous ("Anyone") link, or an organization-wide link on content that shouldn't be that broad.$stp$),
    jsonb_build_object('text', $stp$Reset the site's own external-file-sharing setting to no broader than "Only people in your organization" unless the site has a genuine, deliberate need for external collaboration — a site-level setting can never be more permissive than the tenant-wide setting, but it can and should be tighter for sensitive sites.$stp$),
    jsonb_build_object('text', $stp$PowerShell equivalent to tighten a single site's sharing capability:$stp$, 'code', $cod$Connect-SPOService -Url https://<TenantName>-admin.sharepoint.com
Set-SPOSite -Identity "https://<TenantName>.sharepoint.com/sites/<SiteName>" -SharingCapability ExistingExternalUserSharingOnly$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$If the pattern is widespread rather than one or two sites, address it at the tenant level instead of per-site:$stp$, 'code', $cod$Set-SPOTenant -SharingCapability ExistingExternalUserSharingOnly$cod$, 'codeLanguage', $lng$powershell$lng$)
  ),
  $eo$The specific site(s) named in the finding no longer grant access via the EEEU/Everyone claim, an anonymous link, or an organization-wide link; a re-run of the per-site permission fan-out finds no remaining broad grant on that site, and any legitimate collaboration need is served instead by named users/groups or a scoped "Specific people" link.$eo$,
  $vs$Re-enumerate the site's sharing permissions and links (portal or Graph) and confirm no anonymous/EEEU/everyone/organization-wide grant remains; separately confirm the site's SharingCapability is at or below the tenant default.$vs$,
  $vc$Get-SPOSite -Identity "https://<TenantName>.sharepoint.com/sites/<SiteName>" | Select-Object Url,SharingCapability$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/sharepoint/turn-external-sharing-on-or-off$url$,
    $url$https://learn.microsoft.com/en-us/powershell/module/microsoft.online.sharepoint.powershell/set-spotenant?view=sharepoint-ps$url$,
    $url$https://learn.microsoft.com/en-us/powershell/module/microsoft.online.sharepoint.powershell/set-sposite?view=sharepoint-ps$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02; SharePoint Online Management Shell (Microsoft.Online.SharePoint.PowerShell)$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2049) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$If external sharing is turned off (or restricted) for the whole organization after previously being on, existing guests typically lose access within about an hour, but any already-issued share link keeps working until it's separately revoked — removing the tenant/site setting alone does not retroactively kill a live link. A site's own SharingCapability can only be equal to or more restrictive than the org-level setting, never more permissive.$note$
),

-- ─────────────────────────────────────────────────────────────────────────────
-- compliance:label-errors
-- ─────────────────────────────────────────────────────────────────────────────

(
  'compliance:label-errors',
  $ttl$Resolve sensitivity label policy distribution failures$ttl$,
  $sum$A label policy's DistributionStatus reflects whether Microsoft successfully pushed that policy's labels and settings out to the users/groups it targets. A policy stuck in a non-Success distribution state means the labels it should be publishing are not reliably reaching Office apps and services for the affected users — some or all of those users may see stale, missing, or partially-applied labels, which quietly breaks any DLP rule, auto-labeling policy, or retention policy that depends on the label being consistently visible and applicable.$sum$,
  jsonb_build_array(
    $prq$Information Protection Admin, Sensitivity Label Administrator, Compliance Administrator, or Compliance Data Administrator role to view and edit label policies$prq$,
    $prq$Security & Compliance PowerShell (Connect-IPPSSession) to run Get-LabelPolicy / Set-LabelPolicy$prq$,
    $prq$Knowledge of which users/groups the failing policy targets, to distinguish a group-membership/licensing problem from a genuine distribution failure$prq$
  ),
  $apath$Microsoft Purview portal → Information Protection → Publishing policies (Label policies) → select the flagged policy$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Confirm the failure and identify the affected policy:$stp$, 'code', $cod$Connect-IPPSSession
Get-LabelPolicy | Format-List Name,DistributionStatus$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Verify the labels included in the policy are still valid and published (not deleted or archived), and that the policy's target users/groups/administrative units still exist and are correctly scoped — a stale or deleted group reference is a common cause of a stuck distribution.$stp$),
    jsonb_build_object('text', $stp$In the Microsoft Purview portal, open the flagged policy under Publishing policies, make a trivial edit (or re-confirm the existing settings) and save — completing the Create/Edit policy configuration re-triggers distribution; there is no separate "publish" or "retry" button.$stp$),
    jsonb_build_object('text', $stp$Allow up to 24 hours for the redistribution to replicate through all dependent services before re-checking — most changes propagate within the hour, but Microsoft's own guidance is to wait the full window before troubleshooting further.$stp$)
  ),
  $eo$Get-LabelPolicy reports DistributionStatus = Success for the previously-failing policy, and affected users see the policy's labels available again in their Office apps within the normal replication window.$eo$,
  $vs$Re-run Get-LabelPolicy after the replication window and confirm DistributionStatus reads Success rather than a failure/pending state; spot-check with an affected user that the labels are visible in Office apps.$vs$,
  $vc$Get-LabelPolicy | Where-Object { $_.DistributionStatus -ne "Success" } | Format-List Name,DistributionStatus$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/purview/create-sensitivity-labels$url$,
    $url$https://learn.microsoft.com/en-us/powershell/module/exchangepowershell/get-labelpolicy?view=exchange-ps$url$,
    $url$https://learn.microsoft.com/en-us/troubleshoot/microsoft-365/purview/sensitivity-labels/sensitivity-labels-missing$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02; Security & Compliance PowerShell (ExchangePowerShell module)$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2049) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$Get-LabelPolicy exposes DistributionStatus but there is no dedicated "republish" cmdlet — re-saving the policy (portal or Set-LabelPolicy) is the documented way to re-trigger distribution. Changes can take 24-48 hours in scenarios involving new-group population or membership changes, longer than the general 24-hour guidance.$note$
),

-- ─────────────────────────────────────────────────────────────────────────────
-- compliance:missing-labels
-- ─────────────────────────────────────────────────────────────────────────────

(
  'compliance:missing-labels',
  $ttl$Re-enable disabled sensitivity labels$ttl$,
  $sum$Get-Label lists every sensitivity label defined in the tenant's taxonomy, including ones an admin has disabled — a disabled label still exists in the schema (so content already tagged with it isn't broken) but is no longer offered to users or applied by any policy, so it protects nothing going forward. A disabled label sitting in the taxonomy is easy to miss precisely because it doesn't error or show up as a broken policy — it just silently stops being part of the tenant's real classification coverage, leaving a gap between what the label taxonomy claims to cover and what's actually enforced. This is the closest honest proxy available for "coverage gap" — there is no cmdlet that reports true per-document/per-site label application short of Content/Activity Explorer.$sum$,
  jsonb_build_array(
    $prq$Information Protection Admin, Sensitivity Label Administrator, Compliance Administrator, or Compliance Data Administrator role to view and re-enable labels$prq$,
    $prq$Security & Compliance PowerShell (Connect-IPPSSession) to run Get-Label$prq$,
    $prq$Confirmation of why the label was disabled in the first place (deliberate retirement/replacement vs. accidental) before re-enabling it — re-enabling a label that was intentionally retired reintroduces confusion rather than closing a gap$prq$
  ),
  $apath$Microsoft Purview portal → Information Protection → Sensitivity labels → select the disabled label → Edit label$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$List every disabled label and confirm which ones the finding is flagging:$stp$, 'code', $cod$Connect-IPPSSession
Get-Label -IncludeDetailedLabelActions | Where-Object { $_.Disabled -eq $true } | Format-Table DisplayName,Name,Guid$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$For each label that should genuinely still be available, re-enable it in the Microsoft Purview portal: Sensitivity labels → select the label → Edit label, and step back through the configuration to turn it back on. The portal's Edit label flow is the confirmed path for this — it lets you change all the label's settings, including whether it's enabled.$stp$),
    jsonb_build_object('text', $stp$If a disabled label was intentionally retired or replaced by a newer label, leave it disabled and instead document that decision — do not re-enable a label solely to close this finding without confirming it's still meant to be in active use; treat "should this label exist" as the actual decision, not the check.$stp$),
    jsonb_build_object('text', $stp$After re-enabling, confirm the label is included in the label policy that publishes it to the intended users — a re-enabled label that was also removed from its publishing policy still won't reach users.$stp$)
  ),
  $eo$Every sensitivity label the organization intends to keep using shows Disabled = False in Get-Label output and is included in a published label policy reaching its intended users; any label deliberately retired stays disabled by design, not by oversight.$eo$,
  $vs$Re-run Get-Label and confirm the previously-disabled labels intended to stay active now show Disabled = False, and spot-check that they appear as selectable in an Office app for a targeted user.$vs$,
  $vc$Get-Label | Where-Object { $_.Disabled -eq $true } | Format-Table DisplayName,Name$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/purview/get-started-with-sensitivity-labels$url$,
    $url$https://learn.microsoft.com/en-us/purview/create-sensitivity-labels$url$,
    $url$https://learn.microsoft.com/en-us/powershell/module/exchangepowershell/get-label?view=exchange-ps$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02; Security & Compliance PowerShell (ExchangePowerShell module)$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2049) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'admin_center_only',
  $note$No Microsoft Learn source consulted for this row documents a supported Set-Label parameter to toggle a label's Disabled state directly, so the actual re-enable step is authored as portal-only (admin_center_only) rather than claiming an unverified PowerShell command — only the read/detection side (Get-Label) is scripted here. This check reports label DEFINITIONS, not per-document coverage — a tenant can have zero disabled labels and still have most content unlabeled.$note$
),

-- ─────────────────────────────────────────────────────────────────────────────
-- compliance:weak-dlp-policies
-- ─────────────────────────────────────────────────────────────────────────────

(
  'compliance:weak-dlp-policies',
  $ttl$Move DLP policies out of test mode into enforcement$ttl$,
  $sum$A DLP policy whose Mode is TestWithNotifications, TestWithoutNotifications, Disable, or PendingDeletion evaluates content and can log matches, but takes no protective action — nothing is actually blocked, no policy tip stops a risky share, and no encryption or quarantine is applied. Simulation/test mode is the correct way to build and tune a new policy safely, but a policy that stays there indefinitely gives the tenant zero real data-loss prevention while creating a false sense that the risk is covered, because the policy exists and shows up in the console as "in simulation" rather than as absent.$sum$,
  jsonb_build_array(
    $prq$Compliance Administrator, Compliance Data Administrator, Security Administrator, Information Protection Admin, or DLP Compliance Management role to view/edit DLP policies$prq$,
    $prq$Prior review of the policy's simulation-mode results (Activity Explorer / simulation overview) — promoting straight to enforcement without reviewing impact risks blocking a legitimate workflow$prq$,
    $prq$Security & Compliance PowerShell (Connect-IPPSSession) if automating instead of using the portal$prq$
  ),
  $apath$Microsoft Purview portal → Data Loss Prevention → Policies → select the flagged policy → Simulate or turn on the policy$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Before enforcing, review the policy's simulation results: Microsoft Purview portal → Data Loss Prevention → Policies → select the policy → View simulation, and check the Simulation overview, Items for review, and Alerts tabs to understand what would actually be blocked/audited.$stp$),
    jsonb_build_object('text', $stp$If the impact looks correct, move the policy from simulation to enforcement in the portal: open the policy, go to the final "Simulate or turn on the policy" step, and select "Turn it on right away" (or, for a more cautious rollout, "Run the policy in simulation mode with policy tips" first to warn users before full enforcement).$stp$),
    jsonb_build_object('text', $stp$PowerShell equivalent to change an existing policy's mode directly:$stp$, 'code', $cod$Connect-IPPSSession
Set-DlpCompliancePolicy -Identity "<PolicyName>" -Mode Enable$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$After enabling, monitor DLP Alerts and Activity Explorer for the first review period to confirm the policy is enforcing as intended and not blocking a legitimate business process; tune and re-deploy if it is.$stp$)
  ),
  $eo$Get-DlpCompliancePolicy reports Mode = Enable for the policy (rather than TestWithNotifications, TestWithoutNotifications, Disable, or PendingDeletion), and Activity Explorer / DLP Alerts show real enforcement actions (blocks, encryption, policy-tip overrides) rather than only simulated matches.$eo$,
  $vs$Re-list DLP policies and confirm the flagged policy's Mode is Enable, and confirm at least one real enforcement action has occurred (or that the policy is correctly matching nothing because there's genuinely nothing to catch) since the change.$vs$,
  $vc$Get-DlpCompliancePolicy | Where-Object { $_.Mode -ne "Enable" } | Format-Table Name,Mode$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/purview/dlp-simulation-mode-get-started$url$,
    $url$https://learn.microsoft.com/en-us/purview/dlp-create-deploy-policy$url$,
    $url$https://learn.microsoft.com/en-us/powershell/module/exchangepowershell/set-dlpcompliancepolicy?view=exchange-ps$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02; Security & Compliance PowerShell (ExchangePowerShell module)$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2049) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$Activity Explorer records Policy mode as TestWithNotifyUser / TestWithoutNotifyUser / enforce (its own internal vocabulary), which is distinct from but maps to the Mode values used by Get-DlpCompliancePolicy/Set-DlpCompliancePolicy (TestWithNotifications / TestWithoutNotifications / Enable) — don't confuse the two when correlating a policy to its Activity Explorer events. Always review simulation results before enforcing; a policy that has never run in simulation should go through that step first rather than being enabled directly.$note$
),

-- ─────────────────────────────────────────────────────────────────────────────
-- compliance:zero-dlp-policies
-- ─────────────────────────────────────────────────────────────────────────────

(
  'compliance:zero-dlp-policies',
  $ttl$Deploy a baseline Data Loss Prevention policy$ttl$,
  $sum$Zero DLP policies means the tenant has no data loss prevention control at all — not a weak one, an absent one. Nothing is evaluating content for credit card numbers, health records, Social Security numbers, or any other sensitive information type as it moves through Exchange, SharePoint, OneDrive, Teams, or devices, and nothing stops or even audits a user emailing or sharing that data externally. This is structurally a more severe gap than compliance:weak-dlp-policies (which only counts policies that exist but aren't enforcing) — a tenant can score zero on this check while also scoring zero on that one, because there's nothing there to be weak.$sum$,
  jsonb_build_array(
    $prq$Compliance Administrator, Compliance Data Administrator, Security Administrator, Information Protection Admin, or DLP Compliance Management role to create a policy$prq$,
    $prq$Microsoft Purview DLP licensing for the workloads to be covered — see Microsoft 365 Enterprise plans / service descriptions for the specific SKU-to-feature mapping$prq$,
    $prq$Stakeholder input on what sensitive data actually matters to the business (financial data, health records, PII, etc.) before drafting a policy — a policy built without this tends to either miss real risk or generate excessive noise$prq$,
    $prq$Security & Compliance PowerShell (Connect-IPPSSession) if automating instead of using the portal$prq$
  ),
  $apath$Microsoft Purview portal → Data Loss Prevention → Policies → Create policy$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Identify the highest-priority category of sensitive data to protect first (e.g. financial data, health records, or a region-specific privacy-data template) rather than trying to cover everything in one policy.$stp$),
    jsonb_build_object('text', $stp$In the Microsoft Purview portal, create a policy from one of the predefined templates (Financial data, Medical and health data, Privacy data, etc.) or a custom policy built on the specific sensitive information types that matter, scoped to the locations that matter — start with Exchange/SharePoint/OneDrive/Teams before adding Devices or on-premises repositories.$stp$),
    jsonb_build_object('text', $stp$Deploy incrementally per Microsoft's own recommended path: create the policy with state "Keep it off", review with stakeholders, then "Run the policy in simulation mode" and review the impact in Activity Explorer / the simulation overview before ever turning on real enforcement — do not enable blocking actions on day one.$stp$),
    jsonb_build_object('text', $stp$PowerShell to confirm what already exists before drafting a new policy, and to confirm a new one was created:$stp$, 'code', $cod$Connect-IPPSSession
Get-DlpCompliancePolicy | Format-Table Name,Mode,Enabled$cod$, 'codeLanguage', $lng$powershell$lng$)
  ),
  $eo$At least one real DLP policy exists in the tenant (Get-DlpCompliancePolicy returns a non-empty result), initially deployed in simulation mode and then promoted to enforcement per compliance:weak-dlp-policies once its impact has been reviewed and tuned.$eo$,
  $vs$Confirm at least one DLP policy exists and that it is progressing through the deployment stages (simulation → simulation with tips → enforced) rather than sitting created-but-off indefinitely.$vs$,
  $vc$(Get-DlpCompliancePolicy).Count$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/purview/dlp-learn-about-dlp$url$,
    $url$https://learn.microsoft.com/en-us/purview/dlp-create-deploy-policy$url$,
    $url$https://learn.microsoft.com/en-us/purview/dlp-simulation-mode-get-started$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02; Security & Compliance PowerShell (ExchangePowerShell module)$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2049) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'admin_center_only',
  $note$There is no single fix command here the way there is for compliance:weak-dlp-policies' Mode change — designing a DLP policy (which sensitive info types, which locations, which actions) is a genuine per-tenant decision that has to be made in the portal (or scripted per-policy with New-DlpCompliancePolicy/New-DlpComplianceRule once the design is decided), not a blind script to run; hence admin_center_only rather than you_must_run despite PowerShell cmdlets existing for the mechanics. Mirrors identity:ca-policy-count's raw-count → eq-0 → critical pattern and its "deployment is a design decision, not a toggle" reasoning.$note$
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
VALUES ('2026-09-02-remediation-kb-compliance-domain-2049.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;

-- Verify: how many compliance: rows are published after this migration.
SELECT
  count(*) FILTER (WHERE check_key LIKE 'compliance:%') AS compliance_rows,
  count(*) FILTER (WHERE check_key LIKE 'compliance:%' AND status = 'published') AS compliance_published,
  count(*) AS total_rows
FROM remediation_knowledge_base;
