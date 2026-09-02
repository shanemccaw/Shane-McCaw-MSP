-- #2050 — Remediation knowledge base: the cost: domain, authored & published.
--
-- Populates remediation_knowledge_base with verified "this is wrong → here is how
-- to fix it" content for EVERY active cost: check (7 rows). Before this the table
-- held zero cost:* rows, so every cost finding fell through to the AI fallback.
--
-- AUTHORING STANDARD (see #1924, followed here for the cost: domain per #2050):
--   * Every row is verified against real Microsoft Learn / official Microsoft docs
--     that were actually fetched in build session #2050 (2026-09-02). The URLs in
--     source_urls are those pages.
--   * verified_by is an HONEST AGENT attribution — never a human name. The content
--     is agent-authored and awaiting a human spot-check (filed as a Shane To-Do).
--   * Tenant-specific values use angle-bracket placeholders (<GroupObjectId>, …),
--     never a fabricated real value.
--   * fix_route_capability is the finding-side CEILING (#1539): you_must_run when a
--     real customer-runnable fix script is authored in a step's `code`;
--     admin_center_only when the real fix is portal/billing-only (buying/removing
--     licenses on a subscription is a commerce action, not a Graph-scriptable one).
--     NEVER we_can_run here — that shape requires a live config pack mapped to the
--     check (#1925's job).
--
-- Real check mapping caveat (see license-waste-source.ts's own header, audited
-- 2026-07-26): cost:unused-unassigned-licenses' actual extractedProperties mapping
-- is count(consumedUnits) — i.e. it counts SKU ROWS with a consumedUnits value, not
-- unused seats. This row's content addresses the check's customer-facing LABEL
-- ("Unused/Unassigned License Count") and the real underlying data every one of
-- these SKU-count checks reads from (/subscribedSkus' prepaidUnits.enabled vs
-- consumedUnits), not the mapping's literal (and separately known-misnamed) count.
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
  'cost:duplicate-assignments',
  $ttl$Remove duplicate/overlapping license assignments$ttl$,
  $sum$A user holds two or more SKUs whose service plans overlap — for example both Microsoft Entra ID P1 and P2, or a standalone add-on that is already included in a bundled suite the same user also has. Every duplicated service plan is a seat paid for twice: the tenant is billed for the SKU-level price of each subscription regardless of whether the overlapping plan inside it is ever used twice. This is pure waste rather than a security gap, but at scale — a handful of duplicates repeated across dozens of users — it is often the single largest recoverable cost line in a license audit.$sum$,
  jsonb_build_array(
    $prq$License Administrator (or User Administrator) to view and change license assignments$prq$,
    $prq$Microsoft Graph PowerShell SDK (Microsoft.Graph.Users, Microsoft.Graph.Users.Actions) if automating, with scopes User.Read.All, LicenseAssignment.ReadWrite.All$prq$,
    $prq$The product/service-plan reference table to confirm which service plans genuinely overlap before removing anything$prq$
  ),
  $apath$Microsoft 365 admin center → Billing → Licenses → select a product → Users tab (to see who holds it), and the Errors & issues tab on each product's details page for any resulting MutuallyExclusiveViolation entries$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$For any two SKUs assigned to the same user, look up each SKU's included service plans in the product/service-plan reference and note where the same service plan ID appears in both — that overlap is the duplicate. Two SKUs from the same product family (e.g. Entra ID P1 and P2, or a standalone add-on already contained in a purchased suite) are the most common pattern.$stp$),
    jsonb_build_object('text', $stp$Confirm programmatically for a specific user before removing anything:$stp$, 'code', $cod$Connect-MgGraph -Scopes 'User.Read.All'

$user = Get-MgUser -UserId '<UserObjectId>' -Property AssignedLicenses
foreach ($lic in $user.AssignedLicenses) {
    $sku = Get-MgSubscribedSku | Where-Object { $_.SkuId -eq $lic.SkuId }
    Write-Host "$($sku.SkuPartNumber): $($sku.ServicePlans.ServicePlanName -join ', ')"
}$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Once the redundant SKU is identified (the lower-value one, e.g. drop the standalone add-on and keep the bundle that already contains it), remove it from the user. Confirm the licence is directly assigned first — Set-MgUserLicense fails with "User license is inherited from a group membership" if it is group-based, and the correct fix there is to change the group's assigned licenses instead.$stp$, 'code', $cod$Connect-MgGraph -Scopes 'User.ReadWrite.All','Organization.Read.All'

$redundantSku = Get-MgSubscribedSku -All | Where-Object SkuPartNumber -eq '<RedundantSkuPartNumber>'
Set-MgUserLicense -UserId '<UserObjectId>' -AddLicenses @() -RemoveLicenses @($redundantSku.SkuId)$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$To find every user in the tenant with more than one SKU assigned, as a starting list to triage for overlap:$stp$, 'code', $cod$Connect-MgGraph -Scopes 'User.Read.All'

Get-MgUser -All -Property DisplayName, UserPrincipalName, AssignedLicenses |
  Where-Object { $_.AssignedLicenses.Count -gt 1 } |
  Select-Object DisplayName, UserPrincipalName, @{N='SkuCount';E={$_.AssignedLicenses.Count}}$cod$, 'codeLanguage', $lng$powershell$lng$)
  ),
  $eo$Each user holds exactly one SKU per distinct set of service plans they need — no service plan is paid for twice across two simultaneously assigned SKUs.$eo$,
  $vs$Re-run the per-user service-plan comparison after removal and confirm no service plan ID appears under more than one of the user's remaining assigned SKUs.$vs$,
  $vc$Get-MgUserLicenseDetail -UserId '<UserObjectId>' | Select-Object SkuPartNumber -ExpandProperty ServicePlans$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/entra/identity/users/licensing-service-plan-reference$url$,
    $url$https://learn.microsoft.com/en-us/microsoft-365/admin/manage/manage-group-licenses$url$,
    $url$https://learn.microsoft.com/en-us/powershell/module/microsoft.graph.users.actions/set-mguserlicense$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02; Microsoft Graph PowerShell SDK (Microsoft.Graph.Users, Microsoft.Graph.Users.Actions)$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2050) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$"Duplicate" here means overlapping service plans across two SKUs on the same user, not two identical SKUs (Microsoft Entra ID rejects assigning the same SKU to a user twice). Always confirm a licence is directly assigned, not group-inherited, before calling Set-MgUserLicense to remove it.$note$
),

-- ─────────────────────────────────────────────────────────────────────────────
(
  'cost:entra-license-tier-distribution',
  $ttl$Right-size the Microsoft Entra ID license tier mix (Free / P1 / P2)$ttl$,
  $sum$This shows how the tenant's users split across Entra ID Free, P1, and P2 — the tier that actually gates which identity security and governance features are available (Conditional Access, Identity Protection risk-based policies, Privileged Identity Management, entitlement management, and more all sit behind P1 or P2). A distribution that is mismatched against real usage is a cost problem in either direction: users sitting on P2 (included in Microsoft 365 E5, or purchased standalone) when no one in the tenant uses PIM, Identity Protection, or advanced Access Reviews is money spent on unused entitlement; conversely, a Free-tier-only tenant that has manually built Conditional Access-style controls elsewhere is often trying to compensate for a control that a P1 licence would deliver natively and more reliably.$sum$,
  jsonb_build_array(
    $prq$License Administrator to view the tenant's licensed products$prq$,
    $prq$Global Administrator to review which Entra ID Governance / PIM / Identity Protection features are actually configured and in use$prq$,
    $prq$Awareness of which product bundle (Microsoft 365 E3 includes P1; Microsoft 365 E5 includes P2) is the source of any P1/P2 seats already present, since dropping the standalone SKU may not be possible if the tier is bundled in$prq$
  ),
  $apath$Microsoft Entra admin center → Billing → Licenses → Manage → Licensed features (shows the current Microsoft Entra ID license plan) and → All products (shows every licensed product in the tenant)$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$In the Microsoft Entra admin center, go to Billing → Licenses → Manage → Licensed features to see which Entra ID tier is active, then → All products to see how many P1/P2 seats exist and via which underlying product (standalone Entra ID P1/P2, or bundled inside Microsoft 365 E3/E5, EMS E3/E5, etc).$stp$),
    jsonb_build_object('text', $stp$Cross-reference against real usage: if P2-gated features (Privileged Identity Management, Identity Protection risk policies, Access Reviews beyond the P1 baseline, Entitlement Management) are configured and enrolling real users, P2 is being used and is worth its cost. If none of those are configured anywhere in the tenant, the P2 seats are paying for capability nobody is using — either start using PIM/Identity Protection (the higher-value outcome) or, where the P2 seats are standalone (not bundled into an E5 suite that's needed for other reasons), reduce the standalone P2 subscription's quantity.$stp$),
    jsonb_build_object('text', $stp$Where the tenant is Free-tier only (no P1 anywhere) and is using workarounds for MFA enforcement, legacy-auth blocking, or device-compliance gating, treat the finding the other way: those controls belong under Conditional Access, which requires at least P1 — the real fix is licensing up, not a workaround.$stp$)
  ),
  $eo$The Entra ID tier present in the tenant matches what the tenant's identity security configuration actually uses — no P2 seats sitting idle behind unused PIM/Identity Protection features, and no security controls being hand-rolled in place of a P1 Conditional Access policy the tenant is under-licensed for.$eo$,
  $vs$Re-check Billing → Licenses → Manage → Licensed features and Manage → All products after any change, and confirm the active feature set (PIM enrollment, Identity Protection policies, or Conditional Access policies) lines up with the tier now licensed.$vs$,
  NULL,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/entra/id-governance/licensing-fundamentals$url$,
    $url$https://learn.microsoft.com/en-us/entra/identity/users/licensing-service-plan-reference$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2050) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'admin_center_only',
  $note$This is a right-sizing/decision finding, not a single scriptable fix — the correct action (drop unused P2, or buy P1 to replace a workaround) depends on which other products already bundle the tier and is a genuine license-spend decision, not something a PowerShell command resolves on its own.$note$
),

-- ─────────────────────────────────────────────────────────────────────────────
(
  'cost:group-based-licensing-adoption',
  $ttl$Migrate direct license assignments to group-based licensing$ttl$,
  $sum$Licenses assigned directly to individual users (rather than to a group they belong to) require a manual PowerShell script or Graph call every time someone joins, leaves, or changes role — Microsoft's own guidance is explicit that without group-based licensing this bulk add/remove work falls to scripting. In practice that manual step gets missed: seats stay assigned to people who left the group's intended scope long after they should have been reclaimed, and that drift is direct, ongoing cost. Assigning the same licenses to a group instead makes membership the single source of truth — Microsoft Entra ID adds and removes the license automatically as group membership changes, so a departing or role-changed user's seat is reclaimed without anyone remembering to run a script.$sum$,
  jsonb_build_array(
    $prq$Groups Administrator, License Administrator, or User Administrator to assign licenses to a group$prq$,
    $prq$An existing security group, mail-enabled security group, or Microsoft 365 group to assign the license to (nested groups are not supported — only first-level members are licensed)$prq$,
    $prq$Microsoft Graph PowerShell SDK (Microsoft.Graph.Groups, Microsoft.Graph.Users.Actions) if automating the migration itself$prq$
  ),
  $apath$Microsoft 365 admin center → Billing → Licenses → Assign licenses (select a group instead of individual users)$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Identify users currently on direct assignment for the SKU in question:$stp$, 'code', $cod$Connect-MgGraph -Scopes 'User.Read.All','Directory.Read.All'

$skus = Get-MgSubscribedSku -All | Select-Object SkuId, SkuPartNumber
Get-MgUser -All -Property DisplayName, UserPrincipalName, LicenseAssignmentStates |
  ForEach-Object {
    foreach ($state in $_.LicenseAssignmentStates) {
      if (-not $state.AssignedByGroup) {
        [PSCustomObject]@{ User = $_.UserPrincipalName; Sku = ($skus | Where-Object SkuId -eq $state.SkuId).SkuPartNumber }
      }
    }
  }$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$In the Microsoft 365 admin center, go to Billing → Licenses → Assign licenses, search for the target group instead of an individual user, select the subscription to assign, and choose which apps/services to enable — see [Assign or unassign licenses to a group](https://learn.microsoft.com/en-us/microsoft-365/admin/manage/manage-group-licenses).$stp$),
    jsonb_build_object('text', $stp$Once the group carries the license and every affected user is confirmed as a member (verify on the user's Licenses page before removing anything, to avoid a service gap), remove the same license from each user's direct assignment so it is no longer double-counted:$stp$, 'code', $cod$Connect-MgGraph -Scopes 'User.ReadWrite.All'

$GroupId = '<GroupObjectId>'
$Group = Get-MgGroup -GroupId $GroupId -Property AssignedLicenses
$GroupLicenses = $Group.AssignedLicenses.SkuId

foreach ($User in (Get-MgGroupMember -GroupId $GroupId -All)) {
    $UserLicenses = (Get-MgUser -UserId $User.Id -Property AssignedLicenses).AssignedLicenses.SkuId
    $ToRemove = $UserLicenses | Where-Object { $GroupLicenses -contains $_ }
    if ($ToRemove) {
        Set-MgUserLicense -UserId $User.Id -AddLicenses @() -RemoveLicenses $ToRemove
    }
}$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Use a dynamic membership group where the intended scope is rule-based (e.g. department = Sales), so future joiners/leavers are licensed and de-licensed automatically with zero ongoing script maintenance.$stp$)
  ),
  $eo$The tenant's license assignment for this SKU is driven by group membership rather than per-user scripting — a user who leaves the group loses the license automatically, with no manual reclaim step required.$eo$,
  $vs$List groups with assigned licenses and confirm the previously-direct users now show AssignedBy = the group name rather than "User".$vs$,
  $vc$Get-MgGroup -All -Property Id, DisplayName, AssignedLicenses | Where-Object { $_.AssignedLicenses -ne $null }$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/microsoft-365/admin/manage/manage-group-licenses$url$,
    $url$https://learn.microsoft.com/en-us/entra/identity/users/licensing-powershell-graph-examples$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02; Microsoft Graph PowerShell SDK (Microsoft.Graph.Groups, Microsoft.Graph.Users, Microsoft.Graph.Users.Actions)$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2050) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$Move users into the licensed group BEFORE removing their direct assignment (order matters — removing the direct license first causes a temporary loss of access while group processing catches up). Group-based licensing caps at 20 groups assigned per bulk operation in the admin center UI.$note$
),

-- ─────────────────────────────────────────────────────────────────────────────
(
  'cost:license-count-by-sku',
  $ttl$Review total vs. consumed license counts by SKU for shelf-ware$ttl$,
  $sum$This is the tenant's full license footprint broken out by SKU — total seats purchased and seats actually consumed for every subscribed product. It is the starting inventory every other cost finding in this domain (duplicates, underutilization, unused seats) is triaged against: a SKU carrying a large gap between purchased and consumed seats, or a SKU nobody can explain the business need for, is "shelf-ware" — real recurring spend with no user behind it. Reviewing this list regularly, especially ahead of a renewal date, is what catches shelf-ware before it renews for another billing cycle.$sum$,
  jsonb_build_array(
    $prq$License Administrator, or a Billing account/profile owner or contributor (Microsoft Customer Agreement) / Billing Administrator (Microsoft Online Subscription Agreement) to view and change subscription quantities$prq$,
    $prq$Microsoft Graph PowerShell SDK (Microsoft.Graph.Identity.DirectoryManagement) if automating, scope Organization.Read.All$prq$
  ),
  $apath$Microsoft 365 admin center → Billing → Your products (lists every subscription with total vs. assigned counts)$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$In the Microsoft 365 admin center, go to Billing → Your products. Each subscription row shows the licence total and how many are currently assigned — sort or scan for the biggest total-minus-assigned gaps.$stp$),
    jsonb_build_object('text', $stp$Pull the same breakdown programmatically for a full per-SKU audit, including SKUs the admin center aggregates together across multiple subscriptions of the same product:$stp$, 'code', $cod$Connect-MgGraph -Scopes 'Organization.Read.All'

Get-MgSubscribedSku -All |
  Select-Object SkuPartNumber,
    @{N='Purchased';E={$_.PrepaidUnits.Enabled}},
    ConsumedUnits,
    @{N='Unused';E={$_.PrepaidUnits.Enabled - $_.ConsumedUnits}} |
  Sort-Object Unused -Descending$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$For each SKU with a large gap and no clear ongoing need (a pilot that ended, a department that shrank, a discontinued add-on), reduce the subscription quantity: Billing → Your products → select the subscription → Remove licenses, or contact the CSP/reseller partner directly if the subscription was bought through one — see [Buy or remove licenses](https://learn.microsoft.com/en-us/microsoft-365/commerce/licenses/buy-licenses).$stp$)
  ),
  $eo$Every subscribed SKU has a total license count that reflects real, current need — no SKU is carrying a large purchased-but-unconsumed gap that nobody can explain.$eo$,
  $vs$Re-run the per-SKU purchased-vs-consumed breakdown after any subscription quantity change and confirm the gap has closed for the SKUs that were adjusted.$vs$,
  $vc$Get-MgSubscribedSku -All | Select-Object SkuPartNumber, @{N='Purchased';E={$_.PrepaidUnits.Enabled}}, ConsumedUnits$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/powershell/module/microsoft.graph.identity.directorymanagement/get-mgsubscribedsku$url$,
    $url$https://learn.microsoft.com/en-us/microsoft-365/commerce/licenses/buy-licenses$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02; Microsoft Graph PowerShell SDK (Microsoft.Graph.Identity.DirectoryManagement)$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2050) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'admin_center_only',
  $note$Reducing a subscription's quantity is a billing/commerce action (Buy licenses / Remove licenses in the admin center, or the reseller/CSP relationship for reseller-channel subscriptions) — there is no Graph API to resize a subscription's purchased quantity, only to read it, which is why this stays admin_center_only rather than you_must_run.$note$
),

-- ─────────────────────────────────────────────────────────────────────────────
(
  'cost:underutilized-premium',
  $ttl$Identify premium (E5-tier) licenses assigned to users not using the premium features$ttl$,
  $sum$A premium/E5-tier license costs substantially more than the E3-equivalent it's layered on top of, and that difference buys specific advanced capability — Microsoft Entra ID P2 governance features (PIM, Identity Protection, Access Reviews), Microsoft Defender/Purview premium security and compliance workloads, or advanced Power BI/analytics entitlement, depending on which E5 SKU is involved. A user assigned the premium SKU who never touches any of that capability is costing the tenant the full premium delta for zero incremental value over the cheaper tier — this is the single most expensive per-seat waste pattern.$sum$,
  jsonb_build_array(
    $prq$License Administrator to review and change license assignments$prq$,
    $prq$Reports Reader (or Global Reader) to view Microsoft 365 usage reports — Usage Summary Reports Reader does not have permission to view the detailed user activity reports$prq$,
    $prq$Microsoft Graph PowerShell SDK (Microsoft.Graph.Users, Microsoft.Graph.Users.Actions) if automating$prq$
  ),
  $apath$Microsoft 365 admin center → Reports → Usage (Activation and licensing → Licensing report for assignment; the individual product usage/user-activity reports for actual feature use) and Billing → Licenses for reassignment$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$In the Microsoft 365 admin center, go to Reports → Usage → Activation and licensing → Licensing to see who is assigned the premium SKU, then cross-reference against the relevant product usage / user activity reports (or, for identity-governance-specific premium features, whether the user has ever appeared in a PIM eligible/active assignment, an Identity Protection risk event, or an Access Review) to see who is actually exercising premium-only capability.$stp$),
    jsonb_build_object('text', $stp$Confirm a specific user's assigned SKU and service plans before downgrading:$stp$, 'code', $cod$Connect-MgGraph -Scopes 'User.Read.All'
Get-MgUserLicenseDetail -UserId '<UserObjectId>' | Select-Object SkuPartNumber -ExpandProperty ServicePlans$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$For a user confirmed to have no genuine need for the premium tier, replace the premium SKU with the lower (E3-equivalent) tier rather than simply removing it, so core productivity access is preserved:$stp$, 'code', $cod$Connect-MgGraph -Scopes 'User.ReadWrite.All','Organization.Read.All'

$PremiumSku = Get-MgSubscribedSku -All | Where-Object SkuPartNumber -eq '<PremiumSkuPartNumber>'
$StandardSku = Get-MgSubscribedSku -All | Where-Object SkuPartNumber -eq '<StandardSkuPartNumber>'

Set-MgUserLicense -UserId '<UserObjectId>' -AddLicenses @{SkuId = $StandardSku.SkuId} -RemoveLicenses @($PremiumSku.SkuId)$cod$, 'codeLanguage', $lng$powershell$lng$)
  ),
  $eo$Every user assigned a premium/E5-tier SKU has a demonstrable, recent use of at least one premium-only capability it unlocks; users with no such use are on the standard-tier equivalent instead.$eo$,
  $vs$Re-pull the licensing report and the relevant usage/activity report after reassignment and confirm the downgraded users no longer appear against the premium SKU, and that no one still on the premium SKU shows zero premium-feature use.$vs$,
  $vc$Get-MgUserLicenseDetail -UserId '<UserObjectId>' | Select-Object SkuPartNumber$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/microsoft-365/admin/usage-analytics/usage-analytics$url$,
    $url$https://learn.microsoft.com/en-us/powershell/module/microsoft.graph.users/get-mguserlicensedetail$url$,
    $url$https://learn.microsoft.com/en-us/entra/id-governance/licensing-fundamentals$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02; Microsoft Graph PowerShell SDK (Microsoft.Graph.Users, Microsoft.Graph.Users.Actions)$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2050) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$"Premium feature usage" is genuinely tenant- and SKU-specific — Microsoft 365 usage reports don't have a single flag for "used a premium feature"; the check must be composed from the report(s) matching whichever premium capability that tenant's E5-tier SKU actually adds (Entra ID Governance, Defender, Purview, Power BI, etc). Always downgrade to the equivalent standard SKU rather than removing the license outright, to avoid a service outage for the user.$note$
),

-- ─────────────────────────────────────────────────────────────────────────────
(
  'cost:unused-unassigned-licenses',
  $ttl$Reclaim or remove purchased-but-unassigned licenses$ttl$,
  $sum$A subscription's total seat count (prepaidUnits.enabled) minus its consumed count (consumedUnits) is the number of seats the tenant is paying for every billing cycle with nobody assigned to them at all — not underused, genuinely unassigned. This is the most direct, lowest-risk cost recovery in the whole domain: no user loses access by reclaiming a seat nobody holds, and every unassigned seat carried past a renewal date is pure, avoidable spend.$sum$,
  jsonb_build_array(
    $prq$License Administrator to view assignment counts$prq$,
    $prq$Billing account/profile owner or contributor (Microsoft Customer Agreement) or Billing Administrator (Microsoft Online Subscription Agreement) to actually reduce a subscription's quantity$prq$,
    $prq$Microsoft Graph PowerShell SDK (Microsoft.Graph.Identity.DirectoryManagement) if automating the audit, scope Organization.Read.All$prq$
  ),
  $apath$Microsoft 365 admin center → Billing → Your products → select the subscription → Remove licenses$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Confirm the real unassigned-seat count per SKU before acting — this is prepaid seats minus consumed seats, not a row count of subscribed SKUs:$stp$, 'code', $cod$Connect-MgGraph -Scopes 'Organization.Read.All'

Get-MgSubscribedSku -All |
  Where-Object { $_.PrepaidUnits.Enabled -gt $_.ConsumedUnits } |
  Select-Object SkuPartNumber,
    @{N='Purchased';E={$_.PrepaidUnits.Enabled}},
    ConsumedUnits,
    @{N='Unassigned';E={$_.PrepaidUnits.Enabled - $_.ConsumedUnits}}$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$If the unassigned seats are earmarked for near-term onboarding (new hires already scheduled), leave them — this finding is only actionable where the gap has no near-term owner.$stp$),
    jsonb_build_object('text', $stp$Where the gap is genuinely unneeded, reduce the subscription's total license quantity in Billing → Your products → select the subscription → Remove licenses, entering the new (lower) total under New quantity. Removal is only available within a limited window after purchase/renewal when recurring billing is on — see [Buy or remove licenses](https://learn.microsoft.com/en-us/microsoft-365/commerce/licenses/buy-licenses); outside that window, the change takes effect at the next renewal.$stp$)
  ),
  $eo$The subscription's total license quantity matches real assigned need, plus only the near-term onboarding buffer the business actually intends to use — no seats are carried unassigned indefinitely across renewal cycles.$eo$,
  $vs$Re-run the unassigned-seat query after the change and confirm the gap for the adjusted SKU(s) has closed to the intended buffer.$vs$,
  $vc$Get-MgSubscribedSku -All | Select-Object SkuPartNumber, @{N='Purchased';E={$_.PrepaidUnits.Enabled}}, ConsumedUnits$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/microsoft-365/commerce/licenses/buy-licenses$url$,
    $url$https://learn.microsoft.com/en-us/powershell/module/microsoft.graph.identity.directorymanagement/get-mgsubscribedsku$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02; Microsoft Graph PowerShell SDK (Microsoft.Graph.Identity.DirectoryManagement)$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2050) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'admin_center_only',
  $note$Removing licenses from a subscription is a billing/commerce action taken on the subscription itself, not a per-user Graph operation — there is no API to resize purchased quantity, which is why this stays admin_center_only. Prepaid (product-key) subscriptions can't have licenses removed at all; they require renewing with a smaller-quantity key instead.$note$
),

-- ─────────────────────────────────────────────────────────────────────────────
(
  'cost:utilization-by-sku',
  $ttl$Right-size subscription quantities against real per-SKU utilization$ttl$,
  $sum$This is the percentage of each SKU's purchased seats that are actually assigned — the same purchased-vs-consumed figures as the license count and unused/unassigned findings, expressed as a rate rather than a raw count, which is what makes a persistently low-utilization SKU visible for renewal negotiation even when the absolute seat count looks small. A SKU sitting well under full utilization release after release is either over-purchased for the tenant's real headcount or was sized for a project/season that has since ended, and is the figure to bring into a renewal conversation to right-size the subscription going forward rather than auto-renewing the same quantity indefinitely.$sum$,
  jsonb_build_array(
    $prq$License Administrator to view per-SKU assignment figures$prq$,
    $prq$Billing account/profile owner or contributor (Microsoft Customer Agreement) or Billing Administrator (Microsoft Online Subscription Agreement) to change a subscription's quantity at renewal$prq$,
    $prq$Microsoft Graph PowerShell SDK (Microsoft.Graph.Identity.DirectoryManagement) if automating, scope Organization.Read.All$prq$
  ),
  $apath$Microsoft 365 admin center → Billing → Your products (per-subscription total vs. assigned) and → select a subscription → Renewal settings (to change the quantity that renews)$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Compute real utilization per SKU rather than reading it off a single snapshot — track it over at least one full billing cycle before acting, since a temporary dip (e.g. mid-onboarding) is not the same as sustained low utilization:$stp$, 'code', $cod$Connect-MgGraph -Scopes 'Organization.Read.All'

Get-MgSubscribedSku -All |
  Select-Object SkuPartNumber,
    @{N='Purchased';E={$_.PrepaidUnits.Enabled}},
    ConsumedUnits,
    @{N='UtilizationPct';E={ if ($_.PrepaidUnits.Enabled -gt 0) { [math]::Round(100 * $_.ConsumedUnits / $_.PrepaidUnits.Enabled, 1) } else { $null } }} |
  Sort-Object UtilizationPct$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$For any SKU showing sustained low utilization with no near-term hiring/project plan to close the gap, reduce the renewing quantity ahead of the subscription's renewal date rather than letting it auto-renew at the current count — go to the subscription's Renewal settings in Billing → Your products, or use Remove licenses if within the removal window; see [Buy or remove licenses](https://learn.microsoft.com/en-us/microsoft-365/commerce/licenses/buy-licenses).$stp$)
  ),
  $eo$Each SKU's purchased quantity tracks its real, sustained utilization rate rather than a historical high-water mark — low-utilization SKUs are right-sized at renewal instead of auto-renewing unchanged.$eo$,
  $vs$Re-run the per-SKU utilization query after the renewal change takes effect and confirm the adjusted SKU's utilization percentage has moved back toward the tenant's target range.$vs$,
  $vc$Get-MgSubscribedSku -All | Select-Object SkuPartNumber, @{N='Purchased';E={$_.PrepaidUnits.Enabled}}, ConsumedUnits$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/powershell/module/microsoft.graph.identity.directorymanagement/get-mgsubscribedsku$url$,
    $url$https://learn.microsoft.com/en-us/microsoft-365/commerce/licenses/buy-licenses$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02; Microsoft Graph PowerShell SDK (Microsoft.Graph.Identity.DirectoryManagement)$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2050) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'admin_center_only',
  $note$Same underlying commerce-only constraint as cost:unused-unassigned-licenses: changing a subscription's renewing quantity is a billing action with no Graph API equivalent, so this stays admin_center_only even though the underlying utilization figure is fully scriptable to read.$note$
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
VALUES ('2026-09-02-remediation-kb-cost-domain-2050.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
