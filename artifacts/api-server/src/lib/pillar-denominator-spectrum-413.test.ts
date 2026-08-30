/**
 * pillar-denominator-spectrum-413.test.ts
 *
 * The VERIFICATION half of Git #413, in two parts.
 *
 * Part 1 — WIRING. Drives the real `fetchTenantEvaluableSignalKeys` end to end
 * (only `@workspace/db` is faked, at the same boundary pillar-coverage.test.ts
 * uses) and pins the three things the fix actually changed:
 *   • the denominator a tenant is scored against is the one their scanned
 *     PACKAGE feeds, not the whole monitor_checks catalog;
 *   • a signal that FIRED is always in the denominator, even when its producer
 *     sits outside the package (numerator ⊆ denominator is a precondition of
 *     `100 − raw/max × 100`, not an adjustment to it);
 *   • a tenant with no resolvable scan scope falls back to catalog-wide rather
 *     than silently nulling every pillar.
 *
 * Part 2 — SPECTRUM. Scores three tenant profiles across the real health range
 * through the REAL chain (`computeHealthEngine` + `computeSecurityEngine` →
 * `getSignalHealthImpacts` → `computePillarDisplayScore` /
 * `computeOverallDisplayScore`), under BOTH denominators, and asserts the shape
 * makes sense: a genuinely broken tenant scores meaningfully worse than a
 * middling one, which scores worse than a healthy one — and, critically, that
 * this is only true under the package-scoped denominator. Issue #413's own
 * instruction: "A fix verified against only one real data point is not
 * confirmed, it's just no-longer-visibly-wrong for that one case."
 *
 * ── What is real here and what is modelled, stated plainly ───────────────────
 * REAL, sourced from the repo (same provenance as the investigation harness,
 * health-display-denominator-413.test.ts — see its header for line refs):
 *   • core:security-baseline's 29 check keys (2026-07-21-repopulate-monitoring-
 *     package-checks.sql), assess:copilot-readiness's 7 (admin-simulator-
 *     assessments.test.ts), the 122-check catalog size (pillar-coverage.test.ts)
 *   • the weighting scheme (2026-07-23-close-signal-coverage-gaps.sql:478-516)
 *   • the CA-policy signal shape (seed-signal-rules.ts) and its bridged producer
 *
 * REAL, confirmed on tenant c4c814d4-3afe-441e-9145-62461d0a4fd3 by Shane and
 * recorded on #413: 0 Conditional Access policies, 14 Global Administrators, no
 * break-glass account, EEEU (Everyone Except External Users) sharing.
 *
 * MODELLED, and labelled as such wherever it appears:
 *   • the two checks marked ENTAILED below — with zero CA policies there can be
 *     no CA-based MFA coverage and no CA legacy-auth block. That is an
 *     entailment of a confirmed finding, not a separate confirmed finding.
 *   • the "middling" and "healthy" profiles are hand-authored reference points
 *     (#413's own instruction to span the spectrum), not observed tenants.
 *   • the impact WEIGHTS. Deliberate: Shane has confirmed every current value in
 *     signal_derivation_rules is untrustworthy (92 rows flattened to 1, a manual
 *     300, a 5000 on globalAdminCount). Reassignment is separate, later work.
 *     Every headline conclusion below is therefore ALSO stated in a
 *     weight-independent form (the uniform-weight count-ratio identity).
 *
 * The three profiles are authored in the real `signal_simulation_profiles` shape
 * (a `profile_updates` object + a `parsed_findings` array), so the same three can
 * be driven through the live Simulator Studio — see
 * lib/db/migrations/manual/2026-08-05-seed-413-spectrum-simulation-profiles.sql.
 *
 * Console output is part of the point:
 *   npx vitest run src/lib/pillar-denominator-spectrum-413.test.ts \
 *     --reporter=verbose --disable-console-intercept
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";
});

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return { ...actual, db: { select: vi.fn(), selectDistinct: vi.fn() } };
});

import {
  computeHealthEngine,
  getSignalHealthImpacts,
  type HealthEngineOutput,
  type SignalHealthImpactConfig,
} from "./health-engine.ts";
import { computeSecurityEngine } from "./security-engine.ts";
import { computePillarDisplayScore, computeOverallDisplayScore } from "./health-display.ts";
import {
  fetchTenantEvaluableSignalKeys,
  fetchEvaluableSignalKeys,
  RADAR_PILLARS,
} from "./pillar-coverage.ts";
import { COPILOT_GATE_THRESHOLD, copilotGateStatus } from "./copilot-gate.ts";
import {
  db,
  monitorChecksTable,
  monitoringPackageChecksTable,
  mspDiagnosticRunsTable,
} from "@workspace/db";
import type { SignalDerivationRule, SignalRuleGroup } from "./tenant-signals.ts";

// ── Real check keys (verbatim; provenance in the header) ─────────────────────

/** core:security-baseline, 29. */
const SECURITY_BASELINE_CHECKS = [
  "identity:mfa-registration", "identity:ca-mfa-coverage", "identity:ca-policy-count",
  "identity:ca-legacy-auth-block", "identity:legacy-auth-usage", "identity:global-admin-count",
  "identity:pim-permanent-roles", "identity:break-glass-health", "identity:risky-users",
  "identity:risky-signins", "identity:stale-accounts", "identity:sspr-config",
  "security:secure-score", "security:open-incidents", "security:alert-count-by-severity",
  "security:safe-links-coverage", "security:safe-attachments-coverage", "security:antiphishing-coverage",
  "security:dlp-violations",
  "exchange:dkim-spf-dmarc-status", "exchange:auto-forwarding-rules",
  "devices:compliant-vs-noncompliant", "devices:encryption-status", "devices:os-patch-compliance",
  "devices:bitlocker-key-escrow",
  "sharepoint:anonymous-links", "sharepoint:tenant-sharing-capability",
  "onedrive:external-sharing-settings",
  "appgov:risky-permission-grants",
];

/** assess:copilot-readiness, 7. */
const COPILOT_READINESS_CHECKS = [
  "license:copilot-assignment", "copilot:usage-activity", "copilot:licensed-but-inactive",
  "identity:mfa-registration", "sharepoint:tenant-sharing-capability",
  "appgov:risky-permission-grants", "copilot:sensitivity-labels-exist",
];

const CATALOG_SIZE = 122;

const FILLER_DOMAINS = [
  "governance", "compliance", "adoption", "usage", "collaboration", "licensing",
  "cost", "license", "teams", "onedrive", "sharepoint", "platform", "intune",
  "m365", "copilot", "security", "identity", "appgov", "devices",
];
const ALL_PACKAGE_CHECKS = [...new Set([...SECURITY_BASELINE_CHECKS, ...COPILOT_READINESS_CHECKS])];
const CATALOG_CHECKS = [
  ...ALL_PACKAGE_CHECKS,
  ...Array.from({ length: CATALOG_SIZE - ALL_PACKAGE_CHECKS.length }, (_, i) =>
    `${FILLER_DOMAINS[i % FILLER_DOMAINS.length]}:catalog-check-${String(i).padStart(3, "0")}`),
];

// ── The repo's own weighting scheme (close-signal-coverage-gaps.sql:478-516) ──

const DOMAIN_PILLAR: Record<string, string> = {
  security: "security", identity: "security",
  governance: "governance", appgov: "governance",
  compliance: "compliance", adoption: "adoption", copilot: "copilot",
  architecture: "architecture", m365: "architecture", licensing: "licensing",
};
const RANK_IMPACT: Record<number, number> = { 4: 60, 3: 45, 2: 30, 1: 20 };

/** Deterministic spread over the scheme's four severity bands (see header). */
function severityRank(checkKey: string): number {
  let h = 0;
  for (let i = 0; i < checkKey.length; i++) h = (h * 31 + checkKey.charCodeAt(i)) >>> 0;
  return (h % 4) + 1;
}

type Impacts = Record<string, number>;
function impactsFor(checkKey: string, uniform: boolean): Impacts {
  if (uniform) {
    return {
      governanceImpact: 1, securityImpact: 1, complianceImpact: 1, adoptionImpact: 1,
      copilotImpact: 1, architectureImpact: 1, licensingImpact: 1,
    };
  }
  const zero: Impacts = {
    governanceImpact: 0, securityImpact: 0, complianceImpact: 0, adoptionImpact: 0,
    copilotImpact: 0, architectureImpact: 0, licensingImpact: 0,
  };
  const dom = RANK_IMPACT[severityRank(checkKey)]!;
  switch (DOMAIN_PILLAR[checkKey.split(":")[0]!] ?? "architecture") {
    case "security":   return { ...zero, securityImpact: dom,     complianceImpact: 2,   architectureImpact: 1 };
    case "governance": return { ...zero, governanceImpact: dom,   complianceImpact: 2,   securityImpact: 1 };
    case "compliance": return { ...zero, complianceImpact: dom,   securityImpact: 2,     governanceImpact: 1 };
    case "adoption":   return { ...zero, adoptionImpact: dom,     copilotImpact: 2,      architectureImpact: 1 };
    case "copilot":    return { ...zero, copilotImpact: dom,      adoptionImpact: 2,     licensingImpact: 1 };
    case "licensing":  return { ...zero, licensingImpact: dom,    architectureImpact: 2, copilotImpact: 1 };
    default:           return { ...zero, architectureImpact: dom, securityImpact: 1,     licensingImpact: 1 };
  }
}

// ── Rule corpus ───────────────────────────────────────────────────────────────

let nextId = 1;
function makeRule(
  signalKey: string, ruleType: string, sourceKey: string,
  compareValue: string | null, impacts: Impacts,
): SignalDerivationRule {
  return {
    id: nextId++, signalKey, groupId: null, ruleType, sourceKey, compareValue,
    description: null, sortOrder: 0, createdAt: new Date(0), updatedAt: new Date(0), mspId: null,
    priority: 0, weight: 0, pricingImpact: 0, priorityScoreContribution: 0, pricingValueContribution: 0,
    trendValue: 0, trendDirection: "flat", decayRate: "0", ttlDays: 0, confidence: 0,
    severity: "low", category: "", pillar: "",
    crmFitContribution: 0, crmPainContribution: 0, crmMaturityContribution: 0,
    crmIntentContribution: 0, crmUrgencyContribution: 0,
    ...impacts,
  } as unknown as SignalDerivationRule;
}

const CA_SIGNAL = "security:no-conditional-access";
const GA_SIGNAL = "security:global-admin-sprawl";

/** One signal per catalog check; the two confirmed findings get their real shapes. */
function buildCorpus(uniform = false): SignalDerivationRule[] {
  nextId = 1;
  return CATALOG_CHECKS.map((checkKey) => {
    if (checkKey === "identity:ca-policy-count") {
      return makeRule(CA_SIGNAL, "profile_key_eq", "conditionalAccessPolicyCount", "0", impactsFor(checkKey, uniform));
    }
    if (checkKey === "identity:global-admin-count") {
      return makeRule(GA_SIGNAL, "profile_key_gt", "globalAdminCount", "4", impactsFor(checkKey, uniform));
    }
    return makeRule(`sig:${checkKey}`, "threshold", checkKey, "0", impactsFor(checkKey, uniform));
  });
}

const CHECK_DEFINITION_ROWS = CATALOG_CHECKS.map((key) => ({
  key,
  mapping: key === "identity:global-admin-count"
    ? [{ sourceField: "value", targetField: "globalAdminCount" }]
    : [],
  properties: [],
  requiresCustomerScript: false,
}));

// ── db wiring: msp_diagnostic_runs + monitoring_package_checks + monitor_checks ─

/**
 * Wires the three real reads `fetchTenantEvaluableSignalKeys` performs:
 *   selectDistinct(package_key).from(msp_diagnostic_runs).where(customer)
 *   selectDistinct(check_key).from(monitoring_package_checks).where(inArray)
 *   select(defs).from(monitor_checks)[.where(inArray)]
 */
function wireDb(opts: { runPackageKeys: string[]; packageChecks: Record<string, string[]> }) {
  vi.mocked(db.selectDistinct).mockImplementation((() => ({
    from: (table: unknown) => ({
      where: async () => {
        if (table === mspDiagnosticRunsTable) {
          return opts.runPackageKeys.map((packageKey) => ({ packageKey }));
        }
        if (table === monitoringPackageChecksTable) {
          const keys = new Set(opts.runPackageKeys.flatMap((k) => opts.packageChecks[k] ?? []));
          return [...keys].map((checkKey) => ({ checkKey }));
        }
        throw new Error("wireDb: unexpected table in db.selectDistinct");
      },
    }),
  })) as unknown as typeof db.selectDistinct);

  // monitor_checks: awaitable directly (catalog-wide read) AND `.where`-able
  // (the covered-checks read). The `.where` variant must genuinely narrow, or
  // the test would pass for the wrong reason.
  vi.mocked(db.select).mockImplementation((() => ({
    from: (table: unknown) => {
      if (table !== monitorChecksTable) throw new Error("wireDb: unexpected table in db.select");
      return Object.assign(Promise.resolve(CHECK_DEFINITION_ROWS), {
        where: async () => {
          const covered = new Set(opts.runPackageKeys.flatMap((k) => opts.packageChecks[k] ?? []));
          return CHECK_DEFINITION_ROWS.filter((d) => covered.has(d.key));
        },
      });
    },
  })) as unknown as typeof db.select);
}

const PACKAGE_CHECKS: Record<string, string[]> = {
  "core:security-baseline": SECURITY_BASELINE_CHECKS,
  "assess:copilot-readiness": COPILOT_READINESS_CHECKS,
};

// ── The three profiles, in the real signal_simulation_profiles shape ──────────

interface SimulationProfile {
  name: string;
  profileUpdates: Record<string, unknown>;
  parsedFindings: string[];
}

/** Marks a check as broken the way mergeMonitorProfileRows stamps it. */
function fires(checkKeys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(checkKeys.map((k) => [`${k}__itemCount`, 1]));
}

/**
 * CONFIRMED on the real test tenant (#413): 0 CA policies, 14 Global Admins, no
 * break-glass, EEEU sharing. The two ENTAILED entries follow from "0 CA
 * policies" — with no CA policies there is no CA MFA coverage and no CA
 * legacy-auth block — and are marked rather than presented as separate findings.
 */
const BAD_TENANT: SimulationProfile = {
  name: "#413 — real test tenant c4c814d4 (confirmed critical)",
  profileUpdates: {
    conditionalAccessPolicyCount: 0,   // CONFIRMED
    globalAdminCount: 14,              // CONFIRMED
    ...fires([
      "identity:break-glass-health",            // CONFIRMED — no break-glass account
      "sharepoint:tenant-sharing-capability",   // CONFIRMED — EEEU sharing
      "identity:ca-mfa-coverage",               // ENTAILED by 0 CA policies
      "identity:ca-legacy-auth-block",          // ENTAILED by 0 CA policies
    ]),
  },
  parsedFindings: [
    "identity:ca-policy-count: critical severity condition matched (0 Conditional Access policies)",
    "identity:global-admin-count: critical severity condition matched (14 Global Administrators)",
    "identity:break-glass-health: critical severity condition matched (no break-glass account)",
    "sharepoint:tenant-sharing-capability: critical severity condition matched (Everyone Except External Users sharing)",
  ],
};

/** Hand-authored middle of the range: real controls in place, two gaps left open. */
const MIDDLING_TENANT: SimulationProfile = {
  name: "#413 — middling reference tenant (hand-authored)",
  profileUpdates: {
    conditionalAccessPolicyCount: 6,
    globalAdminCount: 3,
    ...fires(["identity:stale-accounts", "devices:os-patch-compliance"]),
  },
  parsedFindings: [
    "identity:stale-accounts: warning severity condition matched",
    "devices:os-patch-compliance: warning severity condition matched",
  ],
};

/** Hand-authored healthy end: every scanned check clean. */
const HEALTHY_TENANT: SimulationProfile = {
  name: "#413 — healthy reference tenant (hand-authored)",
  profileUpdates: { conditionalAccessPolicyCount: 12, globalAdminCount: 2 },
  parsedFindings: [],
};

// ── Scoring through the real chain ────────────────────────────────────────────

function engineOutput(profile: SimulationProfile, rules: SignalDerivationRule[]): HealthEngineOutput {
  const groups: SignalRuleGroup[] = [];
  const health = computeHealthEngine(profile.profileUpdates, profile.parsedFindings, rules, groups);
  const security = computeSecurityEngine(profile.profileUpdates, profile.parsedFindings, rules, groups);
  return {
    ...health,
    score: health.score + security.score,
    breakdown: [...health.breakdown, security.breakdown],
  };
}

interface Scored {
  pillars: Record<string, number | null>;
  overall: number | null;
  fired: number;
}

function scoreWith(
  output: HealthEngineOutput,
  impacts: Map<string, SignalHealthImpactConfig>,
  evaluable: ReadonlySet<string>,
): Scored {
  const pillars: Record<string, number | null> = {};
  for (const p of RADAR_PILLARS) pillars[p] = computePillarDisplayScore(p, output, impacts, evaluable);
  return {
    pillars,
    overall: computeOverallDisplayScore(RADAR_PILLARS, output, impacts, evaluable),
    fired: output.rawSignals.filter((s) => s !== "alwaysInclude").length,
  };
}

const fmt = (n: number | null) => (n == null ? "  —" : String(n).padStart(3));
function row(label: string, r: Scored) {
  console.log(
    `  ${label.padEnd(42)} ${RADAR_PILLARS.map((p) => `${p.slice(0, 4)}=${fmt(r.pillars[p])}`).join("  ")}` +
    `   OVERALL=${fmt(r.overall)}`,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ═════════════════════════════════════════════════════════════════════════════
// Part 1 — WIRING
// ═════════════════════════════════════════════════════════════════════════════

describe("#413 Part 1 — fetchTenantEvaluableSignalKeys resolves the tenant's real scan scope", () => {
  it("scopes the denominator to the tenant's scanned package, not the whole catalog", async () => {
    wireDb({ runPackageKeys: ["core:security-baseline"], packageChecks: PACKAGE_CHECKS });
    const rules = buildCorpus();

    const tenantScoped = await fetchTenantEvaluableSignalKeys(1, rules);
    const catalogWide = await fetchEvaluableSignalKeys(rules);

    // 29 checks in, 29 signals out — every baseline check has exactly one rule.
    expect(tenantScoped.size).toBe(SECURITY_BASELINE_CHECKS.length);
    expect(catalogWide.size).toBe(CATALOG_SIZE);

    // The two confirmed findings' signals ARE in scope (their producers are in
    // the package: identity:ca-policy-count is the bridged producer of
    // conditionalAccessPolicyCount; identity:global-admin-count maps globalAdminCount).
    expect(tenantScoped.has(CA_SIGNAL)).toBe(true);
    expect(tenantScoped.has(GA_SIGNAL)).toBe(true);

    // A copilot-only check the tenant never ran is NOT in scope — this is the
    // ~93 checks' worth of denominator mass the old path counted.
    expect(catalogWide.has("sig:copilot:usage-activity")).toBe(true);
    expect(tenantScoped.has("sig:copilot:usage-activity")).toBe(false);

    // Proper subset, in the safe direction: scoping can only ever REMOVE mass
    // from the denominator, which can only ever make a broken tenant score worse.
    for (const key of tenantScoped) expect(catalogWide.has(key)).toBe(true);
  });

  it("unions in signals that FIRED outside the package, keeping numerator ⊆ denominator", async () => {
    wireDb({ runPackageKeys: ["core:security-baseline"], packageChecks: PACKAGE_CHECKS });
    const rules = buildCorpus();

    // A real producer outside monitoring_package_checks (client_m365_profiles,
    // script_run_results, a bridged key whose producer is not in the package)
    // can fire a signal the package cannot feed. Without the union that signal
    // lands in the numerator and not the denominator → rawScore > theoreticalMax
    // → a spurious clamp to 0.
    const strayFired = "sig:copilot:usage-activity";
    const withoutUnion = await fetchTenantEvaluableSignalKeys(1, rules);
    const withUnion = await fetchTenantEvaluableSignalKeys(1, rules, { firedSignalKeys: [strayFired] });

    expect(withoutUnion.has(strayFired)).toBe(false);
    expect(withUnion.has(strayFired)).toBe(true);
    expect(withUnion.size).toBe(withoutUnion.size + 1);

    // And the invariant it exists to protect, proven on a real score: the stray
    // signal fires, so it is in the numerator either way.
    const impacts = getSignalHealthImpacts(rules, []);
    const output = engineOutput(
      { name: "stray", profileUpdates: fires([...SECURITY_BASELINE_CHECKS, "copilot:usage-activity"]), parsedFindings: [] },
      rules,
    );
    const raw = output.breakdown.find((b) => b.pillar === "copilot")!.score;
    const maxWithout = [...withoutUnion].reduce((s, k) => s + (impacts.get(k)?.copilotImpact ?? 0), 0);
    const maxWith = [...withUnion].reduce((s, k) => s + (impacts.get(k)?.copilotImpact ?? 0), 0);
    expect(raw).toBeGreaterThan(maxWithout); // the broken state the union prevents
    expect(raw).toBeLessThanOrEqual(maxWith); // the invariant, restored
  });

  it("returns an EMPTY set (never the catalog-wide fallback) when the tenant has NEVER been scanned", async () => {
    // Git #1392: no msp_diagnostic_runs row at all. The old behavior fell back
    // to the whole catalog as the denominator with a zero numerator, which
    // `computePillarDisplayScore` renders as a fabricated perfect 100 for a
    // genuinely zero-data tenant. The honest answer is an empty denominator, so
    // every pillar reads not_evaluated (score null) rather than 100.
    const rules = buildCorpus();
    wireDb({ runPackageKeys: [], packageChecks: PACKAGE_CHECKS });

    const evaluable = await fetchTenantEvaluableSignalKeys(1, rules);
    expect(evaluable.size).toBe(0);

    // The behavioural payoff: no fabricated score anywhere on the radar.
    const impacts = getSignalHealthImpacts(rules, []);
    const output = engineOutput(HEALTHY_TENANT, rules);
    for (const p of RADAR_PILLARS) {
      expect(computePillarDisplayScore(p, output, impacts, evaluable)).toBeNull();
    }
    expect(computeOverallDisplayScore(RADAR_PILLARS, output, impacts, evaluable)).toBeNull();
  });

  it("STILL falls back to the catalog-wide denominator when a run exists but its scan scope is unresolvable", async () => {
    // Git #1392: this is the OTHER null-checkKeys reason and must stay distinct
    // from never-scanned — a run named a package, but that package curates no
    // checks yet (the platform-wide state before 2026-07-21's repopulation).
    // For a real-but-unresolvable scan, catalog-wide remains the honest
    // best-effort rather than silently nulling every pillar.
    const rules = buildCorpus();
    wireDb({ runPackageKeys: ["core:security-baseline"], packageChecks: {} });
    expect((await fetchTenantEvaluableSignalKeys(1, rules)).size).toBe(CATALOG_SIZE);
  });

  it("scopes to the UNION of every package the tenant has run, not just the newest", async () => {
    wireDb({
      runPackageKeys: ["core:security-baseline", "assess:copilot-readiness"],
      packageChecks: PACKAGE_CHECKS,
    });
    const scoped = await fetchTenantEvaluableSignalKeys(1, buildCorpus());
    expect(scoped.size).toBe(ALL_PACKAGE_CHECKS.length);
    expect(scoped.has("sig:copilot:usage-activity")).toBe(true);   // from the copilot package
    expect(scoped.has("sig:identity:risky-users")).toBe(true);      // from the baseline package
    expect(scoped.has("sig:governance:catalog-check-000")).toBe(false); // in neither
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Part 2 — SPECTRUM
// ═════════════════════════════════════════════════════════════════════════════

describe("#413 Part 2 — the score's real SHAPE across a spectrum of tenants", () => {
  const SPECTRUM = [BAD_TENANT, MIDDLING_TENANT, HEALTHY_TENANT];

  it("bad < middling < healthy under the package-scoped denominator — and NOT under the catalog-wide one", async () => {
    wireDb({ runPackageKeys: ["core:security-baseline"], packageChecks: PACKAGE_CHECKS });
    const rules = buildCorpus();
    const impacts = getSignalHealthImpacts(rules, []);
    const catalogWide = await fetchEvaluableSignalKeys(rules);

    const scored: { profile: SimulationProfile; live: Scored; fixed: Scored }[] = [];
    for (const profile of SPECTRUM) {
      const output = engineOutput(profile, rules);
      const scoped = await fetchTenantEvaluableSignalKeys(1, rules, { firedSignalKeys: output.rawSignals });
      scored.push({
        profile,
        live: scoreWith(output, impacts, catalogWide),
        fixed: scoreWith(output, impacts, scoped),
      });
    }

    console.log("\n=== #413 spectrum — core:security-baseline (29 checks) of a 122-check catalog ===");
    for (const s of scored) {
      console.log(`\n  ${s.profile.name}   (${s.live.fired} signals fired)`);
      row("BEFORE — catalog-wide denominator", s.live);
      row("AFTER  — package-scoped denominator", s.fixed);
    }

    const [bad, mid, good] = scored;

    // ── The shape, on the fixed path ──────────────────────────────────────────
    expect(bad.fixed.overall!).toBeLessThan(mid.fixed.overall!);
    expect(mid.fixed.overall!).toBeLessThan(good.fixed.overall!);
    expect(bad.fixed.pillars.security!).toBeLessThan(mid.fixed.pillars.security!);
    expect(mid.fixed.pillars.security!).toBeLessThan(good.fixed.pillars.security!);

    // A tenant with nothing broken in its scanned package genuinely IS 100 —
    // that is the correct answer, not a fabricated one.
    expect(good.fixed.pillars.security).toBe(100);
    expect(good.fixed.overall).toBe(100);

    // ── #413 Finding 2, resolved as a CONSEQUENCE of the denominator fix ──────
    // core:security-baseline curates no adoption and no copilot check. Under the
    // catalog-wide denominator those pillars had theoreticalMax > 0 (the rest of
    // the catalog feeds them) and rawScore 0, so `100 − 0/max × 100` rendered a
    // perfect 100 for a pillar the tenant was never measured on — the exact
    // contradiction pillar-summary-stats.ts documents from the other side, with
    // its honest "this check was never in your scan" card sitting under a dial
    // reading 100. Package-scoped, theoreticalMax is 0 and
    // `computePillarDisplayScore`'s existing never-fabricate guard returns null.
    //
    // This was NOT a separate change — no new guard was written. It is what the
    // pre-existing guard always did once the denominator asked the right
    // question. It IS product-visible: `copilot` going null means the Copilot
    // Gate returns `status: null` for a security-baseline-only tenant instead of
    // a verdict, which is copilot-gate.ts's own documented "null in, null out —
    // never a default verdict" behaviour, now actually reachable.
    for (const s of scored) {
      expect(s.live.pillars.adoption).toBe(100);   // fabricated before
      expect(s.live.pillars.copilot).toBe(100);
      expect(s.fixed.pillars.adoption).toBeNull(); // honest after
      expect(s.fixed.pillars.copilot).toBeNull();
    }
    console.log(
      "\n  >> FINDING 2, resolved by the same change: adoption and copilot read 100 BEFORE" +
      "\n     (core:security-baseline curates no check feeding either) and null AFTER —" +
      "\n     no new guard, just the pre-existing theoreticalMax===0 guard finally reached.",
    );

    // ── The severity, on the fixed path — and its HONEST LIMIT ────────────────
    // The move is real and large: security 80 → 70, overall 94 → 74 on the same
    // tenant state. But 70/100 is NOT "genuinely low" for a tenant with zero
    // Conditional Access policies, fourteen Global Administrators, no
    // break-glass account and EEEU sharing, and this test says so rather than
    // being tuned until it looks fixed.
    //
    // Why 70 and not 20: only SIX of the tenant's 29 scanned checks are modelled
    // as broken — the four confirmed findings plus the two entailed by them.
    // Everything else in its package is treated as passing, because inventing
    // more broken checks to reach a lower number would be fabrication. Given
    // 6-of-29 broken, 70 is arithmetically what the formula means, and the
    // formula is now correct.
    //
    // The remaining distance is #413 Finding 3, deliberately NOT fixed here:
    // firing is BINARY, so `14 Global Administrators` contributes exactly what
    // `5` would, and a `critical` finding contributes exactly what a `warning`
    // would. Until magnitude and severity reach the score, four criticals cannot
    // outweigh six warnings, and no denominator change can make them.
    expect(bad.fixed.pillars.security!).toBeLessThan(bad.live.pillars.security! - 5);
    expect(bad.fixed.overall!).toBeLessThan(bad.live.overall! - 15);
    console.log(
      `\n  >> HONEST LIMIT: the confirmed-critical tenant reads security=${bad.fixed.pillars.security}` +
      ` / overall=${bad.fixed.overall} (was ${bad.live.pillars.security} / ${bad.live.overall}).` +
      `\n     Real improvement, but not yet "genuinely low" — six of 29 scanned checks are broken and` +
      `\n     firing is binary, so 4 CRITICAL findings weigh the same as 4 warnings (#413 Finding 3).`,
    );

    // ── What the old path did with the SAME tenant ────────────────────────────
    // Every pillar strictly more favourable, and the broken tenant reads healthy.
    expect(bad.live.pillars.security!).toBeGreaterThan(bad.fixed.pillars.security!);
    expect(bad.live.overall!).toBeGreaterThan(bad.fixed.overall!);
    expect(bad.live.overall!).toBeGreaterThan(90); // "genuinely broken" scored as near-perfect

    // ── The separation the old path could not produce ─────────────────────────
    // Bad-vs-healthy separation is the whole product claim — if a confirmed-
    // critical tenant and a clean one land within a few points of each other,
    // the number carries no information whatever its absolute value. Measured on
    // BOTH the headline overall (the single number the Reveal shows) and the
    // security pillar (where this tenant's confirmed findings land).
    const overallSpreadLive = good.live.overall! - bad.live.overall!;
    const overallSpreadFixed = good.fixed.overall! - bad.fixed.overall!;
    const securitySpreadLive = good.live.pillars.security! - bad.live.pillars.security!;
    const securitySpreadFixed = good.fixed.pillars.security! - bad.fixed.pillars.security!;
    console.log(
      `\n  >> separation between the confirmed-bad and healthy tenants:` +
      `\n     OVERALL   BEFORE ${overallSpreadLive} points   AFTER ${overallSpreadFixed} points` +
      `\n     security  BEFORE ${securitySpreadLive} points   AFTER ${securitySpreadFixed} points`,
    );
    // The headline number gains real resolution — six points of range between a
    // confirmed-critical tenant and a clean one is not a usable score.
    expect(overallSpreadLive).toBeLessThan(10);
    expect(overallSpreadFixed).toBeGreaterThan(overallSpreadLive * 3);
    expect(securitySpreadFixed).toBeGreaterThan(securitySpreadLive);
  });

  it("the Copilot Gate's verdict genuinely flips for a partially-broken 7-check tenant", async () => {
    // The most extreme package in the platform: assess:copilot-readiness curates
    // SEVEN checks. Sweep how many of them are broken and watch the Gate verdict
    // under each denominator, rather than asserting a guessed floor.
    //
    // NOTE for anyone reading the investigation doc alongside this: its
    // "floor 95" figure is the OVERALL score for that package, not the copilot
    // PILLAR (which it reports as 61). The Gate reads the pillar. Both numbers
    // are inflated by dilution; only one of them is what the Gate compares.
    wireDb({ runPackageKeys: ["assess:copilot-readiness"], packageChecks: PACKAGE_CHECKS });
    const rules = buildCorpus();
    const impacts = getSignalHealthImpacts(rules, []);
    const catalogWide = await fetchEvaluableSignalKeys(rules);

    console.log("\n=== #413 Copilot Gate — assess:copilot-readiness (7 checks) ===");
    console.log(`   broken   BEFORE copi / gate      AFTER copi / gate      (threshold ${COPILOT_GATE_THRESHOLD})`);

    let flipped = 0;
    let liveFloor = 100;
    let fixedFloor = 100;

    for (let k = 0; k <= COPILOT_READINESS_CHECKS.length; k++) {
      const profile: SimulationProfile = {
        name: `${k} of 7 broken`,
        profileUpdates: fires(COPILOT_READINESS_CHECKS.slice(0, k)),
        parsedFindings: [],
      };
      const output = engineOutput(profile, rules);
      const scoped = await fetchTenantEvaluableSignalKeys(1, rules, { firedSignalKeys: output.rawSignals });
      const live = scoreWith(output, impacts, catalogWide);
      const fixed = scoreWith(output, impacts, scoped);

      const liveGate = copilotGateStatus(live.pillars.copilot);
      const fixedGate = copilotGateStatus(fixed.pillars.copilot);
      if (liveGate === "go" && fixedGate === "no_go") flipped++;
      liveFloor = Math.min(liveFloor, live.pillars.copilot ?? 100);
      fixedFloor = Math.min(fixedFloor, fixed.pillars.copilot ?? 100);

      console.log(
        `   ${String(k).padStart(2)}/7    ${fmt(live.pillars.copilot)} / ${(liveGate ?? "—").padEnd(6)}` +
        `          ${fmt(fixed.pillars.copilot)} / ${(fixedGate ?? "—").padEnd(6)}`,
      );
    }

    console.log(`\n  >> copilot-pillar floor (all 7 broken):  BEFORE ${liveFloor}   AFTER ${fixedFloor}`);
    console.log(`  >> tenant states whose Gate verdict flips Go → No-Go: ${flipped} of 8`);

    // Real tenant states existed that the old path called Go and the fixed path
    // calls No-Go. That is a shipped verdict changing, not a cosmetic delta.
    expect(flipped).toBeGreaterThan(0);
    // The fixed path can reach the bottom of the scale; the old one could not.
    expect(fixedFloor).toBe(0);
    expect(liveFloor).toBeGreaterThan(0);
  });

  it("weight-independent: with uniform weights the formula is exactly the count ratio", async () => {
    // The conclusion above must not rest on the modelled weights. With every
    // impact = 1 the formula degenerates to 100 − (fired / evaluable) × 100, so
    // the floor is pure arithmetic on the two populations.
    wireDb({ runPackageKeys: ["core:security-baseline"], packageChecks: PACKAGE_CHECKS });
    const rules = buildCorpus(true);
    const impacts = getSignalHealthImpacts(rules, []);

    const output = engineOutput(
      { name: "everything broken", profileUpdates: { conditionalAccessPolicyCount: 0, globalAdminCount: 14, ...fires(SECURITY_BASELINE_CHECKS) }, parsedFindings: [] },
      rules,
    );
    const scoped = await fetchTenantEvaluableSignalKeys(1, rules, { firedSignalKeys: output.rawSignals });
    const live = scoreWith(output, impacts, await fetchEvaluableSignalKeys(rules));
    const fixed = scoreWith(output, impacts, scoped);

    console.log("\n=== #413 weight-independent floor — uniform weights, EVERYTHING broken ===");
    console.log(`  predicted catalog-wide floor: 100 − 29/122 × 100 = ${Math.round(100 - (29 / 122) * 100)}`);
    row("BEFORE — catalog-wide denominator", live);
    row("AFTER  — package-scoped denominator", fixed);

    // The measured floor reproduces the predicted one to the point.
    expect(live.overall).toBe(Math.round(100 - (SECURITY_BASELINE_CHECKS.length / CATALOG_SIZE) * 100));
    // And the fixed path bottoms out where a totally broken tenant should.
    expect(fixed.overall).toBe(0);
    for (const p of RADAR_PILLARS) expect(fixed.pillars[p]).toBe(0);
  });
});
