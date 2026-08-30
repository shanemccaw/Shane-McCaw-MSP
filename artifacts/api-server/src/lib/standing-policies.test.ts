import { describe, it, expect } from "vitest";
import {
  toWireStandingPolicy,
  isStandingPolicyTargetKind,
  STANDING_POLICY_TARGET_KIND_LABELS,
  type WireStandingPolicy,
} from "./standing-policies";
import { STANDING_POLICY_TARGET_KIND, type StandingPolicy } from "@workspace/db";

// A real-shaped row, the way `standing_policies` returns it from Drizzle
// (`createdAt`/`updatedAt` as Date objects). #1547.
function row(overrides: Partial<StandingPolicy> = {}): StandingPolicy {
  return {
    id: 7,
    mspId: 1,
    ouId: 42,
    title: "VIP group membership",
    description: "VIP -> membership of the VIP distribution + protection groups",
    targetKind: "group_membership",
    targetState: { groups: ["VIP-DL", "VIP-Protected"] },
    catalogItemId: null,
    isActive: false,
    createdByPersonId: "person-1",
    createdByName: "op@example.com",
    createdAt: new Date("2026-08-30T10:00:00.000Z"),
    updatedAt: new Date("2026-08-30T10:00:00.000Z"),
    ...overrides,
  };
}

describe("toWireStandingPolicy", () => {
  it("maps a row to its wire shape, serving the target-state declaration verbatim", () => {
    const wire = toWireStandingPolicy(row());
    expect(wire).toEqual<WireStandingPolicy>({
      id: 7,
      ouId: 42,
      title: "VIP group membership",
      description: "VIP -> membership of the VIP distribution + protection groups",
      targetKind: "group_membership",
      targetState: { groups: ["VIP-DL", "VIP-Protected"] },
      catalogItemId: null,
      isActive: false,
      createdByName: "op@example.com",
      createdAt: "2026-08-30T10:00:00.000Z",
      updatedAt: "2026-08-30T10:00:00.000Z",
    });
  });

  it("serves nulls as nulls — never an invented value", () => {
    const wire = toWireStandingPolicy(row({ createdByName: null, catalogItemId: null }));
    expect(wire.createdByName).toBeNull();
    expect(wire.catalogItemId).toBeNull();
  });

  it("carries the #1550 catalog-item binding through when set", () => {
    const wire = toWireStandingPolicy(row({ catalogItemId: 99, isActive: true }));
    expect(wire.catalogItemId).toBe(99);
    expect(wire.isActive).toBe(true);
  });

  it("never exposes a money or signature field — the object carries neither", () => {
    const wire = toWireStandingPolicy(row());
    const keys = Object.keys(wire);
    for (const forbidden of ["priceCents", "price", "amount", "signedAt", "acceptedAt", "approvedAt", "obligation"]) {
      expect(keys).not.toContain(forbidden);
    }
  });
});

describe("isStandingPolicyTargetKind", () => {
  it("accepts every real member of the vocabulary and nothing else", () => {
    for (const kind of STANDING_POLICY_TARGET_KIND) {
      expect(isStandingPolicyTargetKind(kind)).toBe(true);
    }
    expect(isStandingPolicyTargetKind("expired")).toBe(false); // a register lane, not a policy kind
    expect(isStandingPolicyTargetKind("")).toBe(false);
    expect(isStandingPolicyTargetKind(undefined)).toBe(false);
    expect(isStandingPolicyTargetKind(3)).toBe(false);
  });

  it("has a display label for every kind and no orphan labels", () => {
    const labelKeys = Object.keys(STANDING_POLICY_TARGET_KIND_LABELS).sort();
    expect(labelKeys).toEqual([...STANDING_POLICY_TARGET_KIND].sort());
  });
});
