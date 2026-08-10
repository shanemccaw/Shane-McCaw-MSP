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

  it("Git #632: falls back to the SMB seat band (26 seats) rather than omitting itself when no real seat count is sourced", async () => {
    mockSeatFigures = null;
    mockResultQueue = [
      [
        monitoringRow({ typeAttributes: { tenantTierLabel: "Basic", seatMin: 1, seatMax: 1000, pricePerUserMonth: "0.75" } }),
        monitoringRow({ typeAttributes: { tenantTierLabel: "Enhanced", seatMin: 1, seatMax: 1000, pricePerUserMonth: "1.10" } }),
        monitoringRow({ typeAttributes: { tenantTierLabel: "Premium", seatMin: 1, seatMax: 1000, pricePerUserMonth: "1.60" } }),
      ],
    ];
    const addon = await resolveTenantMonitoringAddon("tenant-guid");
    expect(addon).not.toBeNull();
    expect(addon!.tiers[0]!.label).toBe("Enhanced");
    expect(addon!.tiers[0]!.monthlyUsd).toBeCloseTo(26 * 1.1);
    expect(addon!.defaultOn).toBe(true);
  });

  it("Git #632: same SMB fallback when seat figures resolve but provisioned is 0", async () => {
    mockSeatFigures = { provisioned: 0 };
    mockResultQueue = [
      [monitoringRow({ typeAttributes: { tenantTierLabel: "Enhanced", seatMin: 1, seatMax: 1000, pricePerUserMonth: "1.10" } })],
    ];
    const addon = await resolveTenantMonitoringAddon("tenant-guid");
    expect(addon).not.toBeNull();
    expect(addon!.tiers[0]!.monthlyUsd).toBeCloseTo(26 * 1.1);
  });

  it("Git #609: resolves to Enhanced's real seat-matched price ONLY — Basic/Premium are priced internally but never exposed as alternatives", async () => {
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
    expect(addon!.tiers).toHaveLength(1);
    expect(addon!.tiers[0]!.label).toBe("Enhanced");
    // 1,200 seats falls in the 1001+ band.
    expect(addon!.tiers[0]!.monthlyUsd).toBeCloseTo(1_200 * 0.9);
    expect(addon!.defaultTierId).toBe(addon!.tiers[0]!.id);
    expect(addon!.defaultOn).toBe(true);
  });

  it("falls back to whichever quality tier priced when Enhanced itself is not priceable", async () => {
    mockResultQueue = [
      [
        monitoringRow({ typeAttributes: { tenantTierLabel: "Basic", seatMin: 1, seatMax: null, pricePerUserMonth: "0.75" } }),
        monitoringRow({ typeAttributes: { tenantTierLabel: "Premium", seatMin: 1, seatMax: null, pricePerUserMonth: "1.60" } }),
      ],
    ];
    const addon = await resolveTenantMonitoringAddon("tenant-guid");
    expect(addon!.tiers).toHaveLength(1);
    expect(addon!.tiers[0]!.label).toBe("Basic");
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

/** One real Architect Retainer row shape, per the #595 migration. */
function retainerRow(over: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: "Architect Essentials Retainer",
    slug: "architect-essentials-retainer",
    tagline: null,
    description: null,
    hoursPerMonth: null,
    priceCents: null,
    price: null,
    basePrice: null,
    typeAttributes: { seatMin: 26, seatMax: 100 },
    ...over,
  };
}

const ESSENTIALS_ROW = retainerRow({
  id: 115,
  name: "Architect Essentials Retainer",
  slug: "architect-essentials-retainer",
  tagline: "Direct access to Shane for design decisions.",
  price: "1500.00",
  typeAttributes: { seatMin: 26, seatMax: 100 },
});
const GROWTH_ROW = retainerRow({
  id: 116,
  name: "Architect Growth Retainer",
  slug: "architect-growth-retainer",
  tagline: "Broader engagement across escalations and change review.",
  price: "3000.00",
  typeAttributes: { seatMin: 101, seatMax: 500 },
});
const ENTERPRISE_ROW = retainerRow({
  id: 117,
  name: "Architect Enterprise Retainer",
  slug: "architect-enterprise-retainer",
  tagline: "Full programme oversight at enterprise scale.",
  price: "5500.00",
  typeAttributes: { seatMin: 501, seatMax: null },
});

describe("resolveArchitectRetainerAddon", () => {
  it("null when the real service rows are missing from the catalog", async () => {
    mockResultQueue = [[]];
    expect(await resolveArchitectRetainerAddon(null)).toBeNull();
  });

  it("resolves all three real seat-banded tiers, labelled by real product name", async () => {
    mockResultQueue = [[ESSENTIALS_ROW, GROWTH_ROW, ENTERPRISE_ROW]];
    const addon = await resolveArchitectRetainerAddon(null);
    expect(addon).not.toBeNull();
    expect(addon!.id).toBe("architect-retainer");
    // Git #609: pre-selected/active by default, not a separate opt-in step.
    expect(addon!.defaultOn).toBe(true);
    expect(addon!.tiers.map((t) => t.label)).toEqual(["Essentials", "Growth", "Enterprise"]);
    expect(addon!.tiers.map((t) => t.monthlyUsd)).toEqual([1_500, 3_000, 5_500]);
  });

  it("marks the tenant's real seat-matched band as seat-match and pre-selects it", async () => {
    mockSeatFigures = { provisioned: 250 };
    mockResultQueue = [[ESSENTIALS_ROW, GROWTH_ROW, ENTERPRISE_ROW]];
    const addon = await resolveArchitectRetainerAddon("tenant-guid");
    const growth = addon!.tiers.find((t) => t.label === "Growth")!;
    const essentials = addon!.tiers.find((t) => t.label === "Essentials")!;
    const enterprise = addon!.tiers.find((t) => t.label === "Enterprise")!;
    expect(growth.emphasis).toBe("seat-match");
    expect(essentials.emphasis).toBeUndefined();
    expect(enterprise.emphasis).toBeUndefined();
    expect(addon!.defaultTierId).toBe(growth.id);
  });

  it("defaults to Essentials when no real seat count is sourced, with no tier marked seat-match", async () => {
    mockSeatFigures = null;
    mockResultQueue = [[ESSENTIALS_ROW, GROWTH_ROW, ENTERPRISE_ROW]];
    const addon = await resolveArchitectRetainerAddon("tenant-guid");
    expect(addon!.tiers.every((t) => t.emphasis === undefined)).toBe(true);
    const essentials = addon!.tiers.find((t) => t.label === "Essentials")!;
    expect(addon!.defaultTierId).toBe(essentials.id);
  });

  it("uses the Essentials row's own tagline as the addon-level blurb, never invented copy", async () => {
    mockResultQueue = [[ESSENTIALS_ROW, GROWTH_ROW, ENTERPRISE_ROW]];
    const addon = await resolveArchitectRetainerAddon(null);
    expect(addon!.blurb).toBe("Direct access to Shane for design decisions.");
  });
});
