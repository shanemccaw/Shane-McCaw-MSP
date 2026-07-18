/**
 * smart-state.ts
 *
 * Step 5 of the Dashboard / Web Part System — the decision logic that tells the
 * `Smart` renderer (see renderers/Smart.tsx) WHICH state to render for a
 * smart-eligible metric, given its current value and recent history.
 *
 * The `Smart` component itself is intentionally dumb: it takes an explicit
 * `state: "remediation" | "complete"` and renders accordingly. This module is
 * the brain that computes that state. It is pure (no I/O, no React) so it can be
 * unit-tested in isolation and reused anywhere.
 *
 * ── Direction inference (higher-is-better vs lower-is-better) ──────────────────
 * `smartBands` does not explicitly encode a direction. We infer it from the
 * relationship between critical / needsImprovement / acceptable and the target:
 *
 *   critical < needsImprovement < acceptable, target >= acceptable  → HIGHER is better
 *     (e.g. MFA coverage: 100 is the goal, low numbers are bad)
 *   critical > needsImprovement > acceptable, target <= acceptable  → LOWER is better
 *     (e.g. legacy-auth users: 0 is the goal, high numbers are bad)
 *
 * Anything that fits NEITHER strictly-monotonic pattern is ambiguous. Rather
 * than guess, `inferDirection` returns `null` and `resolveSmartState` surfaces
 * that as a thrown error — the signal that a registry entry needs fixing, not
 * that a direction should be forced.
 *
 * ── Hysteresis (the deliberate grace behavior) ────────────────────────────────
 * When the current value meets the target we do NOT immediately flip to
 * "complete". We look back through the fetched history window for the most
 * recent point that dipped BELOW the `acceptable` band threshold (not below the
 * target — that grace gap is the whole point). If such a dip exists in the
 * window, we stay in "remediation" so the widget tells the recovery story
 * ("2/25 → 14/25 → 25/25, almost there") instead of snapping binary. Only once
 * the entire window is clear of a below-acceptable dip do we show "complete".
 *
 * This is deliberately STATELESS — there is no persisted "last displayed state".
 * The history window is the memory. See the task spec: an alert-lifecycle
 * (acknowledge/clear) system does not exist yet; this data-only grace band is
 * the intended interim behavior and must not be stubbed toward one.
 */

import type { MetricDef, SmartBands } from "@workspace/dashboard-registry";

/** Which way is "better" for a smart-eligible metric. */
export type SmartDirection = "higher-is-better" | "lower-is-better";

/** A single historical sample, matching the resolve endpoint's history payload. */
export interface SmartHistoryPoint {
  /** ISO timestamp of the sample. */
  t: string;
  value: number;
}

export interface SmartStateResult {
  state: "remediation" | "complete";
  /** The target the metric is judged against (the metric's smartDefaultTarget). */
  target: number;
  /** The current value fed in, echoed back for the renderer. */
  currentValue: number;
  direction: SmartDirection;
  /**
   * For the remediation sparkline text ("X → improving"): current value minus
   * the earliest point in the fetched history window. Undefined when there is no
   * history to measure against. Sign is raw (positive = value went up); the
   * renderer interprets it against direction.
   */
  deltaFromStart?: number;
}

/**
 * Infer whether higher or lower is better from the band ordering + target.
 * Returns null when the bands don't fit either strictly-monotonic pattern —
 * the caller treats null as "registry entry is malformed", not "pick one".
 */
export function inferDirection(bands: SmartBands, target: number): SmartDirection | null {
  const { critical, needsImprovement, acceptable } = bands;

  // Higher-is-better: bands ascend toward the good end, target sits at/above the top band.
  if (critical < needsImprovement && needsImprovement < acceptable && target >= acceptable) {
    return "higher-is-better";
  }
  // Lower-is-better: bands descend toward the good end, target sits at/below the bottom band.
  if (critical > needsImprovement && needsImprovement > acceptable && target <= acceptable) {
    return "lower-is-better";
  }
  return null;
}

/** Does `value` meet the target, given the direction? (target itself counts as met.) */
function meetsTarget(value: number, target: number, direction: SmartDirection): boolean {
  return direction === "higher-is-better" ? value >= target : value <= target;
}

/** Is `value` on the "bad" side of the `acceptable` band threshold? */
function belowAcceptable(value: number, acceptable: number, direction: SmartDirection): boolean {
  // higher-is-better → "below acceptable" means numerically under the band.
  // lower-is-better  → "below acceptable" (worse than acceptable) means numerically over the band.
  return direction === "higher-is-better" ? value < acceptable : value > acceptable;
}

/**
 * Decide the Smart widget's state for a metric.
 *
 * @throws if the metric is not smart-eligible / lacks bands+target, or if its
 *         bands don't infer a clean direction (a registry bug to surface, not hide).
 */
export function resolveSmartState(
  def: MetricDef,
  currentValue: number,
  history: SmartHistoryPoint[],
): SmartStateResult {
  if (!def.smartEligible || def.smartBands == null || def.smartDefaultTarget == null) {
    throw new Error(
      `resolveSmartState called on non-smart metric "${def.key}" (smartEligible/smartBands/smartDefaultTarget missing)`,
    );
  }
  const target = def.smartDefaultTarget;
  const bands = def.smartBands;
  const direction = inferDirection(bands, target);
  if (direction == null) {
    throw new Error(
      `resolveSmartState: metric "${def.key}" has bands that don't infer a clean direction ` +
        `(critical=${bands.critical}, needsImprovement=${bands.needsImprovement}, acceptable=${bands.acceptable}, target=${target})`,
    );
  }

  // Sort history oldest→newest so "earliest" / "most recent dip" are well-defined
  // regardless of the order the resolver returned rows in.
  const ordered = [...history].sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
  const earliest = ordered.length > 0 ? ordered[0] : undefined;
  const deltaFromStart = earliest != null ? currentValue - earliest.value : undefined;

  const base: Omit<SmartStateResult, "state"> = {
    target,
    currentValue,
    direction,
    ...(deltaFromStart != null ? { deltaFromStart } : {}),
  };

  // Not at target → always remediation.
  if (!meetsTarget(currentValue, target, direction)) {
    return { ...base, state: "remediation" };
  }

  // At/beyond target → apply hysteresis. If any point in the window dipped below
  // the acceptable band, we're still telling the recovery story: remediation.
  const hasRecentDip = ordered.some((p) => belowAcceptable(p.value, bands.acceptable, direction));
  return { ...base, state: hasRecentDip ? "remediation" : "complete" };
}
