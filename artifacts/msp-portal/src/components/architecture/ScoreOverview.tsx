import React from 'react';
import { TrendingUp } from 'lucide-react';
import {
  ResolvedMetric,
  resolvedValue,
  scoreBand,
  BAND_TEXT_CLASS,
  BAND_COLOR_VAR,
} from '@/components/health-suite/useTopicHealthLive';

/**
 * Score Overview — REAL engine scores from tenant_engine_snapshots (health,
 * security, drift — the engines that genuinely write snapshot rows), replacing
 * the mock TenantScore composite whose sub-scores were invented. Each card is
 * a real resolved engine score with the shared red/amber/green banding; a
 * missing snapshot renders the honest em-dash.
 */

const SCORE_CARDS: { key: string; label: string; caption: string }[] = [
  { key: 'engine.healthScore', label: 'Health Engine', caption: 'Composite tenant health' },
  { key: 'engine.securityScore', label: 'Security Engine', caption: 'Security posture score' },
  { key: 'engine.driftScore', label: 'Drift Engine', caption: 'Configuration drift score' },
];

interface ScoreOverviewProps {
  metrics: Record<string, ResolvedMetric>;
  /** The real Architecture pillar score (radar) shown as the lead card. */
  pillarScore: number | null;
}

export const ScoreOverview: React.FC<ScoreOverviewProps> = ({ metrics, pillarScore }) => {
  const cards = [
    {
      key: '__pillar',
      label: 'Architecture Pillar',
      caption: 'From your latest scan radar',
      value: pillarScore,
    },
    ...SCORE_CARDS.map((c) => ({ ...c, value: resolvedValue(metrics[c.key]) })),
  ];

  return (
    <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((card) => {
        const band = card.value != null ? scoreBand(card.value) : null;
        return (
          <div key={card.key} className="bg-card border border-border rounded-xl p-4 flex flex-col">
            <div className="flex justify-between items-center">
              <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
                {card.label}
              </p>
              <TrendingUp className={`w-3.5 h-3.5 ${band ? BAND_TEXT_CLASS[band] : 'text-muted-foreground'}`} />
            </div>
            <p
              className={`text-3xl font-bold font-mono mt-2 ${
                band ? BAND_TEXT_CLASS[band] : 'text-muted-foreground'
              }`}
            >
              {card.value != null ? Math.round(card.value) : '—'}
            </p>
            <p className="text-[10px] text-secondary-foreground/80 mt-1">
              {card.value != null ? card.caption : 'No score data yet'}
            </p>
            <div className="h-1 bg-muted rounded-full overflow-hidden mt-3">
              {band && card.value != null && (
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    backgroundColor: BAND_COLOR_VAR[band],
                    width: `${Math.min(Math.max(card.value, 0), 100)}%`,
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
