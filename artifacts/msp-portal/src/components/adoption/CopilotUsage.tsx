import React from 'react';
import { Sparkles } from 'lucide-react';
import {
  ResolvedMetric,
  resolvedValue,
  scoreBand,
  BAND_TEXT_CLASS,
} from '@/components/health-suite/useTopicHealthLive';
import type { CopilotReadinessLive } from '@/components/assessment-test/types';

/**
 * Copilot — REAL readiness + license posture, replacing the mock per-app
 * usage breakdown. Copilot per-user usage telemetry (copilot.usagePerUser) is
 * genuinely NOT collected yet (registry status not_collected) and this card
 * says so honestly instead of charting invented numbers. What IS real: the
 * weighted Copilot-readiness score with its three sub-indicators
 * (copilot-readiness.ts) and the copilot license-readiness check count.
 */

interface CopilotUsageProps {
  metrics: Record<string, ResolvedMetric>;
  copilotReadiness: CopilotReadinessLive | null;
}

const INDICATORS: { key: 'sharePointTeams' | 'sensitivityLabels' | 'dlp'; label: string }[] = [
  { key: 'sharePointTeams', label: 'SharePoint & Teams exposure' },
  { key: 'sensitivityLabels', label: 'Sensitivity labels' },
  { key: 'dlp', label: 'Data loss prevention' },
];

export const CopilotUsage: React.FC<CopilotUsageProps> = ({ metrics, copilotReadiness }) => {
  const overall = copilotReadiness?.overall.score ?? null;
  const band = overall != null ? scoreBand(overall) : null;
  const licenseSignal = resolvedValue(metrics['licensing.copilotLicenseBreakdown']);
  const usage = metrics['copilot.usagePerUser'];
  const usageCollected = usage?.status === 'ok';

  return (
    <div className="bg-card border border-border rounded-xl p-5 flex flex-col h-full">
      <div className="flex justify-between items-center mb-4">
        <h4 className="font-mono text-xs font-semibold text-foreground uppercase flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-status-violet" />
          COPILOT READINESS
        </h4>
        <span
          className={`text-xs font-mono font-bold ${band ? BAND_TEXT_CLASS[band] : 'text-muted-foreground'}`}
        >
          {overall != null ? `${overall}% ready` : 'No data yet'}
        </span>
      </div>

      {copilotReadiness ? (
        <div className="space-y-4 flex-grow">
          {INDICATORS.map(({ key, label }) => {
            const indicator = copilotReadiness[key];
            const weight = copilotReadiness.overall.weights[key];
            return (
              <div key={key} className="space-y-1">
                <div className="flex justify-between text-xs font-mono">
                  <span className="text-secondary-foreground/90">
                    {label}{' '}
                    <span className="text-muted-foreground">({Math.round(weight * 100)}%)</span>
                  </span>
                  <span className="font-bold text-foreground">
                    {indicator.score != null ? `${indicator.score}%` : 'no data'}
                  </span>
                </div>
                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                  {indicator.score != null && (
                    <div
                      className="h-full rounded-full transition-all duration-500 bg-status-violet"
                      style={{ width: `${indicator.score}%` }}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex-grow flex items-center justify-center text-center px-4 py-6">
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Copilot-readiness indicators appear once your scan has collected the
            backing SharePoint, labeling, and DLP checks.
          </p>
        </div>
      )}

      <div className="mt-4 pt-3 border-t border-border space-y-1.5 text-[11px] font-mono">
        <div className="flex justify-between items-center">
          <span className="text-muted-foreground">Copilot license-readiness signal</span>
          <span className={licenseSignal != null ? 'font-bold text-foreground' : 'text-muted-foreground'}>
            {licenseSignal != null ? licenseSignal.toLocaleString() : '—'}
          </span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-muted-foreground">Per-user Copilot usage</span>
          <span className="text-muted-foreground">
            {usageCollected ? 'collected' : 'not collected yet'}
          </span>
        </div>
      </div>

      <div className="mt-2 text-[10px] font-mono text-muted-foreground leading-relaxed">
        Per-user Copilot usage telemetry isn&apos;t collected by the platform yet —
        nothing here is simulated.
      </div>
    </div>
  );
};
