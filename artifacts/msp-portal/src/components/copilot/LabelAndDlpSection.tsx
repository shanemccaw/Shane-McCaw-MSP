import React from 'react';
import { Tags, ShieldCheck } from 'lucide-react';
import {
  ResolvedMetric,
  resolvedValue,
  riskCountBand,
  BAND_TEXT_CLASS,
  scoreBand,
  BAND_COLOR_VAR,
} from '@/components/health-suite/useTopicHealthLive';
import type { CopilotReadinessLive } from '@/components/assessment-test/types';

/**
 * Labels & DLP — the two data-governance gates for Copilot, wired to REAL
 * check data (replacing the mock coverage donut + invented per-policy rows):
 * the real sensitivity-label and DLP readiness indicators with their real
 * backing counts, plus the compliance.* label/DLP monitor-check metrics.
 */

interface LabelAndDlpSectionProps {
  metrics: Record<string, ResolvedMetric>;
  copilotReadiness: CopilotReadinessLive | null;
}

const indicatorBar = (score: number | null) => {
  const band = score != null ? scoreBand(score) : null;
  return (
    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
      {score != null && band && (
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${score}%`, backgroundColor: BAND_COLOR_VAR[band] }}
        />
      )}
    </div>
  );
};

export const LabelAndDlpSection: React.FC<LabelAndDlpSectionProps> = ({
  metrics,
  copilotReadiness,
}) => {
  const labels = copilotReadiness?.sensitivityLabels ?? null;
  const dlp = copilotReadiness?.dlp ?? null;

  const rows: { key: string; label: string }[] = [
    { key: 'compliance.missingLabelCount', label: 'Missing sensitivity labels' },
    { key: 'compliance.labelErrorCount', label: 'Label errors' },
    { key: 'compliance.weakDlpPolicyCount', label: 'Weak DLP policies' },
    { key: 'compliance.dlpIncidentCount', label: 'DLP incidents (window)' },
  ];

  return (
    <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Sensitivity labels gate */}
      <div className="bg-card border border-border rounded-xl p-5 flex flex-col">
        <div className="flex justify-between items-center mb-3">
          <h4 className="font-mono text-xs font-semibold text-foreground uppercase flex items-center gap-1.5">
            <Tags className="w-3.5 h-3.5 text-status-violet" />
            SENSITIVITY LABELS GATE
          </h4>
          <span
            className={`text-xs font-mono font-bold ${
              labels?.score != null ? BAND_TEXT_CLASS[scoreBand(labels.score)] : 'text-muted-foreground'
            }`}
          >
            {labels?.score != null ? `${labels.score}%` : 'No data yet'}
          </span>
        </div>
        {indicatorBar(labels?.score ?? null)}
        <div className="mt-3 space-y-1.5 text-[11px] font-mono flex-grow">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Unlabeled items</span>
            <span className="font-bold text-foreground">
              {labels?.unlabeledItems != null ? labels.unlabeledItems.toLocaleString() : '—'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Label errors</span>
            <span className="font-bold text-foreground">
              {labels?.labelErrors != null ? labels.labelErrors.toLocaleString() : '—'}
            </span>
          </div>
        </div>
        <p className="mt-3 pt-2 border-t border-border text-[10px] font-mono text-muted-foreground leading-relaxed">
          {labels?.score != null
            ? labels.basis === 'ratio'
              ? 'Real labeled-vs-unlabeled coverage ratio.'
              : 'Risk-band score (not a coverage %) from your labeling checks.'
            : 'Appears once the labeling checks have collected data.'}
        </p>
      </div>

      {/* DLP gate */}
      <div className="bg-card border border-border rounded-xl p-5 flex flex-col">
        <div className="flex justify-between items-center mb-3">
          <h4 className="font-mono text-xs font-semibold text-foreground uppercase flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-status-blue" />
            DLP GATE
          </h4>
          <span
            className={`text-xs font-mono font-bold ${
              dlp?.score != null ? BAND_TEXT_CLASS[scoreBand(dlp.score)] : 'text-muted-foreground'
            }`}
          >
            {dlp?.score != null ? `${dlp.score}%` : 'No data yet'}
          </span>
        </div>
        {indicatorBar(dlp?.score ?? null)}
        <div className="mt-3 space-y-1.5 text-[11px] font-mono flex-grow">
          {rows.map(({ key, label }) => {
            const value = resolvedValue(metrics[key]);
            const band = value != null ? riskCountBand(value) : null;
            return (
              <div key={key} className="flex justify-between">
                <span className="text-muted-foreground">{label}</span>
                <span className={`font-bold ${band ? BAND_TEXT_CLASS[band] : 'text-muted-foreground'}`}>
                  {value != null ? value.toLocaleString() : '—'}
                </span>
              </div>
            );
          })}
        </div>
        <p className="mt-3 pt-2 border-t border-border text-[10px] font-mono text-muted-foreground leading-relaxed">
          Real monitor-check counts — per-policy DLP effectiveness breakdown
          isn&apos;t collected yet.
        </p>
      </div>
    </section>
  );
};
