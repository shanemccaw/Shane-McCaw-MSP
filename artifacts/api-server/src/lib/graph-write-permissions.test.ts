/**
 * graph-write-permissions.test.ts — Git #1875
 *
 * The endpoints asserted here are the REAL ones, read from the local database on
 * 2026-08-30 (`baseline_action_templates` joined through `config_pack_templates`
 * for the four packs that actually materialize a plan, plus every sellable
 * micro-remediation). If a template's endpoint is edited, one of these fails —
 * which is the point: the derived permission set must never silently stop
 * covering a write the platform still issues.
 */
import { describe, it, expect } from "vitest";
import {
  requiredPermissionsForWrite,
  normaliseEndpoint,
  isNonGraphEndpoint,
  DERIVED_WRITE_APP_PERMISSIONS,
  DOCUMENTED_BUT_NOT_REQUESTED,
  APP_ONLY_UNSUPPORTED_OPERATIONS,
  GRAPH_WRITE_PERMISSION_RULES,
} from "./graph-write-permissions";

describe("normaliseEndpoint", () => {
  it("collapses {{placeholders}} to a single-segment wildcard", () => {
    expect(normaliseEndpoint("/users/{{userId}}/assignLicense")).toBe("/users/*/assignLicense");
    expect(normaliseEndpoint("/groups/{{groupId}}/members/$ref")).toBe("/groups/*/members/$ref");
  });

  it("collapses concrete GUIDs and numeric ids the same way, so a resolved endpoint matches", () => {
    expect(normaliseEndpoint("/users/7cb2d7dd-e66f-4293-a1ee-54597934124f")).toBe("/users/*");
    expect(
      normaliseEndpoint("/organization/c4c814d4-3afe-441e-9145-62461d0a4fd3/branding/localizations/0"),
    ).toBe("/organization/*/branding/localizations/*");
  });

  it("drops the query string and leaves $ref alone", () => {
    expect(normaliseEndpoint("/groups/{{g}}/members/{{u}}/$ref?x=1")).toBe("/groups/*/members/*/$ref");
  });
});

describe("isNonGraphEndpoint", () => {
  it("flags the endpoints the sole Graph-REST executor cannot transport", () => {
    expect(isNonGraphEndpoint("exchange-online://Set-Mailbox")).toBe(true);
    expect(isNonGraphEndpoint("/api/machines/{{deviceId}}/isolate")).toBe(true);
    expect(isNonGraphEndpoint("/api/indicators")).toBe(true);
  });

  it("does not flag real Graph paths", () => {
    expect(isNonGraphEndpoint("/users")).toBe(false);
    expect(isNonGraphEndpoint("/admin/sharepoint/settings")).toBe(false);
  });
});

describe("quickstart-v1 — every step maps to the permission Microsoft documents", () => {
  // The eight real steps, in DB sort order.
  const steps: Array<[string, string, string[]]> = [
    ["POST", "/users", ["User.ReadWrite.All"]],
    ["POST", "/roleManagement/directory/roleAssignments", ["RoleManagement.ReadWrite.Directory"]],
    ["POST", "/groups", ["Group.Create"]],
    ["POST", "/groups/{{breakGlassGroupId}}/members/$ref", ["GroupMember.ReadWrite.All"]],
    ["PATCH", "/policies/identitySecurityDefaultsEnforcementPolicy", ["Policy.Read.All", "Policy.ReadWrite.ConditionalAccess"]],
    ["POST", "/identity/conditionalAccess/policies", ["Policy.Read.All", "Policy.ReadWrite.ConditionalAccess"]],
    ["PATCH", "/organization/{{tenantId}}/branding/localizations/0", ["OrganizationalBranding.ReadWrite.All"]],
    ["PATCH", "/policies/authorizationPolicy", ["Policy.ReadWrite.Authorization"]],
  ];

  for (const [method, endpoint, expected] of steps) {
    it(`${method} ${endpoint}`, () => {
      const got = requiredPermissionsForWrite(method, endpoint);
      expect(got.rule).not.toBeNull();
      expect(got.required.sort()).toEqual([...expected].sort());
    });
  }

  it("every quickstart-v1 permission is in the requested set — the pack can complete once consented", () => {
    for (const [method, endpoint] of steps) {
      for (const p of requiredPermissionsForWrite(method, endpoint).required) {
        expect(DERIVED_WRITE_APP_PERMISSIONS).toContain(p);
      }
    }
  });
});

describe("the other three executable packs", () => {
  it("onboarding-v1", () => {
    expect(requiredPermissionsForWrite("POST", "/users").required).toEqual(["User.ReadWrite.All"]);
    expect(requiredPermissionsForWrite("POST", "/users/{{userId}}/assignLicense").required).toEqual(["User.ReadWrite.All"]);
    expect(requiredPermissionsForWrite("POST", "/groups/{{groupId}}/members/$ref").required).toEqual(["GroupMember.ReadWrite.All"]);
  });

  it("mfa-enforcement-v1 step 2 needs the per-user MFA policy permission", () => {
    expect(requiredPermissionsForWrite("PATCH", "/users/{{userId}}/authentication/requirements").required)
      .toEqual(["Policy.ReadWrite.AuthenticationMethod"]);
  });

  it("sharepoint-oversharing-v1 — three tenant-setting PATCHes and one link DELETE", () => {
    expect(requiredPermissionsForWrite("PATCH", "/admin/sharepoint/settings").required)
      .toEqual(["SharePointTenantSettings.ReadWrite.All"]);
    expect(
      requiredPermissionsForWrite("DELETE", "/sites/{{siteId}}/drive/items/{{itemId}}/permissions/{{permissionId}}").required,
    ).toEqual(["Files.ReadWrite.All"]);
  });
});

describe("micro-remediations", () => {
  it("revoke-sign-in-sessions needs User.RevokeSessions.All — User.ReadWrite.All does NOT cover it", () => {
    const got = requiredPermissionsForWrite("POST", "/users/{{userId}}/revokeSignInSessions");
    expect(got.required).toEqual(["User.RevokeSessions.All"]);
    expect(got.required).not.toContain("User.ReadWrite.All");
  });

  it("force-password-reset picks up the passwordProfile permission from the BODY, not the endpoint", () => {
    const withoutPassword = requiredPermissionsForWrite("PATCH", "/users/{{userId}}", { body: { accountEnabled: false } });
    expect(withoutPassword.required).toEqual(["User.ReadWrite.All"]);

    const withPassword = requiredPermissionsForWrite("PATCH", "/users/{{userId}}", {
      templateId: "microrem.force-password-reset",
      body: { passwordProfile: { forceChangePasswordNextSignIn: true } },
    });
    expect(withPassword.required.sort()).toEqual(["User-PasswordProfile.ReadWrite.All", "User.ReadWrite.All"]);
  });

  it("remove-risky-app-consent uses the narrow grant permission, not Directory.ReadWrite.All", () => {
    const got = requiredPermissionsForWrite("DELETE", "/oauth2PermissionGrants/{{grantId}}");
    expect(got.required).toEqual(["DelegatedPermissionGrant.ReadWrite.All"]);
    expect(got.required).not.toContain("Directory.ReadWrite.All");
  });

  it("deactivate-ownerless-team uses TeamSettings.ReadWrite.All, not Group.ReadWrite.All", () => {
    const got = requiredPermissionsForWrite("POST", "/teams/{{teamId}}/archive");
    expect(got.required).toEqual(["TeamSettings.ReadWrite.All"]);
  });

  it("the EXO and Defender remediations resolve to no Graph permission at all", () => {
    for (const ep of ["exchange-online://Enable-Mailbox", "/api/machines/{{deviceId}}/isolate", "/api/indicators"]) {
      const got = requiredPermissionsForWrite("POST", ep);
      expect(got.nonGraph).toBe(true);
      expect(got.required).toEqual([]);
    }
  });
});

describe("adding a service principal to a group needs the body-driven extra", () => {
  it("Application.ReadWrite.All is required only for the servicePrincipal member-add", () => {
    const user = requiredPermissionsForWrite("POST", "/groups/{{breakGlassGroupId}}/members/$ref", {
      templateId: "quickstart-v1.add-break-glass-to-exclusion-group",
    });
    expect(user.required).toEqual(["GroupMember.ReadWrite.All"]);

    const sp = requiredPermissionsForWrite("POST", "/groups/{{groupId}}/members/$ref", {
      templateId: "groups.add_service_principal_member",
    });
    expect(sp.required.sort()).toEqual(["Application.ReadWrite.All", "GroupMember.ReadWrite.All"]);
  });
});

describe("the derived request set", () => {
  it("is exactly the 23 permissions #1875/#1899/#1901 derived from the packs' real steps", () => {
    expect([...DERIVED_WRITE_APP_PERMISSIONS]).toEqual([
      "Application.ReadWrite.All",
      "DelegatedPermissionGrant.ReadWrite.All",
      // #1901 — device-compliance-v1 step 3 (Intune MAM app protection policy assign).
      "DeviceManagementApps.ReadWrite.All",
      // #1901 — device-compliance-v1 steps 1 and 2 (compliance policy + config profile assign).
      "DeviceManagementConfiguration.ReadWrite.All",
      // #1901 — device-compliance-v1 step 4 (managedDevice PATCH). NOT the
      // PrivilegedOperations.All scope the syncDevice rule is refused over.
      "DeviceManagementManagedDevices.ReadWrite.All",
      "Files.ReadWrite.All",
      "Group.Create",
      "GroupMember.ReadWrite.All",
      // #1901 — baseline-licensing-v1 group-based licensing. The per-user
      // assignLicense rule reuses User.ReadWrite.All; the group form cannot,
      // because its only alternatives are Directory/Group.ReadWrite.All.
      "LicenseAssignment.ReadWrite.All",
      "OrganizationalBranding.ReadWrite.All",
      "Policy.Read.All",
      "Policy.ReadWrite.AuthenticationMethod",
      "Policy.ReadWrite.Authorization",
      "Policy.ReadWrite.ConditionalAccess",
      "RoleManagement.ReadWrite.Directory",
      // #1901 — security-incident-response-v1 step 5.
      "SecurityIncident.ReadWrite.All",
      "SharePointTenantSettings.ReadWrite.All",
      "TeamSettings.ReadWrite.All",
      "User-PasswordProfile.ReadWrite.All",
      // #1901 — identity-hygiene-v1 step 4. Narrow restore-only scope, NOT
      // User.ReadWrite.All.
      "User.DeleteRestore.All",
      "User.ReadWrite.All",
      "User.RevokeSessions.All",
      // #1899 — mfa-enforcement-v1 step 1 now really enumerates + deletes a user's
      // authentication methods (runForceMfaReregistrationAgainstTenant), so this
      // permission is genuinely requested now instead of documented-but-excluded.
      // #1901 reuses it for identity-hygiene-v1 step 5's Temporary Access Pass.
      "UserAuthenticationMethod.ReadWrite.All",
    ]);
  });

  it("#1901 added exactly 6 new permissions to what #1875/#1899 already requested", () => {
    // Guards the thing #1901's own body flagged as the real cost of this work:
    // "the set is requested from every customer". If a future rule quietly
    // enlarges the consent screen, this fails and someone has to justify it.
    const beforeThisIssue = [
      "Application.ReadWrite.All", "DelegatedPermissionGrant.ReadWrite.All", "Files.ReadWrite.All",
      "Group.Create", "GroupMember.ReadWrite.All", "OrganizationalBranding.ReadWrite.All",
      "Policy.Read.All", "Policy.ReadWrite.AuthenticationMethod", "Policy.ReadWrite.Authorization",
      "Policy.ReadWrite.ConditionalAccess", "RoleManagement.ReadWrite.Directory",
      "SharePointTenantSettings.ReadWrite.All", "TeamSettings.ReadWrite.All",
      "User-PasswordProfile.ReadWrite.All", "User.ReadWrite.All", "User.RevokeSessions.All",
      "UserAuthenticationMethod.ReadWrite.All",
    ];
    const added = DERIVED_WRITE_APP_PERMISSIONS.filter((p) => !beforeThisIssue.includes(p));
    expect(added).toEqual([
      "DeviceManagementApps.ReadWrite.All",
      "DeviceManagementConfiguration.ReadWrite.All",
      "DeviceManagementManagedDevices.ReadWrite.All",
      "LicenseAssignment.ReadWrite.All",
      "SecurityIncident.ReadWrite.All",
      "User.DeleteRestore.All",
    ]);
    // The PIM steps enlarge the set by NOTHING, contrary to what #1901's body
    // predicted ("Expect this to enlarge the requested permission set (PIM and
    // Intune assignment operations in particular)"). Both PIM schedule-request
    // endpoints list RoleManagement.ReadWrite.Directory as a documented
    // higher-privileged alternative, and quickstart-v1 step 2 already holds it.
    expect(added).not.toContain("RoleAssignmentSchedule.ReadWrite.Directory");
    expect(added).not.toContain("RoleEligibilitySchedule.ReadWrite.Directory");
  });

  it("excludes the permissions deliberately not requested, and says why", () => {
    const excluded = DOCUMENTED_BUT_NOT_REQUESTED.map((d) => d.permission);
    expect(excluded).toContain("DeviceManagementManagedDevices.PrivilegedOperations.All");
    for (const { permission, reason } of DOCUMENTED_BUT_NOT_REQUESTED) {
      expect(DERIVED_WRITE_APP_PERMISSIONS).not.toContain(permission);
      expect(reason.length).toBeGreaterThan(20);
    }
  });

  it("never requests a broad directory-wide write permission", () => {
    for (const forbidden of ["Directory.ReadWrite.All", "Group.ReadWrite.All", "Organization.ReadWrite.All", "Sites.ReadWrite.All"]) {
      expect(DERIVED_WRITE_APP_PERMISSIONS).not.toContain(forbidden);
    }
  });

  it("every rule carries a justification naming a real step, and a Microsoft Learn citation", () => {
    for (const rule of GRAPH_WRITE_PERMISSION_RULES) {
      expect(rule.justification.length).toBeGreaterThan(40);
      expect(rule.docUrl).toMatch(/^https:\/\/learn\.microsoft\.com\//);
      // #1901 — an empty `permissions` array is legitimate for exactly one
      // reason: Microsoft documents no application permission for the operation
      // at any tier. Any OTHER rule with an empty array is asserting that a real
      // write needs nothing, which is never true.
      if (rule.appOnlyUnsupported) {
        expect(rule.permissions).toEqual([]);
      } else {
        expect(rule.permissions.length).toBeGreaterThan(0);
      }
    }
  });
});

/**
 * Git #1975 — the audit that produced these assertions.
 *
 * #1975 was raised because three rules attribute a read-only `Policy.Read.All`
 * to a write, which looks self-evidently wrong. It is not: Microsoft's tables
 * separate ALTERNATIVES with `,` and CONJUNCTIONS with `and`, and all three of
 * those rules hold a documented `A and B` tier verbatim. Every one of the 23
 * rules was re-read against its own `docUrl` on 2026-09-04 and no rule was found
 * requesting a permission Microsoft does not document for that operation.
 *
 * These tests exist so the next reader does not have to take that on trust, and
 * so a rule cannot be "simplified" back into being wrong.
 */
describe("#1975 — no rule invents a permission its own Microsoft Learn page does not list", () => {
  /** Split a documented tier cell into the permission names it actually names. */
  const namesIn = (cell: string): string[] =>
    cell.match(/[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)?(?:\.[A-Za-z0-9]+)+/g) ?? [];

  it("every rule quotes the Application row of its own doc page", () => {
    for (const rule of GRAPH_WRITE_PERMISSION_RULES) {
      expect(
        rule.documentedApplicationTiers,
        `${rule.method} ${rule.pattern} has no documentedApplicationTiers`,
      ).toBeDefined();
      expect(rule.documentedApplicationTiers.leastPrivileged.length).toBeGreaterThan(0);
      expect(rule.documentedApplicationTiers.higherPrivileged.length).toBeGreaterThan(0);
    }
  });

  it("every requested permission appears in one of that rule's own documented tiers", () => {
    for (const rule of GRAPH_WRITE_PERMISSION_RULES) {
      const documented = new Set([
        ...namesIn(rule.documentedApplicationTiers.leastPrivileged),
        ...namesIn(rule.documentedApplicationTiers.higherPrivileged),
      ]);
      for (const p of rule.permissions) {
        expect(
          documented.has(p),
          `${rule.method} ${rule.pattern} requests ${p}, which appears in neither tier of ` +
            `${rule.docUrl}. Either the permission is wrong or the quoted row is stale — re-read the page.`,
        ).toBe(true);
      }
    }
  });

  it("a read-only permission on a write is allowed ONLY where Microsoft documents it as a conjunction", () => {
    const readOnly = (p: string) => /\.Read\.[A-Za-z]+$/.test(p);
    const writes = GRAPH_WRITE_PERMISSION_RULES.filter((r) => r.method !== "GET");

    for (const rule of writes) {
      for (const p of rule.permissions.filter(readOnly)) {
        const { leastPrivileged, higherPrivileged } = rule.documentedApplicationTiers;
        // The tier this platform is actually relying on must join the read-only
        // permission to a write permission with the word "and". A `,` there would
        // mean Microsoft offered alternatives and the derivation picked both.
        const conjunctions = [leastPrivileged, higherPrivileged].filter(
          (cell) => cell.includes(" and ") && namesIn(cell).includes(p),
        );
        expect(
          conjunctions.length,
          `${rule.method} ${rule.pattern} requests read-only ${p} on a write, but no tier on ` +
            `${rule.docUrl} lists it as part of an "A and B" conjunction. That is the #1975 bug class.`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it("the three Conditional-Access-family rules still hold the documented pair, and say why", () => {
    // Removing Policy.Read.All from these would 403 at runtime — Microsoft's
    // known-issues page states the conditionalAccessPolicy API "currently requires
    // consent to the Policy.Read.All permission to call the POST and PATCH methods".
    const affected: [string, string][] = [
      ["PATCH", "/policies/identitySecurityDefaultsEnforcementPolicy"],
      ["POST", "/identity/conditionalAccess/policies"],
      ["PATCH", "/identity/conditionalAccess/policies/{{policyId}}"],
    ];

    for (const [method, endpoint] of affected) {
      const got = requiredPermissionsForWrite(method, endpoint);
      expect(got.rule, `${method} ${endpoint} matched no rule`).not.toBeNull();
      expect(got.required.sort()).toEqual(["Policy.Read.All", "Policy.ReadWrite.ConditionalAccess"]);
      // The justification has to answer the security reviewer's question, not
      // just restate that Microsoft lists both.
      expect(got.rule!.justification).toMatch(/Git #1975/);
      expect(got.rule!.documentedApplicationTiers.higherPrivileged + got.rule!.documentedApplicationTiers.leastPrivileged)
        .toContain("Policy.Read.All and Policy.ReadWrite.ConditionalAccess");
    }
  });

  it("Policy.Read.All is in the requested set only because those rules need it", () => {
    // An inventory, deliberately exact: Policy.Read.All is a read permission
    // sitting in a write app's request, and every rule that puts it there has to
    // be one whose own Microsoft Learn page documents the "Policy.Read.All and
    // Policy.ReadWrite.ConditionalAccess" conjunction. If a new rule appears in
    // this list, someone has to have checked that page. #1901 added two, and both
    // are Conditional Access family with that exact documented conjunction:
    // namedLocations (whose higher tier is "Not available.", so the conjunction
    // is the ONLY tier) and the DELETE that action.delete-ca-policy stores
    // (#2855 — was PUT, a method Graph does not expose on this resource).
    const owners = GRAPH_WRITE_PERMISSION_RULES.filter((r) => r.permissions.includes("Policy.Read.All"));
    expect(owners.map((r) => `${r.method} ${r.pattern}`).sort()).toEqual([
      "DELETE /identity/conditionalAccess/policies/*",
      "PATCH /identity/conditionalAccess/policies/*",
      "PATCH /policies/identitySecurityDefaultsEnforcementPolicy",
      "POST /identity/conditionalAccess/namedLocations",
      "POST /identity/conditionalAccess/policies",
    ]);
  });
});

/**
 * Git #1901 — the other Config Packs.
 *
 * #1875 mapped the four packs that materialize a clean plan. Everything below is
 * the endpoints belonging to the OTHER packs, which until now returned
 * `rule: null` and rendered as "Write permissions not verified" forever.
 *
 * Every (method, endpoint) pair asserted here was read out of the live
 * `config_pack_templates` -> `baseline_action_templates` join on 2026-09-04 by
 * running the real derivation over every pack row, NOT copied from #1901's issue
 * body. That matters: the body's table was captured 2026-08-30 and listed 13
 * endpoints, but the live run returned 19 unmapped steps across 16 distinct
 * endpoints — governance-groups-v1 had been wired in the meantime. The three
 * extra endpoints are covered here too.
 */
describe("#1901 — the other Config Packs' endpoints all resolve to a documented permission", () => {
  const packSteps: Array<[string, string, string, string[]]> = [
    // [pack, method, endpoint (verbatim from the template row), expected required]
    ["baseline-licensing-v1", "POST", "/groups/{{groupId}}/assignLicense", ["LicenseAssignment.ReadWrite.All"]],
    ["conditional-access-baseline-v1", "POST", "/identity/conditionalAccess/namedLocations", ["Policy.Read.All", "Policy.ReadWrite.ConditionalAccess"]],
    ["conditional-access-baseline-v1", "DELETE", "/identity/conditionalAccess/policies/{{policyId}}", ["Policy.Read.All", "Policy.ReadWrite.ConditionalAccess"]],
    ["device-compliance-v1", "POST", "/deviceManagement/deviceCompliancePolicies/{{policyId}}/assign", ["DeviceManagementConfiguration.ReadWrite.All"]],
    ["device-compliance-v1", "POST", "/deviceManagement/deviceConfigurations/{{profileId}}/assign", ["DeviceManagementConfiguration.ReadWrite.All"]],
    ["device-compliance-v1", "POST", "/deviceAppManagement/targetedManagedAppConfigurations/{{policyId}}/assign", ["DeviceManagementApps.ReadWrite.All"]],
    ["device-compliance-v1", "PATCH", "/deviceManagement/managedDevices/{{deviceId}}", ["DeviceManagementManagedDevices.ReadWrite.All"]],
    ["identity-hygiene-v1", "POST", "/directory/deletedItems/{{userId}}/restore", ["User.DeleteRestore.All"]],
    ["identity-hygiene-v1", "POST", "/users/{{userId}}/authentication/temporaryAccessPassMethods", ["UserAuthenticationMethod.ReadWrite.All"]],
    ["privileged-access-v1", "POST", "/roleManagement/directory/roleEligibilityScheduleRequests", ["RoleManagement.ReadWrite.Directory"]],
    ["privileged-access-v1", "POST", "/roleManagement/directory/roleAssignmentScheduleRequests", ["RoleManagement.ReadWrite.Directory"]],
    ["security-incident-response-v1", "PATCH", "/security/incidents/{{incidentId}}", ["SecurityIncident.ReadWrite.All"]],
    // The three governance-groups-v1 endpoints #1901's body predates. These name
    // the permission Microsoft documents — `required` reports what the operation
    // NEEDS, which is not the same as what this platform requests. All three are
    // then excluded via `notRequested`; see the dedicated assertions below.
    ["governance-groups-v1", "POST", "/groups/{{groupId}}/owners/$ref", ["Group.ReadWrite.All"]],
    ["governance-groups-v1", "PATCH", "/groups/{{groupId}}", ["Group.ReadWrite.All"]],
    ["governance-groups-v1", "POST", "/groupLifecyclePolicies", ["Directory.ReadWrite.All"]],
  ];

  /** The endpoints above whose permission is documented but deliberately refused. */
  const refusedEndpoints = new Set([
    "/groups/{{groupId}}/owners/$ref",
    "/groups/{{groupId}}",
    "/groupLifecyclePolicies",
  ]);

  for (const [pack, method, endpoint, expected] of packSteps) {
    it(`${pack}: ${method} ${endpoint}`, () => {
      const got = requiredPermissionsForWrite(method, endpoint);
      expect(got.rule, `${method} ${endpoint} still matches no rule`).not.toBeNull();
      expect(got.required.sort()).toEqual([...expected].sort());
    });
  }

  it("every permission these packs need IS requested, except the ones explicitly refused", () => {
    for (const [, method, endpoint] of packSteps) {
      if (refusedEndpoints.has(endpoint)) continue;
      for (const p of requiredPermissionsForWrite(method, endpoint).required) {
        expect(DERIVED_WRITE_APP_PERMISSIONS, `${method} ${endpoint}`).toContain(p);
      }
    }
  });

  it("the group-write steps are REFUSED, not silently satisfied", () => {
    // All three name a permission Microsoft really documents, and all three are
    // excluded from the request because that permission is tenant-wide group or
    // directory write. The pairing is what makes this honest: `required` reports
    // the real need, `notRequested` reports that we are not asking for it, and
    // the route subtracts the second from the first so the step reports as
    // refused rather than as missing-a-consent the customer could go and grant.
    const refused: Array<[string, string, string]> = [
      ["POST", "/groups/{{groupId}}/owners/$ref", "Group.ReadWrite.All"],
      ["PATCH", "/groups/{{groupId}}", "Group.ReadWrite.All"],
      ["POST", "/groupLifecyclePolicies", "Directory.ReadWrite.All"],
    ];
    for (const [method, endpoint, permission] of refused) {
      const got = requiredPermissionsForWrite(method, endpoint);
      expect(got.required, `${method} ${endpoint}`).toEqual([permission]);
      expect(got.notRequested, `${method} ${endpoint}`).toEqual([permission]);
      expect(got.rule!.grantRecommended).toBe(false);
      expect(got.rule!.notRequestedReason!.length).toBeGreaterThan(40);
      expect(DERIVED_WRITE_APP_PERMISSIONS).not.toContain(permission);
    }
  });

  it("PIM approval is app-only UNSUPPORTED — a third state, not 'needs nothing'", () => {
    // Microsoft's approvalStep-update page reads "Not supported." in the
    // Application row of all three of its permission tables. This is the one
    // rule in the table with no permissions at all, and the flag is what stops
    // required:[] being read as "this step is ready to run".
    const got = requiredPermissionsForWrite(
      "PATCH",
      "/roleManagement/directory/roleAssignmentApprovals/{{approvalId}}/steps/{{stepId}}",
    );
    expect(got.rule).not.toBeNull();
    expect(got.required).toEqual([]);
    expect(got.appOnlyUnsupported).toBe(true);
    expect(got.rule!.documentedApplicationTiers.leastPrivileged).toBe("Not supported.");
    expect(got.rule!.documentedApplicationTiers.higherPrivileged).toBe("Not supported.");

    expect(APP_ONLY_UNSUPPORTED_OPERATIONS).toHaveLength(1);
    expect(APP_ONLY_UNSUPPORTED_OPERATIONS[0].pattern).toBe(
      "/roleManagement/directory/roleAssignmentApprovals/*/steps/*",
    );

    // It contributes no permission to either list — there is nothing to ask for
    // and nothing that was declined.
    expect(DOCUMENTED_BUT_NOT_REQUESTED.map((d) => d.permission)).not.toContain(
      "RoleAssignmentSchedule.ReadWrite.Directory",
    );
  });

  it("a mapped-but-impossible step is distinguishable from an unmapped one", () => {
    // The route branches on exactly this difference to pick which honest message
    // to render, so the two must not collapse into each other.
    const impossible = requiredPermissionsForWrite(
      "PATCH", "/roleManagement/directory/roleAssignmentApprovals/{{a}}/steps/{{s}}",
    );
    const unmapped = requiredPermissionsForWrite("POST", "/some/endpoint/nobody/mapped");

    expect(impossible.rule).not.toBeNull();
    expect(impossible.appOnlyUnsupported).toBe(true);

    expect(unmapped.rule).toBeNull();
    expect(unmapped.appOnlyUnsupported).toBe(false);

    // And both differ from a genuinely satisfiable step.
    const fine = requiredPermissionsForWrite("PATCH", "/security/incidents/{{incidentId}}");
    expect(fine.rule).not.toBeNull();
    expect(fine.appOnlyUnsupported).toBe(false);
    expect(fine.required).toEqual(["SecurityIncident.ReadWrite.All"]);
  });

  it("the two Intune device rules do NOT collapse into each other", () => {
    // syncDevice's only documented permission is the PrivilegedOperations scope
    // that also confers remote wipe/retire/lock, and is refused. The managedDevice
    // PATCH is ordinary configuration write and is requested. Four path segments
    // vs three keeps them apart; if the patterns ever shadow, updating a device
    // category would silently start reporting as needing tenant-wide wipe.
    const sync = requiredPermissionsForWrite("POST", "/deviceManagement/managedDevices/{{deviceId}}/syncDevice");
    expect(sync.required).toEqual(["DeviceManagementManagedDevices.PrivilegedOperations.All"]);
    expect(sync.rule!.grantRecommended).toBe(false);

    const patch = requiredPermissionsForWrite("PATCH", "/deviceManagement/managedDevices/{{deviceId}}");
    expect(patch.required).toEqual(["DeviceManagementManagedDevices.ReadWrite.All"]);
    expect(patch.rule!.grantRecommended).not.toBe(false);
  });

  it("group licensing does not fall through to the per-user assignLicense rule", () => {
    // POST /users/*/assignLicense reuses User.ReadWrite.All because it is held
    // anyway. The group form must NOT inherit that reasoning: its documented
    // alternatives are Directory.ReadWrite.All and Group.ReadWrite.All, both of
    // which this platform refuses, so the narrow permission is mandatory here.
    const user = requiredPermissionsForWrite("POST", "/users/{{userId}}/assignLicense");
    const group = requiredPermissionsForWrite("POST", "/groups/{{groupId}}/assignLicense");
    expect(user.required).toEqual(["User.ReadWrite.All"]);
    expect(group.required).toEqual(["LicenseAssignment.ReadWrite.All"]);
    expect(group.required).not.toContain("Group.ReadWrite.All");
    expect(group.required).not.toContain("Directory.ReadWrite.All");
  });

  it("the Temporary Access Pass rule does not put a read-only permission on a write", () => {
    // Microsoft's Application least-privileged cell for this POST is genuinely
    // UserAuthMethod-TAP.Read.All. Its higher tier is a comma-separated list of
    // ALTERNATIVES, so picking the ReadWrite one that is already held is correct
    // — and, unlike the Conditional Access rules, there is no "and" here, so a
    // read-only permission would NOT be defensible under the #1975 rule.
    const got = requiredPermissionsForWrite("POST", "/users/{{u}}/authentication/temporaryAccessPassMethods");
    expect(got.required).toEqual(["UserAuthenticationMethod.ReadWrite.All"]);
    expect(got.rule!.documentedApplicationTiers.leastPrivileged).toBe("UserAuthMethod-TAP.Read.All");
    expect(got.rule!.documentedApplicationTiers.higherPrivileged).not.toContain(" and ");
  });

  it("#2855 — the two previously-broken templates now resolve on their fixed method/endpoint", () => {
    // action.delete-ca-policy previously stored PUT, a method Graph does not
    // expose on this resource; #2855 corrected it to DELETE. The old PUT no
    // longer matches any rule.
    const del = requiredPermissionsForWrite("DELETE", "/identity/conditionalAccess/policies/{{policyId}}");
    expect(del.rule).not.toBeNull();
    expect(del.required.sort()).toEqual(["Policy.Read.All", "Policy.ReadWrite.ConditionalAccess"]);
    expect(requiredPermissionsForWrite("PUT", "/identity/conditionalAccess/policies/{{policyId}}").rule).toBeNull();

    // action.assign-app-protection-policy previously targeted managedAppPolicies,
    // Microsoft's abstract base type with no assign action; #2855 corrected it to
    // the real concrete targetedManagedAppConfigurations resource.
    const mam = requiredPermissionsForWrite("POST", "/deviceAppManagement/targetedManagedAppConfigurations/{{policyId}}/assign");
    expect(mam.rule).not.toBeNull();
    expect(mam.required).toEqual(["DeviceManagementApps.ReadWrite.All"]);
    expect(requiredPermissionsForWrite("POST", "/deviceAppManagement/managedAppPolicies/{{policyId}}/assign").rule).toBeNull();
  });
});

describe("rule ordering", () => {
  it("specific /users sub-paths win over the generic /users/* rule", () => {
    // If the generic PATCH /users/* rule were matched first, per-user MFA would
    // resolve to User.ReadWrite.All and the pack would be reported as runnable
    // when it is not.
    expect(requiredPermissionsForWrite("PATCH", "/users/{{userId}}/authentication/requirements").required)
      .toEqual(["Policy.ReadWrite.AuthenticationMethod"]);
    expect(requiredPermissionsForWrite("POST", "/users/{{userId}}/revokeSignInSessions").required)
      .toEqual(["User.RevokeSessions.All"]);
  });

  it("an unmapped write returns no rule rather than guessing a permission", () => {
    const got = requiredPermissionsForWrite("POST", "/some/endpoint/nobody/mapped");
    expect(got.rule).toBeNull();
    expect(got.required).toEqual([]);
  });
});
