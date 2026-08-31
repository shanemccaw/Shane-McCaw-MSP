-- #1924 — Remediation knowledge base: the identity: domain, authored & published.
--
-- Populates remediation_knowledge_base with verified "this is wrong → here is how
-- to fix it" content for EVERY active identity: check (29 rows). Before this the
-- table held one draft example row and zero published rows, so every identity
-- finding fell through to the AI fallback (#1539 built the fix-route dimension this
-- content feeds; this issue supplies the content).
--
-- AUTHORING STANDARD (see #1924):
--   * Every row is verified against real Microsoft Learn / official Microsoft docs
--     that were actually fetched in build session #1924 (2026-08-31). The URLs in
--     source_urls are those pages.
--   * verified_by is an HONEST AGENT attribution — never a human name. The content
--     is agent-authored and awaiting a human spot-check (filed as a Shane To-Do).
--   * Tenant-specific values use angle-bracket placeholders (<UserObjectId>, …),
--     never a fabricated real value.
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

-- ─────────────────────────────────────────────────────────────────────────────
-- CLUSTER: Conditional Access core
-- ─────────────────────────────────────────────────────────────────────────────

(
  'identity:ca-mfa-coverage',
  $ttl$Require multifactor authentication for all users$ttl$,
  $sum$No enforcing Conditional Access policy requires MFA for standard sign-in, so a single stolen or phished password is enough to fully take over an account. Microsoft's own research puts the reduction in compromise likelihood from MFA at more than 99.9%, which makes this the highest-leverage identity control in the tenant — without it, most other Conditional Access controls are moot because credential theft alone grants access. A policy that exists but sits in report-only (never promoted to On) counts as absent here: it challenges no one.$sum$,
  jsonb_build_array(
    $prq$Conditional Access Administrator (or Security/Global Administrator) to create the policy$prq$,
    $prq$Microsoft Entra ID P1 (or Microsoft 365 Business Premium) tenant-wide — Conditional Access itself requires it$prq$,
    $prq$Microsoft Graph PowerShell SDK (Microsoft.Graph.Identity.SignIns) if automating, with scopes Policy.ReadWrite.ConditionalAccess, Policy.Read.All$prq$,
    $prq$At least one break-glass / emergency-access account already in place to exclude before enforcing$prq$
  ),
  $apath$Microsoft Entra admin center → Protection → Conditional Access → Policies → New policy (or Create new policy from templates → Secure foundation → "Require multifactor authentication for all users")$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$As at least a Conditional Access Administrator, go to Entra ID → Conditional Access → Policies → New policy.$stp$),
    jsonb_build_object('text', $stp$Assignments → Users: Include All users; Exclude your break-glass account(s) and (if hybrid) the Directory Synchronization Accounts role. Target resources → Include All resources.$stp$),
    jsonb_build_object('text', $stp$Access controls → Grant → Require authentication strength → built-in "Multifactor authentication" (or, where external authentication methods are in use and authentication strength is incompatible, the plain "Require multifactor authentication" grant control).$stp$),
    jsonb_build_object('text', $stp$Set Enable policy to Report-only, create it, review impact, then switch to On. To automate instead of using the portal (portal remains Microsoft's recommended path), create the policy in report-only state via Graph PowerShell:$stp$, 'code', $cod$Connect-MgGraph -Scopes 'Policy.ReadWrite.ConditionalAccess','Policy.Read.All','Application.Read.All'
$params = @{
  displayName = "Require MFA for all users"
  state       = "enabledForReportingButNotEnforced"
  conditions  = @{
    clientAppTypes = @("all")
    applications   = @{ includeApplications = @("All") }
    users          = @{ includeUsers = @("All"); excludeUsers = @("<BreakGlassUserObjectId>") }
  }
  grantControls = @{ operator = "OR"; builtInControls = @("mfa") }
}
New-MgIdentityConditionalAccessPolicy -BodyParameter $params$cod$, 'codeLanguage', $lng$powershell$lng$)
  ),
  $eo$An enabled Conditional Access policy (state = enabled, not report-only) requires MFA / authentication strength for all users on all resources, excluding only the break-glass/service accounts.$eo$,
  $vs$Confirm the policy's Enable state is On (not Report-only) and that sign-in logs show real Success/Failure results tied to it rather than "Report-only" entries.$vs$,
  $vc$Get-MgIdentityConditionalAccessPolicy -All | Where-Object { $_.GrantControls.BuiltInControls -contains "mfa" -and $_.State -eq "enabled" } | Format-List DisplayName, State$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/entra/identity/conditional-access/policy-all-users-mfa-strength$url$,
    $url$https://learn.microsoft.com/en-us/entra/identity/conditional-access/overview$url$,
    $url$https://learn.microsoft.com/en-us/powershell/module/microsoft.graph.identity.signins/new-mgidentityconditionalaccesspolicy?view=graph-powershell-1.0$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-08-31; Microsoft Graph PowerShell SDK (Microsoft.Graph.Identity.SignIns)$vag$,
  '2026-08-31'::timestamptz,
  $vby$Claude Opus 4.8 (build #1924) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$Requires Entra ID P1. Authentication strength is Microsoft's current recommendation but is incompatible with external authentication methods — use the plain mfa grant control in that case. Always start report-only to avoid locking out a legitimate flow.$note$
),

(
  'identity:ca-legacy-auth-block',
  $ttl$Block legacy authentication with Conditional Access$ttl$,
  $sum$Legacy protocols (POP, IMAP, SMTP AUTH, older Exchange ActiveSync / "Other clients") cannot carry an MFA or Conditional Access challenge — a policy can only block them outright. Microsoft's analysis attributes more than 97% of credential-stuffing and more than 99% of password-spray attacks to legacy authentication, so leaving it open is a direct bypass of every MFA policy elsewhere: a stolen password alone succeeds over these protocols.$sum$,
  jsonb_build_array(
    $prq$Conditional Access Administrator to create the policy$prq$,
    $prq$Microsoft Entra ID P1 (tenants without Conditional Access licensing can use Security Defaults for a coarser tenant-wide block instead)$prq$,
    $prq$Reports Reader to review sign-in logs for legacy-auth usage before blocking$prq$,
    $prq$Microsoft Graph PowerShell SDK (Microsoft.Graph.Identity.SignIns) if automating, scope Policy.ReadWrite.ConditionalAccess$prq$
  ),
  $apath$Microsoft Entra admin center → Protection → Conditional Access → Policies → New policy (or template: Secure foundation → "Block legacy authentication")$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$First confirm real usage so you don't break a live client: Entra ID → Monitoring & health → Sign-in logs, add the Client App column and filter to the legacy protocols, and repeat on the "User sign-ins (non-interactive)" tab. Cross-check the "Sign-ins using legacy authentication" workbook.$stp$),
    jsonb_build_object('text', $stp$New policy → Assignments → Include All users; Exclude at least one break-glass account and any account that genuinely still needs legacy auth. Target resources → Include All resources.$stp$),
    jsonb_build_object('text', $stp$Conditions → Client apps → Configure = Yes → check only "Exchange ActiveSync clients" and "Other clients". Access controls → Grant → Block access.$stp$),
    jsonb_build_object('text', $stp$Set Enable policy to Report-only, review impact, then switch to On. Graph PowerShell equivalent (report-only state):$stp$, 'code', $cod$Connect-MgGraph -Scopes 'Policy.ReadWrite.ConditionalAccess','Policy.Read.All'
$params = @{
  displayName = "Block legacy authentication"
  state       = "enabledForReportingButNotEnforced"
  conditions  = @{
    clientAppTypes = @("exchangeActiveSync","other")
    applications   = @{ includeApplications = @("All") }
    users          = @{ includeUsers = @("All"); excludeUsers = @("<BreakGlassUserObjectId>") }
  }
  grantControls = @{ operator = "OR"; builtInControls = @("block") }
}
New-MgIdentityConditionalAccessPolicy -BodyParameter $params$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Optionally close the protocol at the Exchange Online layer too by assigning an authentication policy that disables Basic auth (a newly created policy with no switches blocks Basic auth for all protocols by default). Skip if Security Defaults is already enabled, which disables Basic auth tenant-wide.$stp$, 'code', $cod$# Exchange Online PowerShell (Connect-ExchangeOnline first)
New-AuthenticationPolicy -Name "Block Basic Auth"
Set-OrganizationConfig -DefaultAuthenticationPolicy "Block Basic Auth"$cod$, 'codeLanguage', $lng$powershell$lng$)
  ),
  $eo$An enabled policy blocks Exchange ActiveSync and "Other clients" (legacy/basic-auth) sign-ins for included users; modern-auth clients are unaffected. Any client still attempting legacy auth shows as a Failure with a Conditional Access block reason in the sign-in logs.$eo$,
  $vs$Re-run the legacy-protocol filter on the sign-in logs after enforcement and confirm attempts now show Failure against this policy rather than Success.$vs$,
  $vc$Get-MgIdentityConditionalAccessPolicy -All | Where-Object { ($_.Conditions.ClientAppTypes -contains "exchangeActiveSync" -or $_.Conditions.ClientAppTypes -contains "other") -and $_.GrantControls.BuiltInControls -contains "block" } | Format-List DisplayName, State$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/entra/identity/conditional-access/policy-block-legacy-authentication$url$,
    $url$https://learn.microsoft.com/en-us/entra/identity/conditional-access/concept-conditional-access-policy-common$url$,
    $url$https://learn.microsoft.com/en-us/exchange/clients-and-mobile-in-exchange-online/disable-basic-authentication-in-exchange-online$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-08-31; Microsoft Graph PowerShell SDK (Microsoft.Graph.Identity.SignIns); Exchange Online Management V3$vag$,
  '2026-08-31'::timestamptz,
  $vby$Claude Opus 4.8 (build #1924) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$Use exchangeActiveSync (not the deprecated easUnsupported enum). Start report-only — blocking cold can break a still-in-use POP/IMAP/older-EAS workflow.$note$
),

(
  'identity:ca-device-compliance',
  $ttl$Require a compliant device for access$ttl$,
  $sum$Without a device-compliance grant control, a stolen or unmanaged/unpatched device that holds a valid MFA-satisfied session can still reach corporate data — MFA proves who is signing in, not whether the device is secure. Tying access to Intune compliance closes the device-based compromise gap (lost laptop, malware-infected home PC, jailbroken phone) that MFA alone leaves open.$sum$,
  jsonb_build_array(
    $prq$Microsoft Intune deployed with at least one device compliance policy already created AND at least one device confirmed compliant (the Conditional Access policy is documented as non-functional otherwise)$prq$,
    $prq$Conditional Access Administrator to create the policy$prq$,
    $prq$Microsoft Entra ID P1 AND Intune licensing$prq$,
    $prq$Microsoft Graph PowerShell SDK (Microsoft.Graph.Identity.SignIns) if automating$prq$
  ),
  $apath$Microsoft Entra admin center → Protection → Conditional Access → Policies → New policy (device compliance policies themselves live in Microsoft Intune admin center → Devices → Compliance policies)$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$In the Intune admin center, create a device compliance policy and confirm at least one device reports compliant — this is a hard prerequisite per Microsoft's own warning; the CA policy will not function without it.$stp$),
    jsonb_build_object('text', $stp$Entra ID → Conditional Access → Policies → New policy → Assignments → Include All users; Exclude break-glass accounts (and Directory Synchronization Accounts if hybrid). Target resources → Include All resources.$stp$),
    jsonb_build_object('text', $stp$Access controls → Grant → "Require device to be marked as compliant" → Select. Set Enable policy to Report-only, review impact, then switch to On.$stp$),
    jsonb_build_object('text', $stp$Graph PowerShell equivalent (report-only state):$stp$, 'code', $cod$Connect-MgGraph -Scopes 'Policy.ReadWrite.ConditionalAccess','Policy.Read.All'
$params = @{
  displayName = "Require compliant device for all users"
  state       = "enabledForReportingButNotEnforced"
  conditions  = @{
    clientAppTypes = @("all")
    applications   = @{ includeApplications = @("All") }
    users          = @{ includeUsers = @("All"); excludeUsers = @("<BreakGlassUserObjectId>") }
  }
  grantControls = @{ operator = "OR"; builtInControls = @("compliantDevice") }
}
New-MgIdentityConditionalAccessPolicy -BodyParameter $params$cod$, 'codeLanguage', $lng$powershell$lng$)
  ),
  $eo$Sign-ins to included resources are granted only from Intune-compliant devices; noncompliant/unmanaged devices are blocked even with a valid password plus MFA.$eo$,
  $vs$Attempt a sign-in from a known noncompliant device and confirm it is blocked, checking the Conditional Access tab on that sign-in in the logs.$vs$,
  $vc$Get-MgIdentityConditionalAccessPolicy -All | Where-Object { $_.GrantControls.BuiltInControls -contains "compliantDevice" -and $_.State -eq "enabled" } | Format-List DisplayName, State$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/entra/identity/conditional-access/policy-all-users-device-compliance$url$,
    $url$https://learn.microsoft.com/en-us/entra/identity/conditional-access/overview$url$,
    $url$https://learn.microsoft.com/en-us/powershell/module/microsoft.graph.identity.signins/new-mgidentityconditionalaccesspolicy?view=graph-powershell-1.0$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-08-31; Microsoft Graph PowerShell SDK (Microsoft.Graph.Identity.SignIns)$vag$,
  '2026-08-31'::timestamptz,
  $vby$Claude Opus 4.8 (build #1924) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$Requires Intune licensing in addition to Entra ID P1. Organizations not ready for all-user enforcement have named Microsoft alternatives: admin-only compliant/hybrid-joined, or "compliant OR hybrid-joined OR MFA" for all users.$note$
),

(
  'identity:ca-policy-count',
  $ttl$Deploy the baseline Conditional Access policy set$ttl$,
  $sum$Zero or near-zero Conditional Access policies means the tenant relies only on default Entra ID protection — no MFA enforcement, no legacy-auth block, no device or location controls. Microsoft's "Secure foundation" template group is eight baseline policies it recommends every organization deploy together, so the raw policy count is a direct proxy for how much of that recommended baseline actually exists.$sum$,
  jsonb_build_array(
    $prq$Security Reader to view/count existing policies; Conditional Access Administrator to create new ones$prq$,
    $prq$Microsoft Entra ID P1 license$prq$,
    $prq$Microsoft Graph PowerShell SDK (Microsoft.Graph.Identity.SignIns), scope Policy.Read.All, for programmatic counting$prq$
  ),
  $apath$Microsoft Entra admin center → Protection → Conditional Access → Overview (shows enabled vs report-only counts) or → Policies for the full list; deploy from Protection → Conditional Access → Create new policy from templates → Secure foundation$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Review the current count and the enabled-vs-report-only split under Entra ID → Conditional Access → Overview / Policies.$stp$),
    jsonb_build_object('text', $stp$If below baseline, deploy the Secure foundation template group together (Microsoft's own recommendation): require MFA for admins, secure security-info registration, block legacy auth, require MFA on Microsoft admin portals, require MFA for all users, require MFA for Azure management, require compliant-or-hybrid-joined-or-MFA for all users, and require compliant device. Create each from templates and leave in report-only until validated.$stp$),
    jsonb_build_object('text', $stp$Promote each validated policy from report-only to On, then re-count. (The paired checks identity:ca-mfa-coverage, identity:ca-legacy-auth-block, identity:ca-device-compliance and identity:ca-report-only cover the individual controls and their enforcement state.)$stp$)
  ),
  $eo$The tenant has a real, non-trivial set of Conditional Access policies in place — minimally the eight-policy Secure foundation baseline — with the intended policies showing State = enabled rather than stuck disabled or report-only.$eo$,
  $vs$Re-count via the admin center Overview tab or Graph and confirm the expected baseline policies exist and are enabled.$vs$,
  $vc$(Get-MgIdentityConditionalAccessPolicy -All).Count$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/entra/identity/conditional-access/concept-conditional-access-policy-common$url$,
    $url$https://learn.microsoft.com/en-us/entra/identity/conditional-access/overview$url$,
    $url$https://learn.microsoft.com/en-us/powershell/module/microsoft.graph.identity.signins/get-mgidentityconditionalaccesspolicy?view=graph-powershell-1.0$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-08-31; Microsoft Graph PowerShell SDK (Microsoft.Graph.Identity.SignIns)$vag$,
  '2026-08-31'::timestamptz,
  $vby$Claude Opus 4.8 (build #1924) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'admin_center_only',
  $note$Policy count alone is blunt — a tenant can have many policies all disabled or stuck report-only with zero real enforcement. The fix here is deploying the template group in the portal (no single fix command), so fix route is admin-centre; pair with the report-only and per-control checks.$note$
),

(
  'identity:ca-report-only',
  $ttl$Promote report-only Conditional Access policies to enforcing$ttl$,
  $sum$A policy stuck in report-only mode is evaluated and logged on every sign-in but never blocks or challenges anyone — it provides zero real protection while creating a false sense that an MFA/device/legacy-auth control is "in place". This is a common configuration-drift failure: the right policy gets built and tested, then the toggle to On is never flipped, leaving the tenant exactly as exposed as if the policy did not exist.$sum$,
  jsonb_build_array(
    $prq$Conditional Access Administrator to change a policy's state; Security Reader to view report-only impact$prq$,
    $prq$Microsoft Entra ID P1; a Log Analytics workspace receiving sign-in logs for workbook-based impact analysis$prq$,
    $prq$Microsoft Graph PowerShell SDK (Microsoft.Graph.Identity.SignIns), scope Policy.ReadWrite.ConditionalAccess$prq$
  ),
  $apath$Microsoft Entra admin center → Protection → Conditional Access → Policies → select policy → Enable policy toggle (Report-only → On)$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$List all policies under Entra ID → Conditional Access → Policies and identify every one whose state is Report-only.$stp$),
    jsonb_build_object('text', $stp$For each, review the Policy impact view (24h/7d/1 month) and/or the Conditional Access Insights and Reporting workbook and the sign-in logs' "Report-only" tab to confirm intended behavior before enforcing.$stp$),
    jsonb_build_object('text', $stp$Open the policy and move Enable policy from Report-only to On, then Save. Graph PowerShell equivalent:$stp$, 'code', $cod$Connect-MgGraph -Scopes 'Policy.ReadWrite.ConditionalAccess'
Update-MgIdentityConditionalAccessPolicy -ConditionalAccessPolicyId "<PolicyId>" -State "enabled"$cod$, 'codeLanguage', $lng$powershell$lng$)
  ),
  $eo$Every policy meant as a real control has state = enabled (not enabledForReportingButNotEnforced); sign-ins are actually blocked/challenged rather than merely logged.$eo$,
  $vs$List all policies and states — any that should be enforcing but still read enabledForReportingButNotEnforced is a finding — and confirm real Success/Failure (not "Report-only:") outcomes appear in the sign-in logs.$vs$,
  $vc$Get-MgIdentityConditionalAccessPolicy -All | Where-Object { $_.State -eq "enabledForReportingButNotEnforced" } | Select-Object DisplayName, State$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/entra/identity/conditional-access/concept-conditional-access-report-only$url$,
    $url$https://learn.microsoft.com/en-us/entra/identity/conditional-access/concept-conditional-access-policy-common$url$,
    $url$https://learn.microsoft.com/en-us/graph/api/resources/conditionalaccesspolicy?view=graph-rest-1.0$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-08-31; Microsoft Graph PowerShell SDK (Microsoft.Graph.Identity.SignIns)$vag$,
  '2026-08-31'::timestamptz,
  $vby$Claude Opus 4.8 (build #1924) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$The exact API enum for report-only is enabledForReportingButNotEnforced — get this string right in tooling. Do not blindly enforce a policy whose report-only impact you have not reviewed.$note$
),

(
  'identity:named-locations',
  $ttl$Define named locations for Conditional Access$ttl$,
  $sum$With no named locations defined, the tenant cannot use location as a Conditional Access signal at all — it cannot mark its own office/VPN ranges trusted to reduce friction there, and it cannot build country-based blocks against geographies the business never operates in, a standard low-effort way to cut opportunistic attacks. It also deprives Entra ID Protection's risk engine of the trusted-location signal that normally improves risk scoring.$sum$,
  jsonb_build_array(
    $prq$Conditional Access Administrator$prq$,
    $prq$Microsoft Entra ID P1 license$prq$,
    $prq$For GPS-based country locations, users need the Microsoft Authenticator app with location permission granted$prq$,
    $prq$Microsoft Graph PowerShell SDK (Microsoft.Graph.Identity.SignIns), scope Policy.ReadWrite.ConditionalAccess, for scripted creation$prq$
  ),
  $apath$Microsoft Entra admin center → Protection → Conditional Access → Named locations → New location (IP ranges location or Countries location)$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Go to Entra ID → Conditional Access → Named locations.$stp$),
    jsonb_build_object('text', $stp$For trusted networks: New location → IP ranges location, name it, enter the organization's real public CIDR ranges (mask greater than /8), optionally mark as trusted. For country/region locations: New location → Countries location, choose "Determine location by IP address" (or GPS via Authenticator for stricter cases), add the relevant countries.$stp$),
    jsonb_build_object('text', $stp$Reference the new named location(s) in a Conditional Access policy's Assignments → Network condition. Graph PowerShell equivalent for both types:$stp$, 'code', $cod$Connect-MgGraph -Scopes 'Policy.ReadWrite.ConditionalAccess'
# IP-range named location (e.g. corporate office/VPN range)
$ipParams = @{
  "@odata.type" = "#microsoft.graph.ipNamedLocation"
  DisplayName   = "<CorporateOfficeRange>"
  IsTrusted     = $true
  IpRanges      = @(@{ "@odata.type" = "#microsoft.graph.iPv4CidrRange"; CidrAddress = "<PublicIPv4CIDR>" })
}
New-MgIdentityConditionalAccessNamedLocation -BodyParameter $ipParams

# Country named location (e.g. to support a block-by-country policy)
$countryParams = @{
  "@odata.type"                     = "#microsoft.graph.countryNamedLocation"
  DisplayName                       = "<AllowedOperatingCountries>"
  CountriesAndRegions               = @("US","CA")
  IncludeUnknownCountriesAndRegions = $false
}
New-MgIdentityConditionalAccessNamedLocation -BodyParameter $countryParams$cod$, 'codeLanguage', $lng$powershell$lng$)
  ),
  $eo$At least one named location (trusted IP range and/or country list) exists that Conditional Access policies can reference under the Network condition.$eo$,
  $vs$List named locations and confirm the new entries appear with the correct type, ranges/countries and trusted flag, and that a policy referencing them evaluates as expected in the sign-in logs.$vs$,
  $vc$Get-MgIdentityConditionalAccessNamedLocation -All | Select-Object DisplayName, Id$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/entra/identity/conditional-access/concept-assignment-network$url$,
    $url$https://learn.microsoft.com/en-us/powershell/module/microsoft.graph.identity.signins/new-mgidentityconditionalaccessnamedlocation?view=graph-powershell-1.0$url$,
    $url$https://learn.microsoft.com/en-us/powershell/module/microsoft.graph.identity.signins/get-mgidentityconditionalaccessnamedlocation?view=graph-powershell-1.0$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-08-31; Microsoft Graph PowerShell SDK (Microsoft.Graph.Identity.SignIns)$vag$,
  '2026-08-31'::timestamptz,
  $vby$Claude Opus 4.8 (build #1924) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$Hard platform limits: no more than 195 named locations and no more than 2000 IP ranges per named location. GPS-based country locations carry real UX friction (recurring Authenticator prompts) — reserve for very sensitive apps.$note$
),

-- ─────────────────────────────────────────────────────────────────────────────
-- CLUSTER: Conditional Access — risk, guests, legacy
-- ─────────────────────────────────────────────────────────────────────────────

(
  'identity:signin-risk-policy',
  $ttl$Create a sign-in risk Conditional Access policy$ttl$,
  $sum$Sign-in risk is a real-time Entra ID Protection signal (the probability a given authentication attempt is not authorized). Without a sign-in-risk-based Conditional Access policy, medium/high-risk sign-ins (impossible travel, anonymized IP, malware-linked IP, leaked-credential patterns) are granted the same access as any normal sign-in with no automated MFA challenge or block. This control self-remediates — a successful MFA challenge closes the risk event without admin intervention — which makes it one of the highest-leverage identity controls available.$sum$,
  jsonb_build_array(
    $prq$Microsoft Entra ID P2 or Microsoft Entra Suite — risk-based access policies require it (a real license gate, not a toggle)$prq$,
    $prq$Conditional Access Administrator to create the policy$prq$,
    $prq$Users must have a registered MFA method to self-remediate; unregistered users are blocked outright$prq$,
    $prq$Microsoft Graph PowerShell SDK (Microsoft.Graph.Identity.SignIns) if automating, scopes Policy.ReadWrite.ConditionalAccess, Policy.Read.All$prq$
  ),
  $apath$Microsoft Entra admin center → Protection → Conditional Access → Policies → New policy$apath$,
  $aurl$https://entra.microsoft.com/#view/Microsoft_AAD_ConditionalAccess/ConditionalAccessBlade/~/Policies$aurl$,
  jsonb_build_array(
    jsonb_build_object('text', $stp$New policy → Assignments → Users: Include All users; Exclude your break-glass account group. Target resources → Include All resources.$stp$),
    jsonb_build_object('text', $stp$Conditions → Sign-in risk → Configure = Yes → select High and Medium. Access controls → Grant → Require authentication strength → Multifactor authentication. Session → Sign-in frequency → Every time.$stp$),
    jsonb_build_object('text', $stp$Set Enable policy to Report-only, review impact, then switch to On. Graph PowerShell equivalent (report-only state):$stp$, 'code', $cod$Connect-MgGraph -Scopes 'Policy.ReadWrite.ConditionalAccess','Policy.Read.All'
$params = @{
  displayName = "Sign-in risk - Require MFA (Medium/High)"
  state       = "enabledForReportingButNotEnforced"
  conditions  = @{
    signInRiskLevels = @("high","medium")
    clientAppTypes   = @("all")
    applications     = @{ includeApplications = @("All") }
    users            = @{ includeUsers = @("All"); excludeGroups = @("<BreakGlassGroupId>") }
  }
  grantControls = @{ operator = "OR"; builtInControls = @("mfa") }
}
New-MgIdentityConditionalAccessPolicy -BodyParameter $params$cod$, 'codeLanguage', $lng$powershell$lng$)
  ),
  $eo$A Conditional Access policy targeting signInRiskLevels [high, medium] exists with state = enabled, enforcing an MFA / authentication-strength challenge on risky sign-ins.$eo$,
  $vs$Query existing Conditional Access policies and confirm at least one has a non-empty sign-in-risk condition and state = enabled.$vs$,
  $vc$Get-MgIdentityConditionalAccessPolicy -All | Where-Object { $_.Conditions.SignInRiskLevels.Count -gt 0 -and $_.State -eq "enabled" } | Format-List DisplayName, State$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/entra/id-protection/concept-identity-protection-policies$url$,
    $url$https://learn.microsoft.com/en-us/entra/id-protection/howto-identity-protection-configure-risk-policies$url$,
    $url$https://learn.microsoft.com/en-us/powershell/module/microsoft.graph.identity.signins/new-mgidentityconditionalaccesspolicy?view=graph-powershell-1.0$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-08-31; Microsoft Graph PowerShell SDK (Microsoft.Graph.Identity.SignIns)$vag$,
  '2026-08-31'::timestamptz,
  $vby$Claude Opus 4.8 (build #1924) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$Requires Entra ID P2. Microsoft explicitly says do NOT combine sign-in risk and user risk in the same policy — keep them separate. The legacy Identity Protection risk policy surface (distinct from Conditional Access) retires 2026-10-01; a legacy-surface policy should be migrated to Conditional Access.$note$
),

(
  'identity:user-risk-policy',
  $ttl$Create a user risk Conditional Access policy$ttl$,
  $sum$User risk reflects the probability that an account itself is compromised (leaked credentials, confirmed compromise, risky sign-in history), as distinct from a single risky authentication attempt. Without a user-risk Conditional Access policy, an account Microsoft has flagged as likely compromised keeps normal access indefinitely — there is no forced remediation (secure password change or block) tied to the account-level risk score.$sum$,
  jsonb_build_array(
    $prq$Microsoft Entra ID P2 or Microsoft Entra Suite$prq$,
    $prq$Conditional Access Administrator$prq$,
    $prq$Password writeback enabled for any hybrid users expected to self-remediate via password change$prq$,
    $prq$Users pre-registered for MFA (otherwise they are blocked rather than able to self-remediate)$prq$
  ),
  $apath$Microsoft Entra admin center → Protection → Conditional Access → Policies → New policy$apath$,
  $aurl$https://entra.microsoft.com/#view/Microsoft_AAD_ConditionalAccess/ConditionalAccessBlade/~/Policies$aurl$,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Create a SEPARATE policy from the sign-in-risk one → Assignments → Users: Include All users; Exclude your break-glass group and (recommended) an external-users group, because user-risk remediation cannot complete for guests. Target resources → Include All resources.$stp$),
    jsonb_build_object('text', $stp$Conditions → User risk → Configure = Yes → select High. Access controls → Grant → Require risk remediation (this applies the Every-time sign-in frequency automatically).$stp$),
    jsonb_build_object('text', $stp$Set Enable policy to Report-only, review impact, then switch to On. Graph PowerShell equivalent (report-only state; portal remains Microsoft's recommended route — verify the risk-remediation grant control against your current SDK):$stp$, 'code', $cod$Connect-MgGraph -Scopes 'Policy.ReadWrite.ConditionalAccess','Policy.Read.All'
$params = @{
  displayName = "User risk (High) - Require remediation"
  state       = "enabledForReportingButNotEnforced"
  conditions  = @{
    userRiskLevels = @("high")
    clientAppTypes = @("all")
    applications   = @{ includeApplications = @("All") }
    users          = @{ includeUsers = @("All"); excludeGroups = @("<BreakGlassGroupId>","<ExternalUsersGroupId>") }
  }
  grantControls = @{ operator = "OR"; builtInControls = @("passwordChange","mfa") }
}
New-MgIdentityConditionalAccessPolicy -BodyParameter $params$cod$, 'codeLanguage', $lng$powershell$lng$)
  ),
  $eo$A Conditional Access policy with userRiskLevels [high] and state = enabled forces remediation (secure password change or session revocation plus reauth) before a flagged account can continue normal access, and it is a distinct policy object from the sign-in-risk policy.$eo$,
  $vs$Confirm a Conditional Access policy exists with a non-empty user-risk condition and state = enabled, separate from the sign-in-risk policy.$vs$,
  $vc$Get-MgIdentityConditionalAccessPolicy -All | Where-Object { $_.Conditions.UserRiskLevels.Count -gt 0 -and $_.State -eq "enabled" } | Format-List DisplayName, State$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/entra/id-protection/concept-identity-protection-policies$url$,
    $url$https://learn.microsoft.com/en-us/entra/id-protection/howto-identity-protection-configure-risk-policies$url$,
    $url$https://learn.microsoft.com/en-us/entra/external-id/authentication-conditional-access$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-08-31; Microsoft Graph PowerShell SDK (Microsoft.Graph.Identity.SignIns)$vag$,
  '2026-08-31'::timestamptz,
  $vby$Claude Opus 4.8 (build #1924) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$Requires Entra ID P2. "Require risk remediation" is not supported for external/guest users (no session revocation for them) — exclude an external-users group rather than disabling the check. Do not assign a user to both a password-change and a risk-remediation policy.$note$
),

(
  'identity:guest-mfa-enforcement',
  $ttl$Require MFA for guest and external users$ttl$,
  $sum$Guest/external accounts are frequently excluded — deliberately or by oversight — from an org's general MFA policy, and older tenants may never have created a "Guest or external users" Conditional Access rule. An unauthenticated-strength guest account is a soft spot: it holds real (if limited) access to shared resources but sits entirely outside the org's identity-lifecycle and endpoint controls. Enforcement here is a standard grant-control policy, licensed at P1 (a lower bar than the P2 risk-based checks).$sum$,
  jsonb_build_array(
    $prq$Microsoft Entra ID P1 for Conditional Access$prq$,
    $prq$Conditional Access Administrator to create the policy$prq$,
    $prq$If trusting MFA satisfied in the guest's home tenant instead of your own, cross-tenant access inbound trust for MFA claims must be explicitly configured (off by default)$prq$
  ),
  $apath$Microsoft Entra admin center → Protection → Conditional Access → Policies → New policy$apath$,
  $aurl$https://entra.microsoft.com/#view/Microsoft_AAD_ConditionalAccess/ConditionalAccessBlade/~/Policies$aurl$,
  jsonb_build_array(
    jsonb_build_object('text', $stp$New policy → name it (e.g. "Require MFA for guest/external users").$stp$),
    jsonb_build_object('text', $stp$Assignments → Users → Include → Select users and groups → "Guest or external users" → choose the sub-type(s) to cover (at minimum B2B collaboration guest users; add B2B collaboration member users / B2B direct connect users / Other external users as applicable to your tenant's real guest population).$stp$),
    jsonb_build_object('text', $stp$Target resources → Include All resources (or scope to the specific apps guests access). Access controls → Grant → Require multifactor authentication.$stp$),
    jsonb_build_object('text', $stp$Set Enable policy to Report-only, review impact, then switch to On. If B2B direct connect users are in scope, separately configure inbound cross-tenant trust settings to accept MFA claims from the partner org, or their access is blocked rather than challenged.$stp$)
  ),
  $eo$A Conditional Access policy with state = enabled targets the guest/external population (conditions.users.includeGuestsOrExternalUsers) and includes mfa as a grant control.$eo$,
  $vs$Confirm the policy's user condition references guests/external users (not merely "All users") and that mfa is a grant control; the query returns nothing when no such policy exists, which is itself the finding.$vs$,
  $vc$Get-MgIdentityConditionalAccessPolicy -All | Where-Object { $_.Conditions.Users.IncludeGuestsOrExternalUsers -ne $null -and $_.GrantControls.BuiltInControls -contains "mfa" } | Format-List DisplayName, State$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/entra/external-id/b2b-tutorial-require-mfa$url$,
    $url$https://learn.microsoft.com/en-us/entra/external-id/authentication-conditional-access$url$,
    $url$https://learn.microsoft.com/en-us/powershell/module/microsoft.graph.identity.signins/new-mgidentityconditionalaccesspolicy?view=graph-powershell-1.0$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-08-31; Microsoft Graph PowerShell SDK (Microsoft.Graph.Identity.SignIns)$vag$,
  '2026-08-31'::timestamptz,
  $vby$Claude Opus 4.8 (build #1924) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'admin_center_only',
  $note$Microsoft's documented walkthrough for targeting guest sub-types is portal-only, so this is authored as an admin-centre fix (the validation query above is a read only). For non-Entra external identities (email OTP, SAML/WS-Fed, social), authentication STRENGTH policies are unsupported — use the plain MFA grant control for those.$note$
),

(
  'identity:continuous-access-evaluation',
  $ttl$Re-enable Continuous Access Evaluation where a policy disabled it$ttl$,
  $sum$Continuous Access Evaluation (CAE) is Microsoft's near-real-time token-revocation mechanism for Exchange Online, SharePoint Online and Teams — it is what makes a disabled account, a password reset or a network-location change actually cut off an existing session within minutes instead of waiting up to the ~1-hour token lifetime. CAE ships on by default tenant-wide. The only way it is turned off for a scope is an admin explicitly authoring (or migrating into) a Conditional Access policy whose "Customize continuous access evaluation" session control is set to Disable, silently reintroducing revocation lag for those users/resources.$sum$,
  jsonb_build_array(
    $prq$Conditional Access Administrator to view/edit the offending policy$prq$,
    $prq$No special license beyond what Conditional Access already needs; CAE critical-event evaluation is available in all tenants$prq$,
    $prq$Reading the per-policy CAE mode programmatically currently requires the Microsoft Graph BETA endpoint — it is not in v1.0; the admin center portal surfaces and toggles it regardless$prq$
  ),
  $apath$Microsoft Entra admin center → Protection → Conditional Access → Policies → (open the flagged policy) → Session → Customize continuous access evaluation$apath$,
  $aurl$https://entra.microsoft.com/#view/Microsoft_AAD_ConditionalAccess/ConditionalAccessBlade/~/Policies$aurl$,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Open Conditional Access → Policies → the specific policy the finding names (by its id/displayName).$stp$),
    jsonb_build_object('text', $stp$Go to Session → Customize continuous access evaluation and change the setting from Disable back to the default (not customized), unless there is a documented, intentional reason that scope must run without CAE (e.g. a known-incompatible legacy client population under active migration).$stp$),
    jsonb_build_object('text', $stp$If the policy came from the legacy "CAE settings under Security" migration, decide during migration whether the Disabled setting should carry forward or be dropped. Save and confirm in the portal — there is no supported v1.0 Graph cmdlet to flip this for production use.$stp$)
  ),
  $eo$The named policy's session controls no longer set continuousAccessEvaluation.mode = disabled for its scope; that population returns to the tenant-default (auto-enabled) CAE behavior, restoring near-real-time revocation on critical events and location changes.$eo$,
  $vs$Re-open the specific policy's session controls in the admin center and confirm the CAE customization is no longer set to Disabled. (This property is not in Graph v1.0; validate in the portal, or via a read-only beta query for investigation only.)$vs$,
  NULL,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/entra/identity/conditional-access/concept-continuous-access-evaluation$url$,
    $url$https://learn.microsoft.com/en-us/entra/identity/conditional-access/concept-conditional-access-session$url$,
    $url$https://learn.microsoft.com/en-us/graph/api/resources/conditionalaccesssessioncontrols?view=graph-rest-1.0$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-08-31$vag$,
  '2026-08-31'::timestamptz,
  $vby$Claude Opus 4.8 (build #1924) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'admin_center_only',
  $note$The setting that creates this finding (continuousAccessEvaluation.mode) is documented only in Microsoft Graph BETA, not v1.0, as of 2026-08-31 — hence no validation_command and admin_center_only. CAE does not apply to Guest accounts at all; do not score CAE-disabled against guest-only-scoped policies as if fixing it would help them.$note$
),

(
  'identity:legacy-auth-usage',
  $ttl$Eliminate observed legacy-authentication sign-ins$ttl$,
  $sum$Legacy authentication protocols (POP, IMAP, SMTP AUTH, older EAS/EWS basic-auth flows) cannot carry an MFA or Conditional Access challenge — they can only be blocked. Observing any legacy-auth sign-ins in the logs means there is a live, unprotected credential path into the tenant right now: Microsoft attributes the large majority of credential-stuffing and password-spray attacks to legacy auth precisely because it bypasses MFA. Remediation is to block legacy auth (Conditional Access), disable Basic auth in Exchange Online, and migrate the offending clients.$sum$,
  jsonb_build_array(
    $prq$Reports Reader to view sign-in logs and the legacy-auth workbook$prq$,
    $prq$Conditional Access Administrator to create the blocking policy (tenants without Conditional Access licensing can use Security Defaults as a fallback)$prq$,
    $prq$Exchange admin role to manage per-mailbox authentication policy via Exchange Online Management V3$prq$,
    $prq$Microsoft Graph PowerShell SDK (Microsoft.Graph.Identity.SignIns) if automating the Conditional Access policy$prq$
  ),
  $apath$Investigate: Microsoft Entra admin center → Monitoring & health → Sign-in logs (Client App column/filter) and → Monitoring & health → Workbooks → "Sign-ins using legacy authentication". Remediate: Protection → Conditional Access → Policies → New policy$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Confirm the finding: Sign-in logs → add the Client App column → filter to the legacy protocols; repeat on the "User sign-ins (non-interactive)" tab. Use the "Sign-ins using legacy authentication" workbook for a per-user/per-app breakdown so real workflows are not broken blind.$stp$),
    jsonb_build_object('text', $stp$Block at the identity layer with a Conditional Access policy (see identity:ca-legacy-auth-block): Client apps condition → Exchange ActiveSync clients + Other clients → Grant → Block access, started in report-only. Graph PowerShell equivalent:$stp$, 'code', $cod$Connect-MgGraph -Scopes 'Policy.ReadWrite.ConditionalAccess','Policy.Read.All'
$params = @{
  displayName = "Block legacy authentication"
  state       = "enabledForReportingButNotEnforced"
  conditions  = @{
    clientAppTypes = @("exchangeActiveSync","other")
    applications   = @{ includeApplications = @("All") }
    users          = @{ includeUsers = @("All"); excludeUsers = @("<BreakGlassUserObjectId>") }
  }
  grantControls = @{ operator = "OR"; builtInControls = @("block") }
}
New-MgIdentityConditionalAccessPolicy -BodyParameter $params$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Also disable Basic auth at the Exchange Online layer (a second, independent control). A newly created authentication policy with no switches blocks Basic auth for all protocols by default; skip if Security Defaults is already enabled.$stp$, 'code', $cod$# Exchange Online PowerShell (Connect-ExchangeOnline first)
New-AuthenticationPolicy -Name "Block Basic Auth"
Set-OrganizationConfig -DefaultAuthenticationPolicy "Block Basic Auth"
Get-User -ResultSize unlimited | ForEach-Object { Set-User -Identity $_.Identity -AuthenticationPolicy "Block Basic Auth" }$cod$, 'codeLanguage', $lng$powershell$lng$)
  ),
  $eo$No further sign-ins using legacy protocols succeed; the sign-in logs show blocked attempts (Conditional Access block reason) for any client still trying legacy auth, and per-mailbox authentication policy shows Basic auth disabled for all protocols.$eo$,
  $vs$Re-run the legacy-protocol filter on the sign-in logs after rollout and confirm entries now show Failure with a Conditional Access block reason rather than Success.$vs$,
  $vc$Get-MgIdentityConditionalAccessPolicy -All | Where-Object { ($_.Conditions.ClientAppTypes -contains "exchangeActiveSync" -or $_.Conditions.ClientAppTypes -contains "other") -and $_.GrantControls.BuiltInControls -contains "block" } | Format-List DisplayName, State$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/entra/identity/conditional-access/policy-block-legacy-authentication$url$,
    $url$https://learn.microsoft.com/en-us/entra/identity/monitoring-health/workbook-legacy-authentication$url$,
    $url$https://learn.microsoft.com/en-us/exchange/clients-and-mobile-in-exchange-online/disable-basic-authentication-in-exchange-online$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-08-31; Microsoft Graph PowerShell SDK (Microsoft.Graph.Identity.SignIns); Exchange Online Management V3$vag$,
  '2026-08-31'::timestamptz,
  $vby$Claude Opus 4.8 (build #1924) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$Do not block cold — run the sign-in-log/workbook investigation first, or you can break a still-in-use POP/IMAP/older-EAS workflow. Use exchangeActiveSync (not the deprecated easUnsupported enum).$note$
),

-- ─────────────────────────────────────────────────────────────────────────────
-- CLUSTER: MFA & authentication methods
-- ─────────────────────────────────────────────────────────────────────────────

(
  'identity:mfa-registration',
  $ttl$Raise MFA registration coverage$ttl$,
  $sum$Low MFA registration coverage means a large share of accounts have no second factor at all, so any compromised password becomes an immediate account takeover with no further barrier. Microsoft's "Users capable of Azure multifactor authentication" metric is the coverage number to track — it counts users both registered for a strong method AND enabled by policy to use it. A registration campaign is the sanctioned, low-friction way to close the gap without a hard lockout.$sum$,
  jsonb_build_array(
    $prq$Authentication Policy Administrator to configure the registration campaign$prq$,
    $prq$The registration campaign itself has no license requirement; the Authentication Methods Activity report used to measure coverage needs Entra ID P1 or P2$prq$,
    $prq$Microsoft Graph PowerShell SDK (Microsoft.Graph.Reports for the coverage read; Policy.ReadWrite.AuthenticationMethod to set the campaign)$prq$
  ),
  $apath$Microsoft Entra admin center → Protection → Authentication methods → Registration campaign (to configure the nudge); → Authentication methods → Activity → Registration tab (to see coverage)$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Review current coverage: Entra ID → Authentication methods → Activity → Registration → "Users capable of Azure multifactor authentication".$stp$),
    jsonb_build_object('text', $stp$Turn on a registration campaign (nudge at sign-in) scoped to all users or the low-coverage group, targeting Microsoft Authenticator or a passkey. PATCH the authentication methods policy's registrationEnforcement section:$stp$, 'code', $cod$PATCH https://graph.microsoft.com/v1.0/policies/authenticationmethodspolicy
Content-Type: application/json

{
  "registrationEnforcement": {
    "authenticationMethodsRegistrationCampaign": {
      "state": "enabled",
      "snoozeDurationInDays": 1,
      "enforceRegistrationAfterAllowedSnoozes": true,
      "includeTargets": [
        { "id": "all_users", "targetType": "group", "targetedAuthenticationMethod": "microsoftAuthenticator" }
      ]
    }
  }
}$cod$, 'codeLanguage', $lng$http$lng$),
    jsonb_build_object('text', $stp$Pull the per-user gap list to prioritise outreach, then communicate the requirement to those users and re-check the Registration tab after 1–2 weeks.$stp$, 'code', $cod$Connect-MgGraph -Scopes 'AuditLog.Read.All'
Get-MgReportAuthenticationMethodUserRegistrationDetail -Filter "isMfaRegistered eq false" -All$cod$, 'codeLanguage', $lng$powershell$lng$)
  ),
  $eo$"Users capable of Azure multifactor authentication" rises toward the organization's target (Microsoft recommends approaching 100% for tenants requiring MFA); fewer accounts return isMfaRegistered = false.$eo$,
  $vs$Re-run the registration-detail query filtered on isMfaRegistered eq false and confirm the count trends down; cross-check the admin center Registration tab (it updates for most users within ~36 hours).$vs$,
  $vc$(Get-MgReportAuthenticationMethodUserRegistrationDetail -Filter "isMfaRegistered eq false" -All | Measure-Object).Count$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/entra/identity/authentication/howto-authentication-methods-activity$url$,
    $url$https://learn.microsoft.com/en-us/entra/identity/authentication/how-to-mfa-registration-campaign$url$,
    $url$https://learn.microsoft.com/en-us/graph/api/resources/userregistrationdetails?view=graph-rest-1.0$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-08-31; Microsoft Graph PowerShell SDK (Microsoft.Graph.Reports)$vag$,
  '2026-08-31'::timestamptz,
  $vby$Claude Opus 4.8 (build #1924) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$A registration campaign can target only one method at a time (Authenticator OR passkey), not both. The coverage report has up to 36 hours of latency — do not validate immediately after enabling.$note$
),

(
  'identity:mfa-method-breakdown',
  $ttl$Shift MFA off phishable SMS/voice toward phishing-resistant methods$ttl$,
  $sum$SMS and voice-call MFA are phishable (real-time relay, social engineering, SIM-swap), while FIDO2/passkeys, Windows Hello for Business and certificate-based MFA are verifier-bound and resist phishing by design. A tenant leaning on SMS/voice has a materially weaker posture even at "100% MFA registered", because registration coverage says nothing about phishing resistance. The fix is to enable and promote phishing-resistant methods and disable SMS/voice in the authentication methods policy.$sum$,
  jsonb_build_array(
    $prq$Authentication Policy Administrator to edit the authentication methods policy$prq$,
    $prq$Policy.ReadWrite.AuthenticationMethod Graph permission for the API/PowerShell route$prq$,
    $prq$Entra ID P1 or P2 to view the per-method usage breakdown in the Activity report$prq$,
    $prq$Broad phishing-resistant or Authenticator coverage confirmed BEFORE disabling SMS/voice, to avoid locking users out$prq$
  ),
  $apath$Microsoft Entra admin center → Protection → Authentication methods → Policies (per-method state); → Authentication methods → Activity → Registration → "Users registered by authentication method" (the SMS/voice vs phishing-resistant breakdown)$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Check the current method mix: Entra ID → Authentication methods → Activity → Registration → "Users registered by authentication method".$stp$),
    jsonb_build_object('text', $stp$Enable a phishing-resistant method (e.g. FIDO2/passkey) for the target group if not already enabled:$stp$, 'code', $cod$Connect-MgGraph -Scopes 'Policy.ReadWrite.AuthenticationMethod'
$params = @{
  "@odata.type"         = "#microsoft.graph.fido2AuthenticationMethodConfiguration"
  State                 = "enabled"
  IsAttestationEnforced = $false
}
Update-MgPolicyAuthenticationMethodPolicyAuthenticationMethodConfiguration -AuthenticationMethodConfigurationId "Fido2" -BodyParameter $params$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Only AFTER phishing-resistant/Authenticator methods are broadly registered, disable SMS (repeat for Voice with AuthenticationMethodConfigurationId "Voice" and the voiceAuthenticationMethodConfiguration @odata.type). Read the current state first to confirm the exact configuration before writing.$stp$, 'code', $cod$$params = @{
  "@odata.type" = "#microsoft.graph.smsAuthenticationMethodConfiguration"
  State         = "disabled"
}
Update-MgPolicyAuthenticationMethodPolicyAuthenticationMethodConfiguration -AuthenticationMethodConfigurationId "Sms" -BodyParameter $params$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$SMS/voice may also be reachable through the legacy MFA and SSPR policies — to fully prevent a method it must be disabled in ALL policies. Check Entra ID → Multifactor authentication → service settings and Entra ID → Password reset → Authentication methods for lingering allowances. Optionally pair with a Conditional Access authentication-strength requirement to actively require the stronger method.$stp$)
  ),
  $eo$"Users registered by authentication method" shows a declining SMS/voice count and a rising FIDO2/Windows Hello/Authenticator-passwordless count; the SMS and voice method configurations report state = disabled.$eo$,
  $vs$Re-fetch the SMS/voice configuration and confirm state = disabled, and re-check the registration breakdown report.$vs$,
  $vc$Get-MgPolicyAuthenticationMethodPolicyAuthenticationMethodConfiguration -AuthenticationMethodConfigurationId "Sms" | Select-Object Id, State$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/entra/identity/authentication/concept-authentication-methods-manage$url$,
    $url$https://learn.microsoft.com/en-us/entra/identity/authentication/concept-authentication-strengths$url$,
    $url$https://learn.microsoft.com/en-us/powershell/module/microsoft.graph.identity.signins/update-mgpolicyauthenticationmethodpolicyauthenticationmethodconfiguration?view=graph-powershell-1.0$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-08-31; Microsoft Graph PowerShell SDK (Microsoft.Graph.Identity.SignIns)$vag$,
  '2026-08-31'::timestamptz,
  $vby$Claude Opus 4.8 (build #1924) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$The resource types and the state enabled|disabled property are verified; confirm the exact "Sms"/"Voice" configuration-id casing with a Get before disabling in a real tenant. Never disable SMS/voice tenant-wide until phishing-resistant/Authenticator coverage is confirmed high — pilot on a test group first.$note$
),

(
  'identity:privileged-mfa-gap',
  $ttl$Close the MFA gap on privileged and standard accounts$ttl$,
  $sum$Privileged accounts (Global Admin, Exchange Admin, Security Admin, etc.) are the highest-value targets in the tenant, and any admin or standard account with zero registered MFA method is a direct compromise path. Microsoft's current guidance has moved past "just require MFA for admins" toward requiring the Phishing-resistant MFA authentication strength specifically for privileged roles, because password-plus-SMS is still phishable on an admin account. Closing an admin's zero-MFA gap removes what is functionally an open door to the tenant.$sum$,
  jsonb_build_array(
    $prq$Conditional Access Administrator to create the policy; Entra ID P1 for Conditional Access$prq$,
    $prq$Flagged admins must register a phishing-resistant method BEFORE the policy is enforced — enabling it without this risks locking you out of the tenant$prq$,
    $prq$A Temporary Access Pass for any admin with nothing registered yet; a break-glass account excluded from the policy$prq$,
    $prq$Microsoft Graph PowerShell SDK (Microsoft.Graph.Reports) to identify the gap$prq$
  ),
  $apath$Microsoft Entra admin center → Protection → Conditional Access → Policies → New policy (template "Require phishing-resistant MFA for admins" or manual authentication-strength configuration)$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Identify the gap — admins (and standard users) with no MFA method registered:$stp$, 'code', $cod$Connect-MgGraph -Scopes 'AuditLog.Read.All'
Get-MgReportAuthenticationMethodUserRegistrationDetail -Filter "isAdmin eq true and isMfaRegistered eq false" -All$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Have each flagged admin register a phishing-resistant method (passkey/FIDO2 or Windows Hello for Business); issue a Temporary Access Pass to any admin with nothing registered. Confirm a break-glass account is excluded from the new policy.$stp$),
    jsonb_build_object('text', $stp$Build the Conditional Access policy: Assignments → Users → Directory roles → select the privileged roles (Global Administrator, Application Administrator, Authentication Administrator, Billing Administrator, Cloud Application Administrator, Conditional Access Administrator, Exchange Administrator, Helpdesk Administrator, Password Administrator, Privileged Authentication Administrator, Privileged Role Administrator, Security Administrator, SharePoint Administrator, User Administrator); Exclude break-glass. Target resources → Include All resources. Grant → Require authentication strength → Phishing-resistant MFA strength. Enable in Report-only first, review, then On.$stp$),
    jsonb_build_object('text', $stp$For standard users with no MFA, drive registration via a registration campaign (see identity:mfa-registration), then require ordinary MFA via Conditional Access or registration enforcement.$stp$)
  ),
  $eo$The gap query (isAdmin eq true and isMfaRegistered eq false) returns zero results; privileged sign-ins are gated on FIDO2/Windows Hello/certificate-based MFA specifically, not SMS/voice; the phishing-resistant policy shows 0 or near-0 failures in report-only before it is turned On.$eo$,
  $vs$Re-run the registration-gap filter after remediation and review the Conditional Access policy's report-only insights before flipping it live.$vs$,
  $vc$(Get-MgReportAuthenticationMethodUserRegistrationDetail -Filter "isAdmin eq true and isMfaRegistered eq false" -All | Measure-Object).Count$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/entra/identity/conditional-access/policy-admin-phish-resistant-mfa$url$,
    $url$https://learn.microsoft.com/en-us/entra/identity/authentication/concept-authentication-strengths$url$,
    $url$https://learn.microsoft.com/en-us/graph/api/resources/userregistrationdetails?view=graph-rest-1.0$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-08-31; Microsoft Graph PowerShell SDK (Microsoft.Graph.Reports)$vag$,
  '2026-08-31'::timestamptz,
  $vby$Claude Opus 4.8 (build #1924) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'admin_center_only',
  $note$The gap-identification query is a real read; the fix (register methods + build the phishing-resistant Conditional Access policy) is admin-centre work with no single run-once fix command, hence admin_center_only. Given the explicit lockout warning, never flip the policy On without a verified break-glass exclusion and pre-registered admin methods.$note$
),

(
  'identity:sspr-config',
  $ttl$Enable and strengthen Self-Service Password Reset$ttl$,
  $sum$SSPR disabled, or enabled with weak/insufficient methods, forces every password reset through the helpdesk — an operational cost and a security risk, since helpdesk-assisted resets are a classic social-engineering vector without strong verification. Microsoft's baseline is SSPR enabled tenant-wide, requiring at least two methods to reset, with mandatory registration on next sign-in and a 90–180 day reconfirmation cycle; weaker configurations lower the bar an attacker needs to clear to take over an account via password reset.$sum$,
  jsonb_build_array(
    $prq$Microsoft Entra ID P1 (required for password reset)$prq$,
    $prq$Authentication Policy Administrator role$prq$,
    $prq$Microsoft Entra Connect deployed for hybrid password writeback$prq$
  ),
  $apath$Microsoft Entra admin center → Protection → Password reset → Properties (None/Selected/All); → Password reset → Authentication methods (methods + number required); → Password reset → Registration (forced re-registration cadence)$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Check current state: Entra ID → Password reset → Properties → "Self service password reset enabled" (None / Selected / All).$stp$),
    jsonb_build_object('text', $stp$If None, enable for a pilot group first (Selected → choose a group → Save), then expand to All.$stp$),
    jsonb_build_object('text', $stp$Password reset → Authentication methods → set "Number of methods required to reset" to 2 and enable at least two strong methods. Password reset → Registration → "Require users to register when signing in" = Yes; reconfirmation = 90–180 days. Password reset → Notifications → enable both user and admin notifications.$stp$),
    jsonb_build_object('text', $stp$For hybrid environments, enable Password reset → On-premises integration → "Write back passwords to on-premises AD" = Yes.$stp$)
  ),
  $eo$SSPR enablement moves from None/narrow Selected toward All; two methods are required to reset; users are prompted to register on next sign-in; isSsprEnabled and isSsprCapable trend toward true across the user base.$eo$,
  $vs$Re-check Entra ID → Password reset → Properties for the enablement scope, and query registration/capability coverage via Graph.$vs$,
  $vc$Get-MgReportAuthenticationMethodUserRegistrationDetail -Filter "isSsprCapable eq false" -All | Measure-Object$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/entra/identity/authentication/tutorial-enable-sspr$url$,
    $url$https://learn.microsoft.com/en-us/entra/identity/authentication/concept-sspr-deploy$url$,
    $url$https://learn.microsoft.com/en-us/graph/api/resources/userregistrationdetails?view=graph-rest-1.0$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-08-31; Microsoft Graph PowerShell SDK (Microsoft.Graph.Reports)$vag$,
  '2026-08-31'::timestamptz,
  $vby$Claude Opus 4.8 (build #1924) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'admin_center_only',
  $note$The general-population SSPR enablement scope (None/Selected/All) and "number of methods required" have no documented Microsoft Graph cmdlet — the tutorial's own steps are admin-centre-only, hence admin_center_only. A separate, narrower lever (Update-MgPolicyAuthorizationPolicy -BodyParameter @{allowedToUseSSPR=$true}) controls only whether ADMINISTRATORS may use SSPR; do not conflate it with the tenant-wide enablement.$note$
),

-- ─────────────────────────────────────────────────────────────────────────────
-- CLUSTER: Privileged access / PIM
-- ─────────────────────────────────────────────────────────────────────────────

(
  'identity:global-admin-count',
  $ttl$Reduce standing Global Administrator assignments$ttl$,
  $sum$Global Administrator has unrestricted, tenant-wide access, so every standing Global Administrator is a maximal-blast-radius credential: a breach of any one is a full-tenant compromise. Microsoft's own guidance caps the role at fewer than five people, and the admin center displays a warning card at five or more assignments. Counting members (not role definitions) matters because a role-assignable group assigned to the role can hold many people. The fix is not simply deleting accounts — it is moving day-to-day work to least-privileged roles and making remaining Global Administrator access PIM-eligible.$sum$,
  jsonb_build_array(
    $prq$Privileged Role Administrator or Global Administrator to change role assignments$prq$,
    $prq$Microsoft Graph PowerShell SDK (Microsoft.Graph.Identity.DirectoryManagement); RoleManagement.Read.Directory to read, RoleManagement.ReadWrite.Directory to remove$prq$,
    $prq$Two cloud-only break-glass accounts already in place before removing any admin (see identity:break-glass-health)$prq$,
    $prq$Microsoft Entra ID P2 only for the PIM-eligible conversion in step 2$prq$
  ),
  $apath$Microsoft Entra admin center → Identity → Roles & admins → Roles & admins → All roles → Global Administrator → Assignments$apath$,
  $aurl$https://entra.microsoft.com/#view/Microsoft_AAD_IAM/RolesAndAdministratorsMenuBlade/~/AllRoles$aurl$,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Enumerate the current Global Administrator members before changing anything:$stp$, 'code', $cod$Connect-MgGraph -Scopes 'RoleManagement.Read.Directory','Directory.Read.All'
$gaRole = Get-MgDirectoryRole -Filter "displayName eq 'Global Administrator'"
Get-MgDirectoryRoleMember -DirectoryRoleId $gaRole.Id$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$For each holder who needs Global Administrator only intermittently, create a PIM-eligible assignment instead of standing access (see identity:pim-eligible-roles). For each holder who does not need it at all, assign the least-privileged built-in role that covers their real work (e.g. Exchange Administrator, User Administrator, Security Reader).$stp$),
    jsonb_build_object('text', $stp$Remove the standing Global Administrator assignment only once the replacement role or eligible assignment is confirmed working. Never remove your own last working admin path — Entra ID blocks removing the last Global Administrator.$stp$, 'code', $cod$Connect-MgGraph -Scopes 'RoleManagement.ReadWrite.Directory'
Remove-MgDirectoryRoleMemberByRef -DirectoryRoleId $gaRole.Id -DirectoryObjectId '<UserObjectId>'$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Keep exactly two cloud-only break-glass accounts as the only accounts with a genuinely permanent active Global Administrator assignment, then re-run the enumeration to confirm the standing count is under five.$stp$)
  ),
  $eo$Fewer than five accounts hold standing Global Administrator, two of which are documented cloud-only break-glass accounts; every other administrator holds a scoped, least-privileged role, and remaining human Global Administrator access is PIM-eligible rather than permanent. The "Global Administrators" alert card no longer appears.$eo$,
  $vs$Re-run the member list, confirm the count is under five, and confirm each remaining holder is expected and documented.$vs$,
  $vc$(Get-MgDirectoryRoleMember -DirectoryRoleId (Get-MgDirectoryRole -Filter "displayName eq 'Global Administrator'").Id).Count$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/best-practices$url$,
    $url$https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/security-emergency-access$url$,
    $url$https://learn.microsoft.com/en-us/powershell/module/microsoft.graph.identity.directorymanagement/remove-mgdirectoryrolememberbyref?view=graph-powershell-1.0$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-08-31; Microsoft Graph PowerShell SDK (Microsoft.Graph.Identity.DirectoryManagement)$vag$,
  '2026-08-31'::timestamptz,
  $vby$Claude Opus 4.8 (build #1924) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$Get-MgDirectoryRoleMember returns only standing/active membership — it does NOT include PIM-eligible-but-inactive assignments (use identity:pim-eligible-roles for those). A role-assignable group member means the true human count is higher than the raw figure. Never remove the last Global Administrator.$note$
),

(
  'identity:pim-eligible-roles',
  $ttl$Convert standing privileged access to PIM-eligible (just-in-time)$ttl$,
  $sum$PIM-eligible assignments give zero standing access until the user explicitly activates (with MFA, justification and/or approval), auto-expiring after a bounded window. A near-zero eligible count relative to total privileged assignments means privilege in the tenant is standing rather than just-in-time, which removes the activation friction, approval gate and auto-expiry that materially reduce the value of a stolen or misused credential.$sum$,
  jsonb_build_array(
    $prq$Microsoft Entra ID P2 or Microsoft Entra ID Governance license for every principal made eligible (Free/P1 can only assign Active, not Eligible)$prq$,
    $prq$Privileged Role Administrator$prq$,
    $prq$Microsoft Graph PowerShell SDK (Microsoft.Graph.Identity.Governance), scope RoleManagement.ReadWrite.Directory$prq$
  ),
  $apath$Microsoft Entra admin center → ID Governance → Privileged Identity Management → Microsoft Entra roles → Roles → select a role → Add assignments → Assignment type = Eligible$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Baseline current eligible assignments tenant-wide:$stp$, 'code', $cod$Connect-MgGraph -Scopes 'RoleManagement.ReadWrite.Directory'
Get-MgRoleManagementDirectoryRoleEligibilityScheduleInstance -All$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$For each standing/active privileged assignment that should become just-in-time, create the eligible assignment:$stp$, 'code', $cod$$params = @{
  PrincipalId      = "<UserObjectId>"
  RoleDefinitionId = "<RoleDefinitionId>"
  Justification    = "Convert standing assignment to PIM-eligible"
  DirectoryScopeId = "/"
  Action           = "AdminAssign"
  ScheduleInfo     = @{ StartDateTime = Get-Date; Expiration = @{ Type = "NoExpiration" } }
}
New-MgRoleManagementDirectoryRoleEligibilityScheduleRequest -BodyParameter $params$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Remove the corresponding standing/active assignment (see identity:pim-permanent-roles) so the principal is not both active and eligible. Configure role activation settings (MFA/approval/max duration) in PIM role settings for the roles now under PIM.$stp$)
  ),
  $eo$Privileged roles show a nonzero, growing eligible-assignment count and a shrinking permanent/active count; users activate on demand rather than holding standing privilege.$eo$,
  $vs$Confirm a RoleEligibilityScheduleId exists for the principal/role pair, and check PIM → Microsoft Entra roles → [role] → Eligible roles in the admin center.$vs$,
  $vc$Get-MgRoleManagementDirectoryRoleEligibilityScheduleInstance -Filter "principalId eq '<UserObjectId>'"$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/entra/id-governance/privileged-identity-management/pim-configure$url$,
    $url$https://learn.microsoft.com/en-us/powershell/microsoftgraph/how-to-assign-microsoft-entra-roles-in-pim?view=graph-powershell-1.0$url$,
    $url$https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/best-practices$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-08-31; Microsoft Graph PowerShell SDK (Microsoft.Graph.Identity.Governance)$vag$,
  '2026-08-31'::timestamptz,
  $vby$Claude Opus 4.8 (build #1924) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$License-gated (P2/Governance) — if the tenant is P1/Free, the honest fix is acquiring P2, not a script. An assignment cannot be for less than five minutes and cannot be removed within five minutes of being assigned.$note$
),

(
  'identity:pim-permanent-roles',
  $ttl$Reduce permanent (non-PIM) privileged role assignments$ttl$,
  $sum$A permanent/active privileged assignment grants standing access with no activation, approval, MFA-at-use or auto-expiry. Microsoft's guidance caps these at fewer than 10 tenant-wide, and the admin center warns past that threshold. Every such assignment is a credential that, if phished or reused, grants immediate privileged access with zero additional friction — higher counts are strictly worse.$sum$,
  jsonb_build_array(
    $prq$Privileged Role Administrator$prq$,
    $prq$Microsoft Graph PowerShell SDK (Microsoft.Graph.Identity.Governance); RoleManagement.Read.Directory to read, RoleManagement.ReadWrite.Directory to remove$prq$,
    $prq$Microsoft Entra ID P2 only if converting to eligible rather than plainly removing$prq$
  ),
  $apath$Microsoft Entra admin center → ID Governance → Privileged Identity Management → Microsoft Entra roles → Roles → select role → Active roles tab (the >10 warning shows on Entra ID → Roles & admins)$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Enumerate active/permanent assignment instances tenant-wide (AssignmentType "Assigned" is a directly-assigned standing grant, distinct from "Activated", a live PIM activation):$stp$, 'code', $cod$Connect-MgGraph -Scopes 'RoleManagement.Read.Directory'
Get-MgRoleManagementDirectoryRoleAssignmentScheduleInstance -All | Where-Object { $_.AssignmentType -eq 'Assigned' }$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Convert each standing assignment that does not need to be permanent to PIM-eligible (see identity:pim-eligible-roles), then remove the now-redundant permanent assignment:$stp$, 'code', $cod$$params = @{
  PrincipalId      = "<UserObjectId>"
  RoleDefinitionId = "<RoleDefinitionId>"
  Justification    = "Converted to PIM-eligible; removing standing active assignment"
  DirectoryScopeId = "/"
  Action           = "AdminRemove"
}
New-MgRoleManagementDirectoryRoleAssignmentScheduleRequest -BodyParameter $params$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$If the principal does not need the role at all, skip the conversion and just remove it. Re-check against the fewer-than-10 privileged-assignments and fewer-than-5 Global Administrator thresholds.$stp$)
  ),
  $eo$Permanent/active privileged assignment count trends under 10 tenant-wide; remaining permanent assignments are deliberate (service accounts that cannot use interactive PIM, or the two break-glass accounts).$eo$,
  $vs$Confirm the specific standing assignment no longer appears and that the Roles & admins warning banner clears.$vs$,
  $vc$Get-MgRoleManagementDirectoryRoleAssignmentScheduleInstance -Filter "principalId eq '<UserObjectId>' and roleDefinitionId eq '<RoleDefinitionId>'"$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/best-practices$url$,
    $url$https://learn.microsoft.com/en-us/entra/id-governance/privileged-identity-management/pim-how-to-add-role-to-user$url$,
    $url$https://learn.microsoft.com/en-us/powershell/microsoftgraph/how-to-assign-microsoft-entra-roles-in-pim?view=graph-powershell-1.0$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-08-31; Microsoft Graph PowerShell SDK (Microsoft.Graph.Identity.Governance)$vag$,
  '2026-08-31'::timestamptz,
  $vby$Claude Opus 4.8 (build #1924) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$Never remove the last active Global Administrator assignment — Entra ID blocks it, and it is reserved for the break-glass accounts.$note$
),

(
  'identity:pim-groups',
  $ttl$Bring privileged groups under PIM for Groups$ttl$,
  $sum$PIM for Groups lets a bundle of access (Entra roles, Azure roles, Key Vault, Intune, SaaS apps) activate just-in-time via a single group-membership activation. Role-assignable groups get extra protection — only high-tier roles can manage them and their members' credentials cannot be reset by lower-tier roles. A privileged group left with permanent/standing membership defeats this: anyone in it has always-on access to everything it grants.$sum$,
  jsonb_build_array(
    $prq$Microsoft Entra ID P2 or Microsoft Entra ID Governance license per eligible member/owner$prq$,
    $prq$Privileged Role Administrator/Global Administrator (role-assignable groups) or Groups Administrator/Identity Governance Administrator (non-role-assignable), or an active group owner$prq$,
    $prq$The group must not be dynamic-membership or synced from on-premises AD$prq$,
    $prq$Microsoft Graph PowerShell SDK (Microsoft.Graph.Identity.Governance), scope PrivilegedEligibilitySchedule.ReadWrite.AzureADGroup$prq$
  ),
  $apath$Microsoft Entra admin center → ID Governance → Privileged Identity Management → Groups → [select/discover group] → Assignments$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Identify privileged groups not yet onboarded to PIM for Groups (PIM → Groups → Discover groups). Onboarding a group into PIM for Groups is itself an admin-center action — there is no dedicated onboarding cmdlet.$stp$),
    jsonb_build_object('text', $stp$Once onboarded, create an eligible membership/ownership assignment:$stp$, 'code', $cod$Connect-MgGraph -Scopes 'PrivilegedEligibilitySchedule.ReadWrite.AzureADGroup'
$params = @{
  accessId      = "member"          # or "owner"
  principalId   = "<UserObjectId>"
  groupId       = "<GroupId>"
  action        = "AdminAssign"
  scheduleInfo  = @{ startDateTime = (Get-Date); expiration = @{ type = "NoExpiration" } }
  justification = "Convert standing group membership to PIM-eligible"
}
New-MgIdentityGovernancePrivilegedAccessGroupEligibilityScheduleRequest -BodyParameter $params$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Remove the user's standing/permanent group membership once the eligible assignment exists. For groups that elevate into Microsoft Entra roles specifically, turn on approval for eligible-member activation (Microsoft's explicit recommendation).$stp$)
  ),
  $eo$Privileged groups (especially role-assignable ones feeding Entra roles) show PIM-eligible member/owner assignments instead of standing-only membership; at least one active owner remains (Entra ID will not let the last active owner be removed).$eo$,
  $vs$In the admin center open the group under PIM for Groups → Assignments → Eligible/Active and confirm the split; or query eligible schedule instances for the group.$vs$,
  $vc$Get-MgIdentityGovernancePrivilegedAccessGroupEligibilityScheduleInstance -Filter "groupId eq '<GroupId>'"$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/entra/id-governance/privileged-identity-management/concept-pim-for-groups$url$,
    $url$https://learn.microsoft.com/en-us/entra/id-governance/privileged-identity-management/groups-assign-member-owner$url$,
    $url$https://learn.microsoft.com/en-us/powershell/module/microsoft.graph.identity.governance/new-mgidentitygovernanceprivilegedaccessgroupeligibilityschedulerequest?view=graph-powershell-1.0$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-08-31; Microsoft Graph PowerShell SDK (Microsoft.Graph.Identity.Governance)$vag$,
  '2026-08-31'::timestamptz,
  $vby$Claude Opus 4.8 (build #1924) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$Onboarding a group into PIM for Groups is admin-center-only (no verified cmdlet); the eligible-assignment step above is scriptable. License-gated (P2/Governance) per eligible principal.$note$
),

(
  'identity:break-glass-health',
  $ttl$Establish and maintain healthy break-glass (emergency access) accounts$ttl$,
  $sum$Emergency access ("break-glass") accounts exist to prevent total tenant lockout — federation outages, lost MFA devices, a departing last Global Admin, or a PIM misconfiguration where every privileged assignment is eligible-only with no active approver left. If these accounts do not exist, are subject to blocking Conditional Access policies, share the same MFA method as normal admins, or have stale credentials, the insurance policy fails at the exact moment it is needed. This check verifies existence, exclusion and monitoring — not just presence.$sum$,
  jsonb_build_array(
    $prq$User Administrator (or higher) to create accounts; Privileged Role Administrator/Global Administrator to assign the permanent active Global Administrator role$prq$,
    $prq$Conditional Access Administrator to configure the exclusion group$prq$,
    $prq$Sign-in logs streamed to a Log Analytics workspace (Azure Monitor) plus a role able to create alert rules, for monitoring$prq$,
    $prq$Microsoft Graph PowerShell SDK (Microsoft.Graph.Users, Microsoft.Graph.Identity.DirectoryManagement)$prq$
  ),
  $apath$Microsoft Entra admin center → Identity → Users → All users (create/find accounts) and Protection → Conditional Access → Policies (verify exclusion); Azure portal → Monitor → Alerts (sign-in alerting)$apath$,
  $aurl$https://entra.microsoft.com/#view/Microsoft_AAD_UsersAndTenants/UserManagementMenuBlade/~/AllUsers$aurl$,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Create (or confirm) two or more cloud-only *.onmicrosoft.com emergency access accounts that are not federated or synced from on-premises:$stp$, 'code', $cod$Connect-MgGraph -Scopes 'User.ReadWrite.All'
$passwordProfile = @{ Password = '<StrongRandomPassword>'; ForceChangePasswordNextSignIn = $false }
New-MgUser -DisplayName 'Emergency Access 1' -PasswordProfile $passwordProfile -AccountEnabled -MailNickName 'BreakGlass1' -UserPrincipalName 'breakglass1@<tenant>.onmicrosoft.com'$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Assign each account a PERMANENT ACTIVE (not eligible) Global Administrator role — Microsoft's explicit instruction for emergency access accounts:$stp$, 'code', $cod$Connect-MgGraph -Scopes 'RoleManagement.ReadWrite.Directory'
$gaRole = Get-MgDirectoryRole -Filter "displayName eq 'Global Administrator'"
$DirObject = @{ "@odata.id" = "https://graph.microsoft.com/v1.0/directoryObjects/<EmergencyAccountObjectId>" }
New-MgDirectoryRoleMemberByRef -DirectoryRoleId $gaRole.Id -BodyParameter $DirObject$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Register a passwordless, phishing-resistant credential (passkey/FIDO2 or certificate-based) that differs from normal admin MFA (admin-center / authentication-methods work). Create a security group containing both accounts and EXCLUDE that group from every Conditional Access policy that blocks or restricts sign-in (report-only policies do not need the exclusion). Store credentials in separate secure physical locations, not tied to any individual's device.$stp$),
    jsonb_build_object('text', $stp$Wire sign-in monitoring: stream Entra sign-in logs to Azure Monitor and alert on the accounts' object IDs, and run a validation drill at least every 90 days.$stp$, 'code', $cod$SigninLogs
| where UserId == "<EmergencyAccountObjectId1>" or UserId == "<EmergencyAccountObjectId2>"
| project TimeGenerated, UserPrincipalName, UserId, IPAddress, ResultType, ResultDescription$cod$, 'codeLanguage', $lng$kusto$lng$)
  ),
  $eo$At least two cloud-only accounts exist, hold a permanent active Global Administrator assignment, are excluded from every blocking Conditional Access policy, use a distinct phishing-resistant credential, and trigger an alert on any sign-in.$eo$,
  $vs$Confirm both accounts appear in the Global Administrator active-role member list, confirm the emergency-access group is listed under Excluded on every Conditional Access policy with grant/block controls, and confirm a test sign-in fires the configured alert.$vs$,
  $vc$Get-MgDirectoryRoleMember -DirectoryRoleId (Get-MgDirectoryRole -Filter "displayName eq 'Global Administrator'").Id | Where-Object { $_.Id -in @('<EmergencyAccountObjectId1>','<EmergencyAccountObjectId2>') }$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/security-emergency-access$url$,
    $url$https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/security-planning$url$,
    $url$https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/best-practices$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-08-31; Microsoft Graph PowerShell SDK (Microsoft.Graph.Users, Microsoft.Graph.Identity.DirectoryManagement); Azure Monitor KQL$vag$,
  '2026-08-31'::timestamptz,
  $vby$Claude Opus 4.8 (build #1924) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$Mixed remediation: account creation, role assignment and the monitoring query are scriptable; the Conditional Access exclusion and passkey/cert registration are admin-center configuration. Converting EVERY Global Administrator to eligible-only can itself create the lockout scenario break-glass accounts exist to solve — the permanent-active break-glass GA is the safety valve.$note$
),

-- ─────────────────────────────────────────────────────────────────────────────
-- CLUSTER: Identity Protection & external access
-- ─────────────────────────────────────────────────────────────────────────────

(
  'identity:risky-users',
  $ttl$Investigate and remediate risky users$ttl$,
  $sum$Entra ID Protection continuously scores each user's likelihood of compromise (from leaked credentials, atypical sign-ins and more) via the riskyUsers resource. A user left "At risk" with no admin action or self-remediation policy is a live, unaddressed compromise signal — an attacker with valid credentials looks identical to the real user until risk is investigated and closed. "At risk" persists until an admin or a user-risk Conditional Access policy actively closes it; it does not expire on its own. Full access to this feature requires Microsoft Entra ID P2.$sum$,
  jsonb_build_array(
    $prq$Microsoft Entra ID P2 or Microsoft Entra Suite for full risk data (Free/P1 get only limited data)$prq$,
    $prq$Security Operator to dismiss/confirm risk; User Administrator to reset passwords$prq$,
    $prq$For the Graph/PowerShell path: IdentityRiskyUser.ReadWrite.All and a signed-in user with at least Security Administrator; module Microsoft.Graph.Identity.SignIns$prq$
  ),
  $apath$Microsoft Entra admin center → Protection → Identity Protection → Risky users$apath$,
  $aurl$https://entra.microsoft.com/#view/Microsoft_AAD_IAM/RiskyUsersBlade$aurl$,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Review the flagged user's detail page and risk history to understand why they were flagged. Query current risky users to confirm state before acting:$stp$, 'code', $cod$Connect-MgGraph -Scopes 'IdentityRiskyUser.ReadWrite.All'
Get-MgRiskyUser -Filter "riskState eq 'atRisk'" -All$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$If investigation confirms compromise, mark the user compromised (sets risk to High) and then force remediation — password reset, MFA re-registration or block per policy. Dismissing does NOT reset a password, so confirm-compromised plus a reset is the real fix for a true positive.$stp$, 'code', $cod$$params = @{ userIds = @("<UserId>") }
Confirm-MgRiskyUserCompromised -BodyParameter $params$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$If the flag was a false positive or already-remediated benign event, dismiss the risk (sets risk to None):$stp$, 'code', $cod$$params = @{ userIds = @("<UserId>") }
Invoke-MgDismissRiskyUser -BodyParameter $params$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Longer-term, deploy a user-risk Conditional Access policy (see identity:user-risk-policy) so future risky users can self-remediate via a secure password change plus MFA instead of sitting unremediated.$stp$)
  ),
  $eo$The user's riskState moves from atRisk to confirmedCompromised (followed by a forced reset/MFA re-registration) or to dismissed/remediated; the tenant's live risky-user count for that user drops to zero going forward.$eo$,
  $vs$Re-query the Risky Users report (or Get-MgRiskyUser) for the same user and confirm riskState is no longer atRisk.$vs$,
  $vc$Get-MgRiskyUser -Filter "id eq '<UserId>'" | Select-Object UserPrincipalName, RiskState, RiskLevel, RiskLastUpdatedDateTime$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/entra/id-protection/howto-identity-protection-remediate-unblock$url$,
    $url$https://learn.microsoft.com/en-us/graph/api/riskyuser-confirmcompromised?view=graph-rest-1.0$url$,
    $url$https://learn.microsoft.com/en-us/powershell/module/microsoft.graph.identity.signins/confirm-mgriskyusercompromised?view=graph-powershell-1.0$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-08-31; Microsoft Graph PowerShell SDK (Microsoft.Graph.Identity.SignIns)$vag$,
  '2026-08-31'::timestamptz,
  $vby$Claude Opus 4.8 (build #1924) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$The riskyUsers API/cmdlets require Entra ID P2 — a P1-only tenant can see limited data but cannot fully act via this API. Dismissing risk does not bring a genuinely compromised identity back to a safe state; confirm-compromised plus a password reset does.$note$
),

(
  'identity:risky-signins',
  $ttl$Investigate risky sign-in detections and deploy a sign-in risk policy$ttl$,
  $sum$riskDetection records (activity = signin) are event-level risk signals on individual sign-in attempts — impossible travel, anonymous IP, leaked credentials, password spray, malicious IP. An unremediated at-risk or confirmed-compromised sign-in detection means a session was allowed through without a strong-auth challenge, exactly the gap attackers exploit for session/token theft and lateral movement. Sign-in risk self-remediates in real time via a successful MFA challenge — but only if a sign-in risk Conditional Access policy is actually deployed to force it.$sum$,
  jsonb_build_array(
    $prq$Microsoft Entra ID P2 or Microsoft Entra Suite for full detection detail$prq$,
    $prq$Global Reader (view) / Security Operator (dismiss/confirm); Conditional Access Administrator to create the sign-in risk policy$prq$,
    $prq$Users pre-registered for MFA so they can self-remediate; unregistered users are blocked$prq$
  ),
  $apath$Microsoft Entra admin center → Protection → Identity Protection → Risky sign-ins (detections/remediation); → Protection → Conditional Access (to deploy the sign-in risk policy)$apath$,
  $aurl$https://entra.microsoft.com/#view/Microsoft_AAD_IAM/RiskySignInsBlade$aurl$,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Triage the detection: review the Risk Detection Details pane (application, device, location, IP, user agent) for the flagged sign-in.$stp$),
    jsonb_build_object('text', $stp$If the activity is confirmed illegitimate, confirm the sign-in/user compromised via the admin center (or the Graph confirmCompromised action on the associated user) and force remediation; if benign, dismiss it under Protection → Identity Protection → Risky sign-ins → select the event → Dismiss risky sign-in(s). Query detections programmatically:$stp$, 'code', $cod$GET https://graph.microsoft.com/v1.0/identityProtection/riskDetections?$filter=riskState eq 'atRisk' and activity eq 'signin'$cod$, 'codeLanguage', $lng$http$lng$),
    jsonb_build_object('text', $stp$Deploy (or verify) a sign-in risk Conditional Access policy so future risky sign-ins are auto-challenged rather than accumulating (see identity:signin-risk-policy): Conditions → Sign-in risk → High and Medium → Grant → Require authentication strength (Multifactor authentication) → Session → Sign-in frequency Every time → Report-only first, then On.$stp$)
  ),
  $eo$The flagged detection's riskState moves from atRisk/confirmedCompromised to remediated or dismissed; going forward, new risky sign-ins at Medium/High are auto-challenged with MFA at authentication time rather than passing through unactioned.$eo$,
  $vs$Re-query risk detections for the same user/request and confirm riskState is no longer atRisk; separately confirm the sign-in risk policy shows state = enabled (not enabledForReportingButNotEnforced).$vs$,
  $vc$GET https://graph.microsoft.com/v1.0/identityProtection/riskDetections?$filter=id eq '<RiskDetectionId>'$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/entra/id-protection/howto-identity-protection-configure-risk-policies$url$,
    $url$https://learn.microsoft.com/en-us/entra/id-protection/howto-identity-protection-remediate-unblock$url$,
    $url$https://learn.microsoft.com/en-us/graph/api/resources/riskdetection?view=graph-rest-1.0$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-08-31; Microsoft Graph REST v1.0 (identityProtection)$vag$,
  '2026-08-31'::timestamptz,
  $vby$Claude Opus 4.8 (build #1924) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'admin_center_only',
  $note$There is no standalone "dismiss risk detection" Graph write endpoint — dismissing in the admin center operates on the underlying risky-user/sign-in state, so no fix cmdlet is invented here (validation_command above is a read). The real systemic fix is the sign-in risk Conditional Access policy, which is admin-centre configuration. Legacy Identity Protection risk policies retire 2026-10-01 — migrate to Conditional Access.$note$
),

(
  'identity:b2b-collaboration-settings',
  $ttl$Tighten external collaboration (B2B) settings$ttl$,
  $sum$External collaboration settings govern three permissive-by-default surfaces: who can send B2B guest invitations (default = everyone, including guests), what guests can see once in the directory, and which domains can receive invitations (default = any domain). Left at defaults, any user or an already-invited guest can invite an arbitrary external email address as a guest, and that guest can enumerate non-hidden group memberships and other directory objects — a direct data-exposure and social-engineering/invite-spam vector.$sum$,
  jsonb_build_array(
    $prq$Global Administrator or External Identity Provider Administrator to change these settings in the portal (Graph allows lesser-privileged roles for individual settings)$prq$,
    $prq$No specific license tier is gated for this settings family (baseline Entra ID features)$prq$,
    $prq$Microsoft Graph (authorizationPolicy) if automating$prq$
  ),
  $apath$Microsoft Entra admin center → Entra ID → External Identities → External collaboration settings$apath$,
  $aurl$https://entra.microsoft.com/#view/Microsoft_AAD_IAM/AllowlistPolicyBlade$aurl$,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Tighten who can invite guests: External collaboration settings → Guest invite settings → select "Only users assigned to specific admin roles can invite guest users" (or at minimum not the most-inclusive "Anyone" option).$stp$),
    jsonb_build_object('text', $stp$Tighten guest directory visibility: under Guest user access, select "Guest user access is restricted to properties and memberships of their own directory objects (most restrictive)" unless a specific business need requires broader visibility.$stp$),
    jsonb_build_object('text', $stp$Add a domain allow OR deny list under Collaboration restrictions (they are mutually exclusive): deny personal-email domains, or for maximum restriction allow only true partner domains.$stp$),
    jsonb_build_object('text', $stp$Verify/set programmatically via the authorizationPolicy — e.g. restrict invite senders to admins and guest inviters only (allowInvitesFrom values are none, adminsAndGuestInviters, adminsGuestInvitersAndAllMembers, everyone):$stp$, 'code', $cod$PATCH https://graph.microsoft.com/v1.0/policies/authorizationPolicy/authorizationPolicy
Content-Type: application/json

{
  "allowInvitesFrom": "adminsAndGuestInviters"
}$cod$, 'codeLanguage', $lng$http$lng$)
  ),
  $eo$Guest invitations are limited to designated inviters/roles, guests can see only their own profile (or the chosen intermediate level), and invitations to non-partner/personal-email domains are blocked — closing the "anyone can invite anyone" exposure.$eo$,
  $vs$Re-read the authorizationPolicy and confirm allowInvitesFrom and guestUserRoleId reflect the tightened values, and confirm the collaboration-restrictions list names the intended domains.$vs$,
  $vc$GET https://graph.microsoft.com/v1.0/policies/authorizationPolicy/authorizationPolicy$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/entra/external-id/external-collaboration-settings-configure$url$,
    $url$https://learn.microsoft.com/en-us/entra/external-id/allow-deny-list$url$,
    $url$https://learn.microsoft.com/en-us/graph/api/resources/authorizationpolicy?view=graph-rest-1.0$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-08-31; Microsoft Graph REST v1.0 (authorizationPolicy — allowInvitesFrom enum verified)$vag$,
  '2026-08-31'::timestamptz,
  $vby$Claude Opus 4.8 (build #1924) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$Domain allow/deny lists apply only to invitation-based B2B and are independent of SharePoint/OneDrive's own domain sharing restrictions and of cross-tenant access settings (see identity:cross-tenant-access) — a blocked domain cannot be invited regardless of cross-tenant settings. You cannot set both an allow list and a block list.$note$
),

(
  'identity:cross-tenant-access',
  $ttl$Scope cross-tenant access settings intentionally$ttl$,
  $sum$Cross-tenant access settings are the control plane for how deeply other Entra tenants (via B2B collaboration and B2B direct connect) can reach into this tenant and vice versa — separate from external-collaboration settings, which govern non-Entra/social guests. Out of the box every internal user is enabled for inbound/outbound B2B collaboration with every external Entra org at default trust (no MFA/device-claim trust), while B2B direct connect is blocked tenant-wide until configured. A permissive, unreviewed default is a broad, un-scoped trust surface.$sum$,
  jsonb_build_array(
    $prq$Security Administrator (least privileged) to view/edit default or organization-specific settings$prq$,
    $prq$Microsoft Entra ID P1 to configure trust settings or to scope access to specific users/groups/apps; P1 in both tenants for B2B direct connect trust$prq$,
    $prq$Microsoft Graph (crossTenantAccessPolicy) if automating$prq$
  ),
  $apath$Microsoft Entra admin center → Entra ID → External Identities → Cross-tenant access settings → Default settings (or Organizational settings for a specific partner tenant)$apath$,
  $aurl$https://entra.microsoft.com/#view/Microsoft_AAD_IAM/CrossTenantAccessSettingsMenuBlade$aurl$,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Review current inbound/outbound sign-in activity before changing defaults — Microsoft warns that changing defaults to Block access can break existing business-critical access. Use the cross-tenant access activity workbook or sign-in logs.$stp$),
    jsonb_build_object('text', $stp$Cross-tenant access settings → Default settings → Edit inbound defaults: scope access down from "all external users/groups + all applications" to only what is actually needed. Under Trust settings, enable "Trust MFA / compliant devices / hybrid-joined devices from other tenants" only deliberately, per partner.$stp$),
    jsonb_build_object('text', $stp$For each external org you actually collaborate with, add it under Organizational settings with explicit, narrower inbound/outbound settings rather than relying on the tenant-wide default. Read/verify current configuration via Graph:$stp$, 'code', $cod$GET https://graph.microsoft.com/v1.0/policies/crossTenantAccessPolicy/default$cod$, 'codeLanguage', $lng$http$lng$),
    jsonb_build_object('text', $stp$To restrict a specific partner's inbound B2B collaboration to allowed users/groups only:$stp$, 'code', $cod$PATCH https://graph.microsoft.com/v1.0/policies/crossTenantAccessPolicy/partners/<TenantId>
Content-Type: application/json

{
  "b2bCollaborationInbound": {
    "usersAndGroups": { "accessType": "allowed", "targets": [ { "target": "<GroupId>", "targetType": "group" } ] }
  }
}$cod$, 'codeLanguage', $lng$http$lng$)
  ),
  $eo$Default cross-tenant trust is scoped intentionally (not "all external orgs, all users, no review"), specific partner tenants have explicit organization-specific settings on record, and MFA/device trust is extended only where the organization has decided to rely on the partner's home-tenant claims.$eo$,
  $vs$Re-fetch the default and partner-specific crossTenantAccessPolicy configuration and confirm the applied settings match the intended scope, not the unreviewed factory default.$vs$,
  $vc$GET https://graph.microsoft.com/v1.0/policies/crossTenantAccessPolicy/partners/<TenantId>$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/entra/external-id/cross-tenant-access-overview$url$,
    $url$https://learn.microsoft.com/en-us/entra/external-id/cross-tenant-access-settings-b2b-collaboration$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-08-31; Microsoft Graph REST v1.0 (crossTenantAccessPolicy)$vag$,
  '2026-08-31'::timestamptz,
  $vby$Claude Opus 4.8 (build #1924) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$Always review business impact before enforcing — Microsoft explicitly cautions that blocking defaults can break business-critical access. Present this as "review and scope down", not an automatic silent tightening. Blocking all external users/groups also requires blocking all internal applications, or the portal rejects the inconsistent config.$note$
),

-- ─────────────────────────────────────────────────────────────────────────────
-- CLUSTER: Account hygiene & governance
-- ─────────────────────────────────────────────────────────────────────────────

(
  'identity:stale-accounts',
  $ttl$Disable and clean up stale/inactive accounts$ttl$,
  $sum$Accounts that have not signed in for 90+ days but remain enabled are an unmonitored attack surface — a compromised credential, a departed employee's account or a forgotten service account all look identical to "inactive". Microsoft frames this as a security-hygiene control, not just directory cleanliness. The safe remediation is to block sign-in first (disable, recoverable) and delete only after a review period.$sum$,
  jsonb_build_array(
    $prq$Microsoft Entra ID P1 or P2 (required to read signInActivity / lastSuccessfulSignInDateTime via Graph)$prq$,
    $prq$Graph permissions AuditLog.Read.All + User.Read.All to read; User.EnableDisableAccount.All + User.Read.All to disable$prq$,
    $prq$Reports Reader to view sign-in activity in the admin center; module Microsoft.Graph.Users$prq$
  ),
  $apath$Microsoft Entra admin center → Identity → Users → Manage view → Edit columns → add "Last interactive sign-in time" → Add filter$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Query last successful sign-in for all users and filter to those stale 90+ days (use lastSuccessfulSignInDateTime, which excludes failed attempts — a more accurate "truly accessed" signal than lastSignInDateTime):$stp$, 'code', $cod$Connect-MgGraph -Scopes 'AuditLog.Read.All','User.Read.All'
Get-MgUser -All -Property Id,DisplayName,UserPrincipalName,SignInActivity,AccountEnabled |
  Where-Object { $_.SignInActivity.LastSuccessfulSignInDateTime -lt (Get-Date).AddDays(-90) -and $_.AccountEnabled }$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$For each confirmed-stale account, block sign-in first (disable, do not delete yet) so it is recoverable if the assessment was wrong:$stp$, 'code', $cod$Connect-MgGraph -Scopes 'User.EnableDisableAccount.All','User.Read.All'
Update-MgUser -UserId <UserId> -AccountEnabled:$false$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$After a documented grace/review period, delete the user object if it is truly obsolete. Treat disablement as the primary remediation and deletion as a follow-on organizational decision.$stp$)
  ),
  $eo$The stale account's accountEnabled is false; the user can no longer authenticate, immediately shrinking the reachable attack surface, while the object remains recoverable if the disablement was a mistake.$eo$,
  $vs$Re-query the user and confirm accountEnabled is false.$vs$,
  $vc$Get-MgUser -UserId <UserId> -Property AccountEnabled,SignInActivity | Select-Object AccountEnabled$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/entra/identity/monitoring-health/howto-manage-inactive-user-accounts$url$,
    $url$https://learn.microsoft.com/en-us/graph/api/resources/signInActivity$url$,
    $url$https://learn.microsoft.com/en-us/powershell/module/microsoft.graph.users/update-mguser$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-08-31; Microsoft Graph PowerShell SDK (Microsoft.Graph.Users)$vag$,
  '2026-08-31'::timestamptz,
  $vby$Claude Opus 4.8 (build #1924) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$A $filter on signInActivity cannot be combined with other filterable properties, and the page size drops to 500 when signInActivity is selected/filtered. signInActivity is only on the user resource, not the audit log.$note$
),

(
  'identity:department-directory',
  $ttl$Populate the department attribute across the directory$ttl$,
  $sum$A null/empty department attribute breaks any reporting, heat-map or dynamic-group logic keyed on org structure — customers cannot segment risk or access by business unit, and dynamic security groups built on department silently exclude those users. This is data-completeness debt rather than a security control by itself, but it directly degrades downstream governance tooling (access reviews, Conditional Access group scoping) that assumes the attribute is populated.$sum$,
  jsonb_build_array(
    $prq$Graph permission User.ReadWrite.All (delegated or application) to write department; module Microsoft.Graph.Users$prq$,
    $prq$A source of truth (HR/AD export or mapping table) for the correct value per user — Graph cannot infer department$prq$
  ),
  $apath$Microsoft Entra admin center → Identity → Users → select a user → Properties → Job info → Department (per-user; there is no native bulk-edit UI for this field)$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Find users with a null/empty department (department supports $filter eq on null values):$stp$, 'code', $cod$Connect-MgGraph -Scopes 'User.ReadWrite.All'
Get-MgUser -All -Property Id,DisplayName,Department -Filter "department eq null"$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Build a CSV of UserPrincipalName,Department from the real source of truth (column headers matching Graph property names), then bulk-update:$stp$, 'code', $cod$Import-Csv .\departments.csv | ForEach-Object {
  Update-MgUser -UserId $_.UserPrincipalName -Department $_.Department
}$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Re-run the null-department query to confirm the gap has closed to the expected residual (e.g. service accounts intentionally left blank).$stp$)
  ),
  $eo$Every in-scope user has a non-null department value matching the authoritative source, restoring accuracy for dynamic groups, reporting and heat-maps built on that attribute.$eo$,
  $vs$Re-query for remaining nulls and confirm the count dropped to the expected residual.$vs$,
  $vc$Get-MgUser -All -Property Id,DisplayName,Department -Filter "department eq null" | Measure-Object$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/powershell/module/microsoft.graph.users/update-mguser$url$,
    $url$https://learn.microsoft.com/en-us/graph/api/user-list$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-08-31; Microsoft Graph PowerShell SDK (Microsoft.Graph.Users)$vag$,
  '2026-08-31'::timestamptz,
  $vby$Claude Opus 4.8 (build #1924) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$Microsoft does not publish a canonical "bulk edit department" page — the CSV+loop pattern is standard Graph PowerShell practice built directly from the verified Update-MgUser -Department parameter and its $filter support. department maximum length is 64 characters.$note$
),

(
  'identity:password-expiration-policy',
  $ttl$Align password expiration with current Microsoft guidance$ttl$,
  $sum$Microsoft's current guidance discourages forced periodic password expiration for cloud-only accounts — forced rotation drives predictable, weaker password choices — and recommends passwords be set to never expire provided MFA and other controls are in place. The actionable finding is usually a tenant still using the legacy expiring-password model without verifying MFA as the compensating control; the fix sets the validity period to "never expire" per managed domain, on the assumption MFA is in place.$sum$,
  jsonb_build_array(
    $prq$User Administrator (admin center) or Domain.ReadWrite.All (Graph/PowerShell); module Microsoft.Graph.Identity.DirectoryManagement$prq$,
    $prq$Applies to cloud-only users — not hybrid-identity users using password hash sync, pass-through auth or on-premises federation$prq$,
    $prq$MFA/Conditional Access in place as the actual security control that never-expiring passwords assume$prq$
  ),
  $apath$Microsoft 365 admin center → Settings → Org Settings → Security & privacy → Password expiration policy → "Set passwords to never expire (recommended)"$apath$,
  $aurl$https://admin.microsoft.com/adminportal/home$aurl$,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Check the current per-domain password policy:$stp$, 'code', $cod$Connect-MgGraph -Scopes 'Domain.ReadWrite.All'
Get-MgDomain -DomainId <DomainName> | Select-Object PasswordValidityPeriodInDays$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$To align with current guidance (never expire), set the validity period to the max value used to represent "never expire". Repeat for every managed domain — the policy is set per domain, not tenant-wide in one call:$stp$, 'code', $cod$Update-MgDomain -DomainId <DomainName> -PasswordValidityPeriodInDays 2147483647$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$If the finding is instead the opposite case (no expiration AND no MFA), the real remediation is enabling MFA/Conditional Access (see identity:ca-mfa-coverage) rather than re-enabling expiration.$stp$)
  ),
  $eo$PasswordValidityPeriodInDays reflects the organization's intended policy (Microsoft recommends never-expire) on every managed domain, paired with MFA as the actual security control.$eo$,
  $vs$Re-query each managed domain and confirm the value matches intent.$vs$,
  $vc$Get-MgDomain -DomainId <DomainName> -Property PasswordValidityPeriodInDays$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/microsoft-365/admin/misc/password-policy-recommendations?view=o365-worldwide$url$,
    $url$https://learn.microsoft.com/en-us/microsoft-365/admin/manage/set-password-expiration-policy?view=o365-worldwide$url$,
    $url$https://learn.microsoft.com/en-us/powershell/module/microsoft.graph.identity.directorymanagement/update-mgdomain$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-08-31; Microsoft Graph PowerShell SDK (Microsoft.Graph.Identity.DirectoryManagement)$vag$,
  '2026-08-31'::timestamptz,
  $vby$Claude Opus 4.8 (build #1924) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$This is a case where the finding can point either direction — never-expire is only "safe" with MFA present. Update-MgDomain -PasswordValidityPeriodInDays is the current tenant-wide control; the legacy per-user DisablePasswordExpiration passwordPolicies flag exists but is secondary.$note$
),

(
  'identity:terms-of-use',
  $ttl$Create and enforce a Terms of Use agreement$ttl$,
  $sum$No Terms of Use agreement, or low acceptance, means the organization has no enforceable, logged record that users acknowledged acceptable-use/compliance obligations before getting access — a real gap for any customer with legal, HR or regulatory requirements to prove notice was given. Terms of Use are only actually enforced through a Conditional Access grant control; creating the agreement alone does nothing without a policy targeting it.$sum$,
  jsonb_build_array(
    $prq$Microsoft Entra ID P1 license$prq$,
    $prq$A finalized Terms of Use PDF; Conditional Access Administrator (or Security Administrator) to create/enforce; Security Reader to view acceptance$prq$,
    $prq$Service accounts/service principals excluded from the enforcing policy (Terms of Use do not support enforcement on them); module Microsoft.Graph.Identity.Governance$prq$
  ),
  $apath$Microsoft Entra admin center → Protection → Conditional Access → Terms of use → New terms (to create); then → Conditional Access → Policies (to build/enable the enforcing grant-control policy)$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Create the agreement via the admin center ("New terms") or Graph/PowerShell:$stp$, 'code', $cod$Connect-MgGraph -Scopes 'Agreement.ReadWrite.All'
$params = @{
  displayName = "<OrgName> Terms of Use"
  isViewingBeforeAcceptanceRequired = $true
  files = @(@{ fileName = "TOU.pdf"; language = "en"; isDefault = $true; fileData = @{ data = [System.IO.File]::ReadAllBytes("<PathToTouPdf>") } })
}
New-MgIdentityGovernanceTermsOfUseAgreement -BodyParameter $params$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$In the admin center under Conditional Access → Terms of use, choose "Custom policy" to generate a Conditional Access policy shell.$stp$),
    jsonb_build_object('text', $stp$Build the policy: Assignments → Users → Include All users; Exclude break-glass and service accounts. Target resources → the apps in scope. Access controls → Grant → Grant access → select the Terms of Use created above. Set Enable policy to Report-only, review, then On.$stp$),
    jsonb_build_object('text', $stp$Monitor acceptance under Conditional Access → Terms of use → select the policy → Accepted/Declined counts (or via audit logs).$stp$)
  ),
  $eo$All in-scope users are blocked from the targeted resources until they accept the Terms of Use; the acceptance/decline count climbs toward full coverage of the targeted population.$eo$,
  $vs$View the accepted/declined counts on the Terms of use policy page in the admin center, or query acceptances via the audit logs.$vs$,
  NULL,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/entra/identity/conditional-access/terms-of-use$url$,
    $url$https://learn.microsoft.com/en-us/entra/identity/conditional-access/policy-all-users-require-terms-of-use$url$,
    $url$https://learn.microsoft.com/en-us/graph/api/termsofusecontainer-post-agreements$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-08-31; Microsoft Graph PowerShell SDK (Microsoft.Graph.Identity.Governance)$vag$,
  '2026-08-31'::timestamptz,
  $vby$Claude Opus 4.8 (build #1924) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$No more than 40 terms per tenant. New-MgIdentityGovernanceTermsOfUseAgreement is the verified cmdlet tied to the current POST /identityGovernance/termsOfUse/agreements endpoint (prefer it over New-MgAgreement). validation_command is left NULL because the acceptance-read cmdlet form was not independently verified — validate acceptance in the portal.$note$
),

(
  'identity:hybrid-sync-health',
  $ttl$Restore Microsoft Entra Connect sync health$ttl$,
  $sum$For hybrid-identity tenants, a stalled or erroring sync engine means on-premises changes (disables, password resets, group membership, department changes) silently stop propagating to the cloud directory — a terminated employee's on-prem account can be disabled while their cloud account stays fully live, a direct security exposure. Microsoft's guidance is strict on cadence: a delta sync must occur at least once every 7 days or the connector needs a full resync to recover.$sum$,
  jsonb_build_array(
    $prq$Microsoft Entra Connect Health agent installed on each sync server, for the admin-center error report$prq$,
    $prq$Microsoft Entra Connect Sync V2 (V1 retired 2022-08-31; Connect Health for sync stopped supporting it in December 2022)$prq$,
    $prq$PowerShell access to the ON-PREMISES sync server itself for the ADSync module (Import-Module ADSync if not auto-loaded)$prq$
  ),
  $apath$Microsoft Entra admin center → Entra Connect / Connect Health for sync → Sync errors (Synchronization Errors Report); remediation runs on the on-premises Entra Connect server$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$On the Entra Connect sync server, check scheduler health — inspect SyncCycleEnabled, StagingModeEnabled and NextSyncCycleStartTimeInUTC for staleness (a delta sync must happen within 7 days):$stp$, 'code', $cod$Import-Module ADSync
Get-ADSyncScheduler$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$If SyncCycleEnabled is False, re-enable it and force an immediate sync (use Initial instead of Delta for a full resync if delta has lapsed past 7 days or errors persist):$stp$, 'code', $cod$Set-ADSyncScheduler -SyncCycleEnabled $true
Start-ADSyncSyncCycle -PolicyType Delta$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Review the categorized Synchronization Errors Report in Connect Health for sync (admin center) to resolve object-level failures — e.g. for AttributeValueMustBeUnique, remove the duplicated proxyAddresses/userPrincipalName value from the incorrect on-prem object and let sync re-run. Confirm the engine is idle before config changes (Get-ADSyncConnectorRunStatus returns empty when idle).$stp$)
  ),
  $eo$Get-ADSyncScheduler shows SyncCycleEnabled = True with a NextSyncCycleStartTimeInUTC within the expected interval (default 30 minutes), and the Synchronization Errors Report shows zero or a declining count of object-level errors.$eo$,
  $vs$Re-run the scheduler check on the sync server and confirm a recent completed cycle; re-check the admin center error report (updates every 30 minutes) for the previously-failing objects.$vs$,
  $vc$Get-ADSyncScheduler$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/entra/identity/hybrid/connect/how-to-connect-sync-feature-scheduler$url$,
    $url$https://learn.microsoft.com/en-us/entra/identity/hybrid/connect/tshoot-connect-sync-errors$url$,
    $url$https://learn.microsoft.com/en-us/entra/identity/hybrid/connect/how-to-connect-health-sync$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-08-31; Microsoft Entra Connect ADSync module (on-premises)$vag$,
  '2026-08-31'::timestamptz,
  $vby$Claude Opus 4.8 (build #1924) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$This entire remediation runs ON the on-premises Entra Connect server, not against the cloud tenant via Graph — there is no Graph equivalent for Get-ADSyncScheduler/Start-ADSyncSyncCycle. A monitoring platform can only DETECT staleness cloud-side via Connect Health; fixing it needs PowerShell session access to the customer's on-prem sync server.$note$
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
VALUES ('2026-08-31-remediation-kb-identity-domain-1924.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;

-- Verify: how many identity: rows are published after this migration.
SELECT
  count(*) FILTER (WHERE check_key LIKE 'identity:%') AS identity_rows,
  count(*) FILTER (WHERE check_key LIKE 'identity:%' AND status = 'published') AS identity_published,
  count(*) AS total_rows
FROM remediation_knowledge_base;
