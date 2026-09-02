-- #2042 — Remediation knowledge base: the security: domain, authored & published.
--
-- Populates remediation_knowledge_base with verified "this is wrong → here is how
-- to fix it" content for EVERY active security: check (13 rows). Before this the
-- table held 29 published identity: rows (#1924) and zero security: rows, so every
-- security: finding fell through to the AI fallback.
--
-- AUTHORING STANDARD (see #1924, reused verbatim for this domain per #2042):
--   * Every row is verified against real Microsoft Learn / official Microsoft docs
--     that were actually fetched in build session #2042 (2026-09-02). The URLs in
--     source_urls are those pages.
--   * verified_by is an HONEST AGENT attribution — never a human name. The content
--     is agent-authored and awaiting a human spot-check (filed as a Shane To-Do).
--   * Tenant-specific values use angle-bracket placeholders (<UserObjectId>, …),
--     never a fabricated real value.
--   * fix_route_capability is the finding-side CEILING (#1539): you_must_run when a
--     real customer-runnable fix script is authored in a step's `code`;
--     admin_center_only when the real fix is portal-only or fundamentally a
--     human-judgment triage/tuning workflow rather than a single flip-a-setting
--     script. NEVER we_can_run here — that shape requires a live config pack
--     mapped to the check (#1925's job).
--
-- IMPLEMENTATION NOTE surfaced during authoring (also filed as a Git finding,
-- see #2042's completion comment): the live `monitor_checks` definitions for
-- several of these 13 keys are coarser than their labels suggest — e.g.
-- safe-links-coverage / safe-attachments-coverage / antiphishing-coverage /
-- automated-investigation all currently query the generic /security/alerts_v2
-- (or /security/incidents) endpoint with an `exists`/`count` transform rather
-- than genuinely inspecting SafeLinksPolicy/SafeAttachmentPolicy/AntiPhishPolicy
-- objects or AIR investigation state, and azure-roleDefinitions-compliance queries
-- ALL directory role definitions unfiltered with no severity_rules threshold at
-- all. The content below documents the REAL Microsoft feature and risk each check
-- key and label name — the thing a customer/analyst expects this finding to mean —
-- sourced from genuine Microsoft Learn docs, independent of the current check
-- query's precision. The query/label mismatch itself is a separate engineering
-- gap, out of scope for this content-authoring issue.
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
-- CLUSTER: Microsoft Secure Score
-- ─────────────────────────────────────────────────────────────────────────────

(
  'security:secure-score',
  $ttl$Raise a low Microsoft Secure Score$ttl$,
  $sum$Microsoft Secure Score is a measurement of how many of Microsoft's recommended security controls are actually configured in the tenant — it rises as real improvement actions (MFA coverage, mailbox auditing, admin role hygiene, and dozens more) are completed, not as a subjective grade. A low or declining score means a meaningful share of Microsoft's own baseline recommendations are simply not in place, which correlates directly with a wider real attack surface: every unimplemented "recommended action" is a specific, named gap Microsoft has already told the tenant how to close. Microsoft is explicit that the score "isn't an absolute measurement of how likely your system or data could be breached" — it is a completion measurement, not a guarantee, but it is the single best proxy this platform has for "how much of the documented baseline is actually done."$sum$,
  jsonb_build_array(
    $prq$Security Reader (read-only) or Security Administrator/Exchange Administrator/SharePoint Administrator (to also implement actions) — Microsoft Entra role$prq$,
    $prq$No separate license for the score itself; individual improvement actions carry their own licensing (e.g. Entra ID P1/P2 for Conditional Access actions, Defender for Office 365 for mail-protection actions)$prq$,
    $prq$Microsoft Graph PowerShell SDK (Microsoft.Graph.Security) if reading programmatically, scope SecurityEvents.Read.All$prq$
  ),
  $apath$Microsoft Defender portal → Secure score (overview tile shows current/max points; the Recommended actions tab lists and ranks the individual gaps)$apath$,
  $aurl$https://security.microsoft.com/securescore$aurl$,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Open the Defender portal's Secure score page and review the Recommended actions tab. Microsoft ranks each action "based on the number of points left to achieve, implementation difficulty, user impact, and complexity" — work the ranked list, not an arbitrary order.$stp$),
    jsonb_build_object('text', $stp$Open each action's flyout for its real prerequisites (licensing, roles) and implementation steps, then either implement it directly via the flyout's "Manage in Microsoft Defender XDR" link (which jumps straight to the real config screen for that control) or record a deliberate status: To address, Planned, Risk accepted, Resolved through third party, or Resolved through alternate mitigation.$stp$),
    jsonb_build_object('text', $stp$To pull the current score programmatically instead of the portal tile:$stp$, 'code', $cod$Connect-MgGraph -Scopes 'SecurityEvents.Read.All'
Get-MgSecuritySecureScore -Top 1 | Select-Object CurrentScore, MaxScore, ActiveUserCount, LicensedUserCount$cod$, 'codeLanguage', $lng$powershell$lng$)
  ),
  $eo$currentScore/maxScore has genuinely risen because real improvement actions were implemented (or knowingly and explicitly deferred with a recorded reason) — not because the score was chased in isolation without closing underlying gaps.$eo$,
  $vs$Re-open the Secure score page or re-query the API after the refresh window and confirm the score moved. Microsoft's own guidance: "it can take between 24-48 hours for the changes to be reflected in your secure score" (device-category actions refresh on a separate, sometimes faster, cadence via Defender Vulnerability Management exceptions).$vs$,
  $vc$Get-MgSecuritySecureScore -Top 1 | Select-Object CurrentScore, MaxScore$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/defender-xdr/microsoft-secure-score$url$,
    $url$https://learn.microsoft.com/en-us/defender-xdr/microsoft-secure-score-improvement-actions$url$,
    $url$https://learn.microsoft.com/en-us/graph/api/resources/securescore$url$,
    $url$https://learn.microsoft.com/en-us/graph/api/security-list-securescores$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02; Microsoft Graph PowerShell SDK (Microsoft.Graph.Security)$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2042) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'admin_center_only',
  $note$Secure Score itself has no single "fix" — it is a completion measurement over dozens of independent improvement actions, each with its own real config screen. Do not chase the number directly; work the ranked Recommended actions list.$note$
),

(
  'security:secure-score-by-category',
  $ttl$Address the weakest Secure Score category$ttl$,
  $sum$Secure Score is broken down into named categories — Identity, Data, Device, Apps, and Infrastructure — and a tenant can carry a healthy-looking overall score while one category sits far behind the others (e.g. strong email protection but almost no identity controls implemented). Because a single overall percentage hides that kind of imbalance, reviewing the per-category split is what actually shows which part of the tenant's security posture needs attention next — the category with the most points left on the table for the least implementation effort is usually the highest-leverage place to work.$sum$,
  jsonb_build_array(
    $prq$Security Reader (read-only) or Security Administrator (to also implement actions) — Microsoft Entra role$prq$,
    $prq$Microsoft Graph PowerShell SDK (Microsoft.Graph.Security) if reading programmatically, scope SecurityEvents.Read.All$prq$
  ),
  $apath$Microsoft Defender portal → Secure score → overview page (shows the point split across categories) and Recommended actions tab, filtered/grouped by category$apath$,
  $aurl$https://security.microsoft.com/securescore$aurl$,
  jsonb_build_array(
    jsonb_build_object('text', $stp$On the Secure score overview page, review "how points are split between these groups and what points are available" per category (Identity, Data, Device, Apps, Infrastructure).$stp$),
    jsonb_build_object('text', $stp$Filter Recommended actions to the weakest category and work the ranked list there specifically, using each action's real implementation-cost/user-impact/threats-mitigated metadata to prioritize.$stp$),
    jsonb_build_object('text', $stp$Pull the per-control breakdown programmatically to identify the exact weak controls rather than eyeballing the portal chart:$stp$, 'code', $cod$Connect-MgGraph -Scopes 'SecurityEvents.Read.All'
(Get-MgSecuritySecureScore -Top 1).ControlScores | Select-Object ControlCategory, ControlName, Score | Sort-Object ControlCategory$cod$, 'codeLanguage', $lng$powershell$lng$)
  ),
  $eo$No single category is left dramatically behind the others relative to its available points; the categories with real, high-leverage gaps (most points available for least implementation cost) have been worked first.$eo$,
  $vs$Re-run the per-control breakdown after the score's normal 24-48 hour refresh window and confirm the previously weak category's ControlScores entries now show completed/higher scores.$vs$,
  $vc$(Get-MgSecuritySecureScore -Top 1).ControlScores | Group-Object ControlCategory | Select-Object Name, Count$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/defender-xdr/microsoft-secure-score$url$,
    $url$https://learn.microsoft.com/en-us/graph/api/resources/securescorecontrolprofile$url$,
    $url$https://learn.microsoft.com/en-us/defender-xdr/microsoft-secure-score-improvement-actions$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02; Microsoft Graph PowerShell SDK (Microsoft.Graph.Security)$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2042) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'admin_center_only',
  $note$This check's own DB mapping (sourceField controlScores, transform first) captures the raw per-category distribution for display, not a scalar pass/fail — it is a breakdown surface, not itself a binary finding. Pair with security:secure-score for the headline number.$note$
),

-- ─────────────────────────────────────────────────────────────────────────────
-- CLUSTER: Microsoft Defender for Office 365 — policy coverage
-- ─────────────────────────────────────────────────────────────────────────────

(
  'security:safe-links-coverage',
  $ttl$Close Safe Links coverage gaps$ttl$,
  $sum$Safe Links rewrites URLs in email, Teams and Office apps and rescans them at time of click, catching a link that was clean when delivered but was weaponized afterward — Microsoft's own guidance is explicit that without it, "the link wasn't malicious on delivery" is exactly how a user gets phished. There is no default Safe Links policy; every recipient not explicitly covered by a Standard/Strict/custom policy instead falls back to the built-in "Built-in protection" preset, so a real coverage gap means a user or domain has been excluded from Built-in protection (or from Office/Teams protection specifically) without another policy picking them up — not simply "no policy has ever been created."$sum$,
  jsonb_build_array(
    $prq$Organization Management or Security Administrator (Email & collaboration RBAC) to create/modify policies; Global Reader/Security Reader/View-Only Organization Management to review$prq$,
    $prq$Microsoft Defender for Office 365 (Plan 1 or Plan 2)$prq$,
    $prq$Exchange Online PowerShell V3 if automating$prq$
  ),
  $apath$Microsoft Defender portal → Email & collaboration → Policies & rules → Threat policies → Safe Links$apath$,
  $aurl$https://security.microsoft.com/safelinksv2$aurl$,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Confirm who is actually excluded: review the Built-in protection preset policy's exclusions and every custom/Standard/Strict Safe Links policy's recipient scoping (users, groups, domains) side by side.$stp$, 'code', $cod$Get-SafeLinksPolicy | Select-Object Name, IsEnabled
Get-SafeLinksRule | Select-Object Name, State, RecipientDomainIs, SafeLinksPolicy$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Widen or create a policy so no recipient is left uncovered — for a simple tenant-wide fix, create one policy/rule pair scoped to every accepted domain (leaving the rule wizard's Users/Groups/Domains fields blank in the portal has the same effect):$stp$, 'code', $cod$New-SafeLinksPolicy -Name "Contoso All" -EnableSafeLinksForEmail $true -EnableSafeLinksForOffice $true -EnableSafeLinksForTeams $true -ScanUrls $true -DeliverMessageAfterScan $true -EnableForInternalSenders $true -AllowClickThrough $false
New-SafeLinksRule -Name "Contoso All" -SafeLinksPolicy "Contoso All" -RecipientDomainIs (Get-AcceptedDomain).Name$cod$, 'codeLanguage', $lng$powershell$lng$)
  ),
  $eo$Every recipient in the tenant is covered by either Built-in protection (with no unintended exclusions) or a Standard/Strict/custom Safe Links policy — Get-SafeLinksRule shows no accepted domain or user population left outside every rule's scope.$eo$,
  $vs$Re-run the policy/rule review and confirm the previously-excluded recipients now fall inside a rule's RecipientDomainIs/Users/Groups scope, or are covered by Built-in protection with no exclusion.$vs$,
  $vc$Get-SafeLinksRule | Select-Object Name, State, RecipientDomainIs, SafeLinksPolicy$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/defender-office-365/safe-links-about$url$,
    $url$https://learn.microsoft.com/en-us/defender-office-365/safe-links-policies-configure$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02; Exchange Online PowerShell V3$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2042) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$Coverage should be modeled against Built-in-protection exclusion, not raw policy absence — Built-in protection is the always-on fallback, so "no custom policy exists" is normal, not itself a gap.$note$
),

(
  'security:safe-attachments-coverage',
  $ttl$Close Safe Attachments coverage gaps$ttl$,
  $sum$Safe Attachments detonates email attachments in a virtual sandbox after anti-malware scanning but before delivery, catching malware and ransomware payloads that signature-based anti-malware alone misses. Like Safe Links, there is no default Safe Attachments policy — the always-on "Built-in protection" preset covers every recipient not otherwise defined by a Standard/Strict/custom policy — so a genuine coverage gap means someone has been excluded from Built-in protection without a replacement policy covering them, not simply that a custom policy was never created.$sum$,
  jsonb_build_array(
    $prq$Organization Management or Security Administrator (Email & collaboration RBAC) to create/modify policies; Global Reader/Security Reader/View-Only Organization Management to review$prq$,
    $prq$Microsoft Defender for Office 365 (Plan 1 or Plan 2)$prq$,
    $prq$Exchange Online PowerShell V3 if automating$prq$
  ),
  $apath$Microsoft Defender portal → Email & collaboration → Policies & rules → Threat policies → Safe Attachments$apath$,
  $aurl$https://security.microsoft.com/safeattachmentv2$aurl$,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Review current coverage — the Built-in protection preset's exclusions plus every custom/Standard/Strict Safe Attachments policy's recipient scoping:$stp$, 'code', $cod$Get-SafeAttachmentPolicy | Select-Object Name, Enable
Get-SafeAttachmentRule | Select-Object Name, State, RecipientDomainIs, SafeAttachmentPolicy$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Create or widen a policy so no recipient is left uncovered:$stp$, 'code', $cod$New-SafeAttachmentPolicy -Name "Contoso All" -Enable $true
New-SafeAttachmentRule -Name "Contoso All" -SafeAttachmentPolicy "Contoso All" -RecipientDomainIs (Get-AcceptedDomain).Name$cod$, 'codeLanguage', $lng$powershell$lng$)
  ),
  $eo$Every recipient falls under either Built-in protection (with no unintended exclusion) or a Standard/Strict/custom Safe Attachments policy — Get-SafeAttachmentRule shows no domain or user population left outside every rule's scope.$eo$,
  $vs$Re-run the policy/rule review and confirm the previously-excluded recipients are now covered by a rule's scope or by unmodified Built-in protection.$vs$,
  $vc$Get-SafeAttachmentRule | Select-Object Name, State, RecipientDomainIs, SafeAttachmentPolicy$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/defender-office-365/safe-attachments-about$url$,
    $url$https://learn.microsoft.com/en-us/defender-office-365/safe-attachments-policies-configure$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02; Exchange Online PowerShell V3$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2042) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$Same Built-in-protection-fallback caveat as security:safe-links-coverage — a coverage gap is exclusion from Built-in protection, not mere absence of a custom policy.$note$
),

(
  'security:antiphishing-coverage',
  $ttl$Extend anti-phishing impersonation protection to all users/domains$ttl$,
  $sum$Unlike Safe Links/Safe Attachments, an always-on default anti-phishing policy already covers every recipient for spoof protection and mailbox intelligence — but Microsoft's own docs state plainly that "the other available impersonation protection features... aren't configured in the default policy." Impersonation protection (user and domain impersonation, phishing-confidence thresholds) is what actually stops CEO-fraud and business-email-compromise attempts that spoof a real executive or vendor domain, and it must be explicitly turned on and scoped — a coverage gap here means specific high-value users (executives, finance, vendors) or domains have not been added to any policy's protected-senders list.$sum$,
  jsonb_build_array(
    $prq$Organization Management or Security Administrator (Email & collaboration RBAC) to create/modify policies; Global Reader/Security Reader/View-Only Organization Management to review$prq$,
    $prq$Spoof protection and mailbox intelligence are available on all cloud mailboxes at no extra license; impersonation protection and phishing-confidence thresholds require Defender for Office 365 (Plan 1 or Plan 2)$prq$,
    $prq$Exchange Online PowerShell V3 if automating$prq$
  ),
  $apath$Microsoft Defender portal → Email & collaboration → Policies & rules → Threat policies → Anti-phishing$apath$,
  $aurl$https://security.microsoft.com/antiphishing$aurl$,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Review who is actually in scope for impersonation protection today — this is the real gap to close, not "does a policy exist" (the default policy always exists):$stp$, 'code', $cod$Get-AntiPhishPolicy | Select-Object Name, EnableTargetedUserProtection, TargetedUsersToProtect, EnableTargetedDomainsProtection, TargetedDomainsToProtect, EnableOrganizationDomainsProtection
Get-AntiPhishRule | Select-Object Name, State, SentTo, SentToMemberOf, AntiPhishPolicy$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Add the missing high-value users/domains to a policy's protected-senders list (max 350 protected users and 50 protected domains per policy):$stp$, 'code', $cod$Set-AntiPhishPolicy -Identity "Office365 AntiPhish Default" -EnableTargetedUserProtection $true -TargetedUsersToProtect "Jane Doe;jdoe@contoso.com" -EnableTargetedDomainsProtection $true -TargetedDomainsToProtect "vendor.com" -EnableOrganizationDomainsProtection $true -TargetedUserProtectionAction Quarantine -TargetedDomainProtectionAction Quarantine -EnableMailboxIntelligence $true -EnableMailboxIntelligenceProtection $true$cod$, 'codeLanguage', $lng$powershell$lng$)
  ),
  $eo$Executives, finance, and other high-value users and domains are named in a policy's TargetedUsersToProtect/TargetedDomainsToProtect (or covered by EnableOrganizationDomainsProtection), with mailbox intelligence and organization-domain protection enabled — not merely relying on the default policy's spoof-only baseline.$eo$,
  $vs$Re-run the policy review and confirm the previously-uncovered users/domains now appear in a policy's protected-senders configuration with the relevant protection actions set.$vs$,
  $vc$Get-AntiPhishPolicy | Select-Object Name, TargetedUsersToProtect, TargetedDomainsToProtect$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/defender-office-365/anti-phishing-policies-about$url$,
    $url$https://learn.microsoft.com/en-us/defender-office-365/anti-phishing-policies-eop-configure$url$,
    $url$https://learn.microsoft.com/en-us/defender-office-365/anti-phishing-policies-mdo-configure$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02; Exchange Online PowerShell V3$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2042) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$The real gap for this check is impersonation-protected-senders membership, not policy existence — the default policy always exists and always covers everyone for spoof/mailbox intelligence.$note$
),

(
  'security:automated-investigation',
  $ttl$Restore Automated Investigation and Response (AIR) triage$ttl$,
  $sum$AIR in Microsoft Defender for Office 365 automatically triages high-impact, high-volume mail-based alerts (malicious email, zero-hour auto purge, user submissions, user click on a malicious link, suspicious mailbox behavior) and queues remediation actions for SecOps to approve, so analysts spend their time approving/rejecting real findings instead of manually chasing every alert. A status of "no automated investigations triggered" almost always means the underlying alert policies that launch AIR have been disabled or silently replaced by custom alert policies that never trigger it — the mail pipeline is still generating alerts, but nothing is auto-triaging them, and any remediation actions AIR would have queued are simply not happening.$sum$,
  jsonb_build_array(
    $prq$Organization Management or Security Administrator to review/restore the triggering alert policies$prq$,
    $prq$Organization Management, Security Administrator, Security Operator, Security Reader, or Global Reader plus the Search and Purge role (default in Data Investigator or Organization Management) to approve/reject queued remediation actions$prq$,
    $prq$Microsoft Defender for Office 365 Plan 2 (included in E5 or as a standalone add-on)$prq$,
    $prq$Unified audit logging enabled (on by default) — AIR depends on it$prq$
  ),
  $apath$Microsoft Defender portal → Investigations (AIR results); System → Settings → Microsoft Defender XDR → Rules → Alert tuning (to check for suppression); default alert policies under Threat management$apath$,
  $aurl$https://security.microsoft.com/airinvestigation$aurl$,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Review the default alert policies in the Threat management category and confirm the ones documented as launching AIR ("Automated investigation = Yes") are still enabled and haven't been overridden by a custom alert policy that doesn't trigger AIR.$stp$),
    jsonb_build_object('text', $stp$Check the Alert tuning page (System → Settings → Microsoft Defender XDR → Rules → Alert tuning) to confirm no built-in or custom suppression rule is silently muting the alerts that would otherwise launch an investigation.$stp$),
    jsonb_build_object('text', $stp$Once triggering is restored, review the Action Center / investigations list regularly and approve or reject the remediation actions AIR queues — malicious URL/file clusters can auto-approve, but most actions need a human sign-off before they execute.$stp$)
  ),
  $eo$AIR is genuinely launching investigations again (visible as new entries in the Investigations list following a qualifying alert), and the Action Center shows a live, actively-worked queue of pending remediation approvals rather than a stale "no investigations" state.$eo$,
  $vs$After restoring the triggering alert policies, confirm a new investigation appears in the Investigations list following the next qualifying alert (malicious email, user click, etc.), and that the Action Center is not accumulating unreviewed pending actions.$vs$,
  NULL,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/defender-office-365/air-about$url$,
    $url$https://learn.microsoft.com/en-us/defender-office-365/air-examples$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2042) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'admin_center_only',
  $note$No documented Graph/PowerShell cmdlet reads AIR investigation status directly — Microsoft's own path is the Investigations list in the portal, hence no validation_command.$note$
),

-- ─────────────────────────────────────────────────────────────────────────────
-- CLUSTER: Microsoft Defender XDR — incidents & alerts
-- ─────────────────────────────────────────────────────────────────────────────

(
  'security:open-incidents',
  $ttl$Triage and resolve open Defender XDR incidents$ttl$,
  $sum$Microsoft Defender XDR correlates alerts from Defender for Endpoint, Defender for Office 365, Defender for Identity, Defender for Cloud Apps, Entra ID Protection, and Purview DLP/Insider Risk into a single incident, so an incident represents a correlated attack story, not just a raw signal. An incident left in Active or In progress status means that story — and every alert linked to it — is sitting untriaged; it stays open until someone actually investigates and resolves it. A growing count of open incidents is a direct measure of investigative backlog, and a real compromise can be sitting inside it.$sum$,
  jsonb_build_array(
    $prq$Security Administrator (Entra role) to turn on Defender XDR; Security Reader, Global Reader, Security Operator, or Security Administrator (Defender XDR RBAC) to view/manage incidents$prq$,
    $prq$Microsoft 365 E5/A5, M365 E3 + Defender Suite add-on, or a qualifying standalone Defender product (Defender for Endpoint, Defender for Identity, Defender for Cloud Apps, Defender for Office 365 Plan 2) or Business Premium/Defender for Business$prq$,
    $prq$Microsoft Graph PowerShell SDK (Microsoft.Graph.Security) if automating, scope SecurityIncident.Read.All$prq$
  ),
  $apath$Microsoft Defender portal → Investigation & response → Incidents & alerts → Incidents$apath$,
  $aurl$https://security.microsoft.com/incidents$aurl$,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Open the Incident queue (default view already filters to New/In progress across High/Medium/Low severity — effectively "what's open right now") and sort by severity to work High first.$stp$),
    jsonb_build_object('text', $stp$Assign an owner to each open incident, work the correlated alert timeline, and take the documented remediation action for the underlying threat.$stp$),
    jsonb_build_object('text', $stp$Once resolved, open the incident's Manage incident pane and set Status = Resolved with a resolution note (this cascades to resolve every linked alert) and set Classification (True positive / Informational-expected / False positive) so it stops counting as open and the classification data improves future triage.$stp$)
  ),
  $eo$The open-incident count reflects only genuinely active, currently-being-worked investigations — no incident sits in Active/In progress status past a reasonable triage window with no assigned owner.$eo$,
  $vs$Re-query active incidents and confirm the count has genuinely dropped because incidents were investigated and resolved, not merely reclassified without remediation.$vs$,
  $vc$Get-MgSecurityIncident -Filter "status eq 'active'" | Select-Object Id, DisplayName, Severity, Status$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/defender-xdr/incident-queue$url$,
    $url$https://learn.microsoft.com/en-us/graph/api/security-list-incidents?view=graph-rest-1.0$url$,
    $url$https://learn.microsoft.com/en-us/defender-xdr/manage-incidents$url$,
    $url$https://learn.microsoft.com/en-us/defender-xdr/prerequisites$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02; Microsoft Graph PowerShell SDK (Microsoft.Graph.Security)$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2042) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'admin_center_only',
  $note$Resolving an incident is a per-incident investigative judgment call, not a scriptable toggle — Graph does expose a PATCH to update status/classification/determination, but only after real triage decides what those values should be, so this is authored admin-centre-first.$note$
),

(
  'security:alert-count-by-severity',
  $ttl$Review and clear unactioned High-severity alerts$ttl$,
  $sum$Each Defender XDR alert carries its own severity (High/Medium/Low/Informational) independent of the incident it rolls into — an incident's severity is set to the highest severity among its alerts, so an individual High alert can exist inside a lower-severity-looking incident and get missed. A count of open High-severity alerts specifically surfaces active, unactioned live threats that risk being buried under routine lower-priority noise in a busy queue; an unassigned High alert with status "new" is precisely the case of a real threat sitting unactioned.$sum$,
  jsonb_build_array(
    $prq$Security Reader, Global Reader, Security Operator, or Security Administrator (Defender XDR RBAC)$prq$,
    $prq$Same Defender XDR licensing as security:open-incidents$prq$,
    $prq$Microsoft Graph PowerShell SDK (Microsoft.Graph.Security) if automating, scope SecurityAlert.Read.All$prq$
  ),
  $apath$Microsoft Defender portal → Investigation & response → Incidents & alerts → Alerts (or the Alert severity filter on the Incident queue)$apath$,
  $aurl$https://security.microsoft.com/alerts$aurl$,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Filter the Alerts page (or the Incident queue's severity filter) to Severity = High and Status = New, and review each one individually rather than only at the incident level.$stp$),
    jsonb_build_object('text', $stp$Triage each High alert into its parent incident, assign an owner, and drive the incident (not the isolated alert) to resolution — resolving the incident resolves its linked active alerts.$stp$),
    jsonb_build_object('text', $stp$To pull the live list programmatically:$stp$, 'code', $cod$Connect-MgGraph -Scopes 'SecurityAlert.Read.All'
Get-MgSecurityAlertV2 -Filter "severity eq 'high' and status eq 'new'" | Select-Object Id, Title, Severity, Status, CreatedDateTime$cod$, 'codeLanguage', $lng$powershell$lng$)
  ),
  $eo$No High-severity alert sits in status "new"/unassigned past a reasonable triage window — every High alert has an owner and is being actively worked through its parent incident.$eo$,
  $vs$Re-run the High-severity/new filter and confirm the count has genuinely dropped because alerts were triaged and their incidents resolved, not because they were silently dismissed.$vs$,
  $vc$Get-MgSecurityAlertV2 -Filter "severity eq 'high' and status eq 'new'" | Select-Object Id, Title, Status$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/graph/api/security-list-alerts_v2?view=graph-rest-1.0$url$,
    $url$https://learn.microsoft.com/en-us/defender-xdr/incident-queue$url$,
    $url$https://learn.microsoft.com/en-us/defender-xdr/prerequisites$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02; Microsoft Graph PowerShell SDK (Microsoft.Graph.Security)$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2042) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'admin_center_only',
  $note$This check's own DB mapping currently counts total alerts with a non-null severity value (a "count" transform), not a genuine per-severity breakdown — the content above describes the real High-severity triage risk the check's label and key name — flagged in the implementation-note header of this migration.$note$
),

-- ─────────────────────────────────────────────────────────────────────────────
-- CLUSTER: Microsoft Purview — DLP & Insider Risk Management
-- ─────────────────────────────────────────────────────────────────────────────

(
  'security:dlp-violations',
  $ttl$Triage and reduce Data Loss Prevention policy violations$ttl$,
  $sum$A DLP alert fires when a policy's conditions are matched — sensitive data (SSNs, credit card numbers, health records, and similar) leaving the organization through an inappropriate channel, or a risky action like copying sensitive content to removable media. A high or growing count of violations that nobody has triaged means sensitive data is actively moving through uncontrolled paths and no one has yet determined whether each event is a real leak or a false alarm. Microsoft's own documented DLP alert lifecycle is Trigger → Notify → Triage → Investigate → Remediate → Tune — an unreviewed violation count means that lifecycle has stalled at the very first step.$sum$,
  jsonb_build_array(
    $prq$Compliance Administrator, Compliance Data Administrator, Security Administrator, Security Operator, Security Reader, Information Protection Admin, Information Protection Analyst, or Information Protection Investigator; the DLP alert dashboard specifically additionally needs the Manage alerts role plus DLP Compliance Management or View-Only DLP Compliance Management$prq$,
    $prq$Microsoft 365 E3/E5 (or Purview compliance add-on) licensing covering Data Loss Prevention$prq$
  ),
  $apath$Microsoft Purview portal → Data loss prevention → Alerts (Microsoft's current recommendation is to work these through the unified Incident queue in the Defender portal, filtered to Service Source: Data Loss Prevention, since Defender retains 6 months of history versus 30 days in the standalone Purview DLP dashboard)$apath$,
  $aurl$https://purview.microsoft.com/datalossprevention?viewid=dlpalerts$aurl$,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Open the DLP Alerts dashboard's Events tab (or the Defender Incident queue filtered to Service Source: Data Loss Prevention) and triage each unreviewed event — mark it true or false match via the Actions dropdown.$stp$),
    jsonb_build_object('text', $stp$For a confirmed true match, assign an owner and priority and work it as a real data-loss incident; for a false positive, unblock the user and note why so the policy can be tuned.$stp$),
    jsonb_build_object('text', $stp$Use Content Explorer / Activity Explorer to see exactly which condition matched and where the content went, then tune the policy's scope, conditions, actions, and notification recipients based on what the real event data shows — the documented "Tune" stage of the lifecycle.$stp$)
  ),
  $eo$The DLP Alerts (or Incident queue, Service Source = Data Loss Prevention) backlog is at or near zero unreviewed events — every recent violation has been classified true/false positive and, for true positives, worked to resolution.$eo$,
  $vs$Re-open the DLP Alerts dashboard or Incident queue filtered to Data Loss Prevention and confirm the unreviewed/new count has genuinely dropped through real triage, not through policy changes that simply stopped detecting the same activity.$vs$,
  NULL,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/purview/dlp-alert-investigation-learn$url$,
    $url$https://learn.microsoft.com/en-us/purview/dlp-alerts-dashboard-get-started$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2042) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'admin_center_only',
  $note$Get-DlpDetectionsReport (ExchangePowerShell) is documented as being retired in favor of Export-ActivityExplorerData; neither is a "fix" command, so no validation_command was authored to avoid citing a cmdlet mid-deprecation with unconfirmed parameters — triage genuinely happens in the portal.$note$
),

(
  'security:dlp-true-positive-rate',
  $ttl$Improve a low DLP true-positive rate through policy tuning$ttl$,
  $sum$A low true-positive rate means most DLP alerts turn out, on review, to be false alarms — the policy's conditions are too broad or poorly scoped. This isn't a cosmetic annoyance: every false positive an analyst has to clear trains them to move faster and look less carefully, which is exactly how a real violation eventually gets waved through unreviewed (alert fatigue). Raising the true-positive rate means the policy's Sensitive Information Type definitions and classifiers are accurate enough that a match is actually worth an analyst's attention most of the time.$sum$,
  jsonb_build_array(
    $prq$Compliance Administrator, Compliance Data Administrator, Security Administrator, or Information Protection Admin/Analyst to edit policies; Manage alerts + DLP Compliance Management to review the alert dashboard$prq$,
    $prq$Microsoft 365 E3/E5 (or Purview compliance add-on) licensing covering Data Loss Prevention$prq$
  ),
  $apath$Microsoft Purview portal → Data loss prevention → Alerts (Events tab) for classification, and → Policies for tuning conditions/exceptions$apath$,
  $aurl$https://purview.microsoft.com/datalossprevention?viewid=dlpalerts$aurl$,
  jsonb_build_array(
    jsonb_build_object('text', $stp$In the DLP Alerts dashboard's Events tab, mark each reviewed event true match or false match via the Actions dropdown — this is what the true-positive-rate calculation is actually built from, so consistent classification is the prerequisite for the metric meaning anything.$stp$),
    jsonb_build_object('text', $stp$Reduce systematic false positives by refining the Sensitive Information Types used in the policy and adopting advanced/trainable classifiers where a keyword-only SIT is over-matching, and by increasing classifier accuracy through Microsoft's documented tuning workflow.$stp$),
    jsonb_build_object('text', $stp$Add specific exceptions/scoping to the policy for legitimate business flows that are currently triggering real-but-not-actionable matches (e.g. an internal finance-to-finance transfer of the same data type), rather than lowering the policy's overall sensitivity.$stp$)
  ),
  $eo$A materially higher share of newly generated DLP alerts are classified as true matches on review, because the underlying Sensitive Information Types/classifiers and policy scoping were tightened — not because fewer alerts are being reviewed.$eo$,
  $vs$After a tuning cycle, review the Events tab's true/false classification split over a comparable time window and confirm the true-positive share has genuinely risen.$vs$,
  NULL,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/purview/dlp-alert-investigation-learn$url$,
    $url$https://learn.microsoft.com/en-us/purview/deploymentmodels/depmod-reduce-false-positives$url$,
    $url$https://learn.microsoft.com/en-us/purview/data-classification-increase-accuracy$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2042) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'admin_center_only',
  $note$No dedicated "true-positive rate" report page exists in current docs — the rate is derived from the Events tab's true/false classification of individual alerts, so remediation is genuinely a portal-tuning workflow, not a single script.$note$
),

(
  'security:insider-risk-alerts',
  $ttl$Triage open Insider Risk Management alerts$ttl$,
  $sum$Insider Risk Management's risk indicators automatically generate alerts when tenant activity matches policy conditions covering data theft by departing employees, data leaks, security-policy violations, and risky AI/browser usage. A new alert starts life with status "Needs review" — an alert left in that state means a potential case of IP theft, data leakage, fraud, or a security-policy violation is sitting uninvestigated, which is the entire risk this feature exists to catch early. A high-severity alert left unreviewed is the most urgent version of this: it means Microsoft's own risk indicators have already flagged something significant and no one has looked yet.$sum$,
  jsonb_build_array(
    $prq$Membership in one of the Insider Risk Management role groups: Insider Risk Management (all-in-one), Insider Risk Management Admins, Insider Risk Management Analysts, Insider Risk Management Investigators, Insider Risk Management Auditors, or Insider Risk Management Approvers (Analysts/Investigators are the roles that can access and investigate alerts; only Investigators get Content Explorer forensic evidence access)$prq$,
    $prq$Menu access also requires Entra Global Administrator/Compliance Administrator, or Purview Organization Management/Compliance Administrator$prq$,
    $prq$Part of Microsoft 365 E5 (or add-on) licensing; tenant must be in a geography with supported underlying Azure service dependencies$prq$
  ),
  $apath$Microsoft Purview portal → Insider Risk Management → Alerts dashboard (or the Triage Agent view) — role assignment lives under Settings → Roles and groups → Role groups$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Open the Alerts dashboard, filter to status/severity/time detected, and prioritize High-severity "Needs review" alerts first.$stp$),
    jsonb_build_object('text', $stp$Investigate each alert using the User activity report, the case's User activity chart, and Content Explorer for forensic evidence, logging findings in Case notes as you go.$stp$),
    jsonb_build_object('text', $stp$Resolve each alert by opening a new case, assigning it to an existing case, or dismissing it as not actionable — for confirmed issues, send a notice from a customizable template or escalate to eDiscovery (Premium) for legal hold/collection.$stp$)
  ),
  $eo$No alert — especially no High-severity alert — sits in "Needs review" status past a reasonable triage window; every alert has been resolved into a case, dismissed with a documented reason, or otherwise actioned.$eo$,
  $vs$Re-open the Alerts dashboard and confirm the "Needs review" backlog, particularly High-severity items, has genuinely dropped through real investigation and case action, not through blanket dismissal.$vs$,
  $vc$Get-MgSecurityAlertV2 -Filter "detectionSource eq 'microsoftInsiderRiskManagement' and status eq 'new'" | Select-Object Id, Title, Severity, Status$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/purview/insider-risk-management$url$,
    $url$https://learn.microsoft.com/en-us/purview/insider-risk-management-activities$url$,
    $url$https://learn.microsoft.com/en-us/purview/insider-risk-management-permissions$url$,
    $url$https://learn.microsoft.com/en-us/purview/insider-risk-management-plan$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02; Microsoft Graph PowerShell SDK (Microsoft.Graph.Security), matching this check's own live query filter (detectionSource eq 'microsoftInsiderRiskManagement')$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2042) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'admin_center_only',
  $note$This is the one check in the security: domain with a fully git-tracked real definition (lib/db/migrations/manual/2026-07-22-irm-alerts-monitor-check.sql): filters alerts_v2 to detectionSource='microsoftInsiderRiskManagement' and already carries real severity_rules (id_count > 0 = warning, severity_values contains high = critical). The validation_command above mirrors that real query.$note$
),

-- ─────────────────────────────────────────────────────────────────────────────
-- CLUSTER: Identity & role hygiene
-- ─────────────────────────────────────────────────────────────────────────────

(
  'security:password-protection-policy',
  $ttl$Deploy a custom banned password list (and on-premises enforcement)$ttl$,
  $sum$Microsoft Entra Password Protection checks every password change/reset against a global, Microsoft-curated banned password list — free on every tenant and impossible to disable — but a tenant without a configured custom banned password list is still allowing employees to set passwords built from the company name, product names, or local landmarks (e.g. "Contoso2026!"), which is exactly the class of guessable password that survives Microsoft's generic global list. Password Protection normalizes input (lowercase, leetspeak substitution) and fuzzy-matches with edit distance 1 against both lists, so a well-populated custom list meaningfully raises the bar against the tenant's own most predictable passwords — and for hybrid tenants, without the on-premises agents deployed, the same weak passwords remain settable through on-prem Active Directory entirely outside the cloud check.$sum$,
  jsonb_build_array(
    $prq$Global Administrator to register the on-premises Password Protection proxy the first time in the tenant; Security Administrator for subsequent proxy/forest registrations$prq$,
    $prq$On-premises Enterprise Administrator privileges plus local admin rights on the machine running Register-AzureADPasswordProtectionForest, for hybrid deployments$prq$,
    $prq$Custom banned password list: Microsoft Entra ID P1 or P2 required for BOTH cloud-only and hybrid users; the global list alone is free on Entra ID Free$prq$
  ),
  $apath$Microsoft Entra admin center → Protection → Authentication methods → Password protection (custom banned password list); on-premises agents are deployed and managed via the AzureADPasswordProtection PowerShell module on the DC/proxy servers$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$In the Entra admin center, populate the custom banned password list with the organization's real brand, product, and location terms (not literal example passwords) — up to 1,000 entries, combined automatically with the global list.$stp$),
    jsonb_build_object('text', $stp$For a hybrid tenant, deploy the on-premises DC agent and proxy so the same protection applies to on-prem AD password changes — start in Audit mode (logs would-be blocks without enforcing) before switching to Enforce:$stp$, 'code', $cod$Import-Module AzureADPasswordProtection
Register-AzureADPasswordProtectionProxy -AccountUpn '<GlobalAdminUpn>'
Register-AzureADPasswordProtectionForest -AccountUpn '<GlobalAdminUpn>'
Test-AzureADPasswordProtectionProxyHealth -TestAll$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Confirm DC agents are installed and current, then move on-prem enforcement from Audit to Enforce once validated:$stp$, 'code', $cod$Get-AzureADPasswordProtectionDCAgent
Get-AzureADPasswordProtectionProxy$cod$, 'codeLanguage', $lng$powershell$lng$)
  ),
  $eo$A populated custom banned password list is enforced tenant-wide, and — for hybrid tenants — on-premises DC agents are installed, current, and running in Enforce (not Audit) mode.$eo$,
  $vs$Confirm DC agent installation/version and health, and that Enforce mode is active rather than Audit, before relying on this control for on-premises password changes.$vs$,
  $vc$Get-AzureADPasswordProtectionDCAgent$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/entra/identity/authentication/concept-password-ban-bad$url$,
    $url$https://learn.microsoft.com/en-us/entra/identity/authentication/howto-password-ban-bad-on-premises-deploy$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02; AzureADPasswordProtection PowerShell module$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2042) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$Custom banned list CONTENT is edited in the admin center, not PowerShell — the PowerShell steps above cover the real scriptable piece (on-premises agent deployment/health), which is where hybrid tenants most often have a genuine gap.$note$
),

(
  'security:azure-roleDefinitions-compliance',
  $ttl$Review custom Microsoft Entra directory role definitions for excessive privilege$ttl$,
  $sum$Microsoft Entra ID ships over 65 built-in directory roles, and any organization can also define its own custom roles when a built-in role is too broad or too narrow for a specific job function. A custom role definition that grants a privileged permission — one able to delegate management of directory resources, modify credentials, change authentication/authorization policy, or read restricted data, such as an "allProperties/allTasks" grant on a sensitive resource — can function as a hidden path to Global-Administrator-equivalent power, entirely outside the visibility that comes from watching the well-known built-in admin roles. Microsoft's own guidance is to regularly audit custom role definitions against the principle of least privilege rather than assume "custom" means "safe": a role is only as narrow as the permissions actually written into it.$sum$,
  jsonb_build_array(
    $prq$Global Reader, Privileged Role Administrator, or Directory Readers to review role definitions (least-privilege real roles for this read, per Microsoft Graph's own documented least-privileged-role list)$prq$,
    $prq$Privileged Role Administrator (or Global Administrator) to actually edit or remove an over-permissioned custom role$prq$,
    $prq$Microsoft Graph PowerShell SDK (Microsoft.Graph.Identity.Governance) — the isPrivileged flag on role definitions is exposed only via the beta Graph endpoint/cmdlets as of this writing, not v1.0$prq$
  ),
  $apath$Microsoft Entra admin center → Roles & admins → All roles (filter to custom roles; the PRIVILEGED label and Assignments count are shown per role; a "5+ Global Administrators" and "10+ privileged role assignments" warning surface automatically on this page)$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$List every custom (non-built-in) role definition in the tenant and check which ones carry privileged permissions:$stp$, 'code', $cod$Connect-MgGraph -Scopes 'RoleManagement.Read.Directory'
Get-MgBetaRoleManagementDirectoryRoleDefinition -Filter "isBuiltIn eq false" | Format-List DisplayName, Description, IsPrivileged, RolePermissions$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$For any custom role flagged IsPrivileged, inspect its RolePermissions.AllowedResourceActions for especially dangerous grants — anything ending in /allProperties/allTasks on a sensitive resource namespace (applications, authorizationPolicy, roleAssignments) is the pattern Microsoft's own docs call out as elevation-of-privilege risk — and narrow the role to only the specific actions the job function actually needs.$stp$),
    jsonb_build_object('text', $stp$Apply the same layered hygiene Microsoft recommends for ALL privileged roles, built-in or custom: assign via Privileged Identity Management for just-in-time activation rather than standing assignment, require MFA to activate, keep Global Administrator assignments under 5 and total privileged role assignments under 10, and set up a recurring access review so unneeded assignments are revoked automatically over time.$stp$)
  ),
  $eo$No custom role definition grants a privileged permission wider than the job function it was created for; privileged role assignments (built-in and custom) are time-bound via PIM rather than standing, Global Administrator count is under 5, and total privileged role assignments are under 10 — the levels the Entra admin center itself warns against exceeding.$eo$,
  $vs$Re-run the custom-role review and confirm each previously over-permissioned role's RolePermissions have been narrowed, and that the Roles and administrators page no longer shows the Global Administrator or privileged-role-assignment warning banners.$vs$,
  $vc$Get-MgBetaRoleManagementDirectoryRoleDefinition -Filter "isPrivileged eq true" | Where-Object { $_.IsBuiltIn -eq $false } | Select-Object DisplayName, Description$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/best-practices$url$,
    $url$https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/privileged-roles-permissions$url$,
    $url$https://learn.microsoft.com/en-us/graph/api/rbacapplication-list-roledefinitions?view=graph-rest-1.0$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02; Microsoft Graph PowerShell SDK Beta (Microsoft.Graph.Beta.Identity.Governance)$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2042) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'admin_center_only',
  $note$Real implementation gap (see this migration's header and #2042's completion comment): the live check queries GET /roleManagement/directory/roleDefinitions completely unfiltered (all built-in + custom, properties=["id"] only) with empty severity_rules — it currently just counts total role definitions and never scopes to "Compliance Administrator" as its label implies, and has no threshold that would ever fire a finding. Content above documents the real, actionable Entra concept ("Compliance Admin"/privileged custom-role review) this check's key and label point at; isPrivileged filtering requires the beta Graph endpoint, not v1.0.$note$
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
VALUES ('2026-09-02-remediation-kb-security-domain-2042.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;

-- Verify: how many security: rows are published after this migration.
SELECT
  count(*) FILTER (WHERE check_key LIKE 'security:%') AS security_rows,
  count(*) FILTER (WHERE check_key LIKE 'security:%' AND status = 'published') AS security_published,
  count(*) AS total_rows
FROM remediation_knowledge_base;
