# Write app permissions — what we ask for, and exactly why

**Issue:** #1875 (parent #1096) · **Derived:** 2026-08-30 · **Source of truth:** `artifacts/api-server/src/lib/graph-write-permissions.ts`

This is the document a customer's security reviewer reads. Every permission below is
requested because a specific, named product step cannot execute without it. Every entry
cites the Microsoft Learn page whose own permissions table names it as the **least
privileged Application permission** for that exact operation. Nothing here is requested
for convenience, and two permissions that a real step genuinely needs are deliberately
**not** requested — those are listed too, with the reasoning.

The list is **derived, not transcribed.** `REQUIRED_WRITE_APP_PERMISSIONS` is a union over
the rule table in `graph-write-permissions.ts`, which maps each real
method + endpoint the platform issues to its required permission. There is no hand-typed
copy to drift out of date; `graph-write-permissions.test.ts` asserts the resulting set.

---

## 1. The two apps, and what "consent" actually means

The platform uses **two separate Entra app registrations** so that reading and writing are
never the same identity:

| Role | appId | Holds |
|---|---|---|
| **Read** | `4743b130-0379-41bf-b863-ec8de96d915a` (dev) | 32 `*.Read.All` Graph permissions. No write scope, ever. |
| **Write** | `3308b280-e41e-42ba-9f73-73aac2ad3dee` (prod) / `9f6f4772-b5be-421f-815e-b392336c373a` (dev) | Only the permissions in §2. |

A tenant granting write access is **two independent facts**, and conflating them is what
made this issue necessary:

1. The **registration declares** the permission (`requiredResourceAccess` in Entra).
2. A tenant admin **consents** to it, which creates `appRoleAssignments` on that app's
   service principal *in that tenant*.

`tenants.consent.writeBack = "granted"` in our own database records only that the admin
completed the consent redirect. It does **not** record which permissions the registration
declared at that moment. A tenant can be `granted` and still refuse every write — see §4.

---

## 2. The requested set (16)

| # | Permission | The step that needs it | Microsoft reference |
|---|---|---|---|
| 1 | `User.ReadWrite.All` | `quickstart-v1` step 1 creates the break-glass admin (`POST /users`); `onboarding-v1` step 1 creates a new starter; `offboarding-v1` and `security-incident-response-v1` disable sign-in (`PATCH /users/{id}`); licence assign/remove (`POST /users/{id}/assignLicense`). | [Create user](https://learn.microsoft.com/en-us/graph/api/user-post-users), [Update user](https://learn.microsoft.com/en-us/graph/api/user-update), [assignLicense](https://learn.microsoft.com/en-us/graph/api/user-assignlicense) |
| 2 | `User-PasswordProfile.ReadWrite.All` | `remediate-force-password-reset` sets `passwordProfile`; the break-glass verification gate rotates the generated password. Microsoft permissions `passwordProfile` separately from the rest of the user object. | [Update user](https://learn.microsoft.com/en-us/graph/api/user-update) |
| 3 | `User.RevokeSessions.All` | `remediate-revoke-sessions`, and the same step inside `offboarding-v1`, `compromised-account-recovery-v1` and `security-incident-response-v1`. Microsoft lists **no** higher-privileged application alternative — `User.ReadWrite.All` does not cover it. | [revokeSignInSessions](https://learn.microsoft.com/en-us/graph/api/user-revokesigninsessions) |
| 4 | `RoleManagement.ReadWrite.Directory` | `quickstart-v1` step 2 grants the break-glass account Global Administrator; `global-reader-role-provisioning.ts` assigns the **read** app Global Reader. Deliberately on the write app so the read app never carries a role-management scope. | [Create unifiedRoleAssignment](https://learn.microsoft.com/en-us/graph/api/rbacapplication-post-roleassignments) |
| 5 | `Group.Create` | `quickstart-v1` step 3 creates the Conditional Access exclusion group; `dlp-role-group-provisioning.ts` creates the Purview role group. Narrower than `Group.ReadWrite.All`: creation only, no read/update/delete of existing groups. | [Create group](https://learn.microsoft.com/en-us/graph/api/group-post-groups) |
| 6 | `GroupMember.ReadWrite.All` | `quickstart-v1` step 4 adds break-glass to the exclusion group; `onboarding-v1` step 3 adds the starter to their group; `remediate-remove-stale-group-member` removes a departing user. **`Group.Create` does not cover adding members** — this is why `quickstart-v1` could not get past step 4. | [Add members](https://learn.microsoft.com/en-us/graph/api/group-post-members), [Remove member](https://learn.microsoft.com/en-us/graph/api/group-delete-members) |
| 7 | `Application.ReadWrite.All` | `dlp-role-group-provisioning.ts` adds the read app's **service principal** to the group it created. Microsoft requires `GroupMember.ReadWrite.All` **and** `Application.ReadWrite.All` when the member is a servicePrincipal. This is the only step in the platform requiring it. | [Add members](https://learn.microsoft.com/en-us/graph/api/group-post-members) |
| 8 | `Policy.Read.All` | Required *together with* `Policy.ReadWrite.ConditionalAccess` by Microsoft's own permissions table for the Conditional Access and Security Defaults writes below. | [Update securityDefaults](https://learn.microsoft.com/en-us/graph/api/identitysecuritydefaultsenforcementpolicy-update) |
| 9 | `Policy.ReadWrite.ConditionalAccess` | `quickstart-v1` step 5 turns off Security Defaults and step 6 creates the baseline CA policy (the two are mutually exclusive in Entra); `remediate-enable-ca-policy` enables a report-only policy. | [Create CA policy](https://learn.microsoft.com/en-us/graph/api/conditionalaccessroot-post-policies), [Update CA policy](https://learn.microsoft.com/en-us/graph/api/conditionalaccesspolicy-update) |
| 10 | `Policy.ReadWrite.Authorization` | `quickstart-v1` step 8 restricts who may invite external guests. Microsoft lists no alternative. | [Update authorizationPolicy](https://learn.microsoft.com/en-us/graph/api/authorizationpolicy-update) |
| 11 | `Policy.ReadWrite.AuthenticationMethod` | `mfa-enforcement-v1` step 2 sets `perUserMfaState`. | [Update authentication requirements](https://learn.microsoft.com/en-us/graph/api/authentication-update?view=graph-rest-beta) |
| 12 | `OrganizationalBranding.ReadWrite.All` | `quickstart-v1` step 7 sets sign-in page branding. The higher-privileged `Organization.ReadWrite.All` is **not** requested — it would also permit rewriting the organisation's directory profile. | [Update branding localization](https://learn.microsoft.com/en-us/graph/api/organizationalbrandinglocalization-update) |
| 13 | `SharePointTenantSettings.ReadWrite.All` | `sharepoint-oversharing-v1` steps 3–5 change tenant sharing settings. No alternative exists. | [Update sharepointSettings](https://learn.microsoft.com/en-us/graph/api/sharepointsettings-update) |
| 14 | `Files.ReadWrite.All` | `sharepoint-oversharing-v1` step 6 and `remediate-remove-sharing-link` delete an oversharing link on a document. The broader `Sites.ReadWrite.All` is **not** requested. | [Delete permission](https://learn.microsoft.com/en-us/graph/api/permission-delete) |
| 15 | `DelegatedPermissionGrant.ReadWrite.All` | `remediate-remove-risky-app-consent` revokes a risky delegated grant. `Directory.ReadWrite.All` is the alternative and is **not** requested. | [Delete oAuth2PermissionGrant](https://learn.microsoft.com/en-us/graph/api/oauth2permissiongrant-delete) |
| 16 | `TeamSettings.ReadWrite.All` | `remediate-deactivate-ownerless-team` archives an ownerless Team. Microsoft's least-privileged option is `TeamSettings.ReadWrite.Group`, but that is resource-specific consent granted per-team by an owner — unusable tenant-wide. The alternatives (`Group.ReadWrite.All`, `Directory.ReadWrite.All`) are far broader. | [Archive team](https://learn.microsoft.com/en-us/graph/api/team-archive) |

### What is deliberately NOT in this list

No `Directory.ReadWrite.All`, no `Group.ReadWrite.All`, no `Organization.ReadWrite.All`,
no `Sites.ReadWrite.All`. Each of those would have satisfied several rows above with a
single broad grant. A test asserts their absence.

---

## 3. Documented but deliberately not requested (2)

These are permissions a real, sellable product step genuinely needs. We do not ask for
them, so those products are **knowingly unavailable** rather than silently broken — the
admin surface renders them as refused.

| Permission | Needed by | Why we don't ask |
|---|---|---|
| `DeviceManagementManagedDevices.PrivilegedOperations.All` | `remediate-device-compliance-gap` ($29) — `POST /deviceManagement/managedDevices/{id}/syncDevice` | It is the only permission Microsoft documents for `syncDevice`, but it is the Intune *user-impacting remote actions* permission: the same grant confers remote **wipe**, **retire** and remote lock across every managed device in the tenant. Asking every customer for tenant-wide device wipe to ship a $29 "sync this device" action is not a trade a security review should accept. **Shane's decision:** request it and gain the product, or drop the product. |
| `UserAuthenticationMethod.ReadWrite.All` | `mfa-enforcement-v1` step 1 (`action.require-security-info-reregistration`) | The template's endpoint, `POST /users/{id}/authentication/methods`, is not a real Graph v1.0 collection. Granting this today would grant for a call the platform cannot make. Request it together with the fix that corrects the endpoint. |

---

## 4. Why a consented tenant can still refuse every write

Real evidence, `wf_runs.id = 30301` (`quickstart-v1`, customer 1, 2026-08-26 15:27 UTC).
The run reached Microsoft Graph and its first write returned:

```json
403 { "error": { "code": "Authorization_RequestDenied",
                 "message": "Insufficient privileges to complete the operation." } }
```

Both existing write-back gates passed: the MSP's `write_back_enabled` was true and the
tenant's `writeBack` consent was `granted`. The write app had obtained a token. It simply
did not hold `User.ReadWrite.All` at that moment — the `appRoleAssignments` record shows
that permission was consented on the production write app at **2026-08-26T16:14:59Z**,
47 minutes *after* the run failed.

That is the whole failure mode: **consent state and permission state are different
things**, and only the second one decides whether a write succeeds. `GET
/api/admin/write-permissions?customerId=<n>` now reports all three gates separately, and
the "Packs & Remediations" surface will not offer a real-run button unless the third one
is affirmatively verified.

---

## 5. Applying and verifying

```bash
# Show exactly what would change; changes nothing.
node scripts/azure/apply-write-app-permissions-1875.mjs --consent

# Declare on both registrations AND admin-consent on the signed-in tenant.
node scripts/azure/apply-write-app-permissions-1875.mjs --apply --consent

# Confirm against the tenant's real Entra record.
node scripts/verify-write-app-consent-645.mjs
```

The apply script snapshots each registration's prior `requiredResourceAccess` to
`scripts/azure/app-registration-baselines/pre-1875-<appId>.json` before its first write,
so `--revert --apply` restores it. It only ever adds permissions from the derived set and
never removes an existing one.

**A permission grant with no successful write behind it has not fixed anything.** After
consenting, run `quickstart-v1` end to end and record the real result. Note that its first
step creates a real user (`breakglass-admin@<domain>`) in the target tenant and every step
is recorded `reversible = false`.

---

## 6. One thing a permission grant alone will not fix

Microsoft's "Update user" reference carries this constraint on `passwordProfile`:

> In app-only scenarios, the calling app must be assigned a supported permission **and** at
> least the *User Administrator* Microsoft Entra role.

So `remediate-force-password-reset` and the break-glass gate's password rotation need
`User-PasswordProfile.ReadWrite.All` **and** a directory role assignment on the write app's
service principal. Consent alone is not sufficient for those two steps. This is
unverified against a live tenant — the grant has not been applied yet — and is called out
so it is not mistaken for a regression later.
