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
 * THREE OUTCOMES, NOT TWO (Git #1901). A rule can end in one of three states,
 * and collapsing any of them into another produces a false reading:
 *
 *   1. REQUESTED — `permissions` are asked for. The step runs once consented.
 *   2. DOCUMENTED BUT NOT REQUESTED (`grantRecommended: false`) — Microsoft's
 *      permission is real, but this platform judges the scope too broad to ask
 *      every customer for. Shane can overrule it; the product is the trade.
 *   3. APP-ONLY UNSUPPORTED (`appOnlyUnsupported: true`) — Microsoft documents
 *      NO application permission at all. Nobody can overrule this one, and no
 *      consent screen changes it. See the field's own doc comment.
 *
 * And a step with no rule at all is a FOURTH thing — unknown, not "none" — which
 * is why `requiredPermissionsForWrite` returns `rule: null` rather than guessing.
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
  /**
   * Application permissions required, ALL of them, for this operation.
   *
   * Empty ONLY when `appOnlyUnsupported` is true — see that field. An empty
   * array on any other rule would mean "this write needs nothing", which is
   * never true of a real write.
   */
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
  /**
   * True when Microsoft's Application row for this operation reads
   * "Not supported." — i.e. there is NO application permission that authorises
   * it, at any privilege level. The operation is delegated-only, so an app-only
   * daemon credential like this platform's write app can never perform it, and
   * no amount of consent changes that.
   *
   * This is a THIRD state, distinct from the two the table already had, and it
   * exists because collapsing it into either one produces a lie (Git #1901):
   *
   *   - Leaving the endpoint UNMAPPED says "we don't know what this needs",
   *     when in fact we know exactly, and the answer is "nothing will work".
   *   - Giving it a rule with `permissions: []` and no marker would make
   *     `required` empty, `missing` empty, and the executable render READY —
   *     the precise false-green the whole table exists to prevent.
   *
   * A rule with this flag carries `permissions: []`, quotes the real
   * "Not supported." cells in `documentedApplicationTiers`, and names the
   * delegated permission Microsoft DOES document in its `justification` so a
   * reader can see the operation is real and only the auth mode is wrong.
   * `requiredPermissionsForWrite` reports it back as `appOnlyUnsupported` so the
   * route can surface it as its own honest category.
   */
  appOnlyUnsupported?: boolean;
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
    // #1901 — identity-hygiene-v1 step 5.
    method: "POST",
    pattern: "/users/*/authentication/temporaryAccessPassMethods",
    documentedApplicationTiers: {
      leastPrivileged: "UserAuthMethod-TAP.Read.All",
      higherPrivileged: "UserAuthenticationMethod.ReadWrite.All, UserAuthenticationMethod.Read.All, UserAuthMethod-TAP.ReadWrite.All",
    },
    permissions: ["UserAuthenticationMethod.ReadWrite.All"],
    justification:
      "identity-hygiene-v1 step 5 (action.generate-temporary-access-pass) issues a Temporary Access Pass " +
      "so a user who has lost their MFA method can sign in once and re-register. NOTE Microsoft's " +
      "least-privileged Application cell for this POST is UserAuthMethod-TAP.Read.All — a READ permission " +
      "named as least-privileged for an operation that creates a credential. That is Microsoft's own " +
      "wording, quoted verbatim above, not a transcription slip. This platform does NOT request it: the " +
      "higher-privileged cell is a comma-separated list of ALTERNATIVES, and the first of them, " +
      "UserAuthenticationMethod.ReadWrite.All, is already required by mfa-enforcement-v1 step 1's " +
      "enumerate-and-delete flow (#1899). Reusing it adds no new permission to the request, and it avoids " +
      "putting a name ending in .Read.All on a write, which would trip the #1975 guard for a reason that " +
      "does not apply here — Microsoft lists these as alternatives (`,`), not a conjunction (`and`).",
    docUrl: "https://learn.microsoft.com/en-us/graph/api/authentication-post-temporaryaccesspassmethods",
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

  {
    // #1901 — baseline-licensing-v1 steps 1 and 2. Must stay ABOVE any generic
    // /groups/* rule; it is more specific than the PATCH /groups/* rule below.
    method: "POST",
    pattern: "/groups/*/assignLicense",
    documentedApplicationTiers: {
      leastPrivileged: "LicenseAssignment.ReadWrite.All",
      higherPrivileged: "Directory.ReadWrite.All, Group.ReadWrite.All",
    },
    permissions: ["LicenseAssignment.ReadWrite.All"],
    justification:
      "baseline-licensing-v1 step 1 (action.group-based-license-assign) puts a licence on a group so every " +
      "member inherits it, and step 2 (action.group-based-license-remove) takes it off. Unlike the " +
      "per-user POST /users/*/assignLicense rule above — which reuses User.ReadWrite.All because that is " +
      "already held for the user create/update steps — the group form's only higher-privileged " +
      "alternatives are Directory.ReadWrite.All and Group.ReadWrite.All, both tenant-wide write scopes " +
      "this platform deliberately never requests. LicenseAssignment.ReadWrite.All is therefore both " +
      "Microsoft's least-privileged option and the only acceptable one: it permits licence assignment " +
      "and nothing else.",
    docUrl: "https://learn.microsoft.com/en-us/graph/api/group-assignlicense",
  },
  {
    // #1901 — governance-groups-v1. Not in the 13 endpoints #1901's body listed:
    // that list was captured 2026-08-30 and governance-groups-v1 has been wired
    // since. Found by re-running the same derivation over the live table.
    method: "POST",
    pattern: "/groups/*/owners/$ref",
    documentedApplicationTiers: {
      leastPrivileged: "Group.ReadWrite.All",
      higherPrivileged: "Directory.ReadWrite.All",
    },
    permissions: ["Group.ReadWrite.All"],
    justification:
      "governance-groups-v1 (action.add-group-owner) assigns an owner to an ownerless group. Microsoft " +
      "documents exactly two application permissions for this operation and BOTH are tenant-wide write " +
      "scopes: Group.ReadWrite.All at the least-privileged tier and Directory.ReadWrite.All above it. " +
      "There is no narrow owners-only permission — GroupMember.ReadWrite.All covers members, not owners, " +
      "and Group.Create covers creation only.",
    docUrl: "https://learn.microsoft.com/en-us/graph/api/group-post-owners",
    grantRecommended: false,
    notRequestedReason:
      "Group.ReadWrite.All is the least privileged permission Microsoft offers for adding a group owner, " +
      "but it is tenant-wide: the same grant lets the app rename, re-scope or DELETE any group in the " +
      "customer's directory, including role-assignable ones. This platform's whole group posture is built " +
      "on avoiding that — quickstart-v1 uses Group.Create (create only) and GroupMember.ReadWrite.All " +
      "(membership only) precisely so it never holds a general group write. Taking Group.ReadWrite.All to " +
      "ship one owner-assignment step would undo that for every customer. Shane's call: request it and " +
      "gain governance-groups-v1's owner steps, or drop them from the pack.",
  },
  {
    // #1901 — governance-groups-v1, two templates on the same endpoint.
    method: "PATCH",
    pattern: "/groups/*",
    documentedApplicationTiers: {
      leastPrivileged: "Group-NestingSupport.ReadWrite.All",
      higherPrivileged: "Directory.ReadWrite.All, Group-PreferredDataLocation.ReadWrite.All, Group.ManageProtection.All, Group.ReadWrite.All",
    },
    permissions: ["Group.ReadWrite.All"],
    justification:
      "governance-groups-v1 (action.set-group-visibility-private and action.set-team-visibility-private) " +
      "both PATCH /groups/{id} with body {\"visibility\": \"Private\"}, confirmed against the live " +
      "baseline_action_templates rows. Microsoft's least-privileged Application cell here is " +
      "Group-NestingSupport.ReadWrite.All, but it CANNOT be used for these steps: the same page's " +
      "\"Permissions for specific scenarios\" section restricts it to the disableNesting property " +
      "specifically — \"Group-NestingSupport.ReadWrite.All is the least privileged permission to update " +
      "the disableNesting property\". Updating **visibility** falls back to the higher-privileged cell, " +
      "whose only app-usable entries are Directory.ReadWrite.All and Group.ReadWrite.All " +
      "(Group.ManageProtection.All is delegated-only — \"App-only scenarios aren't supported\" — and " +
      "Group-PreferredDataLocation.ReadWrite.All covers preferredDataLocation only).",
    docUrl: "https://learn.microsoft.com/en-us/graph/api/group-update",
    grantRecommended: false,
    notRequestedReason:
      "Same tenant-wide group-write objection as the owners rule above, and for the same two steps' worth " +
      "of product. Group.ReadWrite.All would let the app rewrite or delete any group in the directory. " +
      "Not requested; governance-groups-v1's visibility steps will report as refused until Shane decides " +
      "the pack is worth that scope.",
  },
  {
    // #1901 — governance-groups-v1.
    method: "POST",
    pattern: "/groupLifecyclePolicies",
    documentedApplicationTiers: {
      leastPrivileged: "Directory.ReadWrite.All",
      higherPrivileged: "Not available.",
    },
    permissions: ["Directory.ReadWrite.All"],
    justification:
      "governance-groups-v1 (action.configure-group-expiration-policy) creates the tenant's group " +
      "expiration policy so stale groups are aged out. Microsoft documents ONE application permission for " +
      "this operation — Directory.ReadWrite.All — and lists no alternative at any tier " +
      "(\"Higher privileged permissions: Not available.\"). There is no narrower lifecycle-specific " +
      "permission to fall back to.",
    docUrl: "https://learn.microsoft.com/en-us/graph/api/grouplifecyclepolicy-post-grouplifecyclepolicies",
    grantRecommended: false,
    notRequestedReason:
      "Directory.ReadWrite.All is the broadest write permission in Microsoft Graph — it confers write " +
      "access to essentially the entire directory: users, groups, devices, service principals, " +
      "administrative units. This platform has never requested it, and every existing rule that could " +
      "have taken it (group create, member add, app-consent revoke) deliberately took a narrower " +
      "alternative instead. Microsoft offers no alternative here, so the honest outcome is that this ONE " +
      "step is unshippable rather than that the platform asks every customer for full directory write. " +
      "Shane's call, and the decision is about one step in one pack, not the pack as a whole.",
  },
  {
    // #1901 — identity-hygiene-v1 step 4.
    method: "POST",
    pattern: "/directory/deletedItems/*/restore",
    documentedApplicationTiers: {
      leastPrivileged: "User.DeleteRestore.All (the 'user' resource row)",
      higherPrivileged: "Not listed — this page uses a per-resource-type table (\"The following table shows the least privileged permission or permissions required to call this API on each supported resource type\") with a single Application column and no higher-privileged column.",
    },
    permissions: ["User.DeleteRestore.All"],
    justification:
      "identity-hygiene-v1 step 4 (action.restore-deleted-user) restores a user deleted in error, within " +
      "Microsoft's 30-day soft-delete window. This page permissions PER RESOURCE TYPE rather than per " +
      "tier; the row that applies is [user], whose Application permission is User.DeleteRestore.All — a " +
      "narrow, restore-specific scope, NOT User.ReadWrite.All. NOTE a real limit a permission grant alone " +
      "does not clear, quoted from the same page: \"In app-only scenarios and in addition to being " +
      "granted the User.ReadWrite.All application permission, the app must be assigned a higher " +
      "privileged administrator role\" in order to restore users who themselves hold privileged " +
      "administrator roles. Ordinary users restore fine with this permission; a deleted Global Admin will " +
      "not, and that is a directory-role assignment, not a consent — the same class of gap already " +
      "documented on PASSWORD_PROFILE_JUSTIFICATION below. The sibling template " +
      "action.restore-deleted-group hits this same endpoint but is not wired into any Config Pack, and " +
      "the [group] row needs Group.ReadWrite.All, which this platform does not request — see #1901's " +
      "catalogue-wide finding.",
    docUrl: "https://learn.microsoft.com/en-us/graph/api/directory-deleteditems-restore",
  },

  // ── Privileged Identity Management (PIM) writes ────────────────────────────
  {
    // #1901 — privileged-access-v1 steps 0 and 4 (assign + remove eligibility;
    // adminAssign/adminRemove are both actions on this one POST endpoint).
    method: "POST",
    pattern: "/roleManagement/directory/roleEligibilityScheduleRequests",
    documentedApplicationTiers: {
      leastPrivileged: "RoleEligibilitySchedule.ReadWrite.Directory",
      higherPrivileged: "RoleManagement.ReadWrite.Directory",
    },
    permissions: ["RoleManagement.ReadWrite.Directory"],
    justification:
      "privileged-access-v1 step 0 (action.pim-assign-role-eligibility) makes a principal ELIGIBLE for a " +
      "directory role, and step 4 (action.pim-remove-role-eligibility) revokes that eligibility — both " +
      "are actions on this single POST. Microsoft's least-privileged application permission is " +
      "RoleEligibilitySchedule.ReadWrite.Directory, but RoleManagement.ReadWrite.Directory is the listed " +
      "higher-privileged alternative and is ALREADY required by the POST " +
      "/roleManagement/directory/roleAssignments rule above (quickstart-v1 step 2 and the ps-execution " +
      "Global Reader provisioning). Requesting the narrower one as well would enlarge the consent screen " +
      "without reducing real privilege — the same reasoning the POST /users/*/assignLicense rule records.",
    docUrl: "https://learn.microsoft.com/en-us/graph/api/rbacapplication-post-roleeligibilityschedulerequests",
  },
  {
    // #1901 — privileged-access-v1 step 1.
    method: "POST",
    pattern: "/roleManagement/directory/roleAssignmentScheduleRequests",
    documentedApplicationTiers: {
      leastPrivileged: "RoleAssignmentSchedule.ReadWrite.Directory",
      higherPrivileged: "RoleManagement.ReadWrite.Directory, RoleAssignmentSchedule.Remove.Directory, RoleEligibilitySchedule.Remove.Directory",
    },
    permissions: ["RoleManagement.ReadWrite.Directory"],
    justification:
      "privileged-access-v1 step 1 (action.pim-activate-role) activates an eligible role assignment into " +
      "an active one. Same choice, and same reason, as the eligibility rule above: " +
      "RoleAssignmentSchedule.ReadWrite.Directory is Microsoft's least-privileged cell, but the " +
      "higher-privileged cell is a comma-separated list of ALTERNATIVES whose first entry, " +
      "RoleManagement.ReadWrite.Directory, this platform already holds for quickstart-v1 step 2. Reusing " +
      "it adds nothing to the request. NOTE a real runtime constraint from the same page that consent " +
      "does not satisfy: self-service activation requires the caller to have been MFA-challenged in the " +
      "session, which an app-only daemon credential has no way to do — so this step is usable for " +
      "adminAssign-style activation on behalf of a principal, not for selfActivate.",
    docUrl: "https://learn.microsoft.com/en-us/graph/api/rbacapplication-post-roleassignmentschedulerequests",
  },
  {
    // #1901 — privileged-access-v1 step 2. THE ONLY appOnlyUnsupported rule in
    // this table; read the field's doc comment before touching it.
    method: "PATCH",
    pattern: "/roleManagement/directory/roleAssignmentApprovals/*/steps/*",
    documentedApplicationTiers: {
      leastPrivileged: "Not supported.",
      higherPrivileged: "Not supported.",
    },
    permissions: [],
    appOnlyUnsupported: true,
    justification:
      "privileged-access-v1 step 2 (action.pim-approve-elevation) approves or denies a pending PIM " +
      "elevation request. NO APPLICATION PERMISSION EXISTS FOR THIS OPERATION. Microsoft's page carries " +
      "three separate permission tables — entitlement management, PIM for Microsoft Entra roles, and PIM " +
      "for Groups — and the Application row reads \"Not supported.\" in ALL THREE. The table that applies " +
      "to this endpoint is \"For PIM for Microsoft Entra roles\", whose only documented permission is the " +
      "DELEGATED RoleAssignmentSchedule.ReadWrite.Directory. The operation is real and the endpoint is " +
      "correct; it simply cannot be called by an app-only daemon credential, which is the only kind this " +
      "platform's write app has. That is a design decision on Microsoft's side and an entirely reasonable " +
      "one — approving your own elevation request is exactly the thing a human-in-the-loop control is for. " +
      "The endpoint is also beta-only: the page has no graph-rest-1.0 moniker.",
    docUrl: "https://learn.microsoft.com/en-us/graph/api/approvalstep-update?view=graph-rest-beta",
    grantRecommended: false,
    notRequestedReason:
      "Nothing to request — Microsoft documents no application permission for this operation at any " +
      "privilege tier. This is not a scope this platform declined to ask for; it is one that does not " +
      "exist. action.pim-approve-elevation therefore cannot ship on the app-only Graph executor no matter " +
      "what a customer consents to, and privileged-access-v1 can never be fully green while it contains " +
      "this step. Filed as its own issue under #2489.",
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
    // #1901 — conditional-access-baseline-v1 step 1.
    method: "POST",
    pattern: "/identity/conditionalAccess/namedLocations",
    documentedApplicationTiers: {
      leastPrivileged: "Policy.Read.All and Policy.ReadWrite.ConditionalAccess",
      higherPrivileged: "Not available.",
    },
    permissions: ["Policy.Read.All", "Policy.ReadWrite.ConditionalAccess"],
    justification:
      "conditional-access-baseline-v1 step 1 (action.create-named-location) creates the trusted-IP or " +
      "country named location that the baseline Conditional Access policies scope against. Same " +
      "documented CONJUNCTION as the two Conditional Access rules above (Git #1975): the Application cell " +
      "reads \"Policy.Read.All and Policy.ReadWrite.ConditionalAccess\" — one tier requiring BOTH, joined " +
      "by \"and\", not two alternatives separated by a comma. Here it is unambiguous, because this page " +
      "lists \"Not available.\" as the higher-privileged cell: the conjunction IS the only tier, so there " +
      "is nothing narrower to reduce to and no broader tier that was picked by mistake. Both permissions " +
      "are already required by quickstart-v1 steps 5 and 6, so this rule adds nothing to the request.",
    docUrl: "https://learn.microsoft.com/en-us/graph/api/conditionalaccessroot-post-namedlocations",
  },
  {
    // #1901 — conditional-access-baseline-v1 step 3. #2855 fixed the stored
    // method from PUT (which Graph does not expose on this resource) to DELETE.
    method: "DELETE",
    pattern: "/identity/conditionalAccess/policies/*",
    documentedApplicationTiers: {
      leastPrivileged: "Policy.Read.All and Policy.ReadWrite.ConditionalAccess",
      higherPrivileged: "Not available.",
    },
    permissions: ["Policy.Read.All", "Policy.ReadWrite.ConditionalAccess"],
    justification:
      "conditional-access-baseline-v1 step 3 (action.delete-ca-policy) removes a Conditional Access " +
      "policy. The baseline_action_templates row previously stored `PUT /identity/conditionalAccess/" +
      "policies/{{policyId}}`, a method Graph does not expose on this resource at all; #2855 corrected it " +
      "to DELETE (conditionalaccesspolicy-delete), matching the template's name and its empty `{}` body. " +
      "The permission was identical under the old, wrong method too — DELETE and PATCH " +
      "(conditionalaccesspolicy-update) both require this same conjunction — so this rule did not change " +
      "when the stored method was fixed.",
    docUrl: "https://learn.microsoft.com/en-us/graph/api/conditionalaccesspolicy-delete",
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
  {
    // #1901 — device-compliance-v1 step 1.
    method: "POST",
    pattern: "/deviceManagement/deviceCompliancePolicies/*/assign",
    documentedApplicationTiers: {
      leastPrivileged: "DeviceManagementConfiguration.ReadWrite.All",
      higherPrivileged: "Not listed — this page still uses Microsoft's older single-column \"Permissions (from least to most privileged)\" table.",
    },
    permissions: ["DeviceManagementConfiguration.ReadWrite.All"],
    justification:
      "device-compliance-v1 step 1 (action.update-compliance-policy-assignment) targets an Intune device " +
      "compliance policy at a group. This is a normal Intune configuration scope — note it is NOT the " +
      "DeviceManagementManagedDevices.PrivilegedOperations.All that the syncDevice rule above is refused " +
      "over: this permission writes POLICY, it confers no per-device remote action and cannot wipe, " +
      "retire or lock anything. Microsoft's Intune pages still use the older single-column table, so " +
      "there is one Application cell rather than two tiers.",
    docUrl: "https://learn.microsoft.com/en-us/graph/api/intune-deviceconfig-devicecompliancepolicy-assign",
  },
  {
    // #1901 — device-compliance-v1 step 2. Same permission as the compliance
    // policy assign above; Intune scopes both under Configuration.
    method: "POST",
    pattern: "/deviceManagement/deviceConfigurations/*/assign",
    documentedApplicationTiers: {
      leastPrivileged: "DeviceManagementConfiguration.ReadWrite.All",
      higherPrivileged: "Not listed — this page still uses Microsoft's older single-column \"Permissions (from least to most privileged)\" table.",
    },
    permissions: ["DeviceManagementConfiguration.ReadWrite.All"],
    justification:
      "device-compliance-v1 step 2 (action.update-config-profile-assignment) targets an Intune device " +
      "configuration profile at a group. Microsoft scopes device configuration profiles and device " +
      "compliance policies under the same DeviceManagementConfiguration.ReadWrite.All permission, so this " +
      "rule adds no permission beyond the one step 1 already needs.",
    docUrl: "https://learn.microsoft.com/en-us/graph/api/intune-deviceconfig-deviceconfiguration-assign",
  },
  {
    // #1901 — device-compliance-v1 step 3. #2855 fixed the stored endpoint from
    // the abstract managedAppPolicies base type to the real concrete resource.
    method: "POST",
    pattern: "/deviceAppManagement/targetedManagedAppConfigurations/*/assign",
    documentedApplicationTiers: {
      leastPrivileged: "DeviceManagementApps.ReadWrite.All",
      higherPrivileged: "Not listed — this page still uses Microsoft's older single-column \"Permissions (from least to most privileged)\" table.",
    },
    permissions: ["DeviceManagementApps.ReadWrite.All"],
    justification:
      "device-compliance-v1 step 3 (action.assign-app-protection-policy) targets an Intune app protection " +
      "(MAM) policy at a group. The baseline_action_templates row previously stored " +
      "`POST /deviceAppManagement/managedAppPolicies/{{policyId}}/assign` — `managedAppPolicy` is " +
      "Microsoft's ABSTRACT BASE TYPE for MAM policies and carries no `assign` action, so that call could " +
      "never resolve. #2855 corrected the stored endpoint to the real v1.0 path, " +
      "`POST /deviceAppManagement/targetedManagedAppConfigurations/{id}/assign`. The permission was " +
      "identical under the old, wrong endpoint too — Microsoft scopes the whole deviceAppManagement MAM " +
      "surface under the single DeviceManagementApps.ReadWrite.All application permission — so this rule " +
      "did not change when the stored endpoint was fixed.",
    docUrl: "https://learn.microsoft.com/en-us/graph/api/intune-mam-targetedmanagedappconfiguration-assign",
  },
  {
    // #1901 — device-compliance-v1 step 4. Three path segments; the syncDevice
    // rule above is four, so the two cannot shadow each other.
    method: "PATCH",
    pattern: "/deviceManagement/managedDevices/*",
    documentedApplicationTiers: {
      leastPrivileged: "DeviceManagementManagedDevices.ReadWrite.All",
      higherPrivileged: "Not listed — this page still uses Microsoft's older single-column \"Permissions (from least to most privileged)\" table.",
    },
    permissions: ["DeviceManagementManagedDevices.ReadWrite.All"],
    justification:
      "device-compliance-v1 step 4 (action.update-device-category) sets a managed device's category. Read " +
      "this alongside the syncDevice rule above, because the two look similar and are not: that one is " +
      "refused because syncDevice's ONLY documented permission is " +
      "DeviceManagementManagedDevices.PrivilegedOperations.All, the Intune 'user-impacting remote " +
      "actions' scope that also confers remote WIPE, RETIRE and lock. This one is the ordinary " +
      "DeviceManagementManagedDevices.ReadWrite.All — it updates managedDevice PROPERTIES and grants no " +
      "remote action at all. It is genuinely requestable and is requested.",
    docUrl: "https://learn.microsoft.com/en-us/graph/api/intune-devices-manageddevice-update",
  },

  // ── Microsoft 365 Defender / security incident writes ──────────────────────
  {
    // #1901 — security-incident-response-v1 step 5.
    method: "PATCH",
    pattern: "/security/incidents/*",
    documentedApplicationTiers: {
      leastPrivileged: "SecurityIncident.ReadWrite.All",
      higherPrivileged: "Not available.",
    },
    permissions: ["SecurityIncident.ReadWrite.All"],
    justification:
      "security-incident-response-v1 step 5 (action.manage-incident) closes out the incident in Microsoft " +
      "365 Defender — setting status, classification, determination and the resolving comment — after the " +
      "pack's earlier containment steps have run. Microsoft lists no higher-privileged alternative, and " +
      "SecurityIncident.ReadWrite.All is scoped to incidents alone: it does not carry the broader " +
      "SecurityAlert or SecurityActions surfaces. Note this endpoint is unavailable in the China " +
      "(21Vianet) national cloud per the same page's availability table; the Global, GCC L4 and GCC High " +
      "L5 clouds this platform targets all support it.",
    docUrl: "https://learn.microsoft.com/en-us/graph/api/security-incident-update",
  },

  // ── Git #2858 — the catalogue OUTSIDE the Config Packs ─────────────────────
  //
  // Everything above exists because a Config Pack ships it. The rules below are
  // `baseline_action_templates` rows that no pack wires yet — 20 of 102 on the
  // live table (the issue body's "42 of 102" was captured before #2855's
  // PUT->DELETE sweep and #1901's later rules; the real derivation on 2026-09-04
  // returned 20). They are mapped here so that the moment one IS added to a pack,
  // whoever adds it inherits a researched answer instead of hitting the same wall
  // #1901 cleared, and so the catalogue's real cost is visible BEFORE a product
  // decision is made on it.
  //
  // THE RULE APPLIED TO EVERY ONE OF THEM, stated once so it is not re-litigated
  // per entry: an unwired step never enlarges the consent screen.
  //
  //   - If the operation's documented permission is one the platform ALREADY
  //     requests for a shipped step, the rule requests it too — that costs a
  //     customer nothing, and it makes the step genuinely runnable today.
  //   - If it would add a NEW permission, `grantRecommended: false`. The reason
  //     names the real scope AND states plainly that no pack ships the step, so
  //     the trade is not "give up the product" — it is "flip this the day a pack
  //     needs it". That flip is one line plus a test update.
  //
  // The measurable consequence, asserted by a test: mapping the whole remainder
  // added ZERO permissions to what every customer is asked to consent to.

  // -- Already-held permissions: requested, runnable today ---------------------
  {
    // #2858 — action.delete-user. #2855's sweep corrected the stored method from
    // PUT to DELETE; this rule matches the corrected row.
    method: "DELETE",
    pattern: "/users/*",
    documentedApplicationTiers: {
      leastPrivileged: "User.ReadWrite.All",
      higherPrivileged: "Not available.",
    },
    permissions: ["User.ReadWrite.All"],
    justification:
      "action.delete-user deletes a user object (Microsoft moves it to the 30-day soft-delete container, " +
      "which is what action.restore-deleted-user then restores from). Microsoft documents exactly one " +
      "application permission and no higher-privileged alternative, and it is User.ReadWrite.All — already " +
      "requested for the user create/update steps, so this rule adds nothing to the consent request. " +
      "NOTE a limit consent alone does not clear, quoted from the same page: \"In app-only scenarios, the " +
      "User.ReadWrite.All application permission isn't enough privilege to delete users with privileged " +
      "administrative roles. The app must be assigned a higher privileged administrator role\" — the same " +
      "directory-role-not-consent gap already documented on the restore rule above and on " +
      "PASSWORD_PROFILE_JUSTIFICATION below. Ordinary users delete fine; a Global Admin will not.",
    docUrl: "https://learn.microsoft.com/en-us/graph/api/user-delete",
  },
  {
    // #2858 — action.update-manager. PUT is genuinely correct here (a
    // single-valued navigation-property reference), NOT the #2855 PUT-where-
    // DELETE-was-meant class; #2855's own body says so explicitly.
    method: "PUT",
    pattern: "/users/*/manager/$ref",
    documentedApplicationTiers: {
      leastPrivileged: "User.ReadWrite.All",
      higherPrivileged: "AgentIdUser.ReadWrite.All, AgentIdUser.ReadWrite.IdentityParentedBy, Directory.ReadWrite.All",
    },
    permissions: ["User.ReadWrite.All"],
    justification:
      "action.update-manager assigns a user's manager — the org-chart write an onboarding or a " +
      "reorganisation needs. Microsoft's least-privileged application permission is User.ReadWrite.All, " +
      "already held; every higher-privileged alternative is broader (Directory.ReadWrite.All) or scoped to " +
      "agent identities, so there is nothing narrower to take.",
    docUrl: "https://learn.microsoft.com/en-us/graph/api/user-post-manager",
  },
  {
    // #2858 — action.remove-auth-method's FIRST call. Five path segments, so it
    // cannot shadow the four-segment GET /users/*/authentication/methods rule
    // above (#1899's enumerate-all), and vice versa.
    method: "GET",
    pattern: "/users/*/authentication/methods/*",
    documentedApplicationTiers: {
      leastPrivileged: "UserAuthenticationMethod.Read.All",
      higherPrivileged: "UserAuthenticationMethod.ReadWrite.All",
    },
    permissions: ["UserAuthenticationMethod.ReadWrite.All"],
    justification:
      "action.remove-auth-method removes ONE already-identified authentication method, and runs as " +
      "runRemoveAuthMethodAgainstTenant() in workflow-executor.ts (#2875, the same class of gap #1899 " +
      "fixed for MFA re-registration): Graph has no DELETE on the generic " +
      "/users/{id}/authentication/methods/{id} path, so the real mechanism is GET that path to read the " +
      "method's polymorphic @odata.type, then DELETE through its typed collection. This rule documents the " +
      "GET; the three typed DELETE rules above (phoneMethods, microsoftAuthenticatorMethods, " +
      "softwareOathMethods) already document the second call, which is why the stored template method is a " +
      "GET rather than the PUT #2855 found. Microsoft's least-privileged Application permission for the " +
      "GET is UserAuthenticationMethod.Read.All, but UserAuthenticationMethod.ReadWrite.All is the listed " +
      "higher-privileged alternative and is already required by the DELETEs this GET exists to drive — " +
      "requesting the read-only one as well would enlarge the request without reducing real privilege. " +
      "The quoted tiers are the page's \"Permissions acting on other users\" table, which is the one that " +
      "applies to an app-only daemon; its \"acting on self\" table has an identical Application row. Note " +
      "this endpoint is unavailable in the China (21Vianet) national cloud per the same page.",
    docUrl: "https://learn.microsoft.com/en-us/graph/api/authenticationmethod-get",
  },
  {
    // #2858 — action.unenroll-device. #2855's sweep corrected the stored method
    // from PUT to DELETE. Three path segments; the four-segment remote-action
    // rules below cannot shadow it, and it is method-distinct from the PATCH
    // /deviceManagement/managedDevices/* rule above.
    method: "DELETE",
    pattern: "/deviceManagement/managedDevices/*",
    documentedApplicationTiers: {
      leastPrivileged: "DeviceManagementManagedDevices.ReadWrite.All",
      higherPrivileged: "Not listed — this page still uses Microsoft's older single-column \"Permissions (from least to most privileged)\" table.",
    },
    permissions: ["DeviceManagementManagedDevices.ReadWrite.All"],
    justification:
      "action.unenroll-device deletes the managedDevice RECORD, removing the device from Intune " +
      "management. Read this against the four refused remote-action rules below, because the difference is " +
      "the whole point: deleting the Intune record is an ordinary management-data write and Microsoft " +
      "scopes it under DeviceManagementManagedDevices.ReadWrite.All — the permission device-compliance-v1 " +
      "step 4 already holds. It sends nothing to the device and cannot wipe, retire, lock or reboot " +
      "anything. It is genuinely requestable and is requested.",
    docUrl: "https://learn.microsoft.com/en-us/graph/api/intune-devices-manageddevice-delete",
  },
  {
    // #2858 — action.disable-risky-app.
    method: "PATCH",
    pattern: "/servicePrincipals/*",
    documentedApplicationTiers: {
      leastPrivileged: "Application.ReadWrite.OwnedBy",
      higherPrivileged: "Application.ReadWrite.All, Directory.ReadWrite.All",
    },
    permissions: ["Application.ReadWrite.All"],
    justification:
      "action.disable-risky-app sets accountEnabled=false on a service principal, killing sign-in to an " +
      "enterprise application found to be risky (confirmed against the live template body). Microsoft's " +
      "least-privileged Application cell is Application.ReadWrite.OwnedBy, and it CANNOT be used for this " +
      "step by definition: OwnedBy authorises only applications the calling app itself owns, and a risky " +
      "third-party app in a customer's tenant is precisely one this platform does not own. The " +
      "higher-privileged cell lists two ALTERNATIVES (`,`, not `and`): Application.ReadWrite.All and " +
      "Directory.ReadWrite.All. The narrower of the two, Application.ReadWrite.All, is already required by " +
      "groups.add_service_principal_member (see TEMPLATE_EXTRA_PERMISSIONS), so this rule adds nothing to " +
      "the request; Directory.ReadWrite.All is never taken.",
    docUrl: "https://learn.microsoft.com/en-us/graph/api/serviceprincipal-update",
  },
  {
    // #2858 — action.rotate-app-secret.
    method: "POST",
    pattern: "/applications/*/addPassword",
    documentedApplicationTiers: {
      leastPrivileged: "Application.ReadWrite.OwnedBy",
      higherPrivileged: "Application.ReadWrite.All, Directory.ReadWrite.All",
    },
    permissions: ["Application.ReadWrite.All"],
    justification:
      "action.rotate-app-secret adds a new client secret to an app registration — the write half of a " +
      "credential rotation. Same tier reasoning as the servicePrincipal PATCH above: " +
      "Application.ReadWrite.OwnedBy covers only apps this platform owns, so rotating a customer's own app " +
      "registration falls to the higher-privileged alternative Application.ReadWrite.All, which is already " +
      "held. READ THIS BEFORE WIRING THIS STEP INTO ANYTHING: the permission being available is not the " +
      "same as the action being allowed. Git #1913 draws the production boundary at the app registration, " +
      "not the tenant — an agent may read the state of PROD app registration " +
      "3308b280-e41e-42ba-9f73-73aac2ad3dee but never writes a credential against it, and " +
      "app-registration credentials are named there as out of agent reach. This rule records what Graph " +
      "requires; it does not authorise the write.",
    docUrl: "https://learn.microsoft.com/en-us/graph/api/application-addpassword",
  },
  {
    // #2858 — action.grant-admin-consent. Single segment, so the DELETE
    // /oauth2PermissionGrants/* rule above (two segments) cannot shadow it.
    method: "POST",
    pattern: "/oauth2PermissionGrants",
    documentedApplicationTiers: {
      leastPrivileged: "DelegatedPermissionGrant.ReadWrite.All",
      higherPrivileged: "Directory.ReadWrite.All",
    },
    permissions: ["DelegatedPermissionGrant.ReadWrite.All"],
    justification:
      "action.grant-admin-consent creates a delegated permission grant with consentType AllPrincipals — " +
      "admin consent on behalf of every user in the tenant (confirmed against the live template body). " +
      "Microsoft documents the same least-privileged permission as the revoke half, " +
      "DelegatedPermissionGrant.ReadWrite.All, with Directory.ReadWrite.All as the broader alternative " +
      "this platform never takes. WORTH KNOWING AND NOT COMFORTABLE: the platform therefore ALREADY holds " +
      "the permission to grant consent, because Microsoft ships create and delete on this resource under " +
      "one ReadWrite scope and micro-remediation remediate-remove-risky-app-consent needs the delete. " +
      "There is no narrower Graph permission that permits revoking a grant without also permitting " +
      "creating one, so this is Microsoft's design and not a scope this rule newly opened. #2858's own " +
      "issue body flags this endpoint as one to think about deliberately before a product ships it; that " +
      "remains true, and the thinking is about the PRODUCT step, not about the consent request.",
    docUrl: "https://learn.microsoft.com/en-us/graph/api/oauth2permissiongrant-post",
  },

  // -- Would need a NEW permission for a step nothing ships: documented, refused --
  {
    // #2858 — action.reassign-app-owner. The ONE rule here whose permissions
    // array mixes a held permission with a refused one; see the note on
    // DOCUMENTED_BUT_NOT_REQUESTED about why that distinction is computed rather
    // than assumed per-rule.
    method: "POST",
    pattern: "/applications/*/owners/$ref",
    documentedApplicationTiers: {
      leastPrivileged: "Application.ReadWrite.OwnedBy and Directory.Read.All",
      higherPrivileged: "Directory.Read.All and Application.ReadWrite.All, Directory.ReadWrite.All",
    },
    permissions: ["Directory.Read.All", "Application.ReadWrite.All"],
    justification:
      "action.reassign-app-owner adds a user as owner of an app registration. THIS IS A #1975 CONJUNCTION " +
      "CELL, READ IT CAREFULLY: both Application tiers join names with the word `and`, so each tier is a " +
      "single requirement of TWO permissions, not a menu. Microsoft is explicit on the same page: " +
      "\"Application.ReadWrite.OwnedBy isn't sufficient to add another owner. Consent also to " +
      "Application.ReadWrite.All.\" Reassigning the owner of an app this platform does not itself own " +
      "therefore lands on the higher tier and needs Directory.Read.All AND Application.ReadWrite.All " +
      "together. Application.ReadWrite.All is already held; Directory.Read.All is not, and would be a new " +
      "one. Directory.Read.All on a write is exactly the shape #1975 exists to protect — it is legitimate " +
      "here because Microsoft documents it as a conjunction, and it would be a bug to \"tidy\" it away.",
    docUrl: "https://learn.microsoft.com/en-us/graph/api/application-post-owners",
    grantRecommended: false,
    notRequestedReason:
      "Directory.Read.All is a directory-wide READ across users, groups, devices, service principals and " +
      "app registrations, and this platform deliberately keeps that surface on its separate READ " +
      "application rather than on the write app. Taking it onto the write app to ship one " +
      "owner-reassignment step that no Config Pack wires is the wrong order of operations. Nothing about " +
      "the step is impossible — flip this to requested the day a pack needs it, and the only new thing a " +
      "customer is asked for is a read permission.",
  },
  {
    // #2858 — action.add-custom-domain.
    method: "POST",
    pattern: "/domains",
    documentedApplicationTiers: {
      leastPrivileged: "Domain.ReadWrite.All",
      higherPrivileged: "Not available.",
    },
    permissions: ["Domain.ReadWrite.All"],
    justification:
      "action.add-custom-domain adds a domain to the customer's tenant. Microsoft documents one " +
      "application permission and no alternative at any tier. Note the domain is unusable until DNS " +
      "ownership is verified, which is a real brake on what the permission alone can accomplish.",
    docUrl: "https://learn.microsoft.com/en-us/graph/api/domain-post-domains",
    grantRecommended: false,
    notRequestedReason:
      "Domain.ReadWrite.All would be a new tenant-wide permission over the customer's domain list, and " +
      "domain manipulation is a recognised tenant-takeover path (a domain the attacker controls, added " +
      "and then federated, mints tokens). No Config Pack ships a domain-add step, so requesting it today " +
      "would enlarge every customer's consent screen for a capability nothing uses. Shane's call the day " +
      "a pack genuinely needs it.",
  },
  {
    // #2858 — action.delete-group. #2855's sweep corrected the stored method from
    // PUT to DELETE. Two path segments, so the members/owners rules above cannot
    // shadow it.
    method: "DELETE",
    pattern: "/groups/*",
    documentedApplicationTiers: {
      leastPrivileged: "Group.ReadWrite.All",
      higherPrivileged: "Not available.",
    },
    permissions: ["Group.ReadWrite.All"],
    justification:
      "action.delete-group deletes a group. Microsoft documents exactly one application permission and no " +
      "alternative. The same page adds a second gate for role-assignable groups, quoted verbatim: \"For " +
      "app-only scenarios, the calling app must be the owner of the group or be assigned the " +
      "RoleManagement.ReadWrite.Directory application permission or be assigned at least the Privileged " +
      "Role Administrator Microsoft Entra role\" — so even with Group.ReadWrite.All a role-assignable " +
      "group would not delete without that, and the platform does hold " +
      "RoleManagement.ReadWrite.Directory for quickstart-v1 step 2.",
    docUrl: "https://learn.microsoft.com/en-us/graph/api/group-delete",
    grantRecommended: false,
    notRequestedReason:
      "Group.ReadWrite.All is the same tenant-wide group-write scope already refused on the group-owner " +
      "and group-visibility rules above, and #2856 tracks the product consequence. It is refused harder " +
      "here, not less: this rule's operation is the destructive one that objection is actually about — " +
      "the grant would let the app DELETE any group in the customer's directory. quickstart-v1's whole " +
      "group posture (Group.Create for creation, GroupMember.ReadWrite.All for membership) exists to avoid " +
      "holding it, and no pack wires a group delete.",
  },
  {
    // #2858 — action.restart-device. Four path segments, matching the syncDevice
    // rule's shape; the three-segment PATCH/DELETE managedDevices rules are
    // unaffected.
    method: "POST",
    pattern: "/deviceManagement/managedDevices/*/rebootNow",
    documentedApplicationTiers: {
      leastPrivileged: "DeviceManagementManagedDevices.PrivilegedOperations.All",
      higherPrivileged: "Not listed — this page still uses Microsoft's older single-column \"Permissions (from least to most privileged)\" table.",
    },
    permissions: ["DeviceManagementManagedDevices.PrivilegedOperations.All"],
    justification:
      "action.restart-device reboots a managed device remotely. One of the four Intune user-impacting " +
      "remote actions in this catalogue, all of which Microsoft permissions identically to the syncDevice " +
      "rule above.",
    docUrl: "https://learn.microsoft.com/en-us/graph/api/intune-devices-manageddevice-rebootnow",
    grantRecommended: false,
    notRequestedReason:
      "DeviceManagementManagedDevices.PrivilegedOperations.All is the Intune 'user-impacting remote " +
      "actions' scope, already refused on remediate-device-compliance-gap's syncDevice for the reason " +
      "that applies with more force here: the single grant also confers remote WIPE, RETIRE and lock " +
      "across every managed device in the tenant. Refusing one $29 sync action over it and then taking it " +
      "for an unwired reboot step would make the earlier refusal meaningless.",
  },
  {
    // #2858 — action.remote-lock-device.
    method: "POST",
    pattern: "/deviceManagement/managedDevices/*/remoteLock",
    documentedApplicationTiers: {
      leastPrivileged: "DeviceManagementManagedDevices.PrivilegedOperations.All",
      higherPrivileged: "Not listed — this page still uses Microsoft's older single-column \"Permissions (from least to most privileged)\" table.",
    },
    permissions: ["DeviceManagementManagedDevices.PrivilegedOperations.All"],
    justification:
      "action.remote-lock-device locks a managed device remotely — the containment step an incident " +
      "responder wants on a lost or compromised endpoint. Same single documented permission as every " +
      "other Intune remote action.",
    docUrl: "https://learn.microsoft.com/en-us/graph/api/intune-devices-manageddevice-remotelock",
    grantRecommended: false,
    notRequestedReason:
      "Same permission and same objection as the reboot rule above: this grant is tenant-wide remote " +
      "wipe/retire/lock, and no Config Pack ships a remote-lock step.",
  },
  {
    // #2858 — action.retire-device.
    method: "POST",
    pattern: "/deviceManagement/managedDevices/*/retire",
    documentedApplicationTiers: {
      leastPrivileged: "DeviceManagementManagedDevices.PrivilegedOperations.All",
      higherPrivileged: "Not listed — this page still uses Microsoft's older single-column \"Permissions (from least to most privileged)\" table.",
    },
    permissions: ["DeviceManagementManagedDevices.PrivilegedOperations.All"],
    justification:
      "action.retire-device retires a managed device, removing company data and the management profile " +
      "while leaving personal data. Note the contrast with action.unenroll-device above, which is mapped " +
      "and requested: that one DELETEs the Intune record and needs only the ordinary " +
      "DeviceManagementManagedDevices.ReadWrite.All, while retire sends a real command to the device and " +
      "Microsoft scopes it under the privileged operations permission.",
    docUrl: "https://learn.microsoft.com/en-us/graph/api/intune-devices-manageddevice-retire",
    grantRecommended: false,
    notRequestedReason:
      "Same permission and same objection as the reboot and lock rules above. Retire is itself one of the " +
      "three destructive capabilities that grant confers, which is the clearest possible statement of why " +
      "the scope is refused.",
  },
  {
    // #2858 — action.fresh-start-device. NOTE the template id says "fresh start"
    // but the stored endpoint is windowsDefenderScan, which is an antivirus scan,
    // not Windows Autopilot Reset. The permission is the same either way (the real
    // beta wipe/fresh-start actions are all PrivilegedOperations.All too), so the
    // derivation is correct regardless of which the step is eventually meant to be.
    method: "POST",
    pattern: "/deviceManagement/managedDevices/*/windowsDefenderScan",
    documentedApplicationTiers: {
      leastPrivileged: "DeviceManagementManagedDevices.PrivilegedOperations.All",
      higherPrivileged: "Not listed — this page still uses Microsoft's older single-column \"Permissions (from least to most privileged)\" table.",
    },
    permissions: ["DeviceManagementManagedDevices.PrivilegedOperations.All"],
    justification:
      "action.fresh-start-device stores POST /deviceManagement/managedDevices/{id}/windowsDefenderScan, " +
      "which triggers a Microsoft Defender antivirus scan on a managed device. Microsoft permissions it " +
      "identically to the wipe/retire/lock/reboot family even though a scan is not itself destructive.",
    docUrl: "https://learn.microsoft.com/en-us/graph/api/intune-devices-manageddevice-windowsdefenderscan",
    grantRecommended: false,
    notRequestedReason:
      "Same permission and same objection as the other three Intune remote actions. This one is the " +
      "sharpest illustration of why the refusal is about the GRANT and not about the action: an antivirus " +
      "scan is harmless, and Microsoft still charges tenant-wide wipe/retire/lock for the privilege of " +
      "asking for it.",
  },
  {
    // #2858 — action.remote-wipe-device.
    method: "POST",
    pattern: "/deviceManagement/managedDevices/*/wipe",
    documentedApplicationTiers: {
      leastPrivileged: "DeviceManagementManagedDevices.PrivilegedOperations.All",
      higherPrivileged: "Not listed — this page still uses Microsoft's older single-column \"Permissions (from least to most privileged)\" table.",
    },
    permissions: ["DeviceManagementManagedDevices.PrivilegedOperations.All"],
    justification:
      "action.remote-wipe-device factory-resets a managed device. The most destructive operation in the " +
      "entire baseline_action_templates catalogue.",
    docUrl: "https://learn.microsoft.com/en-us/graph/api/intune-devices-manageddevice-wipe",
    grantRecommended: false,
    notRequestedReason:
      "Same permission and same objection as the other Intune remote actions, and here the objection is " +
      "literal rather than by implication: the grant IS tenant-wide remote wipe. If this step is ever " +
      "wired into a product, the consent conversation is not a line item — it is the whole conversation, " +
      "and it needs a confirmation gate in the product on top of the grant.",
  },
  {
    // #2858 — action.assign-autopilot-profile.
    method: "POST",
    pattern: "/deviceManagement/windowsAutopilotDeploymentProfiles/*/assign",
    documentedApplicationTiers: {
      leastPrivileged: "DeviceManagementServiceConfig.ReadWrite.All",
      higherPrivileged: "Not listed — this page still uses Microsoft's older single-column \"Permissions (from least to most privileged)\" table.",
    },
    permissions: ["DeviceManagementServiceConfig.ReadWrite.All"],
    justification:
      "action.assign-autopilot-profile targets a Windows Autopilot deployment profile. The " +
      "baseline_action_templates row previously stored a v1.0-relative endpoint against a resource " +
      "documented ONLY on the beta Graph moniker (its Methods table lists just Get and assign) plus a " +
      "groupAssignmentTarget body that belongs to the profile's `assignments` relationship, not to the " +
      "`assign` action itself (whose only documented parameter is `deviceIds`, a String collection). " +
      "#2939 corrected the stored endpoint to the absolute beta URL (graphWriteForTenant now accepts an " +
      "absolute https://graph.microsoft.com/{v1.0,beta}/... URL the same way graphFetchForTenant already " +
      "did per #1796) and the body to {\"deviceIds\": [...]}. The permission was identical under the old, " +
      "broken endpoint/body too — Microsoft scopes the whole Autopilot enrolment surface under this same " +
      "DeviceManagementServiceConfig.ReadWrite.All application permission — so this rule did not change " +
      "when the stored row was fixed.",
    docUrl: "https://learn.microsoft.com/en-us/graph/api/intune-enrollment-windowsautopilotdeploymentprofile-assign",
    grantRecommended: false,
    notRequestedReason:
      "DeviceManagementServiceConfig.ReadWrite.All would be a new permission covering Intune's whole " +
      "service-configuration surface (enrolment restrictions, Autopilot, Apple/Android enrolment " +
      "profiles). The transport/body defects that made the step non-runnable are now fixed (#2939), but " +
      "no Config Pack wires this template yet — nobody has evaluated whether to request this broad a " +
      "surface for a step nothing currently uses. Requesting it now would enlarge every customer's " +
      "consent ahead of an actual product decision to ship the step.",
  },
  {
    // #2858 — action.resolve-alert. Sibling of the PATCH /security/incidents/*
    // rule above; deliberately NOT collapsed into it, because SecurityAlert and
    // SecurityIncident are separate Microsoft permissions.
    method: "PATCH",
    pattern: "/security/alerts_v2/*",
    documentedApplicationTiers: {
      leastPrivileged: "SecurityAlert.ReadWrite.All",
      higherPrivileged: "Not available.",
    },
    permissions: ["SecurityAlert.ReadWrite.All"],
    justification:
      "action.resolve-alert sets a Microsoft 365 Defender alert's status to resolved (confirmed against " +
      "the live template body). Microsoft documents one application permission with no higher-privileged " +
      "alternative. SecurityIncident.ReadWrite.All — which security-incident-response-v1 step 5 already " +
      "holds — does NOT cover alerts: incidents and alerts are separately permissioned resources, so this " +
      "is a genuinely new permission rather than a reuse. Note this endpoint is unavailable in the China " +
      "(21Vianet) national cloud per the same page; Global, GCC L4 and GCC High L5 all support it.",
    docUrl: "https://learn.microsoft.com/en-us/graph/api/security-alert-update",
    grantRecommended: false,
    notRequestedReason:
      "SecurityAlert.ReadWrite.All is narrow and well-scoped — this refusal is about ORDER, not about the " +
      "scope being objectionable. No Config Pack wires an alert-resolution step today, and the standing " +
      "rule for this section is that an unwired step does not enlarge the consent screen. This is the " +
      "most likely of the refused permissions to be flipped: the moment a pack resolves alerts alongside " +
      "incidents, request it.",
  },
  {
    // #2858 — action.set-out-of-office.
    method: "PATCH",
    pattern: "/users/*/mailboxSettings",
    documentedApplicationTiers: {
      leastPrivileged: "MailboxSettings.ReadWrite",
      higherPrivileged: "Not available.",
    },
    permissions: ["MailboxSettings.ReadWrite"],
    justification:
      "action.set-out-of-office turns on a departing or absent user's automatic replies (the live template " +
      "body sets automaticRepliesSetting.status to AlwaysEnabled) — the mailbox half of an offboarding. " +
      "Microsoft documents one application permission and no alternative. Note the name has no `.All` " +
      "suffix but is still tenant-wide in app-only mode: as an application permission MailboxSettings." +
      "ReadWrite reaches every mailbox in the tenant unless the tenant scopes it down with an Exchange " +
      "application access policy, which is an Exchange-side control this platform does not set.",
    docUrl: "https://learn.microsoft.com/en-us/graph/api/user-update-mailboxsettings",
    grantRecommended: false,
    notRequestedReason:
      "MailboxSettings.ReadWrite would be the write app's first mailbox-data permission, reaching every " +
      "mailbox in the tenant, and no Config Pack ships an out-of-office step. Worth noting for whoever " +
      "picks this up: offboarding-v1's other mailbox work goes through Exchange Online rather than Graph " +
      "(the exchange-online:// endpoints isNonGraphEndpoint() excludes), so wiring this step is a " +
      "decision about which transport owns mailbox writes, not just a consent question.",
  },
  {
    // #2858 — action.update-org-contact-info. Two path segments; the four-segment
    // PATCH /organization/*/branding/localizations/* rule above is unaffected.
    method: "PATCH",
    pattern: "/organization/*",
    documentedApplicationTiers: {
      leastPrivileged: "Organization.ReadWrite.All",
      higherPrivileged: "Not available.",
    },
    permissions: ["Organization.ReadWrite.All"],
    justification:
      "action.update-org-contact-info sets the tenant's technicalNotificationMails (confirmed against the " +
      "live template body) — the address Microsoft sends service and security notifications to. Microsoft " +
      "documents one application permission with no alternative. It is NOT covered by " +
      "OrganizationalBranding.ReadWrite.All, which quickstart-v1 already holds: that permission is scoped " +
      "to the branding sub-resource only, which is why the branding localisation rule above sits at a " +
      "different path.",
    docUrl: "https://learn.microsoft.com/en-us/graph/api/organization-update",
    grantRecommended: false,
    notRequestedReason:
      "Organization.ReadWrite.All is tenant-object write — the same class as Directory.ReadWrite.All in " +
      "blast radius even though it is narrower in surface, and a test in this suite already asserts it is " +
      "never in the requested set. Redirecting where a tenant's security notifications land is exactly " +
      "the kind of change a customer's security review would want to see justified, and no Config Pack " +
      "ships the step.",
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
 * `graphWriteForTenant` accepts an absolute `https://graph.microsoft.com/{v1.0,beta}/...`
 * URL as well as a relative path (Git #2939 — some resources, e.g.
 * windowsAutopilotDeploymentProfile, are documented only on the beta moniker). Strip
 * that host+version prefix before pattern-matching, so a rule's relative `pattern`
 * matches a stored absolute-URL endpoint exactly the same way it matches a relative one.
 */
const GRAPH_ABSOLUTE_URL_PREFIX = /^https:\/\/graph\.microsoft\.com\/(v1\.0|beta)(?=\/|$)/i;

/**
 * Collapse `{{placeholders}}` and concrete ids to `*` so a template endpoint and
 * a resolved one both match the same rule. Query strings are dropped.
 */
export function normaliseEndpoint(endpoint: string): string {
  const path = endpoint.replace(GRAPH_ABSOLUTE_URL_PREFIX, "").split("?")[0];
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
  /**
   * True when a rule matched and that rule is `appOnlyUnsupported` — Microsoft
   * documents NO application permission for the operation, so no consent can
   * make it run on this platform's app-only credential (Git #1901).
   *
   * Callers MUST branch on this before treating an empty `required` as "needs
   * nothing". `required: []` with this flag set means "impossible", not "ready".
   */
  appOnlyUnsupported: boolean;
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
    return { required: [], notRequested: [], rule: null, nonGraph: true, appOnlyUnsupported: false };
  }

  const normalised = normaliseEndpoint(endpoint);
  const rule =
    GRAPH_WRITE_PERMISSION_RULES.find(
      (r) => r.method === method.toUpperCase() && patternMatches(r.pattern, normalised),
    ) ?? null;

  const required = new Set<string>(rule?.permissions ?? []);
  // A refused rule reports back only the permissions the platform genuinely does
  // NOT hold. Git #2858: `grantRecommended` is a property of the RULE, but a rule
  // can require two permissions of which one is already requested for a shipped
  // step — POST /applications/*/owners/$ref needs Directory.Read.All (refused) and
  // Application.ReadWrite.All (held, for the service-principal member add). Naming
  // the held one as "not requested" would tell a reader the platform lacks a
  // permission it demonstrably has, and would contradict DERIVED_WRITE_APP_PERMISSIONS.
  // The step is still blocked, because `required` is unchanged and the refused
  // permission is still missing from it.
  const notRequested = new Set<string>(
    rule && rule.grantRecommended === false
      ? rule.permissions.filter((p) => !DERIVED_WRITE_APP_PERMISSIONS.includes(p))
      : [],
  );

  const extra = opts.templateId ? TEMPLATE_EXTRA_PERMISSIONS[opts.templateId] : undefined;
  for (const p of extra?.permissions ?? []) required.add(p);

  if (opts.body && typeof opts.body === "object" && "passwordProfile" in (opts.body as object)) {
    required.add(PASSWORD_PROFILE_PERMISSION);
  }

  return {
    required: [...required],
    notRequested: [...notRequested],
    rule,
    nonGraph: false,
    appOnlyUnsupported: rule?.appOnlyUnsupported === true,
  };
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

/**
 * Permissions documented as required by a real step but deliberately not requested.
 *
 * `appOnlyUnsupported` rules contribute nothing here by construction — they carry
 * no permissions, because Microsoft documents none. They are not a permission this
 * platform declined to ask for; see APP_ONLY_UNSUPPORTED_OPERATIONS below.
 *
 * Git #2858 — a permission another rule genuinely requests is filtered out here
 * even if a refused rule also lists it. `grantRecommended` marks a RULE, and a
 * rule can need one permission the platform holds plus one it doesn't (see
 * POST /applications/*​/owners/$ref). This list means "permissions the platform
 * does not hold, and why", so a held permission must never appear in it — the
 * same filter `requiredPermissionsForWrite` applies to its `notRequested`.
 */
export const DOCUMENTED_BUT_NOT_REQUESTED: readonly { permission: string; reason: string }[] =
  GRAPH_WRITE_PERMISSION_RULES.filter((r) => r.grantRecommended === false).flatMap((r) =>
    r.permissions
      .filter((permission) => !DERIVED_WRITE_APP_PERMISSIONS.includes(permission))
      .map((permission) => ({
        permission,
        reason: r.notRequestedReason ?? "not requested",
      })),
  );

/**
 * Operations Microsoft documents as having NO application permission at all, so
 * they can never run on this platform's app-only write credential (Git #1901).
 *
 * Deliberately separate from DOCUMENTED_BUT_NOT_REQUESTED: that list is "we could
 * ask for this and chose not to", which a customer could overrule. This one is
 * "there is nothing to ask for", which nobody can overrule.
 */
export const APP_ONLY_UNSUPPORTED_OPERATIONS: readonly {
  method: string;
  pattern: string;
  reason: string;
  docUrl: string;
}[] = GRAPH_WRITE_PERMISSION_RULES.filter((r) => r.appOnlyUnsupported === true).map((r) => ({
  method: r.method,
  pattern: r.pattern,
  reason: r.notRequestedReason ?? "no application permission exists for this operation",
  docUrl: r.docUrl,
}));
