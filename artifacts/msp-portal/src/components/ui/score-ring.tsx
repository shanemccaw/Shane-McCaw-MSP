import { cn } from "@/lib/utils"

export type ScoreRingColor = "blue" | "red" | "amber" | "green" | "violet"

const RING_COLOR_VAR: Record<ScoreRingColor, string> = {
  blue: "var(--color-status-blue)",
  red: "var(--color-status-red)",
  amber: "var(--color-status-amber)",
  green: "var(--color-status-green)",
  violet: "var(--color-status-violet)",
}

export interface ScoreRingProps {
  /** Percentage value, 0-100 */
  value: number
  /** Ring + text color */
  color?: ScoreRingColor
  /** Outer diameter in px */
  size?: number
  /** Stroke width in px */
  strokeWidth?: number
  /** Optional label rendered below the ring (outside the SVG) */
  label?: string
  className?: string
}

/**
 * Reusable circular progress ring (stroke-dasharray/dashoffset technique).
 * Same geometry convention as lib/dashboard-canvas ScoreRing (radius, -90deg
 * start, round linecap) but driven by design tokens instead of hardcoded hex,
 * and takes an explicit color prop instead of score-threshold-derived color
 * so callers can express severity/category directly (e.g. an offer's accent).
 * Percentage text uses the mono stack per the numeric-values-only rule.
 */
export function ScoreRing({ value, color = "blue", size = 100, strokeWidth = 8, label, className }: ScoreRingProps) {
  const clamped = Math.max(0, Math.min(100, value))
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const dash = (clamped / 100) * circumference
  const ringColor = RING_COLOR_VAR[color]
  const fontSize = size >= 72 ? size * 0.22 : size * 0.26

  return (
    <div className={cn("inline-flex flex-col items-center gap-2", className)}>
      <svg width={size} height={size} className="shrink-0">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="hsl(var(--muted))"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={ringColor}
          strokeWidth={strokeWidth}
          strokeDasharray={`${dash} ${circumference}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: "stroke-dasharray 600ms ease-out, stroke 600ms ease-out" }}
        />
        <text
          x="50%"
          y="50%"
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={fontSize}
          fontWeight={600}
          fill={ringColor}
          className="font-mono"
        >
          {Math.round(clamped)}%
        </text>
      </svg>
      {label && (
        <span className="text-xs font-medium text-muted-foreground text-center">{label}</span>
      )}
    </div>
  )
}
