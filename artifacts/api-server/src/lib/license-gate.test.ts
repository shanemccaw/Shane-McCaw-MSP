import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Git #3947 — proactive license-gate mechanism. `graphFetchForTenant` is
 * mocked at the module boundary; `ConsentRevokedError` / `LicenseGapError` come
 * from that same mocked module (see the factory below), so the `instanceof`
 * branches exercise real behavior.
 */

const mockGraphFetchForTenant = vi.fn();

// #4512 — a self-contained factory, not `{ ...importActual("./graph.ts") }`.
// With the spread, license-gate.ts received the REAL graphFetchForTenant and
// every test here failed against the real Graph client ("MT_APP_CLIENT_ID /
// MT_APP_CLIENT_SECRET not configured"). The error classes are re-declared with
// graph.ts's constructor signatures; this file imports them from the same mocked
// module, so the `instanceof` branches still see one class identity.
vi.mock("./graph.ts", () => ({
  graphFetchForTenant: (...args: unknown[]) => mockGraphFetchForTenant(...args),
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
    httpStatus: number | null;
    constructor(tenantId: string, feature: string, graphErrorCode: string | null, rawBody: string, httpStatus: number | null = null) {
      super(`License gap for ${tenantId}: ${feature}`);
      this.name = "LicenseGapError";
      this.tenantId = tenantId;
      this.feature = feature;
      this.graphErrorCode = graphErrorCode;
      this.rawBody = rawBody;
      this.httpStatus = httpStatus;
    }
  },
}));

// The real logger loads @workspace/db, which refuses to import without DATABASE_URL.
vi.mock("./logger.ts", () => {
  const child = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { logger: { child: () => child } };
});

import { ConsentRevokedError, LicenseGapError } from "./graph.ts";
import {
  getProvisionedServicePlanNamesForTenant,
  tenantHasRequiredLicense,
  describeRequiredLicense,
  licenseFeatureName,
} from "./license-gate.ts";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

beforeEach(() => {
  mockGraphFetchForTenant.mockReset();
});

describe("getProvisionedServicePlanNamesForTenant (#4512)", () => {
  it("returns provisioned plans from usable SKUs, including P1 bundled inside SPE_E3", async () => {
    mockGraphFetchForTenant.mockResolvedValueOnce(
      jsonResponse({
        value: [
          {
            skuPartNumber: "SPE_E3",
            capabilityStatus: "Enabled",
            servicePlans: [
              { servicePlanName: "AAD_PREMIUM", provisioningStatus: "Success" },
              { servicePlanName: "INTUNE_A", provisioningStatus: "Disabled" },
            ],
          },
          { skuPartNumber: "EMS", capabilityStatus: "Warning", servicePlans: [{ servicePlanName: "RMS_S_PREMIUM", provisioningStatus: "Success" }] },
          { skuPartNumber: "AAD_PREMIUM_P2", capabilityStatus: "Suspended", servicePlans: [{ servicePlanName: "AAD_PREMIUM_P2", provisioningStatus: "Success" }] },
        ],
      }),
    );

    const result = await getProvisionedServicePlanNamesForTenant("tenant-plans-a");
    expect(result.error).toBeNull();
    expect(result.servicePlanNames).toEqual(new Set(["AAD_PREMIUM", "RMS_S_PREMIUM"]));
    expect(tenantHasRequiredLicense(["AAD_PREMIUM", "AAD_PREMIUM_P2"], result.servicePlanNames)).toBe(true);
    expect(mockGraphFetchForTenant).toHaveBeenCalledWith("tenant-plans-a", "/subscribedSkus?$select=capabilityStatus,servicePlans");
  });

  // #4535 — the gate's own regression. The removed skuPartNumber test used a
  // tenant holding SPE_E3 AND a standalone AAD_PREMIUM SKU, so it passed while
  // every bundle-only tenant was blocked. These tenants hold P1/P2 ONLY inside a
  // bundle: no skuPartNumber matches the catalog's ["AAD_PREMIUM","AAD_PREMIUM_P2"].
  it.each([
    ["SPE_E5", ["AAD_PREMIUM", "AAD_PREMIUM_P2", "EXCHANGE_S_ENTERPRISE", "INTUNE_A"]],
    ["SPE_E3", ["AAD_PREMIUM", "EXCHANGE_S_ENTERPRISE", "INTUNE_A"]],
    ["SPB", ["AAD_PREMIUM", "EXCHANGE_S_STANDARD", "INTUNE_A"]],
    ["EMS", ["AAD_PREMIUM", "INTUNE_A", "RMS_S_PREMIUM"]],
  ])("licenses a tenant holding Entra ID P1 only through the %s bundle", async (skuPartNumber, planNames) => {
    mockGraphFetchForTenant.mockResolvedValueOnce(
      jsonResponse({
        value: [
          {
            skuPartNumber,
            capabilityStatus: "Enabled",
            servicePlans: planNames.map((servicePlanName) => ({ servicePlanName, provisioningStatus: "Success" })),
          },
        ],
      }),
    );

    const result = await getProvisionedServicePlanNamesForTenant(`tenant-bundle-${skuPartNumber}`);
    expect(result.error).toBeNull();
    expect(result.servicePlanNames.has(skuPartNumber)).toBe(false);
    expect(tenantHasRequiredLicense(["AAD_PREMIUM", "AAD_PREMIUM_P2"], result.servicePlanNames)).toBe(true);
  });

  it("does not license a tenant whose bundle carries no provisioned P1 plan (the testbed's real Office 365 E3)", async () => {
    // tenant-scans/2026-09-17-testbed-full-scan.json: ENTERPRISEPACK ships no
    // AAD_PREMIUM plan at all, and a plan switched off on a bundle does not count.
    mockGraphFetchForTenant.mockResolvedValueOnce(
      jsonResponse({
        value: [
          {
            skuPartNumber: "ENTERPRISEPACK",
            capabilityStatus: "Enabled",
            servicePlans: [
              { servicePlanName: "EXCHANGE_S_ENTERPRISE", provisioningStatus: "Success" },
              { servicePlanName: "INTUNE_O365", provisioningStatus: "PendingActivation" },
            ],
          },
          { skuPartNumber: "SPB", capabilityStatus: "Enabled", servicePlans: [{ servicePlanName: "AAD_PREMIUM", provisioningStatus: "Disabled" }] },
        ],
      }),
    );

    const result = await getProvisionedServicePlanNamesForTenant("tenant-no-p1");
    expect(result.error).toBeNull();
    expect(tenantHasRequiredLicense(["AAD_PREMIUM", "AAD_PREMIUM_P2"], result.servicePlanNames)).toBe(false);
  });

  it("caches per tenant for the TTL window — a second call within it does not re-hit Graph", async () => {
    mockGraphFetchForTenant.mockResolvedValueOnce(
      jsonResponse({
        value: [{ skuPartNumber: "SPE_E5", capabilityStatus: "Enabled", servicePlans: [{ servicePlanName: "AAD_PREMIUM_P2", provisioningStatus: "Success" }] }],
      }),
    );

    const first = await getProvisionedServicePlanNamesForTenant("tenant-plans-cache");
    const second = await getProvisionedServicePlanNamesForTenant("tenant-plans-cache");
    expect(first.servicePlanNames).toEqual(second.servicePlanNames);
    expect(mockGraphFetchForTenant).toHaveBeenCalledTimes(1);
  });

  it("reports an error, not an empty estate, for a non-OK or paged response", async () => {
    mockGraphFetchForTenant.mockResolvedValueOnce(new Response("forbidden", { status: 403 }));
    const denied = await getProvisionedServicePlanNamesForTenant("tenant-plans-b");
    expect(denied.error).toContain("403");

    mockGraphFetchForTenant.mockResolvedValueOnce(jsonResponse({ value: [], "@odata.nextLink": "https://graph.microsoft.com/v1.0/subscribedSkus?$skiptoken=x" }));
    const paged = await getProvisionedServicePlanNamesForTenant("tenant-plans-c");
    expect(paged.error).toMatch(/paged/);
  });

  it("surfaces a ConsentRevokedError as an honest error, not a thrown exception", async () => {
    mockGraphFetchForTenant.mockRejectedValueOnce(new ConsentRevokedError("tenant-plans-d"));
    const result = await getProvisionedServicePlanNamesForTenant("tenant-plans-d");
    expect(result.servicePlanNames.size).toBe(0);
    expect(result.error).toMatch(/consent/i);
  });

  it("surfaces a LicenseGapError as an honest error, not a thrown exception", async () => {
    mockGraphFetchForTenant.mockRejectedValueOnce(
      new LicenseGapError("tenant-plans-e", "Microsoft Entra ID Premium (P1/P2)", "Authorization_RequestDenied", "{}", 403),
    );
    const result = await getProvisionedServicePlanNamesForTenant("tenant-plans-e");
    expect(result.servicePlanNames.size).toBe(0);
    expect(result.error).toContain("Microsoft Entra ID Premium (P1/P2)");
  });
});

describe("tenantHasRequiredLicense", () => {
  it("passes when no requirement is set (null or empty)", () => {
    expect(tenantHasRequiredLicense(null, new Set())).toBe(true);
    expect(tenantHasRequiredLicense([], new Set(["EXCHANGE_S_ENTERPRISE"]))).toBe(true);
  });

  it("passes when ANY ONE of the required plans is present", () => {
    expect(tenantHasRequiredLicense(["AAD_PREMIUM", "AAD_PREMIUM_P2"], new Set(["AAD_PREMIUM_P2"]))).toBe(true);
  });

  it("fails when none of the required plans are present", () => {
    expect(tenantHasRequiredLicense(["AAD_PREMIUM", "AAD_PREMIUM_P2"], new Set(["EXCHANGE_S_ENTERPRISE", "INTUNE_O365"]))).toBe(false);
  });

  // #4556 — AND-of-OR via a nested string[][]: every group must itself be
  // satisfied. identity:ca-device-compliance's real shape: (P1 or P2) AND Intune.
  describe("grouped (AND-of-OR) requirement", () => {
    const REQUIRES_P1_OR_P2_AND_INTUNE = [["AAD_PREMIUM", "AAD_PREMIUM_P2"], ["INTUNE_A"]];

    it("passes when every group has at least one plan present", () => {
      expect(tenantHasRequiredLicense(REQUIRES_P1_OR_P2_AND_INTUNE, new Set(["AAD_PREMIUM_P2", "INTUNE_A"]))).toBe(true);
    });

    it("fails when one group's plans are all missing — P1 present but no Intune", () => {
      expect(tenantHasRequiredLicense(REQUIRES_P1_OR_P2_AND_INTUNE, new Set(["AAD_PREMIUM"]))).toBe(false);
    });

    it("fails when the other group is missing — Intune present but no P1/P2", () => {
      expect(tenantHasRequiredLicense(REQUIRES_P1_OR_P2_AND_INTUNE, new Set(["INTUNE_A"]))).toBe(false);
    });

    it("fails when nothing is present", () => {
      expect(tenantHasRequiredLicense(REQUIRES_P1_OR_P2_AND_INTUNE, new Set(["EXCHANGE_S_ENTERPRISE"]))).toBe(false);
    });
  });
});

describe("describeRequiredLicense", () => {
  it("produces the real testbed-evidence phrasing for the CA requirement", () => {
    expect(describeRequiredLicense(["AAD_PREMIUM", "AAD_PREMIUM_P2"])).toBe("Requires Microsoft Entra ID P1 or P2");
  });

  it("falls back to the raw SKU string for an unrecognized part number rather than inventing a label", () => {
    expect(describeRequiredLicense(["SOME_FUTURE_SKU"])).toBe("Requires SOME_FUTURE_SKU");
  });

  it("licenseFeatureName is the same text without the verb", () => {
    expect(licenseFeatureName(["AAD_PREMIUM", "AAD_PREMIUM_P2"])).toBe("Microsoft Entra ID P1 or P2");
    expect(licenseFeatureName(["SOME_FUTURE_SKU"])).toBe("SOME_FUTURE_SKU");
  });

  // #4556
  it("joins grouped (AND-of-OR) requirements with 'and', each group with 'or'", () => {
    expect(licenseFeatureName([["AAD_PREMIUM", "AAD_PREMIUM_P2"], ["INTUNE_A"]])).toBe(
      "Microsoft Entra ID P1 or P2 and Microsoft Intune",
    );
    expect(describeRequiredLicense([["AAD_PREMIUM", "AAD_PREMIUM_P2"], ["INTUNE_A"]])).toBe(
      "Requires Microsoft Entra ID P1 or P2 and Microsoft Intune",
    );
  });

  it("falls back to a raw joined string for an unrecognized SKU inside a group", () => {
    expect(licenseFeatureName([["AAD_PREMIUM"], ["SOME_FUTURE_SKU"]])).toBe("Microsoft Entra ID P1 and SOME_FUTURE_SKU");
  });
});
