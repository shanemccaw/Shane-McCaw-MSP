/**
 * ReportFigures.tsx — the data visuals the Document Viewer's reports carry.
 *
 * Every figure here is GEOMETRY ONLY. The numbers, labels, department names and
 * dollar figures live in `previewDocumentBodies.ts` (or are derived from
 * `journeyPreviewFixture.ts`), which is what keeps the platform's no-hardcoding
 * rule true for this screen: a grep of the journey's `.tsx` files for a price or
 * a seat count still finds nothing.
 *
 * All six are static SVG or CSS — no charting library, no animation. This screen
 * deliberately carries none of the Reveal's motion language, and a figure inside
 * a report someone is reading is the last place to put movement.
 *
 * The radar is the one figure that reads its values live rather than from a
 * figure payload: it plots the six pillar scores, so it is drawn from the same
 * array the pillar table and the Reveal's own radar use and cannot drift from
 * them.
 */

import { Fragment } from "react";

import { PILLAR_ORDER, SEVERITY_ON_DARK, TABULAR } from "./journeyTokens.ts";
import type {
  PreviewBarFigure,
  PreviewHeatmapFigure,
  PreviewSplitFigure,
  PreviewTrendFigure,
} from "./previewDocumentBodies.ts";
import { PREVIEW_FIGURES } from "./previewDocumentBodies.ts";

const MICRO = "#94a3b8";
const BODY = "#cbd5e1";
const HEADING = "#f8fafc";
const HAIRLINE = "rgba(30,41,59,.9)";

const FIGURE_CAPTION: React.CSSProperties = {
  fontSize: 9.5,
  fontWeight: 600,
  letterSpacing: ".18em",
  textTransform: "uppercase",
  color: MICRO,
};

const FIGURE_NOTE: React.CSSProperties = {
  margin: 0,
  fontSize: 12.5,
  fontWeight: 500,
  lineHeight: 1.55,
  color: MICRO,
};

/* ------------------------------------------------------------------ *
 * Readiness radar — six pillars, one hexagon
 * ------------------------------------------------------------------ */

/** Outer ring radius in user units; the viewBox leaves room for the labels. */
const RADAR_R = 78;

/**
 * Where each axis label sits. The design places them by hand rather than on the
 * axis line — the two vertical axes centre over the vertex, the four diagonals
 * hang off the left or right edge of the same bounding box — so the positions
 * are a table rather than trigonometry.
 */
const RADAR_LABELS: readonly {
  readonly x: number;
  readonly y: number;
  readonly anchor: "start" | "middle" | "end";
}[] = [
  { x: 0, y: -96.5, anchor: "middle" },
  { x: 86.6, y: -46.5, anchor: "start" },
  { x: 86.6, y: 53.5, anchor: "start" },
  { x: 0, y: 103.5, anchor: "middle" },
  { x: -86.6, y: 53.5, anchor: "end" },
  { x: -86.6, y: -46.5, anchor: "end" },
];

/** Axis unit vectors, clockwise from 12 o'clock — the pillar order exactly. */
function radarAxis(i: number): { x: number; y: number } {
  const a = (Math.PI / 3) * i - Math.PI / 2;
  return { x: Math.cos(a), y: Math.sin(a) };
}

function radarPolygon(radius: number, scores?: readonly (number | null)[]): string {
  return PILLAR_ORDER.map((_, i) => {
    const axis = radarAxis(i);
    const r = scores ? ((scores[i] ?? 0) / 100) * radius : radius;
    return `${(axis.x * r).toFixed(1)},${(axis.y * r).toFixed(1)}`;
  }).join(" ");
}

export function ReadinessRadar({
  scores,
  scannedOn,
}: {
  /** One score per pillar, in `PILLAR_ORDER`. A null pillar plots at the centre. */
  readonly scores: readonly (number | null)[];
  readonly scannedOn: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "20px 34px",
        alignItems: "center",
        justifyContent: "center",
        padding: "4px 0 8px",
      }}
    >
      <svg
        viewBox="-150 -118 300 250"
        width="300"
        height="250"
        role="img"
        aria-label="Readiness contribution by pillar"
        style={{ flex: "none", overflow: "visible", maxWidth: "100%" }}
      >
        <defs>
          <radialGradient id="cj-radar-fill" cx="0" cy="0" r="1">
            <stop offset="0" stopColor="#22D3EE" stopOpacity=".34" />
            <stop offset="1" stopColor="#3B82F6" stopOpacity=".10" />
          </radialGradient>
        </defs>
        {[1, 0.66, 0.33].map((ring, i) => (
          <polygon
            key={ring}
            points={radarPolygon(RADAR_R * ring)}
            fill="none"
            stroke={`rgba(148,163,184,${[0.18, 0.12, 0.1][i]})`}
            strokeWidth="1"
          />
        ))}
        {PILLAR_ORDER.map((p, i) => {
          const axis = radarAxis(i);
          return (
            <line
              key={p.key}
              x1="0"
              y1="0"
              x2={(axis.x * RADAR_R).toFixed(1)}
              y2={(axis.y * RADAR_R).toFixed(1)}
              stroke="rgba(148,163,184,.16)"
              strokeWidth="1"
            />
          );
        })}
        <polygon
          points={radarPolygon(RADAR_R, scores)}
          fill="url(#cj-radar-fill)"
          stroke="#22D3EE"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        {PILLAR_ORDER.map((p, i) => {
          const axis = radarAxis(i);
          const r = ((scores[i] ?? 0) / 100) * RADAR_R;
          return (
            <circle
              key={p.key}
              cx={(axis.x * r).toFixed(1)}
              cy={(axis.y * r).toFixed(1)}
              r="2.6"
              fill={p.primary}
            />
          );
        })}
        {PILLAR_ORDER.map((p, i) => {
          const at = RADAR_LABELS[i];
          const score = scores[i];
          return (
            <g key={p.key}>
              <text
                x={at.x}
                y={at.y}
                textAnchor={at.anchor}
                fontFamily="Inter, sans-serif"
                fontSize="8.5"
                fontWeight="700"
                letterSpacing="1.1"
                fill={p.primary}
              >
                {p.label.toUpperCase()}
              </text>
              <text
                x={at.x}
                y={at.y + 10.5}
                textAnchor={at.anchor}
                fontFamily="Inter, sans-serif"
                fontSize="10"
                fontWeight="800"
                fill={BODY}
              >
                {/* An em dash rather than a 0 for a pillar nothing scored. */}
                {score ?? "—"}
              </text>
            </g>
          );
        })}
      </svg>
      <p
        style={{ ...FIGURE_NOTE, fontSize: 13, lineHeight: 1.6, flex: "1 1 190px", minWidth: 170 }}
      >
        {PREVIEW_FIGURES.readinessRadarNote.replace("{date}", scannedOn)}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Trend sparkline — Secure Score and usage
 * ------------------------------------------------------------------ */

const SPARK_W = 132;
const SPARK_TOP = 4;
const SPARK_BOTTOM = 30;

export function TrendSparkline({
  figure,
  colour,
  id,
}: {
  readonly figure: PreviewTrendFigure;
  /** The pillar's identity colour — the trend is that pillar's, not a severity. */
  readonly colour: string;
  /** Unique per instance: two sparklines on one page cannot share a filter id. */
  readonly id: string;
}) {
  const step = SPARK_W / Math.max(1, figure.series.length - 1);
  const points = figure.series.map(
    (v, i) => `${(i * step).toFixed(1)} ${(SPARK_BOTTOM - v * (SPARK_BOTTOM - SPARK_TOP)).toFixed(1)}`,
  );
  const d = `M ${points.join(" L ")}`;
  const last = figure.series[figure.series.length - 1] ?? 0;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", padding: "2px 0" }}>
      <svg
        width={SPARK_W}
        height="34"
        viewBox={`0 0 ${SPARK_W} 34`}
        fill="none"
        aria-hidden="true"
        style={{ overflow: "visible", flex: "none" }}
      >
        <defs>
          <filter id={id} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.4" />
          </filter>
        </defs>
        <path
          d={d}
          stroke={colour}
          strokeWidth="4"
          strokeOpacity=".22"
          strokeLinecap="round"
          strokeLinejoin="round"
          filter={`url(#${id})`}
        />
        <path d={d} stroke={colour} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <circle
          cx={SPARK_W}
          cy={(SPARK_BOTTOM - last * (SPARK_BOTTOM - SPARK_TOP)).toFixed(1)}
          r="2.6"
          fill={colour}
        />
      </svg>
      <span style={{ display: "flex", flexDirection: "column", gap: 1 }}>
        <span
          style={{
            fontSize: 12.5,
            fontWeight: 700,
            color: SEVERITY_ON_DARK[figure.deltaTone],
            ...TABULAR,
          }}
        >
          {figure.delta}
        </span>
        <span style={{ ...FIGURE_CAPTION, letterSpacing: ".14em" }}>{figure.caption}</span>
      </span>
      <span style={{ ...FIGURE_NOTE, flex: "1 1 220px", minWidth: 200 }}>
        {figure.note}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Blast radius — concentric reach of one compromised identity
 * ------------------------------------------------------------------ */

const BLAST_R = 186;
/** Vertical spacing of the leader lines, innermost ring highest on the list. */
const BLAST_ROW = 34;

export function BlastRadius() {
  const { rings, legend, note, caption } = PREVIEW_FIGURES.blastRadius;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: "6px 0 4px" }}>
      <span style={FIGURE_CAPTION}>{caption}</span>
      <div style={{ display: "flex", justifyContent: "center", padding: "2px 0" }}>
        <svg
          viewBox="-250 -210 500 420"
          width="500"
          height="420"
          role="img"
          aria-label={caption}
          style={{ flex: "none", overflow: "visible", maxWidth: "100%" }}
        >
          <defs>
            <radialGradient id="cj-blast-core" cx="0" cy="0" r="1">
              <stop offset="0" stopColor={SEVERITY_ON_DARK.critical} stopOpacity=".9" />
              <stop offset="1" stopColor={SEVERITY_ON_DARK.critical} stopOpacity=".15" />
            </radialGradient>
            <filter id="cj-blast-blur" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="9" />
            </filter>
          </defs>
          <circle cx="0" cy="0" r="90" fill="url(#cj-blast-core)" filter="url(#cj-blast-blur)" opacity=".55" />
          {/* Outermost first, so the inner rings paint over them. */}
          {[...rings].reverse().map((ring, i) => {
            const inward = rings.length - 1 - i;
            const innermost = inward === 0;
            return (
              <circle
                key={ring.label}
                cx="0"
                cy="0"
                r={(ring.radius * BLAST_R).toFixed(0)}
                fill={ring.colour}
                fillOpacity={(0.11 - 0.012 * inward).toFixed(3)}
                stroke={ring.colour}
                strokeOpacity={innermost ? 1 : 0.55}
                strokeWidth={innermost ? 2 : 1.2}
                strokeDasharray={ring.dashed ? "4 5" : undefined}
              />
            );
          })}
          <circle cx="0" cy="0" r="7" fill={SEVERITY_ON_DARK.critical} />
          {rings.map((ring, i) => {
            const y = -14 - BLAST_ROW * i;
            const r = ring.radius * BLAST_R;
            const right = ring.side === "right";
            const anchorX = right ? r : -r;
            const endX = right ? 226 : -226;
            const textX = right ? 232 : -232;
            return (
              <g key={ring.label}>
                <line
                  x1={anchorX.toFixed(0)}
                  y1={y}
                  x2={endX}
                  y2={y}
                  stroke={ring.colour}
                  strokeOpacity=".45"
                  strokeWidth="1"
                  strokeDasharray="2 3"
                />
                <circle cx={anchorX.toFixed(0)} cy={y} r="2.6" fill={ring.colour} />
                <text
                  x={textX}
                  y={y - 3}
                  textAnchor={right ? "end" : "start"}
                  fontFamily="Inter, sans-serif"
                  fontSize="10"
                  fontWeight="700"
                  letterSpacing="1"
                  fill={ring.colour}
                >
                  {ring.label.toUpperCase()}
                </text>
                <text
                  x={textX}
                  y={y + 11}
                  textAnchor={right ? "end" : "start"}
                  fontFamily="Inter, sans-serif"
                  fontSize="11"
                  fontWeight="600"
                  fill={BODY}
                >
                  {ring.value}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", paddingTop: 2 }}>
        <span style={{ ...FIGURE_NOTE, flex: "1 1 220px", minWidth: 200 }}>
          {note}
        </span>
        <span style={{ display: "flex", flexDirection: "column", gap: 4, flex: "none" }}>
          {legend.map((l) => (
            <span
              key={l.label}
              style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, fontWeight: 600, color: BODY }}
            >
              <span
                aria-hidden="true"
                style={{ width: 8, height: 8, borderRadius: "50%", background: l.colour, flex: "none" }}
              />
              {l.label}
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Exposure heat map
 * ------------------------------------------------------------------ */

export function ExposureHeatmap({ figure }: { readonly figure: PreviewHeatmapFigure }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "2px 0 4px" }}>
      <span style={FIGURE_CAPTION}>{figure.caption}</span>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `minmax(112px,1.3fr) repeat(${figure.columns.length},minmax(52px,1fr))`,
          gap: 4,
          alignItems: "center",
        }}
      >
        <span />
        {figure.columns.map((c) => (
          <span
            key={c}
            style={{
              fontSize: 9,
              fontWeight: 600,
              letterSpacing: ".12em",
              textTransform: "uppercase",
              color: MICRO,
              textAlign: "center",
              lineHeight: 1.3,
            }}
          >
            {c}
          </span>
        ))}
        {figure.rows.map((row) => (
          <Fragment key={row.label}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: BODY, lineHeight: 1.3 }}>{row.label}</span>
            {row.cells.map((cell, i) => (
              <span
                key={`${row.label}-${figure.columns[i]}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  height: 30,
                  borderRadius: 4,
                  background: `rgba(59,130,246,${cell.intensity})`,
                  fontSize: 12,
                  fontWeight: 700,
                  // The brighter ink only where the fill is dark enough to carry it.
                  color: cell.intensity >= 0.3 ? HEADING : BODY,
                  ...TABULAR,
                }}
              >
                {cell.text}
              </span>
            ))}
          </Fragment>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ ...FIGURE_CAPTION, letterSpacing: ".14em", fontSize: 10 }}>{figure.lowLabel}</span>
        <span
          aria-hidden="true"
          style={{
            width: 110,
            height: 6,
            borderRadius: 999,
            background: "linear-gradient(90deg,rgba(59,130,246,.08),rgba(59,130,246,.48))",
          }}
        />
        <span style={{ ...FIGURE_CAPTION, letterSpacing: ".14em", fontSize: 10 }}>{figure.highLabel}</span>
        <span style={{ ...FIGURE_NOTE, fontSize: 12, flex: "1 1 210px", minWidth: 190 }}>
          {figure.note}
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Bar list — monthly waste, weekly usage by department
 * ------------------------------------------------------------------ */

export function BarList({ figure, wide }: { readonly figure: PreviewBarFigure; readonly wide?: boolean }) {
  const columns = wide
    ? "minmax(140px,1fr) minmax(0,2fr) 66px"
    : "minmax(108px,1fr) minmax(0,2fr) 44px";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: wide ? 14 : 10, padding: "2px 0 4px" }}>
      <span style={FIGURE_CAPTION}>{figure.caption}</span>
      <div style={{ display: "flex", flexDirection: "column", gap: wide ? 9 : 0 }}>
        {figure.rows.map((row) => (
          <div
            key={row.label}
            style={{
              display: "grid",
              gridTemplateColumns: columns,
              gap: 12,
              alignItems: "center",
              padding: "4px 10px",
              margin: "-4px -10px",
            }}
          >
            <span style={{ fontSize: 12.5, fontWeight: 600, color: BODY, lineHeight: 1.35 }}>{row.label}</span>
            <span
              aria-hidden="true"
              style={{
                height: 10,
                borderRadius: 999,
                background: "rgba(148,163,184,.1)",
                overflow: "hidden",
                display: "block",
              }}
            >
              <span
                style={{
                  display: "block",
                  height: "100%",
                  width: `${Math.round(row.fill * 100)}%`,
                  borderRadius: 999,
                  background: SEVERITY_ON_DARK[row.tone],
                  opacity: 0.85,
                }}
              />
            </span>
            <span
              style={{ fontSize: 12.5, fontWeight: 700, color: HEADING, textAlign: "right", ...TABULAR }}
            >
              {row.value}
            </span>
          </div>
        ))}
      </div>
      {figure.total ? (
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: 14,
            paddingTop: 10,
            borderTop: `1px solid ${HAIRLINE}`,
          }}
        >
          <span style={{ fontSize: 12.5, fontWeight: 600, color: MICRO }}>{figure.total.label}</span>
          <span style={{ fontSize: 17, fontWeight: 800, color: HEADING, ...TABULAR }}>
            {figure.total.value}
            <span style={{ fontSize: 12, fontWeight: 600, color: MICRO }}>{figure.total.detail}</span>
          </span>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Split bar — the estate in three
 * ------------------------------------------------------------------ */

export function SplitBar({ figure }: { readonly figure: PreviewSplitFigure }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "2px 0 4px" }}>
      <span style={FIGURE_CAPTION}>{figure.caption}</span>
      <span
        style={{
          display: "flex",
          height: 26,
          borderRadius: 6,
          overflow: "hidden",
          background: "rgba(148,163,184,.08)",
        }}
      >
        {figure.segments.map((s) => (
          <span
            key={s.label}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: `${(s.share * 100).toFixed(1)}%`,
              background: SEVERITY_ON_DARK[s.tone],
              opacity: 0.82,
              fontSize: 11,
              fontWeight: 800,
              // Ink on a saturated fill, not on the page — the design's own navy.
              color: "#0b1220",
              ...TABULAR,
            }}
          >
            {s.count}
          </span>
        ))}
      </span>
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
        {figure.segments.map((s) => (
          <span
            key={s.label}
            style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, fontWeight: 600, color: BODY }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 8,
                height: 8,
                borderRadius: 2,
                background: SEVERITY_ON_DARK[s.tone],
                flex: "none",
              }}
            />
            {`${s.label} · ${s.count} (${Math.round(s.share * 100)}%)`}
          </span>
        ))}
      </div>
    </div>
  );
}
