import type { MetricDef, RendererDef } from "./types";
import { DASHBOARD_METRICS } from "./metrics";
import { DASHBOARD_RENDERERS } from "./renderers";

/** Index of metrics by key for O(1) lookup. */
const METRICS_BY_KEY = new Map<string, MetricDef>(
  DASHBOARD_METRICS.map((m) => [m.key, m]),
);

/** Look up a metric definition by its stable key. */
export function getMetric(metricKey: string): MetricDef | undefined {
  return METRICS_BY_KEY.get(metricKey);
}

/**
 * Whether a renderer can legally render a given metric.
 *
 * Rules:
 *  1. The metric's `shape` must be in the renderer's `acceptedShapes`.
 *  2. ScoreRing additionally requires the metric to have a `denominatorMetric`
 *     (it is fundamentally a percentage-ring display).
 *  3. Smart additionally requires the metric to be `smartEligible`.
 */
export function canRendererRenderMetric(
  renderer: RendererDef,
  metric: MetricDef,
): boolean {
  if (!renderer.acceptedShapes.includes(metric.shape)) {
    return false;
  }
  if (renderer.type === "ScoreRing" && !metric.denominatorMetric) {
    return false;
  }
  if (renderer.type === "Smart" && !metric.smartEligible) {
    return false;
  }
  return true;
}

/**
 * Return the renderers a given metric can legally use (shape match plus the
 * ScoreRing/Smart runtime rules). Phase 3's designer palette calls this to
 * filter the renderer choices offered for a selected metric.
 *
 * Returns `[]` for an unknown metric key.
 */
export function getValidRenderersForMetric(metricKey: string): RendererDef[] {
  const metric = METRICS_BY_KEY.get(metricKey);
  if (!metric) {
    return [];
  }
  return DASHBOARD_RENDERERS.filter((renderer) =>
    canRendererRenderMetric(renderer, metric),
  );
}
