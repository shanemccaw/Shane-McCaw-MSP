/**
 * graph-write-permissions.ts — Git #1875
 *
 * WHAT THIS IS. The mapping from every real Microsoft Graph write this platform
 * issues to the Microsoft Graph **application permission** that write requires,
 * with a justification naming the concrete product step that needs it.
 *
 * WHY IT EXISTS. Before #1875, `REQUIRED_WRITE_APP_PERMISSIONS` (lib/graph.ts)
 * was a hand-typed TRANSCRIPTION of whatever the Entra app registration happened
 * to declare, with its own comment warning that it "can drift silently if the app
 * registration is edited." It had drifted, and it was also simply incomplete: it
 * named 4 permissions while the four executable Config Packs need 16. Deriving
 * the list from the writes the packs actually perform removes the transcription
 * step entirely — the constant is now a `UNION` over this table, so it cannot
 * disagree with the code that issues the writes.
 *
 * WHERE THE PERMISSION NAMES COME FROM. Each rule cites the Microsoft Learn API
 * reference page whose "Permissions" table names the **Application** permission
 * for that exact method + path, and carries that page's Application row quoted
 * verbatim in `documentedApplicationTiers`. They are quoted, not inferred. The
 * least-privileged cell is used unless a broader one is ALREADY held for another
 * step (noted per rule) — in that case adding the narrower duplicate would
 * enlarge the request without reducing real privilege.
 *
 * READ THIS BEFORE "FIXING" A RULE THAT LISTS TWO PERMISSIONS (Git #1975).
 * Microsoft's permission tables use two different separators inside ONE cell and
 * they do not mean the same thing:
 *
 *   - `A, B` — ALTERNATIVES. Any one of them authorises the call. Pick one.
 *   - `A and B` — a CONJUNCTION. The call needs BOTH, together, in that tier.
 *
 * So a cell reading "Policy.Read.All and Policy.ReadWrite.ConditionalAccess" is a
 * single tier requiring two permissions — NOT two tiers that a careless reader
 * concatenated. Three rules below legitimately carry a `*.Read.All` permission on
 * a write for exactly this reason, and #1975 confirmed against Microsoft's own
 * known-issues page that dropping it would break the call at runtime. A rule
 * whose `permissions` array does not match its own `documentedApplicationTiers`
 * cell is a bug; a rule that holds a documented two-permission conjunction is
 * not. `graph-write-permissions.test.ts` enforces this.
 *
 * THIS TABLE GRANTS NOTHING. It is the derivation and the justification. The
 * actual grant is two steps in Entra: the app registration must DECLARE the
 * permission (`requiredResourceAccess`), and a tenant admin must CONSENT to it
 * (`appRoleAssignments` on the app's service principal in that tenant). See
 * `scripts/azure/apply-write-app-permissions-1875.mjs`.
 */

/** A Microsoft Graph application permission (appRole `value`) this platform may need. */
export interface WritePermissionRule {
  /**
   * HTTP method the rule matches. GET is included solely for #1899's
   * action.require-security-info-reregistration row: its stored template method is
   * now GET (it enumerates methods before the real fan-out deletes), and needs a
   * rule to match here so the admin-write-permissions surface doesn't report it as
   * an unmapped step. Every other rule in this table is a genuine write.
   */
  method: "GET" | "POST" | "PATCH" | "DELETE" | "PUT";
  /**
   * Normalised path pattern. `*` matches exactly one path segment. Compared
   * against the template endpoint after `{{variable}}` placeholders and literal
   * ids are collapsed to `*` by `normaliseEndpoint`.
   */
  pattern: string;
  /** Application permissions required, ALL of them, for this operation. */
  permissions: string[];
  /**
   * The **Application** row of this operation's Microsoft Learn Permissions
   * table, quoted verbatim from `docUrl` — both cells, exactly as Microsoft
   * words them, including the `and`/`,` distinction that decides whether a cell
   * is a conjunction or a list of alternatives (see the header note above).
   *
   * This is the evidence a customer's security reviewer actually needs: it lets
   * them check `permissions` against Microsoft's own wording without leaving the
   * file, and it is what stops a future reader re-deriving the table from memory
   * and "fixing" a documented conjunction into a single permission. Every rule
   * carries it; a new rule cannot be added without reading the real page.
   *
   * Verified in full against Microsoft Learn on 2026-09-04 (Git #1975).
   */
  documentedApplicationTiers: {
    /** The "Least privileged permissions" cell, verbatim. */
    leastPrivileged: string;
    /** The "Higher privileged permissions" cell, verbatim. */
    higherPrivileged: string;
  };
  /** The concrete product step that needs it — this is the customer-facing justification. */
  justification: string;
  /** The Microsoft Learn page whose Permissions table this was read from. */
  docUrl: string;
  /**
   * False when the operation's documented permission is real but deliberately
   * NOT requested — see the entry's own note. Permissions marked false are
   * excluded from `REQUIRED_WRITE_APP_PERMISSIONS`, so the surfaces that check
   * consent will honestly report the affected product as refused.
   */
  grantRecommended?: boolean;
  /** Why it is not requested, when `grantRecommended` is false. */
  notRequestedReason?: string;
}

/**
 * Ordered — FIRST MATCH WINS, so more specific patterns must come before
 * more general ones (`/users/*​/assignLicense` before `/users/*`).
 */
export const GRAPH_WRITE_PERMISSION_RULES: readonly WritePermissionRule[] = [
  // ── User object writes ─────────────────────────────────────────────────────
  {
    method: "POST",
    pattern: "/users/*/assignLicense",
    documentedApplicationTiers: {
      leastPrivileged: "LicenseAssignment.ReadWrite.All",
      higherPrivileged: "AgentIdUser.ReadWrite.All, AgentIdUser.ReadWrite.IdentityParentedBy, Directory.ReadWrite.All, User.ReadWrite.All",
    },
    permissions: ["User.ReadWrite.All"],
    justification:
      "onboarding-v1 step 2 (action.assign-single-license) assigns a licence to the new starter, and " +
      "micro-remediation remediate-remove-waste-license removes one. Microsoft's least-privileged " +
      "application permission here is LicenseAssignment.ReadWrite.All, but User.ReadWrite.All is listed " +
      "as a supported higher-privileged alternative and is already required by the user create/update " +
      "steps below — requesting the narrower one as well would add a permission without removing any.",
    docUrl: "https://learn.microsoft.com/en-us/graph/api/user-assignlicense",
  },
  {
    method: "POST",
    pattern: "/users/*/revokeSignInSessions",
    documentedApplicationTiers: {
      leastPrivileged: "User.RevokeSessions.All",
      higherPrivileged: "Not available.",
    },
    permissions: ["User.RevokeSessions.All"],
    justification:
      "micro-remediation remediate-revoke-sessions (microrem.revoke-sign-in-sessions), and the same step " +
      "inside offboarding-v1, compromised-account-recovery-v1 and security-incident-response-v1, kills a " +
      "compromised or departing user's active sessions. Microsoft lists NO higher-privileged application " +
      "alternative for this operation — User.ReadWrite.All does not cover it, so this is the only way the " +
      "step can succeed.",
    docUrl: "https://learn.microsoft.com/en-us/graph/api/user-revokesigninsessions",
  },
  {
    method: "PATCH",
    pattern: "/users/*/authentication/requirements",
    documentedApplicationTiers: {
      leastPrivileged: "Policy.ReadWrite.AuthenticationMethod",
      higherPrivileged: "Not available.",
    },
    permissions: ["Policy.ReadWrite.AuthenticationMethod"],
    justification:
      "mfa-enforcement-v1 step 2 (action.enforce-per-user-mfa) sets perUserMfaState to enforced.",
    docUrl: "https://learn.microsoft.com/en-us/graph/api/authentication-update?view=graph-rest-beta",
  },
  {
    // #1899 — the old POST /users/*/authentication/methods row this rule described was
    // never a real, writable Graph v1.0 collection (confirmed against Microsoft Learn).
    // mfa-enforcement-v1 step 1 (action.require-security-info-reregistration) now runs as
    // runForceMfaReregistrationAgainstTenant() in workflow-executor.ts: GET this same path
    // to enumerate the user's current methods (read — same permission as the deletes below,
    // ReadWrite.All covers read), then DELETE each phone/Microsoft Authenticator/software
    // OATH method individually — the real mechanism the Entra admin center's own
    // "Require re-register MFA" button uses. This rule now documents the GET; the three
    // DELETE rules immediately below document the per-type deletes it drives.
    method: "DELETE",
    pattern: "/users/*/authentication/phoneMethods/*",
    documentedApplicationTiers: {
      leastPrivileged: "UserAuthenticationMethod.ReadWrite.All",
      higherPrivileged: "UserAuthMethod-Phone.ReadWrite.All",
    },
    permissions: ["UserAuthenticationMethod.ReadWrite.All"],
    justification:
      "mfa-enforcement-v1 step 1 (action.require-security-info-reregistration) deletes a user's " +
      "registered phone authentication method as part of forcing MFA re-registration.",
    docUrl: "https://learn.microsoft.com/en-us/graph/api/phoneauthenticationmethod-delete",
  },
  {
    method: "DELETE",
    pattern: "/users/*/authentication/microsoftAuthenticatorMethods/*",
    documentedApplicationTiers: {
      leastPrivileged: "UserAuthenticationMethod.ReadWrite.All",
      higherPrivileged: "UserAuthMethod-MicrosoftAuthApp.ReadWrite.All",
    },
    permissions: ["UserAuthenticationMethod.ReadWrite.All"],
    justification:
      "mfa-enforcement-v1 step 1 (action.require-security-info-reregistration) deletes a user's " +
      "registered Microsoft Authenticator method as part of forcing MFA re-registration.",
    docUrl: "https://learn.microsoft.com/en-us/graph/api/microsoftauthenticatorauthenticationmethod-delete",
  },
  {
    method: "DELETE",
    pattern: "/users/*/authentication/softwareOathMethods/*",
    documentedApplicationTiers: {
      leastPrivileged: "UserAuthenticationMethod.ReadWrite.All",
      higherPrivileged: "UserAuthMethod-SoftwareOATH.ReadWrite.All",
    },
    permissions: ["UserAuthenticationMethod.ReadWrite.All"],
    justification:
      "mfa-enforcement-v1 step 1 (action.require-security-info-reregistration) deletes a user's " +
      "registered software OATH token method as part of forcing MFA re-registration.",
    docUrl: "https://learn.microsoft.com/en-us/graph/api/softwareoathauthenticationmethod-delete",
  },
  {
    method: "GET",
    pattern: "/users/*/authentication/methods",
    documentedApplicationTiers: {
      leastPrivileged: "UserAuthenticationMethod.Read.All",
      higherPrivileged: "UserAuthenticationMethod.ReadWrite.All",
    },
    permissions: ["UserAuthenticationMethod.ReadWrite.All"],
    justification:
      "mfa-enforcement-v1 step 1 (action.require-security-info-reregistration) lists a user's current " +
      "authentication methods first, to know which typed per-method DELETE calls above to fire. " +
      "UserAuthenticationMethod.Read.All is Microsoft's least-privileged permission for this GET, but " +
      "UserAuthenticationMethod.ReadWrite.All is the listed higher-privileged alternative and is already " +
      "required by the three DELETEs above — requesting the read-only one as well would enlarge the " +
      "request without reducing real privilege.",
    // #1975 — the previous docUrl here (`.../api/authenticationmethod-list`) 404s. The real page for
    // `GET /users/{id}/authentication/methods` is `authentication-list-methods`.
    docUrl: "https://learn.microsoft.com/en-us/graph/api/authentication-list-methods",
  },
  {
    method: "POST",
    pattern: "/users",
    documentedApplicationTiers: {
      leastPrivileged: "User.Create",
      higherPrivileged: "User.ReadWrite.All, Directory.ReadWrite.All",
    },
    permissions: ["User.ReadWrite.All"],
    justification:
      "quickstart-v1 step 1 (quickstart-v1.create-break-glass-account) creates the emergency-access admin, " +
      "and onboarding-v1 step 1 (action.create-user) creates a new starter. Microsoft's least-privileged " +
      "application permission for POST /users is User.Create; User.ReadWrite.All is the listed " +
      "higher-privileged alternative and is required anyway by the user-update steps below. " +
      "NOTE (Git #1975): Microsoft has since introduced narrower permissions on both pages — User.Create " +
      "here and User.ReadUpdate.All on PATCH /users — so User.ReadWrite.All is no longer forced by the " +
      "update step the way this justification originally reasoned. Narrowing it is a real least-privilege " +
      "reduction but changes what the app must be granted, so it is tracked separately as #2845 rather " +
      "than changed here.",
    docUrl: "https://learn.microsoft.com/en-us/graph/api/user-post-users",
  },
  {
    method: "PATCH",
    pattern: "/users/*",
    documentedApplicationTiers: {
      leastPrivileged: "User.ReadUpdate.All",
      higherPrivileged: "User.ReadWrite.All, Directory.ReadWrite.All",
    },
    permissions: ["User.ReadWrite.All"],
    justification:
      "offboarding-v1 and security-incident-response-v1 disable a user's sign-in (action.disable-user-signin " +
      "sets accountEnabled=false via PATCH /users/{id}). Microsoft's least-privileged application " +
      "permission for this PATCH is now User.ReadUpdate.All, with User.ReadWrite.All listed as the " +
      "higher-privileged alternative; User.ReadWrite.All is retained here because it is what the app is " +
      "already granted — narrowing it is tracked as #2845 (Git #1975).",
    docUrl: "https://learn.microsoft.com/en-us/graph/api/user-update",
  },

  // ── Directory role + group writes ──────────────────────────────────────────
  {
    method: "POST",
    pattern: "/roleManagement/directory/roleAssignments",
    documentedApplicationTiers: {
      leastPrivileged: "RoleManagement.ReadWrite.Directory",
      higherPrivileged: "Not listed — this page still uses Microsoft's older single-column \"Permissions (from least to most privileged)\" table.",
    },
    permissions: ["RoleManagement.ReadWrite.Directory"],
    justification:
      "quickstart-v1 step 2 (quickstart-v1.assign-global-admin-role) grants the break-glass account the " +
      "Global Administrator role, and global-reader-role-provisioning.ts assigns the ps-execution app's " +
      "service principal (PS_EXECUTION_APP_CLIENT_ID — #2161) the tenant-wide Global Reader role. This " +
      "permission lives on the WRITE app deliberately so the READ app never carries a role-management " +
      "write scope.",
    docUrl: "https://learn.microsoft.com/en-us/graph/api/rbacapplication-post-roleassignments",
  },
  {
    method: "POST",
    pattern: "/groups",
    documentedApplicationTiers: {
      leastPrivileged: "Group.Create",
      higherPrivileged: "Directory.ReadWrite.All, Group-PreferredDataLocation.ReadWrite.All, Group.ReadWrite.All",
    },
    permissions: ["Group.Create"],
    justification:
      "quickstart-v1 step 3 (quickstart-v1.create-ca-exclusion-group) creates the Conditional Access " +
      "exclusion group the break-glass account is placed in, and dlp-role-group-provisioning.ts creates the " +
      "Entra security group assigned to the Purview role group. Group.Create is narrower than " +
      "Group.ReadWrite.All: it permits creation only, not reading, updating or deleting existing groups.",
    docUrl: "https://learn.microsoft.com/en-us/graph/api/group-post-groups",
  },
  {
    method: "POST",
    pattern: "/groups/*/members/$ref",
    documentedApplicationTiers: {
      leastPrivileged: "GroupMember.ReadWrite.All (the 'user' member row)",
      higherPrivileged: "GroupMember.ReadWrite.All and Application.ReadWrite.All (the 'servicePrincipal' member row)",
    },
    permissions: ["GroupMember.ReadWrite.All"],
    justification:
      "quickstart-v1 step 4 adds the break-glass account to the CA exclusion group; onboarding-v1 step 3 " +
      "adds the new starter to their group. Microsoft's permissions table for 'Add members' names " +
      "GroupMember.ReadWrite.All for a user member — Group.Create does NOT cover adding members, which is " +
      "why quickstart-v1 could not get past step 4 even once step 1 succeeded.",
    docUrl: "https://learn.microsoft.com/en-us/graph/api/group-post-members",
  },
  {
    method: "DELETE",
    pattern: "/groups/*/members/*/$ref",
    documentedApplicationTiers: {
      leastPrivileged: "GroupMember.ReadWrite.All",
      higherPrivileged: "Directory.ReadWrite.All, Group.ReadWrite.All",
    },
    permissions: ["GroupMember.ReadWrite.All"],
    justification:
      "micro-remediation remediate-remove-stale-group-member, and the same final step in offboarding-v1, " +
      "removes a departing user from a group.",
    docUrl: "https://learn.microsoft.com/en-us/graph/api/group-delete-members",
  },

  // ── Tenant policy writes ───────────────────────────────────────────────────
  {
    method: "PATCH",
    pattern: "/policies/identitySecurityDefaultsEnforcementPolicy",
    documentedApplicationTiers: {
      leastPrivileged: "Policy.Read.All",
      higherPrivileged: "Policy.Read.All and Policy.ReadWrite.ConditionalAccess",
    },
    permissions: ["Policy.Read.All", "Policy.ReadWrite.ConditionalAccess"],
    justification:
      "quickstart-v1 step 5 (quickstart-v1.disable-security-defaults) turns off Security Defaults so the " +
      "baseline Conditional Access policy created in step 6 can take effect — the two are mutually " +
      "exclusive in Entra. WHY A WRITE CARRIES Policy.Read.All (Git #1975): Microsoft's least-privileged " +
      "Application cell for this PATCH is Policy.Read.All alone, which cannot authorise a write; the only " +
      "usable tier is therefore the higher-privileged one, and that cell reads " +
      "\"Policy.Read.All and Policy.ReadWrite.ConditionalAccess\" — one tier requiring BOTH, not two tiers " +
      "concatenated. Policy.ReadWrite.ConditionalAccess is what authorises the write; Policy.Read.All is " +
      "required alongside it by Microsoft's own table. Security Defaults sits under the Conditional Access " +
      "write scope because Entra treats the two as one mutually-exclusive setting — the same reason step 5 " +
      "has to run before step 6 at all. Verified against the v1.0 AND beta pages on 2026-09-04: both carry " +
      "this identical table, and neither lists Policy.ReadWrite.SecurityDefaults, which does exist as a " +
      "narrower Graph permission — see #2846 for whether it can replace the pair here.",
    docUrl: "https://learn.microsoft.com/en-us/graph/api/identitysecuritydefaultsenforcementpolicy-update",
  },
  {
    method: "PATCH",
    pattern: "/policies/authorizationPolicy",
    documentedApplicationTiers: {
      leastPrivileged: "Policy.ReadWrite.Authorization",
      higherPrivileged: "Not available.",
    },
    permissions: ["Policy.ReadWrite.Authorization"],
    justification:
      "quickstart-v1 step 8 (quickstart-v1.restrict-guest-access) restricts who may invite external guests. " +
      "Microsoft lists no higher-privileged alternative for this operation.",
    docUrl: "https://learn.microsoft.com/en-us/graph/api/authorizationpolicy-update",
  },
  {
    method: "POST",
    pattern: "/identity/conditionalAccess/policies",
    documentedApplicationTiers: {
      leastPrivileged: "Policy.Read.All and Policy.ReadWrite.ConditionalAccess",
      higherPrivileged: "Application.Read.All and Policy.ReadWrite.ConditionalAccess",
    },
    permissions: ["Policy.Read.All", "Policy.ReadWrite.ConditionalAccess"],
    justification:
      "quickstart-v1 step 6 (quickstart-v1.create-ca-baseline-policy) creates the baseline Conditional " +
      "Access policy, excluding the break-glass group created in step 3. WHY A WRITE CARRIES " +
      "Policy.Read.All (Git #1975): this is Microsoft's LEAST-privileged Application tier for this POST, " +
      "not an over-broad choice — the cell reads \"Policy.Read.All and Policy.ReadWrite.ConditionalAccess\", " +
      "one tier requiring both. Microsoft documents the reason explicitly under Known issues > Identity and " +
      "access > \"Conditional access policy requires consent to additional permission\": \"The " +
      "conditionalAccessPolicy API currently requires consent to the Policy.Read.All permission to call the " +
      "POST and PATCH methods. In the future, the Policy.ReadWrite.ConditionalAccess permission will enable " +
      "you to read policies from the directory.\" Dropping Policy.Read.All would 403 this step at runtime. " +
      "The higher-privileged tier substitutes Application.Read.All for Policy.Read.All and is NOT requested. " +
      "See https://learn.microsoft.com/en-us/graph/known-issues",
    docUrl: "https://learn.microsoft.com/en-us/graph/api/conditionalaccessroot-post-policies",
  },
  {
    method: "PATCH",
    pattern: "/identity/conditionalAccess/policies/*",
    documentedApplicationTiers: {
      leastPrivileged: "Policy.Read.All and Policy.ReadWrite.ConditionalAccess",
      higherPrivileged: "Application.Read.All and Policy.ReadWrite.ConditionalAccess",
    },
    permissions: ["Policy.Read.All", "Policy.ReadWrite.ConditionalAccess"],
    justification:
      "micro-remediation remediate-enable-ca-policy (microrem.enforce-ca-policy) flips a reported-only or " +
      "disabled Conditional Access policy to enabled. WHY A WRITE CARRIES Policy.Read.All (Git #1975): " +
      "same least-privileged conjunction as the POST above — Microsoft's Application cell reads " +
      "\"Policy.Read.All and Policy.ReadWrite.ConditionalAccess\", and the same Known issues entry names " +
      "PATCH alongside POST as requiring consent to Policy.Read.All. This page additionally carries its own " +
      "inline note: \"This method has a known permissions issue and may require consent to multiple " +
      "permissions.\" Dropping Policy.Read.All would 403 this remediation at runtime.",
    docUrl: "https://learn.microsoft.com/en-us/graph/api/conditionalaccesspolicy-update",
  },
  {
    method: "PATCH",
    pattern: "/organization/*/branding/localizations/*",
    documentedApplicationTiers: {
      leastPrivileged: "OrganizationalBranding.ReadWrite.All",
      higherPrivileged: "Organization.ReadWrite.All",
    },
    permissions: ["OrganizationalBranding.ReadWrite.All"],
    justification:
      "quickstart-v1 step 7 (quickstart-v1.set-tenant-branding) sets the tenant sign-in page branding. " +
      "OrganizationalBranding.ReadWrite.All is Microsoft's least-privileged application permission here; " +
      "Organization.ReadWrite.All is the higher-privileged alternative and is deliberately NOT requested, " +
      "because it would also permit rewriting the organisation's own directory profile.",
    docUrl: "https://learn.microsoft.com/en-us/graph/api/organizationalbrandinglocalization-update",
  },

  // ── SharePoint / OneDrive writes ───────────────────────────────────────────
  {
    method: "PATCH",
    pattern: "/admin/sharepoint/settings",
    documentedApplicationTiers: {
      leastPrivileged: "SharePointTenantSettings.ReadWrite.All",
      higherPrivileged: "Not available.",
    },
    permissions: ["SharePointTenantSettings.ReadWrite.All"],
    justification:
      "sharepoint-oversharing-v1 steps 3-5 (action.enforce-tenant-sharing-policy, " +
      "action.block-external-resharing, action.require-invited-user-signin) change tenant-level SharePoint " +
      "and OneDrive sharing settings. Microsoft lists no higher-privileged alternative.",
    docUrl: "https://learn.microsoft.com/en-us/graph/api/sharepointsettings-update",
  },
  {
    method: "DELETE",
    pattern: "/sites/*/drive/items/*/permissions/*",
    documentedApplicationTiers: {
      leastPrivileged: "Files.ReadWrite.All",
      higherPrivileged: "Sites.ReadWrite.All",
    },
    permissions: ["Files.ReadWrite.All"],
    justification:
      "sharepoint-oversharing-v1 step 6 and micro-remediation remediate-remove-sharing-link " +
      "(microrem.remove-sharing-link) delete an oversharing link on a specific document. " +
      "Files.ReadWrite.All is Microsoft's least-privileged application permission for removing a " +
      "driveItem permission; Sites.ReadWrite.All is the broader alternative and is not requested.",
    docUrl: "https://learn.microsoft.com/en-us/graph/api/permission-delete",
  },

  // ── Application / consent writes ───────────────────────────────────────────
  {
    method: "DELETE",
    pattern: "/oauth2PermissionGrants/*",
    documentedApplicationTiers: {
      leastPrivileged: "DelegatedPermissionGrant.ReadWrite.All",
      higherPrivileged: "Directory.ReadWrite.All",
    },
    permissions: ["DelegatedPermissionGrant.ReadWrite.All"],
    justification:
      "micro-remediation remediate-remove-risky-app-consent (microrem.remove-risky-app-consent) revokes a " +
      "risky delegated permission grant. Directory.ReadWrite.All is the higher-privileged alternative and " +
      "is deliberately not requested — it would confer write access to the whole directory.",
    docUrl: "https://learn.microsoft.com/en-us/graph/api/oauth2permissiongrant-delete",
  },

  // ── Teams / Intune writes ──────────────────────────────────────────────────
  {
    method: "POST",
    pattern: "/teams/*/archive",
    documentedApplicationTiers: {
      leastPrivileged: "TeamSettings.ReadWrite.Group",
      higherPrivileged: "Directory.ReadWrite.All, Group.ReadWrite.All, TeamSettings.ReadWrite.All",
    },
    permissions: ["TeamSettings.ReadWrite.All"],
    justification:
      "micro-remediation remediate-deactivate-ownerless-team (microrem.deactivate-ownerless-team) archives " +
      "an ownerless Team. Microsoft's least-privileged application permission is " +
      "TeamSettings.ReadWrite.Group, but that is a resource-specific-consent permission granted per team " +
      "by a team owner — unusable for a platform acting tenant-wide. TeamSettings.ReadWrite.All is the " +
      "narrowest tenant-wide option; Group.ReadWrite.All and Directory.ReadWrite.All are the alternatives " +
      "and are far broader.",
    docUrl: "https://learn.microsoft.com/en-us/graph/api/team-archive",
  },
  {
    method: "POST",
    pattern: "/deviceManagement/managedDevices/*/syncDevice",
    documentedApplicationTiers: {
      leastPrivileged: "DeviceManagementManagedDevices.PrivilegedOperations.All",
      higherPrivileged: "Not listed — this page still uses Microsoft's older single-column \"Permissions (from least to most privileged)\" table.",
    },
    permissions: ["DeviceManagementManagedDevices.PrivilegedOperations.All"],
    justification:
      "micro-remediation remediate-device-compliance-gap (microrem.remediate-device-compliance) forces a " +
      "managed device to check in with Intune.",
    docUrl: "https://learn.microsoft.com/en-us/graph/api/intune-devices-manageddevice-syncdevice",
    grantRecommended: false,
    notRequestedReason:
      "This is the only permission Microsoft documents for syncDevice, but it is the Intune " +
      "'user-impacting remote actions' permission — the same grant also confers remote WIPE, RETIRE and " +
      "remote lock across every managed device in the tenant. Asking every customer for tenant-wide device " +
      "wipe in order to ship a $29 'sync this device' action is not a trade a customer's security review " +
      "should accept, so it is documented here and deliberately left out of the requested set. Shane's " +
      "call: request it and gain the product, or drop remediate-device-compliance-gap from the catalogue.",
  },
];

/**
 * Additional permissions a specific template needs that its method + endpoint
 * alone cannot reveal, because the requirement comes from the request BODY.
 */
export const TEMPLATE_EXTRA_PERMISSIONS: Readonly<Record<string, { permissions: string[]; justification: string }>> = {
  "groups.add_service_principal_member": {
    permissions: ["Application.ReadWrite.All"],
    justification:
      "dlp-role-group-provisioning.ts adds the ps-execution app's SERVICE PRINCIPAL (PS_EXECUTION_APP_CLIENT_ID, " +
      "not the READ app and not a user — #2166) to the security " +
      "group it just created. Microsoft's 'Add members' permissions table requires GroupMember.ReadWrite.All " +
      "AND Application.ReadWrite.All when the member being added is a servicePrincipal. This is the only " +
      "step in the platform that requires Application.ReadWrite.All.",
  },
};

/**
 * `passwordProfile` in a PATCH /users body is separately permissioned by
 * Microsoft, independent of the endpoint.
 */
export const PASSWORD_PROFILE_PERMISSION = "User-PasswordProfile.ReadWrite.All";

export const PASSWORD_PROFILE_JUSTIFICATION =
  "Any write whose body sets passwordProfile — micro-remediation remediate-force-password-reset " +
  "(microrem.force-password-reset), and the break-glass verification gate's own password rotation " +
  "(routes/break-glass-verification.ts) — needs User-PasswordProfile.ReadWrite.All, which Microsoft " +
  "documents as the least-privileged permission for updating that property specifically. NOTE Microsoft's " +
  "further constraint, which a permission grant alone does NOT satisfy: \"In app-only scenarios, the " +
  "calling app must be assigned a supported permission AND at least the User Administrator Microsoft Entra " +
  "role.\" See https://learn.microsoft.com/en-us/graph/api/user-update";

/** Endpoint schemes the sole executor (Microsoft Graph REST) cannot transport at all. */
export function isNonGraphEndpoint(endpoint: string): boolean {
  return (
    endpoint.startsWith("exchange-online://") ||
    endpoint.startsWith("/api/machines/") ||
    endpoint.startsWith("/api/indicators")
  );
}

/**
 * Collapse `{{placeholders}}` and concrete ids to `*` so a template endpoint and
 * a resolved one both match the same rule. Query strings are dropped.
 */
export function normaliseEndpoint(endpoint: string): string {
  const path = endpoint.split("?")[0];
  return path
    .split("/")
    .map((seg) => {
      if (seg === "" || seg === "$ref") return seg;
      if (/^\{\{.*\}\}$/.test(seg)) return "*";
      // A GUID, or a segment that is entirely digits — a concrete object id.
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)) return "*";
      if (/^\d+$/.test(seg)) return "*";
      return seg;
    })
    .join("/");
}

function patternMatches(pattern: string, normalised: string): boolean {
  const p = pattern.split("/");
  const n = normalised.split("/");
  if (p.length !== n.length) return false;
  return p.every((seg, i) => seg === "*" || seg === n[i]);
}

export interface WritePermissionLookup {
  /** All application permissions this write needs, deduped. */
  required: string[];
  /** Subset of `required` this platform deliberately does NOT request. */
  notRequested: string[];
  /** The rule that matched, if any. */
  rule: WritePermissionRule | null;
  /** True when the endpoint is not a Graph REST endpoint at all (EXO / Defender). */
  nonGraph: boolean;
}

/**
 * Resolve the application permissions one write needs.
 *
 * @param method    HTTP method the template declares.
 * @param endpoint  Template endpoint, with or without `{{placeholders}}`.
 * @param opts.templateId  Used for body-driven extras (see TEMPLATE_EXTRA_PERMISSIONS).
 * @param opts.body        The template body, used to detect `passwordProfile`.
 */
export function requiredPermissionsForWrite(
  method: string,
  endpoint: string,
  opts: { templateId?: string; body?: unknown } = {},
): WritePermissionLookup {
  if (isNonGraphEndpoint(endpoint)) {
    return { required: [], notRequested: [], rule: null, nonGraph: true };
  }

  const normalised = normaliseEndpoint(endpoint);
  const rule =
    GRAPH_WRITE_PERMISSION_RULES.find(
      (r) => r.method === method.toUpperCase() && patternMatches(r.pattern, normalised),
    ) ?? null;

  const required = new Set<string>(rule?.permissions ?? []);
  const notRequested = new Set<string>(
    rule && rule.grantRecommended === false ? rule.permissions : [],
  );

  const extra = opts.templateId ? TEMPLATE_EXTRA_PERMISSIONS[opts.templateId] : undefined;
  for (const p of extra?.permissions ?? []) required.add(p);

  if (opts.body && typeof opts.body === "object" && "passwordProfile" in (opts.body as object)) {
    required.add(PASSWORD_PROFILE_PERMISSION);
  }

  return { required: [...required], notRequested: [...notRequested], rule, nonGraph: false };
}

/**
 * The full set of Graph application permissions the write app must hold for
 * every wired write in the platform to succeed — the union over the rules
 * above, minus the ones deliberately not requested.
 *
 * This is what `REQUIRED_WRITE_APP_PERMISSIONS` (lib/graph.ts) re-exports and
 * what the assessment/consent flow shows a buyer before they approve.
 */
export const DERIVED_WRITE_APP_PERMISSIONS: readonly string[] = (() => {
  const set = new Set<string>();
  for (const rule of GRAPH_WRITE_PERMISSION_RULES) {
    if (rule.grantRecommended === false) continue;
    for (const p of rule.permissions) set.add(p);
  }
  for (const extra of Object.values(TEMPLATE_EXTRA_PERMISSIONS)) {
    for (const p of extra.permissions) set.add(p);
  }
  set.add(PASSWORD_PROFILE_PERMISSION);
  return [...set].sort();
})();

/** Permissions documented as required by a real step but deliberately not requested. */
export const DOCUMENTED_BUT_NOT_REQUESTED: readonly { permission: string; reason: string }[] =
  GRAPH_WRITE_PERMISSION_RULES.filter((r) => r.grantRecommended === false).flatMap((r) =>
    r.permissions.map((permission) => ({
      permission,
      reason: r.notRequestedReason ?? "not requested",
    })),
  );
