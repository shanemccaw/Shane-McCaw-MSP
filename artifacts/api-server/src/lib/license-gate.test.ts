import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Git #3947 — proactive license-gate mechanism. `graphFetchForTenant` is
 * mocked at the module boundary, same pattern as account-security-graph.test.ts;
 * `ConsentRevokedError` / `LicenseGapError` are the real classes so the
 * `instanceof` branches exercise real behavior.
 */

const mockGraphFetchForTenant = vi.fn();

vi.mock("./graph.ts", async () => {
  const actual = await vi.importActual<typeof import("./graph")>("./graph.ts");
  return {
    ...actual,
    graphFetchForTenant: (...args: unknown[]) => mockGraphFetchForTenant(...args),
  };
});

import { ConsentRevokedError, LicenseGapError } from "./graph.ts";
import {
  getSubscribedSkuPartNumbersForTenant,
  tenantHasRequiredLicense,
  describeRequiredLicense,
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
});
