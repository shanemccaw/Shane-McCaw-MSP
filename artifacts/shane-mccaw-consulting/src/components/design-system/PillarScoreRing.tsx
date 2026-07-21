/**
 * SVG score ring — the marketing-site echo of the Portal's real ring pattern
 * (msp-portal ui/score-ring.tsx: stroke-dasharray sweep, -90° start, round
 * linecap, mono center value; used in Mission Control as one large primary ring
 * plus a grid of small category rings — see CategoryBreakdownGrid).
 *
 * Color thresholds use Mission Control's 3-tier scheme (healthRingColor,
 * MissionControl.tsx: ≥85 green, 60–84 amber, <60 red) rather than
 * PillarModuleShell's 4-tier 75/50/25 green/amber/orange/red bar scheme:
 * the visuals this family echoes are Mission Control's (score rings + the
 * Nominal/Watch/High Severity vocabulary), amber vs. orange is not a
 * distinguishable step for colorblind readers, and the platform's own seeded
 * lead-signal rule (hasGovernanceGaps: governanceScore < 60) already treats 60
 * as the critical governance boundary. Green maps to emerald per the rebuilt
 * site's existing healthy-state convention (Status.tsx), amber/red as-is.
 */

export type ScoreTone = "green" | "amber" | "red";

export function scoreTone(value: number): ScoreTone {
  if (value >= 85) return "green";
  if (value >= 60) return "amber";
  return "red";
}

/** Tailwind palette values (emerald-400 / amber-400 / red-400) — inline because
 *  SVG stroke/fill attributes can't take utility classes' place in a transition. */
const TONE_HEX: Record<ScoreTone, string> = {
  green: "#34d399",
  amber: "#fbbf24",
  red: "#f87171",
};

export const SCORE_TONE_TEXT: Record<ScoreTone, string> = {
  green: "text-emerald-400",
  amber: "text-amber-400",
  red: "text-red-400",
};

interface PillarScoreRingProps {
  /** Score, 0–100 (a pillar score, not a percentage — rendered without a % sign). */
  value: number;
  /** Outer diameter in px. Portal sizes: 112 primary, 48 category. */
  size?: number;
  strokeWidth?: number;
  /** Label rendered under the ring (text token, never the data color). */
  label?: string;
  /**
   * Sweep-in control for the site's scroll-reveal pattern (FlagshipPortalPreview):
   * false renders the ring at zero and the dasharray transition plays when it
   * flips true. Leave default true when no reveal choreography is needed.
   */
  revealed?: boolean;
  className?: string;
}

export function PillarScoreRing({
  value,
  size = 112,
  strokeWidth = 9,
  label,
  revealed = true,
  className,
}: PillarScoreRingProps) {
  const clamped = Math.max(0, Math.min(100, value));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dash = revealed ? (clamped / 100) * circumference : 0;
  const tone = scoreTone(clamped);
  const fontSize = size >= 72 ? size * 0.22 : size * 0.26;

  return (
    <div className={`inline-flex flex-col items-center gap-2 ${className ?? ""}`}>
      <svg width={size} height={size} className="shrink-0" aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={TONE_HEX[tone]}
          strokeWidth={strokeWidth}
          strokeDasharray={`${dash} ${circumference}`}
          // butt cap at zero length — a 0-length dash with a round cap paints a
          // floating dot at 12 o'clock (pre-reveal frame, or a true 0 score)
          strokeLinecap={dash > 0 ? "round" : "butt"}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: "stroke-dasharray 700ms ease-out" }}
        />
        <text
          x="50%"
          y="50%"
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={fontSize}
          fontWeight={600}
          fill={TONE_HEX[tone]}
          style={{ fontFamily: "var(--app-font-numeric)" }}
        >
          {Math.round(clamped)}
        </text>
      </svg>
      {label && (
        <span className="text-xs font-medium text-text-secondary text-center leading-tight">
          {label}
        </span>
      )}
    </div>
  );
}
