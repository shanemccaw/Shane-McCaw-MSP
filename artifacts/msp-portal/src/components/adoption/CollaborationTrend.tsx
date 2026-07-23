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
 * Collaboration Adoption Scores — the REAL per-workload adoption-score checks
 * (usage:*-adoption), replacing the mock 12-month trend chart.
 *
 * HONEST GAP, stated in the UI: per-workload adoption HISTORY isn't servable
 * yet — the resolve endpoint's history path only covers smart-eligible
 * metrics, and the usage.* checks aren't smart-eligible in the registry (a
 * small registry/resolver change on existing infrastructure, reported in
 * PLATFORM_BUILD.md rather than worked around here — those files are
 * concurrently held by another session). Current real scores render now;
 * the trend axis lights up once history is servable.
 */

interface CollaborationTrendProps {
  metrics: Record<string, ResolvedMetric>;
}

const SCORE_ROWS: { key: string; label: string }[] = [
  { key: 'usage.teamsUsageCount', label: 'Teams' },
  { key: 'usage.exchangeUsageCount', label: 'Exchange' },
  { key: 'usage.sharePointUsageCount', label: 'SharePoint' },
  { key: 'usage.oneDriveUsageCount', label: 'OneDrive' },
];

export const CollaborationTrend: React.FC<CollaborationTrendProps> = ({ metrics }) => {
  const rows = SCORE_ROWS.map((def) => ({ def, value: resolvedValue(metrics[def.key]) }));
  const anyData = rows.some((r) => r.value != null);

  return (
    <div className="bg-card border border-border rounded-xl p-5 flex flex-col h-full">
      <div className="flex justify-between items-center mb-4">
        <h4 className="font-mono text-xs font-semibold text-foreground uppercase flex items-center gap-1.5">
          <TrendingUp className="w-3.5 h-3.5 text-primary" />
          COLLABORATION ADOPTION SCORES
        </h4>
        <span className="text-[10px] font-mono text-muted-foreground">
          {anyData ? 'Current readings' : 'AWAITING DATA'}
        </span>
      </div>

      {anyData ? (
        <div className="space-y-4 flex-grow">
          {rows.map(({ def, value }) => {
            // Adoption scores are 0–100-style check outputs; band with the
            // shared score thresholds when in range, otherwise show raw.
            const band = value != null && value <= 100 ? scoreBand(value) : null;
            return (
              <div key={def.key} className="space-y-1">
                <div className="flex justify-between text-xs font-mono">
                  <span className="text-secondary-foreground/90">{def.label}</span>
                  <span
                    className={`font-bold ${band ? BAND_TEXT_CLASS[band] : value != null ? 'text-foreground' : 'text-muted-foreground'}`}
                  >
                    {value != null ? value.toLocaleString() : 'no data'}
                  </span>
                </div>
                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                  {value != null && (
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${Math.min(value, 100)}%`,
                        backgroundColor: band ? BAND_COLOR_VAR[band] : 'var(--color-primary)',
                      }}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex-grow flex items-center justify-center text-center px-4 py-8">
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Adoption scores appear once the usage checks have collected data for
            your tenant.
          </p>
        </div>
      )}

      <div className="mt-4 pt-2 border-t border-border text-[10px] font-mono text-muted-foreground leading-relaxed">
        Historical adoption trend isn&apos;t servable yet (usage checks aren&apos;t
        history-enabled in the metric registry) — current real scores only.
      </div>
    </div>
  );
};
