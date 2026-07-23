/**
 * pillar-coverage.ts
 *
 * Determines which real health pillars a customer's scanned monitoring
 * package genuinely covers, for the Assessment generating screen's radar —
 * never fabricating a score for a pillar the package's checks don't actually
 * feed. Reuses the real health engine and its existing display normalization
 * (health-engine.ts / health-display.ts) rather than a second scoring path.
 *
 * Real join, generic across packages (no per-package hardcoding):
 *   monitoring_package_checks (packageKey -> checkKey)
 *     -> the profile keys those checks genuinely PRODUCE (see below)
 *     -> signal_derivation_rules whose sourceKey reads one of those keys
 *     -> that signal's per-pillar impact fields (health-engine.ts's own
 *        getSignalHealthImpacts)
 * A pillar is included only if (a) at least one of the package's real checks
 * feeds a rule with nonzero impact for that pillar, AND (b) the health
 * engine's own display normalization has real data for that pillar
 * system-wide (theoreticalMax > 0 — health-display.ts's own "don't fabricate"
 * guard). As monitoring_package_checks gets curated for more packages, this
 * automatically surfaces more pillars; nothing here needs to change.
 *
 * ── How a check "feeds" a rule (the real linkage, by ruleType) ────────────────
 * This mirrors exactly what `evaluateRule()` (tenant-signals.ts) reads and what
 * the monitor pipeline writes (`applyMapping()` in monitor-executor.ts +
 * `mergeMonitorProfileRows()` / `bridgeLegacyProfileKeys()` in
 * tenant-signals.ts). A naive `sourceKey === checkKey` equality — the original
 * implementation — only ever matches `threshold` rules, because real
 * `profile_key_*` rules reference the DB-configured `monitor_checks.mapping`
 * targetFields (`hasAADP1orP2`, `projectPlanFiveCount`, …), NOT check keys.
 * That gap is why a real 122-check package with 67 passing checks still
 * returned radar.pillars: [] — the join found zero covered signals.
 *
 *   • `threshold` rules — evaluateRule reads `profile[sourceKey + "__itemCount"]`,
 *     and mergeMonitorProfileRows stamps `<checkKey>__itemCount` for every
 *     check row. So sourceKey IS a check key: covered iff the package contains
 *     that check.
 *   • `profile_key_*` rules — sourceKey is a merged-profile field. A covered
 *     check produces it when it is:
 *       – one of the check's `mapping[].targetField` values (applyMapping), or
 *       – `<prop>_count` / `<prop>_first` / `<prop>_values` for one of the
 *         check's raw `properties` entries (applyMapping's raw extraction), or
 *       – the synthetic `<checkKey>__itemCount` key itself, or
 *       – a bridged legacy key with its known real producer check in the
 *         package (bridgeLegacyProfileKeys: `conditionalAccessPolicyCount` /
 *         `conditionalAccessPoliciesCount` ← `identity:ca-policy-count`,
 *         `securityScore` ← `security:secure-score`), or
 *       – the bare check key (defensive: a mapping is free to target the check
 *         key itself, and the original narrow-package verification relied on
 *         exactly that shape — kept so it can never regress).
 *     Script-era profile keys with no monitor-check producer are deliberately
 *     NOT counted — this module measures what the PACKAGE covers, and a key
 *     only a customer-uploaded script writes is not package coverage.
 *   • `findings_keyword` rules — evaluateRule substring-matches the keyword
 *     against finding strings, and `deriveMonitorFindings()` builds those
 *     strings as `"<checkKey>: <severity> severity condition matched…"`. The
 *     deterministic keyword surface a package contributes is therefore its
 *     check keys: covered iff the keyword appears (case-insensitive) inside
 *     any covered check key. (Script-run findings are, again, not package
 *     coverage.)
 */

import { db, monitoringPackageChecksTable, monitorChecksTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import {
  HEALTH_PILLARS,
  PILLAR_FIELD,
  getSignalHealthImpacts,
  calculateArchitectureHealthScore,
  type HealthPillar,
  type SignalHealthImpactConfig,
} from "./health-engine.ts";
import { computePillarDisplayScore } from "./health-display.ts";
import { fetchSignalRulesAndGroups } from "./priority-engine.ts";
import type { SignalDerivationRule } from "./tenant-signals.ts";

/**
 * The radar's full pillar universe: the six health pillars PLUS the
 * separately-computed security pillar. Security is deliberately NOT added to
 * `HEALTH_PILLARS` itself (that would double-count it inside
 * `computeHealthEngine` — it's scored by the standalone Security Engine and
 * combined one level up in `calculateArchitectureHealthScore`, whose combined
 * breakdown this module already consumes). Here it is just one more checkable
 * coverage option: `PILLAR_FIELD.security` -> `securityImpact` already exists
 * on every rule/group, so the identical real-coverage test applies.
 */
export type RadarPillar = HealthPillar | "security";
const RADAR_PILLARS: readonly RadarPillar[] = [...HEALTH_PILLARS, "security"];

/** Mirrors MissionControl.tsx's PILLAR_LABELS so the same pillar reads identically everywhere. */
export const PILLAR_LABELS: Record<RadarPillar, string> = {
  governance: "Governance",
  compliance: "Compliance",
  adoption: "Adoption",
  copilot: "Copilot Readiness",
  architecture: "Architecture",
  licensing: "Licensing",
  security: "Security",
};

export interface PillarCoverageEntry {
  pillar: RadarPillar;
  label: string;
  score: number;
}

/**
 * Bridged legacy profile keys and their single real producer check — MUST stay
 * in lockstep with `bridgeLegacyProfileKeys()` in tenant-signals.ts (each entry
 * there documents its code-verified Graph producer; keys with no real producer
 * are deliberately absent from both places).
 */
const BRIDGED_KEY_PRODUCER_CHECK: Record<string, string> = {
  conditionalAccessPolicyCount: "identity:ca-policy-count",
  conditionalAccessPoliciesCount: "identity:ca-policy-count",
  securityScore: "security:secure-score",
};

/** The definition subset needed to enumerate a check's producible profile keys. */
interface CheckDefinitionRow {
  key: string;
  mapping: Array<{ sourceField: string; targetField: string; transform?: string }> | null;
  properties: string[] | null;
}

/**
 * Every merged-profile key the given checks can genuinely produce — mirrors
 * `applyMapping()` + `mergeMonitorProfileRows()` + `bridgeLegacyProfileKeys()`.
 * Pure; exported for tests.
 */
export function buildProducibleProfileKeys(
  coveredCheckKeys: ReadonlySet<string>,
  checkDefinitions: CheckDefinitionRow[],
): Set<string> {
  const producible = new Set<string>();

  for (const checkKey of coveredCheckKeys) {
    // Bare check key (defensive — a mapping may target it directly) and the
    // synthetic itemCount key mergeMonitorProfileRows always stamps.
    producible.add(checkKey);
    producible.add(`${checkKey}__itemCount`);
  }

  for (const def of checkDefinitions) {
    if (!coveredCheckKeys.has(def.key)) continue;
    for (const rule of def.mapping ?? []) {
      if (rule?.targetField) producible.add(rule.targetField);
    }
    for (const prop of def.properties ?? []) {
      if (!prop) continue;
      producible.add(`${prop}_count`);
      producible.add(`${prop}_first`);
      producible.add(`${prop}_values`);
    }
  }

  for (const [bridgedKey, producerCheck] of Object.entries(BRIDGED_KEY_PRODUCER_CHECK)) {
    if (coveredCheckKeys.has(producerCheck)) producible.add(bridgedKey);
  }

  return producible;
}

/**
 * Whether at least one of the package's checks genuinely feeds this rule —
 * ruleType-aware, mirroring exactly what `evaluateRule()` reads (see the file
 * header). Pure; exported for tests.
 */
export function ruleIsFedByPackage(
  rule: Pick<SignalDerivationRule, "ruleType" | "sourceKey">,
  coveredCheckKeys: ReadonlySet<string>,
  producibleProfileKeys: ReadonlySet<string>,
): boolean {
  switch (rule.ruleType) {
    case "threshold":
      // evaluateRule reads profile[`${sourceKey}__itemCount`], stamped per check.
      return coveredCheckKeys.has(rule.sourceKey);
    case "findings_keyword": {
      // deriveMonitorFindings strings start with the check key — the package's
      // deterministic keyword surface.
      const keyword = (rule.sourceKey ?? "").toLowerCase();
      if (!keyword) return false;
      for (const checkKey of coveredCheckKeys) {
        if (checkKey.toLowerCase().includes(keyword)) return true;
      }
      return false;
    }
    default:
      // profile_key_truthy / falsy / eq / gt / lt (and any future profile
      // reader): sourceKey is a merged-profile field.
      return producibleProfileKeys.has(rule.sourceKey);
  }
}

export async function getPillarCoverage(
  packageKey: string,
  customerId: number,
): Promise<PillarCoverageEntry[]> {
  const [packageChecks, { rules, groups }, healthOutput] = await Promise.all([
    db
      .select({ checkKey: monitoringPackageChecksTable.checkKey })
      .from(monitoringPackageChecksTable)
      .where(eq(monitoringPackageChecksTable.packageKey, packageKey)),
    fetchSignalRulesAndGroups(),
    calculateArchitectureHealthScore(customerId),
  ]);

  const coveredCheckKeys = new Set(packageChecks.map((c) => c.checkKey));
  if (coveredCheckKeys.size === 0) return [];

  // The checks' real definitions — needed to enumerate the profile keys they
  // produce (mapping targetFields + raw-property extraction keys), which is
  // what real profile_key_* rules reference as their sourceKey.
  const checkDefinitions: CheckDefinitionRow[] = await db
    .select({
      key: monitorChecksTable.key,
      mapping: monitorChecksTable.mapping,
      properties: monitorChecksTable.properties,
    })
    .from(monitorChecksTable)
    .where(inArray(monitorChecksTable.key, [...coveredCheckKeys]));

  const producibleProfileKeys = buildProducibleProfileKeys(coveredCheckKeys, checkDefinitions);

  const coveredSignalKeys = new Set(
    rules
      .filter((r) => ruleIsFedByPackage(r, coveredCheckKeys, producibleProfileKeys))
      .map((r) => r.signalKey),
  );
  if (coveredSignalKeys.size === 0) return [];

  const impacts = getSignalHealthImpacts(rules, groups);

  const covered: PillarCoverageEntry[] = [];
  for (const pillar of RADAR_PILLARS) {
    const field = PILLAR_FIELD[pillar] as keyof Omit<SignalHealthImpactConfig, "signalKey">;
    const hasRealCoverage = [...coveredSignalKeys].some(
      (signalKey) => (impacts.get(signalKey)?.[field] ?? 0) > 0,
    );
    if (!hasRealCoverage) continue;

    // Same honest display normalization for all seven pillars.
    // `healthOutput` comes from `calculateArchitectureHealthScore`, whose
    // breakdown already includes the Security Engine's real security entry —
    // no separate scoring path here.
    const displayScore = computePillarDisplayScore(pillar, healthOutput, impacts);
    if (displayScore == null) continue; // no rules configured anywhere for this pillar — don't fabricate

    covered.push({ pillar, label: PILLAR_LABELS[pillar], score: displayScore });
  }

  return covered;
}
