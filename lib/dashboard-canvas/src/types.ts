/**
 * Shared types for the dashboard web-part system's canvas + renderer layer.
 *
 * This is the UI-side counterpart to `@workspace/dashboard-registry` (which
 * declares *what* is fetchable and how) and `MetricResult` from
 * `artifacts/api-server/src/lib/dashboard-resolvers.ts` (which is what actually
 * comes back over the wire from `POST /api/dashboard/resolve`). Renderers here
 * consume a normalized `WidgetData` shape derived from a `MetricResult`, not the
 * raw result — see `resolveWidgetData` in `data-fetcher.ts`.
 */

import type { MetricShape } from "@workspace/dashboard-registry";

// ── Widget instance (canvas layout entry) ──────────────────────────────────────

/** Raw-count vs. percentage display, only meaningful for metrics with a denominatorMetric. */
export type WidgetDisplayMode = "count" | "percentage";

/**
 * One placed widget on a dashboard canvas. `i/x/y/w/h` are the react-grid-layout
 * placement fields; the rest identify what to render and how.
 */
export interface WidgetInstance {
  /** react-grid-layout item id — must be unique within a canvas. */
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** MetricDef.key from @workspace/dashboard-registry. */
  metricKey: string;
  /** RendererDef.type from @workspace/dashboard-registry (e.g. "Stat", "Gauge"). */
  rendererType: string;
  displayMode?: WidgetDisplayMode;
  /** Renderer-specific overrides (title, color, etc.) — passed through as-is. */
  properties?: Record<string, unknown>;
}

// ── Normalized data each renderer actually consumes ─────────────────────────────

export interface ScalarWidgetData {
  shape: "scalar";
  value: number | null;
  /** Present when the metric has a denominatorMetric and the resolver computed it. */
  percentage?: number | null;
  label: string;
  unit?: string;
}

export interface TrendPoint {
  date: string;
  value: number;
}
export interface TrendWidgetData {
  shape: "trend";
  points: TrendPoint[];
  label: string;
}

export interface DistributionSlice {
  name: string;
  value: number;
}
export interface DistributionWidgetData {
  shape: "distribution";
  slices: DistributionSlice[];
  label: string;
}

export interface HeatmapCell {
  x: number | string;
  y: number | string;
  value: number;
}
export interface HeatmapWidgetData {
  shape: "heatmap";
  cells: HeatmapCell[];
  label: string;
}

export type TimelineEventStatus = "ok" | "warning" | "critical" | "info";
export interface TimelineEvent {
  id: string;
  title: string;
  time: string;
  status: TimelineEventStatus;
}
export interface TimelineWidgetData {
  shape: "timeline";
  events: TimelineEvent[];
  label: string;
}

export type WidgetData =
  | ScalarWidgetData
  | TrendWidgetData
  | DistributionWidgetData
  | HeatmapWidgetData
  | TimelineWidgetData;

// ── Per-widget resolved state (loading/ok/not_available/error) ─────────────────

export type WidgetStateStatus = "loading" | "ok" | "not_available" | "error";

export interface WidgetState {
  status: WidgetStateStatus;
  data?: WidgetData;
  /** Human-readable note — MetricResult.reason/detail for not_available, or the error message. */
  message?: string;
  /**
   * Recent history (oldest→newest) carried through from an opted-in
   * MetricResult.history. Only populated for metrics whose widget requested it
   * (Smart widgets). The DashboardCanvas Smart branch runs resolveSmartState
   * over this to decide remediation vs complete + build the sparkline.
   */
  history?: { t: string; value: number }[];
}

// ── Smart renderer's explicit banding state (decision logic is a later step) ───

export type SmartBandState = "critical" | "needs_improvement" | "acceptable" | "remediation" | "complete";

export interface SmartWidgetProps {
  state: Extract<SmartBandState, "remediation" | "complete">;
  data: ScalarWidgetData;
  /** Prior value to compute the sparkline/delta against, when in "remediation" state. */
  previousValue?: number | null;
  history?: TrendPoint[];
}

// ── Data-fetch injection contract ────────────────────────────────────────────────

import type { MetricDef } from "@workspace/dashboard-registry";

/** MetricResult, duplicated here (not imported) to keep this package free of an
 *  api-server import — the shape is a stable public contract of
 *  POST /api/dashboard/resolve documented in dashboard-data.ts. */
export type MetricResultStatus = "ok" | "not_available" | "error";
export interface MetricResult {
  metricKey: string;
  status: MetricResultStatus;
  shape?: MetricShape;
  valueType?: string;
  scope?: "customer" | "msp";
  data?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  reason?: string;
  detail?: string;
  error?: string;
  /** Present only when the request opted this metric into `includeHistory` and a
   *  series exists — feeds the Smart renderer's sparkline + hysteresis. */
  history?: { t: string; value: number }[];
}

export interface DashboardResolveScope {
  type: "customer" | "msp";
  id: number;
}

/**
 * Injected into <DashboardCanvas> — resolves a batch of metric keys against a
 * scope and returns the raw MetricResult per key, keyed by metricKey. Kept
 * injectable (not hardcoded) so the canvas stays testable against a fixture
 * fetcher; the real implementation lives in `data-fetcher.ts`.
 *
 * `historyKeys` (Step 5) is the subset of `metricKeys` for which the result
 * should also carry `history` — the Smart renderer needs it, other renderers
 * don't. Optional so existing callers/fixtures that ignore it keep working.
 */
export type DashboardDataFetcher = (
  metricKeys: string[],
  scope: DashboardResolveScope,
  historyKeys?: string[],
) => Promise<Record<string, MetricResult>>;

export type { MetricDef };
