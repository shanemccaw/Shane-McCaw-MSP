/**
 * Git #551 Phase 2 — identity:global-admin-count counted ACTIVATED DIRECTORY
 * ROLES, not Global Administrators.
 *
 * The live audit (2026-08-07) settled the defect on real tenant data:
 *     endpoint: /directoryRoles
 *     mapping:  [{count, id -> globalAdminCount}]
 *     result:   item_count 14, globalAdminCount 14, severity critical,
 *               members_count 0, members_first null, members_values []
 *
 * That last line is the tell: the old `properties` array asked for "members"
 * and got nothing on every scan, because GET /directoryRoles returns role
 * objects and members are a relationship you have to traverse. The check was
 * reporting "14 Global Administrators" from a count of activated roles.
 *
 * This replays the fix's real config
 * (lib/db/migrations/manual/2026-08-07-global-admin-count-role-members-551.sql)
 * against fixtures shaped like the two payloads — the old directoryRole list and
 * the new members list — so the correction is pinned by behaviour rather than by
 * the migration's own prose.
 *
 * WHAT THIS FILE CANNOT DO: prove the literal single quote in
 * roleTemplateId='...' survives a real Graph request. There is no Graph
 * credential in this environment. It proves the PLATFORM builds the URL intact
 * (the URL-construction describe below drives the real resolveEndpointPlaceholders
 * and reproduces graphFetchPaginated's exact concatenation), which is the half
 * that lives in this codebase. PART C of the migration is the live half.
 */

import { describe, it, expect, vi } from "vitest";

// applyMapping/classifySeverity/resolveEndpointPlaceholders are pure, but
// monitor-executor.ts imports @workspace/db at module scope, which throws
// without a DATABASE_URL (none in this environment).
vi.mock("@workspace/db", () => ({
  db: {},
  monitorChecksTable: {},
  monitoringPackagesTable: {},
  monitoringPackageChecksTable: {},
  tenantMonitorProfilesTable: {},
  tenantCheckItemDetailsTable: {},
  tenantsTable: {},
}));

import {
  applyMapping,
  classifySeverity,
  resolveEndpointPlaceholders,
  appendQueryParams,
} from "./monitor-executor";
import type { MappingRule, SeverityRule } from "./monitor-executor";

// ── The real config, mirroring the migration's UPDATE ─────────────────────────

/** Global Administrator's roleTemplateId — a fixed constant in every tenant. */
const GA_ROLE_TEMPLATE_ID = "62e90394-69f5-4237-9190-012177145e10";

const NEW_ENDPOINT = `/directoryRoles(roleTemplateId='${GA_ROLE_TEMPLATE_ID}')/members`;

const NEW_PROPERTIES = ["id", "displayName", "userPrincipalName", "mail", "@odata.type"];

const NEW_MAPPING: MappingRule[] = [
  { sourceField: "id", targetField: "globalAdminCount", transform: "count" },
  { sourceField: "@odata.type", targetField: "globalAdminsByPrincipalType", transform: "groupByCount" },
  { sourceField: "userPrincipalName", targetField: "globalAdminUserCount", transform: "countTruthy" },
  { sourceField: "appId", targetField: "globalAdminServicePrincipalCount", transform: "countTruthy" },
];

/**
 * UNCHANGED by #551, and deliberately so — the migration does not include
 * severity_rules in its SET clause. Reproduced here byte-for-byte from the live
 * row so the suite fails if a future change quietly edits them. They were always
 * well-formed; they were correct rules reading a number that meant something
 * else.
 */
const SEVERITY_RULES: SeverityRule[] = [
  {
    severity: "critical",
    expression: "globalAdminCount >= 10",
    label: "Far more Global Administrators than any real operational need — severe attack surface exposure",
  },
  {
    severity: "warning",
    expression: "globalAdminCount >= 5",
    label: "Global Administrator count exceeds Microsoft's own recommended threshold of fewer than 5",
  },
  {
    severity: "warning",
    expression: "globalAdminCount < 2",
    label: "Fewer than 2 Global Administrators — single point of failure risk if that one account is lost or locked out",
  },
];

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** One entry of the OLD payload: what GET /directoryRoles actually returns. */
function directoryRole(displayName: string, roleTemplateId: string): Record<string, unknown> {
  return {
    id: `role-${roleTemplateId.slice(0, 8)}`,
    deletedDateTime: null,
    description: `${displayName} role`,
    displayName,
    roleTemplateId,
    // NOTE: no `members` key. That is the whole point — the old config asked for
    // one and Graph has never put it here.
  };
}

/** A human Global Administrator, as /members returns one. */
function userMember(name: string, upn: string): Record<string, unknown> {
  return {
    "@odata.type": "#microsoft.graph.user",
    id: `user-${upn}`,
    businessPhones: [],
    displayName: name,
    givenName: name.split(" ")[0],
    jobTitle: null,
    mail: upn,
    officeLocation: null,
    preferredLanguage: "en-US",
    surname: name.split(" ")[1] ?? "",
    userPrincipalName: upn,
  };
}

/** A role-assignable GROUP holding Global Administrator. Not a person. */
function groupMember(name: string): Record<string, unknown> {
  return {
    "@odata.type": "#microsoft.graph.group",
    id: `group-${name}`,
    displayName: name,
    mailEnabled: false,
    securityEnabled: true,
    isAssignableToRole: true,
    // no userPrincipalName, no appId
  };
}

/** A service principal holding Global Administrator. Not a person either. */
function servicePrincipalMember(name: string, appId: string): Record<string, unknown> {
  return {
    "@odata.type": "#microsoft.graph.servicePrincipal",
    id: `sp-${appId}`,
    displayName: name,
    appId,
    servicePrincipalType: "Application",
    // no userPrincipalName
  };
}

describe("#551 — the defect: /directoryRoles counts activated roles, not admins", () => {
  // The old config, reproduced from the live row.
  const OLD_PROPERTIES = ["id", "members"];
  const OLD_MAPPING: MappingRule[] = [
    { sourceField: "id", targetField: "globalAdminCount", transform: "count" },
  ];

  /**
   * A perfectly ordinary tenant's activated-role list. 14 was the real number on
   * the testbed tenant, and it is unremarkable — role activation happens
   * implicitly whenever an admin assigns a role in the portal.
   */
  const ACTIVATED_ROLES = [
    directoryRole("Global Administrator", GA_ROLE_TEMPLATE_ID),
    directoryRole("Directory Readers", "88d8e3e3-8f55-4a1e-953a-9b9898b8876b"),
    directoryRole("User Administrator", "fe930be7-5e62-47db-91af-98c3a49a38b1"),
    directoryRole("Exchange Administrator", "29232cdf-9323-42fd-ade2-1d097af3e4de"),
    directoryRole("SharePoint Administrator", "f28a1f50-f6e7-4571-818b-6a12f2af6b6c"),
    directoryRole("Teams Administrator", "69091246-20e8-4a56-aa4d-066075b2a7a8"),
    directoryRole("Security Administrator", "194ae4cb-b126-40b2-bd5b-6091b380977d"),
    directoryRole("Billing Administrator", "b0f54661-2d74-4c50-afa3-1ec803f12efe"),
    directoryRole("Helpdesk Administrator", "729827e3-9c14-49f7-bb1b-9608f156bbb8"),
    directoryRole("Application Administrator", "9b895d92-2cd3-44c7-9d02-a6ac2d5ea5c3"),
    directoryRole("Intune Administrator", "3a2c62db-5318-420d-8d74-23affee5d9d5"),
    directoryRole("Global Reader", "f2ef992c-3afb-46b9-b7cf-a126ee74c451"),
    directoryRole("Compliance Administrator", "17315797-102d-40b4-93e0-432062caca18"),
    directoryRole("Password Administrator", "966707d0-3269-4727-9be2-8c3a10f19b9d"),
  ];

  it("reproduces the live defect exactly: 14 roles read as 14 Global Administrators", () => {
    const result = applyMapping(ACTIVATED_ROLES, OLD_MAPPING, OLD_PROPERTIES);

    // The number the customer saw.
    expect(result.globalAdminCount).toBe(14);
    // ...and there is exactly ONE Global Administrator role in that list, so the
    // count has no relationship at all to the thing it is named after.
    expect(
      ACTIVATED_ROLES.filter(r => r.roleTemplateId === GA_ROLE_TEMPLATE_ID),
    ).toHaveLength(1);
  });

  it("reproduces the smoking gun: properties asked for `members` and got nothing", () => {
    const result = applyMapping(ACTIVATED_ROLES, OLD_MAPPING, OLD_PROPERTIES);

    // Byte-identical to the live extracted_properties from the 2026-08-07 run.
    expect(result.members_count).toBe(0);
    expect(result.members_first).toBeNull();
    expect(result.members_values).toEqual([]);
  });

  it("fired `critical` on that count — a real customer told they had severe exposure", () => {
    const result = applyMapping(ACTIVATED_ROLES, OLD_MAPPING, OLD_PROPERTIES);
    const match = classifySeverity(SEVERITY_RULES, result);

    expect(match?.severity).toBe("critical");
  });
});

describe("#551 — the fix: /members returns real principals", () => {
  /**
   * A realistic corrected payload: three humans, one role-assignable group and
   * one service principal all holding Global Administrator.
   */
  const MEMBERS = [
    userMember("Ada Lovelace", "ada@contoso.com"),
    userMember("Grace Hopper", "grace@contoso.com"),
    userMember("Break Glass", "breakglass@contoso.onmicrosoft.com"),
    groupMember("Tier-0 Admins"),
    servicePrincipalMember("Backup Automation", "11111111-2222-3333-4444-555555555555"),
  ];

  it("globalAdminCount is now the real member count, not the role count", () => {
    const result = applyMapping(MEMBERS, NEW_MAPPING, NEW_PROPERTIES);
    expect(result.globalAdminCount).toBe(5);
  });

  it("the dead `members_*` keys are gone from the output entirely", () => {
    const result = applyMapping(MEMBERS, NEW_MAPPING, NEW_PROPERTIES);
    // The response IS the members list now — there is no nested field left to
    // ask for, so the keys that were permanently 0/null/[] simply do not exist.
    expect(result).not.toHaveProperty("members_count");
    expect(result).not.toHaveProperty("members_first");
    expect(result).not.toHaveProperty("members_values");
  });

  it("carries real per-admin identity — names, UPNs and mail — in the aggregate row", () => {
    const result = applyMapping(MEMBERS, NEW_MAPPING, NEW_PROPERTIES);

    expect(result.displayName_values).toEqual([
      "Ada Lovelace",
      "Grace Hopper",
      "Break Glass",
      "Tier-0 Admins",
      "Backup Automation",
    ]);
    expect(result.userPrincipalName_values).toEqual([
      "ada@contoso.com",
      "grace@contoso.com",
      "breakglass@contoso.onmicrosoft.com",
    ]);
    expect(result.mail_values).toEqual([
      "ada@contoso.com",
      "grace@contoso.com",
      "breakglass@contoso.onmicrosoft.com",
    ]);
  });
});

/**
 * CAVEAT 2 from the investigation, enforced in data rather than promised in
 * prose: the response mixes users, role-assignable groups and service
 * principals, and treating every row as a human admin is its own category error.
 */
describe("#551 caveat 2 — principal types are discriminated, not conflated", () => {
  const MEMBERS = [
    userMember("Ada Lovelace", "ada@contoso.com"),
    userMember("Grace Hopper", "grace@contoso.com"),
    userMember("Break Glass", "breakglass@contoso.onmicrosoft.com"),
    groupMember("Tier-0 Admins"),
    servicePrincipalMember("Backup Automation", "11111111-2222-3333-4444-555555555555"),
  ];

  it("groupByCount over @odata.type breaks the total out by real principal kind", () => {
    const result = applyMapping(MEMBERS, NEW_MAPPING, NEW_PROPERTIES);

    expect(result.globalAdminsByPrincipalType).toEqual({
      "#microsoft.graph.user": 3,
      "#microsoft.graph.group": 1,
      "#microsoft.graph.servicePrincipal": 1,
    });
  });

  it("counts humans separately from app identities", () => {
    const result = applyMapping(MEMBERS, NEW_MAPPING, NEW_PROPERTIES);

    // userPrincipalName exists only on users; appId only on service principals.
    // Both are deliberately DOT-FREE sourceFields, so this split survives even on
    // a build without the resolvePathInData literal-key fix.
    expect(result.globalAdminUserCount).toBe(3);
    expect(result.globalAdminServicePrincipalCount).toBe(1);
  });

  it("a role-assignable group is counted in the total but never as a human", () => {
    const withGroup = applyMapping(MEMBERS, NEW_MAPPING, NEW_PROPERTIES);
    const withoutGroup = applyMapping(
      MEMBERS.filter(m => m["@odata.type"] !== "#microsoft.graph.group"),
      NEW_MAPPING,
      NEW_PROPERTIES,
    );

    expect(withGroup.globalAdminCount).toBe(5);
    expect(withoutGroup.globalAdminCount).toBe(4);
    // The group changes the privileged-principal total...
    expect(withGroup.globalAdminCount).not.toBe(withoutGroup.globalAdminCount);
    // ...but never the human count, in either direction. The group's own
    // membership is NOT enumerated by this endpoint, which is exactly why the
    // check must not present globalAdminUserCount as a complete human tally.
    expect(withGroup.globalAdminUserCount).toBe(withoutGroup.globalAdminUserCount);
  });

  it("@odata.type is captured as a raw property too, so the type list is inspectable", () => {
    const result = applyMapping(MEMBERS, NEW_MAPPING, NEW_PROPERTIES);

    expect(result["@odata.type_count"]).toBe(5);
    expect(result["@odata.type_first"]).toBe("#microsoft.graph.user");
    expect(result["@odata.type_values"]).toEqual([
      "#microsoft.graph.user",
      "#microsoft.graph.user",
      "#microsoft.graph.user",
      "#microsoft.graph.group",
      "#microsoft.graph.servicePrincipal",
    ]);
  });
});

/**
 * The executor change #551 needed. `@odata.type` contains a dot but is a FIELD
 * NAME, not a path — resolvePathInData split it unconditionally and asked each
 * item for item["@odata"]["type"], undefined on every real Graph object.
 */
describe("#551 — resolvePathInData resolves a literal dotted key, without breaking paths", () => {
  it("BEFORE the fix this rule would have silently produced {} — now it produces real counts", () => {
    const result = applyMapping(
      [userMember("Ada Lovelace", "ada@contoso.com")],
      [{ sourceField: "@odata.type", targetField: "byType", transform: "groupByCount" }],
      [],
    );

    expect(result.byType).toEqual({ "#microsoft.graph.user": 1 });
    // The failure mode being guarded against, stated explicitly: an empty object
    // is what a dot-split resolver returns here, and it is indistinguishable
    // from "this tenant has no admins" to anything downstream.
    expect(result.byType).not.toEqual({});
  });

  it("REGRESSION GUARD: genuine nested dot-paths still resolve", () => {
    // The behaviour the literal-first lookup must not disturb — e.g. the
    // "status.errorCode" shape the resolver's own docstring cites.
    const result = applyMapping(
      [
        { id: "a", status: { errorCode: "Failed" } },
        { id: "b", status: { errorCode: "Failed" } },
        { id: "c", status: { errorCode: "Succeeded" } },
      ],
      [{ sourceField: "status.errorCode", targetField: "byCode", transform: "groupByCount" }],
      [],
    );

    expect(result.byCode).toEqual({ Failed: 2, Succeeded: 1 });
  });

  it("REGRESSION GUARD: a literal key set to undefined falls through to the path walk", () => {
    // The check is on the VALUE, not hasOwnProperty, precisely so a present-but-
    // undefined literal cannot shadow a path that would have resolved.
    const result = applyMapping(
      [{ id: "a", "status.errorCode": undefined, status: { errorCode: "Failed" } }],
      [{ sourceField: "status.errorCode", targetField: "byCode", transform: "groupByCount" }],
      [],
    );

    expect(result.byCode).toEqual({ Failed: 1 });
  });

  it("REGRESSION GUARD: plain undotted fields are unaffected", () => {
    const result = applyMapping(
      [userMember("Ada Lovelace", "ada@contoso.com")],
      [{ sourceField: "displayName", targetField: "names", transform: "join" }],
      [],
    );

    expect(result.names).toBe("Ada Lovelace");
  });
});

/**
 * The severity rules are NOT changed by #551. These assert they now behave
 * correctly against a number that finally means what they always assumed.
 */
describe("#551 — the untouched severity rules, now reading a real member count", () => {
  function countOf(memberCount: number): Record<string, unknown> {
    const members = Array.from({ length: memberCount }, (_, i) =>
      userMember(`Admin ${i}`, `admin${i}@contoso.com`));
    return applyMapping(members, NEW_MAPPING, NEW_PROPERTIES);
  }

  it("10+ real Global Administrators is critical", () => {
    const match = classifySeverity(SEVERITY_RULES, countOf(12));
    expect(match?.severity).toBe("critical");
    expect(match?.label).toContain("severe attack surface exposure");
  });

  it("5–9 real Global Administrators is a warning", () => {
    const match = classifySeverity(SEVERITY_RULES, countOf(5));
    expect(match?.severity).toBe("warning");
    expect(match?.label).toContain("fewer than 5");
  });

  it("a healthy 2–4 matches no rule at all", () => {
    expect(classifySeverity(SEVERITY_RULES, countOf(3))).toBeNull();
    expect(classifySeverity(SEVERITY_RULES, countOf(2))).toBeNull();
  });

  it("fewer than 2 is the single-point-of-failure warning, not a clean pass", () => {
    const match = classifySeverity(SEVERITY_RULES, countOf(1));
    expect(match?.severity).toBe("warning");
    expect(match?.label).toContain("single point of failure");
  });

  it("the bands are evaluated most-severe-first, so 12 is critical rather than warning", () => {
    // classifySeverity returns the FIRST match; both >= 10 and >= 5 are true at
    // 12, and rule order is what makes the answer critical.
    const match = classifySeverity(SEVERITY_RULES, countOf(12));
    expect(match?.severity).toBe("critical");
  });

  it("service principals and groups count toward the severity total, deliberately", () => {
    // 4 humans + 1 SP = 5 privileged principals -> warning. A privileged app
    // identity is attack surface; excluding it would understate the risk the
    // rule exists to catch.
    const mixed = applyMapping(
      [
        userMember("A", "a@contoso.com"),
        userMember("B", "b@contoso.com"),
        userMember("C", "c@contoso.com"),
        userMember("D", "d@contoso.com"),
        servicePrincipalMember("Automation", "aaaa-bbbb"),
      ],
      NEW_MAPPING,
      NEW_PROPERTIES,
    );

    expect(mixed.globalAdminCount).toBe(5);
    expect(mixed.globalAdminUserCount).toBe(4);
    expect(classifySeverity(SEVERITY_RULES, mixed)?.severity).toBe("warning");
  });
});

/**
 * The closest this environment can get to the live smoke test. It proves the
 * platform's own URL construction carries the literal single quote through
 * intact; it does NOT prove Graph answers 200. See PART C of the migration.
 */
describe("#551 — the roleTemplateId single quote survives URL construction", () => {
  // Reproduced from graphFetchPaginated (monitor-executor.ts), which hardcodes
  // this base and builds the URL by concatenation.
  const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
  const TENANT_ID = "c4c814d4-3afe-441e-9145-62461d0a4fd3";

  function buildUrl(endpoint: string, tenantId: string): string {
    const resolved = resolveEndpointPlaceholders(endpoint, tenantId);
    return resolved.startsWith("http")
      ? resolved
      : `${GRAPH_BASE}${resolved.startsWith("/") ? "" : "/"}${resolved}`;
  }

  it("resolveEndpointPlaceholders leaves the endpoint byte-identical", () => {
    // It substitutes only {NDaysAgo} / {itemId} / {id} / {tenantId}; the parens
    // and the quoted GUID carry no placeholder tokens, so nothing should change.
    expect(resolveEndpointPlaceholders(NEW_ENDPOINT, TENANT_ID)).toBe(NEW_ENDPOINT);
  });

  it("does not mistake the GUID for a tenant-identity placeholder", () => {
    const resolved = resolveEndpointPlaceholders(NEW_ENDPOINT, TENANT_ID);
    expect(resolved).toContain(GA_ROLE_TEMPLATE_ID);
    expect(resolved).not.toContain(TENANT_ID);
  });

  it("the constructed URL keeps both quotes and is a single well-formed URL", () => {
    const url = buildUrl(NEW_ENDPOINT, TENANT_ID);

    expect(url).toBe(
      `https://graph.microsoft.com/v1.0/directoryRoles(roleTemplateId='${GA_ROLE_TEMPLATE_ID}')/members`,
    );
    expect((url.match(/'/g) ?? []).length).toBe(2);
    expect(() => new URL(url)).not.toThrow();
  });

  it("the path Graph receives still carries the alternate key after the base is sliced off", () => {
    // graphFetchPaginated hands graphFetchForTenant a path, not a full URL.
    const url = buildUrl(NEW_ENDPOINT, TENANT_ID);
    const fullPath = url.startsWith(GRAPH_BASE) ? url.slice(GRAPH_BASE.length) : url;

    expect(fullPath).toBe(NEW_ENDPOINT);
  });

  it("appendQueryParams with the check's null select/filter params is a no-op", () => {
    // select_params and filter_params are deliberately NULL on this check (the
    // collection is polymorphic; a user-only $select is what breaks it).
    const url = buildUrl(NEW_ENDPOINT, TENANT_ID);
    expect(appendQueryParams(url, null, null)).toBe(url);
  });

  it("the quote is a legal path character, not something that needs escaping", () => {
    // RFC 3986 sub-delim. Recorded as an assertion rather than a comment because
    // it is the single riskiest assumption in this change.
    const url = buildUrl(NEW_ENDPOINT, TENANT_ID);
    expect(new URL(url).pathname).toContain("'");
    expect(new URL(url).pathname).not.toContain("%27");
  });
});
