/**
 * Shared type definitions for the dashboard registry.
 *
 * This package is pure type/data declaration — it declares *what* is fetchable
 * and *how* it can be displayed. No data-fetching lives here (Phase 7 backend
 * resolvers consume `sourceType`/`sourceKey` to actually fetch data).
 */

/** How the raw value of a metric is interpreted. */
export type MetricValueType =
  | "count"
  | "percentage-eligible"
  | "currency"
  | "ratio"
  | "time-series"
  | "categorical"
  | "event-list";

/**
 * The structural shape of a metric's data. Renderers accept metrics by shape,
 * so this is the primary compatibility key between a metric and a chart type.
 */
export type MetricShape =
  | "scalar"
  | "trend"
  | "distribution"
  | "heatmap"
  | "timeline";

/** Where a metric's data comes from — dictates which resolver Phase 7 uses. */
export type MetricSourceType =
  | "engine_snapshot"
  | "monitor_profile"
  | "platform_table";

/** Per-tenant vs MSP-aggregate scope. */
export type MetricScope = "customer" | "msp";

/**
 * Collection readiness:
 *  - `available`        — real check/table exists and is wired (catalog Tier 1)
 *  - `needs_aggregation`— data exists but needs a group-by/bucketing transform (Tier 2)
 *  - `not_collected`    — no source exists yet, net-new collection work (Tier 3)
 */
export type MetricStatus = "available" | "needs_aggregation" | "not_collected";

/** Smart-mode banding thresholds (interpreted relative to the metric's target). */
export interface SmartBands {
  critical: number;
  needsImprovement: number;
  acceptable: number;
}

export interface MetricDef {
  /** Stable identifier, namespaced by catalog domain, e.g. "identity.mfaCoverage". */
  key: string;
  /** Human-readable label, from the catalog's Metric column. */
  label: string;
  valueType: MetricValueType;
  shape: MetricShape;
  /**
   * Key of another MetricDef, set only when a natural % conversion exists
   * (e.g. `oversharedSiteCount`'s denominator is `sharePointSiteCount`).
   */
  denominatorMetric?: string;
  sourceType: MetricSourceType;
  /**
   * Engine key (e.g. "health"), monitor checkKey (e.g. "identity:mfa-registration"),
   * or platform table name — the exact string from the catalog / monitor_checks.
   */
  sourceKey: string;
  scope: MetricScope;
  status: MetricStatus;
  /**
   * True only for metrics with a clear "better direction" and a sensible target
   * (security/compliance coverage), not revenue or raw counts.
   */
  smartEligible: boolean;
  smartDefaultTarget?: number;
  smartBands?: SmartBands;
}

export interface RendererDef {
  type: string;
  label: string;
  /** Which metric shapes this renderer can consume. */
  acceptedShapes: MetricShape[];
  supportsSmartMode: boolean;
  /** Sensible default grid size for react-grid-layout. */
  defaultSize: { w: number; h: number };
}
