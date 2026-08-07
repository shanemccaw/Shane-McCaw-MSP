/**
 * diagnose-542-pillar-breakdown.ts (#542)
 *
 * TEMPORARY DIAGNOSTIC — delete after use. Not a fix, not app logic: no
 * scoring/weight change is made here. #541's fix made
 * `appgov:cert-secret-expiration` fire a real finding for the first time,
 * and the architecture pillar's display score crashed to 3 immediately
 * after. That signal's own configured `architectureImpact` is 12 —
 * moderate on its own — so either most of the OTHER architecture signals
 * are also firing right now, or (per #413/#481) the real package-scoped
 * `theoreticalMax` denominator for this tenant is much smaller than the
 * full catalog sum. Guessing at the answer via hand-written SQL risks the
 * exact mistake #541 was already about (reconstructing behavior instead of
 * reading/running the real code path), so this calls the platform's own
 * real functions directly instead:
 *
 *   - `calculateArchitectureHealthScore` (health-engine.ts) — the real
 *     `rawScore` + full per-signal `contributions` for every pillar.
 *   - `fetchTenantEvaluableSignalKeys` (pillar-coverage.ts) — the real
 *     package-scoped evaluable-signal set for THIS tenant (#413), the same
 *     one `/portal/health-benchmark` passes in production.
 *   - `evaluatePillarDisplay` (health-display.ts) — the real
 *     `theoreticalMax`, `evaluableSignalCount`, and display `score` (or
 *     `insufficient_data`/`not_evaluated` status) built from those two.
 *
 * Prints the full breakdown for every pillar, architecture called out
 * first since that's the one in question.
 *
 * Run (Shane's environment only — needs a real DATABASE_URL; Claude Code's
 * sandbox here has none, per CLAUDE.md, and this script was NOT run or
 * verified against live data):
 *
 *   pnpm --filter @workspace/api-server run build
 *   pnpm --filter @workspace/api-server run diagnose-542
 *
 * Required env vars: DATABASE_URL (whatever the rest of api-server already
 * needs to boot — no new config).
 */

import {
  calculateArchitectureHealthScore,
  getSignalHealthImpacts,
  HEALTH_PILLARS,
  type HealthPillar,
} from "../lib/health-engine.ts";
import { evaluatePillarDisplay } from "../lib/health-display.ts";
import { fetchSignalRulesAndGroups } from "../lib/priority-engine.ts";
import { fetchTenantEvaluableSignalKeys } from "../lib/pillar-coverage.ts";

// Testbed tenant named in #541/#542: c4c814d4-3afe-441e-9145-62461d0a4fd3
const CUSTOMER_ID = 1;

const ALL_PILLARS: readonly (HealthPillar | "security")[] = [...HEALTH_PILLARS, "security"];

async function main() {
  console.log(`[diagnose-542] customerId=${CUSTOMER_ID}`);

  const [output, { rules, groups }] = await Promise.all([
    calculateArchitectureHealthScore(CUSTOMER_ID),
    fetchSignalRulesAndGroups(),
  ]);

  console.log(`[diagnose-542] fired signals (${output.rawSignals.length}): ${output.rawSignals.join(", ") || "(none)"}`);

  const impacts = getSignalHealthImpacts(rules, groups);

  // Same call `/portal/health-benchmark` makes for a real tenant (#413):
  // package-scoped, widened by whatever fired outside the package.
  const evaluableSignalKeys = await fetchTenantEvaluableSignalKeys(CUSTOMER_ID, rules, {
    firedSignalKeys: output.rawSignals,
  });
  console.log(`[diagnose-542] evaluable signal keys (${evaluableSignalKeys.size}): ${[...evaluableSignalKeys].join(", ") || "(none)"}`);

  // Architecture first — that's the pillar in question — then every other
  // pillar for context (a crashed architecture score sitting next to
  // healthy siblings points at that signal's own weight; all pillars
  // crashing together points at the denominator).
  const orderedPillars: (HealthPillar | "security")[] = [
    "architecture",
    ...ALL_PILLARS.filter((p) => p !== "architecture"),
  ];

  for (const pillar of orderedPillars) {
    const breakdown = output.breakdown.find((b) => b.pillar === pillar);
    const display = evaluatePillarDisplay(pillar, output, impacts, evaluableSignalKeys);

    console.log(`\n=== pillar: ${pillar} ${pillar === "architecture" ? "(#542 target)" : ""} ===`);
    console.log(`  rawScore:            ${breakdown?.score ?? "(no breakdown entry)"}`);
    console.log(`  theoreticalMax:      ${display.theoreticalMax}`);
    console.log(`  evaluableSignalCount:${display.evaluableSignalCount} (min required: ${display.minRequiredSignals})`);
    console.log(`  status:              ${display.status}`);
    console.log(`  displayScore:        ${display.score ?? "(null)"}`);
    console.log(`  reason:              ${display.reason}`);

    const contributions = (breakdown?.contributions ?? [])
      .filter((c) => c.value !== 0)
      .sort((a, b) => b.value - a.value);
    console.log(`  nonzero contributions (${contributions.length}/${breakdown?.contributions.length ?? 0} fired signals):`);
    for (const c of contributions) {
      console.log(`    ${c.signalKey.padEnd(40)} ${c.value}`);
    }
  }

  process.exit(0);
}

main().catch((err) => {
  // Deliberate exception: standalone CLI script, runs outside the live
  // server process, so the SSE hub / Log Stream have no listener here.
  console.error("[diagnose-542] Failed:", err);
  process.exit(1);
});
