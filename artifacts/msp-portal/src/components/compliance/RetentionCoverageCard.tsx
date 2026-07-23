import React from 'react';
import { Archive } from 'lucide-react';
import {
  ResolvedMetric,
  resolvedValue,
  riskCountBand,
  BAND_TEXT_CLASS,
  BAND_COLOR_VAR,
} from '@/components/health-suite/useTopicHealthLive';

/**
 * Retention Coverage — REAL retention posture from the compliance monitor
 * checks (retention drift + missing retention tags), replacing the mock
 * per-workload coverage bars whose percentages had no data source. There is
 * genuinely no per-workload retention-coverage ratio collected today (that
 * would need a new Graph check), so this card shows the real drift/missing
 * counts it does have and says exactly that — no invented percentages.
 */

interface RetentionCoverageCardProps {
  metrics: Record<string, ResolvedMetric>;
}

const RETENTION_METRICS: { key: string; label: string; caption: string }[] = [
  {
    key: 'compliance.retentionDriftCount',
    label: 'Retention Policy Drift',
    caption: 'Policies drifted from your recorded baseline',
  },
  {
    key: 'compliance.missingRetentionTagCount',
    label: 'Missing Retention Tags',
    caption: 'Content locations without a retention tag',
  },
  {
    key: 'compliance.activeEdiscoveryCount',
    label: 'Active eDiscovery Cases',
    caption: 'Open cases in your tenant',
  },
];

export const RetentionCoverageCard: React.FC<RetentionCoverageCardProps> = ({ metrics }) => {
  const rows = RETENTION_METRICS.map((def) => ({ def, value: resolvedValue(metrics[def.key]) }));
  const anyData = rows.some((r) => r.value != null);

  return (
    <div className="bg-card border border-border rounded-xl p-5 flex flex-col h-full">
      <div className="flex justify-between items-center mb-3">
        <h4 className="font-mono text-xs font-semibold text-foreground uppercase flex items-center gap-1.5">
          <Archive className="w-3.5 h-3.5 text-status-teal" />
          RETENTION COVERAGE
        </h4>
        <span className="text-[10px] font-mono text-muted-foreground">
          {anyData ? 'LIVE CHECKS' : 'AWAITING DATA'}
        </span>
      </div>

      {anyData ? (
        <div className="space-y-4 flex-grow">
          {rows.map(({ def, value }) => {
            const band = value != null ? riskCountBand(value) : null;
            return (
              <div key={def.key} className="space-y-1">
                <div className="flex justify-between items-baseline">
                  <span className="text-xs font-semibold text-foreground">{def.label}</span>
                  <span
                    className={`text-lg font-bold font-mono ${band ? BAND_TEXT_CLASS[band] : 'text-muted-foreground'}`}
                  >
                    {value != null ? value.toLocaleString() : '—'}
                  </span>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  {value != null ? def.caption : 'No data collected yet'}
                </p>
                <div className="h-1 bg-muted rounded-full overflow-hidden">
                  {band && (
                    <div
                      className="h-full rounded-full"
                      style={{
                        backgroundColor: BAND_COLOR_VAR[band],
                        width: band === 'green' ? '25%' : band === 'amber' ? '60%' : '100%',
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
            Retention metrics appear once the compliance checks have collected
            data for your tenant.
          </p>
        </div>
      )}

      <div className="mt-4 pt-2 border-t border-border text-[10px] font-mono text-muted-foreground leading-relaxed">
        Per-workload retention coverage ratios aren&apos;t collected yet — these
        are your real drift &amp; tagging check results.
      </div>
    </div>
  );
};
