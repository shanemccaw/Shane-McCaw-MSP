/**
 * health-display-denominator-413.test.ts
 *
 * Git #413 investigation harness — the reconstruction behind
 * docs/weighted-scoring-investigation-413.md. This is EVIDENCE, not a spec:
 * its assertions describe the CURRENT structural relationship between the two
 * denominators the platform uses for one formula, so that a future fix to
 * fetchEvaluableSignalKeys' scoping deliberately breaks them rather than
 * landing silently. The console output is the point — run it with
 *   npx vitest run src/lib/health-display-denominator-413.test.ts \
 *     --reporter=verbose --disable-console-intercept
 *
 * Reconstructs what the weighted architecture-health score would produce for the
 * real test tenant c4c814d4-3afe-441e-9145-62461d0a4fd3, under genuinely varied
 * reasonable weights, and compares it against that tenant's real confirmed
 * findings (0 Conditional Access policies, 14 Global Administrators).
 *
 * Every scoring step runs the REAL exported functions. Nothing reimplements the
 * formula:
 *   computeHealthEngine / computeSecurityEngine   (health-engine.ts / security-engine.ts)
 *   getSignalHealthImpacts                        (health-engine.ts)
 *   computePillarDisplayScore / computeOverallDisplayScore  (health-display.ts)
 *   buildProducibleProfileKeys / ruleIsFedByPackage          (pillar-coverage.ts)
 *
 * PROVENANCE of every input (nothing invented that could be sourced from the repo):
 *   • core:security-baseline's 29 check keys — verbatim from
 *     lib/db/migrations/manual/2026-07-21-repopulate-monitoring-package-checks.sql:65-98
 *   • assess:copilot-readiness's 7 check keys — verbatim from
 *     src/routes/admin-simulator-assessments.test.ts:62-68 (its own comment records
 *     the fixture as matching live data, sort_order gap included)
 *   • active catalog size 122 — pillar-coverage.test.ts:12 ("core:enhanced-monitoring
 *     shape, 122 checks / 67 passing live"); that package is defined as every active
 *     monitor_checks row (2026-07-23-populate-enhanced-monitoring-checks.sql:82-88)
 *   • the weighting scheme — verbatim from this repo's OWN previously-authored
 *     scheme in 2026-07-23-close-signal-coverage-gaps.sql:478-516: dominant pillar
 *     by check domain, dominant magnitude 60/45/30/20 by the check's worst
 *     severity_rule rank, plus 1–2 spillover into adjacent pillars.
 *   • the CA-policy signal shape — seed-signal-rules.ts:53-56 (`security:has_gaps`,
 *     profile_key_eq on conditionalAccessPolicyCount == 0), and the bridged
 *     producer identity:ca-policy-count (pillar-coverage.ts BRIDGED_KEY_PRODUCER_CHECK).
 *
 * The ONE quantity that cannot be sourced from the repo is which of the tenant's
 * checks actually fired. That is why the headline results are BOUNDS (every
 * scanned check fires at maximum weight) plus a full sweep — neither needs the
 * tenant's per-check results.
 */

import { describe, it, expect, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";
});

import {
  computeHealthEngine,
  getSignalHealthImpacts,
  type HealthEngineOutput,
  type SignalHealthImpactConfig,
} from "./health-engine.ts";
import { computeSecurityEngine } from "./security-engine.ts";
import { computePillarDisplayScore, computeOverallDisplayScore } from "./health-display.ts";
import { buildProducibleProfileKeys, ruleIsFedByPackage, RADAR_PILLARS } from "./pillar-coverage.ts";
import type { SignalDerivationRule, SignalRuleGroup } from "./tenant-signals.ts";

// ── Real check keys ───────────────────────────────────────────────────────────

/** core:security-baseline, verbatim (29). */
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

/** assess:copilot-readiness, verbatim (7). */
const COPILOT_READINESS_CHECKS = [
  "license:copilot-assignment", "copilot:usage-activity", "copilot:licensed-but-inactive",
  "identity:mfa-registration", "sharepoint:tenant-sharing-capability",
  "appgov:risky-permission-grants", "copilot:sensitivity-labels-exist",
];

/** Documented size of the active monitor_checks catalog. */
const CATALOG_SIZE = 122;

/**
 * Filler check keys that bring the catalog up to its real size. These stand in
 * for the ~90 active checks that exist in the catalog but are in NEITHER package
 * the test tenant has run. Their identity is irrelevant to every result below —
 * their only role is to occupy the catalog-wide denominator, which is precisely
 * the mechanism under test. Domains are drawn from the real vocabulary in
 * war-room-pillar-stats.ts's WAR_ROOM_PILLAR_CHECK_DOMAINS.
 */
const FILLER_DOMAINS = [
  "governance", "compliance", "adoption", "usage", "collaboration", "licensing",
  "cost", "license", "teams", "onedrive", "sharepoint", "platform", "intune",
  "m365", "copilot", "security", "identity", "appgov", "devices",
];
function buildFillerChecks(count: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    out.push(`${FILLER_DOMAINS[i % FILLER_DOMAINS.length]}:catalog-check-${String(i).padStart(3, "0")}`);
  }
  return out;
}

const ALL_PACKAGE_CHECKS = [...new Set([...SECURITY_BASELINE_CHECKS, ...COPILOT_READINESS_CHECKS])];
const CATALOG_CHECKS = [
  ...ALL_PACKAGE_CHECKS,
  ...buildFillerChecks(CATALOG_SIZE - ALL_PACKAGE_CHECKS.length),
];

// ── The repo's own weighting scheme (close-signal-coverage-gaps.sql:478-516) ──

const DOMAIN_PILLAR: Record<string, string> = {
  security: "security", identity: "security",
  governance: "governance", appgov: "governance",
  compliance: "compliance",
  adoption: "adoption",
  copilot: "copilot",
  architecture: "architecture", m365: "architecture",
  licensing: "licensing",
};
/** Unmapped domain → architecture, exactly as the migration's ELSE branch does. */
function dominantPillar(checkKey: string): string {
  return DOMAIN_PILLAR[checkKey.split(":")[0]!] ?? "architecture";
}

/** worst severity_rule rank → dominant impact magnitude (4→60, 3→45, 2→30, else 20). */
const RANK_IMPACT: Record<number, number> = { 4: 60, 3: 45, 2: 30, 1: 20, 0: 20 };

/**
 * A check's worst severity rank. The real value is DB-resident
 * (monitor_checks.severity_rules), so this is a deterministic spread over the
 * scheme's own four bands rather than a claim about any specific check — which
 * is exactly what "genuinely varied, reasonable weights" means here. Every
 * headline result below is additionally reported in a weight-independent form.
 */
function severityRank(checkKey: string): number {
  let h = 0;
  for (let i = 0; i < checkKey.length; i++) h = (h * 31 + checkKey.charCodeAt(i)) >>> 0;
  return h % 4 === 0 ? 4 : h % 4 === 1 ? 3 : h % 4 === 2 ? 2 : 1;
}

type Impacts = Record<string, number>;
/** Dominant magnitude on the check's own pillar + the scheme's 1–2 spillover. */
function impactsFor(checkKey: string, flatten: boolean): Impacts {
  const zero: Impacts = {
    governanceImpact: 0, securityImpact: 0, complianceImpact: 0, adoptionImpact: 0,
    copilotImpact: 0, architectureImpact: 0, licensingImpact: 0,
  };
  const pillar = dominantPillar(checkKey);
  if (flatten) {
    // Shane's symptom-relief flattening: every impact column set to 1.
    return {
      governanceImpact: 1, securityImpact: 1, complianceImpact: 1, adoptionImpact: 1,
      copilotImpact: 1, architectureImpact: 1, licensingImpact: 1,
    };
  }
  const dom = RANK_IMPACT[severityRank(checkKey)]!;
  switch (pillar) {
    case "security":      return { ...zero, securityImpact: dom,      complianceImpact: 2, architectureImpact: 1 };
    case "governance":    return { ...zero, governanceImpact: dom,    complianceImpact: 2, securityImpact: 1 };
    case "compliance":    return { ...zero, complianceImpact: dom,    securityImpact: 2,   governanceImpact: 1 };
    case "adoption":      return { ...zero, adoptionImpact: dom,      copilotImpact: 2,    architectureImpact: 1 };
    case "copilot":       return { ...zero, copilotImpact: dom,       adoptionImpact: 2,   licensingImpact: 1 };
    case "licensing":     return { ...zero, licensingImpact: dom,     architectureImpact: 2, copilotImpact: 1 };
    default:              return { ...zero, architectureImpact: dom,  securityImpact: 1,   licensingImpact: 1 };
  }
}

// ── Rule construction ─────────────────────────────────────────────────────────

let nextId = 1;
function makeRule(
  signalKey: string,
  ruleType: string,
  sourceKey: string,
  compareValue: string | null,
  impacts: Impacts,
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

/** The real bridged/mapping profile keys the two confirmed findings read. */
const CA_SIGNAL = "security:no-conditional-access";
const GA_SIGNAL = "security:global-admin-sprawl";

/**
 * One signal per catalog check, in the shape the coverage-gap generator wrote
 * (one ungrouped rule per signal). The two confirmed-finding checks get
 * direction-correct rules instead of the generic high-count threshold:
 *   • identity:ca-policy-count → profile_key_eq conditionalAccessPolicyCount == 0
 *     (absence is the problem — seed-signal-rules.ts's own shape; the key is a
 *     real bridged key whose producer is this check)
 *   • identity:global-admin-count → profile_key_gt globalAdminCount > 4
 */
function buildCorpus(flatten: boolean): SignalDerivationRule[] {
  const rules: SignalDerivationRule[] = [];
  for (const checkKey of CATALOG_CHECKS) {
    if (checkKey === "identity:ca-policy-count") {
      rules.push(makeRule(CA_SIGNAL, "profile_key_eq", "conditionalAccessPolicyCount", "0", impactsFor(checkKey, flatten)));
      continue;
    }
    if (checkKey === "identity:global-admin-count") {
      rules.push(makeRule(GA_SIGNAL, "profile_key_gt", "globalAdminCount", "4", impactsFor(checkKey, flatten)));
      continue;
    }
    rules.push(makeRule(`sig:${checkKey}`, "threshold", checkKey, "0", impactsFor(checkKey, flatten)));
  }
  return rules;
}

/** Check definitions, so buildProducibleProfileKeys resolves globalAdminCount honestly. */
const CHECK_DEFINITIONS = CATALOG_CHECKS.map((key) => ({
  key,
  mapping: key === "identity:global-admin-count"
    ? [{ sourceField: "value", targetField: "globalAdminCount" }]
    : null,
  properties: null,
  requiresCustomerScript: false,
}));

// ── Scoring, through the real display layer ───────────────────────────────────

function evaluableKeysFor(rules: SignalDerivationRule[], coveredChecks: ReadonlySet<string>): Set<string> {
  const producible = buildProducibleProfileKeys(coveredChecks, CHECK_DEFINITIONS);
  return new Set(rules.filter((r) => ruleIsFedByPackage(r, coveredChecks, producible)).map((r) => r.signalKey));
}

/** Composes the two engines exactly as calculateArchitectureHealthScore does. */
function score(
  profile: Record<string, unknown>,
  rules: SignalDerivationRule[],
  denominatorChecks: ReadonlySet<string>,
): { pillars: Record<string, number | null>; overall: number | null; fired: number } {
  const groups: SignalRuleGroup[] = [];
  const health = computeHealthEngine(profile, [], rules, groups);
  const security = computeSecurityEngine(profile, [], rules, groups);
  const output: HealthEngineOutput = {
    ...health,
    score: health.score + security.score,
    breakdown: [...health.breakdown, security.breakdown],
  };
  const impacts: Map<string, SignalHealthImpactConfig> = getSignalHealthImpacts(rules, groups);
  const evaluable = evaluableKeysFor(rules, denominatorChecks);

  const pillars: Record<string, number | null> = {};
  for (const p of RADAR_PILLARS) pillars[p] = computePillarDisplayScore(p, output, impacts, evaluable);
  return {
    pillars,
    overall: computeOverallDisplayScore(RADAR_PILLARS, output, impacts, evaluable),
    // alwaysInclude always fires and carries no impact — excluded from the count.
    fired: health.rawSignals.filter((s) => s !== "alwaysInclude").length,
  };
}

/**
 * The tenant's merged profile. Confirmed real findings are set to their real
 * values; `firingChecks` additionally makes those checks' generic threshold
 * signals fire (itemCount > 0).
 */
function tenantProfile(firingChecks: readonly string[], opts: { ca: boolean; ga: boolean }): Record<string, unknown> {
  const profile: Record<string, unknown> = {};
  if (opts.ca) profile.conditionalAccessPolicyCount = 0;   // real: 0 CA policies
  if (opts.ga) profile.globalAdminCount = 14;              // real: 14 Global Administrators
  for (const key of firingChecks) profile[`${key}__itemCount`] = 1;
  return profile;
}

const BASELINE_SET = new Set(SECURITY_BASELINE_CHECKS);
const COPILOT_SET = new Set(COPILOT_READINESS_CHECKS);
const CATALOG_SET = new Set(CATALOG_CHECKS);

const fmt = (n: number | null) => (n == null ? " — " : String(n).padStart(3));
function row(label: string, r: { pillars: Record<string, number | null>; overall: number | null }) {
  const cells = RADAR_PILLARS.map((p) => `${p.slice(0, 4)}=${fmt(r.pillars[p])}`).join("  ");
  console.log(`  ${label.padEnd(46)} ${cells}   OVERALL=${fmt(r.overall)}`);
}

// ── Investigation ─────────────────────────────────────────────────────────────

describe("#413 — reconstruction of the weighted score for tenant c4c814d4", () => {
  it("A. the two confirmed real findings, alone, under genuinely varied weights", () => {
    const rules = buildCorpus(false);
    const profile = tenantProfile([], { ca: true, ga: true });

    console.log("\n=== A. Only the two CONFIRMED findings fire (0 CA policies, 14 Global Admins) ===");
    const catalogDenom = score(profile, rules, CATALOG_SET);
    const pkgDenom = score(profile, rules, BASELINE_SET);
    console.log(`  signals fired: ${catalogDenom.fired}`);
    row("LIVE path (denominator = 122-check catalog)", catalogDenom);
    row("getPillarCoverage path (denom = 29-check pkg)", pkgDenom);

    // Both confirmed findings are security-domain, so security must move most.
    expect(catalogDenom.fired).toBe(2);
    expect(catalogDenom.pillars.security).not.toBeNull();
    // The live path is strictly more favourable than the package-scoped one.
    expect(catalogDenom.pillars.security!).toBeGreaterThan(pkgDenom.pillars.security!);
  });

  it("B. WORST CASE — every check in the tenant's scanned package fires", () => {
    const rules = buildCorpus(false);

    console.log("\n=== B. WORST CASE: every scanned check fires (a maximally broken tenant) ===");
    const allBaselineFire = tenantProfile(SECURITY_BASELINE_CHECKS, { ca: true, ga: true });
    const bCatalog = score(allBaselineFire, rules, CATALOG_SET);
    const bPkg = score(allBaselineFire, rules, BASELINE_SET);
    console.log(`  core:security-baseline (29 checks) — signals fired: ${bCatalog.fired}`);
    row("LIVE path (denominator = 122-check catalog)", bCatalog);
    row("getPillarCoverage path (denom = 29-check pkg)", bPkg);

    const allCopilotFire = tenantProfile(COPILOT_READINESS_CHECKS, { ca: false, ga: false });
    const cCatalog = score(allCopilotFire, rules, CATALOG_SET);
    const cPkg = score(allCopilotFire, rules, COPILOT_SET);
    console.log(`  assess:copilot-readiness (7 checks) — signals fired: ${cCatalog.fired}`);
    row("LIVE path (denominator = 122-check catalog)", cCatalog);
    row("getPillarCoverage path (denom = 7-check pkg)", cPkg);

    console.log(
      `\n  >> FLOOR: a totally broken 29-check tenant cannot score below OVERALL=${cFmt(bCatalog.overall)}` +
      ` on the live path; a totally broken 7-check tenant cannot score below OVERALL=${cFmt(cCatalog.overall)}.`,
    );

    // The package-scoped denominator bottoms out where it should; the live one cannot.
    expect(bPkg.overall!).toBeLessThan(bCatalog.overall!);
    expect(cPkg.overall!).toBeLessThan(cCatalog.overall!);
  });

  it("C. what the flattening-to-1 and the 300 outlier actually did", () => {
    console.log("\n=== C. Shane's two manual interventions, reconstructed ===");
    const profile = tenantProfile(SECURITY_BASELINE_CHECKS.slice(0, 10), { ca: true, ga: true });

    const varied = score(profile, buildCorpus(false), CATALOG_SET);
    const flat = score(profile, buildCorpus(true), CATALOG_SET);

    // The 300 outlier, on a signal that DOES fire, on top of the flattened corpus.
    const flatPlusOutlier = buildCorpus(true).map((r) =>
      r.signalKey === CA_SIGNAL
        ? ({ ...r, securityImpact: 300, governanceImpact: 300, complianceImpact: 300, adoptionImpact: 300,
             copilotImpact: 300, architectureImpact: 300, licensingImpact: 300 } as SignalDerivationRule)
        : r,
    );
    const hacked = score(profile, flatPlusOutlier, CATALOG_SET);

    // The same 300, on a signal that does NOT fire — the documented exploit.
    const outlierOnSilent = buildCorpus(true).map((r) =>
      r.signalKey === "sig:copilot:usage-activity"
        ? ({ ...r, securityImpact: 300, governanceImpact: 300, complianceImpact: 300, adoptionImpact: 300,
             copilotImpact: 300, architectureImpact: 300, licensingImpact: 300 } as SignalDerivationRule)
        : r,
    );
    const inflated = score(profile, outlierOnSilent, CATALOG_SET);

    console.log(`  (12 signals fired: 10 baseline checks + the two confirmed findings)`);
    row("genuinely varied weights (60/45/30/20 + spillover)", varied);
    row("all impacts flattened to 1", flat);
    row("flattened + 300 on a FIRING signal", hacked);
    row("flattened + 300 on a SILENT signal", inflated);

    // The 300 on a silent signal makes every pillar look healthier — the exact
    // exploit health-display.ts's header documents, reproduced here.
    for (const p of RADAR_PILLARS) {
      expect(inflated.pillars[p]!).toBeGreaterThanOrEqual(flat.pillars[p]!);
    }
    // The 300 on a firing signal is a lever that overwhelms every real weight.
    expect(hacked.overall!).toBeLessThan(flat.overall!);
  });

  it("D. sweep — score vs how many of the 29 scanned checks are broken", () => {
    const rules = buildCorpus(false);
    console.log("\n=== D. Sweep: k of 29 scanned checks broken (varied weights) ===");
    console.log("   k   LIVE-path OVERALL   package-scoped OVERALL");
    for (const k of [0, 2, 5, 10, 15, 20, 25, 29]) {
      const profile = tenantProfile(SECURITY_BASELINE_CHECKS.slice(0, k), { ca: k > 0, ga: k > 0 });
      const live = score(profile, rules, CATALOG_SET);
      const pkg = score(profile, rules, BASELINE_SET);
      console.log(`  ${String(k).padStart(2)}   ${fmt(live.overall)}                 ${fmt(pkg.overall)}`);
    }
    expect(true).toBe(true);
  });

  it("E. weight-independent proof — the ratio is bounded by catalog share", () => {
    console.log("\n=== E. Weight-independent: uniform weights make the formula a pure count ratio ===");
    const rules = buildCorpus(true); // every impact = 1
    const allFire = tenantProfile(SECURITY_BASELINE_CHECKS, { ca: true, ga: true });
    const live = score(allFire, rules, CATALOG_SET);
    const pkg = score(allFire, rules, BASELINE_SET);
    console.log(`  fired signals: ${live.fired} of ${CATALOG_CHECKS.length} catalog signals`);
    console.log(`  100 - 29/122*100 = ${Math.round(100 - (29 / 122) * 100)}  (predicted live-path floor)`);
    row("LIVE path, uniform weights, EVERYTHING broken", live);
    row("package-scoped, uniform weights, EVERYTHING broken", pkg);
    expect(pkg.overall).toBe(0);
  });

  it("F. sensitivity — the live score is governed by WHERE weight mass sits, not by tenant health", () => {
    console.log("\n=== F. Same tenant, same findings; only the weight DISTRIBUTION changes ===");
    const scannedSet = new Set(SECURITY_BASELINE_CHECKS);

    // Same tenant state throughout: the two confirmed findings + 8 more broken checks.
    const profile = tenantProfile(SECURITY_BASELINE_CHECKS.slice(0, 8), { ca: true, ga: true });

    const skew = (factor: number, onScanned: boolean) =>
      buildCorpus(false).map((r) => {
        const owning = r.ruleType === "threshold" ? r.sourceKey
          : r.signalKey === CA_SIGNAL ? "identity:ca-policy-count"
          : "identity:global-admin-count";
        const isScanned = scannedSet.has(owning);
        if (isScanned !== onScanned) return r;
        const scaled: Record<string, number> = {};
        for (const f of ["governanceImpact", "securityImpact", "complianceImpact", "adoptionImpact",
                         "copilotImpact", "architectureImpact", "licensingImpact"]) {
          scaled[f] = Math.round((r as unknown as Record<string, number>)[f] * factor);
        }
        return { ...r, ...scaled } as SignalDerivationRule;
      });

    row("uniform weight across the catalog", score(profile, buildCorpus(false), CATALOG_SET));
    row("3x heavier on checks the tenant NEVER RAN", score(profile, skew(3, false), CATALOG_SET));
    row("3x heavier on the checks it DID run", score(profile, skew(3, true), CATALOG_SET));
    console.log("  (identical tenant, identical findings — only rule authoring moved)");
    expect(true).toBe(true);
  });
});

function cFmt(n: number | null) { return n == null ? "null" : String(n); }
