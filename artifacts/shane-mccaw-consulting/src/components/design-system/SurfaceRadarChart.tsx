import { lazy, Suspense } from "react";

export interface RadarAxis {
  label: string;
  value: number;
}

const Inner = lazy(() => import("./SurfaceRadarChartInner"));

interface SurfaceRadarChartProps {
  axes: RadarAxis[];
  /** Series name shown in the hover tooltip (e.g. "Illustrative sub-score"). */
  seriesLabel: string;
  height?: number;
  className?: string;
}

/**
 * Radar (spider) chart for a genuinely multi-dimensional comparison claim —
 * several named dimensions of one subject scored in relation to each other on
 * a shared 0–100 scale. One series only by design: with a single subject the
 * chart needs no legend (the surrounding heading/caption names it), and
 * multi-series radars stop being readable. recharts-based, lazy-loaded like
 * TrendLineChart so recharts stays out of the main bundle.
 *
 * Data honesty: callers showing example data must pair this with the site's
 * "Illustrative Example" badge convention.
 */
export function SurfaceRadarChart({
  axes,
  seriesLabel,
  height = 260,
  className,
}: SurfaceRadarChartProps) {
  return (
    <div className={className} style={{ height }}>
      <Suspense fallback={<div style={{ height }} aria-hidden="true" />}>
        <Inner data={axes} seriesLabel={seriesLabel} height={height} />
      </Suspense>
    </div>
  );
}
