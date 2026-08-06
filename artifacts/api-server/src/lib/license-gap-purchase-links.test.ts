/**
 * license-gap-purchase-links.test.ts — #489.
 *
 * Covers the two things that can silently go wrong here: the tiering rule
 * picking the wrong recommendation, and the corrected category table drifting
 * back toward the superseded one in the issue body.
 */

import { describe, it, expect } from "vitest";

import {
  DEFENDER_FOR_OFFICE_365,
  ENTRA_ID_P2,
  LICENSE_GAP_CATEGORIES,
  LICENSE_GAP_CATEGORY_KEYS,
  MICROSOFT_365_E7,
  PURVIEW_SUITE,
  buildLicenseGapPurchase,
  licenseGapCategoryForCheckKey,
  recommendationForCheckKey,
} from "./license-gap-purchase-links.ts";

const IDENTITY = "identity:pim-eligible-roles";
const MAIL = "security:safe-links-coverage";
const COMPLIANCE = "compliance:missing-labels";

describe("the corrected category table (#489, 2026-08-06 comment)", () => {
  it("maps exactly the twelve confirmed check keys and nothing else", () => {
    const all = LICENSE_GAP_CATEGORY_KEYS.flatMap((k) => LICENSE_GAP_CATEGORIES[k].checkKeys);
    expect(all).toHaveLength(12);
    expect(new Set(all).size).toBe(12);
  });

  it("routes each category's keys to its own add-on", () => {
    expect(licenseGapCategoryForCheckKey("identity:pim-groups")).toBe("identity");
    expect(licenseGapCategoryForCheckKey("security:dlp-violations")).toBe("mailSecurity");
    expect(licenseGapCategoryForCheckKey("governance:retention-policy-coverage")).toBe("compliance");
    expect(LICENSE_GAP_CATEGORIES.identity.sku).toBe(ENTRA_ID_P2);
    expect(LICENSE_GAP_CATEGORIES.mailSecurity.sku).toBe(DEFENDER_FOR_OFFICE_365);
    expect(LICENSE_GAP_CATEGORIES.compliance.sku).toBe(PURVIEW_SUITE);
  });

  it("claims NO exchange:* check — the original issue's Mail security table is superseded", () => {
    // The eleven exchange:* checks were not license-gated (the real fault was
    // executor wiring, #491) and have since been archived out of the product.
    // A regression that re-adds them here would put a purchase link under a
    // finding that is not a licence gap at all.
    const all = LICENSE_GAP_CATEGORY_KEYS.flatMap((k) => LICENSE_GAP_CATEGORIES[k].checkKeys);
    expect(all.filter((k) => k.startsWith("exchange:"))).toEqual([]);
    expect(licenseGapCategoryForCheckKey("exchange:transport-rule-count")).toBeNull();
  });

  it("returns null for an unknown or empty key rather than guessing", () => {
    expect(licenseGapCategoryForCheckKey("identity:mfa-registration")).toBeNull();
    expect(licenseGapCategoryForCheckKey("")).toBeNull();
    expect(licenseGapCategoryForCheckKey(null)).toBeNull();
  });

  it("points every link at microsoft.com over https", () => {
    for (const sku of [ENTRA_ID_P2, DEFENDER_FOR_OFFICE_365, PURVIEW_SUITE, MICROSOFT_365_E7]) {
      expect(sku.url.startsWith("https://www.microsoft.com/")).toBe(true);
    }
  });
});

describe("the 1/2/3 tiering rule", () => {
  it("recommends nothing at all when nothing is gapped", () => {
    expect(buildLicenseGapPurchase([])).toBeNull();
    // A gapped check outside all three categories is still not a recommendation.
    expect(buildLicenseGapPurchase(["exchange:transport-rule-count"])).toBeNull();
  });

  it("tier 1 — links only that category's own add-on", () => {
    const purchase = buildLicenseGapPurchase([IDENTITY, "identity:pim-groups"])!;
    expect(purchase.tier).toBe(1);
    expect(purchase.consolidated).toBe(false);
    expect(purchase.recommendations).toHaveLength(1);
    expect(purchase.recommendations[0]!.sku).toBe(ENTRA_ID_P2);
    // Its own evidence, both keys, not the category's full roster.
    expect(purchase.recommendations[0]!.checkKeys).toEqual([IDENTITY, "identity:pim-groups"]);
  });

  it("tier 2 — links BOTH specific add-ons individually, never E7", () => {
    const purchase = buildLicenseGapPurchase([MAIL, COMPLIANCE])!;
    expect(purchase.tier).toBe(2);
    expect(purchase.consolidated).toBe(false);
    expect(purchase.recommendations.map((r) => r.sku)).toEqual([
      DEFENDER_FOR_OFFICE_365,
      PURVIEW_SUITE,
    ]);
    expect(purchase.recommendations.some((r) => r.sku === MICROSOFT_365_E7)).toBe(false);
  });

  it("tier 3 — one consolidated E7 recommendation replaces the three add-ons", () => {
    const purchase = buildLicenseGapPurchase([IDENTITY, MAIL, COMPLIANCE])!;
    expect(purchase.tier).toBe(3);
    expect(purchase.consolidated).toBe(true);
    expect(purchase.recommendations).toHaveLength(1);
    expect(purchase.recommendations[0]!.sku).toBe(MICROSOFT_365_E7);
    // The individual findings still describe all three gaps — that is what makes
    // the single recommendation credible.
    expect(purchase.gappedCategories).toEqual(["identity", "mailSecurity", "compliance"]);
    expect(purchase.recommendations[0]!.checkKeys).toEqual([IDENTITY, MAIL, COMPLIANCE]);
    expect(purchase.recommendations[0]!.categoryLabels).toHaveLength(3);
  });

  it("orders categories by the declared order, not by discovery order", () => {
    const a = buildLicenseGapPurchase([COMPLIANCE, IDENTITY])!;
    const b = buildLicenseGapPurchase([IDENTITY, COMPLIANCE])!;
    expect(a.gappedCategories).toEqual(b.gappedCategories);
    expect(a.gappedCategories).toEqual(["identity", "compliance"]);
  });

  it("counts a category once however many of its checks are gapped", () => {
    const purchase = buildLicenseGapPurchase([
      "security:antiphishing-coverage",
      "security:safe-attachments-coverage",
      "security:safe-links-coverage",
      "security:dlp-violations",
    ])!;
    expect(purchase.tier).toBe(1);
    expect(purchase.recommendations).toHaveLength(1);
  });

  it("de-duplicates a repeated check key rather than double-counting it", () => {
    const purchase = buildLicenseGapPurchase([IDENTITY, IDENTITY, IDENTITY])!;
    expect(purchase.recommendations[0]!.checkKeys).toEqual([IDENTITY]);
  });

  it("carries an uncategorised gap instead of dropping it or linking it", () => {
    const purchase = buildLicenseGapPurchase([IDENTITY, "exchange:transport-rule-count"])!;
    expect(purchase.uncategorisedCheckKeys).toEqual(["exchange:transport-rule-count"]);
    expect(purchase.tier).toBe(1);
    expect(recommendationForCheckKey(purchase, "exchange:transport-rule-count")).toBeNull();
  });
});

describe("resolving a link for one finding", () => {
  it("gives each check its own add-on below tier 3", () => {
    const purchase = buildLicenseGapPurchase([MAIL, COMPLIANCE])!;
    expect(recommendationForCheckKey(purchase, MAIL)!.sku).toBe(DEFENDER_FOR_OFFICE_365);
    expect(recommendationForCheckKey(purchase, COMPLIANCE)!.sku).toBe(PURVIEW_SUITE);
  });

  it("gives EVERY check the same E7 recommendation at tier 3", () => {
    const purchase = buildLicenseGapPurchase([IDENTITY, MAIL, COMPLIANCE])!;
    for (const key of [IDENTITY, MAIL, COMPLIANCE]) {
      expect(recommendationForCheckKey(purchase, key)!.sku).toBe(MICROSOFT_365_E7);
    }
  });

  it("resolves nothing from a null purchase or a null key", () => {
    expect(recommendationForCheckKey(null, IDENTITY)).toBeNull();
    expect(recommendationForCheckKey(buildLicenseGapPurchase([IDENTITY]), null)).toBeNull();
  });
});
