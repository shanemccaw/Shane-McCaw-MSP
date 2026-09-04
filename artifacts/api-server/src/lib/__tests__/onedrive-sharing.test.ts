/**
 * onedrive-sharing.test.ts
 *
 * #680 — OneDrive overshared files (zero coverage today).
 *
 * The broad-sharing classifier itself (classifySharingPermission /
 * summarizeSiteSharing — EEEU, Everyone, anonymous link, organization link)
 * is already exhaustively covered by sharepoint-sharing.test.ts and is
 * reused here unchanged, so it is not re-tested. This file covers only what
 * is genuinely new: the OneDrive-specific normalizer wrapper, its own
 * registry key, and — the key differentiator from #357 — that the check's
 * fan-out filter is the INVERSE of #357's: personal OneDrive drives are
 * INCLUDED here and non-personal SharePoint sites are EXCLUDED, proven end
 * to end through the real fan-out executor.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

// ── Mock external dependencies (mirrors sharepoint-sharing.test.ts) ────────────

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

import { normalizeDriveSharing, ONEDRIVE_DRIVE_SHARING_NORMALIZER } from "../onedrive-sharing";
import { EEEU_LOGIN_NAME_PREFIX } from "../sharepoint-sharing";
import { executeMonitorCheck, FAN_OUT_ITEM_NORMALIZERS } from "../monitor-executor";
import { graphFetchForTenant } from "../graph";

const TENANT_GUID = "3d2e5f60-1c0a-4a55-9c1e-2b8f7a6d4e11";
const EEEU_CLAIM = `${EEEU_LOGIN_NAME_PREFIX}/${TENANT_GUID}`;

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

/** An "Anyone with the link" sharing link. */
const anonymousLinkPermission = {
  id: "anon-1",
  roles: ["write"],
  link: { scope: "anonymous", type: "edit", webUrl: "https://contoso-my.sharepoint.com/:f:/p/robin/EaBcD" },
};

/** A plain named user grant — not a finding. */
const namedUserPermission = {
  id: "2",
  roles: ["write"],
  grantedToV2: {
    user: { id: "5D33DD65C6932946", displayName: "Robin Danielsen" },
    siteUser: { id: "1", displayName: "Robin Danielsen", loginName: "Robin Danielsen" },
  },
};

// ── normalizeDriveSharing ────────────────────────────────────────────────────

const onedrive = {
  id: "contoso-my.sharepoint.com,dddddddd-0000-0000-0000-000000000004,dddddddd-0000-0000-0000-000000000004",
  name: "OneDrive – Robin",
  webUrl: "https://contoso-my.sharepoint.com/personal/robin_contoso_com",
  isPersonalSite: true,
};

describe("normalizeDriveSharing", () => {
  it("emits exactly one row per drive, delegating to the shared #357 classifier", () => {
    const rows = normalizeDriveSharing(onedrive, [eeeuPermission, anonymousLinkPermission]);
    expect(rows).toHaveLength(1);
    const row = rows[0] as Record<string, unknown>;
    expect(row.siteId).toBe(onedrive.id);
    expect(row.siteUrl).toBe(onedrive.webUrl);
    expect(row.isPersonalSite).toBe(true);
    expect(row.hasEeeu).toBe(true);
    expect(row.hasAnonymousLink).toBe(true);
    expect(row.highestSharingLevel).toBe("anonymous_link");
  });

  it("still emits a row for a drive with no broad sharing (a real denominator)", () => {
    const rows = normalizeDriveSharing(onedrive, [namedUserPermission]);
    expect(rows).toHaveLength(1);
    expect((rows[0] as Record<string, unknown>).broadAccess).toBe(false);
  });

  it("drops (rather than silently mis-attributes) a drive with no id", () => {
    expect(normalizeDriveSharing({ webUrl: "https://x" }, [eeeuPermission])).toEqual([]);
  });

  it("is registered in the executor's code-owned normalizer registry, under its own key", () => {
    expect(FAN_OUT_ITEM_NORMALIZERS[ONEDRIVE_DRIVE_SHARING_NORMALIZER]).toBe(normalizeDriveSharing);
  });
});

// ── The whole check, end to end through the fan-out executor ──────────────────

describe("onedrive:overshared-files — end to end through the fan-out executor", () => {
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

  const site = (short: string, guid: string, personal: boolean) => ({
    id: `contoso.sharepoint.com,${guid},${guid}`,
    name: short,
    webUrl: `https://contoso.sharepoint.com/sites/${short}`,
    isPersonalSite: personal,
  });

  const FINANCE_SITE = site("finance", "aaaaaaaa-0000-0000-0000-000000000001", false);
  const ROBIN_ONEDRIVE = {
    id: "contoso-my.sharepoint.com,bbbbbbbb-0000-0000-0000-000000000002,bbbbbbbb-0000-0000-0000-000000000002",
    name: "OneDrive – Robin",
    webUrl: "https://contoso-my.sharepoint.com/personal/robin_contoso_com",
    isPersonalSite: true,
  };
  const CASEY_ONEDRIVE = {
    id: "contoso-my.sharepoint.com,cccccccc-0000-0000-0000-000000000003,cccccccc-0000-0000-0000-000000000003",
    name: "OneDrive – Casey",
    webUrl: "https://contoso-my.sharepoint.com/personal/casey_contoso_com",
    isPersonalSite: true,
  };

  /** The real check row, exactly as the #680 migration seeds it. */
  const oversharedFilesCheck = {
    id: 43,
    checkId: "uuid-onedrive-overshared",
    key: "onedrive:overshared-files",
    label: "OneDrive Overshared Files",
    description: null,
    endpoint: "/sites/{itemId}/drive/root/permissions",
    method: "GET",
    requestBody: null,
    selectParams: null,
    filterParams: null,
    properties: [] as string[],
    mapping: [
      { sourceField: "broadAccess", targetField: "oversharedDriveCount", transform: "countTruthy" },
      { sourceField: "hasEeeu", targetField: "eeeuDriveCount", transform: "countTruthy" },
      { sourceField: "hasEveryone", targetField: "everyoneDriveCount", transform: "countTruthy" },
      { sourceField: "hasAnonymousLink", targetField: "anonymousLinkDriveCount", transform: "countTruthy" },
      { sourceField: "hasOrganizationLink", targetField: "organizationLinkDriveCount", transform: "countTruthy" },
      { sourceField: "siteId", targetField: "drivesScanned", transform: "count" },
      { sourceField: "highestSharingLevel", targetField: "drivesByHighestSharingLevel", transform: "groupByCount" },
    ] as Array<{ sourceField: string; targetField: string; transform?: string }>,
    severityRules: [
      { expression: "{{anonymousLinkDriveCount}} > 0", severity: "critical" },
      { expression: "{{eeeuDriveCount}} > 0", severity: "warning" },
    ] as Array<{ expression: string; severity: string; label?: string }>,
    outputSchema: null,
    engines: [] as string[],
    frequency: "daily" as const,
    requiresCustomerScript: false,
    scriptPackageId: null,
    fanOutSource: "/sites/getAllSites",
    fanOutItemIdField: "id",
    fanOutMaxItems: 400,
    fanOutItemFilter: "{{isPersonalSite}} == true",
    fanOutItemNormalizer: ONEDRIVE_DRIVE_SHARING_NORMALIZER,
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
    isCustomerFacing: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const routeTo = (path: string, s: { id: string }) => path.includes(encodeURI(s.id)) || path.includes(s.id);

  it("includes personal OneDrive drives and excludes SharePoint sites — the INVERSE of #357's filter", async () => {
    const fetched: string[] = [];
    mockFetch.mockImplementation(async (_tenantId: string, path: string) => {
      fetched.push(path);
      if (path.includes("getAllSites")) return jsonRes([FINANCE_SITE, ROBIN_ONEDRIVE, CASEY_ONEDRIVE]);
      if (routeTo(path, ROBIN_ONEDRIVE)) return jsonRes([eeeuPermission, namedUserPermission]);
      if (routeTo(path, CASEY_ONEDRIVE)) return jsonRes([anonymousLinkPermission]);
      throw new Error("unexpected path " + path);
    });

    const result = await executeMonitorCheck({
      check: oversharedFilesCheck,
      tenantId: "t1",
      triggerId: "r1",
      skipIdempotency: true,
      includeItems: true,
    });

    expect(result.status).toBe("ok");
    // Only the two OneDrive drives were fanned out to — the SharePoint site
    // never had its permissions fetched.
    expect(result.itemCount).toBe(2);
    expect(fetched.some((p) => routeTo(p, FINANCE_SITE))).toBe(false);

    const rows = (result.items ?? []) as Array<Record<string, unknown>>;
    const robin = rows.find((r) => r.siteUrl === ROBIN_ONEDRIVE.webUrl)!;
    expect(robin.hasEeeu).toBe(true);
    expect(robin.highestSharingLevel).toBe("eeeu");

    const casey = rows.find((r) => r.siteUrl === CASEY_ONEDRIVE.webUrl)!;
    expect(casey.hasAnonymousLink).toBe(true);
    expect(casey.highestSharingLevel).toBe("anonymous_link");

    const props = result.extractedProperties;
    expect(props.drivesScanned).toBe(2);
    expect(props.oversharedDriveCount).toBe(2);
    expect(props.eeeuDriveCount).toBe(1);
    expect(props.anonymousLinkDriveCount).toBe(1);
    expect(props.drivesByHighestSharingLevel).toEqual({ eeeu: 1, anonymous_link: 1 });

    // Most-severe-first: an anonymous link outranks EEEU.
    expect(result.severityMatched).toBe("critical");

    const fo = result.extractedProperties._fanOut as Record<string, unknown>;
    expect(fo.sourceItemsTotal).toBe(3);
    expect(fo.sourceItemsExcludedByFilter).toBe(1);
    expect(fo.sourceItemsEligible).toBe(2);
    expect(fo.itemNormalizer).toBe(ONEDRIVE_DRIVE_SHARING_NORMALIZER);
  });

  it("emits a clean row for a OneDrive drive with no broad sharing (a real denominator)", async () => {
    mockFetch.mockImplementation(async (_tenantId: string, path: string) => {
      if (path.includes("getAllSites")) return jsonRes([ROBIN_ONEDRIVE]);
      if (routeTo(path, ROBIN_ONEDRIVE)) return jsonRes([namedUserPermission]);
      throw new Error("unexpected path " + path);
    });

    const result = await executeMonitorCheck({
      check: oversharedFilesCheck,
      tenantId: "t1",
      triggerId: "r2",
      skipIdempotency: true,
      includeItems: true,
    });

    expect(result.status).toBe("ok");
    expect(result.extractedProperties.drivesScanned).toBe(1);
    expect(result.extractedProperties.oversharedDriveCount).toBe(0);
    expect(result.severityMatched).toBeNull();
  });

  it("fails loudly on an unknown normalizer key rather than silently flattening raw permissions", async () => {
    mockFetch.mockImplementation(async (_tenantId: string, path: string) => {
      if (path.includes("getAllSites")) return jsonRes([ROBIN_ONEDRIVE]);
      return jsonRes([eeeuPermission]);
    });

    const result = await executeMonitorCheck({
      check: { ...oversharedFilesCheck, fanOutItemNormalizer: "onedrive:typo" },
      tenantId: "t1",
      triggerId: "r3",
      skipIdempotency: true,
    });

    expect(result.status).toBe("error");
    expect(result.errorMessage).toContain("onedrive:typo");
  });
});
