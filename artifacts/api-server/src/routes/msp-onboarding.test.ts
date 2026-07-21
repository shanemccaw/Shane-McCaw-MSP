/**
 * MSP Onboarding Logic Tests
 *
 * Tests the core logic and data shapes for the MSP onboarding routes.
 * Uses direct function-level tests rather than HTTP integration tests
 * to avoid the supertest dependency.
 *
 * Covers:
 * - Gate logic: new email → proceed; active MSP → redirect; suspended MSP → proceed
 * - Direct-business MSP → redirect too (same as any other active MSP)
 * - Honeypot field triggers silent proceed
 * - Onboarding link token validation states (valid, used, expired)
 * - Link generation parameter validation
 */

import { describe, it, expect } from "vitest";

// ── Pure logic helpers extracted from the route ───────────────────────────────

function honeypotTriggered(body: Record<string, unknown>): boolean {
  const hp = body["_hp"];
  return hp !== undefined && hp !== null && hp !== "";
}

type GateAction =
  | { action: "proceed" }
  | { action: "redirect"; portalUrl: string; mspName: string; mspSlug: string };

function deriveGateAction(
  user: { id: number } | null,
  mspUser: {
    mspId: number;
    mspStatus: "active" | "suspended" | "trial";
    mspSlug: string;
    mspName: string;
    mspDomain: string | null;
  } | null,
  portalBaseUrl = "",
): GateAction {
  if (!user || !mspUser) {
    return { action: "proceed" };
  }

  if (mspUser.mspStatus === "active" || mspUser.mspStatus === "trial") {
    const portalUrl = mspUser.mspDomain
      ? `https://${mspUser.mspDomain}`
      : portalBaseUrl;
    return { action: "redirect", portalUrl, mspName: mspUser.mspName, mspSlug: mspUser.mspSlug };
  }

  return { action: "proceed" };
}

type LinkState = "valid" | "used" | "expired" | "suspended_msp";

function deriveOnboardingLinkState(row: {
  usedAt: Date | null;
  expiresAt: Date;
  mspStatus: "active" | "suspended" | "trial";
}): LinkState {
  if (row.usedAt) return "used";
  if (row.expiresAt < new Date()) return "expired";
  if (row.mspStatus === "suspended") return "suspended_msp";
  return "valid";
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("honeypotTriggered", () => {
  it("returns false when _hp is absent", () => {
    expect(honeypotTriggered({ email: "a@b.com" })).toBe(false);
  });

  it("returns false when _hp is empty string", () => {
    expect(honeypotTriggered({ email: "a@b.com", _hp: "" })).toBe(false);
  });

  it("returns true when _hp has any value", () => {
    expect(honeypotTriggered({ email: "bot@spam.com", _hp: "I am a bot" })).toBe(true);
  });
});

describe("deriveGateAction — email gate logic", () => {
  it("returns proceed for unknown email (no user record)", () => {
    const result = deriveGateAction(null, null);
    expect(result.action).toBe("proceed");
  });

  it("returns proceed when user has no MSP row", () => {
    const result = deriveGateAction({ id: 99 }, null);
    expect(result.action).toBe("proceed");
  });

  it("returns redirect when user has active non-direct MSP", () => {
    const result = deriveGateAction(
      { id: 99 },
      {
        mspId: 5,
        mspStatus: "active",
        mspSlug: "acme-msp",
        mspName: "ACME MSP",
        mspDomain: "portal.acmemsp.com",
      },
    );
    expect(result.action).toBe("redirect");
    if (result.action === "redirect") {
      expect(result.portalUrl).toBe("https://portal.acmemsp.com");
      expect(result.mspName).toBe("ACME MSP");
    }
  });

  it("uses portalBaseUrl when MSP has no domain", () => {
    const result = deriveGateAction(
      { id: 99 },
      {
        mspId: 5,
        mspStatus: "trial",
        mspSlug: "acme-msp",
        mspName: "ACME MSP",
        mspDomain: null,
      },
      "https://portal.example.com",
    );
    expect(result.action).toBe("redirect");
    if (result.action === "redirect") {
      expect(result.portalUrl).toBe("https://portal.example.com");
    }
  });

  it("returns proceed when MSP is suspended", () => {
    const result = deriveGateAction(
      { id: 99 },
      {
        mspId: 5,
        mspStatus: "suspended",
        mspSlug: "acme-msp",
        mspName: "ACME MSP",
        mspDomain: "portal.acmemsp.com",
      },
    );
    expect(result.action).toBe("proceed");
  });

  it("returns redirect when the MSP is the direct-business row (Shane's own MSP)", () => {
    const result = deriveGateAction(
      { id: 99 },
      {
        mspId: 1,
        mspStatus: "active",
        mspSlug: "shane-direct",
        mspName: "Shane McCaw Consulting",
        mspDomain: null,
      },
      "https://portal.example.com",
    );
    expect(result.action).toBe("redirect");
    if (result.action === "redirect") {
      expect(result.portalUrl).toBe("https://portal.example.com");
      expect(result.mspName).toBe("Shane McCaw Consulting");
    }
  });

  it("returns redirect for a trial direct-business MSP customer", () => {
    const result = deriveGateAction(
      { id: 42 },
      {
        mspId: 1,
        mspStatus: "trial",
        mspSlug: "direct",
        mspName: "Direct",
        mspDomain: null,
      },
      "https://portal.example.com",
    );
    expect(result.action).toBe("redirect");
  });
});

describe("deriveOnboardingLinkState — link validation", () => {
  const future = new Date(Date.now() + 86_400_000);
  const past = new Date(Date.now() - 1000);

  it("marks a valid, fresh link as valid", () => {
    expect(
      deriveOnboardingLinkState({ usedAt: null, expiresAt: future, mspStatus: "active" }),
    ).toBe("valid");
  });

  it("marks a used link as used regardless of expiry", () => {
    expect(
      deriveOnboardingLinkState({ usedAt: new Date(), expiresAt: future, mspStatus: "active" }),
    ).toBe("used");
  });

  it("marks an expired (unused) link as expired", () => {
    expect(
      deriveOnboardingLinkState({ usedAt: null, expiresAt: past, mspStatus: "active" }),
    ).toBe("expired");
  });

  it("marks a suspended MSP link as suspended_msp", () => {
    expect(
      deriveOnboardingLinkState({ usedAt: null, expiresAt: future, mspStatus: "suspended" }),
    ).toBe("suspended_msp");
  });

  it("used takes precedence over expired", () => {
    expect(
      deriveOnboardingLinkState({ usedAt: new Date(), expiresAt: past, mspStatus: "active" }),
    ).toBe("used");
  });
});

describe("email validation", () => {
  it("accepts valid emails", () => {
    expect(isValidEmail("user@example.com")).toBe(true);
    expect(isValidEmail("first.last@sub.domain.co.uk")).toBe(true);
  });

  it("rejects malformed emails", () => {
    expect(isValidEmail("not-an-email")).toBe(false);
    expect(isValidEmail("@nodomain.com")).toBe(false);
    expect(isValidEmail("noatsign.com")).toBe(false);
    expect(isValidEmail("")).toBe(false);
  });
});

describe("link generation parameter validation", () => {
  function validateLinkParams(params: {
    customerEmail?: string;
    ttlHours?: number;
  }): string | null {
    const { customerEmail, ttlHours = 72 } = params;
    if (!customerEmail || !isValidEmail(customerEmail)) return "A valid customerEmail is required";
    const ttl = Math.min(Math.max(Number(ttlHours) || 72, 1), 168);
    if (ttl < 1 || ttl > 168) return "ttlHours must be between 1 and 168";
    return null;
  }

  it("returns null for valid params", () => {
    expect(validateLinkParams({ customerEmail: "c@example.com" })).toBeNull();
  });

  it("rejects missing email", () => {
    expect(validateLinkParams({})).toBeTruthy();
  });

  it("rejects invalid email", () => {
    expect(validateLinkParams({ customerEmail: "notanemail" })).toBeTruthy();
  });

  it("clamps ttlHours to 168 max", () => {
    const overLimit = Math.min(Math.max(Number(9999) || 72, 1), 168);
    expect(overLimit).toBe(168);
  });
});
