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
  it("is exactly the 17 permissions #1875/#1899 derived from the packs' real steps", () => {
    expect([...DERIVED_WRITE_APP_PERMISSIONS]).toEqual([
      "Application.ReadWrite.All",
      "DelegatedPermissionGrant.ReadWrite.All",
      "Files.ReadWrite.All",
      "Group.Create",
      "GroupMember.ReadWrite.All",
      "OrganizationalBranding.ReadWrite.All",
      "Policy.Read.All",
      "Policy.ReadWrite.AuthenticationMethod",
      "Policy.ReadWrite.Authorization",
      "Policy.ReadWrite.ConditionalAccess",
      "RoleManagement.ReadWrite.Directory",
      "SharePointTenantSettings.ReadWrite.All",
      "TeamSettings.ReadWrite.All",
      "User-PasswordProfile.ReadWrite.All",
      "User.ReadWrite.All",
      "User.RevokeSessions.All",
      // #1899 — mfa-enforcement-v1 step 1 now really enumerates + deletes a user's
      // authentication methods (runForceMfaReregistrationAgainstTenant), so this
      // permission is genuinely requested now instead of documented-but-excluded.
      "UserAuthenticationMethod.ReadWrite.All",
    ]);
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
      expect(rule.permissions.length).toBeGreaterThan(0);
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
    const owners = GRAPH_WRITE_PERMISSION_RULES.filter((r) => r.permissions.includes("Policy.Read.All"));
    expect(owners.map((r) => r.pattern).sort()).toEqual([
      "/identity/conditionalAccess/policies",
      "/identity/conditionalAccess/policies/*",
      "/policies/identitySecurityDefaultsEnforcementPolicy",
    ]);
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
