import type { RendererDef } from "./types";

/**
 * Renderer registry — one entry per chart/display type the dashboard system
 * can render. A renderer accepts a metric when the metric's `shape` is in the
 * renderer's `acceptedShapes` (plus extra runtime rules for ScoreRing / Smart,
 * enforced in `getValidRenderersForMetric`).
 */
export const DASHBOARD_RENDERERS: RendererDef[] = [
  {
    type: "Stat",
    label: "Stat card",
    acceptedShapes: ["scalar"],
    supportsSmartMode: false,
    defaultSize: { w: 2, h: 2 },
  },
  {
    type: "Gauge",
    label: "Gauge",
    acceptedShapes: ["scalar"],
    supportsSmartMode: true,
    defaultSize: { w: 3, h: 3 },
  },
  {
    type: "Trend",
    label: "Trend line",
    acceptedShapes: ["trend"],
    supportsSmartMode: false,
    defaultSize: { w: 4, h: 3 },
  },
  {
    type: "Distribution",
    label: "Distribution (pie/donut)",
    acceptedShapes: ["distribution"],
    supportsSmartMode: false,
    defaultSize: { w: 3, h: 3 },
  },
  {
    type: "Bar",
    label: "Bar chart",
    acceptedShapes: ["distribution", "trend"],
    supportsSmartMode: false,
    defaultSize: { w: 4, h: 3 },
  },
  {
    type: "Heatmap",
    label: "Heatmap",
    acceptedShapes: ["heatmap"],
    supportsSmartMode: false,
    defaultSize: { w: 4, h: 3 },
  },
  {
    type: "Timeline",
    label: "Timeline / event feed",
    acceptedShapes: ["timeline"],
    supportsSmartMode: false,
    defaultSize: { w: 4, h: 4 },
  },
  {
    type: "Radar",
    label: "Radar / spider chart",
    acceptedShapes: ["distribution"],
    supportsSmartMode: false,
    defaultSize: { w: 4, h: 4 },
  },
  {
    /**
     * ScoreRing is fundamentally a percentage-ring display: it accepts `scalar`
     * shape only, and `getValidRenderersForMetric` further restricts it to
     * metrics whose `denominatorMetric` is set. Phase 6 ports the legacy
     * ScoreRing component into this renderer type.
     */
    type: "ScoreRing",
    label: "Score ring",
    acceptedShapes: ["scalar"],
    supportsSmartMode: false,
    defaultSize: { w: 3, h: 3 },
  },
  {
    /**
     * Smart accepts `scalar` shape only, and `getValidRenderersForMetric`
     * further restricts it to metrics where `MetricDef.smartEligible` is true.
     * Phase 3's designer palette filters on this at runtime.
     */
    type: "Smart",
    label: "Smart (target-aware)",
    acceptedShapes: ["scalar"],
    supportsSmartMode: true,
    defaultSize: { w: 3, h: 3 },
  },
];
