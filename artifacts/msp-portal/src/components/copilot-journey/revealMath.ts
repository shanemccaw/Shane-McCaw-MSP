/**
 * revealMath.ts — every number the Copilot Readiness Reveal animates.
 *
 * Pulled out as pure functions for the same reason `warRoomCardScroll.ts` was:
 * `node --test` cannot load `.tsx`, so any logic worth asserting has to live in a
 * plain `.ts` sibling and the components just call it. That matters more than
 * usual here — the handoff's logic class *is* the specification ("Read the logic
 * class; it is the specification"), so this file is a direct, testable
 * transcription of it rather than an approximation.
 *
 * Source: `Design/Copilot Readiness Reveal.dc.html`, the `<script data-dc-script>`
 * block at the bottom of the file.
 */

/** Clamp `p` into [0,1] across the window [a,b]. The design's `CL`. */
export function clampWindow(p: number, a: number, b: number): number {
  if (b === a) return p >= b ? 1 : 0;
  return Math.max(0, Math.min(1, (p - a) / (b - a)));
}

/** Ease-out cubic — `1-(1-t)³`. Every scroll reveal in the journey uses this. */
export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * The weighted landing. A small overshoot-and-settle, applied only to critical
 * pillars so the motion reflects the data instead of repeating identically six
 * times. `1 + 2.4(t-1)³ + 1.4(t-1)²`.
 */
export function easeBackSettle(t: number): number {
  return 1 + 2.4 * Math.pow(t - 1, 3) + 1.4 * Math.pow(t - 1, 2);
}

export interface BlockReveal {
  /** Opacity 0 → 1. */
  readonly o: number;
  /** Parallax offset in px, 24 → 0. Always 0 under reduced motion. */
  readonly y: number;
}

/**
 * One scroll-revealed block: an eased fade plus a 24px rise.
 *
 * Under `prefers-reduced-motion` the rise is dropped entirely and the fade is
 * compressed into the first 40% of the window — a fast plain crossfade, per the
 * handoff's reduced-motion rule.
 */
export function blockReveal(p: number, a: number, b: number, reduced: boolean): BlockReveal {
  if (reduced) return { o: clampWindow(p, a, a + (b - a) * 0.4), y: 0 };
  const t = easeOutCubic(clampWindow(p, a, b));
  return { o: t, y: (1 - t) * 24 };
}

/* ------------------------------------------------------------------ *
 * Scene progress
 * ------------------------------------------------------------------ */

export interface SceneRect {
  readonly top: number;
  readonly bottom: number;
  readonly height: number;
}

/**
 * How far a sticky scene has travelled through its own scroll span, 0 → 1.
 *
 * The span is `height - viewportHeight` because the first viewport-worth of the
 * section is consumed pinning it — a 280vh section has 180vh of actual travel.
 */
export function sceneProgress(rect: SceneRect, viewportHeight: number): number {
  const span = Math.max(1, rect.height - viewportHeight);
  return Math.max(0, Math.min(1, -rect.top / span));
}

/**
 * Which scene owns the progress rail. A scene is active while its top has passed
 * 40% of the viewport and its bottom has not yet risen above 60% — the same test
 * the design uses, which deliberately gives the incoming scene the rail slightly
 * before it is fully pinned.
 */
export function activeSceneIndex(rects: readonly SceneRect[], viewportHeight: number): number {
  let active = 0;
  rects.forEach((r, i) => {
    if (r.top <= viewportHeight * 0.4 && r.bottom > viewportHeight * 0.6) active = i;
  });
  return active;
}

/* ------------------------------------------------------------------ *
 * Scene 0 — the radar
 * ------------------------------------------------------------------ */

/** Inner radius of the six wedges. */
export const RADAR_INNER_R = 104;
/** Outer radius — the rim the wedges fill out to at 100%. */
export const RADAR_OUTER_R = 214;

/** Polar → cartesian, in the radar's own `-260 -260 520 520` viewBox. */
export function polar(radius: number, angleDeg: number): string {
  const a = (angleDeg * Math.PI) / 180;
  return `${(radius * Math.sin(a)).toFixed(1)} ${(-radius * Math.cos(a)).toFixed(1)}`;
}

/**
 * One wedge's filled path at completion `fill` (0 → 1).
 *
 * Treat each wedge as a progress bar: it grows from the inner radius out to the
 * rim as that pillar's checks land. Returns `""` below zero so nothing paints
 * before a pillar has started.
 */
export function radarWedgePath(index: number, fill: number): string {
  if (fill <= 0) return "";
  const a1 = index * 60 - 30;
  const a2 = index * 60 + 30;
  const rr = RADAR_INNER_R + (RADAR_OUTER_R - RADAR_INNER_R) * fill;
  return (
    `M ${polar(rr, a1)} A ${rr} ${rr} 0 0 1 ${polar(rr, a2)}` +
    ` L ${polar(RADAR_INNER_R, a2)} A ${RADAR_INNER_R} ${RADAR_INNER_R} 0 0 0 ${polar(RADAR_INNER_R, a1)} Z`
  );
}

/**
 * A wedge's opacity at completion `fill`. Never fully transparent once started —
 * `0.58 + 0.42 × fill` — so a pillar that has only just begun still reads as
 * present rather than missing.
 */
export function radarWedgeOpacity(fill: number): number {
  return fill > 0 ? 0.58 + 0.42 * fill : 0;
}

/**
 * The un-filled backdrop wedge — the same geometry at full radius, painted at
 * 5% so the six sectors are legible as a shape before any of them fill.
 */
export function radarWedgeBackdropPath(index: number): string {
  return radarWedgePath(index, 1);
}

/**
 * Chip fade-in thresholds inside a wedge. Curated findings land at 30%, 56% and
 * 82% of that pillar's own progress, each over a 10% window.
 *
 * These are *not* a running log of every check — every chip shown must reappear
 * in that pillar's reveal scene, which is what makes the scan read as the same
 * assessment rather than a loading animation.
 */
export const RADAR_CHIP_THRESHOLDS = [0.3, 0.56, 0.82] as const;

export function radarChipOpacity(pillarFill: number, chipIndex: number): number {
  const th = RADAR_CHIP_THRESHOLDS[Math.min(chipIndex, RADAR_CHIP_THRESHOLDS.length - 1)];
  return clampWindow(pillarFill, th, th + 0.1);
}

/**
 * Fit-to-viewport scale for the 1000×700 radar stage. 210px of the height budget
 * is reserved for the tenant header above and the streaming check line below.
 */
export function radarStageScale(vw: number, vh: number): number {
  return Math.min(1, vw / 1060, (vh - 210) / 700);
}

/* ------------------------------------------------------------------ *
 * Scene 1 — the verdict
 * ------------------------------------------------------------------ */

/** Fit-to-viewport scale for the 940×790 verdict stage. */
export function verdictStageScale(vw: number, vh: number): number {
  return Math.min(1, vw / 1020, vh / 860);
}

/** Fit-to-viewport scale for Scene 9's 1300×660 stage. */
export function fullPictureStageScale(vw: number, vh: number): number {
  return Math.min(1, vw / 1420, vh / 740);
}

/**
 * The verdict count-up: 0 → `target` over the first 58% of the 2600ms timeline,
 * eased `1-(1-t)³`.
 *
 * Kept under reduced motion — count-up numbers are informational, not
 * decorative, and freezing them would hide the one thing the scene exists to say.
 */
export function verdictCount(target: number, t: number): number {
  return Math.round(target * easeOutCubic(clampWindow(t, 0, 0.58)));
}

/**
 * A pillar's own count-up. Critical pillars get the weighted landing; everything
 * else glides. Reduced motion always glides — a wobble is decoration.
 */
export function pillarCount(target: number, p: number, reduced: boolean): number {
  const t = clampWindow(p, 0.34, 0.6);
  const isCritical = target < 40;
  const ease = isCritical && !reduced ? easeBackSettle : easeOutCubic;
  return Math.round(target * ease(t));
}

/**
 * Ring settle. The satellite ring rotates -26° → 0° during the reveal and then
 * stops — never continuous rotation. Returns 0 outright under reduced motion.
 */
export function ringRotation(t: number, reduced: boolean): number {
  if (reduced) return 0;
  return (1 - easeOutCubic(clampWindow(t, 0.42, 1))) * -26;
}

/** The counter-rotation each satellite label carries so it stays upright. */
export function ringCounterRotation(t: number, reduced: boolean): number {
  return -ringRotation(t, reduced);
}

/**
 * The five block windows every pillar scene reveals through. Structurally
 * identical every time — sameness is the feature.
 */
export const PILLAR_BLOCK_WINDOWS = {
  badge: [0.03, 0.2],
  headline: [0.12, 0.32],
  why: [0.26, 0.44],
  score: [0.34, 0.52],
  fix: [0.56, 0.74],
} as const;

/** The three block windows Scene 8 (White-Glove Adoption) reveals through. */
export const ADOPTION_BLOCK_WINDOWS = {
  eyebrow: [0.04, 0.22],
  headline: [0.12, 0.34],
  body: [0.28, 0.5],
} as const;

/* ------------------------------------------------------------------ *
 * Sparklines
 *
 * A sparkline only renders where real time-series data exists. A fabricated
 * trend line is a fabricated statistic wearing a chart's credibility, so
 * `sparkGeometry` returns null for an absent or too-short series and the caller
 * renders nothing at all — never an interpolated or synthesised shape.
 * ------------------------------------------------------------------ */

export const SPARK_W = 92;
export const SPARK_H = 28;
const SPARK_PAD = 3;

export interface SparkPoint {
  readonly x: number;
  readonly y: number;
}

export function sparkGeometry(series: readonly number[] | null | undefined): SparkPoint[] | null {
  if (!series || series.length < 2) return null;
  const lo = Math.min(...series);
  const hi = Math.max(...series);
  const span = hi - lo || 1;
  return series.map((v, k) => ({
    x: Number((k * (SPARK_W / (series.length - 1))).toFixed(1)),
    y: Number((SPARK_PAD + (1 - (v - lo) / span) * (SPARK_H - SPARK_PAD * 2)).toFixed(1)),
  }));
}

export function sparkPath(series: readonly number[] | null | undefined): string {
  const pts = sparkGeometry(series);
  if (!pts) return "";
  return pts.map((p, k) => `${k ? "L" : "M"} ${p.x} ${p.y}`).join(" ");
}

export function sparkTip(series: readonly number[] | null | undefined): SparkPoint | null {
  const pts = sparkGeometry(series);
  return pts ? pts[pts.length - 1] : null;
}

export interface SparkDelta {
  readonly label: string;
  readonly color: string;
}

/**
 * The delta beside a sparkline. Severity-coloured — unlike the line itself,
 * which carries the pillar's identity colour because it shows shape, not
 * pass/fail. A movement inside ±2 points is called flat rather than dressed as
 * a trend.
 */
export function sparkDelta(series: readonly number[] | null | undefined): SparkDelta | null {
  if (!series || series.length < 2) return null;
  const d = series[series.length - 1] - series[0];
  const sign = d > 0 ? "+" : d < 0 ? "−" : "±";
  return {
    label: `${sign}${Math.abs(d)} pts`,
    color: d > 2 ? "#34D399" : d < -2 ? "#F87171" : "#FBBF24",
  };
}

/* ------------------------------------------------------------------ *
 * Scene 9 — document generation
 * ------------------------------------------------------------------ */

export interface GenerationView {
  /**
   * False when the platform has not told us what this tenant's document set is
   * — a status fetch that failed, or a tenant with no assessment service. The
   * caller must render an unavailable state rather than a counter, because
   * "0 of 0 ready" with a progress bar and a promise of a notification asserts
   * a generation run that is not happening.
   */
  readonly known: boolean;
  readonly done: boolean;
  readonly pct: string;
  readonly status: string;
  readonly eyebrow: string;
  readonly note: string;
}

/**
 * Document generation is shown *in progress*, not ready — the reveal fires the
 * instant the scan completes and must never be gated on generation, which takes
 * 5+ minutes on a large tenant.
 *
 * THE NOTIFICATION PROMISE IS DELIBERATELY ABSENT. The handoff's copy reads "We
 * will notify you the moment the set is ready — the same alert channel as your
 * onboarding confirmations", and that channel does not exist for this event: the
 * generation workflow emits `assessment.docs.completed` but nothing in the repo
 * consumes it, and `document-generator.ts` / `document-engine.ts` / the
 * assessment routes contain no mail or notification call at all (checked, not
 * assumed). Telling a customer they can close the page because they will be
 * alerted, when they will not be, is the one failure mode this whole screen
 * exists to avoid. The wording below says only what is true — the work continues
 * without them and the set will be waiting — and the promise can be restored the
 * moment a real consumer for that event ships.
 */
export function generationView(ready: number, total: number): GenerationView {
  if (total <= 0) {
    return {
      known: false,
      done: false,
      pct: "0%",
      status: "",
      eyebrow: "",
      note: "",
    };
  }
  const safeTotal = total;
  const n = Math.max(0, Math.min(safeTotal, ready));
  const done = n >= safeTotal;
  return {
    known: true,
    done,
    pct: `${Math.round((n / safeTotal) * 100)}%`,
    status: `${n} of ${safeTotal} ready`,
    eyebrow: done
      ? "The full findings, yours to keep"
      : `Generating your findings — ${n} of ${safeTotal} ready`,
    // The count is written out rather than fixed at "nine": the expected set is
    // per-service and excludes the SOW and anything not customer-visible, so a
    // real tenant's set is regularly not nine.
    note: done
      ? `All ${safeTotal} documents are open in your viewer. Download as PDF if you want a copy, but you do not need to.`
      : "Generation continues whether this page is open or not. Come back to your documents when it suits you — the full set will be waiting.",
  };
}

/* ------------------------------------------------------------------ *
 * Progress rail
 * ------------------------------------------------------------------ */

export interface RailTick {
  readonly background: string;
  readonly scaleX: number;
}

export function railTicks(count: number, active: number): RailTick[] {
  return Array.from({ length: count }, (_, i) => ({
    background:
      i === active ? "#00B4D8" : i < active ? "rgba(0,120,212,.6)" : "rgba(51,65,85,.7)",
    scaleX: i === active ? 2.4 : 1,
  }));
}
