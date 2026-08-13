/**
 * productTypeConfig.test.ts
 *
 * Unit tests for:
 *   1. detectProductType() — type detection from serviceClass + deliveryType + billingType + fulfillmentType
 *   2. PRODUCT_TYPE_IMPORT_FIELDS — field allow-listing per type (8 types)
 *   3. PRODUCT_TYPE_TEMPLATES — one example per type is structurally valid
 *   4. Import/export round-trip — template fields match import allow-list
 *
 * Run with: pnpm --filter @workspace/api-server run test
 */

import { describe, it, expect } from "vitest";
import {
  detectProductType,
  PRODUCT_TYPE_IMPORT_FIELDS,
  PRODUCT_TYPE_EXPORT_FIELDS,
  PRODUCT_TYPE_TEMPLATES,
  type ProductTypeKey,
} from "./productTypeConfig";

const ALL_TYPES: ProductTypeKey[] = [
  "credit_pack",
  "assessment",
  "project",
  "retainer",
  "monitoring_tier",
  "recurring_addon",
  "document_product",
  "platform_subscription_tier",
];

// ── detectProductType ─────────────────────────────────────────────────────────

describe("detectProductType", () => {
  it("detects platform_subscription_tier from fulfillmentType=msp_monthly_subscription (highest priority)", () => {
    expect(detectProductType("subscription", "bundle_subscription", "recurring_monthly", "msp_monthly_subscription")).toBe("platform_subscription_tier");
    expect(detectProductType(null, null, null, "msp_monthly_subscription")).toBe("platform_subscription_tier");
  });

  it("detects monitoring_tier from subscription + bundle_subscription (no fulfillmentType)", () => {
    expect(detectProductType("subscription", "bundle_subscription")).toBe("monitoring_tier");
    expect(detectProductType("subscription", "bundle_subscription", "recurring_monthly", null)).toBe("monitoring_tier");
  });

  it("detects recurring_addon from add_on + none + billingType=recurring_monthly", () => {
    expect(detectProductType("add_on", "none", "recurring_monthly")).toBe("recurring_addon");
  });

  it("detects credit_pack from add_on + none (no billingType or non-recurring)", () => {
    expect(detectProductType("add_on", "none")).toBe("credit_pack");
    expect(detectProductType("add_on", "none", "one_time")).toBe("credit_pack");
    expect(detectProductType("add_on", "none", null)).toBe("credit_pack");
  });

  it("detects document_product from deliveryType=document_generation", () => {
    expect(detectProductType(null, "document_generation")).toBe("document_product");
    expect(detectProductType("project", "document_generation")).toBe("document_product");
  });

  it("detects assessment from deliveryType=assessment", () => {
    expect(detectProductType(null, "assessment")).toBe("assessment");
    expect(detectProductType("something", "assessment")).toBe("assessment");
  });

  it("detects retainer from deliveryType=retainer", () => {
    expect(detectProductType(null, "retainer")).toBe("retainer");
    expect(detectProductType("something", "retainer")).toBe("retainer");
  });

  it("detects project from serviceClass=project", () => {
    expect(detectProductType("project", null)).toBe("project");
    expect(detectProductType("project", "anything")).toBe("project");
  });

  it("falls back to project for unknown combos", () => {
    expect(detectProductType(null, null)).toBe("project");
    expect(detectProductType("unknown", "unknown")).toBe("project");
  });

  it("fulfillmentType wins over monitoring_tier when both conditions match", () => {
    expect(detectProductType("subscription", "bundle_subscription", "recurring_monthly", "msp_monthly_subscription")).toBe("platform_subscription_tier");
  });
});

// ── PRODUCT_TYPE_IMPORT_FIELDS ────────────────────────────────────────────────

describe("PRODUCT_TYPE_IMPORT_FIELDS", () => {
  it("has entries for all 8 product types", () => {
    for (const type of ALL_TYPES) {
      expect(PRODUCT_TYPE_IMPORT_FIELDS[type]).toBeDefined();
      expect(PRODUCT_TYPE_IMPORT_FIELDS[type].size).toBeGreaterThan(5);
    }
  });

  it("all types include the common base fields", () => {
    const required = ["slug", "name", "billingType", "visibility", "serviceClass", "deliveryType", "typeAttributes"];
    for (const type of ALL_TYPES) {
      for (const field of required) {
        expect(PRODUCT_TYPE_IMPORT_FIELDS[type].has(field), `${type} missing ${field}`).toBe(true);
      }
    }
  });

  it("typeAttributes is in the import allow-list for all types", () => {
    for (const type of ALL_TYPES) {
      expect(PRODUCT_TYPE_IMPORT_FIELDS[type].has("typeAttributes"), `${type} missing typeAttributes`).toBe(true);
    }
  });

  it("monitoring_tier import does NOT include flat monitoring fields (those live in typeAttributes)", () => {
    const monFields = PRODUCT_TYPE_IMPORT_FIELDS["monitoring_tier"];
    const flatMonitoringFields = ["tenantTierLabel", "seatMin", "seatMax", "pricePerUserMonth", "seatCountFloor", "includedEngines", "includedFeatures"];
    for (const f of flatMonitoringFields) {
      expect(monFields.has(f), `monitoring_tier should NOT have flat field ${f}`).toBe(false);
    }
  });

  it("credit_pack includes price and allowFreeCheckout", () => {
    const f = PRODUCT_TYPE_IMPORT_FIELDS["credit_pack"];
    expect(f.has("price")).toBe(true);
    expect(f.has("allowFreeCheckout")).toBe(true);
  });

  it("project includes durationDays and turnaround (not in retainer)", () => {
    expect(PRODUCT_TYPE_IMPORT_FIELDS["project"].has("durationDays")).toBe(true);
    expect(PRODUCT_TYPE_IMPORT_FIELDS["project"].has("turnaround")).toBe(true);
    expect(PRODUCT_TYPE_IMPORT_FIELDS["retainer"].has("turnaround")).toBe(false);
  });

  it("document_product does NOT include project-only field turnaround", () => {
    expect(PRODUCT_TYPE_IMPORT_FIELDS["document_product"].has("turnaround")).toBe(false);
  });

  it("platform_subscription_tier includes fulfillmentTypeKey", () => {
    expect(PRODUCT_TYPE_IMPORT_FIELDS["platform_subscription_tier"].has("fulfillmentTypeKey")).toBe(true);
  });

  it("recurring_addon includes price and allowFreeCheckout", () => {
    const f = PRODUCT_TYPE_IMPORT_FIELDS["recurring_addon"];
    expect(f.has("price")).toBe(true);
    expect(f.has("allowFreeCheckout")).toBe(true);
  });
});

// ── PRODUCT_TYPE_EXPORT_FIELDS ────────────────────────────────────────────────

describe("PRODUCT_TYPE_EXPORT_FIELDS", () => {
  it("has entries for all 8 product types", () => {
    for (const type of ALL_TYPES) {
      expect(PRODUCT_TYPE_EXPORT_FIELDS[type]).toBeDefined();
      expect(PRODUCT_TYPE_EXPORT_FIELDS[type].length).toBeGreaterThan(5);
    }
  });

  it("every type's export list includes typeAttributes", () => {
    for (const type of ALL_TYPES) {
      expect(PRODUCT_TYPE_EXPORT_FIELDS[type].includes("typeAttributes"), `${type} export missing typeAttributes`).toBe(true);
    }
  });

  it("monitoring_tier export does NOT include flat monitoring column names", () => {
    const fields = PRODUCT_TYPE_EXPORT_FIELDS["monitoring_tier"];
    const flatFields = ["tenantTierLabel", "seatMin", "seatMax", "pricePerUserMonth", "seatCountFloor"];
    for (const f of flatFields) {
      expect(fields.includes(f), `monitoring_tier export should NOT include flat field ${f}`).toBe(false);
    }
  });

  it("project export includes turnaround and durationDays", () => {
    const fields = PRODUCT_TYPE_EXPORT_FIELDS["project"];
    expect(fields.includes("turnaround")).toBe(true);
    expect(fields.includes("durationDays")).toBe(true);
  });

  it("platform_subscription_tier export includes fulfillmentType", () => {
    expect(PRODUCT_TYPE_EXPORT_FIELDS["platform_subscription_tier"].includes("fulfillmentType")).toBe(true);
  });
});

// ── PRODUCT_TYPE_TEMPLATES ────────────────────────────────────────────────────

describe("PRODUCT_TYPE_TEMPLATES", () => {
  it("has a template for all 8 types with name and slug", () => {
    for (const type of ALL_TYPES) {
      const tpl = PRODUCT_TYPE_TEMPLATES[type];
      expect(tpl).toBeDefined();
      expect(typeof tpl.name).toBe("string");
      expect(typeof tpl.slug).toBe("string");
    }
  });

  it("template slugs are URL-safe (lowercase alphanumeric + hyphen)", () => {
    for (const type of ALL_TYPES) {
      const slug = PRODUCT_TYPE_TEMPLATES[type].slug as string;
      expect(slug).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it("monitoring_tier template has typeAttributes with monitoring-specific config", () => {
    const tpl = PRODUCT_TYPE_TEMPLATES["monitoring_tier"];
    const attrs = tpl.typeAttributes as Record<string, unknown>;
    expect(attrs).toBeDefined();
    expect(attrs.tenantTierLabel).toBeDefined();
    expect(attrs.seatMin).toBeGreaterThan(0);
    expect(attrs.seatMax).toBeGreaterThan(0);
    expect(Array.isArray(attrs.includedEngines)).toBe(true);
    expect(Array.isArray(attrs.includedFeatures)).toBe(true);
    expect(typeof attrs.pricePerUserMonth).toBe("string");
    expect((attrs.seatCountFloor as number)).toBeGreaterThan(0);
    expect(typeof attrs.minMspPlanTier).toBe("string");
  });

  it("monitoring_tier template round-trips through detectProductType", () => {
    const tpl = PRODUCT_TYPE_TEMPLATES["monitoring_tier"];
    expect(detectProductType(tpl.serviceClass as string, tpl.deliveryType as string)).toBe("monitoring_tier");
  });

  it("platform_subscription_tier template has fulfillmentType=msp_monthly_subscription", () => {
    const tpl = PRODUCT_TYPE_TEMPLATES["platform_subscription_tier"];
    expect(tpl.fulfillmentType).toBe("msp_monthly_subscription");
    const attrs = tpl.typeAttributes as Record<string, unknown>;
    expect(attrs).toBeDefined();
    expect(typeof attrs.tenantAllowance).toBe("number");
  });

  it("platform_subscription_tier template round-trips via fulfillmentType", () => {
    const tpl = PRODUCT_TYPE_TEMPLATES["platform_subscription_tier"];
    expect(
      detectProductType(tpl.serviceClass as string, tpl.deliveryType as string, tpl.billingType as string, tpl.fulfillmentType as string),
    ).toBe("platform_subscription_tier");
  });

  it("recurring_addon template round-trips through detectProductType", () => {
    const tpl = PRODUCT_TYPE_TEMPLATES["recurring_addon"];
    expect(
      detectProductType(tpl.serviceClass as string, tpl.deliveryType as string, tpl.billingType as string),
    ).toBe("recurring_addon");
  });

  it("document_product template round-trips through detectProductType", () => {
    const tpl = PRODUCT_TYPE_TEMPLATES["document_product"];
    expect(detectProductType(tpl.serviceClass as string | null, tpl.deliveryType as string)).toBe("document_product");
  });

  it("template top-level fields are a subset of the type's import allow-list", () => {
    for (const type of ALL_TYPES) {
      const tpl = PRODUCT_TYPE_TEMPLATES[type];
      const allowed = PRODUCT_TYPE_IMPORT_FIELDS[type];
      for (const key of Object.keys(tpl)) {
        expect(allowed.has(key), `${type} template has top-level field '${key}' not in import allow-list`).toBe(true);
      }
    }
  });

  it("all type templates round-trip through detectProductType (using their natural fields)", () => {
    const overrides: Partial<Record<ProductTypeKey, Parameters<typeof detectProductType>>> = {
      platform_subscription_tier: ["subscription", "bundle_subscription", "recurring_monthly", "msp_monthly_subscription"],
      recurring_addon: ["add_on", "none", "recurring_monthly", null],
    };

    for (const type of ALL_TYPES) {
      const tpl = PRODUCT_TYPE_TEMPLATES[type];
      const args: Parameters<typeof detectProductType> = overrides[type] ?? [
        tpl.serviceClass as string | null,
        tpl.deliveryType as string | null,
        (tpl.billingType as string | null) ?? null,
        (tpl.fulfillmentType as string | null) ?? null,
      ];
      expect(detectProductType(...args), `${type} template did not round-trip through detectProductType`).toBe(type);
    }
  });
});

// ── Import/export round-trip ──────────────────────────────────────────────────

describe("import/export round-trip", () => {
  it("every type's export fields are importable (export ⊆ import allow-list)", () => {
    for (const type of ALL_TYPES) {
      const exportFields = PRODUCT_TYPE_EXPORT_FIELDS[type];
      const importFields = PRODUCT_TYPE_IMPORT_FIELDS[type];
      for (const f of exportFields) {
        expect(importFields.has(f), `${type}: export field '${f}' not in import allow-list`).toBe(true);
      }
    }
  });
});

// ── Import cross-type field rejection ────────────────────────────────────────

describe("Import cross-type field rejection logic", () => {
  function simulateImportValidation(
    item: Record<string, unknown>,
  ): { passed: boolean; foreignFields: string[] } {
    const pType = detectProductType(
      item.serviceClass as string | null,
      item.deliveryType as string | null,
      item.billingType as string | null,
      item.fulfillmentType as string | null,
    );
    const allowedFields = PRODUCT_TYPE_IMPORT_FIELDS[pType];
    const foreignFields = Object.keys(item).filter((k) => {
      if (k === "_productType" || k === "label") return false;
      return !allowedFields.has(k);
    });
    return { passed: foreignFields.length === 0, foreignFields };
  }

  it("a clean monitoring_tier record (only common fields + typeAttributes) passes validation", () => {
    const goodRecord = {
      slug: "mt-good",
      name: "Monitoring Tier",
      serviceClass: "subscription",
      deliveryType: "bundle_subscription",
      billingType: "recurring_monthly",
      typeAttributes: {
        tenantTierLabel: "Starter",
        seatMin: 1,
        seatMax: 50,
        pricePerUserMonth: "5.00",
        seatCountFloor: 5,
        minMspPlanTier: "starter",
      },
    };
    const result = simulateImportValidation(goodRecord);
    expect(result.passed).toBe(true);
    expect(result.foreignFields).toHaveLength(0);
  });

  it("flat monitoring fields in a monitoring_tier record ARE now flagged (they belong in typeAttributes)", () => {
    const badRecord = {
      slug: "mt-flat",
      name: "Monitoring Tier",
      serviceClass: "subscription",
      deliveryType: "bundle_subscription",
      tenantTierLabel: "Starter",
      seatMin: 1,
    };
    const result = simulateImportValidation(badRecord);
    expect(result.passed).toBe(false);
    expect(result.foreignFields).toContain("tenantTierLabel");
    expect(result.foreignFields).toContain("seatMin");
  });

  it("credit_pack fields in a monitoring_tier record are flagged as foreign", () => {
    const badRecord = {
      slug: "mt-bad",
      name: "Monitoring Tier",
      serviceClass: "subscription",
      deliveryType: "bundle_subscription",
      price: "999",
    };
    const result = simulateImportValidation(badRecord);
    expect(result.passed).toBe(false);
    expect(result.foreignFields).toContain("price");
  });

  it("a clean credit_pack record passes with no foreign fields", () => {
    const goodRecord = {
      slug: "cp-good",
      name: "AI Credits",
      serviceClass: "add_on",
      deliveryType: "none",
      price: "99",
      billingType: "one_time",
      typeAttributes: {},
    };
    const result = simulateImportValidation(goodRecord);
    expect(result.passed).toBe(true);
    expect(result.foreignFields).toHaveLength(0);
  });

  it("recurring_addon detected from billingType=recurring_monthly with add_on+none", () => {
    const record = {
      slug: "ra-good",
      name: "Monthly Add-on",
      serviceClass: "add_on",
      deliveryType: "none",
      billingType: "recurring_monthly",
      price: "29",
      typeAttributes: { flatMonthlyPrice: "29.00" },
    };
    const result = simulateImportValidation(record);
    expect(result.passed).toBe(true);
  });

  it("retainer record containing project-only field 'turnaround' is rejected", () => {
    const badRecord = {
      slug: "ret-bad",
      name: "Monthly Retainer",
      serviceClass: null,
      deliveryType: "retainer",
      price: "2500",
      hoursPerMonth: 10,
      turnaround: "5 business days",
    };
    const result = simulateImportValidation(badRecord);
    expect(result.passed).toBe(false);
    expect(result.foreignFields).toContain("turnaround");
  });

  it("retainer record containing 'durationDays' is rejected", () => {
    const badRecord = {
      slug: "ret-bad2",
      name: "Monthly Retainer",
      serviceClass: null,
      deliveryType: "retainer",
      price: "2500",
      durationDays: 30,
    };
    const result = simulateImportValidation(badRecord);
    expect(result.passed).toBe(false);
    expect(result.foreignFields).toContain("durationDays");
  });

  it("a clean retainer record (with typeAttributes) passes validation", () => {
    const goodRecord = {
      slug: "ret-good",
      name: "Monthly Retainer",
      serviceClass: null,
      deliveryType: "retainer",
      price: "2500",
      hoursPerMonth: 20,
      billingType: "recurring_monthly",
      typeAttributes: {},
    };
    const result = simulateImportValidation(goodRecord);
    expect(result.passed).toBe(true);
    expect(result.foreignFields).toHaveLength(0);
  });

  it("platform_subscription_tier record with typeAttributes passes validation", () => {
    const goodRecord = {
      slug: "pst-good",
      name: "Platform Tier",
      serviceClass: "subscription",
      deliveryType: "bundle_subscription",
      billingType: "recurring_monthly",
      fulfillmentType: "msp_monthly_subscription",
      typeAttributes: { tenantAllowance: 50 },
    };
    const result = simulateImportValidation(goodRecord);
    expect(result.passed).toBe(true);
  });
});
