import React from 'react';
import { Sparkles } from 'lucide-react';
import {
  ResolvedMetric,
  resolvedValue,
  scoreBand,
  BAND_TEXT_CLASS,
  BAND_COLOR_VAR,
} from '@/components/health-suite/useTopicHealthLive';
import type { CopilotReadinessLive } from '@/components/assessment-test/types';

/**
 * Copilot Licensing & Readiness — REAL Copilot posture for the licensing
 * page, replacing the mock engagement gauge and its fake "auto-assign"
 * trigger. Real data: the copilot license-readiness check signal and the
 * weighted readiness score. Per-user Copilot usage/engagement telemetry is
 * genuinely NOT collected (registry: not_collected) — stated plainly, never
 * charted from invented numbers.
 */

interface CopilotEngagementProps {
  metrics: Record<string, ResolvedMetric>;
  copilotReadiness: CopilotReadinessLive | null;
}

export const CopilotEngagement: React.FC<CopilotEngagementProps> = ({
  metrics,
  copilotReadiness,
}) => {
  const licenseSignal = resolvedValue(metrics['licensing.copilotLicenseBreakdown']);
  const overall = copilotReadiness?.overall.score ?? null;
  const band = overall != null ? scoreBand(overall) : null;
  const usageCollected = metrics['copilot.usagePerUser']?.status === 'ok';

  return (
    <div className="bg-card border border-border rounded-xl p-5 flex flex-col h-full">
      <div className="flex justify-between items-center mb-4">
        <h4 className="font-mono text-xs font-semibold text-foreground uppercase flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-status-violet" />
          COPILOT LICENSING
        </h4>
      </div>

      <div className="space-y-4 flex-grow">
        <div className="p-3 rounded-lg border border-border bg-secondary/40">
          <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
            License-readiness signal
          </p>
          <p
            className={`text-2xl font-bold font-mono mt-1 ${
              licenseSignal != null ? 'text-foreground' : 'text-muted-foreground'
            }`}
          >
            {licenseSignal != null ? licenseSignal.toLocaleString() : '—'}
          </p>
          <p className="text-[10px] text-secondary-foreground/80 mt-0.5">
            {licenseSignal != null
              ? 'From the copilot:license-readiness check'
              : 'No license-readiness data yet'}
          </p>
        </div>

        <div className="space-y-1.5">
          <div className="flex justify-between text-xs font-mono">
            <span className="text-secondary-foreground/90">Data-governance readiness</span>
            <span className={`font-bold ${band ? BAND_TEXT_CLASS[band] : 'text-muted-foreground'}`}>
              {overall != null ? `${overall}%` : 'no data'}
            </span>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            {overall != null && band && (
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${overall}%`, backgroundColor: BAND_COLOR_VAR[band] }}
              />
            )}
          </div>
          <p className="text-[10px] text-muted-foreground">
            Weighted across the SharePoint/labels/DLP readiness checks — the
            gating factor before Copilot seats pay off.
          </p>
        </div>

        <div className="flex justify-between items-center text-[11px] font-mono p-2.5 rounded-lg border border-border bg-secondary/40">
          <span className="text-muted-foreground">Per-user engagement telemetry</span>
          <span className="text-muted-foreground">
            {usageCollected ? 'collected' : 'not collected yet'}
          </span>
        </div>
      </div>

      <div className="mt-4 pt-2 border-t border-border text-[10px] font-mono text-muted-foreground leading-relaxed">
        Seat assignment changes run through your MSP — no auto-assign is wired
        from this screen.
      </div>
    </div>
  );
};
