import { lazy, Suspense } from "react";

export interface ScatterPoint {
  /** Real entity name for the hover tooltip (e.g. a license SKU name). */
  label: string;
  x: number;
  y: number;
}

const Inner = lazy(() => import("./ScatterChartInner"));

interface ScatterChartProps {
  points: ScatterPoint[];
  /** Axis names, shown as muted in-chart labels and in the hover tooltip. */
  xLabel: string;
  yLabel: string;
  height?: number;
  className?: string;
}

/**
 * Small two-measure scatter for claims about a RELATIONSHIP between two real
 * quantities per entity (e.g. license seats assigned vs. seats actively used,
 * by SKU — waste is the vertical gap below the diagonal). One series only, so
 * no legend; the surrounding heading/caption names it. Draws a recessive x=y
 * reference diagonal ("full utilization" line) so the gap reads without
 * decoding coordinates. recharts-based, lazy-loaded like TrendLineChart so
 * recharts stays out of the main bundle.
 *
 * Data honesty: callers showing example data must pair this with the site's
 * "Illustrative Example" badge convention.
 */
export function ScatterChart({ points, xLabel, yLabel, height = 200, className }: ScatterChartProps) {
  // aria-hidden: decorative at every call site — per-point values live in a
  // hover tooltip unusable by AT; the visible caption carries the meaning.
  return (
    <div className={className} style={{ height }} aria-hidden="true">
      <Suspense fallback={<div style={{ height }} />}>
        <Inner points={points} xLabel={xLabel} yLabel={yLabel} height={height} />
      </Suspense>
    </div>
  );
}
