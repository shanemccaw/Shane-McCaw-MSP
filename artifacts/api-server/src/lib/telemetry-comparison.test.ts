/**
 * telemetry-comparison.test.ts — #245 (Copilot Assessment epic #183).
 *
 * What this locks in is the actual claim of #245: the telemetry page's right
 * panel shows REAL, SCAN-DEPENDENT numbers. Before the change, all four
 * elements were computed from quiz answers × a synthetic progress factor, which
 * means two entirely different tenants scanning entirely different Microsoft 365
 * estates rendered the same panel as long as their quiz answers matched.
 *
 * So the test drives the REAL scoring path — computeHealthEngine +
 * computeSecurityEngine, combined exactly as calculateArchitectureHealthScore
 * combines them — with two DIFFERENT real scan results (different merged
 * profiles, different findings, therefore different fired signals) and asserts
 * every element genuinely moves: the gauge, the radar axes and the gap bars.
 *
 * No DB: the pure engine core is fed directly, which is precisely what
 * buildTelemetryComparison's own DB half hands it in production.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test -- telemetry-comparison
 */

import { describe, it, expect, vi } from "vitest";

// buildTelemetryComparison's DB half is not under test here; the mock only has
// to let the module graph load so the pure exports can be imported.
vi.mock("@workspace/db", () => ({
  db: { select: vi.fn(), selectDistinctOn: vi.fn() },
  mspDiagnosticRunsTable: { __table: "msp_diagnostic_runs", runId: "runId", customerId: "customerId", status: "status", createdAt: "createdAt" },
  mspDiagnosticFindingsTable: { __table: "msp_diagnostic_findings", runId: "runId", customerId: "customerId", severity: "severity", createdAt: "createdAt" },
  monitorChecksTable: { __table: "monitor_checks", key: "key", mapping: "mapping", properties: "properties", requiresCustomerScript: "requiresCustomerScript" },
  monitoringPackageChecksTable: { __table: "monitoring_package_checks", packageKey: "packageKey", checkKey: "checkKey" },
  clientM365ProfilesTable: { __table: "client_m365_profiles" },
  scriptRunResultsTable: { __table: "script_run_results" },
  tenantsTable: { __table: "tenants" },
  usersTable: { __table: "users" },
  tenantMonitorProfilesTable: { __table: "tenant_monitor_profiles" },
  signalDerivationRulesTable: { __table: "signal_derivation_rules" },
  signalRuleGroupsTable: { __table: "signal_rule_groups" },
  customSignalsTable: { __table: "custom_signals" },
}));

vi.mock("./logger", () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

vi.mock("./sla-engine", () => ({
  startSlaTimer: vi.fn(() => Promise.resolve({ timerId: 1, alreadyExisted: false })),
}));

import { computeHealthEngine, type HealthEngineOutput, getSignalHealthImpacts } from "./health-engine.ts";
import { computeSecurityEngine } from "./security-engine.ts";
import { buildPillarViews, rankDiscrepancies, type DiscrepancySeverity } from "./telemetry-comparison.ts";
import type { SignalDerivationRule } from "./tenant-signals.ts";

const BASE_DATE = new Date("2024-01-01T00:00:00Z");

const DEFAULT_INTELLIGENCE_FIELDS = {
  priority: 0,
  weight: 0,
  pricingImpact: 0,
  priorityScoreContribution: 0,
  pricingValueContribution: 0,
  governanceImpact: 0,
  securityImpact: 0,
  complianceImpact: 0,
  adoptionImpact: 0,
  copilotImpact: 0,
  architectureImpact: 0,
  licensingImpact: 0,
  trendValue: 0,
  trendDirection: "flat" as const,
  decayRate: 0,
  ttlDays: 0,
  confidence: 0,
  severity: "low" as const,
  category: "",
  pillar: "",
  crmFitContribution: 0,
  crmPainContribution: 0,
  crmMaturityContribution: 0,
  crmIntentContribution: 0,
  crmUrgencyContribution: 0,
};

let nextRuleId = 1000;
function makeRule(
  overrides: Partial<SignalDerivationRule> & Pick<SignalDerivationRule, "signalKey" | "ruleType" | "sourceKey">,
): SignalDerivationRule {
  return {
    id: nextRuleId++,
    groupId: null,
    compareValue: null,
    denominatorKey: null,
    description: null,
    sortOrder: 0,
    createdAt: BASE_DATE,
    updatedAt: BASE_DATE,
    ...DEFAULT_INTELLIGENCE_FIELDS,
    ...overrides,
  };
}

/**
 * A realistic rule set: TWO signals per pillar, each fired by a profile key a
 * real monitor check genuinely produces. Weights differ per pillar exactly as
 * real seeded rules do, so an equal-weighting bug would show up as identical
 * pillar movement.
 *
 * Two rather than one since #517: a pillar backed by a single evaluable signal
 * is now withheld as `insufficient_data` rather than scored, so a one-per-pillar
 * fixture would null every axis and this file would be testing the coverage
 * floor instead of the panel. The second rule on each pillar reads a profile key
 * present in NEITHER scan, so it widens the denominator without changing which
 * signals fire — every "did this axis move" claim below is unchanged.
 */
const RULES: SignalDerivationRule[] = [
  makeRule({ signalKey: "hasGovernanceGaps", ruleType: "profile_key_truthy", sourceKey: "governanceGapsDetected", governanceImpact: 12 }),
  makeRule({ signalKey: "hasOwnerlessGroups", ruleType: "profile_key_truthy", sourceKey: "ownerlessGroupsDetected", governanceImpact: 12 }),
  makeRule({ signalKey: "hasComplianceGaps", ruleType: "profile_key_truthy", sourceKey: "retentionPolicyMissing", complianceImpact: 9 }),
  makeRule({ signalKey: "hasLabelGaps", ruleType: "profile_key_truthy", sourceKey: "sensitivityLabelsMissing", complianceImpact: 9 }),
  makeRule({ signalKey: "lowAdoption", ruleType: "profile_key_truthy", sourceKey: "teamsAdoptionLow", adoptionImpact: 7 }),
  makeRule({ signalKey: "lowSharePointAdoption", ruleType: "profile_key_truthy", sourceKey: "sharePointAdoptionLow", adoptionImpact: 7 }),
  makeRule({ signalKey: "copilotBlocked", ruleType: "profile_key_truthy", sourceKey: "copilotPrereqMissing", copilotImpact: 15 }),
  makeRule({ signalKey: "copilotUnlicensed", ruleType: "profile_key_truthy", sourceKey: "copilotSeatsUnassigned", copilotImpact: 15 }),
  makeRule({ signalKey: "architectureDrift", ruleType: "profile_key_truthy", sourceKey: "legacyAuthEnabled", architectureImpact: 6 }),
  makeRule({ signalKey: "architectureSprawl", ruleType: "profile_key_truthy", sourceKey: "tenantSprawlDetected", architectureImpact: 6 }),
  makeRule({ signalKey: "licenseWaste", ruleType: "profile_key_truthy", sourceKey: "unassignedSeatsDetected", licensingImpact: 11 }),
  makeRule({ signalKey: "licenseOverlap", ruleType: "profile_key_truthy", sourceKey: "overlappingSkusDetected", licensingImpact: 11 }),
  makeRule({ signalKey: "hasSecurityGaps", ruleType: "profile_key_falsy", sourceKey: "mfaEnforced", securityImpact: 20 }),
  makeRule({ signalKey: "hasCaGaps", ruleType: "profile_key_truthy", sourceKey: "conditionalAccessMissing", securityImpact: 20 }),
];

const ALL_SIGNAL_KEYS = new Set(RULES.map((r) => r.signalKey));

/**
 * Exactly what `calculateArchitectureHealthScore` does in production: the six
 * health pillars from computeHealthEngine, plus the separately-computed security
 * pillar, combined into one output. Kept identical here so the test is scoring a
 * real engine result and not a convenient stand-in.
 */
function runRealScan(profile: Record<string, unknown>, findings: string[]): HealthEngineOutput {
  const health = computeHealthEngine(profile, findings, RULES, []);
  const security = computeSecurityEngine(profile, findings, RULES, []);
  return {
    ...health,
    score: health.score + security.score,
    breakdown: [...health.breakdown, security.breakdown],
  };
}

// ── Two genuinely different real scans ────────────────────────────────────────
//
// SCAN A — a healthier tenant: MFA is enforced, no governance/copilot blockers;
//          only license waste and low Teams adoption fire.
const SCAN_A_PROFILE = {
  mfaEnforced: true,
  unassignedSeatsDetected: true,
  teamsAdoptionLow: true,
};

// SCAN B — the same customer's estate scanned later (or a different tenant
//          entirely): MFA has been turned off, legacy auth is on, retention is
//          missing and Copilot prerequisites are absent. More signals fire, each
//          on a different pillar.
const SCAN_B_PROFILE = {
  mfaEnforced: false,
  unassignedSeatsDetected: true,
  teamsAdoptionLow: true,
  governanceGapsDetected: true,
  retentionPolicyMissing: true,
  copilotPrereqMissing: true,
  legacyAuthEnabled: true,
};

describe("right panel reflects the real scan — two different scans, different numbers", () => {
  const impacts = getSignalHealthImpacts(RULES, []);

  const scanA = buildPillarViews(runRealScan(SCAN_A_PROFILE, []), impacts, ALL_SIGNAL_KEYS);
  const scanB = buildPillarViews(runRealScan(SCAN_B_PROFILE, []), impacts, ALL_SIGNAL_KEYS);

  it("returns all seven REAL pillars, in the engine's own order — not the six invented axes", () => {
    expect(scanA.pillars.map((p) => p.pillar)).toEqual([
      "governance",
      "compliance",
      "adoption",
      "copilot",
      "architecture",
      "licensing",
      "security",
    ]);
    // The axes the old panel drew — Risk Posture / Feasibility / Complexity /
    // Value Levers — are not pillars the engine has ever produced.
    for (const invented of ["Risk Posture", "Feasibility", "Complexity", "Value Levers"]) {
      expect(scanA.pillars.map((p) => p.label)).not.toContain(invented);
    }
  });

  it("the Actual Telemetry gauge differs between the two real scans, and the worse scan scores lower", () => {
    expect(scanA.overall.displayScore).not.toBeNull();
    expect(scanB.overall.displayScore).not.toBeNull();
    expect(scanB.overall.displayScore).not.toBe(scanA.overall.displayScore);
    expect(scanB.overall.displayScore!).toBeLessThan(scanA.overall.displayScore!);
  });

  it("the radar axes differ per pillar — and only on the pillars whose real signals actually changed", () => {
    const a = new Map(scanA.pillars.map((p) => [p.pillar, p.displayScore]));
    const b = new Map(scanB.pillars.map((p) => [p.pillar, p.displayScore]));

    // Changed between the scans: governance, compliance, copilot, architecture,
    // security all gained a fired signal in scan B.
    for (const pillar of ["governance", "compliance", "copilot", "architecture", "security"] as const) {
      expect(b.get(pillar), `${pillar} should have moved`).not.toBe(a.get(pillar));
      expect(b.get(pillar)!).toBeLessThan(a.get(pillar)!);
    }

    // Unchanged: adoption and licensing fired identically in both scans. A panel
    // that moved these too would be reacting to something other than the scan.
    expect(b.get("adoption")).toBe(a.get("adoption"));
    expect(b.get("licensing")).toBe(a.get("licensing"));
  });

  it("every pillar's rawRiskScore is the engine's own breakdown entry — one source behind radar and gap bars", () => {
    const engineOutput = runRealScan(SCAN_B_PROFILE, []);
    const views = buildPillarViews(engineOutput, impacts, ALL_SIGNAL_KEYS);

    for (const pillar of views.pillars) {
      const fromEngine = engineOutput.breakdown.find((b) => b.pillar === pillar.pillar)!;
      expect(pillar.rawRiskScore).toBe(fromEngine.score);
    }

    // The engine's own total, not a re-derivation: health's six pillars plus the
    // separately-scored security pillar.
    expect(views.overall.rawRiskScore).toBe(
      views.pillars.reduce((sum, p) => sum + p.rawRiskScore, 0),
    );
    // Scan B accumulated more raw risk than scan A — the real engine's verdict.
    expect(scanB.overall.rawRiskScore).toBeGreaterThan(scanA.overall.rawRiskScore);
  });

  it("never fabricates a pillar the engine has no evaluable rule for", () => {
    // No rule anywhere configures a copilot impact for this evaluable set.
    const copilotSignals = new Set(["copilotBlocked", "copilotUnlicensed"]);
    const impactsWithoutCopilot = getSignalHealthImpacts(
      RULES.filter((r) => !copilotSignals.has(r.signalKey)),
      [],
    );
    const evaluable = new Set([...ALL_SIGNAL_KEYS].filter((k) => !copilotSignals.has(k)));
    const views = buildPillarViews(runRealScan(SCAN_B_PROFILE, []), impactsWithoutCopilot, evaluable);
    expect(views.pillars.find((p) => p.pillar === "copilot")!.displayScore).toBeNull();
  });
});

describe("rankDiscrepancies — real findings, critical first", () => {
  interface Row {
    severity: DiscrepancySeverity;
    checkKey: string;
    priority?: number | null;
  }

  it("puts every critical above every warning, then orders by the check's own recommendation priority", () => {
    const rows: Row[] = [
      { severity: "warning", checkKey: "identity:legacy-auth", priority: 1 },
      { severity: "critical", checkKey: "security:secure-score", priority: 5 },
      { severity: "critical", checkKey: "identity:ca-policy-count", priority: 2 },
      { severity: "warning", checkKey: "cost:license-waste", priority: null },
    ];
    expect(rankDiscrepancies(rows, 4).map((r) => r.checkKey)).toEqual([
      "identity:ca-policy-count",
      "security:secure-score",
      "identity:legacy-auth",
      "cost:license-waste",
    ]);
  });

  it("is stable for identical severity+priority, so two scans can't disagree on order", () => {
    const rows: Row[] = [
      { severity: "warning", checkKey: "b:check" },
      { severity: "warning", checkKey: "a:check" },
    ];
    expect(rankDiscrepancies(rows, 4).map((r) => r.checkKey)).toEqual(["a:check", "b:check"]);
  });

  it("honours the card's limit", () => {
    const rows: Row[] = Array.from({ length: 9 }, (_, i) => ({
      severity: "warning" as const,
      checkKey: `check:${i}`,
    }));
    expect(rankDiscrepancies(rows, 4)).toHaveLength(4);
  });
});
