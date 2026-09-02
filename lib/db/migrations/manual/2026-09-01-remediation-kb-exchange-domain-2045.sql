-- #2045 — Remediation knowledge base: the exchange: domain, authored & published.
--
-- Populates remediation_knowledge_base with verified "this is wrong → here is how
-- to fix it" content for EVERY active exchange: check (11 rows). Follows the
-- authoring standard set on #1924 (identity: domain, 29 rows,
-- 2026-08-31-remediation-kb-identity-domain-1924.sql) — do not diverge from it.
--
-- AUTHORING STANDARD (see #1924, applied here for exchange:):
--   * Every row is verified against real Microsoft Learn / official Microsoft docs
--     that were actually fetched in build session #2045 (2026-09-01). The URLs in
--     source_urls are those pages.
--   * verified_by is an HONEST AGENT attribution — never a human name. The content
--     is agent-authored and awaiting a human spot-check.
--   * Tenant-specific values use angle-bracket placeholders (<UserPrincipalName>, …),
--     never a fabricated real value.
--   * fix_route_capability is the finding-side CEILING (#1539): you_must_run when a
--     real customer-runnable fix script is authored in a step's `code`;
--     admin_center_only when the real fix is portal/DNS-only or a script cannot
--     safely automate it. NEVER we_can_run here — that shape requires a live config
--     pack mapped to the check (#1925's job).
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
(
  'exchange:antispam-policy-coverage',
  $ttl$Cover all recipients with a non-default anti-spam policy$ttl$,
  $sum$Only the built-in default anti-spam policy applies tenant-wide, and it uses conservative baseline thresholds that were never tuned for this tenant's real mail patterns. Without a custom (or preset Standard/Strict) policy layered on top, high-risk groups such as executives or finance can't get stricter bulk-mail and spam-confidence thresholds than the rest of the org, and there's no policy-level visibility into which recipients are actually protected versus riding on defaults alone. Spam that lands in an inbox is a direct path to a phishing click or a wire-fraud reply.$sum$,
  jsonb_build_array(
    $prq$Membership in the Organization Management or Security Administrator role group (to create/modify policies) — Global Reader or Security Reader for read-only review$prq$,
    $prq$Microsoft Defender for Office 365 (EOP is included in every Exchange Online mailbox; Standard/Strict preset policies require at minimum EOP, already present)$prq$,
    $prq$Exchange Online PowerShell (Exchange Online Management module) if automating$prq$
  ),
  $apath$Microsoft Defender portal → Email & collaboration → Policies & rules → Threat policies → Anti-spam$apath$,
  $aurl$https://security.microsoft.com/antispam$aurl$,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Review current coverage: in the Defender portal, open the Anti-spam policies list and confirm whether any policy besides "Anti-spam inbound policy (Default)" is On and applied to real recipients — a bare tenant only has the default (Status: Always on) with no custom policy layered on top.$stp$),
    jsonb_build_object('text', $stp$Preferred path — turn on the Standard preset security policy and assign it to all recipients (or at minimum high-risk groups); it ships Microsoft-maintained anti-spam thresholds that are kept current, instead of hand-maintained custom settings.$stp$),
    jsonb_build_object('text', $stp$Alternative — create a custom inbound anti-spam policy and rule scoped to the recipients that need it (e.g. an executives group), in Exchange Online PowerShell:$stp$, 'code', $cod$Connect-ExchangeOnline
New-HostedContentFilterPolicy -Name "<PolicyName>" -HighConfidenceSpamAction Quarantine -SpamAction Quarantine -BulkThreshold 6
New-HostedContentFilterRule -Name "<PolicyName>" -HostedContentFilterPolicy "<PolicyName>" -SentToMemberOf "<GroupName>"$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Confirm the new rule is enabled and correctly scoped:$stp$, 'code', $cod$Get-HostedContentFilterRule -Identity "<PolicyName>" | Format-List Name,State,Priority,SentToMemberOf$cod$, 'codeLanguage', $lng$powershell$lng$)
  ),
  $eo$Every recipient is covered by at least one enabled anti-spam policy beyond the always-on default — either the Standard/Strict preset security policy or a scoped custom policy — with thresholds appropriate to their risk level.$eo$,
  $vs$Re-run the anti-spam policy list and confirm the target recipients fall under an enabled, non-default policy; verify a test bulk-mail message is actioned per the new policy's Bulk complaint level threshold rather than the default.$vs$,
  $vc$Get-HostedContentFilterRule | Where-Object {$_.State -eq 'Enabled'} | Format-Table Name,Priority,SentToMemberOf$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/defender-office-365/anti-spam-policies-configure$url$,
    $url$https://learn.microsoft.com/en-us/defender-office-365/anti-spam-protection-about$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-01; Exchange Online PowerShell (ExchangeOnlineManagement)$vag$,
  '2026-09-01'::timestamptz,
  $vby$Claude Sonnet 5 (build #2045) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$Turning on Standard/Strict preset policies is the Microsoft-recommended path over hand-built custom policies (they're kept current by Microsoft); the PowerShell here targets the custom-policy alternative for tenants that need scoped, non-preset thresholds.$note$
),

-- ─────────────────────────────────────────────────────────────────────────────
(
  'exchange:archive-mailbox-rate',
  $ttl$Enable archive mailboxes to prevent primary mailbox overflow and data loss$ttl$,
  $sum$A mailbox without an enabled archive has nowhere for the retention policy to move aging items, so it either grows unchecked toward its send/receive quota (risking a hard mail stoppage) or users are forced to manually delete old mail to stay under quota — permanently destroying data that might later be needed for compliance or a legal hold. Low archive enablement across the tenant means storage and eDiscovery risk is concentrated in a small number of primary mailboxes with no safety valve.$sum$,
  jsonb_build_array(
    $prq$Mail Recipients role in Exchange Online (assigned via Recipient Management or Organization Management role group) to enable/disable archives$prq$,
    $prq$Exchange Online Plan 2, or Plan 1 with the Exchange Online Archiving add-on, for each mailbox to be archived$prq$,
    $prq$Exchange Online PowerShell to bulk-enable across the tenant$prq$
  ),
  $apath$Exchange admin center → Recipients → Mailboxes → select user → Others → Mailbox archive → Manage mailbox archive$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Identify mailboxes with no archive and no previously-disabled archive still pending reconnection:$stp$, 'code', $cod$Get-Mailbox -Filter {ArchiveGuid -Eq "00000000-0000-0000-0000-000000000000" -AND DisabledArchiveGuid -Eq "00000000-0000-0000-0000-000000000000" -AND RecipientTypeDetails -Eq "UserMailbox"}$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Enable the archive for a single user, or pipe the filtered set above to enable in bulk:$stp$, 'code', $cod$Enable-Mailbox -Identity <UserPrincipalName> -Archive

# Bulk, for every eligible mailbox:
Get-Mailbox -Filter {ArchiveGuid -Eq "00000000-0000-0000-0000-000000000000" -AND DisabledArchiveGuid -Eq "00000000-0000-0000-0000-000000000000" -AND RecipientTypeDetails -Eq "UserMailbox"} | Enable-Mailbox -Archive$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Optionally, have new mailboxes auto-provision an archive once they hit 90% of quota, so this doesn't need to be repeated for every new hire:$stp$, 'code', $cod$Set-OrganizationConfig -AutoEnableArchiveMailbox $true$cod$, 'codeLanguage', $lng$powershell$lng$)
  ),
  $eo$Eligible user mailboxes show Archive status = Active, and items older than the assigned archive policy (default: 2 years) are moved automatically to the archive rather than accumulating in — or being manually deleted from — the primary mailbox.$eo$,
  $vs$Re-run the eligibility filter and confirm the count of un-archived eligible mailboxes has dropped to the expected residual (e.g. mailboxes intentionally excluded); spot-check one enabled mailbox for Archive status = Active.$vs$,
  $vc$Get-Mailbox -ResultSize Unlimited -Filter "RecipientTypeDetails -eq 'UserMailbox'" | Get-MailboxStatistics -Archive | Where-Object {$_.DisplayName} | Select-Object DisplayName,TotalItemSize$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/purview/enable-archive-mailboxes$url$,
    $url$https://learn.microsoft.com/en-us/purview/archive-mailboxes$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-01; Exchange Online PowerShell (ExchangeOnlineManagement)$vag$,
  '2026-09-01'::timestamptz,
  $vby$Claude Sonnet 5 (build #2045) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$If an archive was previously disabled more than 30 days ago, Enable-Mailbox -Archive fails until Set-Mailbox -RemoveDisabledArchive is run first — the migration/remediation copy doesn't cover that edge case since it requires per-mailbox judgment (the disabled archive's contents are being discarded).$note$
),

-- ─────────────────────────────────────────────────────────────────────────────
(
  'exchange:auto-forwarding-rules',
  $ttl$Eliminate external auto-forwarding rules on mailboxes$ttl$,
  $sum$A mailbox rule or SMTP forwarding configuration that silently copies incoming mail to an external address is one of the most common indicators of a compromised account — an attacker who phishes a password sets up forwarding to keep reading mail (invoices, password resets, internal threads) even after the victim changes their password. Legitimate business need for external forwarding is rare and should be an explicit, reviewed exception, not a silent default.$sum$,
  jsonb_build_array(
    $prq$Security Administrator or Organization Management role group membership to set the outbound spam policy setting$prq$,
    $prq$Reports Reader or Security Reader to review the Auto forwarded messages report and audit logs$prq$,
    $prq$Exchange Online PowerShell (Exchange Online Management module)$prq$
  ),
  $apath$Microsoft Defender portal → Email & collaboration → Policies & rules → Threat policies → Anti-spam → Anti-spam outbound policy (Default) → Protection settings → Automatic forwarding rules$apath$,
  $aurl$https://security.microsoft.com/antispam$aurl$,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Find mailboxes currently forwarding externally today, via mailbox-level SMTP forwarding:$stp$, 'code', $cod$Get-Mailbox -ResultSize Unlimited | Where-Object {$_.ForwardingSmtpAddress -ne $null -or $_.ForwardingAddress -ne $null} | Select-Object DisplayName,ForwardingSmtpAddress,ForwardingAddress,DeliverToMailboxAndForward$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Review the Auto forwarded messages report in the Exchange admin center (Reports → Mail flow) to see Inbox-rule-based external forwarding that mailbox-level properties don't capture, then set the outbound spam filter policy to block external auto-forwarding tenant-wide:$stp$, 'code', $cod$Set-HostedOutboundSpamFilterPolicy -Identity Default -AutoForwardingMode Off$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Remove any external forwarding found on a specific mailbox that isn't an approved exception:$stp$, 'code', $cod$Set-Mailbox -Identity <UserPrincipalName> -ForwardingSmtpAddress $null -ForwardingAddress $null$cod$, 'codeLanguage', $lng$powershell$lng$)
  ),
  $eo$AutoForwardingMode is Off on the default (and any custom) outbound spam policy, so new automatic external forwarding — Inbox rule or SMTP forwarding — is blocked with an NDR, and no mailbox has an unexplained external ForwardingSmtpAddress/ForwardingAddress configured.$eo$,
  $vs$Re-run the forwarding-property query and confirm zero unexplained external forwards remain; confirm AutoForwardingMode reads Off on the outbound spam policy.$vs$,
  $vc$Get-HostedOutboundSpamFilterPolicy -Identity Default | Format-List Name,AutoForwardingMode$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/defender-office-365/outbound-spam-policies-external-email-forwarding$url$,
    $url$https://learn.microsoft.com/en-us/defender-office-365/outbound-spam-policies-configure$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-01; Exchange Online PowerShell (ExchangeOnlineManagement)$vag$,
  '2026-09-01'::timestamptz,
  $vby$Claude Sonnet 5 (build #2045) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$Blocking external auto-forward at the outbound spam policy also disables legitimate Inbox-rule and SMTP forwarding for everyone — confirm no genuine business need exists (or carve out an explicit exception) before enforcing tenant-wide.$note$
),

-- ─────────────────────────────────────────────────────────────────────────────
(
  'exchange:connector-health',
  $ttl$Fix misconfigured or unvalidated inbound/outbound mail flow connectors$ttl$,
  $sum$A connector that's turned on but was never validated, or that no longer matches how mail actually flows (a stale on-premises hybrid connector, or a partner connector with an expired certificate/hostname), causes silent mail flow failures — messages queue, bounce, or take an unintended (unencrypted) path to a partner. Because connector problems don't surface until affected mail actually needs to flow, they're commonly invisible until an urgent message fails to deliver.$sum$,
  jsonb_build_array(
    $prq$Organization Management role group membership, or a custom role including the Mail Flow Configuration role, to view and edit connectors$prq$,
    $prq$Exchange Online PowerShell (Exchange Online Management module)$prq$,
    $prq$For validation: a live mailbox on the receiving end of the connector to send a real test message to$prq$
  ),
  $apath$Exchange admin center → Mail flow → Connectors$apath$,
  $aurl$https://admin.exchange.microsoft.com/#/connectors$aurl$,
  jsonb_build_array(
    jsonb_build_object('text', $stp$List every inbound and outbound connector and their current state:$stp$, 'code', $cod$Get-InboundConnector | Format-Table Name,Enabled,SenderDomains,SenderIPAddresses
Get-OutboundConnector | Format-Table Name,Enabled,RecipientDomains,SmartHosts,TlsSettings$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$In the Exchange admin center, open each connector's details and use "Validate this connector," supplying a real mailbox address on the far end — this tests SMTP connectivity to each configured smart host and confirms a test message is actually delivered.$stp$),
    jsonb_build_object('text', $stp$Equivalently in PowerShell, validate an outbound connector directly (tests connectivity to all configured smart hosts and sends a test message to the specified recipients):$stp$, 'code', $cod$Validate-OutboundConnector -Identity "<ConnectorName>" -Recipients "<TestRecipient@partnerdomain.com>"$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$For any connector that's Enabled but failed validation, or that's configured for a partner relationship that no longer exists, either fix the smart host/certificate/domain match and re-validate, or disable it so mail doesn't silently attempt a broken path:$stp$, 'code', $cod$Set-OutboundConnector -Identity "<ConnectorName>" -Enabled $false$cod$, 'codeLanguage', $lng$powershell$lng$)
  ),
  $eo$Every enabled connector passes validation (SMTP connectivity confirmed, test message delivered), and any connector for a relationship that no longer exists is disabled rather than left enabled and silently failing.$eo$,
  $vs$Re-run Validate-OutboundConnector (or the EAC's Validate this connector action) against each enabled connector and confirm a passing result with no errors.$vs$,
  $vc$Get-InboundConnector | Where-Object {$_.Enabled -eq $true} | Format-Table Name,ConnectorSource
Get-OutboundConnector | Where-Object {$_.Enabled -eq $true} | Format-Table Name,ConnectorType$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/exchange/mail-flow-best-practices/use-connectors-to-configure-mail-flow/validate-connectors$url$,
    $url$https://learn.microsoft.com/en-us/exchange/mail-flow-best-practices/use-connectors-to-configure-mail-flow/use-connectors-to-configure-mail-flow$url$,
    $url$https://learn.microsoft.com/en-us/powershell/module/exchangepowershell/validate-outboundconnector?view=exchange-ps$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-01; Exchange Online PowerShell (ExchangeOnlineManagement)$vag$,
  '2026-09-01'::timestamptz,
  $vby$Claude Sonnet 5 (build #2045) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$There's no PowerShell equivalent for validating an INBOUND connector — inbound connector correctness is verified indirectly, by confirming inbound mail from the expected source IP/domain arrives and passes the expected authentication (SPF/connector-based trust), not via a dedicated Test-/Validate- cmdlet.$note$
),

-- ─────────────────────────────────────────────────────────────────────────────
(
  'exchange:distribution-list-count',
  $ttl$Bring distribution list sprawl under governance$ttl$,
  $sum$An unbounded, ungoverned count of distribution lists is a standing risk multiplier rather than a single misconfiguration: every list is a mail-enabled target an attacker can mass-target for phishing, every list with open (unmoderated) joining lets anyone add themselves to a list they shouldn't reach, and stale lists nobody owns anymore quietly keep former employees' replacement addresses or defunct groups reachable. A high or fast-growing count with no naming policy or ownership review is the leading indicator that group sprawl, not a single bad list, is the actual finding.$sum$,
  jsonb_build_array(
    $prq$Recipients permission in Exchange Online (Recipient Management or Organization Management role group) to read and manage groups$prq$,
    $prq$Exchange Online PowerShell (Exchange Online Management module) to enumerate at scale$prq$
  ),
  $apath$Exchange admin center → Recipients → Groups → Distribution list$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Inventory every distribution list and its ownership/membership size — a list with zero owners or with membership that hasn't changed in years is a governance flag, not just a count:$stp$, 'code', $cod$Get-DistributionGroup -ResultSize Unlimited | Select-Object Name,PrimarySmtpAddress,ManagedBy,WhenCreated | Sort-Object WhenCreated$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$For each list, confirm it has at least one real owner and a sane join/leave policy — closed or owner-approval, not open, unless the list is genuinely intended for self-service sign-up:$stp$, 'code', $cod$Set-DistributionGroup -Identity "<GroupName>" -ManagedBy "<OwnerUPN>" -MemberJoinRestriction ApprovalRequired$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Establish a naming policy so future group sprawl is self-documenting (prefix/suffix conventions make orphaned or duplicate lists easy to spot at a glance) — configured tenant-wide in the Microsoft 365 admin center's group naming policy settings, not per-list.$stp$),
    jsonb_build_object('text', $stp$Remove distribution lists confirmed to be genuinely unused (no owner reachable, no mail sent to it in the retrievable mail flow history, membership that duplicates another list):$stp$, 'code', $cod$Remove-DistributionGroup -Identity "<GroupName>"$cod$, 'codeLanguage', $lng$powershell$lng$)
  ),
  $eo$Every distribution list has a real, reachable owner and an appropriate join policy; lists confirmed unused are removed; a naming policy is in place so new sprawl is visible going forward rather than accumulating silently.$eo$,
  $vs$Re-run the inventory and confirm every list shows a non-empty ManagedBy value, and that the total count has stopped growing without a corresponding new owner being assigned.$vs$,
  $vc$Get-DistributionGroup -ResultSize Unlimited | Where-Object {-not $_.ManagedBy} | Select-Object Name,PrimarySmtpAddress$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/exchange/recipients-in-exchange-online/manage-distribution-groups/manage-distribution-groups$url$,
    $url$https://learn.microsoft.com/en-us/exchange/recipients-in-exchange-online/create-and-manage-groups$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-01; Exchange Online PowerShell (ExchangeOnlineManagement)$vag$,
  '2026-09-01'::timestamptz,
  $vby$Claude Sonnet 5 (build #2045) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$"Total distribution lists configured" is an inventory metric with no universal good/bad threshold — the actionable finding is ownerless/unmoderated/stale lists within that count, which is what the remediation steps target rather than an arbitrary count ceiling.$note$
),

-- ─────────────────────────────────────────────────────────────────────────────
(
  'exchange:dkim-spf-dmarc-status',
  $ttl$Complete SPF, DKIM, and DMARC email authentication for every custom domain$ttl$,
  $sum$SPF, DKIM, and DMARC are interdependent — SPF alone doesn't stop a spoofed From address, DKIM alone doesn't tell receivers what to do about failures, and DMARC without SPF/DKIM aligned underneath it has nothing to evaluate. A domain missing any one of the three lets attackers send convincing look-alike phishing "from" this organization's own domain straight into partners' and customers' inboxes, damaging deliverability and trust even though the tenant's own mailboxes were never touched.$sum$,
  jsonb_build_array(
    $prq$Access to DNS for every custom domain used for mail (at the domain registrar / DNS host) — there is no Microsoft 365 portal or PowerShell path to publish SPF/DMARC records, they're DNS-only$prq$,
    $prq$Global Administrator or Domain Name Administrator (Entra ID) to view/enable DKIM in the Defender portal, or Security Administrator$prq$,
    $prq$Exchange Online PowerShell (Exchange Online Management module) to inspect current DKIM configuration$prq$
  ),
  $apath$Microsoft Defender portal → Email & collaboration → Policies & rules → Threat policies → Email authentication settings → DKIM$apath$,
  $aurl$https://security.microsoft.com/authentication?viewid=DKIM$aurl$,
  jsonb_build_array(
    jsonb_build_object('text', $stp$SPF — publish one TXT record per custom domain identifying Microsoft 365 as an authorized source, ending in a hard fail (there are no PowerShell/portal cmdlets for this; it's created directly at the DNS host):$stp$, 'code', $cod$Hostname: @ (root of the domain)
TXT value: v=spf1 include:spf.protection.outlook.com -all$cod$, 'codeLanguage', $lng$text$lng$),
    jsonb_build_object('text', $stp$DKIM — check current signing status for all domains, then enable it for any domain that isn't already signing:$stp$, 'code', $cod$Get-DkimSigningConfig | Format-List Domain,Enabled,Status,Selector1CNAME,Selector2CNAME$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$For a domain with no DKIM config yet, create it disabled first (so you get the two required CNAME values to publish), publish both CNAMEs at the DNS host, then enable signing:$stp$, 'code', $cod$New-DkimSigningConfig -DomainName <Domain> -Enabled $false
# publish the two selector1/selector2 CNAME records this returns at the DNS host, then:
Set-DkimSigningConfig -Identity <Domain> -Enabled $true$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$DMARC — once SPF and DKIM are both live and aligned to the domain, publish a DMARC TXT record. Start at p=none to monitor, then move to p=quarantine and finally p=reject once reports show no legitimate mail is failing (there are no PowerShell/portal cmdlets for custom domains; it's DNS-only):$stp$, 'code', $cod$Hostname: _dmarc
TXT value: v=DMARC1; p=reject; pct=100; rua=mailto:dmarc-reports@<Domain>$cod$, 'codeLanguage', $lng$text$lng$)
  ),
  $eo$Every custom sending domain has a valid SPF TXT record ending in -all, DKIM signing Enabled with both CNAME selectors resolving, and a DMARC TXT record at p=reject (having been rolled through none → quarantine → reject) with an rua reporting address that's actually monitored.$eo$,
  $vs$Query DNS directly for each domain's SPF and DMARC records, and re-run Get-DkimSigningConfig to confirm Status is not "CnameMissing"; send a real test message and inspect the Authentication-Results header for spf=pass, dkim=pass, dmarc=pass.$vs$,
  $vc$Get-DkimSigningConfig | Where-Object {$_.Enabled -eq $false -or $_.Status -eq 'CnameMissing'} | Format-Table Domain,Status$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/defender-office-365/email-authentication-spf-configure$url$,
    $url$https://learn.microsoft.com/en-us/defender-office-365/email-authentication-dkim-configure$url$,
    $url$https://learn.microsoft.com/en-us/defender-office-365/email-authentication-dmarc-configure$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-01; Exchange Online PowerShell (ExchangeOnlineManagement)$vag$,
  '2026-09-01'::timestamptz,
  $vby$Claude Sonnet 5 (build #2045) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$*.onmicrosoft.com domains already have SPF and DKIM configured by Microsoft by default but still need their own explicit DMARC TXT record published in the Microsoft 365 admin center — DMARC is never auto-configured, even for the default domain.$note$
),

-- ─────────────────────────────────────────────────────────────────────────────
(
  'exchange:litigation-hold-coverage',
  $ttl$Enable litigation hold on mailboxes that need preservation$ttl$,
  $sum$A mailbox without litigation hold lets its owner (or an attacker who has compromised the account) permanently delete mail — including items that might be the only copy of evidence needed for a legal dispute, a compliance investigation, or an HR matter. Once purged past the Recoverable Items retention window, that content is gone; hold has to be in place *before* the need arises, since it can't retroactively preserve what was already purged.$sum$,
  jsonb_build_array(
    $prq$Legal Hold permission (assigned via the Organization Management or Records Management role group) — see Exchange Server messaging policy and compliance permissions$prq$,
    $prq$Exchange Online Plan 2, or Plan 1 with the Exchange Online Archiving add-on, for every mailbox placed on hold (Plan 1 alone cannot hold)$prq$,
    $prq$Exchange Online PowerShell (Exchange Online Management module)$prq$
  ),
  $apath$Exchange admin center → Recipients → Mailboxes → select user → Mailbox features → Litigation hold: Disabled → Enable$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Identify which mailboxes should be on hold per policy (legal/regulatory requirement, litigation, or blanket organizational retention) versus which are already covered:$stp$, 'code', $cod$Get-Mailbox -ResultSize Unlimited -Filter "RecipientTypeDetails -eq 'UserMailbox'" | Format-List Name,LitigationHoldEnabled,LitigationHoldDuration$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Place a single mailbox on indefinite hold, or a specified retention period in days:$stp$, 'code', $cod$Set-Mailbox <UserPrincipalName> -LitigationHoldEnabled $true

# or, to preserve for a specific period (e.g. 7 years):
Set-Mailbox <UserPrincipalName> -LitigationHoldEnabled $true -LitigationHoldDuration 2555$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$For an organization-wide preservation requirement, place every user mailbox on hold in one pass (repeat periodically, since only mailboxes that exist when the command runs are covered):$stp$, 'code', $cod$Get-Mailbox -ResultSize Unlimited -Filter "RecipientTypeDetails -eq 'UserMailbox'" | Set-Mailbox -LitigationHoldEnabled $true$cod$, 'codeLanguage', $lng$powershell$lng$)
  ),
  $eo$Every mailbox that's in scope for a legal, regulatory, or organizational preservation requirement shows LitigationHoldEnabled = True, with the archive mailbox (if present) automatically covered by the same hold.$eo$,
  $vs$Re-run the LitigationHoldEnabled query across all in-scope mailboxes and confirm no gaps; note the setting can take up to 60 minutes to take effect after being enabled.$vs$,
  $vc$Get-Mailbox -ResultSize Unlimited -Filter "RecipientTypeDetails -eq 'UserMailbox'" | Where-Object {-not $_.LitigationHoldEnabled} | Select-Object Name,PrimarySmtpAddress$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/exchange/policy-and-compliance/holds/litigation-holds$url$,
    $url$https://learn.microsoft.com/en-us/purview/edisc-hold-types-mailboxes$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-01; Exchange Online PowerShell (ExchangeOnlineManagement)$vag$,
  '2026-09-01'::timestamptz,
  $vby$Claude Sonnet 5 (build #2045) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$Placing all mailboxes on indefinite litigation hold grows every Recoverable Items folder over time — monitor it periodically with Get-MailboxFolderStatistics rather than treating hold as a one-time, no-follow-up action. A shared mailbox needs its own Exchange Online Plan 2 (or Plan 1 + Archiving) license to be held; it does not inherit licensing from the users who access it.$note$
),

-- ─────────────────────────────────────────────────────────────────────────────
(
  'exchange:mail-flow-rule-review',
  $ttl$Review and remediate flagged mail flow (transport) rules$ttl$,
  $sum$A mail flow rule that's overly broad (matches "all messages" with a permissive action), left disabled indefinitely instead of removed, or conflicting with another rule in priority order can silently misroute, leak, or fail to protect mail — for example a broad bypass rule that exempts spam filtering for more senders than intended, or two rules whose priority order means the second is never actually reached for the messages it was written for. Because rules only show their effect when the right message passes through, a bad rule often goes unnoticed until it causes (or fails to prevent) an incident.$sum$,
  jsonb_build_array(
    $prq$Mail Flow permission (Organization Management role group, or a custom role with the Transport Rules role) to view/edit rules$prq$,
    $prq$Exchange Online PowerShell (Exchange Online Management module)$prq$
  ),
  $apath$Exchange admin center → Mail flow → Rules$apath$,
  $aurl$https://admin.exchange.microsoft.com/#/transportrules$aurl$,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Inventory every rule with its state, priority, and scope so overly broad or long-disabled rules are visible in one view:$stp$, 'code', $cod$Get-TransportRule | Format-Table Name,State,Priority,Mode,Comments$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$For each flagged rule, get its full condition/action/exception set to judge whether the scope is genuinely intended or accidentally broad:$stp$, 'code', $cod$Get-TransportRule -Identity "<RuleName>" | Format-List$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Use the Exchange Transport Rule report (Reports → Mail flow) to see how often each rule actually matches messages — a rule with zero matches over a meaningful window is a strong candidate for removal, not just disabling.$stp$),
    jsonb_build_object('text', $stp$Disable a rule that's suspect but not yet confirmed safe to delete, or remove one that's confirmed obsolete:$stp$, 'code', $cod$Disable-TransportRule -Identity "<RuleName>"
# once confirmed safe to delete:
Remove-TransportRule -Identity "<RuleName>"$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Before making changes, back up the full rule collection so a bad edit is reversible:$stp$, 'code', $cod$$file = Export-TransportRuleCollection
[System.IO.File]::WriteAllBytes('C:\MailFlowRuleCollections\BackupRuleCollection.xml', $file.FileData)$cod$, 'codeLanguage', $lng$powershell$lng$)
  ),
  $eo$Every enabled rule has a specific, intentional scope (no unexplained "all messages" matches), every long-disabled rule is either re-enabled with a stated reason or removed, and rule priority order produces the intended effect with no rule silently shadowed by an earlier one.$eo$,
  $vs$Re-run the rule inventory and confirm no rule remains flagged; check the Exchange Transport Rule report after a normal mail-flow period to confirm each active rule is actually matching the traffic it was written for.$vs$,
  $vc$Get-TransportRule | Where-Object {$_.State -eq 'Disabled'} | Format-Table Name,WhenChanged$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/exchange/security-and-compliance/mail-flow-rules/manage-mail-flow-rules$url$,
    $url$https://learn.microsoft.com/en-us/exchange/security-and-compliance/mail-flow-rules/mail-flow-rules$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-01; Exchange Online PowerShell (ExchangeOnlineManagement)$vag$,
  '2026-09-01'::timestamptz,
  $vby$Claude Sonnet 5 (build #2045) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$Rule changes take up to 30 minutes to apply to live mail flow — don't judge a fix as failed from a test message sent immediately after the edit.$note$
),

-- ─────────────────────────────────────────────────────────────────────────────
(
  'exchange:mailbox-quota-utilization',
  $ttl$Resolve mailboxes approaching their storage quota$ttl$,
  $sum$A mailbox that reaches its ProhibitSendReceiveQuota stops sending and, shortly after, stops receiving mail entirely — for a user this means silently missed business communication (senders get an NDR, but the mailbox owner may not realize why replies stopped arriving) until someone notices and intervenes. Because the warning threshold fires well before the hard stop, mailboxes sitting near quota are a predictable, preventable outage rather than a surprise.$sum$,
  jsonb_build_array(
    $prq$Mail Recipients role in Exchange Online (Recipient Management or Organization Management role group)$prq$,
    $prq$Exchange Online Plan 2 (or Plan 1 with the Archiving add-on) if the fix is enabling an archive rather than raising the quota, since default per-plan quotas otherwise cap what's possible$prq$,
    $prq$Exchange Online PowerShell (Exchange Online Management module)$prq$
  ),
  $apath$Exchange admin center → Recipients → Mailboxes → select user → Storage$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Identify mailboxes near or over their warning/prohibit-send quota:$stp$, 'code', $cod$Get-Mailbox -ResultSize Unlimited | Get-MailboxStatistics | Where-Object {$_.StorageLimitStatus -ne 'BelowLimit'} | Select-Object DisplayName,TotalItemSize,StorageLimitStatus$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Preferred long-term fix — enable an archive mailbox so the retention policy moves aging items out of the primary mailbox automatically, rather than raising quota and deferring the same problem:$stp$, 'code', $cod$Enable-Mailbox -Identity <UserPrincipalName> -Archive$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Where the license plan supports it and a genuinely higher ceiling is needed, raise the mailbox's quota values (ProhibitSendReceiveQuota must be ≥ ProhibitSendQuota ≥ IssueWarningQuota):$stp$, 'code', $cod$Set-Mailbox <UserPrincipalName> -IssueWarningQuota 90GB -ProhibitSendQuota 95GB -ProhibitSendReceiveQuota 100GB$cod$, 'codeLanguage', $lng$powershell$lng$)
  ),
  $eo$Flagged mailboxes report StorageLimitStatus = BelowLimit, either because aging items were moved to an enabled archive or because quota was legitimately raised within the licensed plan's ceiling, and no mailbox is silently approaching a send/receive stoppage.$eo$,
  $vs$Re-run the storage-status query and confirm the previously flagged mailboxes now report BelowLimit; for archive-based fixes, confirm Get-MailboxStatistics -Archive shows items actually present in the archive.$vs$,
  $vc$Get-Mailbox -ResultSize Unlimited | Get-MailboxStatistics | Where-Object {$_.StorageLimitStatus -ne 'BelowLimit'} | Select-Object DisplayName,StorageLimitStatus$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/office365/servicedescriptions/exchange-online-service-description/exchange-online-limits$url$,
    $url$https://learn.microsoft.com/en-us/powershell/module/exchangepowershell/set-mailbox?view=exchange-ps$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-01; Exchange Online PowerShell (ExchangeOnlineManagement)$vag$,
  '2026-09-01'::timestamptz,
  $vby$Claude Sonnet 5 (build #2045) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$Default per-plan mailbox quotas (deskless: 2 GB, Exchange Online Plan 1: 50 GB, Plan 2: 100 GB) cap how far ProhibitSendReceiveQuota can be raised without a plan change — archiving is the correct fix when the mailbox is already at its plan's ceiling.$note$
),

-- ─────────────────────────────────────────────────────────────────────────────
(
  'exchange:shared-mailbox-licensing',
  $ttl$Correct shared mailbox licensing and block direct sign-in$ttl$,
  $sum$Two distinct risks hide inside "shared mailbox count": an unlicensed shared mailbox silently exceeding the free 50 GB limit will stop sending mail with no warning until someone investigates why, and a shared mailbox whose account sign-in was never blocked is a standing credential nobody actively monitors — if its (unused, system-generated) password is ever discovered or reset, it becomes a mailbox multiple people already have legitimate delegate access to, but that can now also be signed into directly and used to send as the organization's shared identity outside of normal auditing.$sum$,
  jsonb_build_array(
    $prq$Exchange admin role (Organization Management or Recipient Management role group) to view/manage shared mailboxes$prq$,
    $prq$Global Administrator or User Administrator (Entra ID) to block sign-in on the shared mailbox's account$prq$,
    $prq$An available Exchange Online Plan 2 license (or Plan 1 + Archiving) for any shared mailbox that must exceed 50 GB, be litigation-held, or have an expanded archive$prq$
  ),
  $apath$Exchange admin center → Recipients → Mailboxes (filter: Shared) — sign-in block is set in the Microsoft 365 admin center → Active users → select the shared mailbox's account → Sign-in status$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Inventory every shared mailbox and its current size against the unlicensed 50 GB ceiling:$stp$, 'code', $cod$Get-Mailbox -RecipientTypeDetails SharedMailbox -ResultSize Unlimited | Get-MailboxStatistics | Select-Object DisplayName,TotalItemSize$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$For any shared mailbox over 50 GB, or that needs litigation hold or an expanded archive, assign an Exchange Online Plan 2 (or Plan 1 + Archiving add-on) license via the Microsoft 365 admin center or PowerShell — a shared mailbox is not auto-licensed just because delegates who access it are licensed.$stp$),
    jsonb_build_object('text', $stp$Confirm every shared mailbox's own user account has sign-in blocked, since a shared mailbox is never meant to be signed into directly with its own credentials:$stp$, 'code', $cod$Connect-MgGraph -Scopes "User.ReadWrite.All"
Update-MgUser -UserId <SharedMailboxUserPrincipalName> -AccountEnabled:$false$cod$, 'codeLanguage', $lng$powershell$lng$)
  ),
  $eo$Every shared mailbox over 50 GB (or needing hold/expanded archive) carries the required Exchange Online Plan 2 license, no shared mailbox is silently approaching an unlicensed size stoppage, and every shared mailbox's own account has sign-in blocked so it can only be used via delegate Send As/Send on Behalf permissions, never direct interactive sign-in.$eo$,
  $vs$Re-run the shared-mailbox size query and confirm none are unlicensed and over 50 GB; confirm each shared mailbox account shows AccountEnabled = False.$vs$,
  $vc$Get-MgUser -Filter "userType eq 'Member'" -All | Where-Object {$_.AccountEnabled -eq $true} | Select-Object DisplayName,UserPrincipalName$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/microsoft-365/admin/email/about-shared-mailboxes?view=o365-worldwide$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-01; Microsoft Graph PowerShell SDK (Microsoft.Graph.Users)$vag$,
  '2026-09-01'::timestamptz,
  $vby$Claude Sonnet 5 (build #2045) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$The validation command targets all enabled member accounts, not shared mailboxes specifically, because shared mailbox accounts aren't distinguished from user accounts by Get-MgUser alone — cross-reference against the RecipientTypeDetails SharedMailbox list from the first remediation step to scope it correctly in a real run.$note$
),

-- ─────────────────────────────────────────────────────────────────────────────
(
  'exchange:transport-rule-count',
  $ttl$Bring mail flow (transport) rule sprawl under control$ttl$,
  $sum$A large or steadily growing number of transport rules with no periodic review makes the mail flow pipeline harder to reason about and easier to misconfigure — every new rule interacts with every existing rule in priority order, so as the count grows the chance of two rules conflicting, one shadowing another, or a redundant rule surviving after its original purpose is gone rises correspondingly. High rule count is a proxy for that governance gap, and each additional untracked rule after that point makes the mail flow path progressively harder to audit.$sum$,
  jsonb_build_array(
    $prq$Mail Flow permission (Organization Management role group, or a custom role with the Transport Rules role)$prq$,
    $prq$Exchange Online PowerShell (Exchange Online Management module)$prq$
  ),
  $apath$Exchange admin center → Mail flow → Rules$apath$,
  $aurl$https://admin.exchange.microsoft.com/#/transportrules$aurl$,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Get the current total and priority order so growth over time can be tracked against a baseline:$stp$, 'code', $cod$Get-TransportRule | Measure-Object | Select-Object -ExpandProperty Count
Get-TransportRule | Sort-Object Priority | Format-Table Name,Priority,State$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Cross-reference the Exchange Transport Rule report (Reports → Mail flow in the admin center) to find rules with zero or near-zero matches over a meaningful period — these are the strongest candidates for consolidation or removal, since they add complexity without doing active work.$stp$),
    jsonb_build_object('text', $stp$Consolidate rules that overlap in condition/action rather than leaving near-duplicates active, and remove confirmed-obsolete rules after backing up the collection:$stp$, 'code', $cod$$file = Export-TransportRuleCollection
[System.IO.File]::WriteAllBytes('C:\MailFlowRuleCollections\BackupRuleCollection.xml', $file.FileData)
Remove-TransportRule -Identity "<ObsoleteRuleName>"$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Establish a lightweight standing practice — e.g. a quarterly review of the rule list and the transport rule report — so the count is actively governed going forward instead of only being addressed when it's flagged again.$stp$)
  ),
  $eo$The transport rule count reflects only actively-used, non-overlapping rules with a documented owner/purpose, tracked against a known baseline so future growth is a deliberate decision rather than an unnoticed accumulation.$eo$,
  $vs$Re-run the rule count and compare against the baseline captured in the first remediation step; confirm every currently active rule shows non-zero matches in the Exchange Transport Rule report over the most recent full review period.$vs$,
  $vc$Get-TransportRule | Measure-Object | Select-Object -ExpandProperty Count$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/exchange/security-and-compliance/mail-flow-rules/manage-mail-flow-rules$url$,
    $url$https://learn.microsoft.com/en-us/exchange/security-and-compliance/mail-flow-rules/mail-flow-rules$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-01; Exchange Online PowerShell (ExchangeOnlineManagement)$vag$,
  '2026-09-01'::timestamptz,
  $vby$Claude Sonnet 5 (build #2045) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'admin_center_only',
  $note$Distinct from exchange:mail-flow-rule-review, which targets specific flagged rules (overly broad/disabled/conflicting) — this check is the aggregate governance signal across the whole rule set. No single authoritative "too many rules" threshold exists in Microsoft docs beyond the hard service-description ceiling, so remediation here is a process (review + consolidate), not a single script.$note$
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
VALUES ('2026-09-01-remediation-kb-exchange-domain-2045.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;

-- Verify: how many exchange: rows are published after this migration.
SELECT
  count(*) FILTER (WHERE check_key LIKE 'exchange:%') AS exchange_rows,
  count(*) FILTER (WHERE check_key LIKE 'exchange:%' AND status = 'published') AS exchange_published,
  count(*) AS total_rows
FROM remediation_knowledge_base;
