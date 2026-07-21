import { PillarScoreRing } from "./PillarScoreRing";

export interface CategoryScore {
  label: string;
  value: number;
}

interface CategoryBreakdownGridProps {
  items: CategoryScore[];
  /** Small-ring diameter — Portal's Mission Control category rings are 48/5. */
  size?: number;
  strokeWidth?: number;
  /** Passed through to each ring for the scroll-reveal sweep. */
  revealed?: boolean;
  className?: string;
}

/**
 * Grid of small category score rings — the second half of the Portal's real
 * ring pattern (Mission Control: one large primary ring beside a
 * grid-cols-4/sm:grid-cols-7 grid of 48px pillar rings, score-ring.tsx
 * geometry). Pair with a primary PillarScoreRing; each ring self-colors on the
 * shared 3-tier threshold scheme documented there.
 */
export function CategoryBreakdownGrid({
  items,
  size = 48,
  strokeWidth = 5,
  revealed = true,
  className,
}: CategoryBreakdownGridProps) {
  return (
    <div
      className={`grid grid-cols-4 sm:grid-cols-7 gap-x-3 gap-y-4 ${className ?? ""}`}
    >
      {items.map((item) => (
        <PillarScoreRing
          key={item.label}
          value={item.value}
          size={size}
          strokeWidth={strokeWidth}
          label={item.label}
          revealed={revealed}
          className="justify-self-center"
        />
      ))}
    </div>
  );
}
