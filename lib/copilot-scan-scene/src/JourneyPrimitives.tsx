/**
 * JourneyPrimitives.tsx — the handful of marks every Copilot Readiness screen
 * shares, so the six pillar glyphs, the brand tile and the sparkline are drawn
 * once rather than five times with drift.
 *
 * Icons come from `lucide-react` rather than the hand-rolled SVG paths in the
 * prototypes, per the handoff's assets note. The mapping below is the one place
 * a pillar's glyph is chosen; every other file asks for `<PillarGlyph pillar />`.
 */

import {
  Activity,
  FileCheck2,
  MessageCircle,
  Share2,
  ShieldCheck,
  Tags,
  Users,
} from "lucide-react";

import {
  BRAND,
  INK,
  PILLARS,
  RADIUS,
  TABULAR,
  type PillarKey,
} from "./journeyTokens.ts";
import { SPARK_H, SPARK_W, sparkDelta, sparkPath, sparkTip } from "./revealMath.ts";

/* ------------------------------------------------------------------ *
 * Pillar glyphs
 * ------------------------------------------------------------------ */

export const PILLAR_GLYPH = {
  // Sharing exposure — the design's own three-node share mark.
  governance: Share2,
  security: ShieldCheck,
  // Labels and DLP — a document that has been checked.
  compliance: FileCheck2,
  licensing: Tags,
  adoption: Users,
  // Drift over time reads as a trace, not a heart.
  health: Activity,
} as const satisfies Record<PillarKey, typeof Share2>;

export function PillarGlyph({
  pillar,
  size = 17,
  color,
}: {
  pillar: PillarKey;
  size?: number;
  color?: string;
}) {
  const Icon = PILLAR_GLYPH[pillar];
  return (
    <Icon
      size={size}
      strokeWidth={1.7}
      color={color ?? PILLARS[pillar].primary}
      aria-hidden="true"
      style={{ flex: "none" }}
    />
  );
}

/** The eyebrow used above every pillar headline: glyph tile + name. */
export function PillarEyebrow({
  pillar,
  style,
}: {
  pillar: PillarKey;
  style?: React.CSSProperties;
}) {
  const id = PILLARS[pillar];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, ...style }}>
      <span
        style={{
          width: 34,
          height: 34,
          borderRadius: RADIUS.iconTile,
          background: `${id.primary}1a`,
          border: `1px solid ${id.primary}33`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flex: "none",
        }}
      >
        <PillarGlyph pillar={pillar} />
      </span>
      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: ".22em",
          textTransform: "uppercase",
          color: id.primary,
        }}
      >
        {id.label}
      </span>
    </div>
  );
}

/**
 * The 7px identity swatch. Marks *what a finding is* beside a pillar name — in
 * the exec summary table, on a phase card, on an order row. Deliberately square
 * so it never reads as a status dot, which is a severity signal.
 */
export function PillarSwatch({ pillar, size = 7 }: { pillar: PillarKey; size?: number }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: 2,
        background: PILLARS[pillar].primary,
        flex: "none",
      }}
    />
  );
}

/* ------------------------------------------------------------------ *
 * Brand mark
 * ------------------------------------------------------------------ */

/**
 * The "SM" tile — a blue → teal gradient with the wordmark in Inter.
 *
 * There is no shared `Logo` component in this repo (every brand mark is inlined,
 * and the `_ds` readme lists `Logo` under its own intentional additions), so
 * this is the journey's single definition rather than a fifth inline copy.
 */
export function BrandMark({
  size = 30,
  wordmark,
}: {
  size?: number;
  wordmark?: string;
}) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 0 }}>
      <span
        style={{
          width: size,
          height: size,
          borderRadius: Math.round(size * 0.3),
          background: `linear-gradient(135deg,${BRAND.blue},${BRAND.teal})`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: Math.round(size * 0.4),
          fontWeight: 800,
          color: BRAND.white,
          flex: "none",
          letterSpacing: "-0.02em",
        }}
      >
        SM
      </span>
      {wordmark ? (
        <span
          style={{
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: "-0.01em",
            color: BRAND.white,
            whiteSpace: "nowrap",
          }}
        >
          {wordmark}
        </span>
      ) : null}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Sparkline
 * ------------------------------------------------------------------ */

/**
 * A thin single-stroke trend line in the pillar's identity colour — the line
 * shows shape, not pass/fail, which is why it is never severity-coloured. The
 * delta beside it is, because that *is* a judgement.
 *
 * Renders `null` for an absent series. That is the whole point of the component:
 * a sparkline only appears where real time-series data exists — `pillarTrend()`
 * (journeyModel.ts) now feeds one from real `tenant_monitor_profiles` history
 * (#356) once a pillar clears its minimum-data floor, and stays `null` below it
 * or for a tenant with too little scan history. The alternative — drawing a
 * shape from whatever's there — is a fabricated statistic wearing a chart's
 * credibility.
 */
export function PillarSparkline({
  pillar,
  series,
  window,
  opacity = 1,
}: {
  pillar: PillarKey;
  series: readonly number[] | null | undefined;
  window: string;
  opacity?: number;
}) {
  const d = sparkPath(series);
  const tip = sparkTip(series);
  const delta = sparkDelta(series);
  if (!d || !tip || !delta) return null;

  const color = PILLARS[pillar].primary;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 11,
        paddingTop: 9,
        transition: "opacity 320ms ease",
        opacity,
      }}
    >
      <svg
        width={SPARK_W}
        height={SPARK_H}
        viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
        fill="none"
        style={{ overflow: "visible", flex: "none" }}
        aria-hidden="true"
      >
        {/* Soft outer glow behind the crisp stroke, so the line reads on a dark
            field without thickening it. */}
        <path
          d={d}
          stroke={color}
          strokeWidth={4}
          strokeOpacity={0.2}
          strokeLinecap="round"
          strokeLinejoin="round"
          filter="url(#cjSparkBlur)"
        />
        <path
          d={d}
          stroke={color}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx={tip.x} cy={tip.y} r={2.4} fill={color} />
      </svg>
      <span style={{ display: "flex", flexDirection: "column", gap: 1 }}>
        <span
          style={{
            fontSize: 11.5,
            fontWeight: 700,
            letterSpacing: ".02em",
            color: delta.color,
            ...TABULAR,
          }}
        >
          {delta.label}
        </span>
        <span
          style={{
            fontSize: 9.5,
            fontWeight: 600,
            letterSpacing: ".14em",
            textTransform: "uppercase",
            color: INK.micro,
          }}
        >
          {window}
        </span>
      </span>
    </div>
  );
}

/**
 * The blur filter the sparkline's glow stroke references. Mounted once per
 * screen — an SVG `filter` has to exist in the document for `url(#…)` to resolve.
 */
export function JourneySvgDefs() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
      <defs>
        <filter id="cjSparkBlur" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2.4" />
        </filter>
      </defs>
    </svg>
  );
}

/* ------------------------------------------------------------------ *
 * Shared small parts
 * ------------------------------------------------------------------ */

/** The `34 → 61 +27` delta row. Projected value in gradient, delta in teal. */
export function ScoreDelta({
  from,
  to,
  size = 26,
}: {
  from: number;
  to: number;
  size?: number;
}) {
  const gain = to - from;
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 11, ...TABULAR }}>
      <span style={{ fontSize: size, fontWeight: 800, color: INK.deemphasised }}>{from}</span>
      <svg width="18" height="9" viewBox="0 0 18 9" fill="none" stroke={INK.deemphasised} strokeWidth="1.6" aria-hidden="true">
        <path d="M0 4.5h16M12 1l4 3.5-4 3.5" />
      </svg>
      <span
        style={{
          fontSize: size,
          fontWeight: 800,
          background: `linear-gradient(90deg,${BRAND.blue},${BRAND.teal})`,
          WebkitBackgroundClip: "text",
          backgroundClip: "text",
          color: "transparent",
        }}
      >
        {to}
      </span>
      <span
        style={{
          fontSize: Math.round(size * 0.5),
          fontWeight: 700,
          letterSpacing: ".04em",
          color: BRAND.teal,
        }}
      >
        {gain >= 0 ? `+${gain}` : gain}
      </span>
    </div>
  );
}

/**
 * The dark rounded-rect finding chip — a bullet marker beside real wrapping
 * text, bounded to its container's width rather than `white-space:nowrap`
 * (which lets a long finding grow past its anchor). Built for Scene 0's
 * scan-overlay clusters (#412) and reused verbatim by Scene 1's satellites
 * (#417) so both screens present the same finding the same way.
 *
 * `pulse` (#530): swaps the static pillar-coloured bullet for a blinking green
 * dot — ONLY for the live-scanning-placeholder chip (`SCANNING_PILLAR_CHIP`),
 * never for a real finding or stat chip, so "actively scanning" reads as
 * visually distinct from a static fact at a glance.
 */
export function FindingChip({
  color,
  text,
  opacity = 1,
  pulse = false,
}: {
  color: string;
  text: string;
  opacity?: number;
  pulse?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        maxWidth: "100%",
        boxSizing: "border-box",
        background: "rgba(15,23,42,.92)",
        // 0x59 ≈ 35% — the border tints toward the pillar without becoming an outline.
        border: `1px solid ${color}59`,
        borderRadius: RADIUS.pill,
        padding: "4px 10px",
        transition: "opacity 500ms",
        opacity,
      }}
    >
      <span
        aria-hidden="true"
        style={
          pulse
            ? {
                width: 4,
                height: 4,
                borderRadius: "50%",
                background: "#22c55e",
                flex: "none",
                marginTop: 1,
                animation: "cj-pulse-dot 1400ms ease-in-out infinite",
              }
            : { width: 4, height: 4, borderRadius: "50%", background: color, flex: "none", marginTop: 1 }
        }
      />
      <span
        style={{
          fontSize: 10.5,
          fontWeight: 600,
          color: "#e2e8f0",
          whiteSpace: "normal",
          overflowWrap: "break-word",
          wordBreak: "break-word",
        }}
      >
        {text}
      </span>
    </div>
  );
}

/** The scroll cue. Animation name is `cj-cue-drop`, silenced by reduced motion. */
export function ScrollCue({ label, align = "center" }: { label: string; align?: "center" | "start" }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: align === "center" ? "center" : "flex-start",
        gap: 9,
        animation: "cj-cue-drop 2200ms ease-in-out infinite",
      }}
    >
      <span
        style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: ".22em",
          textTransform: "uppercase",
          color: INK.micro,
        }}
      >
        {label}
      </span>
      <svg width="16" height="10" viewBox="0 0 16 10" fill="none" stroke={INK.micro} strokeWidth="1.6" aria-hidden="true">
        <path d="M1 1l7 7 7-7" />
      </svg>
    </div>
  );
}

/**
 * The badge a design preview carries. Persistent, unmissable and never rendered
 * on live data — a preview must not be mistakable for a real tenant's results.
 */
export function PreviewBadge() {
  return (
    <div
      data-testid="preview-badge"
      style={{
        position: "fixed",
        left: "50%",
        top: 12,
        transform: "translateX(-50%)",
        zIndex: 90,
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 14px",
        borderRadius: RADIUS.pill,
        background: "rgba(251,191,36,.14)",
        border: "1px solid rgba(251,191,36,.5)",
        pointerEvents: "none",
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: "#fbbf24",
          flex: "none",
        }}
      />
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: ".18em",
          textTransform: "uppercase",
          color: "#fbbf24",
          whiteSpace: "nowrap",
        }}
      >
        Design preview · sample tenant, not your data
      </span>
    </div>
  );
}

/**
 * What a screen shows when the platform genuinely has nothing to say yet. Used
 * everywhere a design value would otherwise be invented — an unscored pillar, a
 * scope with no SOW document, a tenant that has never been scanned.
 */
export function JourneyUnavailable({
  title,
  detail,
  action,
  surface = "dark",
  eyebrow = "Not available yet",
  testId,
}: {
  title: string;
  detail: string;
  action?: React.ReactNode;
  /**
   * All four journey screens are dark now, so `"dark"` is the only surface any
   * current call site needs — kept as a prop rather than hardcoded in case a
   * future light surface joins the journey, so a dark heading colour is never
   * silently invisible on it.
   */
  surface?: "dark" | "light";
  eyebrow?: string;
  /** Optional `data-testid` for regression coverage of a specific call site. */
  testId?: string;
}) {
  const light = surface === "light";
  return (
    <div
      data-testid={testId}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        maxWidth: 520,
        padding: "26px 0",
      }}
    >
      <span
        style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: ".22em",
          textTransform: "uppercase",
          color: INK.micro,
        }}
      >
        {eyebrow}
      </span>
      <span
        style={{
          fontSize: 21,
          fontWeight: 700,
          letterSpacing: "-0.015em",
          color: light ? BRAND.navy : INK.headingDark,
        }}
      >
        {title}
      </span>
      <p
        style={{
          margin: 0,
          fontSize: 14.5,
          fontWeight: 500,
          lineHeight: 1.6,
          color: light ? INK.bodyLight : INK.bodyDark,
        }}
      >
        {detail}
      </p>
      {action}
    </div>
  );
}
