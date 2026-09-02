-- #2047 — Remediation knowledge base: the appgov: domain, authored & published.
--
-- Populates remediation_knowledge_base with verified "this is wrong → here is how
-- to fix it" content for the appgov: domain, following the authoring standard set
-- by #1924 (identity: domain, commit 5d850839b).
--
-- SCOPE: 8 of the 9 active appgov: checks. `appgov:enterprise-app-registration-list`
-- is DELIBERATELY EXCLUDED — live query confirmed it is not a customer governance
-- finding at all: its filter_params is `displayName eq 'ShaneMcCawConsulting'`,
-- i.e. it checks for the presence of THIS PLATFORM'S OWN multi-tenant app
-- registration as a service principal in the customer's tenant (a connectivity
-- self-test), and the #1134 migration's own comment already classifies it
-- "INTERNAL / DIAGNOSTIC (never in any customer tier)" alongside
-- diagnostics:ps-execution-test — which #1924's identity build likewise excluded
-- from its domain fan-out for the same reason ("internal platform self-test, no
-- customer-facing remediation"). Authoring "how to fix" content for our own app
-- registration as if it were a customer finding would be exactly the kind of
-- invented content the authoring standard forbids. Filed as its own finding —
-- see the build's issue comment on #2047.
--
-- AUTHORING STANDARD (see #1924, applied here for #2047):
--   * Every row is verified against real Microsoft Learn / Microsoft Graph docs
--     that were actually fetched in build session #2047 (2026-09-02). The URLs in
--     source_urls are those pages.
--   * verified_by is an HONEST AGENT attribution — never a human name. The content
--     is agent-authored and awaiting a human spot-check.
--   * Tenant-specific values use angle-bracket placeholders (<ApplicationObjectId>,
--     …), never a fabricated real value.
--   * fix_route_capability is the finding-side CEILING (#1539): you_must_run when a
--     real customer-runnable fix script is authored in a step's `code`;
--     admin_center_only when the real fix is portal-only or the check is a raw
--     metric with no fix command of its own. NEVER we_can_run here — that shape
--     requires a live config pack mapped to the check (#1925's job).
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
-- CLUSTER: App registration credential & lifecycle hygiene
-- ─────────────────────────────────────────────────────────────────────────────

(
  'appgov:cert-secret-expiration',
  $ttl$Rotate expired app registration secrets and certificates$ttl$,
  $sum$This check counts app registration credentials (passwordCredentials and keyCredentials) whose endDateTime has already passed — already expired, not merely expiring soon (a deliberate distinction; see this check's own severity-mapping migration #541). An expired credential can no longer authenticate anything, so the immediate risk isn't that it's a live backdoor — it's what its presence proves: whatever process was supposed to rotate this credential before it lapsed didn't run, which means every OTHER still-valid credential on this tenant's app registrations is on the same unmanaged path to a surprise outage the day it expires too. Microsoft's own guidance also treats any password/certificate credential as inherently higher-risk than a managed identity or federated credential, because secrets are easy to mismanage and hard to track once several accumulate on one app.$sum$,
  jsonb_build_array(
    $prq$Application Administrator or Cloud Application Administrator (or ownership of the specific app) to manage its credentials$prq$,
    $prq$Microsoft Graph PowerShell SDK (Microsoft.Graph.Applications) if automating, scope Application.ReadWrite.All (or Application.ReadWrite.OwnedBy for apps you own)$prq$,
    $prq$Azure Key Vault (or equivalent secure secret store) in place before rotating to a certificate-based credential, per Microsoft's stated preference order$prq$
  ),
  $apath$Microsoft Entra admin center → Identity → Applications → App registrations → (select the app) → Certificates & secrets$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Identify the flagged app registration and its specific expired credential(s) by keyId.$stp$, 'code', $cod$Connect-MgGraph -Scopes 'Application.Read.All'
$app = Get-MgApplication -ApplicationId "<ApplicationObjectId>"
$app.PasswordCredentials | Where-Object { $_.EndDateTime -lt (Get-Date) }
$app.KeyCredentials      | Where-Object { $_.EndDateTime -lt (Get-Date) }$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Add the replacement credential BEFORE removing the expired one, so any still-functioning integration isn't broken mid-rotation. Microsoft's stated preference order is: managed identity > federated credential (e.g. GitHub Actions OIDC) > certificate from a trusted CA > client secret only if nothing else is possible.$stp$, 'code', $cod$Connect-MgGraph -Scopes 'Application.ReadWrite.All'
$params = @{ passwordCredential = @{ displayName = "<NewSecretDisplayName>" } }
Add-MgApplicationPassword -ApplicationId "<ApplicationObjectId>" -BodyParameter $params
# Copy the returned secretText immediately -- Microsoft Entra ID never shows it again.$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Update the dependent service/integration to use the new credential, confirm it authenticates (check sign-in logs for the new Key ID), then remove the expired credential.$stp$, 'code', $cod$Connect-MgGraph -Scopes 'Application.ReadWrite.All'
$params = @{ keyId = "<ExpiredCredentialKeyId>" }
Remove-MgApplicationPassword -ApplicationId "<ApplicationObjectId>" -BodyParameter $params
# For an expired certificate use Remove-MgApplicationKey with the same keyId shape instead.$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Configure an application management policy to cap future secret lifetimes (or require certificates instead) so expired credentials stop accumulating silently. Portal-only: Microsoft Entra admin center → App management policies.$stp$)
  ),
  $eo$The flagged app registration carries no passwordCredentials or keyCredentials with an endDateTime in the past; the integration that depended on the old credential is confirmed authenticating against its replacement.$eo$,
  $vs$Re-run the credential check against the same app registration and confirm both expired-credential counts are zero.$vs$,
  $vc$$app = Get-MgApplication -ApplicationId "<ApplicationObjectId>"
@($app.PasswordCredentials + $app.KeyCredentials) | Where-Object { $_.EndDateTime -lt (Get-Date) } | Measure-Object$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/entra/identity-platform/security-best-practices-for-app-registration$url$,
    $url$https://learn.microsoft.com/en-us/entra/identity/monitoring-health/recommendation-renew-expiring-application-credential$url$,
    $url$https://learn.microsoft.com/en-us/graph/api/application-addpassword?view=graph-rest-1.0$url$,
    $url$https://learn.microsoft.com/en-us/graph/api/application-removepassword?view=graph-rest-1.0$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02; Microsoft Graph PowerShell SDK (Microsoft.Graph.Applications)$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2047) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$Check counts only already-EXPIRED credentials (endDateTime in the past), not ones expiring soon — see #541's migration header for why that distinction was deliberate. Always add the replacement before removing the old one.$note$
),

(
  'appgov:stale-app-registrations',
  $ttl$Review and retire aging app registrations$ttl$,
  $sum$This check flags app registrations by AGE alone — how long ago createdDateTime was, not whether anything still uses them (Graph's /applications resource carries no usage/sign-in signal at all; that lives on the service principal, a different resource — see appgov:dormant-service-principals for the closest available usage proxy). A five-year-old registration in daily production use is counted the same as one nobody remembers creating. That's still a real governance signal: every app registration is a standing object with its own owners, credentials and permission grants, and the older it is without anyone re-confirming it's still needed, the more likely its original owner has left, its purpose is undocumented, and its credentials are the "forgotten secret" this domain's cert-secret-expiration check eventually flags. Age is the trigger to go find out, not proof the app is unused.$sum$,
  jsonb_build_array(
    $prq$Security Reader (or Global Reader) to review the list; Application Administrator or Cloud Application Administrator to deactivate or delete$prq$,
    $prq$Microsoft Graph PowerShell SDK (Microsoft.Graph.Applications) if automating, scope Application.Read.All to review, Application.ReadWrite.All to remove$prq$
  ),
  $apath$Microsoft Entra admin center → Identity → Applications → App registrations (sort/filter by Created date)$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Pull the flagged registrations and their real age, then identify an owner for each (App registrations → the app → Owners) before assuming any of them is safe to remove.$stp$, 'code', $cod$Connect-MgGraph -Scopes 'Application.Read.All'
Get-MgApplication -All | Where-Object { $_.CreatedDateTime -lt (Get-Date).AddDays(-180) } |
  Select-Object DisplayName, AppId, CreatedDateTime$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$For each app, confirm with its owner (or, if unowned, by checking sign-in activity on its service principal) whether it's still in active use. If it is, document why and move on -- age alone is not the finding. If it genuinely isn't, first deactivate to confirm nothing breaks before deleting outright.$stp$, 'code', $cod$Connect-MgGraph -Scopes 'Application.ReadWrite.All'
Update-MgServicePrincipal -ServicePrincipalId "<ServicePrincipalObjectId>" -AccountEnabled:$false$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Once confirmed unneeded, remove the registration. A deleted application is recoverable from the recycle bin for 30 days before it's hard-deleted.$stp$, 'code', $cod$Remove-MgApplication -ApplicationId "<ApplicationObjectId>"$cod$, 'codeLanguage', $lng$powershell$lng$)
  ),
  $eo$Every app registration over the 180/365-day threshold either has a documented current owner and confirmed active use, or has been deactivated/removed; none sit unreviewed purely because no one looked.$eo$,
  $vs$Re-run the age query and confirm the previously-flagged registrations are either gone or now carry a recorded owner/justification.$vs$,
  $vc$Get-MgApplication -All | Where-Object { $_.CreatedDateTime -lt (Get-Date).AddDays(-365) } | Select-Object DisplayName, AppId, CreatedDateTime$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/entra/identity/monitoring-health/recommendation-remove-unused-apps$url$,
    $url$https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/delete-application-portal$url$,
    $url$https://learn.microsoft.com/en-us/entra/identity-platform/security-best-practices-for-app-registration$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02; Microsoft Graph PowerShell SDK (Microsoft.Graph.Applications)$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2047) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$Do not conflate this with Microsoft's own "Remove unused applications" (staleApps) recommendation, which measures actual 90-day TOKEN INACTIVITY via a beta recommendations API -- a stronger, different signal than this check's registration-age proxy. Use that recommendation (Entra ID → Overview → Recommendations) as a second, corroborating signal before deleting an old-but-possibly-live app.$note$
),

-- ─────────────────────────────────────────────────────────────────────────────
-- CLUSTER: Service principal governance
-- ─────────────────────────────────────────────────────────────────────────────

(
  'appgov:dormant-service-principals',
  $ttl$Investigate and remove service principals with no assigned access$ttl$,
  $sum$A service principal is what actually holds an application's granted access in this tenant (its app role assignments and OAuth grants) — the app registration is just the template. When Graph's own $expand=appRoleAssignedTo shows zero entries, nothing (no user, no group, no other service principal) has ever been provisioned to use that identity, yet it still holds whatever permissions were granted to it and still carries any credentials assigned to it. As this check's own description states, this is a provisioning-state proxy, not a confirmed "no sign-in ever happened" claim — Graph v1.0's servicePrincipal resource carries no sign-in-activity property to check that directly. Even so, an object with standing permissions and no one accountable for using it is exactly the kind of unattended credential target that gets found by an attacker long before it gets found by a review.$sum$,
  jsonb_build_array(
    $prq$Directory.Read.All to re-confirm zero assignments before acting (the same scope this platform's own scan already uses)$prq$,
    $prq$Application Administrator or Cloud Application Administrator to disable/remove a service principal$prq$,
    $prq$Application.ReadWrite.All if automating removal$prq$
  ),
  $apath$Microsoft Entra admin center → Identity → Applications → Enterprise applications → (select the app) → Properties → Delete$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Re-confirm zero assignments before acting -- a review-to-remediation gap is real, and this also surfaces who (if anyone) owns the underlying app.$stp$, 'code', $cod$Connect-MgGraph -Scopes 'Directory.Read.All'
Get-MgServicePrincipal -ServicePrincipalId "<ServicePrincipalObjectId>" -ExpandProperty "appRoleAssignedTo"$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Deactivate first to confirm nothing breaks, rather than deleting cold -- Microsoft's own guidance prefers deactivation before deletion for exactly this kind of "probably unused" case, and a deleted service principal still lands in a 30-day recycle bin either way.$stp$, 'code', $cod$Connect-MgGraph -Scopes 'Application.ReadWrite.All'
Update-MgServicePrincipal -ServicePrincipalId "<ServicePrincipalObjectId>" -AccountEnabled:$false$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$After confirming no impact, remove the service principal (and, if this org owns the underlying app registration outright and no other tenant needs it, the registration too).$stp$, 'code', $cod$Remove-MgServicePrincipal -ServicePrincipalId "<ServicePrincipalObjectId>"$cod$, 'codeLanguage', $lng$powershell$lng$)
  ),
  $eo$The service principal either no longer exists in the tenant, or — if it's kept intentionally (e.g. provisioned ahead of a planned rollout) — is documented with a real owner and the reason it currently has zero assignments.$eo$,
  $vs$Re-run the same appRoleAssignedTo expansion and confirm the object no longer exists, or now has a real, current assignment.$vs$,
  $vc$Get-MgServicePrincipal -ServicePrincipalId "<ServicePrincipalObjectId>" -ExpandProperty "appRoleAssignedTo" -ErrorAction SilentlyContinue$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/entra/identity/monitoring-health/recommendation-remove-unused-apps$url$,
    $url$https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/delete-application-portal$url$,
    $url$https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/manage-application-permissions$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02; Microsoft Graph PowerShell SDK (Microsoft.Graph.Applications)$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2047) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$"Dormant" here means zero app role assignments, a provisioning-state signal -- not a confirmed sign-in-activity claim (no such property exists on servicePrincipal in Graph v1.0). Do not render this to a customer as "confirmed unused."$note$
),

(
  'appgov:workload-identity-risk',
  $ttl$Investigate and remediate high-risk service principals$ttl$,
  $sum$Microsoft Entra ID Protection continuously evaluates service principals (workload identities) the same way it evaluates user sign-ins, using offline detections like leaked credentials found in public code or breach data, suspicious sign-in patterns unusual for that identity's own baseline, and admin- or Microsoft-confirmed compromise. A service principal flagged high risk is a materially different situation from a user account flagged high risk: workload identities can't complete MFA, so there is no self-remediation step to fall back on -- an admin has to investigate and act directly, and until then the identity keeps whatever standing permissions it was granted.$sum$,
  jsonb_build_array(
    $prq$Security Administrator, Security Operator, or Security Reader to view Risky workload identities; Security Administrator to dismiss/confirm/act$prq$,
    $prq$Workload Identities Premium license for full risk detail and risk-based Conditional Access enforcement (detections still surface with limited detail on tenants without it)$prq$,
    $prq$Microsoft Graph PowerShell SDK (Microsoft.Graph.Identity.SignIns), scope IdentityRiskyServicePrincipal.ReadWrite.All$prq$
  ),
  $apath$Microsoft Entra admin center → Protection → Identity Protection → Risky workload identities$apath$,
  $aurl$https://entra.microsoft.com/#view/Microsoft_AAD_IAM/RiskyServicePrincipalsBlade$aurl$,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Open the specific flagged service principal in Risky workload identities and review its risk detail: suspicious sign-in properties, leaked credentials, or an admin/Microsoft-confirmed compromise. Key questions per Microsoft's own investigation guidance: suspicious sign-in activity? unauthorized credential changes? suspicious configuration changes? unauthorized app role acquisitions?$stp$),
    jsonb_build_object('text', $stp$Inventory every credential on the flagged service principal/application. If you believe it's genuinely compromised, remove ALL existing credentials, not just the suspicious one.$stp$, 'code', $cod$Connect-MgGraph -Scopes 'Application.ReadWrite.All'
$app = Get-MgApplication -Filter "appId eq '<AppId>'"
$app.PasswordCredentials + $app.KeyCredentials | Select-Object KeyId, DisplayName, EndDateTime$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Add a new credential (Microsoft recommends an x509 certificate over a secret), remove the compromised one(s), and rotate any Azure Key Vault secrets the service principal had access to.$stp$, 'code', $cod$Add-MgApplicationKey -ApplicationId "<ApplicationObjectId>" -BodyParameter @{ ... }   # or Add-MgApplicationPassword for an interim secret
Remove-MgApplicationPassword -ApplicationId "<ApplicationObjectId>" -BodyParameter @{ keyId = "<CompromisedCredentialKeyId>" }$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Record the outcome in Identity Protection: dismiss the risk if investigation shows it was a false positive / already remediated, or confirm the account compromised if real -- this also sets riskState so the identity stops showing as an open risk.$stp$, 'code', $cod$Connect-MgGraph -Scopes 'IdentityRiskyServicePrincipal.ReadWrite.All'
Invoke-MgDismissRiskyServicePrincipal -BodyParameter @{ servicePrincipalIds = @("<ServicePrincipalObjectId>") }
# Or, to record it as compromised instead of dismissing:
# Invoke-MgConfirmCompromisedRiskyServicePrincipal -BodyParameter @{ servicePrincipalIds = @("<ServicePrincipalObjectId>") }$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Once investigated, consider a risk-based Conditional Access policy for workload identities (Workload Identities Premium) so future high-risk sign-ins are blocked automatically rather than relying on someone catching this report.$stp$)
  ),
  $eo$The flagged service principal's riskState is no longer atRisk (either dismissed with justification or confirmedCompromised with its credentials fully rotated); if compromise was confirmed, no old credential remains valid.$eo$,
  $vs$Re-query risky service principals and confirm the flagged identity's riskLevel/riskState reflects the resolution, and that no old credential keyId from before remediation is still present on the app.$vs$,
  $vc$Connect-MgGraph -Scopes 'IdentityRiskyServicePrincipal.Read.All'
Get-MgRiskyServicePrincipal -ServicePrincipalId "<ServicePrincipalObjectId>" | Select-Object DisplayName, RiskLevel, RiskState$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/entra/id-protection/concept-workload-identity-risk$url$,
    $url$https://learn.microsoft.com/en-us/graph/api/resources/riskyserviceprincipal?view=graph-rest-1.0$url$,
    $url$https://learn.microsoft.com/en-us/graph/api/riskyserviceprincipal-dismiss?view=graph-rest-1.0$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02; Microsoft Graph PowerShell SDK (Microsoft.Graph.Identity.SignIns)$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2047) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$riskyServicePrincipal full risk detail requires Workload Identities Premium; without it, detections still surface but with limited reporting. Managed identities are out of scope for this API. Confirm-compromised is a one-way, security-significant admin decision -- do not automate it without human review.$note$
),

-- ─────────────────────────────────────────────────────────────────────────────
-- CLUSTER: Consent grants & governance
-- ─────────────────────────────────────────────────────────────────────────────

(
  'appgov:consent-policy-status',
  $ttl$Review and, if appropriate, restrict user consent to applications$ttl$,
  $sum$This check reads the tenant's authorizationPolicy to report whether the concept of user (self-)consent is configured at all — the mechanism by which an ordinary employee can be shown an OAuth "this app wants access to your mailbox/files/calendar" prompt and grant it themselves, with no administrator ever reviewing the request. Illicit-consent phishing (a fake app requesting real permissions through a legitimate-looking consent prompt) is one of the most common ways an attacker gets standing, MFA-proof access to a mailbox without ever needing the user's password. Whether wide-open user consent is actually a problem for a given tenant depends on which policy is assigned (unrestricted "allow any app" vs. "verified publisher, low-impact permissions only" vs. fully disabled) — this check's presence signal alone doesn't distinguish those, so read the tenant's real assigned policy before treating a finding here as urgent.$sum$,
  jsonb_build_array(
    $prq$Privileged Role Administrator (Global Administrator only required for the Microsoft Entra admin center UI path)$prq$,
    $prq$Microsoft Graph PowerShell SDK (Microsoft.Graph.Identity.SignIns) if automating: Policy.Read.All to read, Policy.ReadWrite.Authorization to change$prq$,
    $prq$Permission classifications configured in advance (Enterprise apps → Consent and permissions → Permission classifications) if restricting rather than fully disabling user consent$prq$
  ),
  $apath$Microsoft Entra admin center → Identity → Applications → Enterprise applications → Consent and permissions → User consent settings$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Read the tenant's actual assigned consent policy before deciding this needs action -- the raw finding only confirms the concept exists, not which policy is in force.$stp$, 'code', $cod$Connect-MgGraph -Scopes 'Policy.Read.All'
(Get-MgPolicyAuthorizationPolicy).DefaultUserRolePermissions.PermissionGrantPoliciesAssigned$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$If the tenant is on the unrestricted legacy policy (microsoft-user-default-legacy) or has no policy assigned, restrict it to verified-publisher apps requesting only low-impact permissions -- preserving any existing owned-resource consent policy already assigned so developers can still manage their own apps' consent.$stp$, 'code', $cod$Connect-MgGraph -Scopes 'Policy.ReadWrite.Authorization'
$body = @{
  permissionGrantPolicyIdsAssignedToDefaultUserRole = @(
    "managePermissionGrantsForSelf.microsoft-user-default-low",
    "managePermissionGrantsForOwnedResource.<ExistingOwnedResourcePolicyIfAny>"
  )
}
Update-MgPolicyAuthorizationPolicy -BodyParameter $body$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Enable the admin consent workflow so a user who can no longer self-consent has a real path to request access instead of being stuck, with reviewers notified by email. Portal-only: Entra ID → Enterprise apps → Consent and permissions → Admin consent settings → set "Users can request admin consent to apps they are unable to consent to" to Yes, and designate reviewers.$stp$)
  ),
  $eo$The tenant's assigned permission grant policy is a deliberate, reviewed choice (restricted-to-verified-publishers, fully disabled, or a documented decision to keep the legacy policy) rather than an unexamined default, and a working admin consent request path exists for whatever users can no longer self-consent to.$eo$,
  $vs$Re-read the authorization policy and confirm the assigned permission grant policy id reflects the intended choice; confirm at least one reviewer is configured for the admin consent workflow if user consent was restricted or disabled.$vs$,
  $vc$(Get-MgPolicyAuthorizationPolicy).DefaultUserRolePermissions.PermissionGrantPoliciesAssigned$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/configure-user-consent$url$,
    $url$https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/configure-admin-consent-workflow$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02; Microsoft Graph PowerShell SDK (Microsoft.Graph.Identity.SignIns)$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2047) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$Real check mapping is `{"transform":"exists","sourceField":"defaultUserRolePermissions","targetField":"userConsentAllowed"}` against /policies/authorizationPolicy -- this only confirms the property exists (which it always does on this resource), not which policy id is assigned or how permissive it is. severity_rules is empty (informational). Read the tenant's real permissionGrantPoliciesAssigned (step 1 above) before treating a raw finding here as high severity.$note$
),

(
  'appgov:risky-permission-grants',
  $ttl$Review tenant-wide (AllPrincipals) OAuth consent grants$ttl$,
  $sum$An OAuth2 permission grant with consentType AllPrincipals is a tenant-wide, admin-granted authorization: the application can act as ANY user in the tenant for that grant's scope, not just the person who originally consented. This is expected and legitimate for genuine tenant infrastructure (Microsoft first-party services, an approved SSO/reporting integration), which is why this check only fires past a real magnitude threshold (5 = warning, 15 = critical) rather than on any single grant existing. Past that threshold, though, each additional AllPrincipals grant is another application that can silently read or act on every user's data in its granted scope with no per-user boundary -- exactly the blast radius that turns "one compromised app" into "every mailbox in the tenant."$sum$,
  jsonb_build_array(
    $prq$Cloud Application Administrator or Application Administrator to review and revoke$prq$,
    $prq$Microsoft Graph PowerShell SDK (Microsoft.Graph.Applications), scopes Application.ReadWrite.All, DelegatedPermissionGrant.ReadWrite.All$prq$
  ),
  $apath$Microsoft Entra admin center → Identity → Applications → Enterprise applications → (select app) → Permissions → Admin consent tab$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$List every AllPrincipals grant and the scope each one covers, to see exactly what each application can currently do tenant-wide.$stp$, 'code', $cod$Connect-MgGraph -Scopes 'Application.Read.All'
Get-MgOauth2PermissionGrant -All | Where-Object { $_.ConsentType -eq 'AllPrincipals' } |
  Select-Object ClientId, ResourceId, Scope$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$For each grant, confirm with the application's owner/business reason whether tenant-wide access is genuinely required, or whether a narrower per-user/group consent would do. Revoke any grant that isn't justified.$stp$, 'code', $cod$Connect-MgGraph -Scopes 'DelegatedPermissionGrant.ReadWrite.All'
Remove-MgOauth2PermissionGrant -OAuth2PermissionGrantId "<PermissionGrantId>"$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Revoking a grant does not stop the app from requesting consent again -- if the app uses dynamic consent, also review whether it should be blocked from re-requesting the same scope, or restrict user consent tenant-wide (see appgov:consent-policy-status) so it can't be silently re-granted by an end user.$stp$)
  ),
  $eo$Every remaining AllPrincipals grant has a documented, confirmed business justification for tenant-wide access; the flagged count no longer includes unjustified grants.$eo$,
  $vs$Re-count AllPrincipals grants and confirm the count is at or below the tenant's accepted baseline, with every remaining grant justified.$vs$,
  $vc$Get-MgOauth2PermissionGrant -All | Where-Object { $_.ConsentType -eq 'AllPrincipals' } | Measure-Object$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/manage-application-permissions$url$,
    $url$https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/configure-user-consent$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02; Microsoft Graph PowerShell SDK (Microsoft.Graph.Applications)$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2047) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$The 5/15 magnitude thresholds are a first-cut judgment call documented in this check's own migration header, not a Microsoft-published baseline -- ordinary Microsoft first-party tenant setup creates real, expected AllPrincipals grants, so don't treat every grant as a finding. See appgov:unreviewed-consents for the self-consented (Principal) side of the same underlying resource.$note$
),

(
  'appgov:unreviewed-consents',
  $ttl$Review self-consented (Principal) OAuth grants$ttl$,
  $sum$An OAuth2 permission grant with consentType Principal means a single end user consented to an application on their own behalf, and per the oAuth2PermissionGrant resource's own definition, no administrator was ever in that approval loop. Unlike the AllPrincipals side of this same resource (see appgov:risky-permission-grants), every one of these grants firing is itself the finding -- there's no legitimate-infrastructure baseline to net out, because each row represents one individual decision an end user made alone, for permissions scoped to their own account, that the organization has never reviewed. At volume, this is the direct fingerprint of either wide-open user consent (see appgov:consent-policy-status) or a successful illicit-consent phishing campaign that hasn't been caught yet.$sum$,
  jsonb_build_array(
    $prq$Cloud Application Administrator or Application Administrator to review and revoke$prq$,
    $prq$Microsoft Graph PowerShell SDK (Microsoft.Graph.Applications), scopes Application.Read.All, DelegatedPermissionGrant.ReadWrite.All$prq$
  ),
  $apath$Microsoft Entra admin center → Identity → Applications → Enterprise applications → (select app) → Permissions → User consent tab$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$List every Principal (self-consented) grant, which user consented, and what scope they granted.$stp$, 'code', $cod$Connect-MgGraph -Scopes 'Application.Read.All'
Get-MgOauth2PermissionGrant -All | Where-Object { $_.ConsentType -eq 'Principal' } |
  Select-Object ClientId, PrincipalId, ResourceId, Scope$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$For each grant, confirm the application is legitimate and the scope is reasonable for its stated purpose. The Microsoft Entra admin center's User consent tab cannot revoke directly -- use Graph or PowerShell.$stp$, 'code', $cod$Connect-MgGraph -Scopes 'DelegatedPermissionGrant.ReadWrite.All'
Remove-MgOauth2PermissionGrant -OAuth2PermissionGrantId "<PermissionGrantId>"$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Once the backlog is cleared, close the actual gap that let this accumulate: restrict user consent (appgov:consent-policy-status) so future grants require admin review instead of producing the same unreviewed backlog again.$stp$)
  ),
  $eo$Every self-consented grant has been reviewed; illegitimate or excessive ones are revoked, and the tenant's user-consent policy no longer allows this backlog to silently regrow.$eo$,
  $vs$Re-count Principal-consentType grants and confirm the remaining set has all been reviewed (zero is the ideal end state only once user consent is restricted going forward).$vs$,
  $vc$Get-MgOauth2PermissionGrant -All | Where-Object { $_.ConsentType -eq 'Principal' } | Measure-Object$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/manage-application-permissions$url$,
    $url$https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/configure-user-consent$url$,
    $url$https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/configure-admin-consent-workflow$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02; Microsoft Graph PowerShell SDK (Microsoft.Graph.Applications)$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2047) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$See appgov:risky-permission-grants for the AllPrincipals (admin-consented, tenant-wide) side of the same /oauth2PermissionGrants resource -- the two checks report two different real subsets, not the same rows twice.$note$
),

-- ─────────────────────────────────────────────────────────────────────────────
-- CLUSTER: Enterprise app inventory
-- ─────────────────────────────────────────────────────────────────────────────

(
  'appgov:enterprise-app-count',
  $ttl$Establish a governance baseline for the enterprise app inventory$ttl$,
  $sum$A raw count of every service principal (enterprise application object) in the tenant -- first-party Microsoft apps, gallery SaaS integrations, and custom registrations alike, with no severity threshold of its own. It's the honest denominator every other appgov finding should be read against: a tenant with hundreds of enterprise apps and no record of who approved each one has a materially larger, less-governed attack surface than a small, well-tracked inventory, even before any single app shows a specific problem. Tracked over time, a count that climbs steadily with no corresponding approval record is the leading indicator that self-service user consent (appgov:consent-policy-status) is growing the app footprint faster than anyone is reviewing it.$sum$,
  jsonb_build_array(
    $prq$Security Reader or Global Reader to view the enterprise applications list$prq$,
    $prq$Application Administrator to act on anything found once reviewed$prq$
  ),
  $apath$Microsoft Entra admin center → Identity → Applications → Enterprise applications → All applications$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Establish a baseline count and a recurring review cadence, rather than treating this as a one-time number.$stp$, 'code', $cod$Connect-MgGraph -Scopes 'Application.Read.All'
(Get-MgServicePrincipal -All).Count$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Cross-reference the count against the itemized enterprise-app inventory in the Microsoft Entra admin center, and against appgov:dormant-service-principals / appgov:stale-app-registrations for which entries are real cleanup candidates, rather than acting on the raw number alone.$stp$),
    jsonb_build_object('text', $stp$If the count is high and climbing with no change-tracking, tighten user consent (appgov:consent-policy-status) so future growth requires admin review before it's added to the inventory.$stp$)
  ),
  $eo$A documented, periodically-reviewed enterprise app count with an owner assigned to explain any significant period-over-period increase.$eo$,
  $vs$Re-count and compare against the last recorded baseline; investigate any jump that doesn't correspond to a known, approved onboarding.$vs$,
  $vc$(Get-MgServicePrincipal -All).Count$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/what-is-application-management$url$,
    $url$https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/configure-user-consent$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02; Microsoft Graph PowerShell SDK (Microsoft.Graph.Applications)$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2047) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'admin_center_only',
  $note$This check has no severity_rules of its own (informational metric, raw count of every servicePrincipal) -- there is no single "fix" for a count, only the review/governance actions listed. There is no fix command to run; the value is entirely in review cadence and cross-referencing the other appgov checks.$note$
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

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-02-remediation-kb-appgov-domain-2047.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
