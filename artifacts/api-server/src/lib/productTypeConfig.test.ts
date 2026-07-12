/**
 * productTypeConfig.test.ts
 *
 * Unit tests for:
 *   1. detectProductType() — type detection from serviceClass + deliveryType
 *   2. PRODUCT_TYPE_IMPORT_FIELDS — field allow-listing per type
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
];

describe("detectProductType", () => {
  it("detects monitoring_tier from subscription + bundle_subscription", () => {
    expect(detectProductType("subscription", "bundle_subscription")).toBe("monitoring_tier");
  });

  it("detects credit_pack from add_on + none", () => {
    expect(detectProductType("add_on", "none")).toBe("credit_pack");
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

  it("monitoring_tier wins over other matches when both conditions set", () => {
    expect(detectProductType("subscription", "bundle_subscription")).toBe("monitoring_tier");
  });
});

describe("PRODUCT_TYPE_IMPORT_FIELDS", () => {
  it("has entries for all 5 types", () => {
    for (const type of ALL_TYPES) {
      expect(PRODUCT_TYPE_IMPORT_FIELDS[type]).toBeDefined();
      expect(PRODUCT_TYPE_IMPORT_FIELDS[type].size).toBeGreaterThan(5);
    }
  });

  it("all types include common base fields", () => {
    const required = ["slug", "name", "billingType", "visibility", "serviceClass", "deliveryType"];
    for (const type of ALL_TYPES) {
      for (const field of required) {
        expect(PRODUCT_TYPE_IMPORT_FIELDS[type].has(field), `${type} missing ${field}`).toBe(true);
      }
    }
  });

  it("monitoring_tier includes all 8 monitoring-specific fields", () => {
    const monFields = PRODUCT_TYPE_IMPORT_FIELDS["monitoring_tier"];
    const expected = [
      "tenantTierLabel", "seatMin", "seatMax", "includedEngines",
      "includedFeatures", "pricePerUserMonth", "seatCountFloor", "minMspPlanTier",
    ];
    for (const f of expected) {
      expect(monFields.has(f), `monitoring_tier import fields missing ${f}`).toBe(true);
    }
  });

  it("credit_pack does NOT include monitoring-tier-specific fields", () => {
    const cpFields = PRODUCT_TYPE_IMPORT_FIELDS["credit_pack"];
    expect(cpFields.has("tenantTierLabel")).toBe(false);
    expect(cpFields.has("seatMin")).toBe(false);
    expect(cpFields.has("pricePerUserMonth")).toBe(false);
  });
});

describe("PRODUCT_TYPE_EXPORT_FIELDS", () => {
  it("has entries for all 5 types", () => {
    for (const type of ALL_TYPES) {
      expect(PRODUCT_TYPE_EXPORT_FIELDS[type]).toBeDefined();
      expect(PRODUCT_TYPE_EXPORT_FIELDS[type].length).toBeGreaterThan(5);
    }
  });

  it("monitoring_tier export includes 8 monitoring columns", () => {
    const fields = PRODUCT_TYPE_EXPORT_FIELDS["monitoring_tier"];
    const expected = [
      "tenantTierLabel", "seatMin", "seatMax", "includedEngines",
      "includedFeatures", "pricePerUserMonth", "seatCountFloor", "minMspPlanTier",
    ];
    for (const f of expected) {
      expect(fields.includes(f), `monitoring_tier export missing ${f}`).toBe(true);
    }
  });
});

describe("PRODUCT_TYPE_TEMPLATES", () => {
  it("has a template for all 5 types", () => {
    for (const type of ALL_TYPES) {
      const tpl = PRODUCT_TYPE_TEMPLATES[type];
      expect(tpl).toBeDefined();
      expect(typeof tpl.name).toBe("string");
      expect(typeof tpl.slug).toBe("string");
    }
  });

  it("template slugs are URL-safe", () => {
    for (const type of ALL_TYPES) {
      const slug = PRODUCT_TYPE_TEMPLATES[type].slug as string;
      expect(slug).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it("monitoring_tier template has all 8 monitoring fields", () => {
    const tpl = PRODUCT_TYPE_TEMPLATES["monitoring_tier"];
    expect(tpl.tenantTierLabel).toBeDefined();
    expect(tpl.seatMin).toBeGreaterThan(0);
    expect(tpl.seatMax).toBeGreaterThan(0);
    expect(Array.isArray(tpl.includedEngines)).toBe(true);
    expect(Array.isArray(tpl.includedFeatures)).toBe(true);
    expect(typeof tpl.pricePerUserMonth).toBe("number");
    expect(tpl.seatCountFloor).toBeGreaterThan(0);
    expect(typeof tpl.minMspPlanTier).toBe("string");
  });

  it("monitoring_tier template has serviceClass=subscription and deliveryType=bundle_subscription", () => {
    const tpl = PRODUCT_TYPE_TEMPLATES["monitoring_tier"];
    expect(tpl.serviceClass).toBe("subscription");
    expect(tpl.deliveryType).toBe("bundle_subscription");
    expect(detectProductType(tpl.serviceClass as string, tpl.deliveryType as string)).toBe("monitoring_tier");
  });

  it("template fields are a subset of the type's import allow-list", () => {
    for (const type of ALL_TYPES) {
      const tpl = PRODUCT_TYPE_TEMPLATES[type];
      const allowed = PRODUCT_TYPE_IMPORT_FIELDS[type];
      for (const key of Object.keys(tpl)) {
        expect(allowed.has(key), `${type} template has field '${key}' not in import allow-list`).toBe(true);
      }
    }
  });
});

describe("import/export round-trip", () => {
  it("every monitoring_tier export field is also in the import allow-list", () => {
    const exportFields = PRODUCT_TYPE_EXPORT_FIELDS["monitoring_tier"];
    const importFields = PRODUCT_TYPE_IMPORT_FIELDS["monitoring_tier"];
    for (const f of exportFields) {
      expect(importFields.has(f), `monitoring_tier export field '${f}' not importable`).toBe(true);
    }
  });

  it("every type's export fields are importable", () => {
    for (const type of ALL_TYPES) {
      const exportFields = PRODUCT_TYPE_EXPORT_FIELDS[type];
      const importFields = PRODUCT_TYPE_IMPORT_FIELDS[type];
      for (const f of exportFields) {
        expect(importFields.has(f), `${type}: export field '${f}' not in import allow-list`).toBe(true);
      }
    }
  });
});

// ── Acceptance-level behavioral tests ─────────────────────────────────────────
//
// These tests mirror the key invariants the product catalog editor must uphold.

describe("Credit Pack create flow — type identity", () => {
  it("credit_pack template carries serviceClass=add_on and deliveryType=none", () => {
    const tpl = PRODUCT_TYPE_TEMPLATES["credit_pack"];
    expect(tpl.serviceClass).toBe("add_on");
    expect(tpl.deliveryType).toBe("none");
  });

  it("those values round-trip back to credit_pack via detectProductType", () => {
    const tpl = PRODUCT_TYPE_TEMPLATES["credit_pack"];
    expect(detectProductType(tpl.serviceClass as string, tpl.deliveryType as string)).toBe("credit_pack");
  });

  it("all type templates round-trip through detectProductType", () => {
    for (const type of ALL_TYPES) {
      const tpl = PRODUCT_TYPE_TEMPLATES[type];
      expect(
        detectProductType(tpl.serviceClass as string, tpl.deliveryType as string),
        `${type} template serviceClass/deliveryType does not round-trip`,
      ).toBe(type);
    }
  });
});

describe("Import cross-type field rejection logic", () => {
  function simulateImportValidation(
    item: Record<string, unknown>,
  ): { passed: boolean; foreignFields: string[] } {
    const pType = detectProductType(
      item.serviceClass as string | null,
      item.deliveryType as string | null,
    );
    const allowedFields = PRODUCT_TYPE_IMPORT_FIELDS[pType];
    const foreignFields = Object.keys(item).filter((k) => {
      if (k === "_productType" || k === "label") return false;
      return !allowedFields.has(k);
    });
    return { passed: foreignFields.length === 0, foreignFields };
  }

  it("monitoring_tier fields in a credit_pack record are flagged as foreign", () => {
    const badRecord = {
      slug: "cp-bad",
      name: "Credit Pack",
      serviceClass: "add_on",
      deliveryType: "none",
      tenantTierLabel: "Starter",
      seatMin: 5,
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

  it("a clean monitoring_tier record passes validation with no foreign fields", () => {
    const goodRecord = {
      slug: "mt-good",
      name: "Monitoring Tier",
      serviceClass: "subscription",
      deliveryType: "bundle_subscription",
      tenantTierLabel: "Starter",
      seatMin: 1,
      seatMax: 50,
      pricePerUserMonth: "5.00",
      seatCountFloor: 5,
      minMspPlanTier: "starter",
    };
    const result = simulateImportValidation(goodRecord);
    expect(result.passed).toBe(true);
    expect(result.foreignFields).toHaveLength(0);
  });

  it("a clean credit_pack record passes with no foreign fields", () => {
    const goodRecord = {
      slug: "cp-good",
      name: "AI Credits",
      serviceClass: "add_on",
      deliveryType: "none",
      price: "99",
      billingType: "one_time",
    };
    const result = simulateImportValidation(goodRecord);
    expect(result.passed).toBe(true);
    expect(result.foreignFields).toHaveLength(0);
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

  it("retainer record containing project-only field 'durationDays' is rejected", () => {
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

  it("a clean retainer record (no project-only fields) passes validation", () => {
    const goodRecord = {
      slug: "ret-good",
      name: "Monthly Retainer",
      serviceClass: null,
      deliveryType: "retainer",
      price: "2500",
      hoursPerMonth: 20,
      billingType: "monthly",
    };
    const result = simulateImportValidation(goodRecord);
    expect(result.passed).toBe(true);
    expect(result.foreignFields).toHaveLength(0);
  });
});
