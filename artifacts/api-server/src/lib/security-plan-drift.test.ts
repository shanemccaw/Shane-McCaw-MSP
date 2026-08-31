/**
 * security-plan-drift.test.ts — proves #1562's settled shape as a pure function:
 * the live view's drift from the LAST SIGNED version, never the merely-current one.
 *
 * `computeSecurityPlanDrift` never touches the database — it diffs two already-
 * assembled `SecurityPlanContent` snapshots by item id, per module.
 */
import { describe, it, expect } from "vitest";
import { computeSecurityPlanDrift } from "./security-plan-drift.ts";
import type { SecurityPlanAssembledItem, SecurityPlanAssembledModule, SecurityPlanContent } from "@workspace/db";

function item(id: string, over: Partial<SecurityPlanAssembledItem> = {}): SecurityPlanAssembledItem {
  return { id, title: id, state: "open", detail: null, pillar: null, framework: null, ...over };
}

function moduleOf(key: string, items: SecurityPlanAssembledItem[]): SecurityPlanAssembledModule {
  return { key, label: key, sourceIssue: "#0000", total: items.length, excludedCount: 0, items };
}

function content(modules: SecurityPlanAssembledModule[]): SecurityPlanContent {
  return {
    customerId: 1,
    tenantId: "tenant-1",
    tenantName: "Tenant One",
    assembledAt: "2026-08-31T00:00:00.000Z",
    modules,
    footprint: { scope: { dimensions: {} }, isHonestView: true, excludedByModule: [], totalExcluded: 0, computedAt: "2026-08-31T00:00:00.000Z" },
    prose: null,
  };
}

const SIGNED_META = { versionUid: "v-1", versionNumber: 1, signedAt: "2026-08-30T00:00:00.000Z" };

describe("Security Plan drift (#1562)", () => {
  it("reports no baseline when nothing has ever been signed", () => {
    const live = content([moduleOf("risk", [item("r-1")])]);
    const drift = computeSecurityPlanDrift(live, null, null);
    expect(drift.hasLastSignedVersion).toBe(false);
    expect(drift.modules).toEqual([]);
    expect(drift.totalAdded).toBe(0);
  });

  it("finds an added item present live but not in the last signed snapshot", () => {
    const signed = content([moduleOf("risk", [item("r-1")])]);
    const live = content([moduleOf("risk", [item("r-1"), item("r-2")])]);
    const drift = computeSecurityPlanDrift(live, signed, SIGNED_META);
    expect(drift.hasLastSignedVersion).toBe(true);
    expect(drift.lastSignedVersionUid).toBe("v-1");
    expect(drift.totalAdded).toBe(1);
    expect(drift.totalRemoved).toBe(0);
    expect(drift.modules[0].added.map((i) => i.id)).toEqual(["r-2"]);
  });

  it("finds a removed item present in the signed snapshot but not live", () => {
    const signed = content([moduleOf("risk", [item("r-1"), item("r-2")])]);
    const live = content([moduleOf("risk", [item("r-1")])]);
    const drift = computeSecurityPlanDrift(live, signed, SIGNED_META);
    expect(drift.totalRemoved).toBe(1);
    expect(drift.modules[0].removed.map((i) => i.id)).toEqual(["r-2"]);
  });

  it("finds a changed item — same id, different state/detail", () => {
    const signed = content([moduleOf("risk", [item("r-1", { state: "open", detail: "raw" })])]);
    const live = content([moduleOf("risk", [item("r-1", { state: "accepted", detail: "raw" })])]);
    const drift = computeSecurityPlanDrift(live, signed, SIGNED_META);
    expect(drift.totalChanged).toBe(1);
    expect(drift.modules[0].changed[0]).toEqual({
      id: "r-1",
      title: "r-1",
      from: { state: "open", detail: "raw" },
      to: { state: "accepted", detail: "raw" },
    });
  });

  it("an item unchanged in every field produces no drift entry at all", () => {
    const signed = content([moduleOf("risk", [item("r-1")])]);
    const live = content([moduleOf("risk", [item("r-1")])]);
    const drift = computeSecurityPlanDrift(live, signed, SIGNED_META);
    expect(drift.modules).toEqual([]);
    expect(drift.totalAdded + drift.totalRemoved + drift.totalChanged).toBe(0);
  });

  it("a module present in the signed snapshot but entirely absent live is a full removal", () => {
    const signed = content([moduleOf("risk", [item("r-1")]), moduleOf("sops", [item("s-1")])]);
    const live = content([moduleOf("risk", [item("r-1")])]);
    const drift = computeSecurityPlanDrift(live, signed, SIGNED_META);
    const sops = drift.modules.find((m) => m.moduleKey === "sops")!;
    expect(sops.removed.map((i) => i.id)).toEqual(["s-1"]);
    expect(drift.totalRemoved).toBe(1);
  });
});
