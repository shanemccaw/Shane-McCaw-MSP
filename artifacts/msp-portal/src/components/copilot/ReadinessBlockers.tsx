import React from 'react';
import { AlertCircle, CheckCircle2, CircleDashed } from 'lucide-react';
import { scoreBand, BAND_TEXT_CLASS } from '@/components/health-suite/useTopicHealthLive';
import type { CopilotReadinessLive } from '@/components/assessment-test/types';

/**
 * Readiness Blockers — derived from the REAL Copilot-readiness indicators
 * (replacing the mock blocker list). An indicator is a blocker when its real
 * score is below the healthy band (<70, the shared score threshold); an
 * uncovered indicator is listed as "not measured yet" — a different honest
 * state from "blocked". Nothing invented, no fake remediate buttons — real
 * remediation offers surface through the Automation Opportunities section.
 */

interface ReadinessBlockersProps {
  copilotReadiness: CopilotReadinessLive | null;
}

const INDICATORS: {
  key: 'sharePointTeams' | 'sensitivityLabels' | 'dlp';
  label: string;
  blockedCopy: string;
}[] = [
  {
    key: 'sharePointTeams',
    label: 'SharePoint & Teams exposure',
    blockedCopy: 'Overshared content would be surfaced by Copilot answers.',
  },
  {
    key: 'sensitivityLabels',
    label: 'Sensitivity labels',
    blockedCopy: 'Unlabeled content can’t be protected by label-aware policies.',
  },
  {
    key: 'dlp',
    label: 'Data loss prevention',
    blockedCopy: 'Weak DLP coverage lets sensitive data flow into prompts/answers.',
  },
];

export const ReadinessBlockers: React.FC<ReadinessBlockersProps> = ({ copilotReadiness }) => {
  const rows = INDICATORS.map((def) => {
    const indicator = copilotReadiness?.[def.key] ?? null;
    const score = indicator?.score ?? null;
    const state: 'blocked' | 'healthy' | 'unmeasured' =
      score == null ? 'unmeasured' : score < 70 ? 'blocked' : 'healthy';
    return { ...def, score, state };
  });
  const blockedCount = rows.filter((r) => r.state === 'blocked').length;

  return (
    <div className="bg-card border border-border rounded-xl p-5 flex flex-col h-full">
      <div className="flex justify-between items-center mb-3">
        <h4 className="font-mono text-xs font-semibold text-foreground uppercase flex items-center gap-1.5">
          <AlertCircle className="w-3.5 h-3.5 text-status-red" />
          READINESS BLOCKERS
        </h4>
        <span className="text-xs font-mono text-muted-foreground">
          {copilotReadiness
            ? blockedCount > 0
              ? `${blockedCount} blocking`
              : 'None blocking'
            : 'Awaiting data'}
        </span>
      </div>

      <ul className="divide-y divide-border flex-grow">
        {rows.map((row) => (
          <li key={row.key} className="py-3 flex items-start gap-3">
            {row.state === 'blocked' ? (
              <AlertCircle className="w-4 h-4 text-status-red flex-shrink-0 mt-0.5" />
            ) : row.state === 'healthy' ? (
              <CheckCircle2 className="w-4 h-4 text-status-green flex-shrink-0 mt-0.5" />
            ) : (
              <CircleDashed className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />
            )}
            <div className="min-w-0 flex-grow">
              <div className="flex justify-between items-baseline gap-2">
                <p className="text-xs font-semibold text-foreground">{row.label}</p>
                <span
                  className={`text-xs font-mono font-bold flex-shrink-0 ${
                    row.score != null ? BAND_TEXT_CLASS[scoreBand(row.score)] : 'text-muted-foreground'
                  }`}
                >
                  {row.score != null ? `${row.score}%` : 'not measured'}
                </span>
              </div>
              <p className="text-[11px] text-secondary-foreground/90 mt-0.5 leading-relaxed">
                {row.state === 'blocked'
                  ? row.blockedCopy
                  : row.state === 'healthy'
                    ? 'Within the healthy band (≥70).'
                    : 'This indicator hasn’t been measured yet — it appears once the backing checks collect data.'}
              </p>
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-2 pt-2 border-t border-border text-[10px] font-mono text-muted-foreground leading-relaxed">
        Blockers derive from your real readiness indicators (threshold 70) —
        remediation runs through your MSP&apos;s real offers, not one-click toggles.
      </div>
    </div>
  );
};
