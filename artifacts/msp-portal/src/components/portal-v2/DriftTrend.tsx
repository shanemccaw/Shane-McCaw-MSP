/**
 * DriftTrend.tsx — the "Drift trend · last 10 scans" sparkline in every pillar hero.
 *
 * Extracted from the Governance hero once its end-point-dot geometry was fixed,
 * and checked against Security's own markup before being shared rather than
 * assumed to match. Governance (prototype 431-448) and Security (561-580) are
 * the same block with three real differences, all of which are props here:
 *
 *   • Security carries a VERDICT LINE between the label and the chart —
 *     12px/700 in the trend colour ("Getting worse — 2 new exposures since scan
 *     12"). Governance has none, and rendering an empty one would change the
 *     block's height.
 *   • The colours are not the pillar identity colour. Governance draws in its
 *     own blue #3B82F6 with a #60a5fa dot at 0.35 fill opacity; Security draws
 *     in RED #f87171 with a red dot at 0.30 — because the line reports how the
 *     pillar is TRENDING, not which pillar it is. Passing the pillar colour in
 *     would have been wrong on Security specifically.
 *   • The gradient needs a unique id per instance or two pillars on one page
 *     would share a fill.
 *
 * ── The two-svg structure is load-bearing ──────────────────────────────────
 * The chart svg is `preserveAspectRatio="none"`: a deliberately anisotropic
 * scale (x by width/w, y by 1) so the line spans the card's fluid width.
 * Everything inside inherits that scale, which stretches a circle into an oval.
 * So the end-point dot lives in its own viewBox-less overlay where 1 user unit
 * is 1 CSS px and r=3.5 is a true circle, with `cx` as a percentage so it still
 * tracks the stretched line's last point. Collapsing these back into one svg
 * re-introduces the oval.
 *
 * ── Honest empty state (Git #1409) ──────────────────────────────────────────
 * `trend` is nullable. A caller with no real `live.history` (never-scanned
 * tenant, or too few points to draw a line) passes `null` instead of falling
 * back to a fixture's fabricated declining trend line — the leak this fixed.
 * A null trend renders the label plus `NO_SCAN_DATA_LABEL`, no svg at all,
 * rather than a chart shape nobody's data produced.
 */

import { NO_SCAN_DATA_LABEL, NO_DATA_INK } from "./NoScanDataState";

/** The geometry `govTrend`/`secTrend` compute — identical IIFEs in the prototype. */
export interface TrendGeometry {
  w: number;
  h: number;
  line: string;
  area: string;
  lastX: number;
  lastY: number;
}

/**
 * The prototype's trend IIFE, verbatim (e.g. lines 7271-7282 for Governance,
 * 15656-15666 for Security — byte-identical apart from the history array).
 * The ±3 headroom pad on the domain is what keeps the line off the frame edge.
 */
export function trendGeometry(history: readonly number[]): TrendGeometry {
  const w = 280;
  const h = 84;
  const min = Math.min(...history) - 3;
  const max = Math.max(...history) + 3;
  const pts = history.map((v, i) => {
    const x = (i / (history.length - 1)) * w;
    const y = h - ((v - min) / (max - min || 1)) * h;
    return { x: +x.toFixed(1), y: +y.toFixed(1) };
  });
  const line = pts.map((p) => `${p.x},${p.y}`).join(" ");
  const area =
    `M${pts[0].x},${h} L` +
    pts.map((p) => `${p.x},${p.y}`).join(" L") +
    ` L${pts[pts.length - 1].x},${h} Z`;
  return { w, h, line, area, lastX: pts[pts.length - 1].x, lastY: pts[pts.length - 1].y };
}

export interface DriftTrendProps {
  /** Null when there is no real history to draw — renders the honest empty state. */
  trend: TrendGeometry | null;
  /** Unique per instance — two charts on one page must not share a gradient. */
  gradientId: string;
  /** Line and area colour. Governance #3B82F6, Security #f87171. */
  lineColor: string;
  /** End-point dot. Governance #60a5fa, Security #f87171. */
  dotColor: string;
  /** Top stop opacity of the area fill. Governance 0.35, Security 0.30. */
  fillOpacity: number;
  /** Security's trend verdict sentence. Omitted entirely on Governance. */
  verdict?: string;
  /** Verdict colour — Security's is #f87171. */
  verdictColor?: string;
  "data-testid"?: string;
}

export function DriftTrend({
  trend,
  gradientId,
  lineColor,
  dotColor,
  fillOpacity,
  verdict,
  verdictColor,
  "data-testid": testId,
}: DriftTrendProps) {
  return (
    <div
      style={{
        flex: "1 1 260px",
        minWidth: 220,
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
      data-testid={testId}
    >
      <span
        style={{
          fontSize: "9.5px",
          fontWeight: 700,
          letterSpacing: ".14em",
          textTransform: "uppercase",
          color: "#64748b",
        }}
      >
        Drift trend · last 10 scans
      </span>

      {verdict && (
        <span style={{ fontSize: "12px", fontWeight: 700, color: verdictColor ?? lineColor }}>
          {verdict}
        </span>
      )}

      {/* The svg and its baseline rule share a position:relative wrapper. */}
      <div style={{ position: "relative" }}>
        {trend ? (
          <>
            <svg
              width="100%"
              height={trend.h}
              viewBox={`0 0 ${trend.w} ${trend.h}`}
              preserveAspectRatio="none"
              style={{ overflow: "visible", display: "block" }}
              aria-hidden="true"
            >
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={lineColor} stopOpacity={fillOpacity} />
                  <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <path d={trend.area} fill={`url(#${gradientId})`} />
              <polyline
                points={trend.line}
                fill="none"
                stroke={lineColor}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            {/* See the header note — the dot must NOT live inside the scaled svg. */}
            <svg
              width="100%"
              height={trend.h}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                overflow: "visible",
                display: "block",
                pointerEvents: "none",
              }}
              aria-hidden="true"
            >
              <circle cx={`${(trend.lastX / trend.w) * 100}%`} cy={trend.lastY} r={3.5} fill={dotColor} />
            </svg>
          </>
        ) : (
          // Honest empty state (#1409) — no real history to plot. A flat muted
          // rule at the same 84px slot height, never the fixture's fabricated
          // declining line.
          <div
            data-testid="pv2-drift-trend-empty"
            style={{
              height: 84,
              display: "flex",
              alignItems: "center",
              fontSize: "11px",
              color: NO_DATA_INK,
            }}
          >
            {NO_SCAN_DATA_LABEL}
          </div>
        )}
        <div style={{ height: 1, background: "rgba(148,163,184,.14)" }} />
      </div>
    </div>
  );
}
