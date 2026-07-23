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
 *     -> signal_derivation_rules (sourceKey = checkKey -> signalKey)
 *     -> that signal's per-pillar impact fields (health-engine.ts's own
 *        getSignalHealthImpacts)
 * A pillar is included only if (a) at least one of the package's real checks
 * feeds a rule with nonzero impact for that pillar, AND (b) the health
 * engine's own display normalization has real data for that pillar
 * system-wide (theoreticalMax > 0 — health-display.ts's own "don't fabricate"
 * guard). As monitoring_package_checks gets curated for more packages, this
 * automatically surfaces more pillars; nothing here needs to change.
 */

import { db, monitoringPackageChecksTable } from "@workspace/db";
import { eq } from "drizzle-orm";
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

  const coveredSignalKeys = new Set(
    rules.filter((r) => coveredCheckKeys.has(r.sourceKey)).map((r) => r.signalKey),
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
