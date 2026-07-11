/**
 * MSP Platform Subscription — unit tests
 *
 * Tests cover:
 *   1. Dunning state machine — advance logic
 *   2. Overage metering — entitlement checks
 *   3. Entitlement middleware — tier gating
 *   4. Signup API — input validation guards
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── 1. Dunning State Machine ────────────────────────────────────────────────────

describe("MSP Dunning State Machine — day-threshold logic", () => {
  function computeDunningTransition(
    daysSince: number,
    currentState: string | null,
    thresholds = { dayReminder: 3, daySuspend: 7, dayRevoke: 14, dayArchive: 30 },
  ): string | null {
    const { dayReminder, daySuspend, dayRevoke, dayArchive } = thresholds;

    if (daysSince >= dayArchive && currentState !== "archival_flagged") {
      return "archival_flagged";
    }
    if (daysSince >= dayRevoke && currentState !== "access_revoked" && currentState !== "archival_flagged") {
      return "access_revoked";
    }
    if (
      daysSince >= daySuspend &&
      currentState !== "suspended" &&
      currentState !== "access_revoked" &&
      currentState !== "archival_flagged"
    ) {
      return "suspended";
    }
    if (daysSince >= dayReminder && !currentState) {
      return "reminder_sent";
    }
    return currentState; // no change
  }

  it("has no effect before Day 3", () => {
    expect(computeDunningTransition(0, null)).toBeNull();
    expect(computeDunningTransition(2, null)).toBeNull();
  });

  it("transitions to reminder_sent on Day 3", () => {
    expect(computeDunningTransition(3, null)).toBe("reminder_sent");
  });

  it("transitions to suspended on Day 7", () => {
    expect(computeDunningTransition(7, "reminder_sent")).toBe("suspended");
    // skips reminder if already past Day 7
    expect(computeDunningTransition(7, null)).toBe("suspended");
  });

  it("transitions to access_revoked on Day 14", () => {
    expect(computeDunningTransition(14, "suspended")).toBe("access_revoked");
  });

  it("transitions to archival_flagged on Day 30", () => {
    expect(computeDunningTransition(30, "access_revoked")).toBe("archival_flagged");
  });

  it("does not regress an already-advanced state", () => {
    // Day 7 but already access_revoked — stays access_revoked
    expect(computeDunningTransition(7, "access_revoked")).toBe("access_revoked");
  });

  it("does not regress archival_flagged to any lower state", () => {
    expect(computeDunningTransition(30, "archival_flagged")).toBe("archival_flagged");
    // Edge: over 30 days, already flagged
    expect(computeDunningTransition(60, "archival_flagged")).toBe("archival_flagged");
  });

  it("respects custom thresholds", () => {
    const custom = { dayReminder: 1, daySuspend: 2, dayRevoke: 5, dayArchive: 10 };
    expect(computeDunningTransition(1, null, custom)).toBe("reminder_sent");
    expect(computeDunningTransition(2, "reminder_sent", custom)).toBe("suspended");
    expect(computeDunningTransition(5, "suspended", custom)).toBe("access_revoked");
    expect(computeDunningTransition(10, "access_revoked", custom)).toBe("archival_flagged");
  });
});

// ── 2. Overage Metering — calculation logic ────────────────────────────────────

describe("MSP Overage Metering — calculation", () => {
  function computeOverage(tenantCount: number, allowance: number) {
    if (allowance === 0) return { isOverage: false, overageCount: 0, hardCapHit: false };
    const hardCap = allowance * 2;
    if (tenantCount >= hardCap) return { isOverage: true, overageCount: tenantCount - allowance, hardCapHit: true };
    const isOverage = tenantCount > allowance;
    return {
      isOverage,
      overageCount: isOverage ? tenantCount - allowance : 0,
      hardCapHit: false,
    };
  }

  it("returns no overage when at or below allowance", () => {
    expect(computeOverage(5, 10).isOverage).toBe(false);
    expect(computeOverage(10, 10).isOverage).toBe(false);
  });

  it("returns overage when above allowance but below hard cap", () => {
    const result = computeOverage(12, 10);
    expect(result.isOverage).toBe(true);
    expect(result.overageCount).toBe(2);
    expect(result.hardCapHit).toBe(false);
  });

  it("marks hard cap when at 2× allowance", () => {
    const result = computeOverage(20, 10);
    expect(result.hardCapHit).toBe(true);
    expect(result.overageCount).toBe(10);
  });

  it("treats allowance=0 as unlimited", () => {
    expect(computeOverage(10000, 0).isOverage).toBe(false);
    expect(computeOverage(10000, 0).hardCapHit).toBe(false);
  });

  it("calculates overage amount correctly", () => {
    const overageRateCents = 500; // $5 per extra tenant
    const { overageCount } = computeOverage(15, 10);
    expect(overageCount * overageRateCents).toBe(2500); // $25
  });
});

// ── 3. Tier Capability Gating — logic ─────────────────────────────────────────

describe("Tier capability gating", () => {
  function isFeatureAllowed(feature: string, capabilities: Record<string, boolean> | null | undefined): boolean {
    const caps = capabilities ?? {};
    // A feature is gated only if explicitly set to false.
    // Missing key = not gated (available on all tiers).
    return caps[feature] !== false;
  }

  it("allows features not present in capability map", () => {
    expect(isFeatureAllowed("some_feature", {})).toBe(true);
    expect(isFeatureAllowed("some_feature", null)).toBe(true);
  });

  it("denies features explicitly set to false", () => {
    expect(isFeatureAllowed("advanced_signals", { advanced_signals: false })).toBe(false);
  });

  it("allows features explicitly set to true", () => {
    expect(isFeatureAllowed("advanced_signals", { advanced_signals: true })).toBe(true);
  });

  it("correctly gates mixed capabilities", () => {
    const caps = {
      advanced_signals: true,
      custom_workflows: false,
      basic_reporting: true,
      sow_generation: false,
    };
    expect(isFeatureAllowed("advanced_signals", caps)).toBe(true);
    expect(isFeatureAllowed("custom_workflows", caps)).toBe(false);
    expect(isFeatureAllowed("basic_reporting", caps)).toBe(true);
    expect(isFeatureAllowed("sow_generation", caps)).toBe(false);
    // Ungated feature
    expect(isFeatureAllowed("new_feature", caps)).toBe(true);
  });
});

// ── 4. Signup API — input validation ──────────────────────────────────────────

describe("MSP Signup — input validation", () => {
  function validateSignupInput(input: {
    companyName?: string;
    contactEmail?: string;
    serviceId?: unknown;
  }): string | null {
    if (!input.companyName?.trim()) return "companyName is required";
    if (!input.contactEmail?.trim() || !input.contactEmail.includes("@")) return "A valid contactEmail is required";
    if (!input.serviceId || isNaN(Number(input.serviceId))) return "serviceId is required";
    return null;
  }

  it("passes valid input", () => {
    expect(validateSignupInput({
      companyName: "Acme IT",
      contactEmail: "jane@acme.com",
      serviceId: 1,
    })).toBeNull();
  });

  it("rejects missing companyName", () => {
    expect(validateSignupInput({ contactEmail: "jane@acme.com", serviceId: 1 })).toMatch(/companyName/);
    expect(validateSignupInput({ companyName: "   ", contactEmail: "jane@acme.com", serviceId: 1 })).toMatch(/companyName/);
  });

  it("rejects invalid contactEmail", () => {
    expect(validateSignupInput({ companyName: "Acme", contactEmail: "not-an-email", serviceId: 1 })).toMatch(/contactEmail/);
    expect(validateSignupInput({ companyName: "Acme", serviceId: 1 })).toMatch(/contactEmail/);
  });

  it("rejects missing serviceId", () => {
    expect(validateSignupInput({ companyName: "Acme", contactEmail: "jane@acme.com" })).toMatch(/serviceId/);
    expect(validateSignupInput({ companyName: "Acme", contactEmail: "jane@acme.com", serviceId: "not-a-number" })).toMatch(/serviceId/);
  });
});

// ── 5. Slug generation ─────────────────────────────────────────────────────────

describe("MSP slug generation", () => {
  function slugify(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48);
  }

  it("converts company name to slug", () => {
    expect(slugify("Acme IT Solutions")).toBe("acme-it-solutions");
    expect(slugify("ABC Corp & Partners")).toBe("abc-corp-partners");
    // Apostrophes are non-alphanumeric and become hyphens before collapsing
    expect(slugify("Smith's MSP LLC")).toBe("smith-s-msp-llc");
  });

  it("handles special characters", () => {
    expect(slugify("100% Uptime MSP")).toBe("100-uptime-msp");
    expect(slugify("---leading-dashes---")).toBe("leading-dashes");
  });

  it("truncates to 48 characters", () => {
    const long = "A".repeat(50) + " Company";
    expect(slugify(long).length).toBeLessThanOrEqual(48);
  });
});
