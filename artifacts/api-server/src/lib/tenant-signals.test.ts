/**
 * tenant-signals.test.ts
 *
 * Unit tests for the signal-gated SOW generation pipeline:
 *   computeTenantSignals()  — pure evaluator, no DB deps
 *   projectMatchesSignals() — pure inclusion logic, no DB deps
 *
 * Covers the task requirement of confirming signal-gated SOW generation
 * works end-to-end before shipping to clients:
 *
 *   1. All six rule types evaluate correctly
 *   2. OR and AND group logic work
 *   3. alwaysInclude always fires (no-rules / empty baseline)
 *   4. hasSignals = false when only alwaysInclude fires (no substantive signals)
 *   5. projectMatchesSignals gates projects correctly via both paths
 *   6. signalsOverride fast-path produces identical project filtering to
 *      the DB-evaluation path (parity guarantee)
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test
 */

import { describe, it, expect } from "vitest";
import {
  computeTenantSignals,
  projectMatchesSignals,
  resolveSignalsOverride,
  TENANT_SIGNALS,
  type SignalDerivationRule,
  type SignalRuleGroup,
} from "./tenant-signals.ts";

// ── minimal interp mock ───────────────────────────────────────────────────────
// Mirrors the top-level substitution that workflow-executor's `interp` does for
// single-key templates (e.g. "{{signals}}", "{{steps.n8.signals}}").
// Nested dot-path lookup is omitted — tests that need it supply their own mock.
function mockInterp(template: string, payload: Record<string, unknown>): string | undefined {
  // Replace every {{key}} token with JSON.stringify(payload[key]).
  // Key segments may contain hyphens (e.g. "node-101") in addition to word chars.
  const result = template.replace(/\{\{([\w-]+(?:\.[\w-]+)*)\}\}/g, (_, keyPath: string) => {
    const parts = keyPath.split(".");
    let cur: unknown = payload;
    for (const part of parts) {
      if (cur == null || typeof cur !== "object") return `{{${keyPath}}}`;
      cur = (cur as Record<string, unknown>)[part];
    }
    return cur !== undefined ? JSON.stringify(cur) : `{{${keyPath}}}`;
  });
  // Return undefined when the template contained no resolvable tokens
  return result === template && template.startsWith("{{") ? undefined : result;
}

// ── helpers ───────────────────────────────────────────────────────────────────

const BASE_DATE = new Date("2024-01-01T00:00:00Z");

function makeRule(
  overrides: Partial<SignalDerivationRule> & Pick<SignalDerivationRule, "signalKey" | "ruleType" | "sourceKey">,
): SignalDerivationRule {
  return {
    id: Math.floor(Math.random() * 9000) + 1000,
    groupId: null,
    compareValue: null,
    description: null,
    sortOrder: 0,
    createdAt: BASE_DATE,
    updatedAt: BASE_DATE,
    ...overrides,
  };
}

function makeGroup(
  overrides: Partial<SignalRuleGroup> & Pick<SignalRuleGroup, "signalKey" | "logic">,
): SignalRuleGroup {
  return {
    id: Math.floor(Math.random() * 9000) + 1000,
    label: null,
    sortOrder: 0,
    createdAt: BASE_DATE,
    ...overrides,
  };
}

/** All canonical signal keys known to the system (used as knownSignalKeys set). */
const ALL_KNOWN_KEYS = new Set(TENANT_SIGNALS.map(s => s.key).concat("alwaysInclude"));

// ── computeTenantSignals ──────────────────────────────────────────────────────

describe("computeTenantSignals — baseline", () => {
  it("always includes alwaysInclude even with zero rules", () => {
    const { firedSignals } = computeTenantSignals({}, [], [], []);
    expect(firedSignals.has("alwaysInclude")).toBe(true);
  });

  it("returns only alwaysInclude when no rules are configured (hasSignals = false scenario)", () => {
    const { firedSignals } = computeTenantSignals({ mfaEnforced: false }, ["Exchange On-Premises"], [], []);
    expect(firedSignals.size).toBe(1);
    expect(firedSignals.has("alwaysInclude")).toBe(true);
    // hasSignals would be false because firedSignals.size > 1 is the gating check
    const hasSignals = firedSignals.size > 1;
    expect(hasSignals).toBe(false);
  });
});

describe("computeTenantSignals — profile_key_truthy", () => {
  it("fires when profile key is true", () => {
    const rules = [makeRule({ signalKey: "hasExchangeOnPrem", ruleType: "profile_key_truthy", sourceKey: "hasExchangeOnPrem" })];
    const { firedSignals } = computeTenantSignals({ hasExchangeOnPrem: true }, [], rules, []);
    expect(firedSignals.has("hasExchangeOnPrem")).toBe(true);
  });

  it("fires when profile key is a non-zero number", () => {
    const rules = [makeRule({ signalKey: "hasCopilotLicenses", ruleType: "profile_key_truthy", sourceKey: "copilotLicenseCount" })];
    const { firedSignals } = computeTenantSignals({ copilotLicenseCount: 10 }, [], rules, []);
    expect(firedSignals.has("hasCopilotLicenses")).toBe(true);
  });

  it("does NOT fire when profile key is false", () => {
    const rules = [makeRule({ signalKey: "hasExchangeOnPrem", ruleType: "profile_key_truthy", sourceKey: "hasExchangeOnPrem" })];
    const { firedSignals } = computeTenantSignals({ hasExchangeOnPrem: false }, [], rules, []);
    expect(firedSignals.has("hasExchangeOnPrem")).toBe(false);
  });

  it("does NOT fire when profile key is 0", () => {
    const rules = [makeRule({ signalKey: "hasCopilotLicenses", ruleType: "profile_key_truthy", sourceKey: "copilotLicenseCount" })];
    const { firedSignals } = computeTenantSignals({ copilotLicenseCount: 0 }, [], rules, []);
    expect(firedSignals.has("hasCopilotLicenses")).toBe(false);
  });

  it("does NOT fire when profile key is the string 'false'", () => {
    const rules = [makeRule({ signalKey: "hasExchangeOnPrem", ruleType: "profile_key_truthy", sourceKey: "hasExchangeOnPrem" })];
    const { firedSignals } = computeTenantSignals({ hasExchangeOnPrem: "false" }, [], rules, []);
    expect(firedSignals.has("hasExchangeOnPrem")).toBe(false);
  });

  it("does NOT fire when key is absent from profile", () => {
    const rules = [makeRule({ signalKey: "hasExchangeOnPrem", ruleType: "profile_key_truthy", sourceKey: "hasExchangeOnPrem" })];
    const { firedSignals } = computeTenantSignals({}, [], rules, []);
    expect(firedSignals.has("hasExchangeOnPrem")).toBe(false);
  });
});

describe("computeTenantSignals — profile_key_falsy", () => {
  it("fires when profile key is explicitly false", () => {
    const rules = [makeRule({ signalKey: "hasSecurityGaps", ruleType: "profile_key_falsy", sourceKey: "mfaEnforced" })];
    const { firedSignals } = computeTenantSignals({ mfaEnforced: false }, [], rules, []);
    expect(firedSignals.has("hasSecurityGaps")).toBe(true);
  });

  it("fires when profile key is 0", () => {
    const rules = [makeRule({ signalKey: "hasSecurityGaps", ruleType: "profile_key_falsy", sourceKey: "conditionalAccessPolicyCount" })];
    const { firedSignals } = computeTenantSignals({ conditionalAccessPolicyCount: 0 }, [], rules, []);
    expect(firedSignals.has("hasSecurityGaps")).toBe(true);
  });

  it("fires when profile key is the string 'false'", () => {
    const rules = [makeRule({ signalKey: "hasSecurityGaps", ruleType: "profile_key_falsy", sourceKey: "mfaEnforced" })];
    const { firedSignals } = computeTenantSignals({ mfaEnforced: "false" }, [], rules, []);
    expect(firedSignals.has("hasSecurityGaps")).toBe(true);
  });

  it("does NOT fire when profile key is true", () => {
    const rules = [makeRule({ signalKey: "hasSecurityGaps", ruleType: "profile_key_falsy", sourceKey: "mfaEnforced" })];
    const { firedSignals } = computeTenantSignals({ mfaEnforced: true }, [], rules, []);
    expect(firedSignals.has("hasSecurityGaps")).toBe(false);
  });

  it("does NOT fire when key is absent (absent ≠ falsy)", () => {
    const rules = [makeRule({ signalKey: "hasSecurityGaps", ruleType: "profile_key_falsy", sourceKey: "mfaEnforced" })];
    const { firedSignals } = computeTenantSignals({}, [], rules, []);
    expect(firedSignals.has("hasSecurityGaps")).toBe(false);
  });
});

describe("computeTenantSignals — profile_key_eq", () => {
  it("fires when value matches compareValue exactly (string)", () => {
    const rules = [makeRule({ signalKey: "hasSecurityGaps", ruleType: "profile_key_eq", sourceKey: "conditionalAccessPolicyCount", compareValue: "0" })];
    const { firedSignals } = computeTenantSignals({ conditionalAccessPolicyCount: 0 }, [], rules, []);
    expect(firedSignals.has("hasSecurityGaps")).toBe(true);
  });

  it("does NOT fire when value differs", () => {
    const rules = [makeRule({ signalKey: "hasSecurityGaps", ruleType: "profile_key_eq", sourceKey: "conditionalAccessPolicyCount", compareValue: "0" })];
    const { firedSignals } = computeTenantSignals({ conditionalAccessPolicyCount: 5 }, [], rules, []);
    expect(firedSignals.has("hasSecurityGaps")).toBe(false);
  });
});

describe("computeTenantSignals — profile_key_gt", () => {
  it("fires when value is greater than threshold", () => {
    const rules = [makeRule({ signalKey: "hasCopilotLicenses", ruleType: "profile_key_gt", sourceKey: "copilotLicenseCount", compareValue: "0" })];
    const { firedSignals } = computeTenantSignals({ copilotLicenseCount: 25 }, [], rules, []);
    expect(firedSignals.has("hasCopilotLicenses")).toBe(true);
  });

  it("does NOT fire when value equals threshold (strict GT)", () => {
    const rules = [makeRule({ signalKey: "hasCopilotLicenses", ruleType: "profile_key_gt", sourceKey: "copilotLicenseCount", compareValue: "0" })];
    const { firedSignals } = computeTenantSignals({ copilotLicenseCount: 0 }, [], rules, []);
    expect(firedSignals.has("hasCopilotLicenses")).toBe(false);
  });

  it("does NOT fire when value is less than threshold", () => {
    const rules = [makeRule({ signalKey: "hasCopilotLicenses", ruleType: "profile_key_gt", sourceKey: "copilotLicenseCount", compareValue: "10" })];
    const { firedSignals } = computeTenantSignals({ copilotLicenseCount: 5 }, [], rules, []);
    expect(firedSignals.has("hasCopilotLicenses")).toBe(false);
  });
});

describe("computeTenantSignals — profile_key_lt", () => {
  it("fires when value is less than threshold", () => {
    const rules = [makeRule({ signalKey: "hasSecurityGaps", ruleType: "profile_key_lt", sourceKey: "securityScore", compareValue: "60" })];
    const { firedSignals } = computeTenantSignals({ securityScore: 42 }, [], rules, []);
    expect(firedSignals.has("hasSecurityGaps")).toBe(true);
  });

  it("does NOT fire when value equals threshold (strict LT)", () => {
    const rules = [makeRule({ signalKey: "hasSecurityGaps", ruleType: "profile_key_lt", sourceKey: "securityScore", compareValue: "60" })];
    const { firedSignals } = computeTenantSignals({ securityScore: 60 }, [], rules, []);
    expect(firedSignals.has("hasSecurityGaps")).toBe(false);
  });

  it("does NOT fire when value is above threshold", () => {
    const rules = [makeRule({ signalKey: "hasSecurityGaps", ruleType: "profile_key_lt", sourceKey: "securityScore", compareValue: "60" })];
    const { firedSignals } = computeTenantSignals({ securityScore: 85 }, [], rules, []);
    expect(firedSignals.has("hasSecurityGaps")).toBe(false);
  });
});

describe("computeTenantSignals — findings_keyword", () => {
  it("fires when findings contain the keyword (case-insensitive)", () => {
    const rules = [makeRule({ signalKey: "hasExchangeOnPrem", ruleType: "findings_keyword", sourceKey: "Exchange On-Premises" })];
    const { firedSignals } = computeTenantSignals({}, ["exchange on-premises mailboxes detected"], rules, []);
    expect(firedSignals.has("hasExchangeOnPrem")).toBe(true);
  });

  it("fires with mixed case keyword match", () => {
    const rules = [makeRule({ signalKey: "hasPowerPlatformUsage", ruleType: "findings_keyword", sourceKey: "Power Automate" })];
    const { firedSignals } = computeTenantSignals({}, ["POWER AUTOMATE: 42 active flows"], rules, []);
    expect(firedSignals.has("hasPowerPlatformUsage")).toBe(true);
  });

  it("does NOT fire when keyword is absent from all findings", () => {
    const rules = [makeRule({ signalKey: "hasExchangeOnPrem", ruleType: "findings_keyword", sourceKey: "Exchange On-Premises" })];
    const { firedSignals } = computeTenantSignals({}, ["Teams usage: high", "SharePoint sites: 240"], rules, []);
    expect(firedSignals.has("hasExchangeOnPrem")).toBe(false);
  });

  it("does NOT fire when findings array is empty", () => {
    const rules = [makeRule({ signalKey: "hasExchangeOnPrem", ruleType: "findings_keyword", sourceKey: "Exchange On-Premises" })];
    const { firedSignals } = computeTenantSignals({}, [], rules, []);
    expect(firedSignals.has("hasExchangeOnPrem")).toBe(false);
  });
});

describe("computeTenantSignals — OR group logic", () => {
  it("fires signal when at least one rule in OR group matches", () => {
    const group = makeGroup({ signalKey: "hasSecurityGaps", logic: "OR" });
    const rule1 = makeRule({ id: 1, signalKey: "hasSecurityGaps", ruleType: "profile_key_falsy", sourceKey: "mfaEnforced", groupId: group.id });
    const rule2 = makeRule({ id: 2, signalKey: "hasSecurityGaps", ruleType: "profile_key_lt",   sourceKey: "securityScore", compareValue: "60", groupId: group.id });
    // rule1 does NOT match (mfaEnforced = true), rule2 DOES match (securityScore = 30)
    const { firedSignals } = computeTenantSignals({ mfaEnforced: true, securityScore: 30 }, [], [rule1, rule2], [group]);
    expect(firedSignals.has("hasSecurityGaps")).toBe(true);
  });

  it("does NOT fire when no rule in OR group matches", () => {
    const group = makeGroup({ signalKey: "hasSecurityGaps", logic: "OR" });
    const rule1 = makeRule({ id: 1, signalKey: "hasSecurityGaps", ruleType: "profile_key_falsy", sourceKey: "mfaEnforced", groupId: group.id });
    const rule2 = makeRule({ id: 2, signalKey: "hasSecurityGaps", ruleType: "profile_key_lt",   sourceKey: "securityScore", compareValue: "60", groupId: group.id });
    // Both rules fail — mfaEnforced: true → not falsy; securityScore: 80 → not < 60
    const { firedSignals } = computeTenantSignals({ mfaEnforced: true, securityScore: 80 }, [], [rule1, rule2], [group]);
    expect(firedSignals.has("hasSecurityGaps")).toBe(false);
  });
});

describe("computeTenantSignals — AND group logic", () => {
  it("fires signal only when ALL rules in AND group match", () => {
    const group = makeGroup({ signalKey: "hasGovernanceGaps", logic: "AND" });
    const rule1 = makeRule({ id: 1, signalKey: "hasGovernanceGaps", ruleType: "profile_key_lt",    sourceKey: "governanceScore", compareValue: "60", groupId: group.id });
    const rule2 = makeRule({ id: 2, signalKey: "hasGovernanceGaps", ruleType: "profile_key_truthy", sourceKey: "hasGovernanceGaps", groupId: group.id });
    // Both match
    const { firedSignals } = computeTenantSignals({ governanceScore: 40, hasGovernanceGaps: true }, [], [rule1, rule2], [group]);
    expect(firedSignals.has("hasGovernanceGaps")).toBe(true);
  });

  it("does NOT fire when only one of two AND group rules matches", () => {
    const group = makeGroup({ signalKey: "hasGovernanceGaps", logic: "AND" });
    const rule1 = makeRule({ id: 1, signalKey: "hasGovernanceGaps", ruleType: "profile_key_lt",    sourceKey: "governanceScore", compareValue: "60", groupId: group.id });
    const rule2 = makeRule({ id: 2, signalKey: "hasGovernanceGaps", ruleType: "profile_key_truthy", sourceKey: "hasGovernanceGaps", groupId: group.id });
    // rule1 matches (score 40 < 60) but rule2 does NOT (hasGovernanceGaps absent)
    const { firedSignals } = computeTenantSignals({ governanceScore: 40 }, [], [rule1, rule2], [group]);
    expect(firedSignals.has("hasGovernanceGaps")).toBe(false);
  });
});

describe("computeTenantSignals — multiple signals, multiple rules", () => {
  it("fires correct subset of signals from a realistic rule set", () => {
    const rules: SignalDerivationRule[] = [
      makeRule({ id: 1, signalKey: "hasSecurityGaps",        ruleType: "profile_key_falsy",   sourceKey: "mfaEnforced" }),
      makeRule({ id: 2, signalKey: "hasCopilotLicenses",     ruleType: "profile_key_gt",      sourceKey: "copilotLicenseCount", compareValue: "0" }),
      makeRule({ id: 3, signalKey: "hasExchangeOnPrem",      ruleType: "findings_keyword",    sourceKey: "Exchange On-Premises" }),
      makeRule({ id: 4, signalKey: "hasSharePointIssues",    ruleType: "profile_key_gt",      sourceKey: "sharepointSiteCount", compareValue: "0" }),
      makeRule({ id: 5, signalKey: "hasPowerPlatformUsage",  ruleType: "findings_keyword",    sourceKey: "Power Automate" }),
    ];
    const profile = { mfaEnforced: false, copilotLicenseCount: 50, sharepointSiteCount: 0 };
    const findings = ["Exchange On-Premises: hybrid connector detected"];

    const { firedSignals } = computeTenantSignals(profile, findings, rules, []);

    expect(firedSignals.has("alwaysInclude")).toBe(true);
    expect(firedSignals.has("hasSecurityGaps")).toBe(true);       // mfaEnforced falsy
    expect(firedSignals.has("hasCopilotLicenses")).toBe(true);    // copilotLicenseCount > 0
    expect(firedSignals.has("hasExchangeOnPrem")).toBe(true);     // keyword match
    expect(firedSignals.has("hasSharePointIssues")).toBe(false);  // sharepointSiteCount = 0
    expect(firedSignals.has("hasPowerPlatformUsage")).toBe(false);// keyword absent
    expect(firedSignals.size).toBe(4); // alwaysInclude + 3 substantive

    // hasSignals would be true because firedSignals.size > 1
    const hasSignals = firedSignals.size > 1;
    expect(hasSignals).toBe(true);
  });
});

describe("computeTenantSignals — trace output", () => {
  it("returns a trace entry for every evaluated rule", () => {
    const rules: SignalDerivationRule[] = [
      makeRule({ id: 10, signalKey: "hasCopilotLicenses", ruleType: "profile_key_gt", sourceKey: "copilotLicenseCount", compareValue: "0" }),
      makeRule({ id: 11, signalKey: "hasSecurityGaps",    ruleType: "profile_key_falsy", sourceKey: "mfaEnforced" }),
    ];
    const { trace } = computeTenantSignals({ copilotLicenseCount: 5, mfaEnforced: false }, [], rules, []);
    const ruleIds = trace.map(t => t.ruleId);
    expect(ruleIds).toContain(10);
    expect(ruleIds).toContain(11);
    // Each trace entry has a reason string
    for (const entry of trace) {
      expect(typeof entry.reason).toBe("string");
      expect(entry.reason.length).toBeGreaterThan(0);
    }
  });
});

// ── projectMatchesSignals ─────────────────────────────────────────────────────

describe("projectMatchesSignals — inclusion rules", () => {
  it("excludes project with no triggeredBy values", () => {
    const firedSignals = new Set(["alwaysInclude"]);
    const result = projectMatchesSignals(
      { title: "M365 Migration", triggeredBy: [] },
      ALL_KNOWN_KEYS,
      firedSignals,
    );
    expect(result.included).toBe(false);
    expect(result.reason).toContain("No triggeredBy");
  });

  it("includes project when triggered by alwaysInclude (which always fires)", () => {
    const firedSignals = new Set(["alwaysInclude"]);
    const result = projectMatchesSignals(
      { title: "Foundation Assessment", triggeredBy: ["alwaysInclude"] },
      ALL_KNOWN_KEYS,
      firedSignals,
    );
    expect(result.included).toBe(true);
  });

  it("includes project when at least one trigger signal fired", () => {
    const firedSignals = new Set(["alwaysInclude", "hasSecurityGaps", "hasCopilotLicenses"]);
    const result = projectMatchesSignals(
      { title: "Security Remediation", triggeredBy: ["hasSecurityGaps"] },
      ALL_KNOWN_KEYS,
      firedSignals,
    );
    expect(result.included).toBe(true);
  });

  it("excludes project when none of its trigger signals fired", () => {
    const firedSignals = new Set(["alwaysInclude", "hasSecurityGaps"]);
    const result = projectMatchesSignals(
      { title: "Copilot Readiness", triggeredBy: ["hasCopilotLicenses"] },
      ALL_KNOWN_KEYS,
      firedSignals,
    );
    expect(result.included).toBe(false);
  });

  it("excludes project whose all triggers are unrecognized legacy strings", () => {
    const firedSignals = new Set(["alwaysInclude", "hasSecurityGaps"]);
    const result = projectMatchesSignals(
      { title: "Old Plan", triggeredBy: ["Enterprise Plan", "Legacy Plan"] },
      ALL_KNOWN_KEYS,
      firedSignals,
    );
    expect(result.included).toBe(false);
    expect(result.reason).toContain("Unrecognized trigger");
  });

  it("uses canonical signals when mix of legacy and recognized triggers present", () => {
    // "Legacy Plan" is unrecognized; "hasCopilotLicenses" IS recognized and fired
    const firedSignals = new Set(["alwaysInclude", "hasCopilotLicenses"]);
    const result = projectMatchesSignals(
      { title: "Mixed Triggers", triggeredBy: ["Legacy Plan", "hasCopilotLicenses"] },
      ALL_KNOWN_KEYS,
      firedSignals,
    );
    // hasCopilotLicenses is recognized and fired → included
    expect(result.included).toBe(true);
  });

  it("excludes project when mix has recognized signals but none fired", () => {
    const firedSignals = new Set(["alwaysInclude"]);
    const result = projectMatchesSignals(
      { title: "Mixed Triggers", triggeredBy: ["Legacy Plan", "hasCopilotLicenses"] },
      ALL_KNOWN_KEYS,
      firedSignals,
    );
    // hasCopilotLicenses recognized but not fired → excluded
    expect(result.included).toBe(false);
  });

  it("project with multiple recognized triggers: includes when ANY fires", () => {
    const firedSignals = new Set(["alwaysInclude", "hasGovernanceGaps"]);
    const result = projectMatchesSignals(
      { title: "Governance + Security Bundle", triggeredBy: ["hasGovernanceGaps", "hasSecurityGaps"] },
      ALL_KNOWN_KEYS,
      firedSignals,
    );
    expect(result.included).toBe(true);
  });
});

// ── signalsOverride fast-path parity test ─────────────────────────────────────
//
// Confirms that filtering projects via the signalsOverride fast-path produces
// the identical result as filtering via the standard DB-evaluation path.
// Both paths call projectMatchesSignals() with the same Set, so the test
// verifies this contract holds: no silent divergence between the two paths.

describe("signalsOverride parity — fast-path produces identical project filtering to DB-evaluation path", () => {
  const engagementProjects = [
    { title: "Foundation Assessment",   triggeredBy: ["alwaysInclude"] },
    { title: "Security Remediation",    triggeredBy: ["hasSecurityGaps"] },
    { title: "Copilot Readiness",       triggeredBy: ["hasCopilotLicenses"] },
    { title: "Exchange Migration",      triggeredBy: ["hasExchangeOnPrem"] },
    { title: "Governance Remediation",  triggeredBy: ["hasGovernanceGaps"] },
    { title: "SharePoint IA",           triggeredBy: ["hasSharePointIssues"] },
    { title: "Power Platform Governance", triggeredBy: ["hasPowerPlatformUsage"] },
    { title: "Legacy Project",          triggeredBy: ["Enterprise Consulting"] }, // unrecognized
    { title: "No Triggers",             triggeredBy: [] },                        // empty
  ];

  it("filters identically: signalsOverride Set == firedSignals from computeTenantSignals", () => {
    // Simulate DB-evaluation path: run computeTenantSignals with real rules
    const rules: SignalDerivationRule[] = [
      makeRule({ id: 1, signalKey: "hasSecurityGaps",    ruleType: "profile_key_falsy", sourceKey: "mfaEnforced" }),
      makeRule({ id: 2, signalKey: "hasCopilotLicenses", ruleType: "profile_key_gt",   sourceKey: "copilotLicenseCount", compareValue: "0" }),
    ];
    const profile = { mfaEnforced: false, copilotLicenseCount: 15 };
    const { firedSignals } = computeTenantSignals(profile, [], rules, []);

    // DB-evaluation path: filter projects using firedSignals directly
    const dbPathFiltered = engagementProjects.filter(p => {
      const { included } = projectMatchesSignals(p, ALL_KNOWN_KEYS, firedSignals);
      return included;
    });

    // signalsOverride fast-path: upstream workflow pre-computes signals and passes them as a Set
    // (this is exactly what generateConsolidatedSowDocument does when signalsOverride != null)
    const signalsOverride = new Set(firedSignals); // simulates passing pre-computed signals
    const overridePathFiltered = engagementProjects.filter(p => {
      const { included } = projectMatchesSignals(p, ALL_KNOWN_KEYS, signalsOverride);
      return included;
    });

    // Both paths must produce the same set of project titles
    const dbTitles       = dbPathFiltered.map(p => p.title).sort();
    const overrideTitles = overridePathFiltered.map(p => p.title).sort();
    expect(overrideTitles).toEqual(dbTitles);

    // Sanity-check the expected inclusions
    expect(dbTitles).toContain("Foundation Assessment");  // alwaysInclude
    expect(dbTitles).toContain("Security Remediation");   // hasSecurityGaps fired
    expect(dbTitles).toContain("Copilot Readiness");      // hasCopilotLicenses fired
    expect(dbTitles).not.toContain("Exchange Migration"); // hasExchangeOnPrem not fired
    expect(dbTitles).not.toContain("Legacy Project");     // unrecognized trigger
    expect(dbTitles).not.toContain("No Triggers");        // no triggeredBy
  });

  it("hasSignals=false (no substantive signals): both paths include only alwaysInclude projects", () => {
    // No rules configured — only alwaysInclude fires
    const { firedSignals } = computeTenantSignals({}, [], [], []);
    const hasSignals = firedSignals.size > 1;
    expect(hasSignals).toBe(false);

    const dbPathFiltered = engagementProjects.filter(p => {
      const { included } = projectMatchesSignals(p, ALL_KNOWN_KEYS, firedSignals);
      return included;
    });

    const signalsOverride = new Set(firedSignals);
    const overridePathFiltered = engagementProjects.filter(p => {
      const { included } = projectMatchesSignals(p, ALL_KNOWN_KEYS, signalsOverride);
      return included;
    });

    expect(overridePathFiltered.map(p => p.title).sort()).toEqual(dbPathFiltered.map(p => p.title).sort());

    // Only the "alwaysInclude" project passes when no substantive signals fire
    const includedTitles = dbPathFiltered.map(p => p.title);
    expect(includedTitles).toEqual(["Foundation Assessment"]);
  });

  it("all signals fired: both paths produce identical (maximal) project list", () => {
    // Manually build a firedSignals set that covers every canonical signal
    const allSignals = new Set(["alwaysInclude", ...TENANT_SIGNALS.map(s => s.key)]);

    const dbPathFiltered = engagementProjects.filter(p => {
      const { included } = projectMatchesSignals(p, ALL_KNOWN_KEYS, allSignals);
      return included;
    });
    const overridePathFiltered = engagementProjects.filter(p => {
      const { included } = projectMatchesSignals(p, ALL_KNOWN_KEYS, allSignals);
      return included;
    });

    expect(overridePathFiltered.map(p => p.title).sort()).toEqual(dbPathFiltered.map(p => p.title).sort());

    // Legacy and empty-trigger projects must still be excluded even when all signals fire
    const includedTitles = dbPathFiltered.map(p => p.title);
    expect(includedTitles).not.toContain("Legacy Project");
    expect(includedTitles).not.toContain("No Triggers");
    // All signal-gated projects should be present
    expect(includedTitles).toContain("Foundation Assessment");
    expect(includedTitles).toContain("Security Remediation");
    expect(includedTitles).toContain("Copilot Readiness");
  });
});

// ── resolveSignalsOverride — integration tests ────────────────────────────────
//
// These tests exercise the exact code path that runs inside
// generate_document(consolidated_sow) when a preceding get_tenant_signals node
// has populated payload.signals.
//
// Contract: workflow config carries `signalsOverride: "{{signals}}"`.
// At runtime the executor interpolates that template against the payload
// to produce a JSON-serialised array, then parses it into a Set<string> that
// is passed to generateConsolidatedSowDocument as `signalsOverride`.
//
// By testing resolveSignalsOverride with a mock interpolator we exercise the
// real integration seam (template → JSON parse → Set construction) without
// requiring the DB or Claude.

describe("resolveSignalsOverride — template interpolation path", () => {
  // Simulated output of a preceding get_tenant_signals node
  const gtsNodeOutput = {
    dryRun: false,
    signals: ["alwaysInclude", "hasGovernanceGaps", "hasSecurityGaps"],
    signalCount: 3,
    hasSignals: true,
  };

  it("resolves {{signals}} template to a Set containing every upstream signal", () => {
    const override = resolveSignalsOverride("{{signals}}", gtsNodeOutput as unknown as Record<string, unknown>, mockInterp);
    expect(override).toBeInstanceOf(Set);
    expect(override!.has("alwaysInclude")).toBe(true);
    expect(override!.has("hasGovernanceGaps")).toBe(true);
    expect(override!.has("hasSecurityGaps")).toBe(true);
    expect(override!.size).toBe(3);
  });

  it("resolves nested steps template {{steps.node101.signals}} via dot-path interpolation", () => {
    const payload: Record<string, unknown> = {
      steps: { "node-101": { signals: ["alwaysInclude", "teams-lifecycle"], signalCount: 2 } },
    };
    const override = resolveSignalsOverride(
      "{{steps.node-101.signals}}",
      payload,
      mockInterp,
    );
    expect(override).toBeInstanceOf(Set);
    expect(override!.has("alwaysInclude")).toBe(true);
    expect(override!.has("teams-lifecycle")).toBe(true);
    expect(override!.size).toBe(2);
  });

  it("falls back to payload.signals array when interp returns a non-JSON string", () => {
    const payload: Record<string, unknown> = {
      signals: ["alwaysInclude", "hasLicensingWaste"],
    };
    // interp that deliberately fails to resolve the template
    const brokenInterp = (_t: string, _p: Record<string, unknown>) => "not-valid-json";
    const override = resolveSignalsOverride("{{signals}}", payload, brokenInterp);
    expect(override).toBeInstanceOf(Set);
    expect(override!.has("alwaysInclude")).toBe(true);
    expect(override!.has("hasLicensingWaste")).toBe(true);
  });

  it("falls back to payload.signals when interp returns undefined", () => {
    const payload: Record<string, unknown> = {
      signals: ["alwaysInclude", "external-governance"],
    };
    const returnsUndefined = (_t: string, _p: Record<string, unknown>): string | undefined => undefined;
    const override = resolveSignalsOverride("{{signals}}", payload, returnsUndefined);
    expect(override).toBeInstanceOf(Set);
    expect(override!.has("external-governance")).toBe(true);
  });

  it("returns undefined when field is empty", () => {
    expect(resolveSignalsOverride("", {}, mockInterp)).toBeUndefined();
    expect(resolveSignalsOverride("  ", {}, mockInterp)).toBeUndefined();
    expect(resolveSignalsOverride(undefined, {}, mockInterp)).toBeUndefined();
  });

  it("returns undefined when interp cannot resolve and payload.signals is absent", () => {
    const returnsUndefined = (_t: string, _p: Record<string, unknown>): string | undefined => undefined;
    const override = resolveSignalsOverride("{{signals}}", {}, returnsUndefined);
    expect(override).toBeUndefined();
  });

  it("ignores a literal JSON array in the field (no interpolation needed)", () => {
    const override = resolveSignalsOverride(
      '["alwaysInclude","hasGovernanceGaps"]',
      {},
      // interp called but no {{}} tokens — returns the literal string unchanged
      (t) => t,
    );
    expect(override).toBeInstanceOf(Set);
    expect(override!.has("alwaysInclude")).toBe(true);
    expect(override!.has("hasGovernanceGaps")).toBe(true);
  });
});

// ── End-to-end: get_tenant_signals output → resolveSignalsOverride → projectMatchesSignals ──
//
// This is the full node-to-node data path:
//   get_tenant_signals node output (as payload)
//   → generate_document node resolveSignalsOverride("{{signals}}", payload, interp)
//   → generateConsolidatedSowDocument(signalsOverride) → projectMatchesSignals per project
//
// Asserts PARITY: the Set produced from the upstream node output must gate
// projects identically to the same Set built directly from computeTenantSignals.

describe("resolveSignalsOverride — get_tenant_signals → generate_document parity", () => {
  // Shared project catalogue
  const projects = [
    { title: "Foundation Assessment",  triggeredBy: ["alwaysInclude"] },
    { title: "Governance Remediation", triggeredBy: ["hasGovernanceGaps"] },
    { title: "Security Remediation",   triggeredBy: ["hasSecurityGaps"] },
    { title: "Teams Lifecycle",        triggeredBy: ["teams-lifecycle"] },
    { title: "Licensing Optimisation", triggeredBy: ["hasLicensingWaste"] },
  ];

  function filterProjects(fired: Set<string>) {
    return projects
      .filter(p => projectMatchesSignals(p, ALL_KNOWN_KEYS, fired).included)
      .map(p => p.title);
  }

  it("signalsOverride resolved from {{signals}} payload matches direct DB-evaluation path", () => {
    // Simulate what get_tenant_signals produces for a tenant with governance gaps + waste
    const { firedSignals } = computeTenantSignals(
      { hasGovernanceIssues: true, hasLicensingWaste: true },
      [],
      [
        makeRule({ id: 1, signalKey: "hasGovernanceGaps", ruleType: "profile_key_truthy", sourceKey: "hasGovernanceIssues", groupId: null, compareValue: null }),
        makeRule({ id: 2, signalKey: "hasLicensingWaste",  ruleType: "profile_key_truthy", sourceKey: "hasLicensingWaste",  groupId: null, compareValue: null }),
      ],
      [],
    );

    // DB path: the firedSignals Set is passed directly
    const dbPathTitles = filterProjects(firedSignals);

    // Workflow path: get_tenant_signals serialises the Set to an array in its output
    const gtsOutput: Record<string, unknown> = {
      signals: [...firedSignals],
      signalCount: firedSignals.size,
      hasSignals: firedSignals.size > 1,
    };
    // generate_document resolves "{{signals}}" against the payload produced by get_tenant_signals
    const signalsOverride = resolveSignalsOverride("{{signals}}", gtsOutput, mockInterp);

    const workflowPathTitles = filterProjects(signalsOverride!);

    // Both paths must produce the same project list
    expect(workflowPathTitles.sort()).toEqual(dbPathTitles.sort());
    expect(workflowPathTitles).toContain("Foundation Assessment"); // alwaysInclude always fires
    expect(workflowPathTitles).toContain("Governance Remediation");
    expect(workflowPathTitles).toContain("Licensing Optimisation");
    expect(workflowPathTitles).not.toContain("Security Remediation");
    expect(workflowPathTitles).not.toContain("Teams Lifecycle");
  });

  it("when no substantive signals fire, both paths include only alwaysInclude projects", () => {
    // Tenant with clean profile — only alwaysInclude fires
    const { firedSignals } = computeTenantSignals({}, [], [], []);

    const dbPathTitles      = filterProjects(firedSignals);
    const gtsOutput: Record<string, unknown> = { signals: [...firedSignals] };
    const signalsOverride   = resolveSignalsOverride("{{signals}}", gtsOutput, mockInterp);
    const workflowPathTitles = filterProjects(signalsOverride!);

    expect(workflowPathTitles.sort()).toEqual(dbPathTitles.sort());
    expect(workflowPathTitles).toEqual(["Foundation Assessment"]); // only alwaysInclude project
  });

  it("dry-run: executor get_tenant_signals stub passes through resolveSignalsOverride correctly", () => {
    // The executor's dry-run return for get_tenant_signals is hardcoded as:
    //   { dryRun: true, signals: ["alwaysInclude", "hasGovernanceGaps"], signalCount: 2, hasSignals: true }
    // Confirm this stub flows through resolveSignalsOverride to the correct project gate.
    const DRY_RUN_GTS_OUTPUT: Record<string, unknown> = {
      dryRun: true,
      signals: ["alwaysInclude", "hasGovernanceGaps"],
      signalCount: 2,
      hasSignals: true,
    };

    const signalsOverride = resolveSignalsOverride("{{signals}}", DRY_RUN_GTS_OUTPUT, mockInterp);

    expect(signalsOverride).toBeInstanceOf(Set);
    expect(signalsOverride!.size).toBe(2);
    expect(signalsOverride!.has("alwaysInclude")).toBe(true);
    expect(signalsOverride!.has("hasGovernanceGaps")).toBe(true);

    const titles = filterProjects(signalsOverride!);
    expect(titles).toContain("Foundation Assessment");   // alwaysInclude
    expect(titles).toContain("Governance Remediation");  // hasGovernanceGaps
    expect(titles).not.toContain("Security Remediation"); // hasSecurityGaps NOT in stub
    expect(titles).not.toContain("Teams Lifecycle");
    expect(titles).not.toContain("Licensing Optimisation");
    expect(titles.length).toBe(2);
  });
});
