-- #2054 — Remediation knowledge base: the platform: domain, authored & published.
--
-- Populates remediation_knowledge_base with verified "this is wrong → here is how
-- to fix it" content for every active platform: check (3 rows: branding-config,
-- multi-geo-status, tenant-password-expiration). Before this the platform: domain
-- had zero published rows, so every platform finding fell through to the AI
-- fallback (same gap #1924 closed for identity:).
--
-- AUTHORING STANDARD (see #1924, followed exactly for this domain too):
--   * Every row is verified against real Microsoft Learn / official Microsoft docs
--     that were actually fetched in build session #2054 (2026-09-01). The URLs in
--     source_urls are those pages.
--   * verified_by is an HONEST AGENT attribution — never a human name. The content
--     is agent-authored and awaiting a human spot-check (filed as a Shane To-Do).
--   * Tenant-specific values use angle-bracket placeholders (<PrimaryDomainName>, …),
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
-- platform:branding-config
-- ─────────────────────────────────────────────────────────────────────────────

(
  'platform:branding-config',
  $ttl$Configure company branding for the sign-in page$ttl$,
  $sum$No company branding has been configured for this tenant's sign-in page — Microsoft Entra ID shows every user the generic default sign-in experience (bare Microsoft logo, no organization name, no background) on every device, on every sign-in. That makes it materially harder for a user to visually tell a legitimate sign-in page from a look-alike phishing page: the single most effective visual anti-phishing signal — an organization-specific header logo, banner logo, colors and sign-in text — is simply absent. It also means the sign-in page carries no real wayfinding for a genuinely confused user, such as a help-desk contact string.$sum$,
  jsonb_build_array(
    $prq$Organizational Branding Administrator role (the minimum role Microsoft documents for this)$prq$,
    $prq$One of: Microsoft Entra ID P1 or P2, Microsoft 365 Business Standard, or SharePoint (Plan 1)$prq$,
    $prq$PNG/JPEG assets prepared to the documented size limits if uploading images via the admin center wizard (banner logo 245x36px / 50KB max, background image 1920x1080px / 300KB max, favicon 32x32px / 5KB max)$prq$,
    $prq$Microsoft Graph PowerShell SDK (Microsoft.Graph.Identity.DirectoryManagement), scope OrganizationalBranding.ReadWrite.All, if automating$prq$
  ),
  $apath$Microsoft Entra admin center → Entra ID → Custom Branding → Configure$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Sign in to the Microsoft Entra admin center (entra.microsoft.com) as at least an Organizational Branding Administrator and go to Entra ID → Custom Branding. If no branding exists yet you'll see Configure; once branding exists the same screen shows Edit instead.$stp$),
    jsonb_build_object('text', $stp$Work through the Basics (favicon, background image, background color), Layout (template, optional custom CSS), Header, Footer, and Sign-in form (banner logo, square logo light/dark, username hint text, sign-in page text, SSPR link) sections. Every element is optional — anything left blank keeps the Microsoft default for that one element. Select Review + create when done.$stp$),
    jsonb_build_object('text', $stp$For a minimal automated baseline instead of the full portal wizard (background color, sign-in page text and a banner logo), use the Microsoft Graph PowerShell SDK. This call creates the tenant's single default branding object if one doesn't exist yet — there is no separate "create branding" call, Update-MgOrganizationBranding does both:$stp$, 'code', $cod$Connect-MgGraph -Scopes 'OrganizationalBranding.ReadWrite.All'
Update-MgOrganizationBranding -OrganizationId <TenantId> `
  -BackgroundColor "#00304C" `
  -SignInPageText "Contact the <OrganizationName> help desk at <HelpDeskPhoneOrEmail> for sign-in assistance." `
  -UsernameHintText "yourname@<PrimaryDomainName>" `
  -BannerLogoInputFile <PathToBannerLogoPng>$cod$, 'codeLanguage', $lng$powershell$lng$)
  ),
  $eo$GET /organization/{tenantId}/branding returns a real branding object instead of a 404 Request_ResourceNotFound, and users see the organization's own logo, colors and sign-in text — not the bare Microsoft default — on every sign-in to a tenant-specific app.$eo$,
  $vs$Re-check the branding endpoint, or reload the sign-in page in a private/incognito browser window pointed at a tenant-specific app URL, and confirm the organization's branding now renders.$vs$,
  $vc$Get-MgOrganizationBranding -OrganizationId <TenantId>$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/entra/fundamentals/how-to-customize-branding$url$,
    $url$https://learn.microsoft.com/en-us/graph/api/resources/organizationalbranding$url$,
    $url$https://learn.microsoft.com/en-us/powershell/module/microsoft.graph.identity.directorymanagement/update-mgorganizationbranding$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-01; Microsoft Graph PowerShell SDK (Microsoft.Graph.Identity.DirectoryManagement)$vag$,
  '2026-09-01'::timestamptz,
  $vby$Claude Sonnet 5 (build #2054) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$The check's GET /organization/{id}/branding 404s with Request_ResourceNotFound when branding was never configured — a documented Graph quirk (Git #1786), not a permission/endpoint fault; the org itself exists, the branding navigation property just has nothing behind it. Full visual branding (image uploads, custom CSS) is naturally a portal task; the PowerShell step above covers only the minimal text/color baseline an MSP can script.$note$
),

-- ─────────────────────────────────────────────────────────────────────────────
-- platform:multi-geo-status
-- ─────────────────────────────────────────────────────────────────────────────

(
  'platform:multi-geo-status',
  $ttl$Set a Preferred Data Location for every user and group once Multi-Geo is enabled$ttl$,
  $sum$Multi-Geo lets a tenant store each user's mailbox, OneDrive and SharePoint/Group-connected site content in a specific geographic region (a "satellite geography") instead of the tenant's single central region — the mechanism organizations rely on to meet regional data-residency requirements. It only does that job for users whose Preferred Data Location (PDL) has actually been set to a configured satellite geography: Microsoft's own documentation is explicit that if a user's PDL is unset, or points at a geography that was never configured as a satellite location, their site and Group mailbox are created in the tenant's central location anyway — silently defeating the residency guarantee the Multi-Geo add-on was purchased for. This finding surfaces the tenant's current Multi-Geo/satellite-location configuration so it can be checked against real user PDL assignment, not just the presence of the add-on.$sum$,
  jsonb_build_array(
    $prq$SharePoint Administrator role (or Global Administrator) for the group/site PDL and Geography-move cmdlets$prq$,
    $prq$A valid Multi-Geo subscription — total purchased Multi-Geo units greater than 5% of the tenant's total eligible licenses — with at least one satellite geography already configured in the SharePoint admin center$prq$,
    $prq$SharePoint Online Management Shell for group/site PDL and Geography-move cmdlets (Connect-SPOService)$prq$,
    $prq$Microsoft Graph PowerShell SDK (Microsoft.Graph.Users), scope User.ReadWrite.All, for setting an individual cloud-only user's PDL$prq$,
    $prq$Users synchronized from on-premises Active Directory must have PDL set in AD and synced via Microsoft Entra Connect instead — it cannot be set directly against a synced user object$prq$
  ),
  $apath$SharePoint admin center → Settings → Multi-Geo (geo locations, satellite geographies and storage quotas are managed here). Tenant-wide committed/central data location is read-only under Microsoft 365 admin center → Settings → Org Settings → Organization Profile → Data Location.$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Confirm which geographies are actually configured as satellite locations for this tenant in the SharePoint admin center's Multi-Geo page, and confirm the tenant's committed/central data location under Microsoft 365 admin center → Settings → Org Settings → Organization Profile → Data Location.$stp$),
    jsonb_build_object('text', $stp$For each cloud-only user who should have their data stored in a specific satellite geography, set their Preferred Data Location:$stp$, 'code', $cod$Connect-MgGraph -Scopes 'User.ReadWrite.All'
$userUPN = "<UserPrincipalName>"
$user = Get-MgUser -UserId $userUPN
Update-MgUser -UserId $user.Id -PreferredDataLocation "<SatelliteGeoCode>"   # e.g. EUR, APC, AUS$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Users synchronized from on-premises Active Directory instead need PreferredDataLocation populated in AD and synchronized through Microsoft Entra Connect — it can't be set directly against a synced cloud object.$stp$),
    jsonb_build_object('text', $stp$For a Microsoft 365 Group / group-connected SharePoint site, set the group's PDL before moving its site:$stp$, 'code', $cod$Connect-SPOService -Url https://<TenantName>-admin.sharepoint.com
Set-SPOUnifiedGroup -GroupAlias "<GroupAlias>" -PreferredDataLocation "<SatelliteGeoCode>"
Get-SPOUnifiedGroup -GroupAlias "<GroupAlias>"$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Existing content already sitting in the wrong geography does not move itself once PDL is corrected — schedule the move separately: Start-SPOUserAndContentMove for a user's OneDrive, or Start-SPOUnifiedGroupMove for a group-connected site, each targeting the same satellite geography now set as the PDL. Wait at least 24 hours after a PDL change before starting a move so the update syncs across geographies first.$stp$)
  ),
  $eo$Every user and group whose content must comply with a regional residency requirement has a PDL set to a real, configured satellite geography — not left unset or pointed at an unconfigured one — and any content that was already misplaced has a scheduled or completed Geography move to match.$eo$,
  $vs$Re-pull each in-scope user's PreferredDataLocation and confirm it resolves to a configured satellite geography, then re-check where their OneDrive/site actually lives, not just where the PDL claims it should be.$vs$,
  $vc$Get-MgUser -UserId <UserPrincipalName> -Property UserPrincipalName,PreferredDataLocation | Select-Object UserPrincipalName, PreferredDataLocation$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/microsoft-365/enterprise/multi-geo-capabilities-in-onedrive-and-sharepoint-online-in-microsoft-365$url$,
    $url$https://learn.microsoft.com/en-us/microsoft-365/enterprise/m365-dr-service-spo$url$,
    $url$https://learn.microsoft.com/en-us/powershell/module/microsoft.graph.users/update-mguser$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-01; SharePoint Online Management Shell; Microsoft Graph PowerShell SDK (Microsoft.Graph.Users)$vag$,
  '2026-09-01'::timestamptz,
  $vby$Claude Sonnet 5 (build #2054) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$Enabling the Multi-Geo add-on itself (purchasing units, provisioning a new satellite geography) is a licensing/procurement action taken through Microsoft, not a PowerShell fix — this remediation targets the governance gap (PDL assignment) that exists once satellite geographies are already provisioned. Once the Multi-Geo add-on is enabled, changing the tenant's default/central geography is not supported. Content does not relocate automatically when PDL changes; a separate Start-SPOUserAndContentMove / Start-SPOUnifiedGroupMove is required per the steps above.$note$
),

-- ─────────────────────────────────────────────────────────────────────────────
-- platform:tenant-password-expiration
-- ─────────────────────────────────────────────────────────────────────────────

(
  'platform:tenant-password-expiration',
  $ttl$Set tenant password expiration to never expire$ttl$,
  $sum$Microsoft's current guidance discourages periodic password-expiration policies for cloud-only accounts outright — the recommended setting is passwords that never expire. This is grounded in established research (also reflected in NIST guidance) that forced periodic password changes push users toward small, predictable pattern-based edits of their old password rather than genuinely new, strong ones, which is a net loss for security. A tenant still running a finite passwordValidityPeriodInDays — commonly the legacy 90-day default carried by tenants created before 2021 — is applying a control Microsoft's own admin center literally labels not recommended, while gaining no real protection against credential compromise that multifactor authentication does not already provide far more effectively.$sum$,
  jsonb_build_array(
    $prq$User Administrator role (minimum) to read/change the domain's password policy$prq$,
    $prq$Microsoft Graph PowerShell SDK (Microsoft.Graph.Identity.DirectoryManagement), scope Domain.ReadWrite.All, if automating — otherwise User Administrator access to the Microsoft 365 admin center is sufficient$prq$,
    $prq$Multifactor authentication should already be enforced tenant-wide (see the identity: domain's ca-mfa-coverage check) — removing password expiration is a net security improvement only once MFA, not password rotation, is the account's real second line of defense$prq$
  ),
  $apath$Microsoft 365 admin center → Settings → Org Settings → Security & privacy → Password expiration policy$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Sign in to the Microsoft 365 admin center as a User Administrator, go to Settings → Org Settings → Security & privacy → Password expiration policy, and confirm the checkbox "Set passwords to never expire (recommended)" is selected. If it's cleared with a specific day count entered instead, that's the finding — re-select it and Save.$stp$),
    jsonb_build_object('text', $stp$To check and set the same policy on a specific verified domain via PowerShell instead of the portal:$stp$, 'code', $cod$Connect-MgGraph -Scopes 'Domain.ReadWrite.All'
Get-MgDomain -DomainId "<PrimaryDomainName>" | Select-Object Id, PasswordValidityPeriodInDays
Update-MgDomain -DomainId "<PrimaryDomainName>" -PasswordValidityPeriodInDays 2147483647$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Repeat for every verified domain in the tenant — the password validity period is set per domain, not once tenant-wide, so a domain added after the last policy review can silently still carry the legacy 90-day default.$stp$)
  ),
  $eo$Every verified domain's passwordValidityPeriodInDays reads 2147483647 (never expires) rather than a finite day count, matching Microsoft's documented recommended default; users are no longer forced into periodic password changes that measurably weaken password quality.$eo$,
  $vs$Re-pull PasswordValidityPeriodInDays for every verified domain and confirm each reads the never-expire sentinel value rather than a finite number of days.$vs$,
  $vc$Get-MgDomain -All | Select-Object Id, PasswordValidityPeriodInDays$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/microsoft-365/admin/misc/password-policy-recommendations$url$,
    $url$https://learn.microsoft.com/en-us/microsoft-365/admin/manage/set-password-expiration-policy$url$,
    $url$https://learn.microsoft.com/en-us/powershell/module/microsoft.graph.identity.directorymanagement/update-mgdomain$url$,
    $url$https://learn.microsoft.com/en-us/powershell/entra-powershell/report-users-expired-password$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-01; Microsoft Graph PowerShell SDK (Microsoft.Graph.Identity.DirectoryManagement)$vag$,
  '2026-09-01'::timestamptz,
  $vby$Claude Sonnet 5 (build #2054) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$2147483647 (Int32 max) is the documented sentinel value Microsoft's own Entra PowerShell tooling checks for to mean "password expiration disabled" — confirmed in the official password-expiration-report script: If ($PasswordLifetime -eq 2147483647) { $TenantPasswordExpirationDisabled = $true }. The property is per-domain, not per-tenant — check every verified domain, not just the default one. This is the opposite direction from the identity: domain's MFA/Conditional Access controls: here the recommended state is the ABSENCE of a control (expiration), not its presence.$note$
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
VALUES ('2026-09-01-remediation-kb-platform-domain-2054.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;

-- Verify: how many platform: rows are published after this migration.
SELECT
  count(*) FILTER (WHERE check_key LIKE 'platform:%') AS platform_rows,
  count(*) FILTER (WHERE check_key LIKE 'platform:%' AND status = 'published') AS platform_published,
  count(*) AS total_rows
FROM remediation_knowledge_base;
