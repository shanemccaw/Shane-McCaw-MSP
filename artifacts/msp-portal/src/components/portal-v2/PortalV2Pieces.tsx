/**
 * PortalV2Pieces.tsx — the shared display primitives for the v2 pillar pages.
 *
 * Two rules from the design language are enforced here rather than left to each
 * page, because getting either wrong is the failure mode the handoff cares most
 * about:
 *
 *   1. IDENTITY AND SEVERITY ARE DIFFERENT AXES. A pillar's colour says what it
 *      is; a score's colour says how it is doing. Compliance is `#F3F4F6`
 *      whether it scores 29 or 90.
 *   2. A NULL SCORE IS NOT A ZERO. A pillar with nothing behind it renders an
 *      unavailable state with the real reason, never a red ring at 0.
 */

import { ScoreRing, type ScoreRingColor } from "@/components/ui/score-ring";
import { cn } from "@/lib/utils";
import {
  SEVERITY_LABEL,
  hexAlpha,
  severityForScore,
  type Severity,
} from "@/components/copilot-journey/journeyTokens";

import {
  formatStatValue,
  unavailableNote,
  type PortalV2Finding,
  type PortalV2Stat,
} from "./portalV2Model";

/** Severity band → the ScoreRing colour token. */
const RING_BY_SEVERITY: Record<Severity, ScoreRingColor> = {
  critical: "red",
  attention: "amber",
  healthy: "green",
};

export function scoreRingColor(score: number): ScoreRingColor {
  return RING_BY_SEVERITY[severityForScore(score)];
}

/* ── Panel ────────────────────────────────────────────────────────────────── */

export function Panel({
  children,
  className,
  accent,
}: {
  children: React.ReactNode;
  className?: string;
  /** Optional 2px identity band across the top. */
  accent?: string;
}) {
  return (
    <section
      className={cn("relative overflow-hidden rounded-[12px] border", className)}
      style={{ borderColor: "var(--pv2-border)", background: "var(--pv2-panel)" }}
    >
      {accent && (
        <span
          className="absolute inset-x-0 top-0 h-0.5"
          style={{ background: `linear-gradient(90deg, ${accent}, ${hexAlpha(accent, 0.2)})` }}
        />
      )}
      {children}
    </section>
  );
}

export function PanelTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2
      className="text-[13px] font-bold tracking-tight"
      style={{ color: "var(--pv2-heading)" }}
    >
      {children}
    </h2>
  );
}

export function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="text-[9.5px] font-bold uppercase tracking-[0.14em]"
      style={{ color: "var(--pv2-micro)" }}
    >
      {children}
    </p>
  );
}

/* ── Score ────────────────────────────────────────────────────────────────── */

/**
 * A pillar score, or the honest reason there isn't one.
 *
 * `ScoreRing` is reused verbatim — it is already the app's ring in ~11 places.
 * Its colours resolve correctly here because `.pv2-root` redefines the
 * `--status-*` tokens it reads (see portal-v2.css).
 */
export function ScoreBlock({
  score,
  size = 96,
  note,
}: {
  score: number | null;
  size?: number;
  /** Rendered when `score` is null — the reason, in words. */
  note: string;
}) {
  if (score === null) {
    return (
      <div
        className="flex flex-col items-center justify-center rounded-[10px] border border-dashed px-4 text-center"
        style={{
          width: size,
          height: size,
          borderColor: "var(--pv2-hairline)",
          color: "var(--pv2-micro)",
        }}
        data-testid="pv2-score-unavailable"
      >
        <span className="text-[10.5px] font-semibold leading-tight">Not scored</span>
      </div>
    );
  }

  return (
    <div className="pv2-num" data-testid="pv2-score">
      <ScoreRing value={score} color={scoreRingColor(score)} size={size} strokeWidth={8} />
      <span className="sr-only">{note}</span>
    </div>
  );
}

export function SeverityChip({ score }: { score: number }) {
  const band = severityForScore(score);
  const colour = { critical: "#f87171", attention: "#fbbf24", healthy: "#34d399" }[band];
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-semibold"
      style={{
        background: hexAlpha(colour, 0.14),
        color: colour,
        border: `1px solid ${hexAlpha(colour, 0.4)}`,
      }}
    >
      {SEVERITY_LABEL[band]}
    </span>
  );
}

/* ── Stats ────────────────────────────────────────────────────────────────── */

export function StatCallout({ stat }: { stat: PortalV2Stat }) {
  const resolved = typeof stat.value === "number";
  return (
    <div
      className="rounded-[10px] border px-3.5 py-3"
      style={{
        borderColor: "var(--pv2-hairline)",
        background: "var(--pv2-raised)",
      }}
      data-testid={`pv2-stat-${stat.id}`}
    >
      <p
        className={cn("pv2-num text-[19px] font-extrabold leading-none tracking-[-0.02em]")}
        style={{ color: resolved ? "var(--pv2-heading)" : "var(--pv2-deemphasised)" }}
      >
        {formatStatValue(stat)}
      </p>
      <p className="mt-1.5 text-[11px] leading-snug" style={{ color: "var(--pv2-muted)" }}>
        {stat.label}
      </p>
      {!resolved && (
        // WHICH kind of nothing this is — never a bare dash. The distinction
        // between "not in your scan package" and "scanned, found nothing" is
        // the whole point of #341.
        <p className="mt-1 text-[10px] font-medium" style={{ color: "var(--pv2-micro)" }}>
          {unavailableNote(stat)}
        </p>
      )}
    </div>
  );
}

/* ── Findings ─────────────────────────────────────────────────────────────── */

export function FindingRow({
  finding,
  pillarColor,
}: {
  finding: PortalV2Finding;
  pillarColor?: string;
}) {
  const colour = finding.severity === "critical" ? "#f87171" : "#fbbf24";
  return (
    <li
      className="flex items-start gap-3 border-b px-4 py-2.5 last:border-b-0"
      style={{ borderColor: "var(--pv2-hairline)" }}
      data-testid="pv2-finding-row"
    >
      <span
        className="mt-1.5 size-1.5 shrink-0 rounded-full"
        style={{ background: colour }}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] leading-snug" style={{ color: "var(--pv2-body)" }}>
          {finding.title}
        </p>
        <p
          className="pv2-num mt-0.5 font-mono text-[10px]"
          style={{ color: "var(--pv2-deemphasised)" }}
        >
          {finding.checkKey}
        </p>
      </div>
      {pillarColor && (
        <span
          className="mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.1em]"
          style={{
            background: hexAlpha(colour, 0.14),
            color: colour,
          }}
        >
          {finding.severity}
        </span>
      )}
    </li>
  );
}

/* ── Empty / unavailable ──────────────────────────────────────────────────── */

export function EmptyNote({
  children,
  testId,
}: {
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <p
      className="px-4 py-6 text-center text-[12px]"
      style={{ color: "var(--pv2-micro)" }}
      data-testid={testId}
    >
      {children}
    </p>
  );
}

/* ── Trend ────────────────────────────────────────────────────────────────── */

/**
 * A real replayed history, or nothing. `trend` is null below the engine's
 * minimum real checkpoint count, and a synthesised line would be a fabricated
 * number on a page whose whole claim is that it has none.
 */
export function TrendLine({
  series,
  color,
  width = 160,
  height = 36,
}: {
  series: readonly number[];
  color: string;
  width?: number;
  height?: number;
}) {
  if (series.length < 2) return null;

  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = max - min || 1;
  const stepX = width / (series.length - 1);

  const points = series.map((v, i) => {
    const x = i * stepX;
    const y = height - ((v - min) / span) * (height - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  return (
    <svg width={width} height={height} aria-hidden="true" className="shrink-0">
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke={color}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
