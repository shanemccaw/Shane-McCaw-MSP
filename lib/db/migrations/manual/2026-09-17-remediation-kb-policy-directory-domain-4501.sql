-- #4501 — Remediation knowledge base: the 24 policy:/directory: checks #4478
-- gave real pillar attribution to, authored & published.
--
-- Split out of #4478, which fixed pillar attribution (signal_derivation_rules)
-- for these same 24 check_keys but explicitly left remediation content out of
-- scope. Before this migration all 24 had zero remediation_knowledge_base rows
-- — confirmed live against local Postgres (see this issue's own SQL, re-run at
-- the bottom of this file) — so a customer/MSP clicking into any of these 24
-- findings (wired into 132 monitoring_package_checks rows across 8 real scan
-- packages, per #4478) got no remediation_steps, no admin_center_path, no
-- validation guidance at all.
--
-- AUTHORING STANDARD (see #1924/#2041-2056, reused verbatim per this issue):
--   * Every row is verified against real Microsoft Learn / official Microsoft
--     docs that were actually searched/fetched in build session #4501
--     (2026-09-17). The URLs in source_urls are those pages.
--   * verified_by is an HONEST AGENT attribution — never a human name. The
--     content is agent-authored and awaiting a human spot-check (filed as a
--     Shane To-Do in this issue's completion comment).
--   * Tenant-specific values use angle-bracket placeholders, never a
--     fabricated real value.
--   * fix_route_capability is the finding-side CEILING (#1539): you_must_run
--     when a real customer-runnable script is authored in a step's `code`;
--     admin_center_only when the real fix is portal-only or a human-judgment
--     policy decision rather than a single flip-a-setting script. NEVER
--     we_can_run here — that shape requires a live config pack mapped to the
--     check (#1925's job), which none of these 24 have.
--
-- IMPLEMENTATION NOTE (also filed as a Git finding, see #4501's completion
-- comment): several of these 24 checks are genuinely advanced/rarely-used
-- Entra ID policy objects (claims-mapping, token-issuance, token-lifetime,
-- home-realm-discovery, app-management-policies) that have NO Microsoft
-- admin-center UI at all — they are Microsoft Graph/PowerShell-only surfaces
-- by Microsoft's own design, not a gap in this platform. The content below
-- says so honestly (admin_center_path is NULL, admin_center_url is NULL)
-- rather than inventing a portal path that doesn't exist.
--
-- Idempotent: keyed on check_key via ON CONFLICT DO UPDATE, safe to re-run.
-- Additive content only — no schema change (#493/#1539 already built the
-- columns this migration writes into).

BEGIN;

INSERT INTO remediation_knowledge_base (
  check_key, title, summary, prerequisites, admin_center_path, admin_center_url,
  remediation_steps, expected_outcome, validation_step, validation_command,
  source_urls, verified_against, last_verified_at, verified_by, status, fix_route_capability, notes
) VALUES

-- ─────────────────────────────────────────────────────────────────────────────
-- CLUSTER: Session & consent policies
-- ─────────────────────────────────────────────────────────────────────────────

(
  'policy:activity-based-timeout',
  $ttl$Configure idle session timeout for Microsoft 365 web apps$ttl$,
  $sum$An Activity-Based Timeout Policy automatically signs out a user's Microsoft 365 web session (Outlook on the web, OneDrive, SharePoint, and other M365 web apps) after a period of inactivity. Without one, a session left open on a shared, unattended, or stolen device stays authenticated indefinitely — the browser tab itself is a live credential until someone closes it. This does not affect desktop or mobile apps, only the web experience.$sum$,
  jsonb_build_array(
    $prq$Global Administrator for initial activation; Security Administrator, Application Administrator, or Cloud Application Administrator can modify the duration afterward$prq$,
    $prq$No separate license required$prq$
  ),
  $apath$Microsoft 365 admin center -> Settings -> Org settings -> Security & privacy -> Idle session timeout$apath$,
  $aurl$https://admin.microsoft.com/Adminportal/Home#/Settings/Services/:/Settings/L1/L2$aurl$,
  jsonb_build_array(
    jsonb_build_object('text', $stp$In the Microsoft 365 admin center, open Settings -> Org settings -> Security & privacy -> Idle session timeout, turn the toggle on, and choose a timeout duration (a default or a custom value).$stp$),
    jsonb_build_object('text', $stp$Save. Note that turning this on overrides any separate Outlook on the web or SharePoint idle-timeout settings already configured for those services individually — this becomes the single tenant-wide control.$stp$),
    jsonb_build_object('text', $stp$Confirm the underlying policy object programmatically if needed:$stp$, 'code', $cod$Connect-MgGraph -Scopes 'Policy.Read.All'
Get-MgPolicyActivityBasedTimeoutPolicy | Select-Object DisplayName, Definition, IsOrganizationDefault$cod$, 'codeLanguage', $lng$powershell$lng$)
  ),
  $eo$Users idle in an M365 web app for the configured duration see a session-expiry warning and are then signed out of all M365 web apps if they take no action — an unattended browser tab no longer stays authenticated indefinitely.$eo$,
  $vs$Leave an M365 web app open and idle for the configured duration and confirm the sign-out warning and eventual sign-out occur as expected; re-check the policy object programmatically after any change.$vs$,
  $vc$Get-MgPolicyActivityBasedTimeoutPolicy | Select-Object DisplayName, Definition$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/microsoft-365/admin/manage/idle-session-timeout-web-apps$url$,
    $url$https://learn.microsoft.com/en-us/graph/api/resources/activitybasedtimeoutpolicy?view=graph-rest-1.0$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-17$vag$,
  '2026-09-17'::timestamptz,
  $vby$Claude Sonnet 5 (build #4501) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'admin_center_only',
  $note$The real fix is a single portal toggle; the PowerShell in the steps above is read-only verification, not a remediation script, so fix_route_capability stays admin_center_only.$note$
),

(
  'policy:admin-consent-workflow',
  $ttl$Enable the admin consent workflow for blocked app permission requests$ttl$,
  $sum$When a non-admin user tries to consent to an application that requests permissions they cannot grant themselves, the request is blocked by default with no path forward except contacting an administrator informally. The Admin Consent Workflow gives that blocked request a structured, auditable review path: the user can submit a request, designated reviewers get notified, and they approve or deny it from a queue — instead of either a dead end or, worse, someone quietly loosening user consent settings tenant-wide to make the friction go away.$sum$,
  jsonb_build_array(
    $prq$Global Administrator or Privileged Role Administrator to enable the workflow and assign reviewers$prq$,
    $prq$At least one reviewer already identified — a user, group, or role holder willing to act on requests$prq$
  ),
  $apath$Microsoft Entra admin center -> Identity -> Applications -> Enterprise applications -> Consent and permissions -> Admin consent settings$apath$,
  $aurl$https://entra.microsoft.com/#view/Microsoft_AAD_IAM/StartboardApplicationsMenuBlade/~/AdminConsentSettings$aurl$,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Open Enterprise applications -> Consent and permissions -> Admin consent settings and set "Users can request admin consent to apps they are unable to consent to" to Yes.$stp$),
    jsonb_build_object('text', $stp$Under "Who can review admin consent requests", add the specific users, groups, or role holders (typically Global Administrator/Privileged Role Administrator/Cloud Application Administrator) who will actually triage requests.$stp$),
    jsonb_build_object('text', $stp$Enable the email notification options so reviewers are notified when a new request arrives and requesters are notified when their request is decided.$stp$),
    jsonb_build_object('text', $stp$Reviewers then work the queue under Enterprise applications -> Admin consent requests, approving, denying, or blocking each request; only a Global Administrator can approve requests for Microsoft Graph application permissions.$stp$)
  ),
  $eo$A user blocked from self-consenting to an application can submit a request that a real, notified reviewer acts on, instead of the request simply failing silently or an admin loosening user consent policy tenant-wide out of frustration.$eo$,
  $vs$Have a non-admin test user attempt to sign in to an app requiring admin consent, confirm the "request admin approval" option appears, submit it, and confirm a designated reviewer receives the notification and can act on it in Admin consent requests.$vs$,
  NULL,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/configure-admin-consent-workflow$url$,
    $url$https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/admin-consent-workflow-overview$url$,
    $url$https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/review-admin-consent-requests$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-17$vag$,
  '2026-09-17'::timestamptz,
  $vby$Claude Sonnet 5 (build #4501) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'admin_center_only',
  NULL
),

-- ─────────────────────────────────────────────────────────────────────────────
-- CLUSTER: Application management policies
-- ─────────────────────────────────────────────────────────────────────────────

(
  'policy:app-management-policies',
  $ttl$Enable custom application management policies that exist but are not enforced$ttl$,
  $sum$An appManagementPolicy object defines credential/URI restrictions (e.g. maximum client-secret lifetime, blocking password credentials entirely, requiring verified publisher domains) for a specific application or service principal. A policy that exists in the tenant but is not enabled enforces nothing — it is a restriction someone deliberately authored and then either never activated or disabled, leaving the very risk it was written to close (long-lived or unrotated app secrets) wide open on whatever app it targets.$sum$,
  jsonb_build_array(
    $prq$Cloud Application Administrator or Application Administrator role$prq$,
    $prq$Microsoft Graph PowerShell SDK (Microsoft.Graph.Applications), scope Policy.ReadWrite.ApplicationConfiguration — application management policies have no Microsoft admin-center UI as of this writing and are Graph/PowerShell-only$prq$
  ),
  NULL,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$List existing app management policies and their current enabled state to identify which ones are inactive:$stp$, 'code', $cod$Connect-MgGraph -Scopes 'Policy.Read.All'
Get-MgPolicyAppManagementPolicy | Select-Object Id, DisplayName, IsEnabled, Restrictions$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Review each disabled policy's Restrictions (credential lifetime limits, password-credential blocks, key-credential requirements) to confirm the restriction is still the intended one before turning it on — an old draft policy may no longer match current app standards.$stp$),
    jsonb_build_object('text', $stp$Enable the policy once confirmed correct:$stp$, 'code', $cod$Connect-MgGraph -Scopes 'Policy.ReadWrite.ApplicationConfiguration'
Update-MgPolicyAppManagementPolicy -AppManagementPolicyId '<PolicyId>' -IsEnabled$cod$, 'codeLanguage', $lng$powershell$lng$)
  ),
  $eo$Every appManagementPolicy that defines a real credential/URI restriction is enabled, so the restrictions it defines actually apply to the applications/service principals it targets instead of sitting inert.$eo$,
  $vs$Re-list app management policies and confirm IsEnabled is true for every policy that is meant to be active; attempt to create a credential that violates one of the enabled restrictions and confirm it is rejected.$vs$,
  $vc$Get-MgPolicyAppManagementPolicy | Select-Object DisplayName, IsEnabled$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/entra/identity-platform/app-management-policy$url$,
    $url$https://learn.microsoft.com/en-us/graph/api/resources/appmanagementpolicy?view=graph-rest-1.0$url$,
    $url$https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/tutorial-enforce-secret-standards$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-17; Microsoft Graph PowerShell SDK (Microsoft.Graph.Applications)$vag$,
  '2026-09-17'::timestamptz,
  $vby$Claude Sonnet 5 (build #4501) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$No Microsoft admin-center UI exists for this object type — Graph/PowerShell is the only surface Microsoft provides, which is why admin_center_path/admin_center_url are NULL rather than an invented portal path.$note$
),

(
  'policy:default-app-management-policy',
  $ttl$Enable the tenant-wide default application management policy$ttl$,
  $sum$The default app management policy (tenantAppManagementPolicy) is Microsoft's tenant-wide baseline restriction on application and service-principal credential lifetimes and types, applied to every app that does not have its own more specific appManagementPolicy. If it exists but is disabled, there is no floor at all on how long an app's client secret or certificate can live — a credential created once and never rotated remains valid indefinitely, which is exactly the kind of standing, forgotten credential attackers look for.$sum$,
  jsonb_build_array(
    $prq$Cloud Application Administrator or Application Administrator role$prq$,
    $prq$Microsoft Graph PowerShell SDK (Microsoft.Graph.Applications), scope Policy.ReadWrite.ApplicationConfiguration — no admin-center UI exists for this policy as of this writing$prq$
  ),
  NULL,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Check the current state of the tenant default policy:$stp$, 'code', $cod$Connect-MgGraph -Scopes 'Policy.Read.All'
Get-MgPolicyDefaultAppManagementPolicy | Select-Object IsEnabled, ApplicationRestrictions, ServicePrincipalRestrictions$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Review the restriction values (password/key credential lifetime limits) against what your organization actually wants enforced tenant-wide before enabling — this becomes the floor for every app without its own override.$stp$),
    jsonb_build_object('text', $stp$Enable it:$stp$, 'code', $cod$Connect-MgGraph -Scopes 'Policy.ReadWrite.ApplicationConfiguration'
Update-MgPolicyDefaultAppManagementPolicy -IsEnabled$cod$, 'codeLanguage', $lng$powershell$lng$)
  ),
  $eo$Every application/service principal in the tenant that lacks its own more specific appManagementPolicy is now subject to the tenant-wide default credential restrictions instead of having no lifetime limit at all.$eo$,
  $vs$Re-query Get-MgPolicyDefaultAppManagementPolicy and confirm IsEnabled is true; attempt to create an app credential with a lifetime that violates the restriction and confirm Entra ID rejects it.$vs$,
  $vc$Get-MgPolicyDefaultAppManagementPolicy | Select-Object IsEnabled$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/graph/api/resources/tenantappmanagementpolicy?view=graph-rest-1.0$url$,
    $url$https://learn.microsoft.com/en-us/graph/api/tenantappmanagementpolicy-get?view=graph-rest-1.0$url$,
    $url$https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/tutorial-enforce-secret-standards$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-17; Microsoft Graph PowerShell SDK (Microsoft.Graph.Applications)$vag$,
  '2026-09-17'::timestamptz,
  $vby$Claude Sonnet 5 (build #4501) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  NULL
),

-- ─────────────────────────────────────────────────────────────────────────────
-- CLUSTER: External collaboration & authentication flows
-- ─────────────────────────────────────────────────────────────────────────────

(
  'policy:authentication-flows',
  $ttl$Review whether self-service sign-up is appropriate for this tenant$ttl$,
  $sum$Self-service sign-up (governed by the authenticationFlowsPolicy) lets an external user create their own guest account and join a user flow without any administrator provisioning them first. This is a deliberate, useful capability for a tenant running a customer-facing app that needs frictionless external sign-up — but on a tenant with no such app, an enabled self-service sign-up flow is an open door: anyone on the internet can create a guest identity in the directory with no admin ever approving it.$sum$,
  jsonb_build_array(
    $prq$External Identity Provider Administrator or Global Administrator role$prq$
  ),
  $apath$Microsoft Entra admin center -> Identity -> External Identities -> All identity providers -> Self-service sign up (or External Identities -> External collaboration settings for the tenant-wide toggle)$apath$,
  $aurl$https://entra.microsoft.com/#view/Microsoft_AAD_IAM/SelfServiceSignUpMenuBlade$aurl$,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Confirm the current state and which user flows self-service sign-up applies to:$stp$, 'code', $cod$Connect-MgGraph -Scopes 'Policy.Read.All'
Get-MgPolicyAuthenticationFlowPolicy | Select-Object SelfServiceSignUp$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$If no application genuinely needs external users to self-register, disable self-service sign-up in External Identities -> External collaboration settings so guest accounts can only be created via a deliberate B2B invitation.$stp$),
    jsonb_build_object('text', $stp$If it is genuinely needed, restrict which identity providers/social accounts the sign-up flow accepts and confirm every user flow attribute collection step is intentional, not a default that was never reviewed.$stp$)
  ),
  $eo$Guest accounts can only enter the directory through a path the organization actually intends — either a reviewed self-service sign-up flow scoped to a real customer-facing app, or a deliberate B2B invitation, never an unreviewed open door.$eo$,
  $vs$Re-query the authenticationFlowsPolicy and confirm SelfServiceSignUp.IsSelfServiceSignUpEnabled matches the intended state; attempt the self-service sign-up flow anonymously if it should be disabled and confirm it is no longer offered.$vs$,
  $vc$Get-MgPolicyAuthenticationFlowPolicy | Select-Object SelfServiceSignUp$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/entra/external-id/self-service-sign-up-overview$url$,
    $url$https://learn.microsoft.com/en-us/entra/external-id/self-service-sign-up-user-flow$url$,
    $url$https://learn.microsoft.com/en-us/entra/external-id/external-collaboration-settings-configure$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-17; Microsoft Graph PowerShell SDK (Microsoft.Graph.Identity.SignIns)$vag$,
  '2026-09-17'::timestamptz,
  $vby$Claude Sonnet 5 (build #4501) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'admin_center_only',
  $note$Whether self-service sign-up should be ON or OFF is a genuine product decision for the tenant (does it run a customer-facing app that needs it), not a universal "disable it" fix — the steps above frame the decision rather than assuming the answer.$note$
),

(
  'policy:external-identities-policy',
  $ttl$Configure automatic data deletion and self-service leave for external identities$ttl$,
  $sum$The externalIdentitiesPolicy controls two related B2B/B2C hygiene settings: whether an external (guest) identity's directory data is automatically removed once the identity itself is deleted, and whether an external user can self-service leave the tenant via My Account rather than requiring an admin to manually remove them. Without automatic cleanup, deleted guest identities can leave orphaned data behind; without self-service leave, an external user who wants to disassociate from the tenant has no path except contacting an admin who may never act on it.$sum$,
  jsonb_build_array(
    $prq$Global Administrator or External ID User Flow Administrator role$prq$,
    $prq$Microsoft Graph PowerShell SDK (Microsoft.Graph.Identity.SignIns), scope Policy.ReadWrite.ExternalIdentities — this policy is Graph/beta-only, no admin-center UI as of this writing$prq$
  ),
  NULL,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Check the current policy state:$stp$, 'code', $cod$Connect-MgGraph -Scopes 'Policy.Read.All'
Invoke-MgGraphRequest -Method GET -Uri 'https://graph.microsoft.com/beta/policies/externalIdentitiesPolicy'$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Enable allowExternalIdentitiesToLeave so guests can remove themselves from the tenant via My Account without waiting on an admin.$stp$, 'code', $cod$Invoke-MgGraphRequest -Method PATCH -Uri 'https://graph.microsoft.com/beta/policies/externalIdentitiesPolicy' -Body @{ allowExternalIdentitiesToLeave = $true }$cod$, 'codeLanguage', $lng$powershell$lng$)
  ),
  $eo$External identities' data is cleaned up automatically on deletion, and a guest who wants to leave the organization can do so themselves through My Account instead of the removal depending entirely on an admin acting on a request.$eo$,
  $vs$Re-fetch the externalIdentitiesPolicy and confirm allowExternalIdentitiesToLeave is true; have a test guest account attempt to leave via My Account -> Organizations and confirm the option is available.$vs$,
  NULL,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/graph/api/externalidentitiespolicy-get?view=graph-rest-beta$url$,
    $url$https://learn.microsoft.com/en-us/graph/api/resources/externalidentitiespolicy?view=graph-rest-beta$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-17; Microsoft Graph beta$vag$,
  '2026-09-17'::timestamptz,
  $vby$Claude Sonnet 5 (build #4501) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$This Graph resource is beta-only as of this writing — Microsoft's own docs note beta APIs are subject to change and not supported for production use; treat the PATCH step as a documented real command, not a guarantee of long-term API stability.$note$
),

-- ─────────────────────────────────────────────────────────────────────────────
-- CLUSTER: Authentication methods & strength
-- ─────────────────────────────────────────────────────────────────────────────

(
  'policy:authentication-methods-policy',
  $ttl$Complete migration off legacy per-user MFA and disable phishable authentication methods$ttl$,
  $sum$The tenant-wide Authentication Methods Policy is Microsoft's current, unified control surface for which sign-in methods (Microsoft Authenticator, FIDO2, SMS, Voice, etc.) are permitted, superseding the legacy per-user MFA and SSPR policies. Microsoft has fully deprecated managing authentication methods through the legacy surfaces — as of September 30, 2025 they can no longer be managed there at all. A tenant still on legacy per-user MFA, or with SMS/Voice (both phishable, SIM-swap-vulnerable methods) left enabled tenant-wide, is carrying real, avoidable sign-in risk that Microsoft's own migration tooling exists specifically to close.$sum$,
  jsonb_build_array(
    $prq$Authentication Policy Administrator or Global Administrator role$prq$,
    $prq$Review of current per-user MFA and SSPR settings before migrating, since the migration is intended to be reversible but should be run deliberately, not blindly$prq$
  ),
  $apath$Microsoft Entra admin center -> Protection -> Authentication methods -> Policies (the migration wizard is under Authentication methods -> Manage migration)$apath$,
  $aurl$https://entra.microsoft.com/#view/Microsoft_AAD_IAM/AuthMethodsMenuBlade/~/AuthenticationMethodsPolicy$aurl$,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Open Protection -> Authentication methods -> Manage migration and use Microsoft's migration guide, which audits current legacy MFA/SSPR settings and consolidates them into the Authentication Methods Policy automatically.$stp$),
    jsonb_build_object('text', $stp$Under Authentication methods -> Policies, review each method's Enable/Target state. Disable SMS and Voice call unless there is a specific, documented reason a user population cannot use a phishing-resistant alternative.$stp$),
    jsonb_build_object('text', $stp$Confirm the current policy state programmatically:$stp$, 'code', $cod$Connect-MgGraph -Scopes 'Policy.Read.All'
Get-MgPolicyAuthenticationMethodPolicy | Select-Object -ExpandProperty AuthenticationMethodConfigurations | Select-Object Id, State$cod$, 'codeLanguage', $lng$powershell$lng$)
  ),
  $eo$Authentication methods are managed exclusively through the unified Authentication Methods Policy (legacy per-user MFA/SSPR management is fully retired), and SMS/Voice are disabled tenant-wide except where a specifically documented exception applies.$eo$,
  $vs$Re-run the authentication methods migration guide's audit view and confirm it reports the tenant as fully migrated; re-query AuthenticationMethodConfigurations and confirm Sms and Voice show State = disabled unless deliberately excepted.$vs$,
  $vc$(Get-MgPolicyAuthenticationMethodPolicy).AuthenticationMethodConfigurations | Where-Object { $_.Id -in @('Sms','Voice') } | Select-Object Id, State$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/entra/identity/authentication/concept-authentication-methods-manage$url$,
    $url$https://learn.microsoft.com/en-us/entra/identity/authentication/how-to-authentication-methods-manage$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-17; Microsoft Graph PowerShell SDK (Microsoft.Graph.Identity.SignIns)$vag$,
  '2026-09-17'::timestamptz,
  $vby$Claude Sonnet 5 (build #4501) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'admin_center_only',
  NULL
),

(
  'policy:authentication-strength-policies',
  $ttl$Create a custom phishing-resistant Authentication Strength for sensitive access$ttl$,
  $sum$Microsoft's three built-in Conditional Access authentication strengths (Multifactor, Passwordless MFA, Phishing-resistant MFA) cover common cases, but the "Multifactor authentication strength" built-in still accepts SMS and Voice as satisfying MFA — both phishable. A tenant with zero custom authentication strengths has no way to require an organization-tailored, tighter combination (e.g. FIDO2/Windows Hello for Business only) for its most sensitive resources; every Conditional Access policy referencing authentication strength is stuck with Microsoft's built-in options only.$sum$,
  jsonb_build_array(
    $prq$Microsoft Entra ID P1 (required for Conditional Access) and Conditional Access Administrator or Global Administrator role$prq$,
    $prq$At least one sensitive resource/app identified that should require a stronger combination than the built-in strengths provide$prq$
  ),
  $apath$Microsoft Entra admin center -> Protection -> Authentication methods -> Authentication strengths -> New authentication strength$apath$,
  $aurl$https://entra.microsoft.com/#view/Microsoft_AAD_IAM/AuthenticationStrengthMenuBlade$aurl$,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Under Authentication strengths, select New authentication strength and choose exactly which authentication method combinations to allow (e.g. only FIDO2 security key and Windows Hello for Business, deliberately excluding SMS/Voice/one-time-passcode-only combinations).$stp$, 'code', $cod$Connect-MgGraph -Scopes 'Policy.ReadWrite.AuthenticationMethod'
New-MgPolicyAuthenticationStrengthPolicy -DisplayName 'Phishing-resistant only' -AllowedCombinations @('fido2','windowsHelloForBusiness')$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Reference the new custom strength from a Conditional Access policy scoped to the sensitive resource/app, so it is actually enforced rather than merely existing as an unused definition.$stp$)
  ),
  $eo$At least one custom authentication strength exists that excludes phishable methods, and it is actually referenced by a Conditional Access policy protecting the specific sensitive resource it was created for — not left defined and unused.$eo$,
  $vs$Re-list custom authentication strengths and confirm at least one exists with the intended AllowedCombinations; confirm the target Conditional Access policy's grant control references it (not a built-in strength) and test that a non-compliant method combination is actually blocked.$vs$,
  $vc$Get-MgPolicyAuthenticationStrengthPolicy | Where-Object { $_.PolicyType -eq 'custom' } | Select-Object DisplayName, AllowedCombinations$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/entra/identity/authentication/concept-authentication-strengths$url$,
    $url$https://learn.microsoft.com/en-us/entra/identity/authentication/concept-authentication-strength-advanced-options$url$,
    $url$https://learn.microsoft.com/en-us/entra/identity/authentication/how-to-deploy-phishing-resistant-passwordless-authentication$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-17; Microsoft Graph PowerShell SDK (Microsoft.Graph.Identity.SignIns)$vag$,
  '2026-09-17'::timestamptz,
  $vby$Claude Sonnet 5 (build #4501) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$Up to 15 custom authentication strengths are allowed per tenant (Microsoft Learn); the fix requires Entra ID P1 for Conditional Access, which the prerequisites note but does not assume is already licensed.$note$
),

(
  'policy:security-defaults',
  $ttl$Enable Security Defaults where Conditional Access is not already covering the same baseline$ttl$,
  $sum$Security Defaults is Microsoft's free, fixed baseline of identity protections — MFA registration and enforcement for all users, blocking legacy authentication, requiring admins to use MFA, and protecting privileged actions. It is enabled by default for every new tenant, so a tenant showing it disabled either had it deliberately turned off (typically to move to Conditional Access, which is correct if CA genuinely covers the same ground) or never had it enabled and has no equivalent protection in its place. The check only signals a real gap when Security Defaults is off AND no Conditional Access policy is enforcing MFA/legacy-auth blocking in its place.$sum$,
  jsonb_build_array(
    $prq$Global Administrator, Security Administrator, or Conditional Access Administrator role$prq$,
    $prq$If Conditional Access (Entra ID P1/P2) is licensed and already enforcing MFA/legacy-auth blocking tenant-wide, Security Defaults is correctly left off — do not enable both$prq$
  ),
  $apath$Microsoft Entra admin center -> Identity -> Overview -> Properties -> Manage security defaults$apath$,
  $aurl$https://entra.microsoft.com/#view/Microsoft_AAD_IAM/TenantOverview.ReactView$aurl$,
  jsonb_build_array(
    jsonb_build_object('text', $stp$First confirm whether Conditional Access already enforces MFA for all/privileged users and blocks legacy authentication — if it genuinely does, Security Defaults is correctly off and this finding should be closed as intentional, not remediated by enabling it.$stp$),
    jsonb_build_object('text', $stp$If no equivalent Conditional Access coverage exists, go to Identity -> Overview -> Properties -> Manage security defaults, set Security defaults to Enabled, and Save.$stp$),
    jsonb_build_object('text', $stp$Verify programmatically:$stp$, 'code', $cod$Connect-MgGraph -Scopes 'Policy.Read.All'
(Get-MgPolicyIdentitySecurityDefaultEnforcementPolicy).IsEnabled$cod$, 'codeLanguage', $lng$powershell$lng$)
  ),
  $eo$Either Security Defaults is enabled and providing Microsoft's baseline MFA/legacy-auth protections, or Conditional Access is confirmed to already provide equivalent or stronger coverage — the tenant is never left with neither.$eo$,
  $vs$Re-query the security default enforcement policy and confirm IsEnabled is true (or, if intentionally left false, confirm and document the specific Conditional Access policies providing equivalent MFA/legacy-auth coverage).$vs$,
  $vc$(Get-MgPolicyIdentitySecurityDefaultEnforcementPolicy).IsEnabled$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/entra/fundamentals/security-defaults$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-17; Microsoft Graph PowerShell SDK (Microsoft.Graph.Identity.SignIns)$vag$,
  '2026-09-17'::timestamptz,
  $vby$Claude Sonnet 5 (build #4501) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'admin_center_only',
  $note$This check's own live query/threshold (per the general pattern noted in prior domain migrations, e.g. #2042) may not yet cross-reference Conditional Access coverage before flagging Security Defaults as off — that cross-check is a real engineering gap worth verifying separately, out of scope for this content-authoring issue.$note$
),

-- ─────────────────────────────────────────────────────────────────────────────
-- CLUSTER: Advanced token & claims policies (Graph/PowerShell-only surfaces)
-- ─────────────────────────────────────────────────────────────────────────────

(
  'policy:claims-mapping-policies',
  $ttl$Review any custom claims-mapping policy for continued necessity and correctness$ttl$,
  $sum$A claimsMappingPolicy alters the default claims Entra ID issues into a token for a specific application — an advanced capability meant for a specific application compatibility need (e.g. an app expecting a claim under a legacy name), not a routine setting. Any custom claims-mapping policy assigned to a service principal is worth a deliberate review: it is either solving a real, still-current app requirement, or it is a forgotten customization from a decommissioned integration that is now quietly altering token contents for no one.$sum$,
  jsonb_build_array(
    $prq$Cloud Application Administrator or Application Administrator role$prq$,
    $prq$Microsoft Graph PowerShell SDK (Microsoft.Graph.Applications), scope Policy.Read.All / Policy.ReadWrite.ApplicationConfiguration — no admin-center UI exists for this policy type$prq$
  ),
  NULL,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$List every claims-mapping policy and which service principals it is assigned to:$stp$, 'code', $cod$Connect-MgGraph -Scopes 'Policy.Read.All','Application.Read.All'
Get-MgPolicyClaimMappingPolicy | Select-Object Id, DisplayName, Definition
Get-MgServicePrincipal -All | ForEach-Object { Get-MgServicePrincipalClaimMappingPolicyByRef -ServicePrincipalId $_.Id -ErrorAction SilentlyContinue }$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$For each assignment, confirm the target application still exists, is still in use, and still requires the specific claim customization. Remove the assignment from any decommissioned or no-longer-relevant application.$stp$)
  ),
  $eo$Every custom claims-mapping policy assignment maps to a genuinely active application with a real, documented reason for the customization — no stale assignment is silently altering token contents for a retired integration.$eo$,
  $vs$Re-run the assignment listing and confirm every remaining assignment is against a currently active, in-use service principal with a documented reason on file.$vs$,
  NULL,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/graph/how-to-claims-customization$url$,
    $url$https://learn.microsoft.com/en-us/graph/api/resources/claimsmappingpolicy?view=graph-rest-1.0$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-17; Microsoft Graph PowerShell SDK (Microsoft.Graph.Applications)$vag$,
  '2026-09-17'::timestamptz,
  $vby$Claude Sonnet 5 (build #4501) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$No admin-center UI exists for this object type. Existence of a custom claims-mapping policy is not inherently a finding — the fix is a review-and-clean-up action, not a blanket "remove all policies" instruction.$note$
),

(
  'policy:token-issuance-policies',
  $ttl$Review any custom SAML token-issuance policy for continued necessity and correctness$ttl$,
  $sum$A tokenIssuancePolicy customizes the characteristics of SAML tokens Entra ID issues for a specific application — SAML token version, signing algorithm, name-ID format. Like claims-mapping, this is a targeted app-compatibility customization, not a routine setting. Its risk is the same as any forgotten customization: a policy left assigned to a decommissioned SAML application, or one whose signing configuration no longer matches current security standards (e.g. a weaker signing algorithm than the application actually needs today).$sum$,
  jsonb_build_array(
    $prq$Cloud Application Administrator or Application Administrator role$prq$,
    $prq$Microsoft Graph PowerShell SDK (Microsoft.Graph.Applications), scope Policy.Read.All — no admin-center UI exists for this policy type$prq$
  ),
  NULL,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$List existing token-issuance policies and their assignments:$stp$, 'code', $cod$Connect-MgGraph -Scopes 'Policy.Read.All','Application.Read.All'
Get-MgPolicyTokenIssuancePolicy | Select-Object Id, DisplayName, Definition$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$For each policy, confirm the SAML application it is assigned to is still active, and confirm the signing algorithm/token version defined still matches that application's current requirements — not an outdated configuration from initial setup.$stp$)
  ),
  $eo$Every custom token-issuance policy is assigned to a currently active SAML application with signing characteristics that match that application's real, current requirements.$eo$,
  $vs$Re-list token-issuance policies and confirm every remaining assignment is against an active application with a documented, still-correct signing configuration.$vs$,
  NULL,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/graph/api/resources/tokenissuancepolicy?view=graph-rest-1.0$url$,
    $url$https://learn.microsoft.com/en-us/entra/identity-platform/reference-saml-tokens$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-17; Microsoft Graph PowerShell SDK (Microsoft.Graph.Applications)$vag$,
  '2026-09-17'::timestamptz,
  $vby$Claude Sonnet 5 (build #4501) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  NULL
),

(
  'policy:token-lifetime-policies',
  $ttl$Review custom token lifetime policies and migrate sign-in frequency control to Conditional Access$ttl$,
  $sum$A tokenLifetimePolicy can extend how long an access, ID, or SAML token remains valid before it must be refreshed. Microsoft removed the ability to configure refresh/session token lifetimes through this mechanism in January 2021 — only access/ID/SAML token lifetime remains configurable here — and now directs customers to Conditional Access sign-in frequency for controlling how often users must re-authenticate. A custom policy that extends token validity beyond the default directly extends how long a stolen token remains usable if a session is ever compromised.$sum$,
  jsonb_build_array(
    $prq$Cloud Application Administrator or Application Administrator role$prq$,
    $prq$Microsoft Graph PowerShell SDK (Microsoft.Graph.Applications), scope Policy.Read.All — no admin-center UI exists for this policy type$prq$
  ),
  NULL,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$List existing token lifetime policies and their configured lifetimes:$stp$, 'code', $cod$Connect-MgGraph -Scopes 'Policy.Read.All','Application.Read.All'
Get-MgPolicyTokenLifetimePolicy | Select-Object Id, DisplayName, Definition, IsOrganizationDefault$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$For any policy extending a token's default lifetime beyond what is genuinely required, shorten it back toward Microsoft's default, or remove the policy entirely if it is not solving a real, current problem.$stp$),
    jsonb_build_object('text', $stp$If the underlying goal is actually "require users to re-authenticate more often," implement that via a Conditional Access policy's sign-in frequency control instead — that is Microsoft's current, supported mechanism for this, not a token lifetime policy.$stp$)
  ),
  $eo$No token lifetime policy extends validity beyond a deliberately justified, documented duration, and any real re-authentication-frequency requirement is enforced through Conditional Access sign-in frequency, not through extended token lifetime.$eo$,
  $vs$Re-list token lifetime policies and confirm remaining lifetimes are at or near Microsoft defaults, or documented and justified if extended; confirm re-authentication requirements are separately enforced via Conditional Access sign-in frequency.$vs$,
  NULL,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/entra/identity-platform/configurable-token-lifetimes$url$,
    $url$https://learn.microsoft.com/en-us/graph/api/resources/tokenlifetimepolicy?view=graph-rest-1.0$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-17; Microsoft Graph PowerShell SDK (Microsoft.Graph.Applications)$vag$,
  '2026-09-17'::timestamptz,
  $vby$Claude Sonnet 5 (build #4501) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  NULL
),

(
  'policy:home-realm-discovery',
  $ttl$Audit Home Realm Discovery policies for correct, unaltered sign-in routing$ttl$,
  $sum$A Home Realm Discovery (HRD) policy controls how Entra ID routes a user's sign-in — which federated identity provider a given domain is directed to, and whether sign-in "auto-accelerates" straight to that provider without showing the normal Microsoft sign-in page first. Because this policy governs where authentication actually happens, a maliciously or mistakenly altered HRD policy can silently redirect sign-in for a domain to an attacker-controlled federation endpoint, or auto-accelerate users past a page where they might otherwise notice something is wrong.$sum$,
  jsonb_build_array(
    $prq$Hybrid Identity Administrator or Global Administrator role$prq$,
    $prq$Microsoft Graph PowerShell SDK (Microsoft.Graph.Identity.SignIns), scope Policy.Read.All — no admin-center UI exists for directly editing this policy as of this writing$prq$
  ),
  NULL,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$List every Home Realm Discovery policy and its definition (AccelerateToFederatedDomain, PreferredDomain, domain hints):$stp$, 'code', $cod$Connect-MgGraph -Scopes 'Policy.Read.All'
Get-MgPolicyHomeRealmDiscoveryPolicy | Select-Object Id, DisplayName, Definition, IsOrganizationDefault$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Confirm every domain referenced and every federation target in each policy's definition is expected and matches the organization's real, current federation configuration — treat any policy or domain mapping no one recognizes as a potential compromise indicator requiring immediate investigation, not routine cleanup.$stp$)
  ),
  $eo$Every Home Realm Discovery policy in the tenant is accounted for, matches the organization's real federation setup, and routes sign-in only to identity providers the organization actually operates.$eo$,
  $vs$Re-list Home Realm Discovery policies and confirm no new or altered policy has appeared since the last review; test sign-in for each federated domain and confirm it routes to the expected identity provider.$vs$,
  $vc$Get-MgPolicyHomeRealmDiscoveryPolicy | Select-Object DisplayName, Definition$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/graph/api/resources/homerealmdiscoverypolicy?view=graph-rest-1.0$url$,
    $url$https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/configure-authentication-for-federated-users-portal$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-17; Microsoft Graph PowerShell SDK (Microsoft.Graph.Identity.SignIns)$vag$,
  '2026-09-17'::timestamptz,
  $vby$Claude Sonnet 5 (build #4501) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'admin_center_only',
  $note$fix_route_capability is admin_center_only (not you_must_run) even though PowerShell is shown, because the real remediation here is a human security review/judgment call about whether a policy's routing is legitimate — there is no safe blind script that "fixes" a suspicious HRD policy without a human confirming intent first.$note$
),

-- ─────────────────────────────────────────────────────────────────────────────
-- CLUSTER: Cross-tenant access
-- ─────────────────────────────────────────────────────────────────────────────

(
  'policy:cross-tenant-access-default',
  $ttl$Tighten the default cross-tenant access policy's inbound B2B trust settings$ttl$,
  $sum$The default cross-tenant access policy is the fallback that governs B2B collaboration with every external Microsoft Entra organization that does not have its own specific override. Two settings matter most: whether inbound B2B collaboration is open to all external users by default, and whether MFA/device claims asserted by an external tenant are trusted without your own tenant re-challenging. A wide-open default combined with blind trust of external MFA claims means any user in any external Entra tenant can potentially collaborate into yours, and their home tenant's (possibly much weaker) MFA is taken at face value.$sum$,
  jsonb_build_array(
    $prq$Security Administrator or Global Administrator role$prq$
  ),
  $apath$Microsoft Entra admin center -> Identity -> External Identities -> Cross-tenant access settings -> Default settings$apath$,
  $aurl$https://entra.microsoft.com/#view/Microsoft_AAD_IAM/CrossTenantAccessSettingsMenuBlade/~/Overview$aurl$,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Open Cross-tenant access settings -> Default settings -> B2B collaboration and review the inbound/outbound access defaults — restrict inbound access to specific users/groups/apps rather than "Allow access" for all external users unless the organization genuinely needs open collaboration.$stp$),
    jsonb_build_object('text', $stp$Review the Trust settings tab and only enable "Trust multifactor authentication from Microsoft Entra tenants" (or device/compliant-device claims) if there is a real, deliberate reason to accept an external tenant's MFA as sufficient rather than re-challenging.$stp$),
    jsonb_build_object('text', $stp$For any external organization that genuinely needs different (tighter or looser) treatment than the default, create a specific organizational override rather than loosening the tenant-wide default to accommodate one partner.$stp$)
  ),
  $eo$The default cross-tenant access policy reflects a deliberately chosen inbound access posture (not an unreviewed "allow all"), and MFA/device trust from external tenants is enabled only where a specific, documented reason exists — not accepted blindly by default.$eo$,
  $vs$Re-open Default settings and confirm the B2B collaboration inbound/outbound access scope and Trust settings match the intended posture; attempt a collaboration/sign-in from an unrelated test external tenant and confirm it is handled per the intended default.$vs$,
  NULL,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/entra/external-id/cross-tenant-access-overview$url$,
    $url$https://learn.microsoft.com/en-us/entra/external-id/cross-tenant-access-settings-b2b-collaboration$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-17$vag$,
  '2026-09-17'::timestamptz,
  $vby$Claude Sonnet 5 (build #4501) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'admin_center_only',
  NULL
),

(
  'policy:cross-tenant-partners',
  $ttl$Add a partner-specific cross-tenant access override where the default policy is not sufficient$ttl$,
  $sum$Without any organization-specific (partner) override, every single external Microsoft Entra tenant your users collaborate with is governed purely by the one tenant-wide default cross-tenant access policy — there is no way to grant a trusted partner broader access, or apply extra restriction to a specific higher-risk external organization, without changing the default for everyone. Zero partner overrides is not automatically wrong on a tenant with little cross-tenant collaboration, but it means any differentiated treatment a real partnership needs has not been configured.$sum$,
  jsonb_build_array(
    $prq$Security Administrator or Global Administrator role$prq$,
    $prq$The specific external tenant ID(s) that need a differentiated policy already identified$prq$
  ),
  $apath$Microsoft Entra admin center -> Identity -> External Identities -> Cross-tenant access settings -> Organizational settings -> Add organization$apath$,
  $aurl$https://entra.microsoft.com/#view/Microsoft_AAD_IAM/CrossTenantAccessSettingsMenuBlade/~/AllowOrgAccess$aurl$,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Identify which external organizations your users actually collaborate with (e.g. via existing B2B guest accounts or sign-in logs) that warrant access different from the tenant-wide default.$stp$),
    jsonb_build_object('text', $stp$Under Organizational settings, select Add organization, enter that tenant's ID, and configure the B2B collaboration/trust settings specifically for that relationship rather than adjusting the default for every external tenant.$stp$)
  ),
  $eo$Every external organization whose actual collaboration relationship differs materially from the tenant-wide default has its own explicit override on file, so the default policy is not being stretched to cover a relationship it was never designed for.$eo$,
  $vs$Re-open Organizational settings and confirm an override exists for each partner identified as needing differentiated treatment; confirm collaboration with that partner behaves per the override, not the default.$vs$,
  NULL,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/entra/external-id/cross-tenant-access-settings-b2b-collaboration$url$,
    $url$https://learn.microsoft.com/en-us/entra/external-id/cross-tenant-access-overview$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-17$vag$,
  '2026-09-17'::timestamptz,
  $vby$Claude Sonnet 5 (build #4501) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'admin_center_only',
  $note$Zero partner overrides is informational, not inherently a defect — the remediation is "add one where a real differentiated relationship exists," not "you must have at least one."$note$
),

(
  'policy:cross-tenant-m365-capabilities',
  $ttl$Review Microsoft 365 app cross-cloud capability restrictions for cross-tenant collaboration$ttl$,
  $sum$Beyond generic B2B trust, Microsoft 365 apps (principally Teams and OneDrive/SharePoint) have their own cross-tenant collaboration capability settings — whether users can be discovered, chatted with, or share/co-author files across tenant boundaries. A custom override here changes what those specific apps allow beyond the tenant's general B2B default, and an override no one remembers configuring (or one that grants broader cross-tenant Teams/OneDrive access than intended) is a real, app-specific exposure separate from the general cross-tenant access policy.$sum$,
  jsonb_build_array(
    $prq$Security Administrator or Global Administrator role$prq$,
    $prq$Teams Administrator input if the M365 app capability in question is Teams-specific external access$prq$
  ),
  $apath$Microsoft Entra admin center -> Identity -> External Identities -> Cross-tenant access settings -> Default settings -> Microsoft cloud settings tab (or the equivalent per-organization tab for a specific override)$apath$,
  $aurl$https://entra.microsoft.com/#view/Microsoft_AAD_IAM/CrossTenantAccessSettingsMenuBlade/~/Overview$aurl$,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Open the Microsoft cloud settings (Teams/OneDrive cross-cloud collaboration) tab under Cross-tenant access settings and review any custom capability override against what the organization actually intends for cross-tenant Teams chat/meetings and OneDrive/SharePoint sharing.$stp$),
    jsonb_build_object('text', $stp$Remove or tighten any override that grants broader cross-tenant M365 app access than a real, current business need justifies.$stp$)
  ),
  $eo$Cross-tenant Microsoft 365 app capabilities (Teams external access, OneDrive/SharePoint cross-tenant sharing) match a deliberately reviewed, documented business need — no forgotten override is granting broader access than intended.$eo$,
  $vs$Re-open the Microsoft cloud settings tab and confirm the capability configuration matches the documented intended state; test cross-tenant Teams chat or OneDrive sharing with a test external account and confirm behavior matches the policy.$vs$,
  NULL,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/entra/external-id/cross-cloud-settings$url$,
    $url$https://learn.microsoft.com/en-us/entra/external-id/cross-tenant-access-overview$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-17$vag$,
  '2026-09-17'::timestamptz,
  $vby$Claude Sonnet 5 (build #4501) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'admin_center_only',
  NULL
),

(
  'policy:cross-tenant-identity-sync-template',
  $ttl$Review the multitenant organization's identity synchronization template default$ttl$,
  $sum$For a multitenant organization (multiple Microsoft Entra tenants under common ownership), the cross-tenant identity synchronization configuration template sets the default inbound user/group sync behavior applied to any partner tenant that joins the multitenant org — without manually reconfiguring sync for each one. A template whose default is broader than intended means every new partner tenant automatically inherits that broad sync behavior the moment it joins, rather than each partner relationship being deliberately scoped.$sum$,
  jsonb_build_array(
    $prq$Global Administrator or Security Administrator role in the multitenant organization's home tenant$prq$,
    $prq$Only applicable to a tenant that is actually part of a Microsoft Entra multitenant organization — not every tenant will have one configured$prq$
  ),
  $apath$Microsoft Entra admin center -> Identity -> Multitenant organizations -> your multitenant org -> Configuration templates$apath$,
  $aurl$https://entra.microsoft.com/#view/Microsoft_AAD_IAM/MultiTenantOrganizationMenuBlade$aurl$,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Open the multitenant organization's Configuration templates and review the default cross-tenant synchronization template's inbound sync scope (which users/groups sync automatically to newly joining partner tenants).$stp$),
    jsonb_build_object('text', $stp$Narrow the template's default sync scope if it currently applies more broadly than the organization intends for a newly onboarded partner tenant, then apply it via the Microsoft Graph API configuration template endpoint if a portal control for the specific field is not yet available.$stp$)
  ),
  $eo$The multitenant organization's default identity synchronization template scopes exactly the users/groups intended to sync automatically to a newly joining partner tenant — no partner inherits broader sync than the organization deliberately chose.$eo$,
  $vs$Re-open Configuration templates and confirm the template's sync scope matches the documented intended default; add a test partner tenant to the multitenant org and confirm only the intended users/groups sync.$vs$,
  NULL,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/entra/identity/multi-tenant-organizations/multi-tenant-organization-templates$url$,
    $url$https://learn.microsoft.com/en-us/entra/identity/multi-tenant-organizations/multi-tenant-organization-configure-templates$url$,
    $url$https://learn.microsoft.com/en-us/entra/identity/multi-tenant-organizations/cross-tenant-synchronization-overview$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-17$vag$,
  '2026-09-17'::timestamptz,
  $vby$Claude Sonnet 5 (build #4501) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'admin_center_only',
  $note$Only meaningful for a tenant that is genuinely part of a configured multitenant organization — on a standalone tenant this check should be expected to find nothing to remediate.$note$
),

-- ─────────────────────────────────────────────────────────────────────────────
-- CLUSTER: Terms of use
-- ─────────────────────────────────────────────────────────────────────────────

(
  'policy:terms-of-use-agreements',
  $ttl$Require users to view Terms of Use before accepting, and require periodic re-acceptance$ttl$,
  $sum$A Terms of Use (ToU) agreement enforced via Conditional Access only provides real accountability if the user is actually made to open and view the document, and if acceptance expires and must be renewed periodically. A ToU agreement that can be accepted without being opened, or that never expires, is acceptance in name only — it cannot demonstrate the user ever actually saw the terms, and a years-old acceptance of possibly-outdated terms is treated as if it were current.$sum$,
  jsonb_build_array(
    $prq$Conditional Access Administrator or Security Administrator role$prq$,
    $prq$A finalized Terms of Use document (PDF) ready to publish$prq$
  ),
  $apath$Microsoft Entra admin center -> Protection -> Conditional Access -> Terms of use$apath$,
  $aurl$https://entra.microsoft.com/#view/Microsoft_AAD_IAM/TermsOfUseMenuBlade$aurl$,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Open Conditional Access -> Terms of use, edit the agreement, and under Require users to expand the terms of use, set this to On so a user cannot accept without first opening the document.$stp$),
    jsonb_build_object('text', $stp$Enable Expire consents and set a periodic re-acceptance interval (or expire on a specific date) so an old acceptance does not stand in permanently for the current version of the terms.$stp$),
    jsonb_build_object('text', $stp$Confirm the Terms of use policy is actually referenced by a Conditional Access policy targeting the intended users — a ToU agreement not attached to any CA policy is never enforced regardless of its own settings.$stp$)
  ),
  $eo$Every published Terms of Use agreement requires the user to open/view the document before accepting, expires on a defined interval, and is actually enforced by a Conditional Access policy — not merely defined and unattached.$eo$,
  $vs$Re-open each Terms of Use agreement and confirm "require users to view" and expiration are both enabled; confirm at least one Conditional Access policy references it; have a test user go through acceptance and confirm the view-before-accept behavior.$vs$,
  NULL,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/entra/identity/conditional-access/terms-of-use$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-17$vag$,
  '2026-09-17'::timestamptz,
  $vby$Claude Sonnet 5 (build #4501) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'admin_center_only',
  NULL
),

-- ─────────────────────────────────────────────────────────────────────────────
-- CLUSTER: Directory / partner-driven licensing, health & delegated administration
-- ─────────────────────────────────────────────────────────────────────────────

(
  'directory:cloud-licensing-allotment-exhausted',
  $ttl$Request an increased licensing allotment before it blocks new assignments$ttl$,
  $sum$A cloud licensing allotment is a pool of licenses your CSP/reselling partner has allocated to your tenant, broken out from their overall subscription. When every unit in an allotment pool is consumed (consumedUnits equals allottedUnits), no further license of that type can be assigned to a new user or group from that pool until either the partner increases the allotment or units are freed up by removing assignments elsewhere — a fully exhausted allotment silently blocks new employee onboarding or license changes the moment it's hit.$sum$,
  jsonb_build_array(
    $prq$This is managed on the partner's side, not directly in the customer tenant's own admin center — the customer's role is to identify the exhausted pool and request more from their partner$prq$
  ),
  NULL,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Identify which allotment pool(s) are fully consumed:$stp$, 'code', $cod$Connect-MgGraph -Scopes 'CloudLicensing.Read'
Invoke-MgGraphRequest -Method GET -Uri 'https://graph.microsoft.com/beta/admin/cloudLicensing/allotments' |
  Select-Object -ExpandProperty value |
  Where-Object { $_.consumedUnits -ge $_.allottedUnits }$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Contact your CSP/reseller partner (the organization managing this tenant's delegated licensing) and request an increased allotment for the exhausted pool, or free up units by identifying and removing unused assignments from that pool first.$stp$)
  ),
  $eo$The exhausted allotment pool has headroom again — either through an increased allotment from the partner or reclaimed unused assignments — so new license assignments from that pool no longer fail.$eo$,
  $vs$Re-query the allotments endpoint and confirm consumedUnits is now below allottedUnits for the previously exhausted pool; attempt a new assignment from that pool and confirm it succeeds.$vs$,
  $vc$(Invoke-MgGraphRequest -Method GET -Uri 'https://graph.microsoft.com/beta/admin/cloudLicensing/allotments').value | Select-Object skuId, allottedUnits, consumedUnits$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/graph/api/resources/cloud-licensing-api-overview?view=graph-rest-beta$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-17; live-observed on the testbed tenant per this check's own monitor_checks description (4 real allotments)$vag$,
  '2026-09-17'::timestamptz,
  $vby$Claude Sonnet 5 (build #4501) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'admin_center_only',
  $note$This is a partner-managed (CSP indirect reseller) construct — the customer tenant does not have its own admin-center UI to directly resize an allotment; the real action is a request to the managing partner, which is why fix_route_capability stays admin_center_only rather than you_must_run despite the Graph query shown being real and runnable.$note$
),

(
  'directory:cloud-licensing-assignment-disabled-plans',
  $ttl$Review license assignments carrying disabled individual service plans$ttl$,
  $sum$A cloud licensing assignment can carry one or more individual service plans (e.g. a specific app within a broader SKU) explicitly disabled, even though the overall license is assigned. This is often intentional — disabling a plan the user doesn't need frees that specific service plan's capacity for someone else — but an assignment with disabled plans nobody remembers deciding to disable can also mean a user is silently missing a feature they actually need from a license they were told they have.$sum$,
  jsonb_build_array(
    $prq$License Administrator or Global Administrator role$prq$
  ),
  NULL,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$List assignments with one or more disabled service plans:$stp$, 'code', $cod$Connect-MgGraph -Scopes 'CloudLicensing.Read','User-UsageRight.Read.All'
Invoke-MgGraphRequest -Method GET -Uri 'https://graph.microsoft.com/beta/admin/cloudLicensing/assignments' |
  Select-Object -ExpandProperty value |
  Where-Object { $_.disabledServicePlanIds.Count -gt 0 }$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$For each flagged assignment, confirm with the assigned user's manager or the user directly whether the disabled plan(s) are a deliberate choice (e.g. a specific app deliberately withheld) or a mistake that should be re-enabled.$stp$)
  ),
  $eo$Every license assignment with disabled service plans has a documented, deliberate reason for each disabled plan — no user is silently missing a service they were told they have because of an unreviewed disabled plan.$eo$,
  $vs$Re-run the disabled-plans query and confirm the remaining flagged assignments all have a documented reason on file; spot-check with an affected user that they have (or correctly lack) access to the specific service.$vs$,
  $vc$(Invoke-MgGraphRequest -Method GET -Uri 'https://graph.microsoft.com/beta/admin/cloudLicensing/assignments').value | Where-Object { $_.disabledServicePlanIds.Count -gt 0 } | Select-Object principalId, disabledServicePlanIds$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/graph/api/resources/cloud-licensing-api-overview?view=graph-rest-beta$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-17; live-observed on the testbed tenant per this check's own monitor_checks description (6 real assignments)$vag$,
  '2026-09-17'::timestamptz,
  $vby$Claude Sonnet 5 (build #4501) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  NULL
),

(
  'directory:cloud-licensing-assignment-errors',
  $ttl$Resolve recorded cloud licensing assignment errors$ttl$,
  $sum$A cloud licensing assignment error is recorded when a license draw from a partner-managed allotment pool fails to apply to its target user or group — the assignment was attempted but did not actually take effect. Unlike the classic Microsoft 365 admin center's per-user "licenses error" banner, this is the partner/CSP-driven cloud licensing surface's own error record, and a user with a recorded assignment error believes (or was told) they have a license they do not actually have working.$sum$,
  jsonb_build_array(
    $prq$License Administrator or Global Administrator role$prq$
  ),
  NULL,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$List recorded assignment errors:$stp$, 'code', $cod$Connect-MgGraph -Scopes 'CloudLicensing.Read'
Invoke-MgGraphRequest -Method GET -Uri 'https://graph.microsoft.com/beta/admin/cloudLicensing/assignmentErrors' | Select-Object -ExpandProperty value$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$For each error, identify the underlying cause (commonly: conflicting license already assigned another way, exhausted allotment pool, or a group-based assignment conflict) and resolve that root cause, then re-attempt the assignment.$stp$),
    jsonb_build_object('text', $stp$Confirm the affected user/group actually has the working license afterward through the standard Microsoft 365 admin center Active users -> Licenses view, not just the absence of a new error record.$stp$)
  ),
  $eo$Zero unresolved cloud licensing assignment errors remain, and every previously-erroring user/group assignment is confirmed actually applied and working.$eo$,
  $vs$Re-query the assignmentErrors endpoint and confirm it returns no entries for the previously affected users/groups; confirm the license shows as active (not pending/error) in the standard admin center licenses view.$vs$,
  $vc$(Invoke-MgGraphRequest -Method GET -Uri 'https://graph.microsoft.com/beta/admin/cloudLicensing/assignmentErrors').value$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/graph/api/resources/cloud-licensing-api-overview?view=graph-rest-beta$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-17; live-observed on the testbed tenant per this check's own monitor_checks description (currently zero recorded errors)$vag$,
  '2026-09-17'::timestamptz,
  $vby$Claude Sonnet 5 (build #4501) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  NULL
),

(
  'directory:org-contact-provisioning-errors',
  $ttl$Resolve provisioning errors on organizational (mail-enabled) contacts$ttl$,
  $sum$An organizational contact represents an external person's mail information (visible in address lists, distribution lists, etc.) without granting them a real account or license. A contact carrying a serviceProvisioningError or onPremisesProvisioningError means the directory object exists but is not syncing/provisioning cleanly — commonly caused by a duplicate proxy address or UPN-shaped value colliding with another object. Left unresolved, that contact behaves unpredictably in mail flow and address list lookups, and on a hybrid tenant the underlying conflict can also block other on-premises sync operations.$sum$,
  jsonb_build_array(
    $prq$Exchange Administrator or Global Administrator role (Hybrid Identity Administrator if the conflict is on-premises-sync-related)$prq$
  ),
  $apath$Exchange admin center -> Recipients -> Contacts (for reviewing/editing the contact itself); Microsoft Entra Connect Health for diagnosing the underlying on-premises sync conflict$apath$,
  $aurl$https://admin.exchange.microsoft.com/#/contacts$aurl$,
  jsonb_build_array(
    jsonb_build_object('text', $stp$List contacts with a recorded provisioning error and read the specific error detail:$stp$, 'code', $cod$Connect-MgGraph -Scopes 'OrgContact.Read.All'
Get-MgContact -All | Where-Object { $_.ServiceProvisioningErrors.Count -gt 0 -or $_.OnPremisesProvisioningErrors.Count -gt 0 } |
  Select-Object DisplayName, ServiceProvisioningErrors, OnPremisesProvisioningErrors$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$For an onPremisesProvisioningError with category PropertyConflict, identify the other directory object sharing the same UserPrincipalName/ProxyAddress value (the errored contact's error detail names the conflicting property) and correct the duplicate value on whichever object is wrong.$stp$),
    jsonb_build_object('text', $stp$If the tenant is hybrid-synced, force a delta sync from Microsoft Entra Connect after correcting the conflict so the error clears rather than waiting for the next scheduled cycle.$stp$)
  ),
  $eo$Zero organizational contacts carry an unresolved provisioning error; the underlying property conflict (duplicate UPN/proxy address) is corrected at its source rather than only on the symptomatic contact.$eo$,
  $vs$Re-run the contact provisioning-error query and confirm it returns no results for the previously affected contact(s); confirm the contact now appears correctly in address list lookups and mail flow.$vs$,
  $vc$Get-MgContact -All | Where-Object { $_.ServiceProvisioningErrors.Count -gt 0 -or $_.OnPremisesProvisioningErrors.Count -gt 0 }$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/graph/api/resources/orgcontact?view=graph-rest-1.0$url$,
    $url$https://learn.microsoft.com/en-us/graph/api/resources/onpremisesprovisioningerror?view=graph-rest-1.0$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-17; live-observed on the testbed tenant per this check's own monitor_checks description (2 real contacts)$vag$,
  '2026-09-17'::timestamptz,
  $vby$Claude Sonnet 5 (build #4501) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  NULL
),

(
  'directory:partner-delegated-admin-relationships',
  $ttl$Review active partner delegated administration (GDAP) relationships$ttl$,
  $sum$Every contract object of this kind represents an external partner/reseller company holding a real, active delegated administration relationship into this tenant under Granular Delegated Admin Privileges (GDAP) — a specific, time-bound, role-scoped grant of admin access, the modern replacement for the old all-or-nothing Delegated Admin Privileges (DAP). Any such relationship is worth surfacing for review precisely because it is a standing external access grant: it should map to a partner the organization actually still works with, scoped to only the roles that partner genuinely needs, not a forgotten relationship from a prior vendor.$sum$,
  jsonb_build_array(
    $prq$Global Administrator or Privileged Role Administrator role$prq$
  ),
  $apath$Microsoft 365 admin center -> Settings -> Partner relationships$apath$,
  $aurl$https://admin.microsoft.com/Adminportal/Home#/partners$aurl$,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Open Settings -> Partner relationships and review every listed GDAP relationship: which partner it is, which Entra roles it grants, and its expiration date.$stp$),
    jsonb_build_object('text', $stp$For any relationship with a partner the organization no longer works with, or that grants broader roles than that partner's current engagement actually requires, end the relationship or request the partner reduce its scope to only the roles genuinely needed.$stp$),
    jsonb_build_object('text', $stp$Confirm programmatically as well:$stp$, 'code', $cod$Connect-MgGraph -Scopes 'DelegatedAdminRelationship.Read.All'
Get-MgTenantRelationshipDelegatedAdminRelationship | Select-Object DisplayName, Status, AccessDetails, EndDateTime$cod$, 'codeLanguage', $lng$powershell$lng$)
  ),
  $eo$Every active GDAP relationship maps to a partner the organization currently and genuinely works with, scoped to only the Entra roles that partner's engagement actually requires, with no stale or over-scoped relationship left standing.$eo$,
  $vs$Re-list Partner relationships and confirm each remaining entry matches a documented, current partner engagement with the expected role scope and expiration.$vs$,
  $vc$Get-MgTenantRelationshipDelegatedAdminRelationship | Select-Object DisplayName, Status, EndDateTime$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/partner-center/customers/gdap-introduction$url$,
    $url$https://learn.microsoft.com/en-us/graph/api/resources/delegatedadminrelationships-api-overview?view=graph-rest-1.0$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-17; live-observed on the testbed tenant per this check's own monitor_checks description (currently zero contracts)$vag$,
  '2026-09-17'::timestamptz,
  $vby$Claude Sonnet 5 (build #4501) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'admin_center_only',
  $note$Zero relationships is not itself a defect — the finding is informational surfacing so any relationship that DOES exist gets a deliberate review, not an instruction that one must exist.$note$
),

(
  'directory:service-health-active-incidents',
  $ttl$Track and respond to active Microsoft 365 service health incidents$ttl$,
  $sum$This check reads the per-incident Microsoft 365 service health detail feed and specifically distinguishes incidents (a real, active service disruption Microsoft has confirmed) from advisories (lower-severity, informational notices) — distinct from the message-center feed (product announcements/changes) and from the health-overview status rollup. An active, unresolved incident affecting a service your organization depends on is a real, current operational risk outside your own tenant's control, but one your organization needs to know about to communicate with affected users and track for resolution.$sum$,
  jsonb_build_array(
    $prq$Service Support Administrator or Helpdesk Administrator role (or higher) to view service health$prq$
  ),
  $apath$Microsoft 365 admin center -> Health -> Service health$apath$,
  $aurl$https://admin.microsoft.com/Adminportal/Home#/servicehealth$aurl$,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Open Health -> Service health and review the Overview tab, filtering for unresolved items classified as Incident rather than Advisory.$stp$),
    jsonb_build_object('text', $stp$For each active incident affecting a service your users depend on, review Microsoft's posted impact description and estimated resolution time, and communicate proactively to affected users rather than waiting for help-desk tickets to surface the same known issue.$stp$),
    jsonb_build_object('text', $stp$Pull the same data programmatically if needed for automated tracking:$stp$, 'code', $cod$Connect-MgGraph -Scopes 'ServiceHealth.Read.All'
Get-MgServiceAnnouncementIssue | Where-Object { $_.IsResolved -eq $false -and $_.Classification -eq 'incident' } |
  Select-Object Title, Service, Classification, StartDateTime$cod$, 'codeLanguage', $lng$powershell$lng$)
  ),
  $eo$Every active Microsoft 365 service incident affecting a service the organization depends on is known, its impact communicated to affected users, and tracked through to Microsoft's resolution — not discovered only via user-reported outages.$eo$,
  $vs$Re-query unresolved incidents and confirm the count reflects Microsoft's current Service health page; confirm affected users were notified for each active incident that was open during the review window.$vs$,
  $vc$Get-MgServiceAnnouncementIssue | Where-Object { $_.IsResolved -eq $false -and $_.Classification -eq 'incident' } | Measure-Object | Select-Object Count$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/microsoft-365/enterprise/view-service-health$url$,
    $url$https://learn.microsoft.com/en-us/graph/service-communications-concept-overview$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-17; live-observed on the testbed tenant per this check's own monitor_checks description (100 real issues, GET /admin/serviceAnnouncement/issues)$vag$,
  '2026-09-17'::timestamptz,
  $vby$Claude Sonnet 5 (build #4501) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'admin_center_only',
  $note$This is a genuine investigative/awareness signal, not a "fix" in the usual sense — Microsoft resolves the underlying service issue, not the tenant, so fix_route_capability stays admin_center_only even though a real read-only PowerShell query is shown.$note$
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
VALUES ('2026-09-17-remediation-kb-policy-directory-domain-4501.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;

-- Verify: all 24 policy:/directory: check keys from #4501's own SQL now have a
-- published remediation_knowledge_base row.
SELECT check_key, status FROM remediation_knowledge_base WHERE check_key IN (
  'policy:activity-based-timeout','policy:admin-consent-workflow','policy:app-management-policies',
  'policy:authentication-flows','policy:authentication-methods-policy','policy:authentication-strength-policies',
  'policy:claims-mapping-policies','policy:cross-tenant-access-default','policy:cross-tenant-identity-sync-template',
  'policy:cross-tenant-m365-capabilities','policy:cross-tenant-partners','policy:default-app-management-policy',
  'policy:external-identities-policy','policy:home-realm-discovery','policy:security-defaults',
  'policy:terms-of-use-agreements','policy:token-issuance-policies','policy:token-lifetime-policies',
  'directory:cloud-licensing-allotment-exhausted','directory:cloud-licensing-assignment-disabled-plans',
  'directory:cloud-licensing-assignment-errors','directory:org-contact-provisioning-errors',
  'directory:partner-delegated-admin-relationships','directory:service-health-active-incidents'
) ORDER BY check_key;
