import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for `resolveLicenseUpliftStats` (#4581) — the one place the
 * Licensing Alignment narrative generator resolves a real, named-SKU dollar
 * figure rather than reading it off the shared War Room stats.
 *
 * `cost-engine.ts` and `license-waste-source.ts` are mocked wholesale (both
 * import `@workspace/db`, unavailable in this suite) so what's under test is
 * the mapping/branching logic: which of a tenant's gapped categories get
 * priced, and which of the three honest "no value" reasons applies when they
 * can't be.
 */

let priceResult: { priceCents: number | null; displayName: string };
let upliftResult: {
  targetSkuPartNumber: string;
  upliftUserCount: number;
  unitMonthlyPriceCents: number;
  monthlyUpliftCents: number;
  annualUpliftCents: number;
  checkKey: string;
  collectedAt: Date | null;
} | null;
let lookupCalls: string[] = [];
let upliftCalls: { tenantGuid: string; skuPartNumber: string }[] = [];

vi.mock("./cost-engine.ts", () => ({
  lookupSkuMonthlyPriceCents: async ({ skuPartNumber }: { skuPartNumber: string }) => {
    lookupCalls.push(skuPartNumber);
    return priceResult;
  },
}));

vi.mock("./license-waste-source.ts", () => ({
  resolveLicenseUpliftCost: async (tenantGuid: string, skuPartNumber: string) => {
    upliftCalls.push({ tenantGuid, skuPartNumber });
    return upliftResult;
  },
}));

vi.mock("./logger.ts", () => ({
  logger: { child: () => ({ info: () => {}, warn: () => {}, error: () => {} }) },
}));

// `licensing-alignment-narrative-generator.ts` also imports
// `pillar-report-narrative.ts` (for the shared loop's types/entry point), which
// transitively pulls in the DB/Anthropic call sites this suite never exercises
// (it tests `resolveLicenseUpliftStats` directly, not the generation loop —
// that loop is already covered end-to-end by `pillar-report-narrative.test.ts`).
// Stubbed the same way that suite stubs them.
vi.mock("@workspace/integrations-anthropic-ai", () => ({ anthropic: { messages: { create: async () => ({}) } } }));
vi.mock("./ai-dev-response-cache.ts", () => ({ withAiDevResponseCache: async (_r: unknown, _a: unknown, fn: () => unknown) => fn() }));
vi.mock("./prompt-loader.ts", () => ({ getPrompt: async (_key: string, fallback: string) => fallback }));
vi.mock("./copilot-gate.ts", () => ({ computeCopilotGate: async () => ({ score: null, threshold: 70, status: null }) }));
vi.mock("./pillar-summary-stats.ts", () => ({ buildPillarSummary: async () => ({ pillars: [] }) }));
vi.mock("@workspace/db", () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }) },
  tenantsTable: { id: "id", mspId: "msp_id", tenantId: "tenant_id" },
}));
vi.mock("drizzle-orm", () => ({ eq: () => true }));

const { __testables } = await import("./licensing-alignment-narrative-generator.ts");
const { resolveLicenseUpliftStats } = __testables;

function payload(gappedCategories: string[]) {
  return {
    licenseGapPurchase: gappedCategories.length ? { gappedCategories } : null,
  } as any;
}

beforeEach(() => {
  lookupCalls = [];
  upliftCalls = [];
  priceResult = { priceCents: 900, displayName: "Entra ID P2" };
  upliftResult = {
    targetSkuPartNumber: "AAD_PREMIUM_P2",
    upliftUserCount: 12,
    unitMonthlyPriceCents: 900,
    monthlyUpliftCents: 10800,
    annualUpliftCents: 129600,
    checkKey: "identity:pim-eligible-roles",
    collectedAt: new Date("2026-09-01T00:00:00.000Z"),
  };
});

describe("resolveLicenseUpliftStats", () => {
  it("returns nothing for a tenant with no licence gap at all", async () => {
    const stats = await resolveLicenseUpliftStats({
      customerId: 1,
      tenantGuid: "tenant-guid",
      payload: payload([]),
    });
    expect(stats).toEqual([]);
    expect(lookupCalls).toEqual([]);
  });

  it("returns nothing when the tenant's own M365 tenant GUID is unknown", async () => {
    const stats = await resolveLicenseUpliftStats({
      customerId: 1,
      tenantGuid: null,
      payload: payload(["identity"]),
    });
    expect(stats).toEqual([]);
  });

  it("prices a real gapped category using its real skuPartNumber, never a guessed value", async () => {
    const stats = await resolveLicenseUpliftStats({
      customerId: 1,
      tenantGuid: "tenant-guid",
      payload: payload(["identity"]),
    });
    expect(stats).toHaveLength(1);
    expect(lookupCalls).toEqual(["AAD_PREMIUM_P2"]);
    expect(upliftCalls).toEqual([{ tenantGuid: "tenant-guid", skuPartNumber: "AAD_PREMIUM_P2" }]);
    expect(stats[0]).toMatchObject({
      id: "licensing.upliftCost.identity",
      label: "Microsoft Entra ID P2 uplift cost",
      unit: "currency",
      value: 1296, // annualUpliftCents / 100
      sub: "12 users without Microsoft Entra ID P2",
    });
    expect(stats[0].unavailableReason).toBeUndefined();
  });

  it("names the category with no confirmed real SKU part number (Purview Suite) as no_sku_mapped, never guessing one", async () => {
    const stats = await resolveLicenseUpliftStats({
      customerId: 1,
      tenantGuid: "tenant-guid",
      payload: payload(["compliance"]),
    });
    expect(stats).toHaveLength(1);
    expect(lookupCalls).toEqual([]);
    expect(upliftCalls).toEqual([]);
    expect(stats[0]).toMatchObject({ value: null, unavailableReason: "no_sku_mapped" });
  });

  it("names a priced-but-unpriced-on-file SKU as no_price_on_file", async () => {
    priceResult = { priceCents: null, displayName: "ATP_ENTERPRISE" };
    const stats = await resolveLicenseUpliftStats({
      customerId: 1,
      tenantGuid: "tenant-guid",
      payload: payload(["mailSecurity"]),
    });
    expect(upliftCalls).toEqual([]);
    expect(stats[0]).toMatchObject({ value: null, unavailableReason: "no_price_on_file" });
  });

  it("names a priced SKU with no snapshot run as no_license_snapshot, never zero", async () => {
    upliftResult = null;
    const stats = await resolveLicenseUpliftStats({
      customerId: 1,
      tenantGuid: "tenant-guid",
      payload: payload(["identity"]),
    });
    expect(stats[0]).toMatchObject({ value: null, unavailableReason: "no_license_snapshot" });
  });

  it("prices every gapped category independently, tier-3 tenant included", async () => {
    const stats = await resolveLicenseUpliftStats({
      customerId: 1,
      tenantGuid: "tenant-guid",
      payload: payload(["identity", "mailSecurity", "compliance"]),
    });
    expect(stats.map((s) => s.id)).toEqual([
      "licensing.upliftCost.identity",
      "licensing.upliftCost.mailSecurity",
      "licensing.upliftCost.compliance",
    ]);
    // compliance has no skuPartNumber, so it never reaches the resolver — only
    // identity's and mailSecurity's real SKUs do, each exactly once.
    expect(upliftCalls.map((c) => c.skuPartNumber)).toEqual(["AAD_PREMIUM_P2", "ATP_ENTERPRISE"]);
    expect(stats[2]).toMatchObject({ value: null, unavailableReason: "no_sku_mapped" });
  });
});
