import { describe, it, expect } from "vitest";
import {
  boolScore,
  computeScores,
  computeCompletion,
  deriveAlerts,
  deriveKudos,
  type M365Profile,
} from "./m365-scoring";

// ── boolScore ─────────────────────────────────────────────────────────────────

describe("boolScore", () => {
  it("returns 0 for an empty array", () => {
    expect(boolScore([])).toBe(0);
  });

  it("returns 0 when every field is undefined", () => {
    expect(boolScore([undefined, undefined, undefined])).toBe(0);
  });

  it("returns 0 when all answered fields are false", () => {
    expect(boolScore([false, false])).toBe(0);
  });

  it("returns 100 when all answered fields are true", () => {
    expect(boolScore([true, true, true])).toBe(100);
  });

  it("calculates the correct percentage ignoring undefined values in the numerator but including them in the denominator", () => {
    // 1 true out of 3 total (including 1 undefined) → Math.round(1/3 * 100) = 33
    expect(boolScore([true, false, undefined])).toBe(33);
  });

  it("rounds to the nearest integer", () => {
    // 2 true out of 3 → Math.round(2/3 * 100) = 67
    expect(boolScore([true, true, false])).toBe(67);
  });

  it("treats a mix of true and undefined correctly", () => {
    // 1 true, 1 undefined, 0 false → answered=[true] but denominator=2 → Math.round(1/2 * 100) = 50
    expect(boolScore([true, undefined])).toBe(50);
  });
});

// ── computeScores ─────────────────────────────────────────────────────────────

describe("computeScores", () => {
  it("returns all zeros for an empty profile", () => {
    const { secScore, compScore, copScore, govScore } = computeScores({});
    expect(secScore).toBe(0);
    expect(compScore).toBe(0);
    expect(copScore).toBe(0);
    expect(govScore).toBe(0);
  });

  it("returns adoptionScore=0 for an empty profile (activeUserPercent defaults to '0')", () => {
    const { adoptionScore } = computeScores({});
    expect(adoptionScore).toBe(0);
  });

  it("adoptionScore caps at 100", () => {
    const { adoptionScore } = computeScores({ activeUserPercent: "99", allUsersLicensed: true });
    expect(adoptionScore).toBe(100);
  });

  it("adoptionScore adds 10 when allUsersLicensed is true", () => {
    const { adoptionScore } = computeScores({ activeUserPercent: "50", allUsersLicensed: true });
    expect(adoptionScore).toBe(60);
  });

  it("adoptionScore does not add 10 when allUsersLicensed is false", () => {
    const { adoptionScore } = computeScores({ activeUserPercent: "50", allUsersLicensed: false });
    expect(adoptionScore).toBe(50);
  });

  it("adoptionScore treats non-numeric activeUserPercent as 60", () => {
    const { adoptionScore } = computeScores({ activeUserPercent: "abc" });
    expect(adoptionScore).toBe(60);
  });

  it("secScore reaches 100 when all nine security fields are true", () => {
    const profile: M365Profile = {
      mfaEnforced: true,
      conditionalAccessEnabled: true,
      intuneEnabled: true,
      hasAADP1orP2: true,
      hasDefender: true,
      hasDLP: true,
      usesComplianceCenter: true,
      sensitivityLabelsConfigured: true,
      hasRetentionPolicies: true,
    };
    expect(computeScores(profile).secScore).toBe(100);
  });

  it("secScore is 0 when all nine security fields are false", () => {
    const profile: M365Profile = {
      mfaEnforced: false,
      conditionalAccessEnabled: false,
      intuneEnabled: false,
      hasAADP1orP2: false,
      hasDefender: false,
      hasDLP: false,
      usesComplianceCenter: false,
      sensitivityLabelsConfigured: false,
      hasRetentionPolicies: false,
    };
    expect(computeScores(profile).secScore).toBe(0);
  });

  it("secScore boundary: exactly half the nine fields true → ~56", () => {
    // 5 true, 4 false → Math.round(5/9 * 100) = 56
    const profile: M365Profile = {
      mfaEnforced: true,
      conditionalAccessEnabled: true,
      intuneEnabled: true,
      hasAADP1orP2: true,
      hasDefender: true,
      hasDLP: false,
      usesComplianceCenter: false,
      sensitivityLabelsConfigured: false,
      hasRetentionPolicies: false,
    };
    expect(computeScores(profile).secScore).toBe(56);
  });

  it("compScore reaches 100 when all five compliance fields are true", () => {
    const profile: M365Profile = {
      hasDLP: true,
      usesComplianceCenter: true,
      sensitivityLabelsConfigured: true,
      hasRetentionPolicies: true,
      hasInsiderRisk: true,
    };
    expect(computeScores(profile).compScore).toBe(100);
  });

  it("compScore is 0 when all five compliance fields are false", () => {
    const profile: M365Profile = {
      hasDLP: false,
      usesComplianceCenter: false,
      sensitivityLabelsConfigured: false,
      hasRetentionPolicies: false,
      hasInsiderRisk: false,
    };
    expect(computeScores(profile).compScore).toBe(0);
  });

  it("compScore boundary: 3 of 5 true → 60", () => {
    const profile: M365Profile = {
      hasDLP: true,
      usesComplianceCenter: true,
      sensitivityLabelsConfigured: true,
      hasRetentionPolicies: false,
      hasInsiderRisk: false,
    };
    expect(computeScores(profile).compScore).toBe(60);
  });

  it("copScore reaches 100 when all five Copilot-readiness fields are true", () => {
    const profile: M365Profile = {
      hasCopilotLicenses: true,
      mfaEnforced: true,
      sensitivityLabelsConfigured: true,
      hasDLP: true,
      hasRetentionPolicies: true,
    };
    expect(computeScores(profile).copScore).toBe(100);
  });

  it("govScore reaches 100 when all four governance fields are true", () => {
    const profile: M365Profile = {
      hasRetentionPolicies: true,
      sensitivityLabelsConfigured: true,
      usesComplianceCenter: true,
      conditionalAccessEnabled: true,
    };
    expect(computeScores(profile).govScore).toBe(100);
  });

  it("govScore boundary: 1 of 4 true → 25", () => {
    const profile: M365Profile = {
      hasRetentionPolicies: true,
      sensitivityLabelsConfigured: false,
      usesComplianceCenter: false,
      conditionalAccessEnabled: false,
    };
    expect(computeScores(profile).govScore).toBe(25);
  });
});

// ── deriveAlerts ──────────────────────────────────────────────────────────────

describe("deriveAlerts", () => {
  it("returns no alerts for an empty profile", () => {
    expect(deriveAlerts({})).toHaveLength(0);
  });

  it("returns no alerts when all relevant fields are true", () => {
    const profile: M365Profile = {
      mfaEnforced: true,
      conditionalAccessEnabled: true,
      hasDLP: true,
      hasDefender: true,
      sensitivityLabelsConfigured: true,
      hasRetentionPolicies: true,
    };
    expect(deriveAlerts(profile)).toHaveLength(0);
  });

  it("generates a critical alert when mfaEnforced is false", () => {
    const alerts = deriveAlerts({ mfaEnforced: false });
    const mfa = alerts.find(a => a.headline === "MFA is not enforced");
    expect(mfa).toBeDefined();
    expect(mfa?.level).toBe("critical");
  });

  it("generates a critical alert when conditionalAccessEnabled is false", () => {
    const alerts = deriveAlerts({ conditionalAccessEnabled: false });
    const ca = alerts.find(a => a.headline === "No Conditional Access policies");
    expect(ca).toBeDefined();
    expect(ca?.level).toBe("critical");
  });

  it("generates a critical alert when hasDLP is false", () => {
    const alerts = deriveAlerts({ hasDLP: false });
    const dlp = alerts.find(a => a.headline === "No Data Loss Prevention policies");
    expect(dlp).toBeDefined();
    expect(dlp?.level).toBe("critical");
  });

  it("generates a warning alert when hasDefender is false", () => {
    const alerts = deriveAlerts({ hasDefender: false });
    const def = alerts.find(a => a.headline === "Microsoft Defender not active");
    expect(def).toBeDefined();
    expect(def?.level).toBe("warning");
  });

  it("generates a warning alert when sensitivityLabelsConfigured is false", () => {
    const alerts = deriveAlerts({ sensitivityLabelsConfigured: false });
    const sl = alerts.find(a => a.headline === "Sensitivity labels not configured");
    expect(sl).toBeDefined();
    expect(sl?.level).toBe("warning");
  });

  it("generates a warning alert when hasRetentionPolicies is false", () => {
    const alerts = deriveAlerts({ hasRetentionPolicies: false });
    const rp = alerts.find(a => a.headline === "No retention policies in place");
    expect(rp).toBeDefined();
    expect(rp?.level).toBe("warning");
  });

  it("accumulates all six alerts when every field is false", () => {
    const profile: M365Profile = {
      mfaEnforced: false,
      conditionalAccessEnabled: false,
      hasDLP: false,
      hasDefender: false,
      sensitivityLabelsConfigured: false,
      hasRetentionPolicies: false,
    };
    expect(deriveAlerts(profile)).toHaveLength(6);
  });

  it("does not alert when a field is undefined (not explicitly false)", () => {
    const alerts = deriveAlerts({ mfaEnforced: undefined });
    expect(alerts.find(a => a.headline === "MFA is not enforced")).toBeUndefined();
  });
});

// ── deriveKudos ───────────────────────────────────────────────────────────────

describe("deriveKudos", () => {
  it("returns no kudos for an empty profile", () => {
    expect(deriveKudos({})).toHaveLength(0);
  });

  it("returns all eight kudos when all relevant fields are true", () => {
    const profile: M365Profile = {
      mfaEnforced: true,
      hasDefender: true,
      sensitivityLabelsConfigured: true,
      conditionalAccessEnabled: true,
      hasDLP: true,
      usesComplianceCenter: true,
      hasCopilotLicenses: true,
      hasRetentionPolicies: true,
    };
    expect(deriveKudos(profile)).toHaveLength(8);
  });

  it("returns a kudo for MFA when mfaEnforced is true", () => {
    const kudos = deriveKudos({ mfaEnforced: true });
    expect(kudos.find(k => k.headline === "MFA enforced — accounts are protected")).toBeDefined();
  });

  it("returns a kudo for Defender when hasDefender is true", () => {
    const kudos = deriveKudos({ hasDefender: true });
    expect(kudos.find(k => k.headline === "Microsoft Defender is active")).toBeDefined();
  });

  it("returns a kudo for sensitivity labels when sensitivityLabelsConfigured is true", () => {
    const kudos = deriveKudos({ sensitivityLabelsConfigured: true });
    expect(kudos.find(k => k.headline === "Sensitivity labels are configured")).toBeDefined();
  });

  it("returns a kudo for Conditional Access when conditionalAccessEnabled is true", () => {
    const kudos = deriveKudos({ conditionalAccessEnabled: true });
    expect(kudos.find(k => k.headline === "Conditional Access policies in place")).toBeDefined();
  });

  it("returns a kudo for DLP when hasDLP is true", () => {
    const kudos = deriveKudos({ hasDLP: true });
    expect(kudos.find(k => k.headline === "DLP policies protecting data")).toBeDefined();
  });

  it("returns a kudo for Purview when usesComplianceCenter is true", () => {
    const kudos = deriveKudos({ usesComplianceCenter: true });
    expect(kudos.find(k => k.headline === "Microsoft Purview in use")).toBeDefined();
  });

  it("returns a kudo for Copilot when hasCopilotLicenses is true", () => {
    const kudos = deriveKudos({ hasCopilotLicenses: true });
    expect(kudos.find(k => k.headline === "Copilot for M365 licensed and ready")).toBeDefined();
  });

  it("returns a kudo for retention when hasRetentionPolicies is true", () => {
    const kudos = deriveKudos({ hasRetentionPolicies: true });
    expect(kudos.find(k => k.headline === "Retention policies configured")).toBeDefined();
  });

  it("does not award a kudo when a field is false", () => {
    const kudos = deriveKudos({ mfaEnforced: false });
    expect(kudos.find(k => k.headline === "MFA enforced — accounts are protected")).toBeUndefined();
  });

  it("does not award a kudo when a field is undefined", () => {
    const kudos = deriveKudos({ mfaEnforced: undefined });
    expect(kudos.find(k => k.headline === "MFA enforced — accounts are protected")).toBeUndefined();
  });
});

// ── computeCompletion ─────────────────────────────────────────────────────────

describe("computeCompletion", () => {
  it("returns 0 for an empty profile", () => {
    expect(computeCompletion({})).toBe(0);
  });

  it("returns 100 for a fully-filled profile", () => {
    const profile: M365Profile = {
      orgName: "Acme Corp",
      industry: "Technology",
      employeeCount: "200",
      licensedUserCount: "180",
      itContactName: "Alice",
      itContactEmail: "alice@acme.com",
      tenantDomain: "acme.onmicrosoft.com",
      activeUserPercent: "75",
      sharepointSiteCount: "12",
      teamCount: "8",
      securityGroupCount: "5",
      authMethod: "Azure AD",
      copilotUseCase: "Document drafting",
      currentAITools: "None",
      dataGovernanceConcerns: "Sensitive data leakage",
      engagementType: "Retainer",
      engagementStartDate: "2024-01-01",
      estimatedDuration: "6 months",
      budgetRange: "$10k-$50k",
      decisionMakerName: "Bob",
      decisionMakerEmail: "bob@acme.com",
      businessGoals: "Improve productivity",
      referralSource: "LinkedIn",
      isMicrosoftPartner: true,
      allUsersLicensed: true,
      usesExchange: true,
      usesTeams: true,
      usesSharePoint: true,
      usesOneDrive: true,
      externalSharingEnabled: false,
      guestUsersPresent: false,
      isHybrid: false,
      mfaEnforced: true,
      conditionalAccessEnabled: true,
      intuneEnabled: true,
      hasCopilotLicenses: false,
      licenseSKUs: ["Microsoft 365 E3"],
    };
    expect(computeCompletion(profile)).toBe(100);
  });

  it("counts a string field as filled only when non-empty after trim", () => {
    expect(computeCompletion({ orgName: "  " })).toBe(0);
    expect(computeCompletion({ orgName: "Acme" })).toBeGreaterThan(0);
  });

  it("counts a boolean field as filled when it is explicitly false", () => {
    const withFalse = computeCompletion({ isMicrosoftPartner: false });
    const withUndef = computeCompletion({ isMicrosoftPartner: undefined });
    expect(withFalse).toBeGreaterThan(withUndef);
  });

  it("counts licenseSKUs as filled only when the array is non-empty", () => {
    const withEmpty   = computeCompletion({ licenseSKUs: [] });
    const withEntries = computeCompletion({ licenseSKUs: ["M365 E3"] });
    expect(withEntries).toBeGreaterThan(withEmpty);
  });

  it("score boundary: single string field filled → positive completion below 100", () => {
    const pct = computeCompletion({ orgName: "Test" });
    expect(pct).toBeGreaterThan(0);
    expect(pct).toBeLessThan(100);
  });

  it("score is monotonically non-decreasing as more fields are filled", () => {
    const p0 = computeCompletion({});
    const p1 = computeCompletion({ orgName: "A" });
    const p2 = computeCompletion({ orgName: "A", industry: "Tech" });
    const p3 = computeCompletion({ orgName: "A", industry: "Tech", mfaEnforced: true });
    expect(p1).toBeGreaterThanOrEqual(p0);
    expect(p2).toBeGreaterThanOrEqual(p1);
    expect(p3).toBeGreaterThanOrEqual(p2);
  });
});
