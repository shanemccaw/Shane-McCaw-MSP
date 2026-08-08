import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for sow-monitoring-addon.ts — resolving the SOW's two real
 * optional services (Tenant Monitoring, Architect Retainer) from the real
 * catalog rows rather than a second pricing path.
 *
 * `db` is mocked with a FIFO queue, matching license-waste-source.test.ts's
 * convention. `resolvePaidSeatFigures` is mocked directly (its own real
 * behaviour is covered by license-waste-source.test.ts) so these tests focus
 * on the monitoring_tier row selection and pricing this file adds.
 */

let mockResultQueue: unknown[][] = [];
let mockSeatFigures: { provisioned: number } | null = { provisioned: 1_200 };

vi.mock("@workspace/db", () => {
  function makeChain() {
    const chain: any = {
      from: () => chain,
      where: () => chain,
      limit: () => chain,
      then: (onFulfilled: any, onRejected: any) =>
        Promise.resolve(mockResultQueue.shift() ?? []).then(onFulfilled, onRejected),
    };
    return chain;
  }
  const tbl = (cols: string[]) => Object.fromEntries(cols.map((c) => [c, c]));
  return {
    db: { select: vi.fn(() => makeChain()) },
    servicesTable: tbl([
      "id",
      "name",
      "slug",
      "tagline",
      "description",
      "hoursPerMonth",
      "serviceType",
      "priceCents",
      "price",
      "basePrice",
      "typeAttributes",
    ]),
  };
});

vi.mock("./license-waste-source.ts", () => ({
  resolvePaidSeatFigures: vi.fn(() => Promise.resolve(mockSeatFigures)),
}));

import { resolveArchitectRetainerAddon, resolveTenantMonitoringAddon } from "./sow-monitoring-addon.ts";

/** One real monitoring_tier row shape, per productTypeConfig.ts's template. */
function monitoringRow(over: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: "Example Monitoring Tier",
    tagline: null,
    description: null,
    typeAttributes: {
      tenantTierLabel: "Basic",
      seatMin: 1,
      seatMax: 1000,
      pricePerUserMonth: "0.75",
      seatCountFloor: 0,
      flatMonthlySurcharge: null,
    },
    ...over,
  };
}

beforeEach(() => {
  mockResultQueue = [];
  mockSeatFigures = { provisioned: 1_200 };
});

describe("resolveTenantMonitoringAddon", () => {
  it("null with no real tenant GUID — nothing to look seats up by", async () => {
    expect(await resolveTenantMonitoringAddon(null)).toBeNull();
  });

  it("null when this tenant's paid seat count cannot be sourced", async () => {
    mockSeatFigures = null;
    expect(await resolveTenantMonitoringAddon("tenant-guid")).toBeNull();
  });

  it("prices each real quality tier's matching seat band at this tenant's real seats", async () => {
    mockSeatFigures = { provisioned: 1_200 };
    mockResultQueue = [
      [
        monitoringRow({ id: 1, typeAttributes: { tenantTierLabel: "Basic", seatMin: 1, seatMax: 1000, pricePerUserMonth: "0.75" } }),
        monitoringRow({ id: 2, typeAttributes: { tenantTierLabel: "Basic", seatMin: 1001, seatMax: null, pricePerUserMonth: "0.60" } }),
        monitoringRow({ id: 3, typeAttributes: { tenantTierLabel: "Enhanced", seatMin: 1, seatMax: 1000, pricePerUserMonth: "1.10" } }),
        monitoringRow({ id: 4, typeAttributes: { tenantTierLabel: "Enhanced", seatMin: 1001, seatMax: null, pricePerUserMonth: "0.90" } }),
        monitoringRow({ id: 5, typeAttributes: { tenantTierLabel: "Premium", seatMin: 1, seatMax: 1000, pricePerUserMonth: "1.60" } }),
        monitoringRow({ id: 6, typeAttributes: { tenantTierLabel: "Premium", seatMin: 1001, seatMax: null, pricePerUserMonth: "1.40" } }),
      ],
    ];
    const addon = await resolveTenantMonitoringAddon("tenant-guid");
    expect(addon).not.toBeNull();
    expect(addon!.id).toBe("tenant-monitoring");
    expect(addon!.tiers.map((t) => t.label)).toEqual(["Basic", "Enhanced", "Premium"]);
    // 1,200 seats falls in the 1001+ band for every tier.
    expect(addon!.tiers.find((t) => t.label === "Basic")!.monthlyUsd).toBeCloseTo(1_200 * 0.6);
    expect(addon!.tiers.find((t) => t.label === "Enhanced")!.monthlyUsd).toBeCloseTo(1_200 * 0.9);
    expect(addon!.tiers.find((t) => t.label === "Premium")!.monthlyUsd).toBeCloseTo(1_200 * 1.4);
  });

  it("marks Enhanced as the recommended default, never Basic or Premium", async () => {
    mockResultQueue = [
      [
        monitoringRow({ typeAttributes: { tenantTierLabel: "Basic", seatMin: 1, seatMax: null, pricePerUserMonth: "0.75" } }),
        monitoringRow({ typeAttributes: { tenantTierLabel: "Enhanced", seatMin: 1, seatMax: null, pricePerUserMonth: "1.10" } }),
        monitoringRow({ typeAttributes: { tenantTierLabel: "Premium", seatMin: 1, seatMax: null, pricePerUserMonth: "1.60" } }),
      ],
    ];
    const addon = await resolveTenantMonitoringAddon("tenant-guid");
    const basic = addon!.tiers.find((t) => t.label === "Basic")!;
    const enhanced = addon!.tiers.find((t) => t.label === "Enhanced")!;
    const premium = addon!.tiers.find((t) => t.label === "Premium")!;
    expect(enhanced.emphasis).toBe("recommended");
    expect(basic.emphasis).toBeUndefined();
    expect(premium.emphasis).toBeUndefined();
    expect(addon!.defaultTierId).toBe(enhanced.id);
  });

  it("falls back to the nearest band rather than leaving a real tenant unpriced", async () => {
    // Every row tops out at 500 seats; this tenant has 1,200.
    mockSeatFigures = { provisioned: 1_200 };
    mockResultQueue = [
      [monitoringRow({ typeAttributes: { tenantTierLabel: "Basic", seatMin: 1, seatMax: 500, pricePerUserMonth: "0.75" } })],
    ];
    const addon = await resolveTenantMonitoringAddon("tenant-guid");
    expect(addon).not.toBeNull();
    expect(addon!.tiers[0]!.monthlyUsd).toBeCloseTo(1_200 * 0.75);
  });

  it("uses the row's own tagline as the tier's customer-facing detail, never the raw includedEngines keys", async () => {
    mockResultQueue = [
      [
        monitoringRow({
          typeAttributes: { tenantTierLabel: "Basic", seatMin: 1, seatMax: null, pricePerUserMonth: "0.75", includedEngines: ["priority", "health"] },
          tagline: "Baseline hourly coverage.",
        }),
      ],
    ];
    const addon = await resolveTenantMonitoringAddon("tenant-guid");
    expect(addon!.tiers[0]!.detail).toBe("Baseline hourly coverage.");
    expect(addon!.tiers[0]!.detail).not.toMatch(/priority|health/);
  });

  it("null when the catalog carries no monitoring_tier rows with a real tenantTierLabel", async () => {
    mockResultQueue = [[{ id: 1, name: "Untagged row", typeAttributes: {} }]];
    expect(await resolveTenantMonitoringAddon("tenant-guid")).toBeNull();
  });
});

describe("resolveArchitectRetainerAddon", () => {
  it("null when the real service row is missing from the catalog", async () => {
    mockResultQueue = [[]];
    expect(await resolveArchitectRetainerAddon()).toBeNull();
  });

  it("wires the single real row directly, with no tiering", async () => {
    mockResultQueue = [
      [
        {
          id: 119,
          name: "Architect Retainer",
          slug: "copilot-governance-retainer",
          tagline: "Direct access to Shane for design decisions.",
          description: null,
          hoursPerMonth: "8 hours a month",
          priceCents: 200_000,
          price: null,
          basePrice: null,
          typeAttributes: {},
        },
      ],
    ];
    const addon = await resolveArchitectRetainerAddon();
    expect(addon).not.toBeNull();
    expect(addon!.id).toBe("architect-retainer");
    expect(addon!.defaultOn).toBe(false);
    expect(addon!.tiers.length).toBe(1);
    expect(addon!.tiers[0]!.monthlyUsd).toBe(2_000);
  });
});
