import React from 'react';
import { TrendingUp, AlertTriangle } from 'lucide-react';
import {
  ResolvedMetric,
  resolvedValue,
  resolvedReason,
  reasonCopy,
  scoreBand,
  BAND_TEXT_CLASS,
  BAND_COLOR_VAR,
} from '@/components/health-suite/useTopicHealthLive';

/**
 * Score Overview — the real Architecture pillar score alongside the real raw
 * engine scores from tenant_engine_snapshots (health, security, drift — the
 * engines that genuinely write snapshot rows).
 *
 * DIRECTION MATTERS HERE, and it differs between the two kinds of number:
 *
 *  • The PILLAR score is display-normalized (health-display.ts:
 *    `100 − min(100, raw/theoreticalMax × 100)`) — a 0–100 scale where HIGHER
 *    is HEALTHIER. The shared scoreBand (≥70 green) is correct for it.
 *
 *  • `engine.*Score` from /api/dashboard/resolve are the RAW snapshot scores.
 *    health-engine.ts / security-engine.ts / drift-engine.ts each define their
 *    score as a plain SUM of per-signal impact over the signals that actually
 *    FIRED, with (drift-engine.ts's words) "no conditional logic, weighting,
 *    clamping, or thresholds". They are unbounded risk-accumulation values
 *    where HIGHER is WORSE and 0 means nothing fired.
 *
 * This card previously ran all four through scoreBand and drew a `value%`-wide
 * bar — which painted a heavily-drifted tenant GREEN "healthy" at 85 and a
 * clean tenant RED at 0, directly opposite the truth, next to a pillar card
 * reading the other way. The raw scores now render unbanded, explicitly labeled
 * as accumulated risk points, with bars scaled relative to the largest of the
 * three real values (a true relative comparison, not a fake percentage).
 */

const SCORE_CARDS: { key: string; label: string; caption: string }[] = [
  { key: 'engine.healthScore', label: 'Health Engine', caption: 'Risk points accumulated · lower is better' },
  { key: 'engine.securityScore', label: 'Security Engine', caption: 'Risk points accumulated · lower is better' },
  { key: 'engine.driftScore', label: 'Drift Engine', caption: 'Drift points accumulated · lower is better' },
];

interface ScoreOverviewProps {
  metrics: Record<string, ResolvedMetric>;
  /** The real Architecture pillar score (radar) shown as the lead card. */
  pillarScore: number | null;
}

export const ScoreOverview: React.FC<ScoreOverviewProps> = ({ metrics, pillarScore }) => {
  const rawCards = SCORE_CARDS.map((c) => ({
    ...c,
    value: resolvedValue(metrics[c.key]),
    reason: reasonCopy(resolvedReason(metrics[c.key])),
  }));
  // Relative scale across the three real raw scores — never a percentage.
  const rawMax = Math.max(1, ...rawCards.map((c) => c.value ?? 0));

  const cards = [
    {
      key: '__pillar',
      label: 'Architecture Pillar',
      caption: 'From your latest scan radar · higher is healthier',
      emptyCopy: 'No pillar score yet',
      value: pillarScore,
      // The only genuinely 0–100, higher-is-better number on this row.
      normalized: true as const,
    },
    ...rawCards.map((c) => ({
      key: c.key,
      label: c.label,
      caption: c.caption,
      emptyCopy: c.reason,
      value: c.value,
      normalized: false as const,
    })),
  ];

  return (
    <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((card) => {
        // Only the display-normalized pillar score may be traffic-lighted.
        // Raw engine scores are unbounded risk sums — any red/amber/green on
        // them would be inverted, so they stay neutral.
        const band = card.normalized && card.value != null ? scoreBand(card.value) : null;
        const barWidth =
          card.value == null
            ? 0
            : card.normalized
              ? Math.min(Math.max(card.value, 0), 100)
              : Math.min((Math.max(card.value, 0) / rawMax) * 100, 100);
        const Icon = card.normalized ? TrendingUp : AlertTriangle;
        return (
          <div key={card.key} className="bg-card border border-border rounded-xl p-4 flex flex-col">
            <div className="flex justify-between items-center">
              <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
                {card.label}
              </p>
              <Icon className={`w-3.5 h-3.5 ${band ? BAND_TEXT_CLASS[band] : 'text-muted-foreground'}`} />
            </div>
            <p
              className={`text-3xl font-bold font-mono mt-2 ${
                card.value == null ? 'text-muted-foreground' : band ? BAND_TEXT_CLASS[band] : 'text-foreground'
              }`}
            >
              {card.value != null ? Math.round(card.value) : '—'}
            </p>
            <p className="text-[10px] text-secondary-foreground/80 mt-1 leading-tight">
              {card.value != null ? card.caption : card.emptyCopy}
            </p>
            <div className="h-1 bg-muted rounded-full overflow-hidden mt-3">
              {card.value != null && (
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    backgroundColor: band ? BAND_COLOR_VAR[band] : 'var(--color-status-blue)',
                    width: `${barWidth}%`,
                  }}
                />
              )}
            </div>
          </div>
        );
      })}
    </section>
  );
};
