import React from 'react';
import { ShieldCheck } from 'lucide-react';
import {
  ResolvedMetric,
  resolvedValue,
  resolvedHistory,
  riskCountBand,
  BAND_TEXT_CLASS,
  BAND_COLOR_VAR,
  scoreBand,
} from '@/components/health-suite/useTopicHealthLive';
import type { CopilotReadinessLive } from '@/components/assessment-test/types';

/**
 * DLP Effectiveness — REAL data-loss-prevention posture, replacing the mock
 * per-action bar chart (its action categories were fabricated; per-action DLP
 * event breakdown isn't collected today). Real sources:
 *   • compliance.dlpIncidentCount — real DLP incidents (with real history
 *     sparkline when the monitor has accumulated rows).
 *   • compliance.weakDlpPolicyCount — real weak-policy check.
 *   • copilotReadiness.dlp — the real DLP indicator score (weakPolicies /
 *     dlpIncidents backed, risk-band based — labeled as such).
 */

interface DlpEffectivenessCardProps {
  metrics: Record<string, ResolvedMetric>;
  copilotReadiness: CopilotReadinessLive | null;
}

export const DlpEffectivenessCard: React.FC<DlpEffectivenessCardProps> = ({
  metrics,
  copilotReadiness,
}) => {
  const incidents = resolvedValue(metrics['compliance.dlpIncidentCount']);
  const weakPolicies = resolvedValue(metrics['compliance.weakDlpPolicyCount']);
  const weakHistory = resolvedHistory(metrics['compliance.weakDlpPolicyCount']);
  const indicator = copilotReadiness?.dlp ?? null;
  const score = indicator?.score ?? null;
  const scoreBandValue = score != null ? scoreBand(score) : null;

  const incidentBand = incidents != null ? riskCountBand(incidents) : null;
  const weakBand = weakPolicies != null ? riskCountBand(weakPolicies) : null;
  const maxHistory = Math.max(1, ...weakHistory.map((p) => p.value));

  return (
    <div className="bg-card border border-border rounded-xl p-5 flex flex-col h-full">
      <div className="flex justify-between items-center mb-3">
        <h4 className="font-mono text-xs font-semibold text-foreground uppercase flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-status-blue" />
          DLP EFFECTIVENESS
        </h4>
        <span
          className={`text-xs font-mono font-bold ${
            scoreBandValue ? BAND_TEXT_CLASS[scoreBandValue] : 'text-muted-foreground'
          }`}
        >
          {score != null ? `${score}/100` : 'No score yet'}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="p-3 rounded-lg border border-border bg-secondary/40">
          <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
            DLP Incidents
          </p>
          <p
            className={`text-2xl font-bold font-mono mt-1 ${
              incidentBand ? BAND_TEXT_CLASS[incidentBand] : 'text-muted-foreground'
            }`}
          >
            {incidents != null ? incidents.toLocaleString() : '—'}
          </p>
          <p className="text-[10px] text-secondary-foreground/80 mt-0.5">
            {incidents != null ? 'In the look-back window' : 'No data yet'}
          </p>
        </div>
        <div className="p-3 rounded-lg border border-border bg-secondary/40">
          <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
            Weak DLP Policies
          </p>
          <p
            className={`text-2xl font-bold font-mono mt-1 ${
              weakBand ? BAND_TEXT_CLASS[weakBand] : 'text-muted-foreground'
            }`}
          >
            {weakPolicies != null ? weakPolicies.toLocaleString() : '—'}
          </p>
          <p className="text-[10px] text-secondary-foreground/80 mt-0.5">
            {weakPolicies != null ? 'Policies below baseline strength' : 'No data yet'}
          </p>
        </div>
      </div>

      {/* Real weak-policy history sparkline (honest empty when <2 points) */}
      <div className="mt-4 flex-grow flex flex-col justify-end">
        {weakHistory.length >= 2 ? (
          <>
            <p className="text-[10px] font-mono text-muted-foreground mb-1">
              Weak-policy count over time
            </p>
            <div className="h-12 flex items-end space-x-0.5">
              {weakHistory.slice(-30).map((p, i) => (
                <div
                  key={`${p.t}-${i}`}
                  className="flex-1 rounded-t opacity-70"
                  style={{
                    height: `${Math.max((p.value / maxHistory) * 100, 4)}%`,
                    backgroundColor:
                      BAND_COLOR_VAR[riskCountBand(p.value)],
                  }}
                  title={`${new Date(p.t).toLocaleDateString()}: ${p.value}`}
                />
              ))}
            </div>
          </>
        ) : (
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            Policy-strength history fills in as your live monitor accumulates
            real readings.
          </p>
        )}
      </div>

      <div className="mt-3 pt-2 border-t border-border text-[10px] font-mono text-muted-foreground leading-relaxed">
        {score != null
          ? 'Indicator score is risk-band based (copilot-readiness.ts), not an event-coverage % — per-action DLP breakdown isn’t collected yet.'
          : 'Per-action DLP breakdown isn’t collected yet.'}
      </div>
    </div>
  );
};
