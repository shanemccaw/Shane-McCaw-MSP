-- #2053 — Remediation knowledge base: the license: domain, authored & published.
--
-- Populates remediation_knowledge_base with verified "this is wrong → here is how
-- to fix it" content for EVERY active license: check (3 rows). Before this the
-- table held zero license:* rows, so every license finding fell through to the AI
-- fallback (#1539 built the fix-route dimension this content feeds; this issue
-- supplies the content).
--
-- AUTHORING STANDARD (see #1924, followed here for the license: domain per #2053):
--   * Every row is verified against real Microsoft Learn / official Microsoft docs
--     that were actually fetched in build session #2053 (2026-09-02). The URLs in
--     source_urls are those pages.
--   * verified_by is an HONEST AGENT attribution — never a human name. The content
--     is agent-authored and awaiting a human spot-check (filed as a Shane To-Do).
--   * Tenant-specific values use angle-bracket placeholders (<UserPrincipalName>,
--     <GroupObjectId>, …), never a fabricated real value. The one concrete literal
--     used — SkuPartNumber 'Microsoft_365_Copilot' — is a real, Microsoft-documented
--     identifier (learn.microsoft.com/en-us/entra/identity/users/licensing-service-
--     plan-reference), not a fabricated tenant-specific value.
--   * fix_route_capability is the finding-side CEILING (#1539): you_must_run when a
--     real customer-runnable fix script is authored in a step's `code`; NEVER
--     we_can_run here — that shape requires a live config pack mapped to the check
--     (#1925's job).
--
-- Overlap note: license:sku-utilization reads the same subscribedSkus purchased-vs-
-- consumed figures as cost:utilization-by-sku / cost:unused-unassigned-licenses
-- (#2050) — it is genuinely the same underlying Graph data feeding two different
-- pillars. This row is deliberately framed around license-assignment GOVERNANCE
-- (group-based licensing vs. ad hoc per-user grants) rather than dollar cost/
-- renewal negotiation, so the two domains' content is substantively different, not
-- a duplicate under a different key.
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
  'license:copilot-assignment',
  $ttl$Close the gap between Copilot licenses assigned and Copilot licenses actually used$ttl$,
  $sum$This check counts users assigned a Microsoft 365 Copilot SKU — the baseline figure Microsoft's own Copilot usage report calls "Enabled Users". On its own that number says nothing about value; it only becomes meaningful next to "Active Users" (enabled users who actually submitted a Copilot prompt) and the "Active users rate" the report derives from the two. A tenant paying for a large Copilot-enabled population with a persistently low active rate is carrying real recurring per-seat spend with no adoption behind it — and because Copilot licenses require an underlying qualifying Microsoft 365 license already in place, every unused Copilot seat is stacked on top of an already-licensed user, making it pure incremental waste rather than a shared cost.$sum$,
  jsonb_build_array(
    $prq$License Administrator (or Global Administrator) to assign or remove licenses in the Microsoft 365 admin center$prq$,
    $prq$A role with access to usage reports (see "Before you begin" in the Microsoft 365 admin center usage reports overview) to view the Microsoft Copilot usage report$prq$,
    $prq$Microsoft Graph PowerShell SDK (Microsoft.Graph.Identity.DirectoryManagement) if automating, scopes Organization.Read.All and User.ReadWrite.All to reclaim a seat$prq$,
    $prq$Each user must already hold a qualifying underlying Microsoft 365 license before a Copilot license can be assigned to them$prq$
  ),
  $apath$Microsoft 365 admin center → Reports → Usage → Microsoft Copilot → Usage tab (Enabled Users / Active Users / Active users rate, and the per-user Last activity date table); → Billing → Licenses → Microsoft Copilot to assign or unassign$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Go to Microsoft 365 admin center → Reports → Usage → Microsoft Copilot → Usage tab. Compare Enabled Users (this check's own count) against Active Users and the Active users rate, using the widest available window (180 days) so a still-ramping rollout isn't misread as failed adoption.$stp$),
    jsonb_build_object('text', $stp$Select Export on the report to pull the per-user "Last activity date (UTC)" table, so the follow-up is aimed at specific non-adopting users rather than acted on the aggregate rate alone.$stp$),
    jsonb_build_object('text', $stp$For a user confirmed as a genuine non-adopter — licensed well past a fair pilot window, blank or stale Last activity date, no legitimate reason (leave, role change) — reclaim the seat so it can be reassigned or dropped at renewal:$stp$, 'code', $cod$Connect-MgGraph -Scopes 'Organization.Read.All','User.ReadWrite.All'
$copilotSku = Get-MgSubscribedSku -All | Where-Object { $_.SkuPartNumber -eq 'Microsoft_365_Copilot' }
Set-MgUserLicense -UserId "<UserPrincipalName>" -RemoveLicenses @($copilotSku.SkuId) -AddLicenses @{}$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Reassign the reclaimed seat to a real waiting user via Billing → Licenses → Microsoft Copilot → Assign licenses, or reduce the subscription's renewing quantity if there is no one waiting for it.$stp$)
  ),
  $eo$The count of users assigned a Copilot SKU tracks closely with the usage report's Active Users figure — assigned seats are the seats actually producing prompts, not a static number nobody is touching.$eo$,
  $vs$Re-open the Microsoft Copilot usage report after the reclaim/reassignment and confirm the Active users rate has moved up relative to Enabled Users, or that the raw assigned-seat count has dropped to match real remaining need.$vs$,
  $vc$Get-MgSubscribedSku -All | Where-Object { $_.SkuPartNumber -eq 'Microsoft_365_Copilot' } | Select-Object SkuPartNumber, ConsumedUnits, @{N='Purchased';E={$_.PrepaidUnits.Enabled}}$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/microsoft-365/copilot/microsoft-365-copilot-setup$url$,
    $url$https://learn.microsoft.com/en-us/microsoft-365/admin/activity-reports/microsoft-365-copilot-usage$url$,
    $url$https://learn.microsoft.com/en-us/entra/identity/users/licensing-service-plan-reference$url$,
    $url$https://learn.microsoft.com/en-us/microsoft-365/enterprise/remove-licenses-from-user-accounts-with-microsoft-365-powershell$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02; Microsoft Graph PowerShell SDK (Microsoft.Graph.Identity.DirectoryManagement)$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2053) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$A Copilot license requires an underlying qualifying Microsoft 365 license already assigned, so this check's raw assigned-count alone can't distinguish a fresh, still-ramping assignment from a genuinely stalled one — always cross-reference the usage report's per-user last-activity table, and give a new assignment a real pilot window (see Microsoft's Pilot → Deploy → Operate guidance) before treating it as waste.$note$
),

(
  'license:sku-utilization',
  $ttl$Govern SKU assignment with group-based licensing instead of ad hoc per-user grants$ttl$,
  $sum$Consumed vs. prepaid units per SKU is the same purchased/assigned figure the cost domain tracks for spend, but read for governance it says something different: a SKU that's assigned user-by-user, with no group tying the assignment to a defined population (a role, a department, a project), has no answer to "who is supposed to have this" beyond a hand-maintained list. That's how utilization drifts — a new hire in the right role doesn't automatically get the seat, an offboarded user keeps it — independent of whether the raw purchased-vs-consumed number looks fine on a given day. Group-based licensing is Microsoft's own mechanism for turning that manual process into a governed one: assignment that follows real group membership instead of a list someone has to remember to update.$sum$,
  jsonb_build_array(
    $prq$Groups Administrator, License Administrator, or User Administrator to assign a license to a group$prq$,
    $prq$Microsoft Graph PowerShell SDK (Microsoft.Graph.Identity.DirectoryManagement, Microsoft.Graph.Groups) if automating, scopes Organization.Read.All to read and Directory.ReadWrite.All (or Group.ReadWrite.All) to assign$prq$,
    $prq$An existing security, mail-enabled, or Microsoft 365 group whose real membership maps to who should hold the SKU (create one if it doesn't exist yet) — group-based licensing does not support nested groups$prq$
  ),
  $apath$Microsoft 365 admin center → Billing → Licenses → select the SKU (per-SKU consumed vs. purchased, and Direct user assignments vs. Group-based assignments) → Assign licenses (search for a group instead of individual users)$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Review current per-SKU utilization and how it's assigned today — direct-to-user or already group-based — from the Licenses page, or programmatically:$stp$, 'code', $cod$Connect-MgGraph -Scopes 'Organization.Read.All'
Get-MgSubscribedSku -All | Select-Object SkuPartNumber, ConsumedUnits, @{N='Purchased';E={$_.PrepaidUnits.Enabled}}$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$For a SKU still assigned directly to individual users, identify or create a group whose real membership matches who should hold it, then assign the license to that group instead of to individuals: Billing → Licenses → select the product → Assign licenses → search for the group → select the subscription → Assign licenses.$stp$),
    jsonb_build_object('text', $stp$Graph PowerShell equivalent for assigning a license to a group:$stp$, 'code', $cod$Connect-MgGraph -Scopes 'Directory.ReadWrite.All'
$sku = Get-MgSubscribedSku -All | Where-Object SkuPartNumber -eq '<SkuPartNumber>'
Set-MgGroupLicense -GroupId "<GroupObjectId>" -AddLicenses @{SkuId = $sku.SkuId} -RemoveLicenses @()$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Once the group carries the license, remove the now-redundant direct per-user assignments for members already covered by the group, and check the group's own Errors & issues tab to confirm no member failed assignment (e.g. a missing usage location).$stp$)
  ),
  $eo$The SKU's assignment is driven by real group membership rather than a hand-maintained list of individual users — someone added to the group is licensed, someone removed loses the seat, with no separate manual step for an admin to remember.$eo$,
  $vs$On the Licenses page for the SKU, confirm the assignment list shows the group under Group-based assignments (not a long list of individual users), and that the group's Errors & issues tab is empty.$vs$,
  $vc$Get-MgSubscribedSku -All | Select-Object SkuPartNumber, ConsumedUnits, @{N='Purchased';E={$_.PrepaidUnits.Enabled}}$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/microsoft-365/admin/manage/manage-group-licenses$url$,
    $url$https://learn.microsoft.com/en-us/microsoft-365/admin/manage/assign-licenses-to-users$url$,
    $url$https://learn.microsoft.com/en-us/powershell/module/microsoft.graph.identity.directorymanagement/get-mgsubscribedsku$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02; Microsoft Graph PowerShell SDK (Microsoft.Graph.Identity.DirectoryManagement, Microsoft.Graph.Groups)$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2053) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$Group-based licensing doesn't support nested groups — only first-level members are licensed. When moving a user between licensed groups, add them to the destination group and confirm the new license landed BEFORE removing them from the source group, or the user goes temporarily unlicensed while reprocessing catches up (Microsoft's own documented order of operations).$note$
),

(
  'license:unused-assigned',
  $ttl$Reclaim licenses held by accounts with no sign-in activity in 90+ days$ttl$,
  $sum$An enabled account that still holds one or more assigned licenses but has no successful sign-in in 90+ days (or has never signed in at all) is a seat being paid for on an account nobody is using — Microsoft's own inactive-account guidance names 90–180 days as the reasonable window for most organizations. This is distinct from a raw unassigned-seat finding: the license here is actively consuming a paid seat against a real user object, so the fix is either reclaiming the license or, if the account is confirmed departed rather than merely dormant, running full offboarding. The paired severity thresholds (>10 medium, >50 high) point at a systemic gap — most often offboarding that isn't paired with license reclaim — rather than a one-off leftover account.$sum$,
  jsonb_build_array(
    $prq$Microsoft Entra ID P1 or P2 license (required to read signInActivity via Microsoft Graph)$prq$,
    $prq$Reports Reader (least-privileged) to view sign-in activity; User Administrator or License Administrator to remove licenses$prq$,
    $prq$Microsoft Graph PowerShell SDK (Microsoft.Graph.Users, Microsoft.Graph.Identity.DirectoryManagement) if automating: scopes AuditLog.Read.All and User.Read.All to read, User.ReadWrite.All and Organization.Read.All to remove licenses$prq$
  ),
  $apath$Microsoft Entra admin center → Users → All users → Manage view → Edit columns → add "Last interactive sign-in time", then Add filter to find accounts before a cutoff date; Microsoft 365 admin center → Billing → Licenses to remove the reclaimed seat$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$List enabled, licensed accounts with no recent sign-in — this is the check's own real scope: accountEnabled AND assignedLicenses non-empty, joined against signInActivity older than the 90-day cutoff (or never populated):$stp$, 'code', $cod$Connect-MgGraph -Scopes 'AuditLog.Read.All','User.Read.All'
$cutoff = (Get-Date).AddDays(-90)
Get-MgUser -All -Property DisplayName,UserPrincipalName,AccountEnabled,AssignedLicenses,SignInActivity -ConsistencyLevel eventual |
  Where-Object {
    $_.AccountEnabled -and $_.AssignedLicenses.Count -gt 0 -and
    ($null -eq $_.SignInActivity.LastSignInDateTime -or $_.SignInActivity.LastSignInDateTime -lt $cutoff)
  } |
  Select-Object DisplayName, UserPrincipalName, @{N='LastSignIn';E={$_.SignInActivity.LastSignInDateTime}}$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Before touching any account, confirm it's genuinely inactive rather than a false positive — extended leave, a seasonal role, or a service/shared-mailbox account that legitimately never signs in interactively.$stp$),
    jsonb_build_object('text', $stp$For an account confirmed genuinely inactive, remove its license(s) rather than deleting the account outright unless offboarding is also confirmed:$stp$, 'code', $cod$Connect-MgGraph -Scopes 'User.ReadWrite.All','Organization.Read.All'
$user = Get-MgUser -UserId "<UserPrincipalName>" -Property AssignedLicenses
Set-MgUserLicense -UserId "<UserPrincipalName>" -RemoveLicenses @($user.AssignedLicenses.SkuId) -AddLicenses @{}$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Where the account is confirmed as a departed employee rather than merely dormant, run the full offboarding process instead of a bare license removal, so mailbox/OneDrive data is preserved per the organization's retention policy before access is fully cut off.$stp$)
  ),
  $eo$No enabled account holds an assigned license with 90+ days of no sign-in activity that hasn't been deliberately reviewed and either reclaimed or documented as a legitimate, named exception (extended leave, seasonal role, service account).$eo$,
  $vs$Re-run the inactive-licensed-user query and confirm the matching count has dropped to the reviewed/accepted baseline, with any remaining rows individually explainable.$vs$,
  $vc$Get-MgUser -All -Property AccountEnabled,AssignedLicenses,SignInActivity -ConsistencyLevel eventual | Where-Object { $_.AccountEnabled -and $_.AssignedLicenses.Count -gt 0 -and $_.SignInActivity.LastSignInDateTime -lt (Get-Date).AddDays(-90) } | Measure-Object$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/entra/identity/monitoring-health/howto-manage-inactive-user-accounts$url$,
    $url$https://learn.microsoft.com/en-us/microsoft-365/enterprise/remove-licenses-from-user-accounts-with-microsoft-365-powershell$url$,
    $url$https://learn.microsoft.com/en-us/microsoft-365/admin/manage/assign-licenses-to-users$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02; Microsoft Graph PowerShell SDK (Microsoft.Graph.Users, Microsoft.Graph.Identity.DirectoryManagement)$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2053) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$lastSignInDateTime can be blank for reasons other than inactivity — no sign-in attempt was ever recorded, or the last attempt predates April 2020 — treat a blank value as "never signed in" (a stronger signal, not a data gap). Reading signInActivity via Graph requires Entra ID P1/P2 and an explicit $select=signInActivity or $filter=signInActivity (it isn't returned by default and doesn't compose with other $filter properties in the same query).$note$
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
  notes = EXCLUDED.notes;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-02-remediation-kb-license-domain-2053.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
