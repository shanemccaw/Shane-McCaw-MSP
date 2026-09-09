/**
 * #2455 — the capability catalog is a real, enumerable set.
 *
 * #1696 requirement 3: *"The capability catalog must be enumerable. #1698's
 * gating pass has to verify that every route carries a requirement, mechanically.
 * That is only possible if capabilities are a real, listable set rather than
 * strings appearing ad hoc in jsonb blobs."* These assertions are what makes that
 * claim checkable rather than asserted — if the catalog ever degrades into
 * free-form strings, or two systems collide on one key, this file goes red.
 */

import { describe, expect, it } from "vitest";
import {
  RBAC_CAPABILITIES,
  RBAC_SYSTEMS,
  capabilityId,
  findCapability,
  isKnownCapability,
  listCapabilities,
} from "./capabilities";

describe("the catalog is enumerable", () => {
  it("is a non-empty list that can be walked without a database", () => {
    expect(RBAC_CAPABILITIES.length).toBeGreaterThan(0);
    expect(listCapabilities().length).toBe(RBAC_CAPABILITIES.length);
  });

  it("partitions cleanly by system, and every entry lands in exactly one", () => {
    const perSystem = RBAC_SYSTEMS.map((system) => listCapabilities(system).length);
    expect(perSystem.reduce((a, b) => a + b, 0)).toBe(RBAC_CAPABILITIES.length);
    for (const count of perSystem) expect(count).toBeGreaterThan(0);
  });

  it("declares a known system on every entry", () => {
    for (const capability of RBAC_CAPABILITIES) {
      expect(RBAC_SYSTEMS).toContain(capability.system);
    }
  });
});

describe("the (system, key) pair is the identity", () => {
  it("has no duplicate pair", () => {
    const ids = RBAC_CAPABILITIES.map((c) => capabilityId(c.system, c.key));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("lets the same key exist in both systems without collision", () => {
    // `team.manage` is deliberately catalogued in both: managing the MSP's own
    // staff and managing a customer's own roster are different authorities over
    // different people. Keyed by the pair, they cannot be confused.
    expect(isKnownCapability("msp", "team.manage")).toBe(true);
    expect(isKnownCapability("customer", "team.manage")).toBe(true);
    expect(findCapability("msp", "team.manage")?.label).not.toBe(findCapability("customer", "team.manage")?.label);
  });

  it("does not leak a key across systems", () => {
    expect(isKnownCapability("customer", "billing.view")).toBe(true);
    expect(isKnownCapability("msp", "billing.view")).toBe(false);
    expect(isKnownCapability("msp", "purchases.approve")).toBe(true);
    expect(isKnownCapability("customer", "purchases.approve")).toBe(false);
  });

  it("reports an unknown key as unknown rather than throwing", () => {
    expect(isKnownCapability("customer", "not.a.capability")).toBe(false);
    expect(findCapability("customer", "not.a.capability")).toBeUndefined();
  });
});

describe("catalog entries are well formed", () => {
  it("uses stable lowercase dotted keys", () => {
    for (const capability of RBAC_CAPABILITIES) {
      expect(capability.key).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+$/);
    }
  });

  it("carries a category, a label and a real description on every entry", () => {
    for (const capability of RBAC_CAPABILITIES) {
      expect(capability.category.length).toBeGreaterThan(0);
      expect(capability.label.length).toBeGreaterThan(0);
      // A description that does not say what it gates is how a catalog rots into
      // ad hoc strings, which is the thing #1696 requirement 3 forbids.
      expect(capability.description.length).toBeGreaterThan(40);
    }
  });

  it("is frozen — the catalog is a definition, not mutable state", () => {
    expect(Object.isFrozen(RBAC_CAPABILITIES)).toBe(true);
  });
});
