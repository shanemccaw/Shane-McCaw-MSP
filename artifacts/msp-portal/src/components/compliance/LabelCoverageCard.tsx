import React from 'react';
import { Tags } from 'lucide-react';
import {
  ResolvedMetric,
  resolvedValue,
  riskCountBand,
  BAND_TEXT_CLASS,
  BAND_COLOR_VAR,
  scoreBand,
} from '@/components/health-suite/useTopicHealthLive';
import type { CopilotReadinessLive } from '@/components/assessment-test/types';

/**
 * Sensitivity Label Coverage — REAL labeling posture, replacing the mock
 * donut's fabricated percentages. Two real sources:
 *   • copilotReadiness.sensitivityLabels (copilot-readiness.ts) — the real
 *     labeling indicator score with its real unlabeledItems / labelErrors
 *     backing counts. `basis` distinguishes a true ratio from a risk-band
 *     score, and the caption says which, so a band score is never presented
 *     as a coverage percentage.
 *   • compliance.* label monitor checks — missing labels, label errors,
 *     label-policy drift (registry metrics via /api/dashboard/resolve).
 */

interface LabelCoverageCardProps {
  metrics: Record<string, ResolvedMetric>;
  copilotReadiness: CopilotReadinessLive | null;
}

const LABEL_METRICS: { key: string; label: string }[] = [
  { key: 'compliance.missingLabelCount', label: 'Missing Sensitivity Labels' },
  { key: 'compliance.labelErrorCount', label: 'Label Errors' },
  { key: 'compliance.labelPolicyDriftCount', label: 'Label Policy Drift' },
];

export const LabelCoverageCard: React.FC<LabelCoverageCardProps> = ({
  metrics,
  copilotReadiness,
}) => {
  const indicator = copilotReadiness?.sensitivityLabels ?? null;
  const score = indicator?.score ?? null;
  const band = score != null ? scoreBand(score) : null;

  const circumference = 2 * Math.PI * 42;
  const dashOffset = score != null ? circumference - (circumference * score) / 100 : circumference;

  return (
    <div className="bg-card border border-border rounded-xl p-5 flex flex-col h-full">
      <div className="flex justify-between items-center mb-3">
        <h4 className="font-mono text-xs font-semibold text-foreground uppercase flex items-center gap-1.5">
          <Tags className="w-3.5 h-3.5 text-status-violet" />
          SENSITIVITY LABEL COVERAGE
        </h4>
      </div>

      <div className="flex items-center gap-5 flex-grow">
        {/* Real indicator score ring */}
        <div className="relative flex-shrink-0">
          <svg className="w-24 h-24 transform -rotate-90" viewBox="0 0 96 96">
            <circle cx="48" cy="48" r="42" fill="transparent" stroke="hsl(var(--muted))" strokeWidth="7" />
            {score != null && (
              <circle
                cx="48"
                cy="48"
                r="42"
                fill="transparent"
                stroke={band ? BAND_COLOR_VAR[band] : 'var(--color-status-blue)'}
                strokeWidth="7"
                strokeDasharray={circumference}
                strokeDashoffset={dashOffset}
                strokeLinecap="round"
                className="transition-all duration-1000 ease-out"
              />
            )}
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span
              className={`text-xl font-bold font-mono ${band ? BAND_TEXT_CLASS[band] : 'text-muted-foreground'}`}
            >
              {score != null ? score : '—'}
            </span>
          </div>
        </div>

        <div className="space-y-2 min-w-0 flex-grow">
          <p className="text-[11px] text-secondary-foreground/90 leading-relaxed">
            {score != null
              ? indicator?.basis === 'ratio'
                ? 'Real labeled-vs-unlabeled coverage ratio'
                : 'Risk-band score from your labeling checks (not a coverage %)'
              : 'Labeling indicator appears once the sensitivity-label checks have collected data.'}
          </p>
          {indicator?.unlabeledItems != null && (
            <p className="text-[11px] font-mono text-muted-foreground">
              Unlabeled items:{' '}
              <span className="text-foreground font-bold">
                {indicator.unlabeledItems.toLocaleString()}
              </span>
            </p>
          )}
          {indicator?.labelErrors != null && (
            <p className="text-[11px] font-mono text-muted-foreground">
              Label errors:{' '}
              <span className="text-foreground font-bold">
                {indicator.labelErrors.toLocaleString()}
              </span>
            </p>
          )}
        </div>
      </div>

      {/* Real check counts */}
      <ul className="mt-4 pt-3 border-t border-border space-y-1.5">
        {LABEL_METRICS.map(({ key, label }) => {
          const value = resolvedValue(metrics[key]);
          const countBand = value != null ? riskCountBand(value) : null;
          return (
            <li key={key} className="flex justify-between items-center text-[11px] font-mono">
              <span className="text-muted-foreground">{label}</span>
              <span className={`font-bold ${countBand ? BAND_TEXT_CLASS[countBand] : 'text-muted-foreground'}`}>
                {value != null ? value.toLocaleString() : '—'}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
};
