/**
 * category-pillar-mapping.test.ts
 *
 * Unit tests for Git #469: the category -> pillar mapping this module
 * replaces the one-time SQL seed script's `CASE` statement with. Covers the
 * confirmed mappings from the issue body, the `devices` deliberate gap, the
 * out-of-scope pass-through domains, and the removed silent `ELSE
 * 'governance'` default.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test
 */

import { describe, it, expect } from "vitest";
import {
  resolveCategoryPillar,
  categoryDomain,
  DeliberatelyUnmappedCategoryDomainError,
  UnmappedCategoryDomainError,
} from "./category-pillar-mapping.ts";

describe("categoryDomain", () => {
  it("extracts the domain before the first colon", () => {
    expect(categoryDomain("compliance:retention_policy_missing")).toBe("compliance");
  });

  it("lowercases and trims", () => {
    expect(categoryDomain("  Identity:MFA  ")).toBe("identity");
  });

  it("returns the whole string when there is no colon", () => {
    expect(categoryDomain("governance")).toBe("governance");
  });
});

describe("resolveCategoryPillar — Git #469 confirmed mappings", () => {
  it.each([
    ["appgov:app-consent-drift", "governance"],
    ["teams:external-access", "governance"],
    ["sharepoint:anonymous-links", "governance"],
    ["compliance:missing-labels", "compliance"],
    ["dlp:weak-policy", "compliance"],
    ["sensitivity-labels:not-applied", "compliance"],
    ["retention-labels:not-applied", "compliance"],
    ["identity:mfa-registration", "security"],
    ["identitygov:pim-eligible", "security"],
    ["security:conditional-access-failures", "security"],
    ["defender:atp-status", "security"],
    ["exchange:transport-rules", "security"],
  ])("%s -> %s", (category, expectedPillar) => {
    expect(resolveCategoryPillar(category)).toBe(expectedPillar);
  });

  it("matches on a bare domain with no subcategory", () => {
    expect(resolveCategoryPillar("compliance")).toBe("compliance");
  });
});

describe("resolveCategoryPillar — pre-existing unambiguous self-mappings", () => {
  it.each([
    ["governance:policy-gaps", "governance"],
    ["adoption:low-license-utilization", "adoption"],
    ["copilot:readiness-achieved", "copilot"],
    ["architecture:hybrid-exchange", "architecture"],
    ["licensing:unused-seats", "licensing"],
  ])("%s -> %s", (category, expectedPillar) => {
    expect(resolveCategoryPillar(category)).toBe(expectedPillar);
  });
});

describe("resolveCategoryPillar — devices (deliberate gap, Git #469)", () => {
  it("throws a distinct, clearly-labeled error rather than defaulting", () => {
    expect(() => resolveCategoryPillar("devices:compliance-drift")).toThrow(
      DeliberatelyUnmappedCategoryDomainError,
    );
  });

  it("error message names the deliberate-gap reasoning", () => {
    try {
      resolveCategoryPillar("devices:compliance-drift");
      throw new Error("expected resolveCategoryPillar to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(DeliberatelyUnmappedCategoryDomainError);
      expect((err as Error).message).toMatch(/deliberate/i);
      expect((err as Error).message).not.toMatch(/governance/i);
    }
  });
});

describe("resolveCategoryPillar — out-of-scope engines pass through unvalidated", () => {
  it.each([
    "example:pricing",
    "adj:something",
    "pricing:high-value-deal",
    "priority:executive-escalation",
    "crm:strong-deal-fit",
    "msp:multi-tenant-managed",
    "workflow:automation-candidate",
    "drift:config-baseline-deviation",
    "forecasting:growth-trend-positive",
  ])("%s resolves to null (not this mapping's concern)", (category) => {
    expect(resolveCategoryPillar(category)).toBeNull();
  });
});

describe("resolveCategoryPillar — blank category", () => {
  it("returns null rather than deriving anything", () => {
    expect(resolveCategoryPillar("")).toBeNull();
    expect(resolveCategoryPillar("   ")).toBeNull();
  });
});

describe("resolveCategoryPillar — removed silent ELSE 'governance' default", () => {
  it("throws UnmappedCategoryDomainError for a genuinely unrecognized domain", () => {
    expect(() => resolveCategoryPillar("totally-unknown-domain:whatever")).toThrow(
      UnmappedCategoryDomainError,
    );
  });

  it("never silently resolves an unrecognized domain to governance", () => {
    try {
      resolveCategoryPillar("totally-unknown-domain:whatever");
      throw new Error("expected resolveCategoryPillar to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(UnmappedCategoryDomainError);
      expect((err as Error).message).toMatch(/not silently default/i);
    }
  });
});
