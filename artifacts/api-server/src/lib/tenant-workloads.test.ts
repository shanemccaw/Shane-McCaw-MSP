import { describe, it, expect, vi } from "vitest";

// tenant-workloads.ts (transitively, via license-waste-source.ts/cost-engine.ts)
// pulls in the real "@workspace/db" module, which throws at import time without
// a live DATABASE_URL. These tests only exercise the pure derivation functions
// below, so the module is stubbed out — same pattern license-waste-source.test.ts
// already uses.
vi.mock("@workspace/db", () => {
  const tbl = (cols: string[]) => Object.fromEntries(cols.map((c) => [c, c]));
  return {
    db: { select: vi.fn(), transaction: vi.fn() },
    monitorChecksTable: tbl(["key", "status", "endpoint"]),
    tenantMonitorProfilesTable: tbl(["tenantId", "checkKey", "rawResponse", "collectedAt", "status"]),
    tenantServicePlansTable: tbl(["mspId", "tenantId", "servicePlanId"]),
    tenantsTable: tbl(["id", "mspId", "tenantId"]),
    skuPriceReferenceTable: tbl(["skuPartNumber"]),
  };
});

import {
  parseEnabledServicePlans,
  resolveWorkloadForServicePlan,
  groupEnabledServicePlansByWorkload,
  resolveWorkloadForCheckKey,
} from "./tenant-workloads.ts";

/** The real /subscribedSkus shape, as Graph returns it. */
function skuPage(items: unknown[], nextLink?: string) {
  return { value: items, ...(nextLink ? { "@odata.nextLink": nextLink } : {}) };
}
const plan = (
  servicePlanId: string,
  servicePlanName: string,
  provisioningStatus: string,
  servicePlanType = "SomeType",
) => ({ servicePlanId, servicePlanName, servicePlanType, provisioningStatus });
const sku = (skuPartNumber: string, skuId: string, plans: unknown[]) => ({ skuPartNumber, skuId, servicePlans: plans });

describe("parseEnabledServicePlans", () => {
  it("keeps only provisioningStatus === Success", () => {
    const page = skuPage([
      sku("ENTERPRISEPACK", "sku-1", [
        plan("p1", "EXCHANGE_S_ENTERPRISE", "Success"),
        plan("p2", "MCOEV", "PendingActivation"),
        plan("p3", "SHAREPOINTENTERPRISE", "Disabled"),
      ]),
    ]);
    const rows = parseEnabledServicePlans(page);
    expect(rows.map((r) => r.servicePlanName)).toEqual(["EXCHANGE_S_ENTERPRISE"]);
  });

  it("refuses a truncated (@odata.nextLink) page rather than under-report", () => {
    const page = skuPage(
      [sku("ENTERPRISEPACK", "sku-1", [plan("p1", "EXCHANGE_S_ENTERPRISE", "Success")])],
      "https://graph.microsoft.com/v1.0/subscribedSkus?$skiptoken=abc",
    );
    expect(parseEnabledServicePlans(page)).toEqual([]);
  });

  it("dedupes a plan bundled into more than one SKU by servicePlanId", () => {
    const page = skuPage([
      sku("ENTERPRISEPACK", "sku-1", [plan("p1", "EXCHANGE_S_ENTERPRISE", "Success")]),
      sku("EXCHANGESTANDARD_ADDON", "sku-2", [plan("p1", "EXCHANGE_S_ENTERPRISE", "Success")]),
    ]);
    const rows = parseEnabledServicePlans(page);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.skuPartNumber).toBe("ENTERPRISEPACK");
  });

  it("skips a SKU row missing skuPartNumber/skuId, and returns [] for no items", () => {
    expect(parseEnabledServicePlans({ value: [{ servicePlans: [plan("p1", "TEAMS1", "Success")] }] })).toEqual([]);
    expect(parseEnabledServicePlans(null)).toEqual([]);
    expect(parseEnabledServicePlans({})).toEqual([]);
  });
});

describe("resolveWorkloadForServicePlan", () => {
  it("maps real, known Microsoft servicePlanName identifiers to a workload", () => {
    expect(resolveWorkloadForServicePlan("EXCHANGE_S_ENTERPRISE")).toEqual({ key: "exchange", label: "Exchange Online" });
    expect(resolveWorkloadForServicePlan("SHAREPOINTENTERPRISE")).toEqual({ key: "sharepoint", label: "SharePoint & OneDrive" });
    expect(resolveWorkloadForServicePlan("TEAMS1")).toEqual({ key: "teams", label: "Teams" });
    expect(resolveWorkloadForServicePlan("INTUNE_A")).toEqual({ key: "endpoint", label: "Endpoint Management (Intune)" });
  });

  it("returns null for a real but un-mapped plan name rather than guessing", () => {
    expect(resolveWorkloadForServicePlan("MESH_IMMERSIVE")).toBeNull();
  });
});

describe("resolveWorkloadForCheckKey", () => {
  it("maps a real monitor_checks.key category prefix to the same workload buckets", () => {
    expect(resolveWorkloadForCheckKey("identity:mfa-registration")).toEqual({ key: "icam", label: "Identity & Access (Entra ID)" });
    expect(resolveWorkloadForCheckKey("exchange:distribution-list-count")).toEqual({ key: "exchange", label: "Exchange Online" });
    expect(resolveWorkloadForCheckKey("devices:encryption-status")).toEqual({ key: "endpoint", label: "Endpoint Management (Intune)" });
  });

  it("folds onedrive: into the same SharePoint & OneDrive workload as sharepoint:", () => {
    expect(resolveWorkloadForCheckKey("onedrive:overshared-files")).toEqual({ key: "sharepoint", label: "SharePoint & OneDrive" });
    expect(resolveWorkloadForCheckKey("sharepoint:external-sharing")).toEqual({ key: "sharepoint", label: "SharePoint & OneDrive" });
  });

  it("returns null for a cross-cutting category with no single-workload owner, rather than guessing", () => {
    expect(resolveWorkloadForCheckKey("cost:unused-unassigned-licenses")).toBeNull();
    expect(resolveWorkloadForCheckKey("appgov:stale-app-registrations")).toBeNull();
    expect(resolveWorkloadForCheckKey("governance:anything")).toBeNull();
  });

  it("returns null for a key with no category prefix", () => {
    expect(resolveWorkloadForCheckKey("no-colon-here")).toBeNull();
    expect(resolveWorkloadForCheckKey("")).toBeNull();
  });
});

describe("groupEnabledServicePlansByWorkload", () => {
  it("groups multiple enabled plans onto one row per workload, deduped and sorted by label", () => {
    const groups = groupEnabledServicePlansByWorkload([
      { servicePlanName: "TEAMS1" },
      { servicePlanName: "EXCHANGE_S_ENTERPRISE" },
      { servicePlanName: "EXCHANGE_S_STANDARD" },
      { servicePlanName: "MESH_IMMERSIVE" }, // unmapped — contributes nothing
    ]);
    expect(groups).toEqual([
      { key: "exchange", label: "Exchange Online", servicePlanNames: ["EXCHANGE_S_ENTERPRISE", "EXCHANGE_S_STANDARD"] },
      { key: "teams", label: "Teams", servicePlanNames: ["TEAMS1"] },
    ]);
  });

  it("returns [] for an all-unmapped or empty input", () => {
    expect(groupEnabledServicePlansByWorkload([])).toEqual([]);
    expect(groupEnabledServicePlansByWorkload([{ servicePlanName: "MESH_IMMERSIVE" }])).toEqual([]);
  });
});
