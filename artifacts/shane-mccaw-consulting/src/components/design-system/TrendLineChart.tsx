import { lazy, Suspense } from "react";

export interface TrendPoint {
  label: string;
  value: number;
}

const Inner = lazy(() => import("./TrendLineChartInner"));

interface TrendLineChartProps {
  data: TrendPoint[];
  /** Series name shown in the hover tooltip (e.g. "Open baseline deviations"). */
  seriesLabel: string;
  height?: number;
  className?: string;
}

/**
 * Small single-series trend line for claims about change over time (e.g. the
 * Drift Engine's real score + trendDirection output shape). recharts-based;
 * the implementation is lazy-loaded (TrendLineChartInner) so recharts stays
 * out of the main bundle — the app has no route-level code splitting, so a
 * direct import here would ship recharts to every page. The Suspense fallback
 * reserves the chart's height to avoid layout shift.
 *
 * Data honesty: this renders whatever series it's given — callers showing
 * example data must label it as such (the site's "Illustrative Example" badge
 * convention), same as every other visual in this family.
 */
export function TrendLineChart({ data, seriesLabel, height = 120, className }: TrendLineChartProps) {
  // aria-hidden: the chart is decorative at every call site — its only value/series
  // text lives in a hover tooltip and an SVG end-label, neither usable by AT; the
  // adjacent visible caption/trend-note text carries the meaning instead.
  return (
    <div className={className} style={{ height }} aria-hidden="true">
      <Suspense fallback={<div style={{ height }} />}>
        <Inner data={data} seriesLabel={seriesLabel} height={height} />
      </Suspense>
    </div>
  );
}
