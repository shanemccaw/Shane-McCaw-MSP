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
  getSubscribedSkuPartNumbersForTenant,
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

describe("getSubscribedSkuPartNumbersForTenant", () => {
  it("returns the tenant's Enabled skuPartNumbers from a real /subscribedSkus shape", async () => {
    mockGraphFetchForTenant.mockResolvedValueOnce(
      jsonResponse({
        value: [
          { skuPartNumber: "SPE_E3", capabilityStatus: "Enabled" },
          { skuPartNumber: "AAD_PREMIUM", capabilityStatus: "Enabled" },
          { skuPartNumber: "FLOW_FREE", capabilityStatus: "Suspended" },
        ],
      }),
    );

    const result = await getSubscribedSkuPartNumbersForTenant("tenant-a");
    expect(result.error).toBeNull();
    expect(result.skuPartNumbers).toEqual(new Set(["SPE_E3", "AAD_PREMIUM"]));
    expect(mockGraphFetchForTenant).toHaveBeenCalledWith("tenant-a", "/subscribedSkus?$select=skuPartNumber,capabilityStatus");
  });

  it("caches per tenant for the TTL window — a second call within it does not re-hit Graph", async () => {
    mockGraphFetchForTenant.mockResolvedValueOnce(
      jsonResponse({ value: [{ skuPartNumber: "AAD_PREMIUM_P2", capabilityStatus: "Enabled" }] }),
    );

    const first = await getSubscribedSkuPartNumbersForTenant("tenant-cache");
    const second = await getSubscribedSkuPartNumbersForTenant("tenant-cache");
    expect(first.skuPartNumbers).toEqual(second.skuPartNumbers);
    expect(mockGraphFetchForTenant).toHaveBeenCalledTimes(1);
  });

  it("fails closed (empty set + error) on a non-OK response, never throwing", async () => {
    mockGraphFetchForTenant.mockResolvedValueOnce(new Response("forbidden", { status: 403 }));

    const result = await getSubscribedSkuPartNumbersForTenant("tenant-b");
    expect(result.skuPartNumbers.size).toBe(0);
    expect(result.error).toContain("403");
  });

  it("surfaces a real ConsentRevokedError as an honest error, not a thrown exception", async () => {
    mockGraphFetchForTenant.mockRejectedValueOnce(new ConsentRevokedError("tenant-c"));

    const result = await getSubscribedSkuPartNumbersForTenant("tenant-c");
    expect(result.skuPartNumbers.size).toBe(0);
    expect(result.error).toMatch(/consent/i);
  });

  it("surfaces a real LicenseGapError as an honest error, not a thrown exception", async () => {
    mockGraphFetchForTenant.mockRejectedValueOnce(
      new LicenseGapError("tenant-d", "Microsoft Entra ID Premium (P1/P2)", "Authorization_RequestDenied", "{}", 403),
    );

    const result = await getSubscribedSkuPartNumbersForTenant("tenant-d");
    expect(result.skuPartNumbers.size).toBe(0);
    expect(result.error).toContain("Microsoft Entra ID Premium (P1/P2)");
  });
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
});

describe("tenantHasRequiredLicense", () => {
  it("passes when no requirement is set (null or empty)", () => {
    expect(tenantHasRequiredLicense(null, new Set())).toBe(true);
    expect(tenantHasRequiredLicense([], new Set(["SPE_E3"]))).toBe(true);
  });

  it("passes when ANY ONE of the required SKUs is present", () => {
    expect(tenantHasRequiredLicense(["AAD_PREMIUM", "AAD_PREMIUM_P2"], new Set(["AAD_PREMIUM_P2"]))).toBe(true);
  });

  it("fails when none of the required SKUs are present", () => {
    expect(tenantHasRequiredLicense(["AAD_PREMIUM", "AAD_PREMIUM_P2"], new Set(["SPE_E3"]))).toBe(false);
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
});
