import { describe, it, expect } from "vitest";
import {
  toWireVipClassification,
  isVipClassificationSource,
  isDiscoverySource,
  VIP_CLASSIFICATION_SOURCE_LABELS,
  VIP_DISCOVERY_SOURCES,
  type WireVipClassification,
} from "./vip-classifications";
import { VIP_CLASSIFICATION_SOURCES, type VipClassification } from "@workspace/db";

// A real-shaped row, the way `vip_classifications` returns it from Drizzle
// (`classifiedAt`/`createdAt`/`updatedAt` as Date objects). #1552.
function row(overrides: Partial<VipClassification> = {}): VipClassification {
  return {
    id: 3,
    customerId: 1,
    principalId: "graph-obj-1",
    principalUpn: "exec1@contoso.com",
    isVip: true,
    source: "told",
    discoveryDetail: null,
    classifiedByPersonId: "u5",
    classifiedByName: "op@example.com",
    classifiedAt: new Date("2026-08-30T10:00:00.000Z"),
    createdAt: new Date("2026-08-30T10:00:00.000Z"),
    updatedAt: new Date("2026-08-30T10:00:00.000Z"),
    ...overrides,
  };
}

describe("toWireVipClassification", () => {
  it("maps a 'told' row to its wire shape", () => {
    const wire = toWireVipClassification(row());
    expect(wire).toEqual<WireVipClassification>({
      id: 3,
      customerId: 1,
      principalId: "graph-obj-1",
      principalUpn: "exec1@contoso.com",
      isVip: true,
      source: "told",
      discoveryDetail: null,
      classifiedByName: "op@example.com",
      classifiedAt: "2026-08-30T10:00:00.000Z",
      createdAt: "2026-08-30T10:00:00.000Z",
      updatedAt: "2026-08-30T10:00:00.000Z",
    });
  });

  it("serves discoveryDetail provenance verbatim for a discovery-sourced row", () => {
    const wire = toWireVipClassification(
      row({
        source: "discovered_group",
        discoveryDetail: { groupId: "g-1", groupName: "VIP-DL" },
        classifiedByPersonId: null,
        classifiedByName: null,
      }),
    );
    expect(wire.source).toBe("discovered_group");
    expect(wire.discoveryDetail).toEqual({ groupId: "g-1", groupName: "VIP-DL" });
    expect(wire.classifiedByName).toBeNull();
  });

  it("serves a de-VIP ('told', isVip=false) row honestly — not omitted or inferred", () => {
    const wire = toWireVipClassification(row({ isVip: false, classifiedByName: "op2@example.com" }));
    expect(wire.isVip).toBe(false);
    expect(wire.source).toBe("told");
  });

  it("never exposes a money or signature field — the object carries neither", () => {
    const wire = toWireVipClassification(row());
    const keys = Object.keys(wire);
    for (const forbidden of ["priceCents", "price", "amount", "signedAt", "approvedAt", "obligation"]) {
      expect(keys).not.toContain(forbidden);
    }
  });
});

describe("isVipClassificationSource", () => {
  it("accepts every real member of the vocabulary and nothing else", () => {
    for (const source of VIP_CLASSIFICATION_SOURCES) {
      expect(isVipClassificationSource(source)).toBe(true);
    }
    expect(isVipClassificationSource("tenant_authoritative")).toBe(false); // the inverted model #1552 rejected
    expect(isVipClassificationSource("")).toBe(false);
    expect(isVipClassificationSource(undefined)).toBe(false);
    expect(isVipClassificationSource(3)).toBe(false);
  });

  it("has a display label for every source and no orphan labels", () => {
    const labelKeys = Object.keys(VIP_CLASSIFICATION_SOURCE_LABELS).sort();
    expect(labelKeys).toEqual([...VIP_CLASSIFICATION_SOURCES].sort());
  });
});

describe("isDiscoverySource / VIP_DISCOVERY_SOURCES — the precedence rule", () => {
  it("'told' is never a discovery source — it is the platform decision, not a read hint", () => {
    expect(isDiscoverySource("told")).toBe(false);
    expect(VIP_DISCOVERY_SOURCES).not.toContain("told");
  });

  it("group membership and AD attribute are both discovery sources", () => {
    expect(isDiscoverySource("discovered_group")).toBe(true);
    expect(isDiscoverySource("discovered_attribute")).toBe(true);
  });

  it("VIP_DISCOVERY_SOURCES is exactly the vocabulary minus 'told'", () => {
    const expected = VIP_CLASSIFICATION_SOURCES.filter((s) => s !== "told").sort();
    expect([...VIP_DISCOVERY_SOURCES].sort()).toEqual(expected);
  });
});
