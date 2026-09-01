/**
 * sharepoint-sharing.test.ts
 *
 * #357 — per-site EEEU / broad-sharing enumeration.
 *
 * Two halves:
 *   1. The classifier + summarizer, against REAL Graph payload shapes copied
 *      from the v1.0 reference (driveItem-list-permissions' own example
 *      response, the sharingLink `scope` table, and the sharePointIdentitySet
 *      resource) plus the documented EEEU claim string.
 *   2. The whole check end to end through executeMonitorCheck's fan-out path,
 *      with graphFetchForTenant mocked, proving the check produces a real
 *      per-site list — site name, URL and sharing level — and not a count.
 *
 * No live tenant exists in this environment; these are fixture-driven, which is
 * why every fixture is a documented Graph shape rather than an invented one.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

// ── Mock external dependencies (mirrors monitor-executor.test.ts) ──────────────

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
        orderBy: vi.fn().mockReturnValue({ orderBy: vi.fn().mockResolvedValue([]) }),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoNothing: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ profileId: "test-uuid" }]),
        }),
        returning: vi.fn().mockResolvedValue([{ profileId: "test-uuid" }]),
      }),
    }),
  },
  monitorChecksTable: {},
  monitoringPackagesTable: {},
  monitoringPackageChecksTable: {},
  tenantMonitorProfilesTable: {},
  tenantsTable: {},
}));

vi.mock("../graph", () => ({
  graphFetchForTenant: vi.fn(),
  ConsentRevokedError: class ConsentRevokedError extends Error {
    tenantId: string;
    constructor(tenantId: string) {
      super(`Consent revoked for ${tenantId}`);
      this.name = "ConsentRevokedError";
      this.tenantId = tenantId;
    }
  },
  LicenseGapError: class LicenseGapError extends Error {
    tenantId: string;
    feature: string;
    graphErrorCode: string | null;
    rawBody: string;
    constructor(tenantId: string, feature: string, graphErrorCode: string | null, rawBody: string) {
      super(`License gap for ${tenantId}: ${feature}`);
      this.name = "LicenseGapError";
      this.tenantId = tenantId;
      this.feature = feature;
      this.graphErrorCode = graphErrorCode;
      this.rawBody = rawBody;
    }
  },
  markTenantConsentRevoked: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../ps-execution-client", () => ({
  callPsExecution: vi.fn(),
  PsExecutionError: class PsExecutionError extends Error {
    kind: "unreachable" | "auth_failed" | "script_error";
    cmdletKey: string;
    constructor(kind: "unreachable" | "auth_failed" | "script_error", cmdletKey: string, message: string) {
      super(message);
      this.name = "PsExecutionError";
      this.kind = kind;
      this.cmdletKey = cmdletKey;
    }
  },
}));

vi.mock("../logger", () => {
  const child = vi.fn();
  const base = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child };
  child.mockReturnValue(base);
  return { logger: base };
});

import {
  classifySharingPermission,
  classifyNamedSharingGrant,
  extractUpnFromLoginName,
  isGuestLoginName,
  summarizeSiteSharing,
  normalizeSiteSharing,
  EEEU_LOGIN_NAME_PREFIX,
  EVERYONE_LOGIN_NAME_PREFIX,
  SHAREPOINT_SITE_SHARING_NORMALIZER,
} from "../sharepoint-sharing";
import { executeMonitorCheck, FAN_OUT_ITEM_NORMALIZERS } from "../monitor-executor";
import { graphFetchForTenant } from "../graph";

// ── Real Graph payload fixtures ───────────────────────────────────────────────

const TENANT_GUID = "3d2e5f60-1c0a-4a55-9c1e-2b8f7a6d4e11";

/** The documented EEEU claim: c:0-.f|rolemanager|spo-grid-all-users/{tenantId}. */
const EEEU_CLAIM = `${EEEU_LOGIN_NAME_PREFIX}/${TENANT_GUID}`;

/** "Everyone" — the strictly broader claim; includes external users. */
const EVERYONE_CLAIM = EVERYONE_LOGIN_NAME_PREFIX;

/** EEEU as it really arrives: a siteUser identity carrying the claim. */
const eeeuPermission = {
  id: "aTowIy5mfG1lbWJlcnNoaXB8ZXZlcnlvbmU",
  roles: ["read"],
  grantedToV2: {
    siteUser: {
      id: "11",
      displayName: "Everyone except external users",
      loginName: EEEU_CLAIM,
    },
  },
};

/** An "Anyone with the link" sharing link — sharingLink.scope === "anonymous". */
const anonymousLinkPermission = {
  id: "anon-1",
  roles: ["write"],
  link: {
    scope: "anonymous",
    type: "edit",
    webUrl: "https://contoso.sharepoint.com/:f:/s/finance/EaBcD",
  },
};

/** "People in your organization with the link" — scope === "organization". */
const organizationLinkPermission = {
  id: "org-1",
  roles: ["read"],
  link: {
    scope: "organization",
    type: "view",
    webUrl: "https://contoso.sharepoint.com/:f:/s/marketing/EzYxW",
  },
};

/** A specific-people link. Real, common, and deliberately NOT a finding. */
const namedPeopleLinkPermission = {
  id: "users-1",
  roles: ["write"],
  link: { scope: "users", type: "edit", webUrl: "https://contoso.sharepoint.com/:f:/s/hr/EqQ" },
};

/** An existingAccess link — grants nothing new, so never a finding. */
const existingAccessLinkPermission = {
  id: "existing-1",
  roles: ["read"],
  link: { scope: "existingAccess", type: "view", webUrl: "https://contoso.sharepoint.com/:f:/s/hr/Ezz" },
};

/** A plain named user grant, verbatim from the v1.0 reference example. */
const namedUserPermission = {
  id: "2",
  roles: ["write"],
  grantedToV2: {
    user: { id: "5D33DD65C6932946", displayName: "Robin Danielsen" },
    siteUser: { id: "1", displayName: "Robin Danielsen", loginName: "Robin Danielsen" },
  },
  inheritedFrom: { driveId: "1234567890ABD", id: "1234567890ABC!123", path: "/drive/root:/Documents" },
};

/** An ordinary SharePoint site group (Members). Broad within the site, not the tenant. */
const siteGroupPermission = {
  id: "grp-1",
  roles: ["write"],
  grantedToV2: {
    siteGroup: { id: "5", displayName: "Finance Members", loginName: "Finance Members" },
  },
};

/** Sites.Selected application grant, from the site-list-permissions example. */
const applicationPermission = {
  id: "1",
  roles: ["read"],
  grantedToIdentitiesV2: [
    { application: { id: "89ea5c94-7736-4e25-95ad-3fa95f62b66e", displayName: "Contoso Time Manager App" } },
  ],
};

/** A named INTERNAL user, with a real claims-based membership login name. */
const namedInternalUserPermission = {
  id: "int-1",
  roles: ["write"],
  grantedToV2: {
    siteUser: { id: "10", displayName: "Pat Internal", loginName: "i:0#.f|membership|pat@contoso.com" },
  },
};

/** A named B2B GUEST, with the documented `#ext#` claim shape. */
const namedGuestPermission = {
  id: "guest-1",
  roles: ["read"],
  grantedToV2: {
    siteUser: {
      id: "11",
      displayName: "Jamie Guest",
      loginName: "i:0#.f|membership|jamie_partnerco.com#ext#@contoso.onmicrosoft.com",
    },
  },
};

// ── The classifier ────────────────────────────────────────────────────────────

describe("classifySharingPermission", () => {
  it("classifies the real EEEU claim as eeeu and keeps the claim + roles", () => {
    const grant = classifySharingPermission(eeeuPermission);
    expect(grant).not.toBeNull();
    expect(grant!.kind).toBe("eeeu");
    expect(grant!.loginName).toBe(EEEU_CLAIM);
    expect(grant!.principal).toBe("Everyone except external users");
    expect(grant!.roles).toEqual(["read"]);
    expect(grant!.inherited).toBe(false);
  });

  it("matches the EEEU claim by prefix, so a different tenant GUID still classifies", () => {
    // The claim resolves to "all members of the tenant that owns the site"
    // regardless of the trailing GUID — older tenants carry a different one.
    const other = {
      ...eeeuPermission,
      grantedToV2: {
        siteUser: {
          id: "11",
          displayName: "Everyone except external users",
          loginName: `${EEEU_LOGIN_NAME_PREFIX}/00000000-1111-2222-3333-444444444444`,
        },
      },
    };
    expect(classifySharingPermission(other)!.kind).toBe("eeeu");
  });

  it('classifies the "Everyone" claim (includes external users) as everyone, not eeeu', () => {
    const permission = {
      id: "ev-1",
      roles: ["read"],
      grantedToV2: { siteUser: { id: "4", displayName: "Everyone", loginName: EVERYONE_CLAIM } },
    };
    const grant = classifySharingPermission(permission)!;
    expect(grant.kind).toBe("everyone");
    expect(grant.loginName).toBe(EVERYONE_CLAIM);
  });

  it("falls back to the display name when Graph omits loginName", () => {
    const permission = {
      id: "dn-1",
      roles: ["read"],
      grantedToV2: { siteGroup: { id: "9", displayName: "Everyone except external users" } },
    };
    expect(classifySharingPermission(permission)!.kind).toBe("eeeu");
  });

  it("classifies anonymous and organization sharing links off link.scope", () => {
    const anon = classifySharingPermission(anonymousLinkPermission)!;
    expect(anon.kind).toBe("anonymous_link");
    expect(anon.roles).toEqual(["write"]);
    expect(anon.loginName).toBeNull();

    expect(classifySharingPermission(organizationLinkPermission)!.kind).toBe("organization_link");
  });

  it("does NOT classify users / existingAccess links, named users, site groups or app grants", () => {
    expect(classifySharingPermission(namedPeopleLinkPermission)).toBeNull();
    expect(classifySharingPermission(existingAccessLinkPermission)).toBeNull();
    expect(classifySharingPermission(namedUserPermission)).toBeNull();
    expect(classifySharingPermission(siteGroupPermission)).toBeNull();
    expect(classifySharingPermission(applicationPermission)).toBeNull();
  });

  it("reads grantedToIdentitiesV2 (multi-identity form) as well as grantedToV2", () => {
    const permission = {
      id: "multi-1",
      roles: ["read"],
      grantedToIdentitiesV2: [
        { user: { id: "u1", displayName: "Robin Danielsen" } },
        { siteUser: { id: "11", displayName: "Everyone except external users", loginName: EEEU_CLAIM } },
      ],
    };
    expect(classifySharingPermission(permission)!.kind).toBe("eeeu");
  });

  it("records inheritance from the inheritedFrom facet", () => {
    const inherited = { ...eeeuPermission, inheritedFrom: { driveId: "d1", id: "i1", path: "/drive/root:" } };
    expect(classifySharingPermission(inherited)!.inherited).toBe(true);
  });

  it("returns null for junk rather than throwing", () => {
    expect(classifySharingPermission(null)).toBeNull();
    expect(classifySharingPermission("nope")).toBeNull();
    expect(classifySharingPermission([])).toBeNull();
    expect(classifySharingPermission({})).toBeNull();
  });
});

// ── Named-identity resolution (#1286) ─────────────────────────────────────────

describe("extractUpnFromLoginName", () => {
  it("returns an internal member's claim as-is", () => {
    expect(extractUpnFromLoginName("i:0#.f|membership|pat@contoso.com")).toBe("pat@contoso.com");
  });

  it("decodes a B2B guest's escaped home email ahead of #ext#", () => {
    expect(
      extractUpnFromLoginName("i:0#.f|membership|jamie_partnerco.com#ext#@contoso.onmicrosoft.com"),
    ).toBe("jamie@partnerco.com");
  });

  it("returns the guest segment as-is when it is already a plain email", () => {
    expect(
      extractUpnFromLoginName("i:0#.f|membership|jamie@partnerco.com#ext#@contoso.onmicrosoft.com"),
    ).toBe("jamie@partnerco.com");
  });

  it("returns null rather than guessing when the shape doesn't decode", () => {
    expect(extractUpnFromLoginName("i:0#.f|membership|nounderscoreoremail#ext#@contoso.onmicrosoft.com")).toBeNull();
    expect(extractUpnFromLoginName("i:0#.f|membership|not-an-email")).toBeNull();
  });

  it("returns null for a non-membership claim (a group, an app, or a display name)", () => {
    expect(extractUpnFromLoginName("Robin Danielsen")).toBeNull();
    expect(extractUpnFromLoginName(EEEU_LOGIN_NAME_PREFIX + "/tenant-guid")).toBeNull();
    expect(extractUpnFromLoginName(null)).toBeNull();
  });
});

describe("isGuestLoginName", () => {
  it("is true only for the #ext# marker on a membership claim", () => {
    expect(isGuestLoginName("i:0#.f|membership|jamie_partnerco.com#ext#@contoso.onmicrosoft.com")).toBe(true);
    expect(isGuestLoginName("i:0#.f|membership|pat@contoso.com")).toBe(false);
    expect(isGuestLoginName(null)).toBe(false);
  });
});

describe("classifyNamedSharingGrant", () => {
  it("classifies an internal named user, with a real resolved UPN", () => {
    const grant = classifyNamedSharingGrant(namedInternalUserPermission);
    expect(grant).not.toBeNull();
    expect(grant!.kind).toBe("user");
    expect(grant!.principal).toBe("Pat Internal");
    expect(grant!.principalUpn).toBe("pat@contoso.com");
    expect(grant!.roles).toEqual(["write"]);
  });

  it("classifies a B2B guest, with the decoded home UPN", () => {
    const grant = classifyNamedSharingGrant(namedGuestPermission);
    expect(grant).not.toBeNull();
    expect(grant!.kind).toBe("guest");
    expect(grant!.principal).toBe("Jamie Guest");
    expect(grant!.principalUpn).toBe("jamie@partnerco.com");
  });

  it("falls back to displayName with a null UPN when the reference shape has no real claim", () => {
    // namedUserPermission's own loginName is literally the display name, not a
    // claim — the real v1.0 reference example's own (unrealistic) shape.
    const grant = classifyNamedSharingGrant(namedUserPermission);
    expect(grant).not.toBeNull();
    expect(grant!.kind).toBe("user");
    expect(grant!.principal).toBe("Robin Danielsen");
    expect(grant!.principalUpn).toBeNull();
  });

  it("does not classify a group as a named person", () => {
    expect(classifyNamedSharingGrant(siteGroupPermission)).toBeNull();
  });

  it("does not classify a link, an app grant, or the two broad principals", () => {
    expect(classifyNamedSharingGrant(namedPeopleLinkPermission)).toBeNull();
    expect(classifyNamedSharingGrant(applicationPermission)).toBeNull();
    expect(classifyNamedSharingGrant(eeeuPermission)).toBeNull();
  });
});

// ── The per-site summary ──────────────────────────────────────────────────────

const financeSite = {
  id: "contoso.sharepoint.com,d9ecf079-9b13-4376-ac5d-f242dda55626,746dbcc1-fa2b-4120-b657-2670bae5bb6f",
  name: "Finance",
  displayName: "Finance & Payroll",
  webUrl: "https://contoso.sharepoint.com/sites/finance",
  isPersonalSite: false,
};

describe("summarizeSiteSharing", () => {
  it("carries the site's REAL name and URL onto the row (the whole point of #357)", () => {
    const summary = summarizeSiteSharing(financeSite, [eeeuPermission]);
    expect(summary.siteId).toBe(financeSite.id);
    expect(summary.siteName).toBe("Finance & Payroll");
    expect(summary.siteUrl).toBe("https://contoso.sharepoint.com/sites/finance");
    expect(summary.isPersonalSite).toBe(false);
  });

  it("falls back to `name` when the payload has no displayName (what getAllSites returns)", () => {
    const { displayName: _dropped, ...noDisplayName } = financeSite;
    expect(summarizeSiteSharing(noDisplayName, []).siteName).toBe("Finance");
  });

  it("counts each kind separately and reports every level present", () => {
    const summary = summarizeSiteSharing(financeSite, [
      eeeuPermission,
      anonymousLinkPermission,
      organizationLinkPermission,
      namedUserPermission,
      namedPeopleLinkPermission,
    ]);

    expect(summary.permissionCount).toBe(5);
    expect(summary.broadAccess).toBe(true);
    expect(summary.eeeuGrantCount).toBe(1);
    expect(summary.anonymousLinkCount).toBe(1);
    expect(summary.organizationLinkCount).toBe(1);
    expect(summary.everyoneGrantCount).toBe(0);
    // Ordered most→least severe.
    expect(summary.sharingLevels).toEqual(["anonymous_link", "eeeu", "organization_link"]);
    expect(summary.highestSharingLevel).toBe("anonymous_link");
    // Every broad grant is kept whole so a document can name the principal.
    expect(summary.grants).toHaveLength(3);
    expect(summary.grants.map((g) => g.principal)).toContain("Everyone except external users");
  });

  it("ranks eeeu above organization_link when both are present", () => {
    const summary = summarizeSiteSharing(financeSite, [organizationLinkPermission, eeeuPermission]);
    expect(summary.highestSharingLevel).toBe("eeeu");
  });

  it("emits a clean row for a site with no broad sharing (a real denominator)", () => {
    const summary = summarizeSiteSharing(financeSite, [namedUserPermission, siteGroupPermission]);
    expect(summary.permissionCount).toBe(2);
    expect(summary.broadAccess).toBe(false);
    expect(summary.hasEeeu).toBe(false);
    expect(summary.highestSharingLevel).toBeNull();
    expect(summary.sharingLevels).toEqual([]);
    expect(summary.grants).toEqual([]);
  });

  it("resolves named grants alongside broad ones, off the same permission list (#1286)", () => {
    const summary = summarizeSiteSharing(financeSite, [
      eeeuPermission,
      namedInternalUserPermission,
      namedGuestPermission,
      siteGroupPermission,
    ]);

    // Broad-access flags are unaffected by the named grants mixed in.
    expect(summary.broadAccess).toBe(true);
    expect(summary.grants).toHaveLength(1);

    expect(summary.namedGrants).toHaveLength(2);
    const guest = summary.namedGrants.find((g) => g.kind === "guest");
    const user = summary.namedGrants.find((g) => g.kind === "user");
    expect(guest?.principalUpn).toBe("jamie@partnerco.com");
    expect(user?.principalUpn).toBe("pat@contoso.com");
    // The SharePoint group grant names a group, not a person — excluded.
    expect(summary.namedGrants.some((g) => g.principal === "Finance Members")).toBe(false);
  });

  it("emits no named grants for a site with only broad/group sharing", () => {
    const summary = summarizeSiteSharing(financeSite, [eeeuPermission, siteGroupPermission]);
    expect(summary.namedGrants).toEqual([]);
  });

  it("emits a clean row when a site returns no permissions at all", () => {
    const summary = summarizeSiteSharing(financeSite, []);
    expect(summary.permissionCount).toBe(0);
    expect(summary.broadAccess).toBe(false);
  });
});

describe("normalizeSiteSharing", () => {
  it("emits exactly one row per site", () => {
    expect(normalizeSiteSharing(financeSite, [eeeuPermission, anonymousLinkPermission])).toHaveLength(1);
    expect(normalizeSiteSharing(financeSite, [])).toHaveLength(1);
  });

  it("drops (rather than silently mis-attributes) a site with no id", () => {
    expect(normalizeSiteSharing({ webUrl: "https://x" }, [eeeuPermission])).toEqual([]);
  });

  it("is registered in the executor's code-owned normalizer registry", () => {
    expect(FAN_OUT_ITEM_NORMALIZERS[SHAREPOINT_SITE_SHARING_NORMALIZER]).toBe(normalizeSiteSharing);
  });
});

// ── The whole check, end to end through the fan-out executor ──────────────────

describe("compliance:eeeu-site-sharing — end to end through the fan-out executor", () => {
  const mockFetch = graphFetchForTenant as Mock;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const jsonRes = (value: unknown[], nextLink?: string) => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(nextLink ? { value, "@odata.nextLink": nextLink } : { value }),
    headers: { get: (h: string) => (h === "content-type" ? "application/json" : null) },
  });
  const errRes = (status: number) => ({
    ok: false,
    status,
    text: async () => "error body " + status,
    headers: { get: () => null },
  });

  const site = (short: string, guid: string, personal = false) => ({
    id: `contoso.sharepoint.com,${guid},${guid}`,
    name: short,
    webUrl: `https://contoso.sharepoint.com/sites/${short}`,
    isPersonalSite: personal,
  });

  const FINANCE = site("finance", "aaaaaaaa-0000-0000-0000-000000000001");
  const MARKETING = site("marketing", "bbbbbbbb-0000-0000-0000-000000000002");
  const CLEAN = site("intranet", "cccccccc-0000-0000-0000-000000000003");
  const ONEDRIVE = {
    id: "contoso-my.sharepoint.com,dddddddd-0000-0000-0000-000000000004,dddddddd-0000-0000-0000-000000000004",
    name: "OneDrive – Robin",
    webUrl: "https://contoso-my.sharepoint.com/personal/robin_contoso_com",
    isPersonalSite: true,
  };

  /** The real check row, exactly as the #357 migration seeds it. */
  const eeeuCheck = {
    id: 42,
    checkId: "uuid-eeeu",
    key: "compliance:eeeu-site-sharing",
    label: "Per-Site Broad Sharing (EEEU)",
    description: null,
    endpoint: "/sites/{itemId}/drive/root/permissions",
    method: "GET",
    requestBody: null,
    selectParams: null,
    filterParams: null,
    properties: [] as string[],
    mapping: [
      { sourceField: "broadAccess", targetField: "oversharedSiteCount", transform: "countTruthy" },
      { sourceField: "hasEeeu", targetField: "eeeuSiteCount", transform: "countTruthy" },
      { sourceField: "hasEveryone", targetField: "everyoneSiteCount", transform: "countTruthy" },
      { sourceField: "hasAnonymousLink", targetField: "anonymousLinkSiteCount", transform: "countTruthy" },
      { sourceField: "hasOrganizationLink", targetField: "organizationLinkSiteCount", transform: "countTruthy" },
      { sourceField: "siteId", targetField: "sitesScanned", transform: "count" },
      { sourceField: "highestSharingLevel", targetField: "sitesByHighestSharingLevel", transform: "groupByCount" },
    ] as Array<{ sourceField: string; targetField: string; transform?: string }>,
    severityRules: [
      { expression: "{{anonymousLinkSiteCount}} > 0", severity: "critical" },
      { expression: "{{eeeuSiteCount}} > 0", severity: "warning" },
    ] as Array<{ expression: string; severity: string; label?: string }>,
    outputSchema: null,
    engines: [] as string[],
    frequency: "daily" as const,
    requiresCustomerScript: false,
    scriptPackageId: null,
    fanOutSource: "/sites/getAllSites",
    fanOutItemIdField: "id",
    fanOutMaxItems: 400,
    fanOutItemFilter: "{{isPersonalSite}} != true",
    fanOutItemNormalizer: SHAREPOINT_SITE_SHARING_NORMALIZER,
    executorType: "graph" as const,
    psCmdletKey: null,
    psParams: null,
    spOperation: null,
    ppOperation: null,
    armOperation: null,
    schemaVersion: 1,
    status: "active" as const,
    createdByAdminId: null,
    updatedByAdminId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const routeTo = (path: string, s: { id: string }) => path.includes(encodeURI(s.id)) || path.includes(s.id);

  it("returns a real per-site list — name, URL and sharing level — not just a count", async () => {
    mockFetch.mockImplementation(async (_tenantId: string, path: string) => {
      if (path.includes("getAllSites")) return jsonRes([FINANCE, MARKETING, CLEAN]);
      if (routeTo(path, FINANCE)) return jsonRes([eeeuPermission, namedUserPermission]);
      if (routeTo(path, MARKETING)) return jsonRes([anonymousLinkPermission, organizationLinkPermission]);
      if (routeTo(path, CLEAN)) return jsonRes([namedUserPermission, siteGroupPermission]);
      throw new Error("unexpected path " + path);
    });

    const result = await executeMonitorCheck({
      check: eeeuCheck,
      tenantId: "t1",
      triggerId: "r1",
      skipIdempotency: true,
      includeItems: true,
    });

    expect(result.status).toBe("ok");
    // One row per SITE — not one row per permission object.
    expect(result.itemCount).toBe(3);

    const rows = (result.items ?? []) as Array<Record<string, unknown>>;
    const finance = rows.find((r) => r.siteUrl === FINANCE.webUrl)!;
    expect(finance.siteName).toBe("finance");
    expect(finance.hasEeeu).toBe(true);
    expect(finance.highestSharingLevel).toBe("eeeu");
    // The grant itself survives, so a document can name the principal.
    expect((finance.grants as Array<Record<string, unknown>>)[0].loginName).toBe(EEEU_CLAIM);

    const marketing = rows.find((r) => r.siteUrl === MARKETING.webUrl)!;
    expect(marketing.hasAnonymousLink).toBe(true);
    expect(marketing.hasOrganizationLink).toBe(true);
    expect(marketing.highestSharingLevel).toBe("anonymous_link");

    const clean = rows.find((r) => r.siteUrl === CLEAN.webUrl)!;
    expect(clean.broadAccess).toBe(false);
    expect(clean.highestSharingLevel).toBeNull();

    // ...and the aggregate counts SITES, derived from the same rows.
    const props = result.extractedProperties;
    expect(props.sitesScanned).toBe(3);
    expect(props.oversharedSiteCount).toBe(2);
    expect(props.eeeuSiteCount).toBe(1);
    expect(props.anonymousLinkSiteCount).toBe(1);
    expect(props.organizationLinkSiteCount).toBe(1);
    expect(props.everyoneSiteCount).toBe(0);
    expect(props.sitesByHighestSharingLevel).toEqual({ eeeu: 1, anonymous_link: 1 });

    // Most-severe-first rule ordering: an anonymous link outranks EEEU.
    expect(result.severityMatched).toBe("critical");
  });

  it("excludes personal OneDrive sites via the fan-out item filter, and never fetches them", async () => {
    const fetched: string[] = [];
    mockFetch.mockImplementation(async (_tenantId: string, path: string) => {
      fetched.push(path);
      if (path.includes("getAllSites")) return jsonRes([FINANCE, ONEDRIVE, CLEAN]);
      if (routeTo(path, FINANCE)) return jsonRes([eeeuPermission]);
      if (routeTo(path, CLEAN)) return jsonRes([]);
      throw new Error("unexpected path " + path);
    });

    const result = await executeMonitorCheck({
      check: eeeuCheck,
      tenantId: "t1",
      triggerId: "r2",
      skipIdempotency: true,
      includeItems: true,
    });

    expect(result.status).toBe("ok");
    expect(result.itemCount).toBe(2);
    expect(fetched.some((p) => p.includes("contoso-my.sharepoint.com"))).toBe(false);

    const fo = result.extractedProperties._fanOut as Record<string, unknown>;
    expect(fo.sourceItemsTotal).toBe(3);
    expect(fo.sourceItemsExcludedByFilter).toBe(1);
    expect(fo.sourceItemsEligible).toBe(2);
    expect(fo.sourceItemsScanned).toBe(2);
    expect(fo.itemNormalizer).toBe(SHAREPOINT_SITE_SHARING_NORMALIZER);
  });

  it("reports partial coverage honestly when a site's permissions can't be read", async () => {
    mockFetch.mockImplementation(async (_tenantId: string, path: string) => {
      if (path.includes("getAllSites")) return jsonRes([FINANCE, MARKETING]);
      if (routeTo(path, FINANCE)) return jsonRes([eeeuPermission]);
      if (routeTo(path, MARKETING)) return errRes(404); // no default document library
      throw new Error("unexpected path " + path);
    });

    const result = await executeMonitorCheck({
      check: eeeuCheck,
      tenantId: "t1",
      triggerId: "r3",
      skipIdempotency: true,
    });

    // Real data collected, coverage incomplete — never a clean "ok".
    expect(result.status).toBe("partial");
    expect(result.extractedProperties.eeeuSiteCount).toBe(1);
    expect(result.extractedProperties.sitesScanned).toBe(1);
    const fo = result.extractedProperties._fanOut as Record<string, unknown>;
    expect(fo.sourceItemsSucceeded).toBe(1);
    expect(fo.sourceItemsFailed).toBe(1);
  });

  it("paginates the site enumeration (a tenant's sites do not fit one page)", async () => {
    mockFetch.mockImplementation(async (_tenantId: string, path: string) => {
      if (path.includes("getAllSites") && !path.includes("skiptoken")) {
        return jsonRes([FINANCE], "https://graph.microsoft.com/v1.0/sites/getAllSites?$skiptoken=abc");
      }
      if (path.includes("skiptoken")) return jsonRes([MARKETING]);
      if (routeTo(path, FINANCE)) return jsonRes([eeeuPermission]);
      if (routeTo(path, MARKETING)) return jsonRes([anonymousLinkPermission]);
      throw new Error("unexpected path " + path);
    });

    const result = await executeMonitorCheck({
      check: eeeuCheck,
      tenantId: "t1",
      triggerId: "r4",
      skipIdempotency: true,
    });

    const fo = result.extractedProperties._fanOut as Record<string, unknown>;
    expect(fo.sourceItemsTotal).toBe(2);
    expect(result.extractedProperties.sitesScanned).toBe(2);
    expect(result.extractedProperties.oversharedSiteCount).toBe(2);
  });

  it("fails loudly on an unknown normalizer key rather than silently flattening raw permissions", async () => {
    mockFetch.mockImplementation(async (_tenantId: string, path: string) => {
      if (path.includes("getAllSites")) return jsonRes([FINANCE]);
      return jsonRes([eeeuPermission]);
    });

    const result = await executeMonitorCheck({
      check: { ...eeeuCheck, fanOutItemNormalizer: "sharepoint:typo" },
      tenantId: "t1",
      triggerId: "r5",
      skipIdempotency: true,
    });

    expect(result.status).toBe("error");
    expect(result.errorMessage).toContain("sharepoint:typo");
  });

  it("leaves a fan-out check with no normalizer flattening raw results, unchanged", async () => {
    // The pre-existing contract: NULL normalizer -> the raw per-item objects.
    mockFetch.mockImplementation(async (_tenantId: string, path: string) => {
      if (path.includes("getAllSites")) return jsonRes([FINANCE, MARKETING]);
      return jsonRes([eeeuPermission, anonymousLinkPermission]);
    });

    const result = await executeMonitorCheck({
      check: { ...eeeuCheck, fanOutItemNormalizer: null, fanOutItemFilter: null, mapping: [] },
      tenantId: "t1",
      triggerId: "r6",
      skipIdempotency: true,
      includeItems: true,
    });

    // 2 sites x 2 permissions, flattened — the old behaviour, bit for bit.
    expect(result.itemCount).toBe(4);
    expect((result.items ?? [])[0]).toEqual(eeeuPermission);
    const fo = result.extractedProperties._fanOut as Record<string, unknown>;
    expect(fo.sourceItemsExcludedByFilter).toBe(0);
    expect(fo.sourceItemsEligible).toBe(2);
    expect(fo.itemNormalizer).toBeNull();
  });
});
